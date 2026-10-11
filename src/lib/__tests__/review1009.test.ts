import test from 'node:test';
import assert from 'node:assert/strict';
import { isoDate, migrate, newProject, parseISO, planDates } from '../project.ts';
import { calendarFromRows, rowsFromCalendar } from '../scheduleSync.ts';
import { migrateProject048 } from '../mig048.ts';
import { migrateProject049 } from '../mig049.ts';
import { migrateProject050 } from '../mig050.ts';
import { blankRow } from '../jobRecord.ts';
import { applyAction } from '../../server/actions.ts';
import { getBuiltinTemplate } from '../templates.ts';
import type { Project, ScheduleRow } from '../types.ts';

/* 1009 批上线前复查补的回归测试。服务器 / 浏览器在新加坡、马来西亚 = UTC+8 */
process.env.TZ = 'Asia/Singapore';
const PD = { name: 'PD', role: 'director' } as never;
const act = (p: Project, a: unknown) => applyAction(PD, p, a as never, { tplForSvc: getBuiltinTemplate });
const row = (task: string, extra: Partial<ScheduleRow> = {}): ScheduleRow =>
  ({ id: 'r' + task.length + Math.random().toString(36).slice(2, 6), no: '', phase: '', task, taskEn: '', owner: '', assignee: '', weeks: 1, typical: '', gate: '', freeze: false, status: 'todo', note: '', s: '', e: '', ...extra });

test('UTC+8:日期来回换不差一天;开 Invoice 的日期校验通过', () => {
  assert.equal(new Date(2026, 9, 10).getTimezoneOffset(), -480, '这个测试要跑在 UTC+8');
  assert.equal(isoDate(parseISO('2026-10-10')!), '2026-10-10');
  assert.equal(isoDate(new Date(2026, 9, 10, 0, 30)), '2026-10-10', '凌晨也是当天(以前 toISOString 给的是前一天)');
  const p = migrate(newProject({ name: 'Inv', client: 'C', services: ['cgi'], start: '2026-10-01' } as never));
  act(p, { type: 'markInvoiced', invoiceRef: 'INV-1', issuedDate: '2026-10-10' });
  assert.equal(p.invoiceClose!.issuedDate, '2026-10-10');
});

test('写坏的排期日期:读项目 / 048 迁移不抛错(当作没填);再写坏的日期被拒', () => {
  assert.equal(parseISO('2025-6-1'), null);
  assert.equal(parseISO('TBC'), null);
  const p = newProject({ name: 'Bad', client: 'C', services: ['cgi'], start: '2026-09-01' } as never);
  const pk = p.packages[0];
  pk.schedule[1].s = '2025/06/01';
  pk.schedule[1].e = 'TBC';
  delete pk.calendar;
  assert.doesNotThrow(() => planDates(pk, '2026-09-01'));
  const o = JSON.parse(JSON.stringify(p));
  assert.doesNotThrow(() => migrateProject048(o, Date.now(), () => Math.random().toString(36).slice(2)));
  assert.ok(o.packages[0].calendar.stages.length);
  const q = JSON.parse(JSON.stringify(p));
  assert.doesNotThrow(() => migrate(q));
  assert.throws(() => act(p, { type: 'editSched', pkg: 0, idx: 0, field: 's', value: '2026-13-01' }), /日期格式/);
  act(p, { type: 'editSched', pkg: 0, idx: 0, field: 's', value: '2026-10-05' });
  act(p, { type: 'editSched', pkg: 0, idx: 0, field: 's', value: '' });
  assert.equal(p.packages[0].schedule[0].s, '');
});

test('经典模式写的长阶段名 / 长备注:日历截短的那段没改过就留行上的全文,改过就用新的', () => {
  const long = '建模'.repeat(40);          // 80 个字,日历上限 60
  const note = '备注'.repeat(150);         // 300 个字,日历上限 200
  const rows = [row(long, { note }), row('渲染')];
  const { calendar } = calendarFromRows(rows, [null, null], { by: '', at: 1 });
  assert.equal(calendar.stages[0].name.length, 60);
  const cal = { ...calendar, stages: calendar.stages.map((s) => ({ ...s, note: (s.note || '').slice(0, 200) })) };
  const back = rowsFromCalendar(rows, cal).rows;
  assert.equal(back[0].task, long);
  assert.equal(back[0].note, note);
  cal.stages[0] = { ...cal.stages[0], name: '只做建模' };
  assert.equal(rowsFromCalendar(rows, cal).rows[0].task, '只做建模', '在日历上改过名就用改过的');
});

