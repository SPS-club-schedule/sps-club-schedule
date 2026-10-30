'use strict';
// The booking service gives schedule-generated daily blocks this reserved ID.
// Its public activity feed preserves IDs but does not include source metadata.
// Manual SPS bookings have ordinary booking IDs and must remain visible.
function isScheduleBooking(activity) {
  return activity?.source==='sps-schedule'||/^sps:(?:t_|tg_)[a-f0-9]{32}:\d{4}-\d{2}-\d{2}$/.test(activity?.id||'');
}
function isBookingActivity(activity) {
  return !!activity&&!isScheduleBooking(activity)&&typeof activity.club==='string'&&typeof activity.title==='string'&&
    Number.isSafeInteger(activity.startsAt)&&Number.isSafeInteger(activity.endsAt)&&activity.endsAt>activity.startsAt;
}
module.exports={isScheduleBooking,isBookingActivity};
