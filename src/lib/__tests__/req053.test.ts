import test from 'node:test';
import assert from 'node:assert/strict';
import { newProject } from '../project.ts';
import { cleanJobFormats, formatOf, isHw, setServerJobFormatSource, DEFAULT_HW_SVCS } from '../jobFormat.ts';
import { baseDefOf, computeFormula, fieldsOf, ledSizeIssues, registerDef, type FieldDef } from '../records.ts';
import { extraRowsOf, jobGroups, jobRowPkg } from '../jobRecord.ts';
import { migrateProject049 } from '../mig049.ts';
import { migrateProject053, report053 } from '../mig053.ts';
import { applyAction } from '../../server/actions.ts';
import { SVC } from '../templates.ts';
import type { Project } from '../types.ts';
import { logText } from '../logmsg.ts';

const PD = { name: 'PD', role: 'director' } as never;
const act = (p: Project, a: unknown) => applyAction(PD, p, a as never);
const proj = (services: string[]) => newProject({ name: 'T', client: 'C', services, start: '' } as never);
const defs = (svc: string) => fieldsOf(baseDefOf(svc), {});
setServerJobFormatSource(() => ({}));

test('REQ-053 业务分类:默认 8 种硬件,其余软件(REQ-059:3D VR/720 改为软件);覆盖值只存和默认不一样的', () => {
  assert.deepEqual(DEFAULT_HW_SVCS, ['led', 'projector', 'tv', 'maxhub', 'lightbox', 'av', 'elv', 'pv']);
  for (const k of ['cgi', 'ani', 'scale', 'drone', 'website', 'matterport', 'saleskit', 'unitmodel', 'brochure', 'video', 'interior', 'renovation', 'others', 'vrar']) {
    assert.equal(formatOf(k), 'sw', k);
  }
  assert.equal(isHw('led'), true);
  assert.equal(isHw('drone', { drone: 'hw' }), true);
  assert.deepEqual(cleanJobFormats({ drone: 'hw', led: 'hw', cgi: 'x', nope: 'hw' }, (k) => !!SVC[k]), { drone: 'hw' }, '和默认一样的、坏值、不存在的业务都不存');
  assert.deepEqual(cleanJobFormats({ vrar: 'sw' }, (k) => !!SVC[k]), {}, 'REQ-059:以前手动改成软件的 3D VR/720,现在和默认一样,不用再存');
});

test('REQ-053 登记表:TV 用 MAXHUB 的字段,灯箱新建,弱电 / 光伏用 AV 的;都是安装类;LED「Height 高 (mm)」', () => {
  const keys = (svc: string) => registerDef(svc)!.fields.map((f) => f.key);
  assert.deepEqual(keys('tv'), keys('maxhub'));
  assert.deepEqual(keys('elv'), keys('av'));
  assert.deepEqual(keys('pv'), keys('av'));
  assert.deepEqual(keys('lightbox'), ['siteAddress', 'mainCon', 'sizeWH', 'quantity', 'printMaterial', 'lighting', 'installation', 'signedOff', 'remarks']);
  assert.deepEqual(registerDef('lightbox')!.fields.find((f) => f.key === 'lighting')!.options!.map((o) => o[1]), ['LED 背光', '侧光', '不发光']);
  for (const s of ['tv', 'lightbox', 'elv', 'pv']) assert.equal(registerDef(s)!.kind, 'install', s);
  const dimH = registerDef('led')!.fields.find((f) => f.key === 'dimH')!;
  assert.equal(dimH.zh, 'Height 高 (mm)');
  assert.equal(dimH.en, 'Height (mm)');
  assert.ok(DEFAULT_HW_SVCS.every((s) => registerDef(s)), '每种默认硬件都有登记表');
});

