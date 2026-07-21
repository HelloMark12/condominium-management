/**
 * Malta timezone utilities — Module 2
 *
 * Provides explicit Europe/Malta timezone conversion for the scheduling UI.
 * Regardless of the administrator's browser/device timezone, scheduled times
 * are always interpreted and displayed as Europe/Malta (CET/CEST).
 *
 * Malta observes:
 *   - CET  (UTC+1) in winter (last Sunday in October → last Sunday in March)
 *   - CEST (UTC+2) in summer (last Sunday in March   → last Sunday in October)
 */

/**
 * Converts a datetime-local input string ("YYYY-MM-DDTHH:mm") that the
 * administrator intended as Europe/Malta local time into a UTC Date.
 *
 * Returns null when:
 *   - The string format is invalid
 *   - The local time falls in a DST gap (e.g. 02:30 on the spring-forward night)
 *
 * The algorithm tries both possible Malta UTC offsets (+1 and +2), formats the
 * candidate UTC timestamp back into Malta local time using Intl, and accepts
 * whichever candidate reproduces the original input exactly.  This correctly
 *  handles DST transitions without relying on hardcoded offset tables.
 */
export function maltaLocalToUtc(localStr: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(localStr);
  if (!match) return null;

  const [, ys, ms, ds, hs, mins] = match;
  const y = Number(ys);
  const mo = Number(ms);
  const d = Number(ds);
  const h = Number(hs);
  const mi = Number(mins);

  const fmt = new Intl.DateTimeFormat("en", {
    timeZone: "Europe/Malta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  // Malta is at most UTC+2 (summer) and at least UTC+1 (winter).
  // Try both possible UTC offsets.
  for (const offsetHours of [2, 1]) {
    const utcMs = Date.UTC(y, mo - 1, d, h - offsetHours, mi);
    const candidate = new Date(utcMs);

    const parts = fmt.formatToParts(candidate);
    const get = (type: string) =>
      parts.find((p) => p.type === type)?.value ?? "";

    // normalise "24" → 0 (some Intl implementations return 24 for midnight)
    const fHour = Number(get("hour")) % 24;
    const fMinute = Number(get("minute"));
    const fDay = Number(get("day"));
    const fMonth = Number(get("month"));
    const fYear = Number(get("year"));

    if (
      fYear === y &&
      fMonth === mo &&
      fDay === d &&
      fHour === h &&
      fMinute === mi
    ) {
      return candidate;
    }
  }

  // No valid offset found — the time is in a DST gap (nonexistent local time)
  return null;
}

/**
 * Formats a UTC Date as a human-readable Europe/Malta local time string
 * including the UTC offset, e.g. "15 Mar 2024, 14:30 (GMT+2, Malta time)".
 */
export function formatMaltaTime(utcDate: Date): string {
  const localStr = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Malta",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(utcDate);

  const offsetStr = new Intl.DateTimeFormat("en", {
    timeZone: "Europe/Malta",
    timeZoneName: "shortOffset",
  })
    .formatToParts(utcDate)
    .find((p) => p.type === "timeZoneName")?.value ?? "Malta time";

  return `${localStr} (${offsetStr}, Malta time)`;
}
