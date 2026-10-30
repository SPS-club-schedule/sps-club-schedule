import {isBookingActivity} from '../shared/booking-activities';
let base='https://sysu-phy-club-book.folderrewind.top';
export const bookingPage='https://sps-club-schedule.github.io/sysu-phy-club-booking/';
export const configureBooking=value=>{if(value)base=value.replace(/\/$/,'');};
export async function otherActivities() {
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
  try {
  const response=await fetch(base+'/api/activities',{cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',signal:controller.signal});
  if (!response.ok) throw new Error('预约活动暂时无法更新');
  const result=await response.json();
  if (!Array.isArray(result.activities) || !result.from || !result.to) throw new Error('活动日历返回异常');
  return {...result,activities:result.activities.filter(isBookingActivity)};
  } catch {throw new Error('预约活动暂时无法更新');}
  finally {clearTimeout(timer);}
}