test('REQ-053 LED 尺寸自检:143 LED ② 高 304 ÷ 19 = 16 → 是不是 3040;改了之后面积 / DB Box / 散热', () => {
  assert.deepEqual(ledSizeIssues({ dimL: 5120, dimH: 2880, qtyL: 16, qtyH: 18 }), [], 'LED ① 5120 / 16 = 320、2880 / 18 = 160');
  const got = ledSizeIssues({ dimL: '5440', dimH: '304', qtyL: '17', qtyH: '19' });
  assert.deepEqual(got, [{ key: 'dimH', qtyKey: 'qtyH', dim: 304, qty: 19, per: 16, fix: 3040 }]);
  assert.equal(ledSizeIssues({ dimL: 51200, dimH: 2880, qtyL: 16, qtyH: 18 })[0].fix, 5120, '÷10 也认');
  assert.equal(ledSizeIssues({ dimL: 5000, dimH: 2880, qtyL: 12, qtyH: 18 })[0].fix, undefined, '×10 / ÷10 都对不上就不给建议(5000 ÷ 12 ≈ 416.7)');
  assert.deepEqual(ledSizeIssues({ dimL: 5121, dimH: 2879, qtyL: 16, qtyH: 18 }), [], '误差 ±1 mm');
  const fields = defs('led');
  const rec = { dimL: '5440', dimH: '3040', qtyL: '17', qtyH: '19' };
  const v = (k: string) => computeFormula(fields.find((f) => f.key === k)!, fields, rec);
  assert.equal(v('sqm')!.toFixed(3), '16.538');
  assert.equal(v('dbBox')!.toFixed(2), '7.44');
  assert.equal(v('heatKw')!.toFixed(2), '2.98');
});

test('REQ-053 硬件:没有 4 栏行也行;额外项目按份加 / 粘贴 / 删到 0;软件仍至少 1 行', () => {
  const p = proj(['led', 'tv', 'av', 'led']);
  assert.equal(p.jobRecord!.length, 0, '143 那样全硬件的项目:一行 4 栏都没有');
  assert.deepEqual(jobGroups(p, { hw: false }), []);
  const [led1, , , led2] = p.packages;
  act(p, { type: 'addJobRow', svc: 'led', pk: led2.id });
  assert.equal(extraRowsOf(p, led2).length, 1);
  assert.equal(extraRowsOf(p, led1).length, 0, '加在 LED ② 下面,不在 LED ①');
  act(p, { type: 'pasteJobRows', text: 'Transport\tTo site\t1\tlorry\nInstallation\t\t3 days\t', pk: led2.id });
  assert.deepEqual(extraRowsOf(p, led2).map((r) => r.item), ['LED Display', 'Transport', 'Installation'], '粘贴的都归到这一份,不按 Service Item 认业务');
  for (const r of extraRowsOf(p, led2)) act(p, { type: 'removeJobRow', id: r.id });
  assert.equal(extraRowsOf(p, led2).length, 0, '硬件可以删到一行不剩');
  /* 软件 */
  const q = proj(['cgi', 'led']);
  assert.deepEqual(q.jobRecord!.map((r) => r.svc), ['cgi']);
  assert.throws(() => act(q, { type: 'removeJobRow', id: q.jobRecord![0].id }), /至少保留一行/);
  act(q, { type: 'addServicePackage', svc: 'tv', patch: {}, asNew: true });
  assert.deepEqual(q.jobRecord!.map((r) => r.svc), ['cgi'], '加硬件业务不加 4 栏行');
  /* 删掉一份:它的额外项目留着,归到同类第一份 */
  act(p, { type: 'addJobRow', svc: 'led', pk: led2.id, values: { item: 'Maintenance', detail: '', qty: '1 yr', note: '' } });
  act(p, { type: 'removeServicePackage', pkg: 3 });
  const kept = p.jobRecord!.find((r) => r.item === 'Maintenance')!;
  assert.equal(kept.pk, undefined);
  assert.equal(jobRowPkg(p, kept), p.packages[0]);
});

