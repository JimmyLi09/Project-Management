import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPackage, newProject, pkgStart, planDates } from '../project.ts';
import { calendarFromRows, defaultUnits, rowsFromCalendar } from '../scheduleSync.ts';
import { isLegacyFlow } from '../legacyStages.ts';
import { TPL } from '../templates.ts';
import type { ScheduleRow } from '../types.ts';

const row = (id: string, task: string, weeks: number, extra: Partial<ScheduleRow> = {}): ScheduleRow => ({
  id, no: id, phase: '', task, taskEn: task + ' en', owner: '', assignee: '', weeks, typical: '', gate: ' ', freeze: false,
  status: 'todo', note: '', s: '', e: '', ...extra,
});

test('REQ-048 新默认阶段:效果图 3 × 2 周,动画 1 / 2 / 1 / 2 / 1 周,中英文名', () => {
  assert.deepEqual(TPL.cgi.schedule.map((r) => r[5]), [2, 2, 2]);
  assert.deepEqual(TPL.ani.schedule.map((r) => r[5]), [1, 2, 1, 2, 1]);
  assert.ok(TPL.cgi.schedule.every((r) => r[2] && r[3]));
  assert.deepEqual(TPL.ani.schedule.map((r) => String(r[3]).split(':')[0]), ['Storyboard stage', 'Animation preview', 'Still frame stage 1', 'Still frame stage 2', 'Post production']);
});

test('REQ-048 阶段行 → 日历:顺排的行一天不差,负责人 / 状态还在行上', () => {
  const pk = buildPackage('ani', '');   // 没有开始日:行上只有周数,和上线前的老数据一样
  assert.deepEqual(pk.calendar!.boundaries, []);
  pk.schedule[1].assignee = 'Kevin';
  pk.schedule[1].status = 'wip';
  const dates = planDates(pk, '2026-10-05');
  const { calendar, adjusted, dated } = calendarFromRows(pk.schedule, dates, { by: 't', at: 1 });
  assert.ok(dated);
  assert.equal(adjusted, 0);
  assert.deepEqual(calendar.stages.map((s) => s.id), pk.schedule.map((r) => r.id));
  assert.deepEqual(calendar.boundaries, ['2026-10-05', '2026-10-11', '2026-10-25', '2026-11-01', '2026-11-15', '2026-11-22']);
  assert.equal(calendar.excludeHolidays, false, '经典排期是按日历天算的');
  /* 写回:日期变成每行的起止,负责人 / 状态原样 */
  const { rows, moved } = rowsFromCalendar(pk.schedule, calendar);
  assert.equal(moved.length, 0);
  assert.deepEqual(rows.map((r) => [r.s, r.e]), [['2026-10-05', '2026-10-11'], ['2026-10-12', '2026-10-25'], ['2026-10-26', '2026-11-01'], ['2026-11-02', '2026-11-15'], ['2026-11-16', '2026-11-22']]);
  assert.equal(rows[1].assignee, 'Kevin');
  assert.equal(rows[1].status, 'wip');
  const again = planDates({ ...pk, schedule: rows }, '2026-10-05');
  assert.deepEqual(again.map((d) => d && d.end.getDate()), dates.map((d) => d && d.end.getDate()), '读取方算出来的日期和原来一样');
});

test('REQ-048 0 周的「信息收集」占开始前 1 天;有重叠的行记为「调整过」', () => {
  const rows = [row('a', '信息收集', 0), row('b', '建模', 1), row('c', '出图', 1, { s: '2026-10-08', e: '2026-10-20' })];
  const dates = planDates({ schedule: rows } as never, '2026-10-05');
  const { calendar, adjusted, undated } = calendarFromRows(rows, dates, { by: 't', at: 1 });
  assert.deepEqual(calendar.boundaries, ['2026-10-04', '2026-10-04', '2026-10-11', '2026-10-20']);
  assert.equal(undated, 1, '「信息收集」原来没有日期');
  assert.equal(adjusted, 1, '「出图」和「建模」重叠');
});

