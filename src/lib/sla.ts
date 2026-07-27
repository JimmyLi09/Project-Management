/* ===== SLA working-day calculation (v2.2 §8) =====
   Working day = not Saturday/Sunday and not a Singapore public holiday.
   All calculations use the Asia/Singapore (UTC+8) calendar date, independent
   of the server's local timezone. 1A only needs "weekends + SG public
   holidays"; company rest days / ad-hoc leave are deferred to v2. */

/* Singapore public holidays — observed dates (holidays falling on Sunday are
   observed the following Monday, which is what MOM gazettes). Maintained here
   as a simple config; refresh once a year from MOM / data.gov.sg.
   §8.1 seeds 2026 (11 days). */
export const SG_PUBLIC_HOLIDAYS: Record<string, string> = {
  // 2026 (observed)
  '2026-01-01': "New Year's Day",
  '2026-02-17': 'Chinese New Year',
  '2026-02-18': 'Chinese New Year',
  '2026-04-03': 'Good Friday',
  '2026-05-01': 'Labour Day',
  '2026-05-27': 'Hari Raya Puasa',
  '2026-05-31': 'Vesak Day', // falls Sun 31 May; observed Mon 1 Jun
  '2026-06-01': 'Vesak Day (observed)',
  '2026-08-04': 'Hari Raya Haji',
  '2026-08-09': 'National Day', // Sun; observed Mon 10 Aug
  '2026-08-10': 'National Day (observed)',
  '2026-11-08': 'Deepavali', // Sun; observed Mon 9 Nov
  '2026-11-09': 'Deepavali (observed)',
  '2026-12-25': 'Christmas Day',
};

/* the Asia/Singapore calendar date (YYYY-MM-DD) for a given instant */
export function sgDateKey(d: Date): string {
  // en-CA yields YYYY-MM-DD; timeZone pins it to Singapore regardless of server
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/* day of week in Singapore (0=Sun … 6=Sat) */
function sgDow(d: Date): number {
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Singapore', weekday: 'short' }).format(d);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(wd);
}

export function isSgHoliday(d: Date): boolean {
  return !!SG_PUBLIC_HOLIDAYS[sgDateKey(d)];
}

export function isWorkingDay(d: Date): boolean {
  const dow = sgDow(d);
  if (dow === 0 || dow === 6) return false; // weekend
  return !isSgHoliday(d);
}

/* add N Singapore working days to a start instant, returning the due Date.
   N=0 returns the start day itself (rolled forward to the next working day if
   it lands on a weekend/holiday). Steps one calendar day at a time. */
export function addWorkingDays(start: Date, n: number): Date {
  const cur = new Date(start.getTime());
  // normalise to noon SGT-ish to avoid DST/edge issues (SG has no DST)
  let counted = 0;
  // if start itself isn't a working day, roll forward to the first working day
  while (!isWorkingDay(cur)) cur.setUTCDate(cur.getUTCDate() + 1);
  while (counted < n) {
    cur.setUTCDate(cur.getUTCDate() + 1);
    if (isWorkingDay(cur)) counted++;
  }
  return cur;
}

/* count working days between two instants (exclusive of start, inclusive of
   end) — used to tell whether an SLA has been breached */
export function workingDaysBetween(from: Date, to: Date): number {
  if (to <= from) return 0;
  const cur = new Date(from.getTime());
  let n = 0;
  while (true) {
    cur.setUTCDate(cur.getUTCDate() + 1);
    if (cur > to) break;
    if (isWorkingDay(cur)) n++;
  }
  return n;
}