test('REQ-053 尺寸自检的「改成 3040」/「没错,忽略」写进日志', () => {
  const p = proj(['led']);
  act(p, { type: 'setRecord', pkg: 0, patch: { dimH: '304' } });
  act(p, { type: 'setRecord', pkg: 0, patch: { dimH: '3040' }, fix: { key: 'Height 高 (mm)', from: '304', to: '3040' } });
  assert.equal(p.packages[0].record!.dimH, '3040');
  assert.ok(p.log!.some((l) => (l as { k?: string }).k === 'record.dimFix'));
  act(p, { type: 'setRecord', pkg: 0, patch: { dimCheckIgnored: '1' }, fix: 'ignore' });
  assert.ok(p.log!.some((l) => (l as { k?: string }).k === 'record.dimIgnore'));
  /* 第二份带份号;业务名按语言翻(英文界面不出中文) */
  const q = proj(['led', 'led']);
  act(q, { type: 'setRecord', pkg: 1, patch: { dimH: '3040' }, fix: { key: 'Height (mm)', from: '304', to: '3040' } });
  const e = q.log!.find((l) => (l as { k?: string }).k === 'record.dimFix')! as { text: string; k: string; p: Record<string, string> };
  assert.match(logText(e, 'zh'), /LED.*#2.*Height \(mm\).*304 → 3040/);
  assert.doesNotMatch(logText(e, 'en'), /[\u4e00-\u9fa5]/, logText(e, 'en'));
  assert.doesNotMatch(logText({ text: '', k: 'job.format', p: { svc: 'drone', fmtFrom: 'sw', fmtTo: 'hw' } }, 'en'), /[\u4e00-\u9fa5]/);
  assert.match(logText({ text: '', k: 'job.format', p: { svc: 'drone', fmtFrom: 'sw', fmtTo: 'hw' } }, 'zh'), /软件 · 4 栏 → 硬件 · 登记表/);
});

/* 上线前(REQ-049 那一版)的硬件项目:049 把有值的登记表字段一个字段一行拆出来,外加只填了业务名的空行 */
function legacy143(): Project {
  const p = proj(['led', 'tv', 'av', 'led', 'cgi']);
  p.packages[0].record = { siteAddress: '25 Scotts Rd', mainCon: 'Falcon', location: 'outdoor', resolution: 'P2.5', dimL: '5120', dimH: '2880', qtyL: '16', qtyH: '18', powerCable: '4' } as never;
  p.packages[2].record = { siteAddress: '25 Scotts Rd', mainCon: 'Falcon', developer: 'Royal Plaza Hotel', projectRecord: '143-Royal Plaza LED' } as never;
  p.packages[3].record = { siteAddress: '25 Scotts Rd', location: 'indoor', resolution: 'P2', dimL: '5440', dimH: '304', qtyL: '17', qtyH: '19' } as never;
  delete p.jobRecord;
  /* 049 当时:LED 还是 4 栏、dimH 还叫「Width 宽 (mm)」 */
  setServerJobFormatSource(() => Object.fromEntries(DEFAULT_HW_SVCS.map((s) => [s, 'sw' as const])));
  const old = (svc: string): FieldDef[] => defs(svc).map((f) => (svc === 'led' && f.key === 'dimH' ? { ...f, zh: 'Width 宽 (mm)', en: 'Width (mm)' } : f));
  migrateProject049(p, old, 1);
  setServerJobFormatSource(() => ({}));
  delete p.mig049;
  return p;
}

test('REQ-053 迁移:143 —— 拆分行和空行删掉,改过 / 新加的留下当额外项目;软件行、登记表字段不动;只跑一次', () => {
  const p = legacy143();
  const cgi = p.jobRecord!.find((r) => r.svc === 'cgi')!;
  cgi.detail = 'Hero view';
  const led2Rows = p.jobRecord!.filter((r) => r.svc === 'led' && /^LED Display ② · /.test(r.detail));
  assert.ok(led2Rows.length >= 6, JSON.stringify(led2Rows));
  /* 上线后有人改过一行、新加了一行 */
  const edited = led2Rows.find((r) => /Main Con|Address/.test(r.detail)) || led2Rows[0];
  edited.note = edited.note + '(现场确认)';
  p.jobRecord!.push({ id: 'new1', svc: 'led', item: 'LED Display', detail: 'Installation', qty: '2 days', note: '' });
  const recBefore = JSON.stringify(p.packages.map((pk) => pk.record));
  const swBefore = JSON.stringify(p.jobRecord!.filter((r) => r.svc === 'cgi'));
  const total = p.jobRecord!.length;
  const hwTotal = p.jobRecord!.filter((r) => r.svc !== 'cgi').length;
  const m = migrateProject053(p, { defsFor: defs, isHw: (s) => isHw(s), at: 9 })!;
  assert.deepEqual(m.problems, []);
  assert.equal(m.kept.length, 2, JSON.stringify(m.kept));
  assert.equal(m.split.length + m.blank.length, hwTotal - 2);
  assert.ok(m.split.some((x) => x.detail === 'Width 宽 (mm)' && x.value === '304'), 'dimH 的旧名「Width 宽 (mm)」也认得');
  assert.ok(m.blank.length >= 1, 'TV 那一行只有业务名');
  assert.equal(JSON.stringify(p.packages.map((pk) => pk.record)), recBefore, 'pk.record 一个字段都不动');
  assert.equal(JSON.stringify(p.jobRecord!.filter((r) => r.svc === 'cgi')), swBefore, '软件行一行不动');
  const led2 = p.packages[3];
  assert.deepEqual(extraRowsOf(p, led2).map((r) => r.id), [edited.id], 'LED ② 下面只剩改过的那一行');
  assert.ok(p.jobRecord!.find((r) => r.id === edited.id)!.pk === led2.id, '改过的那一行归到 LED ②');
  assert.ok(p.jobRecord!.find((r) => r.id === 'new1')!.pk === p.packages[0].id, '没前缀的新行归到第一份');
  assert.equal(p.jobRecordLegacy053!.length + p.jobRecord!.length, total, '删掉的都在 jobRecordLegacy053 里');
  assert.ok(p.jobRecordLegacy053!.every((r) => typeof r.idx === 'number' && r.at === 9));
  assert.equal(migrateProject053(p, { defsFor: defs, isHw: (s) => isHw(s), at: 10 }), null, '只跑一次');
  const md = report053([m], { title: 'T', when: 'now' });
  assert.match(md, /删除.*\*\*\d+\*\* 行/);
  assert.match(md, /自检:全部通过/);
});

test('REQ-053 迁移:只有软件业务的项目(171-50JHS)不动;140 软硬混合只动硬件(REQ-059:3D VR/720 是软件,它的行留着)', () => {
  const p = proj(['cgi', 'ani', 'scale']);
  assert.equal(migrateProject053(p, { defsFor: defs, isHw: (s) => isHw(s), at: 1 }), null);
  const q = proj(['cgi', 'ani', 'vrar', 'drone', 'lightbox']);
  q.jobRecord!.push({ id: 'b1', svc: 'vrar', item: '3D VR / 720', detail: '', qty: '', note: '' }, { id: 'b2', svc: 'lightbox', item: 'Lightbox', detail: '', qty: '', note: '' });
  const sw = JSON.stringify(q.jobRecord!.filter((r) => !isHw(r.svc)));
  const m = migrateProject053(q, { defsFor: defs, isHw: (s) => isHw(s), at: 1 })!;
  assert.equal(m.blank.length, 1, '只有灯箱那一行;3D VR / 720 那行留在 4 栏表里');
  assert.equal(JSON.stringify(q.jobRecord), sw, '剩下的就是 CGI / 动画 / 无人机的 4 栏行');
});
