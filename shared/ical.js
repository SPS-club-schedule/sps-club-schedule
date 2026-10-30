const { hasDuration, taskView, parts } = require('./view');
const clean = value => String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'');
const escape = value => clean(value).replace(/\\/g,'\\\\').replace(/\r\n|\r|\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,');
const utc = value => new Date(value).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
// RFC 5545: fold at 75 UTF-8 octets, without splitting a code point.
function fold(line) {
  let out='', chunk='', size=0;
  for (const ch of line) {
    const bytes=new TextEncoder().encode(ch).length;
    if (size+bytes>75) { out+=chunk+'\r\n'; chunk=' '; size=1; }
    chunk+=ch; size+=bytes;
  }
  return out+chunk;
}
function personalCalendar(board, now=Date.now()) {
  const selected=board.tasks.filter(t=>!t.archived && t.participantIds.includes(board.me.id))
    .map(t=>taskView(t,board,now)).filter(t=>hasDuration(t)?t.endsAt>now:!t.myDone);
  const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//SPS//Club Schedule//ZH-CN','CALSCALE:GREGORIAN',
    'X-WR-CALNAME:'+escape(board.club.name+' · 我的日程'),'X-WR-TIMEZONE:Asia/Shanghai'];
  for (const task of selected) {
    const duration=hasDuration(task), due=parts(task.dueAt);
    lines.push('BEGIN:VEVENT','UID:'+escape(task._id+'@sps-club-schedule'),
      'DTSTAMP:'+utc(task.updatedAt || now),'LAST-MODIFIED:'+utc(task.updatedAt || now),
      'SEQUENCE:'+(task.revision || 0),'DTSTART:'+utc(duration?task.startsAt:task.dueAt));
    if (duration) lines.push('DTEND:'+utc(task.endsAt),'LOCATION:'+escape(task.location || '未定'));
    lines.push('SUMMARY:'+escape((duration?'':'[截止] ')+task.title),
      'DESCRIPTION:'+escape([board.club.name,task.description,duration?'任务截止：'+due.date+' '+due.time+'（北京时间）':'截止事项，无持续时段',task.parentTitle?'主任务：'+task.parentTitle:''].filter(Boolean).join('\n')),
      'URL:https://sps-club-schedule.github.io/sps-club-schedule/#/task?id='+encodeURIComponent(task._id),
      'STATUS:CONFIRMED','TRANSP:'+(duration?'OPAQUE':'TRANSPARENT'),'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return {text:lines.map(fold).join('\r\n')+'\r\n',count:selected.length};
}
module.exports={personalCalendar,fold};
