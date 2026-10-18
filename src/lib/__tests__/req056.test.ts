/* REQ-056 · 排期导出「月历」「甘特」的排版数:哪几个月、每周的色条、节假日、关键日期、甘特周列和位置 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ganttLine, ganttPos, ganttWeeks, holidayOf, keyDates, monthTitle, monthWeeks, monthsOf, spanLabel, spanOf,
  stagesInMonth, weekSegments, weekdayMon, dayMon, type ExpStage,
} from '../schedExport.ts';

/* 173-Elite Park Avenue(样板):6 个阶段,Oct 14 → Dec 29, 2026 */
const st = (no: number, start: string | null, end: string | null, status = 'todo'): ExpStage =>
  ({ no, name: `S${no}`, star: no <= 3, start: start as never, end: end as never, status });
const ELITE = [
  st(1, '2026-10-14', '2026-10-20', 'wip'),
  st(2, '2026-10-21', '2026-11-04'),
  st(3, '2026-11-05', '2026-11-24'),
  st(4, '2026-11-25', '2026-12-08'),
  st(5, '2026-12-09', '2026-12-21'),
  st(6, '2026-12-22', '2026-12-29'),
];

test('REQ-056 · 工期:Oct 14 → Dec 29, 2026 · 77 天 = 11 周;月历出 Oct / Nov / Dec 三页', () => {
  const sp = spanOf(ELITE)!;
  assert.deepEqual([sp.start, sp.end, sp.days, sp.weeks], ['2026-10-14', '2026-12-29', 77, 11]);
  assert.equal(spanLabel(sp.start, sp.end), 'Oct 14 → Dec 29, 2026');
  assert.deepEqual(monthsOf(ELITE), [{ year: 2026, month: 10 }, { year: 2026, month: 11 }, { year: 2026, month: 12 }]);
  assert.deepEqual([monthTitle(2026, 10, false), monthTitle(2026, 10, true)], ['October 2026', '2026 年 10 月']);
  assert.equal(spanLabel('2026-12-22' as never, '2027-01-08' as never), 'Dec 22, 2026 → Jan 8, 2027', '跨年两边都写年份');
});

test('REQ-056 · 月历格子:周一到周日,只排这个月用到的那几周', () => {
  const oct = monthWeeks(2026, 10);
  assert.equal(oct.length, 5);
  assert.deepEqual([oct[0][0], oct[0][6], oct[4][6]], ['2026-09-28', '2026-10-04', '2026-11-01']);
  assert.equal(monthWeeks(2026, 11).length, 6, '11 月 1 号是周日、30 号是周一 → 6 行');
  assert.equal(weekdayMon('2026-10-12' as never), 0);
  assert.equal(weekdayMon('2026-10-18' as never), 6);
});

test('REQ-056 · 每周的色条:从哪天到哪天、阶段开始那段左边有竖线、月外的日子不画', () => {
  const w = monthWeeks(2026, 10)[3];   // Oct 19 – 25
  const segs = weekSegments(w, ELITE);
  assert.deepEqual(segs.map((x) => [x.stage.no, x.from, x.to, x.lane, x.isStart]), [[1, 0, 1, 0, false], [2, 2, 6, 0, true]]);
  /* 10 月最后一行 Oct 26 – Nov 1:10 月那页只画到 31 号,11 月那页只画 1 号 */
  const last = monthWeeks(2026, 10)[4];
  assert.deepEqual(weekSegments(last, ELITE, ['2026-10-26' as never, '2026-10-31' as never]).map((x) => [x.stage.no, x.from, x.to]), [[2, 0, 5]]);
  assert.deepEqual(weekSegments(last, ELITE, ['2026-11-01' as never, '2026-11-01' as never]).map((x) => [x.stage.no, x.from, x.to]), [[2, 6, 6]]);
  /* 日期重叠的两段分到两行 */
  const overlap = [st(1, '2026-10-19', '2026-10-23'), st(2, '2026-10-21', '2026-10-25')];
  assert.deepEqual(weekSegments(w, overlap).map((x) => x.lane), [0, 1]);
  /* 没有日期的阶段不画 */
  assert.deepEqual(weekSegments(w, [st(1, null, null)]), []);
});

test('REQ-056 · 节假日(和平台排期日历同一份)、关键日期(每段开始 + 最后交付)、本月阶段', () => {
  assert.equal(holidayOf('2026-12-25' as never), 'Christmas Day');
  assert.equal(holidayOf('2026-12-24' as never), null);
  const k = keyDates(ELITE);
  assert.deepEqual([...k.starts], ['2026-10-14', '2026-10-21', '2026-11-05', '2026-11-25', '2026-12-09', '2026-12-22']);
  assert.equal(k.end, '2026-12-29');
  assert.deepEqual(stagesInMonth(ELITE, 2026, 10).map((x) => x.no), [1, 2]);
  assert.deepEqual(stagesInMonth(ELITE, 2026, 11).map((x) => x.no), [2, 3, 4]);
  assert.deepEqual(stagesInMonth(ELITE, 2026, 12).map((x) => x.no), [4, 5, 6]);
});

test('REQ-056 · 甘特:每格一周、周一开始,从 12 Oct 到 28 Dec;色条和交付红线的位置对得上日期', () => {
  const wk = ganttWeeks(ELITE);
  assert.equal(wk.length, 12);
  assert.deepEqual([wk[0], wk[11]].map((d) => dayMon(d)), ['12 Oct', '28 Dec']);
  const n = wk.length, total = n * 7;
  const p1 = ganttPos(wk[0], n, ELITE[0].start!, ELITE[0].end!);
  assert.ok(Math.abs(p1.left - (2 / total) * 100) < 1e-9 && Math.abs(p1.width - (7 / total) * 100) < 1e-9, '第 1 段从 14 Oct(第 3 天)开始,7 天');
  const p6 = ganttPos(wk[0], n, ELITE[5].start!, ELITE[5].end!);
  assert.ok(Math.abs(p6.left + p6.width - (79 / total) * 100) < 1e-9, '最后一段在 29 Dec 那天结束');
  assert.ok(Math.abs(ganttLine(wk[0], n, '2026-12-29' as never) - (78.5 / total) * 100) < 1e-9, '红线画在 29 Dec 那一天的中间');
  assert.deepEqual(ganttWeeks([st(1, null, null)]), [], '一个日期都没有就不画');
});
