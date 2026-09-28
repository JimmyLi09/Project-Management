import type { LocalDate } from './schedule'

/**
 * 新加坡 gazetted public holidays（MOM 公布 + 落在周日的顺延周一）。
 * 周六的 PH 补假各公司政策不同，不在此列。
 * 每年中 MOM 公布后在这里追加即可，未知年份返回 null。
 */
const SG_PUBLIC_HOLIDAYS: Record<string, string> = {
  // ---- 2025（MOM 2024-08-05 gazette，共 11 天）----
  '2025-01-01': "New Year's Day",
  '2025-01-29': 'Chinese New Year',
  '2025-01-30': 'Chinese New Year',
  '2025-03-31': 'Hari Raya Puasa',
  '2025-04-18': 'Good Friday',
  '2025-05-01': 'Labour Day',
  '2025-05-12': 'Vesak Day',
  '2025-06-07': 'Hari Raya Haji',
  '2025-08-09': 'National Day',
  '2025-10-20': 'Deepavali',
  '2025-12-25': 'Christmas Day',
  // ---- 2026（MOM gazette + 3 个周日顺延周一）----
  '2026-01-01': "New Year's Day",
  '2026-02-17': 'Chinese New Year',
  '2026-02-18': 'Chinese New Year',
  '2026-03-21': 'Hari Raya Puasa',
  '2026-04-03': 'Good Friday',
  '2026-05-01': 'Labour Day',
  '2026-05-27': 'Hari Raya Haji',
  '2026-05-31': 'Vesak Day',
  '2026-06-01': 'Vesak Day (in lieu)',
  '2026-08-09': 'National Day',
  '2026-08-10': 'National Day (in lieu)',
  '2026-11-08': 'Deepavali',
  '2026-11-09': 'Deepavali (in lieu)',
  '2026-12-25': 'Christmas Day',
  // ---- 2027（MOM 2026-06-18 gazette + 周日顺延周一）----
  '2027-01-01': "New Year's Day",
  '2027-02-06': 'Chinese New Year',
  '2027-02-07': 'Chinese New Year',
  '2027-02-08': 'Chinese New Year (in lieu)',
  '2027-03-10': 'Hari Raya Puasa',
  '2027-03-26': 'Good Friday',
  '2027-05-01': 'Labour Day',
  '2027-05-17': 'Hari Raya Haji',
  '2027-05-20': 'Vesak Day',
  '2027-08-09': 'National Day',
  '2027-10-28': 'Deepavali',
  '2027-12-25': 'Christmas Day'
}

/** 返回假日英文名，不是假日返回 null */
export function getPublicHoliday(date: LocalDate): string | null {
  return SG_PUBLIC_HOLIDAYS[date] ?? null
}

export function isPublicHoliday(date: LocalDate): boolean {
  return getPublicHoliday(date) !== null
}
