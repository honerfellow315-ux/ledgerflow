/** London time automatically follows GMT/BST, independent of the device timezone. */
export function ukClock(now: Date) {
  const timeZone = "Europe/London";
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hourCycle: "h23" }).format(now),
  );
  return {
    greeting: hour < 12 ? "Good morning," : hour < 18 ? "Good afternoon," : "Good evening,",
    date: new Intl.DateTimeFormat("en-GB", {
      timeZone,
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(now),
    time: new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZoneName: "short",
      hourCycle: "h23",
    }).format(now),
  };
}
