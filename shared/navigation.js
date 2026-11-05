'use strict';
function authDestination(value) {
  if(value==='experience')return '/experience';
  try {
    const url=new URL(value,'https://local.invalid');
    if(url.origin!=='https://local.invalid')return '';
    if(['/simple','/mine','/board','/calendar','/experience'].includes(url.pathname))return url.pathname;
    if(url.pathname==='/task'&&/^[a-zA-Z0-9_-]{1,120}$/.test(url.searchParams.get('id')||'')&&/^[a-zA-Z0-9_-]{1,120}$/.test(url.searchParams.get('club')||''))return '/task?id='+encodeURIComponent(url.searchParams.get('id'))+'&club='+encodeURIComponent(url.searchParams.get('club'));
  }catch{}
  return '';
}
function loginRedirect(path,authenticated) {
  const page=new URL(path,'https://local.invalid').pathname;
  if(authenticated||['/simple','/auth','/reset','/experience'].includes(page))return '';
  const next=authDestination(path)||'/mine';
  return '/auth?next='+encodeURIComponent(next);
}
module.exports={authDestination,loginRedirect};
