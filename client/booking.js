import {isBookingActivity,isValidBookingActivity} from '../shared/booking-activities';
import {appCache} from './cache';
let base='https://sysu-phy-club-book.folderrewind.top';
export const bookingPage='https://sps-club-schedule.github.io/sysu-phy-club-booking/';
export const configureBooking=value=>{if(value)base=value.replace(/\/$/,'');};
export function cachedActivities(){const saved=appCache?.readBooking(base);return saved?{...saved,activities:saved.activities.filter(isValidBookingActivity)}:null;}
export async function otherActivities({includeSchedule=false}={}) {
  const origin=base;
  if(typeof navigator!=='undefined'&&navigator.onLine===false)throw new Error('网络已断开，联网后更新预约');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
  try {
  const response=await fetch(origin+'/api/activities',{cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',signal:controller.signal});
  if (!response.ok) throw new Error('预约活动暂时无法更新');
  const result=await response.json();
  if (!Array.isArray(result.activities) || !result.from || !result.to) throw new Error('活动日历返回异常');
  const data={activities:result.activities.filter(isValidBookingActivity),from:result.from,to:result.to};
  appCache?.writeBooking(origin,data);
  return {...data,activities:data.activities.filter(includeSchedule?isValidBookingActivity:isBookingActivity),checkedAt:Date.now(),cached:false};
  } catch {throw new Error('预约活动暂时无法更新');}
  finally {clearTimeout(timer);}
}

// GitHub Pages hosts both sites on the same origin. In a normal tab the code
// travels through tab-scoped storage, leaving browser history free of credentials.
export async function enterBooking(issue) {
  let grant;
  try { grant = await issue(); }
  catch (error) {
    if (error.code !== 'FORBIDDEN') throw error;
    return bookingLink('当前日程账号没有 SPS 预约权限。','使用预约网站账号',bookingPage);
  }
  const {code} = grant;
  if (!/^[a-f0-9]{64}$/.test(code)) throw new Error('无法取得预约登录凭证，请重试');
  if (!window.SPSNative && location.origin === new URL(bookingPage).origin) {
    sessionStorage.setItem('sps-to-booking-v1', code);
    location.assign(bookingPage + '#from-sps');
    return;
  }
  // An Android external browser has its own storage. A real link tap opens it,
  // and the destination shows the server-confirmed username before switching.
  bookingLink('已取得日程登录凭证。','进入预约网站',bookingPage+'#sps-entry='+code);
}

function bookingLink(message,label,url) {
  const dialog=document.createElement('dialog'), link=document.createElement('a'), back=document.createElement('button');
  const text=document.createElement('p'); text.textContent=message;
  link.className='primary'; link.textContent=label; link.rel='noreferrer'; link.href=url;
  link.addEventListener('click',()=>setTimeout(()=>dialog.close(),0),{once:true});
  back.type='button'; back.textContent='取消'; back.onclick=()=>dialog.close();
  dialog.append(text,link,back); document.body.append(dialog);
  dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.showModal();
}
