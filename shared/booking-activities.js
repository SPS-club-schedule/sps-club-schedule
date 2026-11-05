'use strict';
// The booking service gives schedule-generated daily blocks this reserved ID.
// Its public activity feed preserves IDs but does not include source metadata.
// Manual SPS bookings have ordinary booking IDs and must remain visible.
function bookingTaskId(activity) {
  return /^sps:((?:t_|tg_)[a-f0-9]{32}):\d{4}-\d{2}-\d{2}$/.exec(activity?.id||'')?.[1]||null;
}
function isScheduleBooking(activity) {
  return activity?.source==='sps-schedule'||!!bookingTaskId(activity);
}
function isValidBookingActivity(activity) {
  return !!activity&&typeof activity.club==='string'&&typeof activity.title==='string'&&
    Number.isSafeInteger(activity.startsAt)&&Number.isSafeInteger(activity.endsAt)&&activity.endsAt>activity.startsAt;
}
const isBookingActivity=activity=>isValidBookingActivity(activity)&&!isScheduleBooking(activity);
module.exports={bookingTaskId,isScheduleBooking,isValidBookingActivity,isBookingActivity};