test('REQ-048 日历上删掉的阶段:有内容的行留底,没内容的去掉;新阶段新建一行;特殊行原样', () => {
  const rows = [row('a', 'A', 1, { assignee: 'X' }), row('b', 'B', 1), row('m', '里程碑', 0, { kind: 'milestone' })];
  const cal = { stages: [{ id: 'n', name: 'New', tone: 'coral', weeks: 2 }], boundaries: ['2026-10-01', '2026-10-14'] };
  const { rows: out, moved } = rowsFromCalendar(rows, cal);
  assert.deepEqual(out.map((r) => r.id), ['n', 'm']);
  assert.equal(out[0].task, 'New');
  assert.equal(out[0].s, '2026-10-01');
  assert.equal(out[0].weeks, 2);
  assert.deepEqual(moved.map((r) => r.id), ['a']);
});

test('REQ-048 新建业务就带日历,阶段 = 行;有开始日按默认工期排好(日历天)', () => {
  const p = newProject({ name: 'T', client: '', services: ['cgi', 'ani'], start: '2026-10-05' } as never);
  const cgi = p.packages[0], ani = p.packages[1];
  assert.equal(cgi.calendar!.stages.length, 3);
  assert.equal(ani.calendar!.stages.length, 5);
  assert.deepEqual(cgi.calendar!.stages.map((s) => s.id), cgi.schedule.map((r) => r.id));
  assert.equal(cgi.calendar!.excludeHolidays, false);
  assert.deepEqual(cgi.calendar!.boundaries, ['2026-10-05', '2026-10-18', '2026-11-01', '2026-11-15'], '3 段各 14 天');
  assert.deepEqual(ani.calendar!.boundaries, ['2026-10-05', '2026-10-11', '2026-10-25', '2026-11-01', '2026-11-15', '2026-11-22'], '1 / 2 / 1 / 2 / 1 周');
  assert.equal(cgi.calendar!.boundaries.length, 4);
  assert.ok(cgi.schedule.every((r) => r.s && r.e), '日期写回了行');
  assert.deepEqual(cgi.schedule.map((r) => r.weeks), [2, 2, 2]);
  assert.deepEqual(ani.schedule.map((r) => r.weeks), [1, 2, 1, 2, 1]);
  assert.equal(pkgStart(p, cgi), '2026-10-05');
});

test('REQ-048 认出老流程(改过名的不算)', () => {
  assert.ok(isLegacyFlow('cgi', ['信息收集(见信息清单)', '搭建 3D 建筑模型', '出角度草图,客户审阅(含2–3轮)', '灯光/材质渲染草图(含2–3轮)', '合成/调色/配景(含2–3轮)', '导出成品格式,客户签收']));
  assert.ok(isLegacyFlow('cgi', ['信息收集：收到模型资料（见信息清单）', '白膜角度小样', '角度 shortlist + AI 效果图，确定角度与大效果（含 1–2 轮）', '带材质、模型的后期图（参考大效果，含 2–3 轮）', '导出成品格式，客户签收']));
  assert.ok(isLegacyFlow('ani', TPL_OLD_ANI));
  assert.ok(!isLegacyFlow('cgi', TPL.cgi.schedule.map((r) => r[2])));
  assert.ok(!isLegacyFlow('ani', [...TPL_OLD_ANI.slice(0, 5), '改过的']));
  assert.ok(!isLegacyFlow('scale', TPL_OLD_ANI));
  assert.equal(defaultUnits(2, true), 10);
  assert.equal(defaultUnits(2, false), 14);
  assert.equal(defaultUnits(0, false), 1);
});

const TPL_OLD_ANI = ['确认flythrough时长/分镜/特效/音乐/字体/航拍/截止日', '确认卖点/时长/情绪板+参考/logo/音乐;与深圳对齐', '搭建 3D 模型', '线框相机路径预览审阅(含2–3轮)', '加树木/人/景观/灯光/材质(含2–3轮)', '静帧确认后出高清动画'];

import { migrateProject048 } from '../mig048.ts';
import { applyAction } from '../../server/actions.ts';

const oldProject = () => {
  const p = newProject({ name: 'Old', client: '', services: ['cgi', 'ani', 'scale'], start: '2026-09-07' } as never);
  /* 上线前的样子:没有日历,行上没写日期(按周数顺排) */
  p.packages.forEach((pk) => { delete pk.calendar; pk.schedule.forEach((r) => { r.s = ''; r.e = ''; }); });
  return p;
};

