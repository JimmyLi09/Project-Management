import { useEffect, useRef, useState } from 'react'

import { buildMonthGrid, formatDisplayDate, formatMonthHeading, monthFromDate, shiftMonth, todayLocalDate, type MonthCursor } from '../domain/calendar'
import { isWorkingDay, nonWorkingReason } from '../domain/duration'
import type { LocalDate } from '../domain/schedule'
import { useLang } from '@/lib/i18n'

/* ===== REQ-046 · 右侧阶段行的日期框 =====
   点开是一个小月历(勾了 Exclude Holidays 时周末和公众假期置灰,仍然能选),也可以直接输入:
   2026-09-27 / 2026/9/27 / Sep 27, 2026 / 27 Sep 2026 都认。原生 <input type="date"> 没法把
   周末置灰,所以自己画。 */

const pad = (n: number) => String(n).padStart(2, '0')
const toLocal = (d: Date): LocalDate => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` as LocalDate

export function parseTypedDate(text: string): LocalDate | null {
  const s = text.trim()
  if (!s) return null
  const iso = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s)
  if (iso) {
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), 12)
    return d.getMonth() === Number(iso[2]) - 1 && d.getDate() === Number(iso[3]) ? toLocal(d) : null
  }
  if (!/[a-z]/i.test(s)) return null   // 「27/9」这种不猜日月顺序
  const t = Date.parse(s.replace(/(\d)(st|nd|rd|th)\b/gi, '$1'))
  return Number.isFinite(t) ? toLocal(new Date(t)) : null
}

const WEEK_ZH = ['一', '二', '三', '四', '五', '六', '日']
const WEEK_EN = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

export function DateField({
  value, onPick, excludeHolidays, highlight, disabled, placeholder, label, testid, focusMonth,
}: {
  value: LocalDate | null
  onPick: (date: LocalDate) => void
  excludeHolidays: boolean
  highlight?: boolean          // 阶段 01 还没选开始日:高亮
  disabled?: boolean
  placeholder?: string
  label: string
  testid: string
  focusMonth?: LocalDate | null   // 没有值时小日历打开到哪个月
}) {
  const { lang, t } = useLang()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState<string | null>(null)
  const [cursor, setCursor] = useState<MonthCursor>(() => monthFromDate(value ?? focusMonth ?? todayLocalDate()))
  const box = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    setCursor(monthFromDate(value ?? focusMonth ?? todayLocalDate()))
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const commitText = () => {
    if (text === null) return
    const d = parseTypedDate(text)
    setText(null)
    if (d && d !== value) onPick(d)
  }
  const pick = (d: LocalDate) => { setOpen(false); setText(null); if (d !== value) onPick(d) }

  return (
    <span className="date-field" ref={box}>
      <input
        aria-label={label}
        className={`date-field-input${highlight ? ' date-field-need' : ''}`}
        data-testid={testid}
        disabled={disabled}
        onBlur={commitText}
        onChange={(e) => setText(e.target.value)}
        onFocus={() => !disabled && setOpen(true)}
        onClick={() => !disabled && setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commitText(); setOpen(false) }
          if (e.key === 'Escape') { setText(null); setOpen(false) }
        }}
        placeholder={placeholder}
        type="text"
        value={text ?? (value ? formatDisplayDate(value) : '')}
      />
      {open && !disabled && (
        <div className="date-pop" data-testid={`${testid}-pop`} role="dialog" aria-label={label}>
          <div className="date-pop-head">
            <button type="button" className="date-pop-nav" onClick={() => setCursor(shiftMonth(cursor, -1))} aria-label={t('上个月', 'Previous month')}>‹</button>
            <b>{formatMonthHeading(cursor)}</b>
            <button type="button" className="date-pop-nav" onClick={() => setCursor(shiftMonth(cursor, 1))} aria-label={t('下个月', 'Next month')}>›</button>
          </div>
          <div className="date-pop-grid">
            {(lang === 'zh' ? WEEK_ZH : WEEK_EN).map((w, i) => <span key={i} className="date-pop-wd">{w}</span>)}
            {buildMonthGrid(cursor).map((day) => {
              const off = excludeHolidays && !isWorkingDay(day.date)
              const why = off ? nonWorkingReason(day.date, lang) : null
              return (
                <button
                  key={day.date}
                  type="button"
                  data-date-pick={day.date}
                  className={[
                    'date-pop-day',
                    day.isCurrentMonth ? '' : 'date-pop-other',
                    off ? 'date-pop-off' : '',
                    day.date === value ? 'date-pop-sel' : '',
                    day.isToday ? 'date-pop-today' : '',
                  ].filter(Boolean).join(' ')}
                  title={why ?? undefined}
                  onClick={() => pick(day.date)}
                >
                  {day.day}
                </button>
              )
            })}
          </div>
          {excludeHolidays && <div className="date-pop-foot">{t('灰色 = 周末 / 公众假期（仍可选）', 'Grey = weekend / public holiday (still selectable)')}</div>}
        </div>
      )}
    </span>
  )
}