test('049:迁移前存下的只是兜底空白行 → 旧字段照样转;有人填过的不动', () => {
  const p = newProject({ name: 'J', client: 'C', services: ['scale'], start: '' } as never);
  delete (p as { mig049?: unknown }).mig049;
  p.jobRecord = [blankRow('scale')];
  p.packages[0].record = { scaleRatio: '1:100' };
  const got = migrateProject049(p, () => [], 1);
  assert.equal(got?.rows, 1);
  assert.ok(p.jobRecord.some((r) => r.qty === '1:100' || r.note === '1:100'), '旧字段转成了一行');
  const q = newProject({ name: 'K', client: 'C', services: ['scale'], start: '' } as never);
  delete (q as { mig049?: unknown }).mig049;
  q.jobRecord = [{ ...blankRow('scale'), detail: '上线后录的' }];
  q.packages[0].record = { scaleRatio: '1:100' };
  assert.equal(migrateProject049(q, () => [], 1), null);
  assert.equal(q.jobRecord.length, 1);
  /* 新建的项目:只有空白行、也没有旧字段 → 不动,报告里不列 */
  const n = newProject({ name: 'N', client: 'C', services: ['cgi', 'ani'], start: '' } as never);
  delete (n as { mig049?: unknown }).mig049;
  const before = JSON.stringify(n.jobRecord);
  assert.equal(migrateProject049(n, () => [], 1), null);
  assert.equal(JSON.stringify(n.jobRecord), before);
});

test('050:迁移前就有分格的项 → 这个项目不自动合并(不盖掉格里的内容),报告里列为问题', () => {
  const p = newProject({ name: 'Pre', client: 'C', services: ['led', 'led'], start: '' } as never);
  delete (p as { mig050?: unknown }).mig050;
  const items = p.checklist!.flatMap((g) => g.items);
  const size = items.find((x) => x.cells)!;
  const k2 = p.packages[1].id!;
  size.cells![k2].remark = '格里的内容';
  p.checklist![0].items.push({ ...items[0], id: 'x2', zh: items[0].zh + '(#2)', inst: '#2', svcs: ['led'], cells: undefined });
  const m = migrateProject050(p);
  assert.ok(m && m.problems[0].includes('没有自动合并'));
  assert.equal(size.cells![k2].remark, '格里的内容');
  assert.ok(p.checklist!.flatMap((g) => g.items).some((x) => x.id === 'x2'), '(#2) 项原样留着');
});

import { csvCell, csvUnguard } from '../csv.ts';

test('日历写回阶段行:特殊行跟着它前面那个阶段,不沉到最后;最前面的还在最前面', () => {
  const rows = [row('top', { kind: 'holiday' } as never), row('A'), row('CNY', { kind: 'holiday' } as never), row('B'), row('gate', { kind: 'milestone' } as never), row('C')];
  const stageRows = rows.filter((r) => !r.kind);
  const cal = { stages: stageRows.map((r) => ({ id: r.id!, name: r.task, tone: 'coral' })), boundaries: ['2026-10-01', '2026-10-05', '2026-10-10', '2026-10-15'] };
  assert.deepEqual(rowsFromCalendar(rows, cal).rows.map((r) => r.task), ['top', 'A', 'CNY', 'B', 'gate', 'C']);
  /* 删掉 B:B 后面的里程碑跟着 A(更前面一个还在的) */
  const cal2 = { stages: [cal.stages[0], cal.stages[2]], boundaries: ['2026-10-01', '2026-10-05', '2026-10-15'] };
  assert.deepEqual(rowsFromCalendar(rows, cal2).rows.map((r) => r.task), ['top', 'A', 'CNY', 'gate', 'C']);
});

test('CSV:开头是 = + - @ 的垫 \',Excel 不当公式;普通数字不垫;导回来去掉', () => {
  assert.equal(csvCell('- 项目一'), `"'- 项目一"`);
  assert.equal(csvCell('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
  assert.equal(csvCell('-5'), '"-5"');
  assert.equal(csvCell('2'), '"2"');
  assert.equal(csvUnguard("'- 项目一"), '- 项目一');
  assert.equal(csvUnguard("'普通"), "'普通", '不是垫的 \' 不去');
});