test('REQ-048 上线迁移:只有阶段行的业务生成日历,行一个字不动', () => {
  const p = oldProject();
  p.packages[0].schedule[0].assignee = 'Kevin';
  p.packages[0].schedule[0].status = 'done';
  const before = JSON.stringify(p.packages.map((pk) => pk.schedule));
  const datesBefore = p.packages.map((pk) => planDates(pk, pkgStart(p, pk)).map((d) => d && [d.start.getTime(), d.end.getTime()]));
  const got = migrateProject048(p, 1, () => 'x');
  assert.deepEqual(got.map((x) => x.kind), ['fromRows', 'fromRows', 'fromRows']);
  assert.equal(JSON.stringify(p.packages.map((pk) => pk.schedule)), before, '行没动');
  assert.deepEqual(p.packages.map((pk) => planDates(pk, pkgStart(p, pk)).map((d) => d && [d.start.getTime(), d.end.getTime()])), datesBefore, '待办 / KPI 看到的日期不变');
  assert.ok(p.packages.every((pk) => pk.calendar!.stages.length === pk.schedule.length && pk.mig048?.kind === 'fromRows'));
  assert.deepEqual(migrateProject048(p, 2, () => 'x'), [], '只跑一次');
});

test('REQ-048 上线迁移:只在日历上排过 → 用日历重写行(原行留底);两边都有 → 以行为准,原日历进存档', () => {
  const p = oldProject();
  const cal = { stages: [{ id: 'brief', name: '信息收集', tone: 'coral' }, { id: 'x', name: '建模', tone: 'peach' }], boundaries: ['2026-09-07', '2026-09-08', '2026-09-20'], version: 3, updatedAt: 1, updatedBy: 'PM' };
  p.packages[0].calendar = JSON.parse(JSON.stringify(cal));
  p.packages[1].calendar = JSON.parse(JSON.stringify(cal));
  p.packages[1].schedule[1].assignee = 'Kevin';
  const oldRows0 = JSON.parse(JSON.stringify(p.packages[0].schedule));
  const got = migrateProject048(p, 5, () => 'x');
  assert.deepEqual(got.map((x) => x.kind), ['rowsFromCal', 'conflict', 'fromRows']);
  const a = p.packages[0];
  assert.deepEqual(a.schedule.map((r) => [r.task, r.s, r.e]), [['信息收集', '2026-09-07', '2026-09-08'], ['建模', '2026-09-09', '2026-09-20']]);
  assert.deepEqual(a.mig048!.prevRows, oldRows0);
  assert.equal(a.scheduleLegacy!.length, oldRows0.length);
  const b = p.packages[1];
  assert.equal(b.schedule[1].assignee, 'Kevin', '行没动');
  assert.equal(b.calendar!.stages.length, b.schedule.length);
  assert.equal(b.calendar!.archives![0].boundaries.join(), cal.boundaries.join(), '原日历进了存档');
  assert.equal(b.mig048!.prevCalendar!.version, 3);
});

test('REQ-048 保存日历写回行;「已处理」的风险按行 id 对到新行号', () => {
  const p = newProject({ name: 'T', client: '', services: ['ani'], start: '2026-10-05' } as never);
  const pk = p.packages[0];
  const ids = pk.schedule.map((r) => r.id!);
  pk.schedule[2].assignee = 'Kevin';
  p.dismissedRisks = ['od:0:2', 'bl:0:4', 'od:1:0'];
  const st = pk.calendar!.stages;
  /* 把第 3 个阶段挪到最前面,删掉最后一个,第 2 个改成 21 天 */
  const stages = [st[2], st[0], st[1], st[3]];
  const b = ['2026-10-01', '2026-10-07', '2026-10-14', '2026-11-04', '2026-11-18'];
  applyAction({ name: 'PD', role: 'director' }, p, { type: 'saveCalendar', pkg: 0, stages, boundaries: b, syncDelivery: false, excludeHolidays: false } as never);
  assert.deepEqual(pk.schedule.map((r) => r.id), [ids[2], ids[0], ids[1], ids[3]]);
  assert.equal(pk.schedule[0].assignee, 'Kevin', '负责人跟着阶段走');
  assert.deepEqual(pk.schedule.map((r) => [r.s, r.e]), [['2026-10-01', '2026-10-07'], ['2026-10-08', '2026-10-14'], ['2026-10-15', '2026-11-04'], ['2026-11-05', '2026-11-18']]);
  assert.equal(pk.schedule[2].weeks, 3, '21 天 = 3 周');
  assert.deepEqual(p.dismissedRisks, ['od:0:0', 'od:1:0'], '第 3 行的风险跟到第 1 行;删掉的那一行的不要了;别的业务不动');
  assert.equal(pk.delivery, '2026-11-18');
});
