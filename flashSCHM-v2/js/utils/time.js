/** Single-day domain: integer minutes 0..1439; boundaries never wrap implicitly. */
export function parseTime(value) {
  if (Number.isInteger(value) && value >= 0 && value < 1440) return value;
  if (typeof value !== "string" || !/^\d{2}:\d{2}$/.test(value))
    throw new RangeError("invalid-time");
  const [h, m] = value.split(":").map(Number);
  if (h > 23 || m > 59) throw new RangeError("invalid-time");
  return h * 60 + m;
}
export function formatTime(minutes) {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1440)
    throw new RangeError("invalid-time");
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}
export const addMinutes = (time, minutes) => time + minutes;
export const subtractMinutes = (time, minutes) => time - minutes;
export const roundToFiveMinutes = (minutes) => Math.round(minutes / 5) * 5;
export const overlaps = (a, b) => a.start < b.end && b.start < a.end;
export const arrivalTime = (actor) =>
  actor.schedule?.length
    ? Math.min(...actor.schedule.map((t) => t.start))
    : actor.ready;
