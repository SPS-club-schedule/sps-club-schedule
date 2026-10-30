import * as views from './views';
import {planner} from './planner';
import {e,link,nav} from './ui';

export function workspace(s,content,ui) {
  const b=s.sync.board?.club?s.sync.board:s.editBoard;
  if(!b?.club || ['auth','reset','entry'].includes(s.page))return `<div class="welcome-layout"><aside class="welcome-intro"><div class="wordmark">SPS / together.</div><div class="eyebrow space">CLUB WORKSPACE</div><h1>日程有序，<br>协作有回应。</h1><p>从一个想法，到一场活动。<br>让社团的每一件事，都有清晰的下一步。</p></aside><main class="welcome-terminal">${content}</main></div>`;
  const editing=['edit','template-edit'].includes(s.page),calendarRoute=s.page==='calendar';
  const hasPanel=editing || ui.calendarOpen || calendarRoute;
  const contextPage=s.page==='template-edit'?'templates':ui.context==='mine'?'mine':'board';
  const context={...s,page:contextPage,error:'',sync:{...s.sync,board:b},search:s.contextSearch||'',filter:s.contextFilter||'all'};
  const terminal=editing||calendarRoute?(contextPage==='templates'?views.templates(context):views.board(context,contextPage==='mine')):content;
  const active=editing?(s.page==='template-edit'?'templates':'board'):calendarRoute?'calendar':s.page.startsWith('admin')?'admin':s.page;
  return `<div class="workspace ${hasPanel?'has-panel':''} ${editing||calendarRoute?'mobile-panel-route':''}"><aside class="desktop-sidebar"><a class="sidebar-brand" href="#/board"><span class="logo">S</span><span>SPS<span class="sidebar-caption">社团工作台</span></span></a><div class="sidebar-club">${e(b.club.name)}</div>${nav(active,b)}${link('/calendar','<span class="nav-icon">◷</span>日程全览','sidebar-calendar '+(calendarRoute?'active':''))}<div class="sidebar-bottom">${link('/account',`<span class="avatar">${e(b.me.name?.slice(0,1))}</span><span>${e(b.me.name)}<small>账号设置</small></span>`,'sidebar-account')}${link('/entry','切换社团 ↗','plain small')}</div></aside>
  <main class="workspace-main"><section class="terminal-pane" aria-label="社团工作台"><div class="terminal-chrome"><span><i></i>工作台</span><span>独立滚动</span></div><div class="terminal-scroll" data-scroll-key="terminal-${editing||calendarRoute?contextPage:s.page}">${terminal}</div></section>
  ${editing?`<section class="side-pane editor-pane" aria-label="${s.page==='template-edit'?'模板':'任务'}编辑区"><div class="side-pane-bar"><span>${s.page==='template-edit'?'模板工作区':'任务工作区'}</span><span>更宽的空间，专注安排</span></div>${content}</section>`:hasPanel?`<section class="side-pane calendar-pane" aria-label="大日历">${planner({...s,sync:{...s.sync,board:b}},ui.planner)}</section>`:`<aside class="workspace-rest"><div class="eyebrow">YOUR CLUB, IN VIEW</div><h1>把安排展开，<br>让协作更从容。</h1><p>工作台就在手边。<br>日历与编辑器，将在这里展开。</p><div class="workspace-shortcuts">${link('/calendar','◷　展开日程全览','primary')}${link('/edit','＋　安排新任务','secondary')}${link('/template-edit','▤　创建共享模板','plain')}</div></aside>`}</main></div>`;
}
