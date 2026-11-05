import { createHash, randomBytes, randomInt } from 'node:crypto';
import domain from '../shared/domain.js';
import emailHelpers from '../shared/email.js';
import guestHelpers from '../shared/guest-assignments.js';
import departments from '../shared/departments.js';
import view from '../shared/view.js';
const {ClubError}=domain, {normalizeEmail}=emailHelpers, {participantKeys}=guestHelpers;
const DAY=86400000, CODE_LIFE=15*60000;
const ASSIGNMENT_WINDOW = 60_000;
const hash=value=>createHash('sha256').update(value).digest('hex');
const fail=(code,message)=>{throw new ClubError(code,message);};
export const taskDone=t=>!!t && (t.mode==='shared'?!!t.sharedCompletion:participantKeys(t).length>0 && participantKeys(t).every(id=>!!t.completions?.[id]));
export const memberPending=(t,id)=>!!t&&!t.archived&&(t.participantIds||[]).includes(id)&&(t.mode==='shared'?!t.sharedCompletion:!t.completions?.[id]);
const active=t=>!!t&&!t.archived;
const date=time=>{const p=view.parts(time);return p.date+' '+p.time+'（北京时间）';};
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// All recipients come from server-side memberships and private account email data.
// Outbox inserts share the task mutation transaction; no network runs in a transaction.
export function createMailService({sql,store,env,now=Date.now,fetcher=fetch,codeGenerator=()=>String(randomInt(100000,1000000))}) {
  sql.exec(`CREATE TABLE IF NOT EXISTS account_emails (
    account_id TEXT PRIMARY KEY, email TEXT NOT NULL, verified_at INTEGER NOT NULL DEFAULT 0,
    code_hash TEXT, nonce TEXT, code_expires_at INTEGER NOT NULL DEFAULT 0, requested_at INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS email_outbox (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL, account_id TEXT NOT NULL, task_id TEXT,
    context TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
    priority INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'queued', attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt INTEGER NOT NULL DEFAULT 0, first_attempt INTEGER NOT NULL DEFAULT 0,
    payload TEXT, provider_id TEXT, error_code TEXT, sent_at INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX IF NOT EXISTS email_due ON email_outbox(state,next_attempt,priority,created_at);
    CREATE INDEX IF NOT EXISTS email_account ON email_outbox(account_id);
    CREATE TABLE IF NOT EXISTS account_preferences (account_id TEXT PRIMARY KEY, email_notifications INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS email_meta (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS email_usage (day INTEGER PRIMARY KEY, used INTEGER NOT NULL DEFAULT 0);`);
  sql.exec('INSERT OR IGNORE INTO email_meta VALUES(?,?)','started_at',now());
  const startedAt=sql.exec('SELECT value FROM email_meta WHERE key=?','started_at').toArray()[0].value;
  const configured=()=>!!env.RESEND_API_KEY && env.EMAIL_NOTIFICATIONS_ENABLED==='true';
  const emailRow=id=>sql.exec('SELECT * FROM account_emails WHERE account_id=?',id).toArray()[0];
  const notificationsEnabled=id=>sql.exec('SELECT email_notifications FROM account_preferences WHERE account_id=?',id).toArray()[0]?.email_notifications!==0;
  function setNotifications(id,enabled) {
    if(typeof enabled!=='boolean')fail('VALIDATION','邮件提醒开关无效');
    sql.exec('INSERT INTO account_preferences(account_id,email_notifications) VALUES(?,?) ON CONFLICT(account_id) DO UPDATE SET email_notifications=excluded.email_notifications',id,enabled?1:0);
    if(!enabled)sql.exec("UPDATE email_outbox SET state='cancelled',payload=NULL,context='{}' WHERE account_id=? AND kind<>'verify' AND state='queued'",id);
  }
  const info=id=>{const r=emailRow(id);return {emailNotificationsEnabled:notificationsEnabled(id),email:r?.email||'',emailVerified:!!r?.verified_at,emailVerificationExpiresAt:r?.code_expires_at||0};};
  const publicUser=row=>({id:row.id,username:row.username,...info(row.id)});
  function enqueue(key,kind,accountId,taskId,context,expires,priority,readyAt=0) {
    if(kind!=='verify'&&!notificationsEnabled(accountId))return;
    sql.exec('INSERT OR IGNORE INTO email_outbox(id,kind,account_id,task_id,context,created_at,expires_at,priority,next_attempt) VALUES(?,?,?,?,?,?,?,?,?)',
      hash(key),kind,accountId,taskId||null,JSON.stringify(context),now(),expires,priority,readyAt);
  }
  function requestVerification(id,value) {
    let email;try{email=normalizeEmail(value);}catch(error){fail('VALIDATION',error.message);}
    const old=emailRow(id);
    if(old?.email===email&&old.verified_at)return info(id);
    if(old && now()-old.requested_at<60000)fail('RATE_LIMIT','请等待一分钟后再发送验证码');
    const code=codeGenerator(),nonce=randomBytes(16).toString('hex'),expiry=now()+CODE_LIFE;
    sql.exec(`INSERT INTO account_emails(account_id,email,code_hash,nonce,code_expires_at,requested_at) VALUES(?,?,?,?,?,?)
      ON CONFLICT(account_id) DO UPDATE SET email=excluded.email,verified_at=0,code_hash=excluded.code_hash,nonce=excluded.nonce,code_expires_at=excluded.code_expires_at,requested_at=excluded.requested_at`,id,email,hash(nonce+':'+code),nonce,expiry,now());
    sql.exec("UPDATE email_outbox SET state='cancelled',payload=NULL,context='{}' WHERE account_id=? AND kind='verify' AND state='queued'",id);
    enqueue('verify:'+id+':'+nonce,'verify',id,null,{email,code,nonce},expiry,0);
    return info(id);
  }
  function verify(id,code) {
    const row=emailRow(id);
    if(!row||!/^\d{6}$/.test(code||'')||row.code_expires_at<=now()||hash(row.nonce+':'+code)!==row.code_hash)fail('VALIDATION','验证码错误或已过期，请检查邮箱或重新发送');
    sql.exec('UPDATE account_emails SET verified_at=?,code_hash=NULL,nonce=NULL,code_expires_at=0 WHERE account_id=?',now(),id);
    sql.exec("UPDATE email_outbox SET state='cancelled',payload=NULL,context='{}' WHERE account_id=? AND kind='verify' AND state='queued'",id);
    return info(id);
  }
  // Only unsent mail can absorb more items. A provider retry must keep its original payload and key.
  function queueAssignmentList(rootId, member, taskIds, version) {
    if(!notificationsEnabled(member.identity))return;
    const time = now();
    const pending = sql.exec(
      `SELECT id, context FROM email_outbox WHERE kind='assignment_list' AND account_id=?
       AND task_id=? AND state='queued' AND first_attempt=0 AND created_at>? ORDER BY created_at DESC LIMIT 1`,
      member.identity, rootId, time - ASSIGNMENT_WINDOW
    ).toArray()[0];
    if (pending) {
      const context = JSON.parse(pending.context);
      context.taskIds = [...new Set([...context.taskIds, ...taskIds])];
      sql.exec('UPDATE email_outbox SET context=? WHERE id=?', JSON.stringify(context), pending.id);
      return;
    }
    enqueue(`assignment-list:${rootId}:${version}:${member._id}`, 'assignment_list', member.identity, rootId,
      {memberId: member._id, taskIds: [...taskIds]}, time + 7 * DAY, 3, time + ASSIGNMENT_WINDOW);
  }

  function withdrawAssignment(rootId, taskId, accountId) {
    // Discard an earlier addition even if the person later puts themselves back on this subtask.
    const jobs = sql.exec(
      `SELECT id, kind, context FROM email_outbox WHERE account_id=? AND state='queued' AND first_attempt=0
       AND ((kind='assignment_list' AND task_id=?) OR (kind='assigned' AND task_id=?))`,
      accountId, rootId, taskId
    ).toArray();
    for (const job of jobs) {
      const context = JSON.parse(job.context);
      if (job.kind === 'day_list' || job.kind === 'deadline_list') return deadlineMessage(job.kind, task, me, roster, c, email);
    if (job.kind === 'assignment_list') {
        if (!context.taskIds.includes(taskId)) continue;
        context.taskIds = context.taskIds.filter(id => id !== taskId);
        if (context.taskIds.length) {
          sql.exec('UPDATE email_outbox SET context=? WHERE id=?', JSON.stringify(context), job.id);
          continue;
        }
      }
      sql.exec("UPDATE email_outbox SET state='cancelled',context='{}' WHERE id=?", job.id);
    }
  }

  async function recordAssignments(tasks, before, actorId, version) {
    // The domain returns either one updated task or one newly published family, root first.
    const first = tasks[0];
    const rootId = first.parentTaskId || first._id;
    const roster = await store.find('members', {clubId: first.clubId});
    const members = new Map(roster.filter(active).map(member => [member._id, member]));
    const byRecipient = new Map();
    for (const task of tasks) {
      if(task.simpleContainer)continue;
      const previousIds = before?._id === task._id ? before.participantIds : [];
      const currentIds = new Set(task.participantIds);
      for (const id of previousIds) {
        if (!currentIds.has(id) && members.has(id)) withdrawAssignment(rootId, task._id, members.get(id).identity);
      }
      for (const id of currentIds) {
        const member = members.get(id);
        if (!member || member.identity === actorId || previousIds.includes(id)) continue;
        if (!byRecipient.has(member)) byRecipient.set(member, new Set());
        byRecipient.get(member).add(task._id);
      }
    }
    for (const [member, ids] of byRecipient) queueAssignmentList(rootId, member, ids, version);
  }

  async function changed(before, result, action, actorId) {
    if(result.baseVersion===undefined||result.baseVersion===result.version)return;
    const tasks = (result.tasks || (result.task ? [result.task] : [])).filter(active);
    if (tasks.length && ['createTask', 'createTaskGroup', 'editTask', 'createSimpleTask', 'editSimpleTask'].includes(action)) {
      await recordAssignments(tasks, before, actorId, result.version);
      return;
    }
    for(const task of tasks) {
      const prior=before?._id===task._id?before:null;
      if(action==='complete' && !taskDone(prior)&&taskDone(task)) {
        const [children,members]=await Promise.all([store.find('tasks',{clubId:task.clubId}),store.find('members',{clubId:task.clubId})]);
        for(const child of children.filter(t=>active(t)&&t.dependsOnTaskIds?.includes(task._id))) {
          for(const id of child.participantIds||[]) {
            const member=members.find(m=>m._id===id&&!m.archived);
            if(member&&memberPending(child,id))enqueue(`dependency:${task._id}:${task.syncVersion}:${child._id}:${id}`,'dependency',member.identity,child._id,{memberId:id,dependencyId:task._id},now()+2*DAY,2);
          }
        }
      }
    }
  }
  async function scanDeadlines() {
    const time = now();
    const tasks = await store.find('tasks', {});
    const members = await store.find('members', {});
    const roots = new Map(tasks.filter(t => active(t) && !t.parentTaskId).map(t => [t._id, t]));
    const groups = new Map();

    // Before this release, each task had its own key. Rebuild only untouched notices;
    // a legacy send that might already have reached Resend must keep its own retry key.
    sql.exec(`UPDATE email_outbox SET state='superseded',context='{}'
      WHERE kind IN ('day','deadline') AND state='queued' AND first_attempt=0`);
    const oldAttempts = new Set(sql.exec(`SELECT id FROM email_outbox
      WHERE kind IN ('day','deadline') AND first_attempt>0 AND expires_at>?`, time).toArray().map(row => row.id));

    for (const task of tasks) {
      const {dueAt, clubId} = task;
      const rootId = task.parentTaskId || task._id;
      if (!active(task) || task.simpleContainer || taskDone(task) || roots.get(rootId)?.clubId !== clubId) continue;
      if (!Number.isSafeInteger(dueAt) || dueAt < startedAt || time >= dueAt + 7 * DAY) continue;
      const overdue = time >= dueAt;
      if (!overdue && (time < dueAt - DAY || dueAt - DAY < startedAt)) continue;

      const roster = members.filter(m => active(m) && m.clubId === clubId);
      const pending = roster.filter(m => notificationsEnabled(m.identity) && memberPending(task, m._id));
      const recipients = new Set(pending);
      if (overdue) {
        const departments = new Set(pending.map(m => m.department).filter(Boolean));
        for (const member of roster) {
          if (member.role === 'department_admin' && departments.has(member.department)) recipients.add(member);
        }
      }
      const kind = overdue ? 'deadline_list' : 'day_list';
      for (const member of recipients) {
        if(!notificationsEnabled(member.identity))continue;
        if (oldAttempts.size) {
          const oldKey = overdue ? `deadline:${task._id}:${dueAt}:${member.identity}` : `day:${task._id}:${dueAt}:${member._id}`;
          if (oldAttempts.has(hash(oldKey))) continue;
        }
        const key = JSON.stringify([kind, clubId, rootId, dueAt, member.identity]);
        if (!groups.has(key)) groups.set(key, {kind, rootId, dueAt, accountId:member.identity, taskIds:[]});
        groups.get(key).taskIds.push(task._id);
      }
    }
    for (const [key, group] of groups) {
      const overdue = group.kind === 'deadline_list';
      // Refresh the list until its first send. Repeated scans cannot reopen a sent group.
      sql.exec(`INSERT INTO email_outbox(id,kind,account_id,task_id,context,created_at,expires_at,priority)
        VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET context=excluded.context,state='queued',
        next_attempt=CASE WHEN email_outbox.state='cancelled' THEN 0 ELSE email_outbox.next_attempt END
        WHERE first_attempt=0 AND state IN ('queued','cancelled') AND context<>excluded.context`,
        hash(key), group.kind, group.accountId, group.rootId, JSON.stringify({dueAt:group.dueAt,taskIds:group.taskIds}),
        time, group.dueAt + (overdue ? 7 * DAY : 0), overdue ? 1 : 4);
    }
  }
  const site=()=>env.EMAIL_SITE_URL||'https://sps-club-schedule.github.io/sps-club-schedule/';
  function message(to, subject, lines, destination) {
    const links = typeof destination === 'string' ? [{label:'打开 SPS 社团日程', url:destination}] : destination;
    const textLinks = links.map(link => typeof destination === 'string' ? link.url : link.label + '\n' + link.url);
    const htmlLinks = links.map(link => '<p><a href="' + escape(link.url) + '">' + escape(link.label) + '</a></p>');
    return {from:env.EMAIL_FROM||'SPS 社团日程 <notifications@sps-schedule.folderrewind.top>',to:[to],subject,
      text:[...lines,'',...textLinks,'','SPS 社团日程 · 这是一封任务服务邮件，请勿直接回复。'].join('\n'),
      html:'<div lang="zh-CN" style="font-family:Arial,sans-serif;line-height:1.7;max-width:640px;margin:auto">'+lines.map(line=>'<p>'+escape(line)+'</p>').join('')+htmlLinks.join('')+'<p style="color:#666">SPS 社团日程 · 请勿直接回复</p></div>'};
  }

  async function assignmentMessage(root, member, context, email) {
    if (context.memberId !== member._id) return null;
    const links = [];
    for (const id of context.taskIds) {
      const item = id === root._id ? root : await store.get('tasks', id);
      if (item?.simpleContainer || !memberPending(item, member._id) || item.clubId !== root.clubId) continue;
      if (item._id !== root._id && item.parentTaskId !== root._id) continue;
      const kind = item._id === root._id ? '主任务' : '子任务';
      links.push({
        label: `${kind}「${item.title}」 · ${date(item.dueAt)} 截止`,
        url: site() + '#/task?id=' + encodeURIComponent(id) + '&club=' + encodeURIComponent(root.clubId)
      });
    }
    if (!links.length) return null;
    if (!email?.verified_at) return undefined;
    const club = await store.get('clubs', root.clubId);
    const showRoot = member.role !== 'speaker' || root.participantIds.includes(member._id);
    const subject = '[SPS] 任务负责人分配 · ' + (showRoot ? root.title : club?.name || 'SPS');
    return message(email.email, subject, [member.name + '，你好：', '社团：' + (club?.name || 'SPS'),
      `你被安排负责以下 ${links.length} 项工作，可点击查看详情。`], links);
  }
  async function deadlineMessage(kind, root, me, roster, context, email) {
    const overdue = kind === 'deadline_list';
    if (overdue !== (now() >= context.dueAt)) return null;
    const departmentMembers = overdue && me.role === 'department_admin' && me.department
      ? roster.filter(member => notificationsEnabled(member.identity) && member.department === me.department) : [];
    const links = [];
    for (const id of context.taskIds) {
      const task = id === root._id ? root : await store.get('tasks', id);
      if (!active(task) || task.simpleContainer || task.clubId !== root.clubId || task.dueAt !== context.dueAt) continue;
      if (task._id !== root._id && task.parentTaskId !== root._id) continue;
      const own = memberPending(task, me._id);
      const managed = departmentMembers.filter(member => memberPending(task, member._id));
      if (!own && !managed.length) continue;

      const details = [];
      if (own) details.push('你负责');
      if (managed.length) details.push(departments.departmentLabel(me.department) + '未完成：' + managed.map(m => m.name).join('、'));
      links.push({
        label: (id === root._id ? '主任务' : '子任务') + '「' + task.title + '」 · ' + details.join('；'),
        url: site() + '#/task?id=' + encodeURIComponent(id) + '&club=' + encodeURIComponent(root.clubId)
      });
    }
    if (!links.length) return null;
    if (!email?.verified_at) return undefined;
    const club = await store.get('clubs', root.clubId);
    const showRoot = me.role !== 'speaker' || root.participantIds.includes(me._id);
    const subject = (overdue ? '[SPS] 任务已到期：' : '[SPS] 任务将于一天内截止：') + (showRoot ? root.title : club?.name || 'SPS');
    const lines = [me.name + '，你好：', '社团：' + (club?.name || 'SPS'), '截止时间：' + date(context.dueAt),
      overdue ? '以下工作已逾期，请及时跟进。' : '以下工作将在24小时内截止，请留意进度。'];
    if (departmentMembers.length) lines.push('请作为部门管理员跟进列出的本部门未完成人。');
    return message(email.email, subject, lines, links);
  }
  // Returns null for obsolete events, undefined for an email awaiting verification.
  async function materialize(job) {
    const c=JSON.parse(job.context),email=emailRow(job.account_id);
    if(!sql.exec('SELECT id FROM accounts WHERE id=?',job.account_id).toArray().length)return null;
    if(job.kind==='verify') {
      if(!email||email.nonce!==c.nonce||email.email!==c.email||email.verified_at||email.code_expires_at<=now())return null;
      return message(email.email,'[SPS] 邮箱验证码：'+c.code,['你的邮箱验证码是：'+c.code,'验证码15分钟内有效。若并非你本人操作，请忽略本邮件。'],site()+'#/account');
    }
    if(!notificationsEnabled(job.account_id))return null;
    const task=await store.get('tasks',job.task_id);
    if(!active(task))return null;
    if(task.simpleContainer&&!['assignment_list','day_list','deadline_list'].includes(job.kind))return null;
    const parent=task.parentTaskId?await store.get('tasks',task.parentTaskId):null;
    if(task.parentTaskId&&!active(parent))return null;
    const roster=(await store.find('members',{clubId:task.clubId})).filter(m=>!m.archived),me=roster.find(m=>m.identity===job.account_id);
    if(!me)return null;
    if (job.kind === 'day_list' || job.kind === 'deadline_list') return deadlineMessage(job.kind, task, me, roster, c, email);
    if (job.kind === 'assignment_list') return assignmentMessage(task, me, c, email);
    const own=memberPending(task,me._id),pending=roster.filter(m=>notificationsEnabled(m.identity)&&memberPending(task,m._id));
    const club=await store.get('clubs',task.clubId),lines=[`${me.name}，你好：`,`社团：${club?.name||'SPS'}`,`任务：${task.title}`];
    if(parent)lines.push('所属主任务：'+parent.title);
    lines.push('截止时间：'+date(task.dueAt));
    let subject;
    if(job.kind==='deadline') {
      if(task.dueAt!==c.dueAt||now()<task.dueAt)return null;
      const managed=me.role==='department_admin'&&me.department?pending.filter(m=>m.department===me.department):[];
      if(!own&&!managed.length)return null;
      subject='[SPS] 任务已到期：'+task.title;
      if(own)lines.push('你负责的这项任务已到截止时间，尚未完成，现已逾期。请尽快处理，并与相关负责人沟通。');
      if(managed.length)lines.push(`${departments.departmentLabel(me.department)}尚未完成的负责人：${managed.map(m=>m.name).join('、')}。请作为部门管理员跟进协调。`);
    } else {
      if(!own||me._id!==c.memberId)return null;
      if(job.kind==='day') {
        if(task.dueAt!==c.dueAt||now()>=task.dueAt)return null;
        subject='[SPS] 任务将于一天内截止：'+task.title;lines.push('这项任务距离截止不足24小时，请留意进度并及时完成。');
      } else if(job.kind==='assigned') {
        subject='[SPS] 你被设为任务负责人：'+task.title;lines.push('你已被设为这项任务的负责人，请打开网站查看分工与要求。');
      } else if(job.kind==='dependency') {
        const dependency=await store.get('tasks',c.dependencyId);
        if(!active(dependency)||dependency.clubId!==task.clubId||!task.dependsOnTaskIds?.includes(dependency._id)||!taskDone(dependency))return null;
        const owners=[...(dependency.participantIds||[]).map(id=>roster.find(m=>m._id===id)?.name||'已离开的成员'),...(dependency.guestParticipants||[]).map(g=>g.name)];
        const remaining=[];
        for(const id of task.dependsOnTaskIds||[]){const dep=await store.get('tasks',id);if(!active(dep)||!taskDone(dep))remaining.push(dep?.title||'不可用的前置任务');}
        subject='[SPS] 前置任务已完成，请对接：'+task.title;
        lines.push(`前置任务「${dependency.title}」已完成。`,`对应负责人：${owners.join('、')||'请在网站查看'}。`);
        lines.push(remaining.length?'你可以先联系上述负责人对接成果；仍需等待其他前置任务：'+remaining.join('、')+'。':'所有前置任务均已完成，你可以联系上述负责人对接成果，开始自己的任务。');
      } else return null;
    }
    if(!email?.verified_at)return undefined;
    return message(email.email,subject,lines,site()+'#/task?id='+encodeURIComponent(task._id)+'&club='+encodeURIComponent(task.clubId));
  }
  async function prepare() {
    if(!configured())return null;
    const time=now();
    sql.exec("UPDATE email_outbox SET state='expired',payload=NULL,context='{}' WHERE state='queued' AND expires_at<=?",time);
    const next=sql.exec('SELECT value FROM email_meta WHERE key=?','next_send_at').toArray()[0]?.value||0;
    if(next>time)return {wait:next-time};
    const candidates=sql.exec("SELECT * FROM email_outbox WHERE state='queued' AND next_attempt<=? ORDER BY priority,created_at,id LIMIT 100",time).toArray();
    for(const job of candidates) {
      const payload=await materialize(job);
      if(payload===null){sql.exec("UPDATE email_outbox SET state='cancelled',payload=NULL,context='{}' WHERE id=?",job.id);continue;}
      if(payload===undefined){sql.exec('UPDATE email_outbox SET next_attempt=? WHERE id=?',time+60000,job.id);continue;}
      // Never retry ambiguous sends beyond the provider's 24-hour idempotency window.
      if(job.first_attempt&&time-job.first_attempt>=23*3600000){sql.exec("UPDATE email_outbox SET state='uncertain',payload=NULL,error_code='idempotency_window' WHERE id=?",job.id);continue;}
      const stored=job.payload?JSON.parse(job.payload):payload;
      if(job.payload&&stored.to[0]!==payload.to[0]){sql.exec("UPDATE email_outbox SET state='cancelled',payload=NULL WHERE id=?",job.id);continue;}
      // Never retry a frozen digest containing tasks or departmental details now withdrawn.
      if (job.payload && ['day_list','deadline_list'].includes(job.kind) && job.payload !== JSON.stringify(payload)) {
        sql.exec("UPDATE email_outbox SET state='uncertain',payload=NULL,context='{}',error_code='deadline_list_changed' WHERE id=?",job.id);
        continue;
      }
      const day=Math.floor(time/DAY),limit=Math.max(1,Number(env.EMAIL_DAILY_LIMIT)||100);
      if(!job.first_attempt) {
        const used=sql.exec('SELECT used FROM email_usage WHERE day=?',day).toArray()[0]?.used||0;
        if(used>=limit)return null;
        sql.exec('INSERT INTO email_usage(day,used) VALUES(?,1) ON CONFLICT(day) DO UPDATE SET used=used+1',day);
      }
      sql.exec('UPDATE email_outbox SET first_attempt=CASE WHEN first_attempt=0 THEN ? ELSE first_attempt END,attempts=attempts+1,next_attempt=?,payload=? WHERE id=?',time,time+60000,JSON.stringify(stored),job.id);
      sql.exec('INSERT INTO email_meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value','next_send_at',time+600);
      return {...job,payload:stored};
    }
    return null;
  }
  async function transmit(job) {
    try {
      const response=await fetcher('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':'sps/'+job.id},body:JSON.stringify(job.payload),signal:AbortSignal.timeout(8000)});
      let body;try{body=await response.json();}catch{body={};}
      if(response.ok&&typeof body.id==='string')return {sent:true,id:body.id};
      const retry=response.ok||[401,403,408,409,429].includes(response.status)||response.status>=500;
      return {retry,error:'http_'+response.status,delay:Math.max(60000,Math.min(DAY,Number(response.headers.get('Retry-After'))*1000||0))};
    } catch {return {retry:true,error:'network',delay:60000};}
  }
  function finish(job,outcome) {
    if(outcome.sent)sql.exec("UPDATE email_outbox SET state='sent',provider_id=?,sent_at=?,payload=NULL,context='{}',error_code=NULL WHERE id=?",outcome.id,now(),job.id);
    else if(!outcome.retry)sql.exec("UPDATE email_outbox SET state='failed',error_code=?,payload=NULL,context='{}' WHERE id=?",outcome.error,job.id);
    else sql.exec('UPDATE email_outbox SET error_code=?,next_attempt=? WHERE id=?',outcome.error,now()+Math.max(outcome.delay||60000,Math.min(3600000,60000*2**Math.min(job.attempts,6))),job.id);
  }
  function cleanup() {
    sql.exec("DELETE FROM email_outbox WHERE state<>'queued' AND expires_at<?",now()-30*DAY);
    sql.exec('DELETE FROM email_usage WHERE day<?',Math.floor(now()/DAY)-35);
    sql.exec('DELETE FROM account_emails WHERE account_id NOT IN (SELECT id FROM accounts)');
    sql.exec('DELETE FROM account_preferences WHERE account_id NOT IN (SELECT id FROM accounts)');
  }
  return {configured,info,publicUser,notificationsEnabled,setNotifications,requestVerification,verify,changed,scanDeadlines,prepare,transmit,finish,cleanup,startedAt};
}
