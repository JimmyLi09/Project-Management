/* ===== AV platform · drawing review persistence (spec v1.0 §10) =====
   `drawing` and `extraction`, prefixed av_ so the AV tables stay recognisable
   (and liftable) inside the shared database. A drawing belongs to a project;
   each of its six extractions keeps the extracted value and the reviewed value
   side by side ("同时保留原始与修正").

   Review progress is saved as the PM works. Passing the A10 gate stamps
   reviewed_at and locks the drawing: a later change means a new upload, so the
   record of what was confirmed, by whom, never moves under anyone's feet. */

import { DEMO_CASES, shouldSeedDemo } from './demo';
import { appendAudit, getDb, listProjects } from './db';
import DEMO_PRICE_SEED from '@/av/seed/led-price-2026-04.json';
import { compute } from '@/av/core/compute';
import { buildLedLines, CTRL_CATEGORY, displayCandidates, isCtrlSpec, totals } from '@/av/core/pricing';
import { PRJ_DEVICE_SEED, PRJ_LIBRARY_SEED, PRJ_PROJECTOR_CATEGORY, prjLibraryFrom, type PrjLibrary } from '@/av/core/prj/library';
import type { PrjAnswers } from '@/av/core/prj/inquiry';
import { LATEST_PRJ_PACK, PRJ_CONFIRM_PACK, PRJ_CONST_LABEL, PRJ_RELEASE_PACK, type PrjConstKey } from '@/av/core/prj/rulepack';
import { NOVASTAR_SEED, type CtrlDevice, type PcBy, type PlayUse } from '@/av/core/controller';
import { GST_RATE, quoteNo, quoteTotals, toSection } from '@/av/core/quote';
import { LATEST_LED_PACK } from '@/av/core/rulepack';
import { isAvailable, projectLines } from '@/av/core/lines';
import { categoryCode } from './avprice';
import type { LedConfig } from '@/av/core/types';
import { logZh } from '@/lib/logmsg';
import type { DrawingElement, DrawingExtra, DrawingSummary, IngestRecord, IngestResult, StoredDrawing } from '@/av/core/handoff';
import type { CostLine, LedSummary, PriceItem, SavedConfig, SummaryBase } from '@/av/core/pricing';
import type { QuoteSection } from '@/av/core/quote';
import type { Deduction } from '@/av/core/xline';
import type { BusinessLine } from '@/av/core/types';

export type { DrawingSummary, StoredDrawing };

let ready = false;
function db() {
  const d = getDb();
  if (!ready) {
    d.exec(`
      CREATE TABLE IF NOT EXISTS av_drawing (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL,
        line TEXT NOT NULL DEFAULT 'led',
        file_name TEXT NOT NULL,
        grade TEXT NOT NULL,
        scale_mm_per_unit REAL NOT NULL,
        threshold REAL NOT NULL,
        notes TEXT NOT NULL,
        uploaded_by TEXT NOT NULL,
        uploaded_at INTEGER NOT NULL,
        reviewed_by TEXT NOT NULL DEFAULT '',
        reviewed_at INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_av_drawing_project ON av_drawing(project_id, uploaded_at DESC);
      /* 01 立项询价: what the project was opened for, and which rule-pack version
         each business line is bound to (§5: 历史项目锁定其创建时的版本). */
      CREATE TABLE IF NOT EXISTS av_inquiry (
        project_id TEXT PRIMARY KEY,
        location TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        lines TEXT NOT NULL,
        packs TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      /* Price library. Prices change: every edit to a price or its validity
         leaves a row in av_price_history, and cost sheets keep their own
         snapshot of the prices they used. */
      CREATE TABLE IF NOT EXISTS av_price_item (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        line TEXT NOT NULL,
        category TEXT NOT NULL,
        category_label TEXT NOT NULL,
        model TEXT NOT NULL DEFAULT '',
        pitch TEXT NOT NULL DEFAULT '',
        module_size TEXT NOT NULL DEFAULT '',
        cabinet_size TEXT NOT NULL DEFAULT '',
        unit TEXT NOT NULL,
        cost_price REAL,
        list_price REAL,
        currency TEXT NOT NULL DEFAULT 'SGD',
        source TEXT NOT NULL DEFAULT '',
        valid_until TEXT NOT NULL DEFAULT '',
        active INTEGER NOT NULL DEFAULT 1,
        updated_by TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS av_price_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id INTEGER NOT NULL,
        cost_price REAL,
        list_price REAL,
        valid_until TEXT NOT NULL DEFAULT '',
        changed_by TEXT NOT NULL,
        changed_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS av_setting (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_by TEXT NOT NULL DEFAULT '',
        updated_at INTEGER NOT NULL DEFAULT 0
      );
      /* §10 config_result: each save of a 05 configuration against a project. */
      CREATE TABLE IF NOT EXISTS av_config (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL,
        line TEXT NOT NULL,
        pack_version TEXT NOT NULL,
        drawing_id INTEGER,
        cfg TEXT NOT NULL,
        summary TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS av_cost_sheet (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL,
        line TEXT NOT NULL,
        config_id INTEGER NOT NULL,
        lines TEXT NOT NULL,
        cost REAL NOT NULL,
        list REAL NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        confirmed_by TEXT NOT NULL DEFAULT '',
        confirmed_at INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS av_quote (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL,
        sections TEXT NOT NULL,
        discount_pct REAL NOT NULL,
        gst_rate REAL NOT NULL,
        margin_floor REAL NOT NULL,
        dedup TEXT NOT NULL DEFAULT '[]',
        reason TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'submitted',
        submitted_by TEXT NOT NULL,
        submitted_at INTEGER NOT NULL,
        decided_by TEXT NOT NULL DEFAULT '',
        decided_at INTEGER NOT NULL DEFAULT 0,
        decision_note TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS av_case (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_sheet TEXT NOT NULL,
        status TEXT NOT NULL,
        ref_no TEXT,
        year INTEGER,
        name TEXT NOT NULL,
        client TEXT,
        address TEXT,
        width_mm REAL,
        height_mm REAL,
        sqm REAL,
        pitch REAL,
        modules INTEGER,
        kw REAL,
        power_cable TEXT,
        data_cable TEXT,
        product TEXT,
        remarks TEXT,
        imported_by TEXT NOT NULL,
        imported_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS av_extraction (
        drawing_id INTEGER NOT NULL REFERENCES av_drawing(id) ON DELETE CASCADE,
        element TEXT NOT NULL,
        value REAL,
        unit TEXT NOT NULL,
        source TEXT NOT NULL,
        method TEXT NOT NULL,
        confidence TEXT NOT NULL,
        rule TEXT,
        note TEXT,
        needs_review INTEGER NOT NULL,
        confirmed INTEGER NOT NULL DEFAULT 0,
        confirmed_by TEXT NOT NULL DEFAULT '',
        corrected REAL,
        corrected_by TEXT NOT NULL DEFAULT '',
        corrected_at TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (drawing_id, element)
      );
    `);
    /* quotations saved before cross-line savings existed */
    const qcols = (d.prepare('PRAGMA table_info(av_quote)').all() as { name: string }[]).map((c) => c.name);
    if (!qcols.includes('dedup')) d.exec("ALTER TABLE av_quote ADD COLUMN dedup TEXT NOT NULL DEFAULT '[]'");
    /* AV-015: what an image judgement carries into 05 beyond the six elements
       (curve, chosen pitch, maintenance, items left to fill) — JSON, '' for drawings */
    const dcols = (d.prepare('PRAGMA table_info(av_drawing)').all() as { name: string }[]).map((c) => c.name);
    if (!dcols.includes('extra')) d.exec("ALTER TABLE av_drawing ADD COLUMN extra TEXT NOT NULL DEFAULT ''");
    /* AV-019:设备库规格(JSON,只有「控制系统」分类用)、01 的「播放什么 / 电脑由谁提供」(JSON) */
    const pcols = (d.prepare('PRAGMA table_info(av_price_item)').all() as { name: string }[]).map((c) => c.name);
    if (!pcols.includes('spec')) d.exec("ALTER TABLE av_price_item ADD COLUMN spec TEXT NOT NULL DEFAULT ''");
    const icols = (d.prepare('PRAGMA table_info(av_inquiry)').all() as { name: string }[]).map((c) => c.name);
    if (!icols.includes('answers')) d.exec("ALTER TABLE av_inquiry ADD COLUMN answers TEXT NOT NULL DEFAULT '{}'");

    /* ===== AV-014 · 人工修改与跨导入的身份 =====
       av_case 仍然只存统计表导入的原始值 —— 导入逻辑不变,人看到的值是
       「原始值叠加人工值」。人工值单独放 av_case_edit,所以重新导入整张表
       也冲不掉它。Handover date / 保修期没有统计表来源,同样放这张表。

       case_key 是一块屏跨多次导入的身份,由**原始导入值**算(见 caseKeyOf)。
       missing = 统计表里已经没有它了,但有人工修改所以留着。 */
    const ccols = (d.prepare('PRAGMA table_info(av_case)').all() as { name: string }[]).map((c) => c.name);
    if (!ccols.includes('case_key')) d.exec("ALTER TABLE av_case ADD COLUMN case_key TEXT NOT NULL DEFAULT ''");
    if (!ccols.includes('missing')) d.exec('ALTER TABLE av_case ADD COLUMN missing INTEGER NOT NULL DEFAULT 0');
    d.exec(`
      CREATE TABLE IF NOT EXISTS av_case_edit (
        case_key TEXT NOT NULL,
        field TEXT NOT NULL,
        value TEXT NOT NULL,      /* '' = 人工清空,与「没改过」区分开 */
        edited_by TEXT NOT NULL,
        edited_at INTEGER NOT NULL,
        PRIMARY KEY (case_key, field)
      );
      /* 改前 → 改后。公司级数据不挂项目,所以不走 audit_log,自带一张,
         与价格库的 av_price_history 同一路子。k + p 供 i18n 渲染。 */
      CREATE TABLE IF NOT EXISTS av_case_edit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        case_key TEXT NOT NULL,
        at INTEGER NOT NULL,
        by TEXT NOT NULL,
        k TEXT NOT NULL,
        p TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_av_case_edit_log ON av_case_edit_log(case_key, at DESC);
      CREATE INDEX IF NOT EXISTS idx_av_case_key ON av_case(case_key);
      /* 保修到期提醒的「已联系」(AV-014 §7 第 1 条的后续)。挂在「哪块屏 + 哪个
         到期日」上:交付日期或保修期一改、到期日变了,这条就对不上,下一轮到期会
         重新提醒 —— 不会因为去年联系过就永远不提醒。 */
      CREATE TABLE IF NOT EXISTS av_case_remind (
        case_key TEXT NOT NULL,
        expire TEXT NOT NULL,
        by TEXT NOT NULL,
        at INTEGER NOT NULL,
        PRIMARY KEY (case_key, expire)
      );
    `);
    /* AV-012 时代导入的行没有 case_key —— 按同一套规则补算一次,补完它们
       才认得出自己,以后重新导入不会被当成新屏。

       判断条件是「有行、但一行都没有 key」,而不是「这次启动刚加了这一列」:
       要是加完列、补算之前进程挂了,下次启动列已经在了,按后一种判断就再也
       不补 —— 所有行 key 都是空串,编辑一块屏会同时改到所有屏。补算本身在
       一个事务里,要么全补上要么一行没动,所以「一行都没 key」恰好就是遗留
       状态。已经有 key 的库绝不重算:重新导入后保留下来的旧行与新行 id 交错,
       重算会把重复屏的序号排乱,和人工修改对不上。 */
    const keyed = d.prepare("SELECT count(*) AS n, SUM(case_key <> '') AS k FROM av_case").get() as { n: number; k: number | null };
    if (keyed.n > 0 && !keyed.k) backfillCaseKeys(d);
    /* 演示模式(Vercel 预览)没有 Python,导入不了统计表,案例库空着就什么都验
       不了 —— 放一批示例屏。库里已经有屏就不动。内网服务器不开演示模式。 */
    else if (keyed.n === 0 && shouldSeedDemo()) seedDemoCases(d);
    ready = true;
    /* 放在 ready 之后:下面用的是普通的存取函数,它们会调 db(),这时不能再进初始化 */
    if (shouldSeedDemo()) seedDemoAv(d);
    seedControlDevices(d);
    seedProjectorDevices(d);
  }
  return d;
}

/* ===== AV-019 · 设备库首批诺瓦数据 =====
   上线后第一次用到 AV 时录一次(meta 记一笔,之后 PD / BD 改了、停用了都不会再补回来)。
   价格留空 = 待报价;规格按 2026-10 官网规格书,上线前请再核一次。 */
const MIG_019 = 'mig.av019.ctrlSeed';
function seedControlDevices(d: ReturnType<typeof getDb>): void {
  if (d.prepare('SELECT 1 FROM meta WHERE key = ?').get(MIG_019)) return;
  let added = 0;
  d.transaction(() => {
    for (const x of NOVASTAR_SEED) {
      const dup = d.prepare('SELECT 1 FROM av_price_item WHERE line = ? AND category = ? AND model = ?').get('led', CTRL_CATEGORY, x.model);
      if (dup) continue;
      const it = createPriceItem({
        line: 'led', category: CTRL_CATEGORY, categoryLabel: '控制系统', model: x.model, pitch: '', moduleSize: '', cabinetSize: '',
        unit: '台', costPrice: null, listPrice: null, currency: 'SGD',
        source: `${x.brand ? `${x.brand} 官网规格书 2026-10（上线前再核）` : 'AV-019 默认项'}${x.note ? ` · ${x.note}` : ''}`,
        validUntil: '', active: true,
        spec: { kind: x.kind, brand: x.brand, ports: x.ports, loadPx: x.loadPx, maxW: x.maxW, maxH: x.maxH, inputs: x.inputs, standalone: x.standalone },
      }, 'AV-019 首批数据');
      if (it) added++;
    }
    d.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run(MIG_019, JSON.stringify({ at: Date.now(), added }));
  })();
  if (added) console.log(`[AV-019] 设备库:录入首批诺瓦控制系统 ${added} 条(价格待报)`);
}

/* ===== AV-020 · 投影设备库首批数据 =====
   价格库「投影」:投影机 7 款、镜头 5 支(规格书 + JM 设备清单 rev 1),配置模板的配套 10 项
   (MY014 报价单价写在售价栏,SGD;成本价由 BD 手动填)。和 AV-019 一样只录一次。 */
const MIG_020 = 'mig.av020.prjSeed';
function seedProjectorDevices(d: ReturnType<typeof getDb>): void {
  if (d.prepare('SELECT 1 FROM meta WHERE key = ?').get(MIG_020)) return;
  let added = 0;
  d.transaction(() => {
    for (const x of PRJ_DEVICE_SEED) {
      if (d.prepare('SELECT 1 FROM av_price_item WHERE line = ? AND category = ? AND model = ?').get('projector', x.category, x.model)) continue;
      createPriceItem({
        line: 'projector', category: x.category, categoryLabel: x.categoryLabel, model: x.model, pitch: x.pitch, moduleSize: '', cabinetSize: '',
        unit: x.unit, costPrice: null, listPrice: x.listPrice, currency: 'SGD', source: x.source, validUntil: '', active: true, spec: x.spec,
      }, 'AV-020 首批数据');
      added++;
    }
    d.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run(MIG_020, JSON.stringify({ at: Date.now(), added }));
  })();
  if (added) console.log(`[AV-020] 设备库:录入投影机 / 镜头 / 配套 ${added} 条(价格待报)`);
}

/* 投影计算用的设备库:价格库「投影」里启用的投影机和镜头。一条投影机都没有(首批没录进去)时退回内置那批 */
export function prjLibrary(): PrjLibrary {
  const items = listPriceItems('projector');
  if (!items.some((i) => i.category === PRJ_PROJECTOR_CATEGORY && i.spec)) return PRJ_LIBRARY_SEED;
  return prjLibraryFrom(items);
}

/* ===== AV-020 §3.7 · 投影常数确认与 prj@1.0 发布 =====
   av_setting 里两条:prj.confirm = { 常数: { by, at } },prj.release = { pack, by, at }。
   发布以后新项目绑 prj@1.0,prj@0.2 的项目在 05 可以升级;回退见上线操作单。 */
export interface PrjConfirmState {
  pack: string;
  confirms: Partial<Record<PrjConstKey, { by: string; at: number }>>;
  release: { pack: string; by: string; at: number } | null;
}
const readSetting = <T,>(key: string): T | null => {
  const r = db().prepare('SELECT value FROM av_setting WHERE key = ?').get(key) as { value: string } | undefined;
  if (!r) return null;
  try { return JSON.parse(r.value) as T; } catch { return null; }
};
const writeSetting = (key: string, value: unknown, by: string) => db().prepare(`INSERT INTO av_setting (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
  .run(key, JSON.stringify(value), by, Date.now());

export function prjConfirmState(): PrjConfirmState {
  return { pack: PRJ_CONFIRM_PACK, confirms: readSetting('prj.confirm') ?? {}, release: readSetting('prj.release') };
}
export function setPrjConfirm(key: PrjConstKey, on: boolean, by: string): PrjConfirmState {
  const cur = prjConfirmState().confirms;
  const next = { ...cur };
  if (on) next[key] = { by, at: Date.now() }; else delete next[key];
  writeSetting('prj.confirm', next, by);
  return prjConfirmState();
}
export const prjAllConfirmed = (s: PrjConfirmState) => (Object.keys(PRJ_CONST_LABEL) as PrjConstKey[]).every((k) => s.confirms[k]);
export function publishPrjRelease(by: string): PrjConfirmState {
  writeSetting('prj.release', { pack: PRJ_RELEASE_PACK, by, at: Date.now() }, by);
  return prjConfirmState();
}
/* 投影线现在的最新规则包:prj@1.0 发布了就是 1.0,否则 0.2 */
export const latestPrjPack = (): string => (readSetting<{ pack: string }>('prj.release')?.pack ?? LATEST_PRJ_PACK);
/* 立项绑定用:投影按上面,其它线按代码里的最新版 */
export const latestPackOf = (l: { line: BusinessLine; pack: string | null }): string => (l.line === 'projector' ? latestPrjPack() : l.pack!);

/* F11 用的设备:「控制系统」分类里启用、填了规格的条目 */
export function controllerDevices(): CtrlDevice[] {
  return listPriceItems('led')
    .flatMap((i) => (i.active && i.category === CTRL_CATEGORY && isCtrlSpec(i.spec) ? [{ ...i, spec: i.spec }] : []))
    .map((i) => ({
      id: i.id, model: i.model, brand: i.spec!.brand ?? '', kind: i.spec!.kind, ports: i.spec!.ports, loadPx: i.spec!.loadPx,
      maxW: i.spec!.maxW, maxH: i.spec!.maxH, inputs: i.spec!.inputs, standalone: i.spec!.standalone, price: i.costPrice,
    }));
}

/* ===== 演示模式的 AV 成本单与报价(2026-09-30,字段级隔离验收用)=====
   预览上要验「PD 看得到成本、Sales 只看售价、PM 连售价也看不到」,前提是有一份
   成本单和一份报价。手工做一份要导价格表、存方案、补线材、确认 —— 太长了。
   演示模式下在 Lentor Mansion(张三的项目)上预置:2026 LED 价格表 + 两条线材、
   一份 LED 方案、一份已确认的成本单、一份 Sales 提交的报价(毛利低于下限,
   审批人那边会标红)。价格库或方案里已有东西就不动。内网服务器不开演示模式。 */
function seedDemoAv(d: ReturnType<typeof getDb>): void {
  const has = (t: string) => (d.prepare(`SELECT count(*) AS n FROM ${t}`).get() as { n: number }).n > 0;
  if (has('av_price_item') || has('av_config')) return;
  const project = listProjects().find((p) => p.name === 'Lentor Mansion' && p.packages.some((k) => k.svc === 'led'));
  if (!project) return;
  try {
    importPriceItems(DEMO_PRICE_SEED.items.map((r) => ({
      line: 'led', category: r.category, categoryLabel: r.category_label, model: r.model, pitch: r.pitch,
      moduleSize: r.module_size, cabinetSize: r.cabinet_size, unit: r.unit, costPrice: r.cost_price,
      listPrice: r.list_price, currency: r.currency, source: r.source, validUntil: '', active: true,
    })), '演示数据');
    const cable = (model: string, cost: number, list: number) => createPriceItem({
      line: 'led', category: 'cable', categoryLabel: '线材', model, pitch: '', moduleSize: '', cabinetSize: '', unit: '根',
      costPrice: cost, listPrice: list, currency: 'SGD', source: '演示数据', validUntil: '', active: true,
    }, '演示数据').id;
    const pc = cable('20A power cable', 80, 120);
    const dc = cable('Cat6 data cable', 40, 60);

    const cfg = {
      led_opening_w: 4480, led_opening_h: 2560, led_screen_type: 'in_fixed', led_pitch: 2, led_cabinet: [640, 480],
      led_refresh: 3840, led_nits: 800, led_install: 'steel', led_maintain: 'front', led_redundancy: 'sender_1plus1',
      led_ctrl_brand: 'novastar', led_power_cable: '3*2.5',
    } as unknown as LedConfig;
    const r = compute(cfg, LATEST_LED_PACK, {});
    if (!r.layout || !r.wiring) return;
    const t = r.trace;
    const config = saveConfig<LedSummary>({
      projectId: project.id, line: 'led', packVersion: LATEST_LED_PACK, drawingId: null, createdBy: '张三',
      summary: {
        sqm: t.sqm.value, pitch: cfg.led_pitch, screenType: cfg.led_screen_type, mods: t.mods.value,
        cabinets: r.layout.cells.length, nPowerCable: t.n_power_cable.value, nDataCable: t.n_data_cable.value,
        powerCableSpec: cfg.led_power_cable, exportable: r.exportable,
        blocking: r.findings.filter((f) => f.severity === 'block').map((f) => f.code),
      },
    }, cfg);

    const items = listPriceItems('led');
    const display = displayCandidates(items, cfg.led_pitch)[0];
    const lines = buildLedLines(config, { display: display?.id ?? null, power_cable: pc, data_cable: dc }, [], items);
    const tt = totals(lines);
    const sheet = saveCostSheet({ projectId: project.id, line: 'led', configId: config.id, lines, cost: tt.cost, list: tt.list }, '总监 PD', true);
    const costP = { line: 'LED 显示屏', cost: tt.cost.toLocaleString('en-US'), list: tt.list.toLocaleString('en-US'),
      margin: tt.margin === null ? '—' : (tt.margin * 100).toFixed(1) + '%' };

    const sections = [toSection('led', sheet)];
    const marginFloor = getMarginFloor();
    const qt = quoteTotals(sections, 0, GST_RATE, []);
    const quote = createQuote({ projectId: project.id, sections, dedup: [], discountPct: 0, gstRate: GST_RATE, marginFloor, reason: '' }, '销售 Sales');
    const qP = { no: quoteNo(quote.id), lines: 'LED 显示屏', total: qt.total.toLocaleString('en-US'), shared: '',
      margin: qt.margin === null ? '—' : (qt.margin * 100).toFixed(1) + '%' };
    const now = Date.now();
    appendAudit(project.id, [
      { at: now, by: '总监 PD', text: logZh('av.cost', costP), k: 'av.cost', p: costP },
      { at: now + 1, by: '销售 Sales', text: logZh('av.quoteSubmit', qP), k: 'av.quoteSubmit', p: qP },
    ]);
  } catch { /* 演示数据铺不上就算了,不能挡住页面 */ }
}

type ExtractionRow = {
  element: DrawingElement; value: number | null; unit: string; source: string; method: string;
  confidence: string; rule: string | null; note: string | null; needs_review: number;
  confirmed: number; confirmed_by: string; corrected: number | null; corrected_by: string; corrected_at: string;
};
type DrawingRow = {
  id: number; project_id: string; file_name: string; grade: string; scale_mm_per_unit: number;
  threshold: number; notes: string; uploaded_by: string; uploaded_at: number; reviewed_by: string; reviewed_at: number;
  extra: string;
};

export function insertDrawing(projectId: string, result: IngestResult, by: string, extra?: DrawingExtra): number {
  const d = db();
  const now = Date.now();
  const tx = d.transaction(() => {
    const { lastInsertRowid } = d.prepare(`
      INSERT INTO av_drawing (project_id, file_name, grade, scale_mm_per_unit, threshold, notes, uploaded_by, uploaded_at, extra)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(projectId, result.drawing, result.grade, result.scale_mm_per_unit, result.threshold,
        JSON.stringify(result.notes), by, now, extra ? JSON.stringify(extra) : '');
    const ins = d.prepare(`
      INSERT INTO av_extraction (drawing_id, element, value, unit, source, method, confidence, rule, note, needs_review)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const r of result.extractions) {
      ins.run(lastInsertRowid, r.element, r.value, r.unit, r.prov.source, r.prov.method,
        JSON.stringify(r.prov.confidence), r.prov.rule, r.prov.note, r.needs_review ? 1 : 0);
    }
    return Number(lastInsertRowid);
  });
  return tx();
}

export function getDrawing(id: number): StoredDrawing | null {
  const d = db();
  const row = d.prepare('SELECT * FROM av_drawing WHERE id = ?').get(id) as DrawingRow | undefined;
  if (!row) return null;
  const rows = d.prepare('SELECT * FROM av_extraction WHERE drawing_id = ? ORDER BY rowid').all(id) as ExtractionRow[];
  const extractions: IngestRecord[] = rows.map((r) => ({
    drawing: row.file_name,
    element: r.element,
    value: r.value,
    unit: r.unit,
    prov: {
      source: r.source, method: r.method as IngestRecord['prov']['method'],
      confidence: JSON.parse(r.confidence), rule: r.rule, note: r.note,
    },
    confirmed: !!r.confirmed,
    corrected: r.corrected,
    corrected_by: r.corrected_by,
    corrected_at: r.corrected_at,
    needs_review: !!r.needs_review,
  }));
  return {
    id: row.id,
    project_id: row.project_id,
    drawing: row.file_name,
    grade: row.grade as IngestResult['grade'],
    scale_mm_per_unit: row.scale_mm_per_unit,
    threshold: row.threshold,
    notes: JSON.parse(row.notes),
    may_enter_configuration: row.reviewed_at > 0,
    extractions,
    uploaded_by: row.uploaded_by,
    uploaded_at: row.uploaded_at,
    reviewed_by: row.reviewed_by,
    reviewed_at: row.reviewed_at,
    ...(row.extra ? { extra: JSON.parse(row.extra) as DrawingExtra } : {}),
  };
}

export function listDrawings(projectId: string): DrawingSummary[] {
  return (db().prepare(`
    SELECT d.id, d.project_id, d.file_name, d.grade, d.uploaded_by, d.uploaded_at, d.reviewed_by, d.reviewed_at,
      (SELECT COUNT(*) FROM av_extraction e WHERE e.drawing_id = d.id AND e.needs_review = 1 AND e.confirmed = 0) AS pending,
      (SELECT COUNT(*) FROM av_extraction e WHERE e.drawing_id = d.id AND e.needs_review = 1) AS flagged
    FROM av_drawing d WHERE d.project_id = ? ORDER BY d.uploaded_at DESC, d.id DESC`).all(projectId) as {
      id: number; project_id: string; file_name: string; grade: string; uploaded_by: string; uploaded_at: number;
      reviewed_by: string; reviewed_at: number; pending: number; flagged: number;
    }[]).map((r) => ({
      id: r.id, projectId: r.project_id, fileName: r.file_name, grade: r.grade as IngestResult['grade'],
      uploadedBy: r.uploaded_by, uploadedAt: r.uploaded_at, reviewedBy: r.reviewed_by, reviewedAt: r.reviewed_at,
      pending: r.pending, flagged: r.flagged,
    }));
}

export interface ReviewChange {
  element: DrawingElement;
  confirmed: boolean;
  corrected: number | null;
}

/* Apply the PM's confirmations to the stored drawing. Only `confirmed` and
   `corrected` are taken from the request; value, provenance and needs_review
   stay as the drawing service extracted them. Who and when come from the
   session. Returns the updated drawing. */
export function applyReview(id: number, changes: ReviewChange[], by: string): StoredDrawing {
  const d = db();
  const current = getDrawing(id);
  if (!current) throw new Error('图纸不存在');
  if (current.reviewed_at) throw new Error('该图纸已完成校核并锁定；如需修改请重新上传。');
  const known = new Map(current.extractions.map((r) => [r.element, r]));
  const at = new Date().toISOString();
  const upd = d.prepare(`
    UPDATE av_extraction SET confirmed = ?, confirmed_by = ?, corrected = ?, corrected_by = ?, corrected_at = ?
    WHERE drawing_id = ? AND element = ?`);
  d.transaction(() => {
    for (const c of changes) {
      const r = known.get(c.element);
      if (!r) throw new Error(`未知要素 ${c.element}`);
      const corrected = c.confirmed && c.corrected !== null && Number.isFinite(c.corrected) && c.corrected !== r.value
        ? Number(c.corrected) : null;
      if (corrected !== null && corrected < 0) throw new Error(`${c.element} 的人工值须为非负数`);
      /* keep the original stamp when an already-corrected value is re-sent unchanged */
      const same = corrected !== null && corrected === r.corrected;
      upd.run(
        c.confirmed ? 1 : 0, c.confirmed ? by : '',
        corrected, corrected === null ? '' : same ? r.corrected_by : by, corrected === null ? '' : same ? r.corrected_at : at,
        id, c.element,
      );
    }
  })();
  return getDrawing(id)!;
}

export function markReviewed(id: number, by: string): void {
  db().prepare('UPDATE av_drawing SET reviewed_by = ?, reviewed_at = ? WHERE id = ? AND reviewed_at = 0').run(by, Date.now(), id);
}

/* AV-019 §2.6:01 的「这块屏主要播放什么」「电脑由谁提供」 */
export interface InquiryAnswers extends PrjAnswers { play_use?: PlayUse | null; pc_by?: PcBy | null }

export interface Inquiry {
  projectId: string;
  location: string;
  notes: string;
  answers: InquiryAnswers;
  lines: BusinessLine[];
  packs: Partial<Record<BusinessLine, string>>;
  createdBy: string;
  createdAt: number;
}

/* Runs `createProject` and records the inquiry in one transaction, so a project
   never exists half-opened. */
export function openInquiry(inq0: Omit<Inquiry, 'createdAt' | 'answers'> & { answers?: InquiryAnswers }, createProject: () => void): Inquiry {
  const inq = { ...inq0, answers: inq0.answers ?? {} };
  const d = db();
  const createdAt = Date.now();
  d.transaction(() => {
    createProject();
    d.prepare(`INSERT INTO av_inquiry (project_id, location, notes, lines, packs, created_by, created_at, answers)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(inq.projectId, inq.location, inq.notes, JSON.stringify(inq.lines), JSON.stringify(inq.packs), inq.createdBy, createdAt, JSON.stringify(inq.answers));
  })();
  return { ...inq, createdAt };
}

/* AV-019:01 的两问(只存认得的值) */
export function setInquiryAnswers(projectId: string, a: InquiryAnswers): boolean {
  return db().prepare('UPDATE av_inquiry SET answers = ? WHERE project_id = ?').run(JSON.stringify(a), projectId).changes > 0;
}

/* AV-016:01 编辑已有项目时自动保存 —— 地点、补充说明(业务线和规则包立项后不改) */
export function updateInquiry(projectId: string, f: { location: string; notes: string }): boolean {
  return db().prepare('UPDATE av_inquiry SET location = ?, notes = ? WHERE project_id = ?').run(f.location, f.notes, projectId).changes > 0;
}

/* AV-019:已有项目重新保存时,用户确认后把 LED 规则包升级到最新一版(只改立项记录上的绑定;
   历史正式版本各自记着当时用的规则包,不动) */
export function setInquiryPack(projectId: string, line: BusinessLine, pack: string): boolean {
  const cur = getInquiry(projectId);
  if (!cur) return false;
  const packs = { ...cur.packs, [line]: pack };
  return db().prepare('UPDATE av_inquiry SET packs = ? WHERE project_id = ?').run(JSON.stringify(packs), projectId).changes > 0;
}

/* ===== AV-018 · 立项记录一定存在 =====
   av_inquiry 原来只在「01 新建询价」时建。项目页新建的、复制的、在 01 选已有项目的都没有,
   于是 01 的「项目地点」「需求补充说明」是灰的、改了也存不进去,02 还提示「未经 01 立项询价」。
   现在缺了就补建一条:业务线按项目已有的服务包推断;每条线的规则包取这条线最新正式方案用的
   那一版(没有方案就取当前最新)—— 和原来「没有记录就按最新算」的结果一致,只是从此记下来。 */
export function ensureInquiry(p: { id: string; packages: { svc: string }[] }, by = '系统补建'): Inquiry | null {
  const cur = getInquiry(p.id);
  if (cur) return cur;
  const lines = projectLines(p.packages.map((k) => k.svc)).filter(isAvailable);
  if (!lines.length) return null;
  const packs = Object.fromEntries(lines.map((l) => [l.line, latestConfig(p.id, l.line)?.packVersion || latestPackOf(l)])) as Partial<Record<BusinessLine, string>>;
  const now = Date.now();
  const made = db().prepare(`INSERT OR IGNORE INTO av_inquiry (project_id, location, notes, lines, packs, created_by, created_at)
    VALUES (?, '', '', ?, ?, ?, ?)`).run(p.id, JSON.stringify(lines.map((l) => l.line)), JSON.stringify(packs), by, now).changes;
  if (made) {
    const lp = { lines: lines.map((l) => `${l.label}（${packs[l.line]}）`).join('、') };
    appendAudit(p.id, [{ at: now, by, text: logZh('av.inquiryAuto', lp), k: 'av.inquiryAuto', p: lp }]);
  }
  return getInquiry(p.id);
}

/* 上线后第一次用到 AV 时,把所有「有 AV 服务包、却没有立项记录」的项目一次补齐(每个进程只扫一遍) */
let backfilled = false;
export function backfillInquiries(): number {
  if (backfilled) return 0;
  backfilled = true;
  let n = 0;
  for (const p of listProjects()) if (!getInquiry(p.id) && ensureInquiry(p)) n++;
  if (n) console.log(`[AV-018] 已为 ${n} 个 AV 项目补建立项记录`);
  return n;
}

export function getInquiry(projectId: string): Inquiry | null {
  const r = db().prepare('SELECT * FROM av_inquiry WHERE project_id = ?').get(projectId) as {
    project_id: string; location: string; notes: string; lines: string; packs: string; created_by: string; created_at: number; answers?: string;
  } | undefined;
  if (!r) return null;
  let answers: InquiryAnswers = {};
  try { answers = JSON.parse(r.answers || '{}'); } catch { /* 坏数据按没答 */ }
  return {
    projectId: r.project_id, location: r.location, notes: r.notes, answers,
    lines: JSON.parse(r.lines), packs: JSON.parse(r.packs), createdBy: r.created_by, createdAt: r.created_at,
  };
}

/* Called when a project is deleted, so its drawings and inquiry do not outlive it. */
export function deleteProjectDrawings(projectId: string): void {
  const d = db();
  d.transaction(() => {
    d.prepare('DELETE FROM av_inquiry WHERE project_id = ?').run(projectId);
    d.prepare('DELETE FROM av_config WHERE project_id = ?').run(projectId);
    draftTable();
    d.prepare('DELETE FROM av_config_draft_u WHERE project_id = ?').run(projectId);
    d.prepare('DELETE FROM av_cost_sheet WHERE project_id = ?').run(projectId);
    d.prepare('DELETE FROM av_quote WHERE project_id = ?').run(projectId);
    d.prepare('DELETE FROM av_extraction WHERE drawing_id IN (SELECT id FROM av_drawing WHERE project_id = ?)').run(projectId);
    d.prepare('DELETE FROM av_drawing WHERE project_id = ?').run(projectId);
  })();
}

/* ===== price library ===== */

type PriceRow = {
  id: number; line: string; category: string; category_label: string; model: string; pitch: string;
  module_size: string; cabinet_size: string; unit: string; cost_price: number | null; list_price: number | null;
  currency: string; source: string; valid_until: string; active: number; updated_by: string; updated_at: number; spec?: string;
};
const parseSpec = (v: string | undefined): PriceItem['spec'] => { if (!v) return null; try { return JSON.parse(v) as PriceItem['spec']; } catch { return null; } };
const toItem = (r: PriceRow): PriceItem => ({
  id: r.id, line: r.line as BusinessLine, category: r.category, categoryLabel: r.category_label, model: r.model,
  pitch: r.pitch, moduleSize: r.module_size, cabinetSize: r.cabinet_size, unit: r.unit, costPrice: r.cost_price,
  listPrice: r.list_price, currency: r.currency, source: r.source, validUntil: r.valid_until, active: !!r.active,
  updatedBy: r.updated_by, updatedAt: r.updated_at, spec: parseSpec(r.spec),
});

/* AV-018:以前手工新增的 LED 条目,分类代码存的是中文标签(和标签一模一样)—— 映射一次成内部代码。
   只动「代码 = 标签」且能认出来的行,导入的条目(代码本来就对)不受影响;每个进程只跑一次 */
let categoriesFixed = false;
function fixPriceCategories() {
  if (categoriesFixed) return;
  categoriesFixed = true;
  const d = db();
  const rows = d.prepare('SELECT id, category, category_label FROM av_price_item WHERE category = category_label').all() as { id: number; category: string; category_label: string }[];
  const up = d.prepare('UPDATE av_price_item SET category = ? WHERE id = ?');
  let n = 0;
  for (const r of rows) {
    const code = categoryCode(r.category_label);
    if (code !== r.category) { up.run(code, r.id); n++; }
  }
  if (n) console.log(`[AV-018] 价格库:${n} 条手工条目的分类映射为内部代码`);
}

export function listPriceItems(line?: BusinessLine): PriceItem[] {
  fixPriceCategories();
  const rows = (line
    ? db().prepare('SELECT * FROM av_price_item WHERE line = ? ORDER BY id').all(line)
    : db().prepare('SELECT * FROM av_price_item ORDER BY line, id').all()) as PriceRow[];
  return rows.map(toItem);
}

export type PriceInput = Omit<PriceItem, 'id' | 'updatedBy' | 'updatedAt'>;

export function createPriceItem(it: PriceInput, by: string): PriceItem {
  const d = db();
  const now = Date.now();
  const { lastInsertRowid } = d.prepare(`
    INSERT INTO av_price_item (line, category, category_label, model, pitch, module_size, cabinet_size, unit,
      cost_price, list_price, currency, source, valid_until, active, updated_by, updated_at, spec)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(it.line, it.category, it.categoryLabel, it.model, it.pitch, it.moduleSize, it.cabinetSize, it.unit,
      it.costPrice, it.listPrice, it.currency, it.source, it.validUntil, it.active ? 1 : 0, by, now, it.spec ? JSON.stringify(it.spec) : '');
  const id = Number(lastInsertRowid);
  d.prepare('INSERT INTO av_price_history (item_id, cost_price, list_price, valid_until, changed_by, changed_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, it.costPrice, it.listPrice, it.validUntil, by, now);
  return toItem(d.prepare('SELECT * FROM av_price_item WHERE id = ?').get(id) as PriceRow);
}

/* Edit an item. A change to either price or to the validity date is kept in
   the history, so "what did this cost in June" stays answerable. */
export function updatePriceItem(id: number, patch: Partial<PriceInput>, by: string): PriceItem {
  const d = db();
  const cur = d.prepare('SELECT * FROM av_price_item WHERE id = ?').get(id) as PriceRow | undefined;
  if (!cur) throw new Error('价格条目不存在');
  const next = { ...toItem(cur), ...patch };
  const now = Date.now();
  d.transaction(() => {
    d.prepare(`UPDATE av_price_item SET category = ?, category_label = ?, model = ?, pitch = ?, module_size = ?,
      cabinet_size = ?, unit = ?, cost_price = ?, list_price = ?, currency = ?, source = ?, valid_until = ?, active = ?,
      updated_by = ?, updated_at = ?, spec = ? WHERE id = ?`)
      .run(next.category, next.categoryLabel, next.model, next.pitch, next.moduleSize, next.cabinetSize, next.unit,
        next.costPrice, next.listPrice, next.currency, next.source, next.validUntil, next.active ? 1 : 0, by, now,
        next.spec ? JSON.stringify(next.spec) : '', id);
    if (next.costPrice !== cur.cost_price || next.listPrice !== cur.list_price || next.validUntil !== cur.valid_until) {
      d.prepare('INSERT INTO av_price_history (item_id, cost_price, list_price, valid_until, changed_by, changed_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, next.costPrice, next.listPrice, next.validUntil, by, now);
    }
  })();
  return toItem(d.prepare('SELECT * FROM av_price_item WHERE id = ?').get(id) as PriceRow);
}

export function priceHistory(itemId: number) {
  return db().prepare('SELECT cost_price, list_price, valid_until, changed_by, changed_at FROM av_price_history WHERE item_id = ? ORDER BY changed_at DESC, id DESC')
    .all(itemId) as { cost_price: number | null; list_price: number | null; valid_until: string; changed_by: string; changed_at: number }[];
}

/* Import a price list. Rows already present (same source, category, model,
   pitch and cabinet) are skipped, so importing twice does not duplicate. */
export function importPriceItems(items: PriceInput[], by: string): { added: number; skipped: number } {
  const d = db();
  const exists = d.prepare(`SELECT 1 FROM av_price_item WHERE source = ? AND category = ? AND model = ? AND pitch = ? AND cabinet_size = ? AND line = ?`);
  let added = 0, skipped = 0;
  d.transaction(() => {
    for (const it of items) {
      if (exists.get(it.source, it.category, it.model, it.pitch, it.cabinetSize, it.line)) { skipped++; continue; }
      createPriceItem(it, by);
      added++;
    }
  })();
  return { added, skipped };
}

/* ===== company settings ===== */

export const MARGIN_FLOOR_DEFAULT = 0.18; // the prototype's 公司下限 18%

export function getMarginFloor(): number {
  const r = db().prepare("SELECT value FROM av_setting WHERE key = 'margin_floor'").get() as { value: string } | undefined;
  return r ? Number(r.value) : MARGIN_FLOOR_DEFAULT;
}

export function setMarginFloor(v: number, by: string): void {
  db().prepare(`INSERT INTO av_setting (key, value, updated_by, updated_at) VALUES ('margin_floor', ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
    .run(String(v), by, Date.now());
}

/* ===== 05 configuration saves (§10 config_result) ===== */

export function saveConfig<S extends SummaryBase>(c: Omit<SavedConfig<S>, 'id' | 'createdAt'>, cfg: unknown): SavedConfig<S> {
  const createdAt = Date.now();
  const { lastInsertRowid } = db().prepare(`INSERT INTO av_config (project_id, line, pack_version, drawing_id, cfg, summary, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(c.projectId, c.line, c.packVersion, c.drawingId, JSON.stringify(cfg), JSON.stringify(c.summary), c.createdBy, createdAt);
  return { ...c, id: Number(lastInsertRowid), createdAt };
}

type ConfigRow = { id: number; project_id: string; line: string; pack_version: string; drawing_id: number | null; cfg: string; summary: string; created_by: string; created_at: number };

/* ===== AV-016 ② · 05 的自动草稿 =====
   每人一份:按 项目 × 业务线 × 用户 存(av_config_draft_u),两个人同时改互不覆盖。
   存成正式版本(av_config 新一行)时只清掉保存人自己的草稿。草稿不进 06:成本只按正式版本算。

   0930 的先行版是「每个项目每条线一份」(av_config_draft)。那张表的行第一次用到时
   原样搬进新表、归到当时最后写的那个人名下(按姓名找账号;找不到的记作 0 号,
   只会出现在「别人的草稿」提示里),旧表留着不删。 */
let draftReady = false;
function draftTable() {
  if (draftReady) return;
  const d = db();
  d.exec(`CREATE TABLE IF NOT EXISTS av_config_draft (
    project_id TEXT NOT NULL,
    line TEXT NOT NULL,
    cfg TEXT NOT NULL,
    drawing_id INTEGER,
    updated_by TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (project_id, line)
  );
  CREATE TABLE IF NOT EXISTS av_config_draft_u (
    project_id TEXT NOT NULL,
    line TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    cfg TEXT NOT NULL,
    drawing_id INTEGER,
    updated_by TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (project_id, line, user_id)
  )`);
  d.transaction(() => {
    d.exec(`INSERT OR IGNORE INTO av_config_draft_u (project_id, line, user_id, cfg, drawing_id, updated_by, updated_at)
      SELECT o.project_id, o.line, COALESCE((SELECT u.id FROM users u WHERE u.name = o.updated_by ORDER BY u.id LIMIT 1), 0),
        o.cfg, o.drawing_id, o.updated_by, o.updated_at FROM av_config_draft o`);
    d.exec('DELETE FROM av_config_draft');
  })();
  draftReady = true;   // 搬迁成功之后才算好;失败(比如库忙)下次再试
}
export interface ConfigDraft { cfg: unknown; drawingId: number | null; updatedBy: string; updatedAt: number }
export interface DraftOwner { userId: number; updatedBy: string; updatedAt: number }
type DraftRow = { cfg: string; drawing_id: number | null; user_id: number; updated_by: string; updated_at: number };
export function getDraft(projectId: string, line: BusinessLine, userId: number): ConfigDraft | null {
  draftTable();
  const r = db().prepare('SELECT * FROM av_config_draft_u WHERE project_id = ? AND line = ? AND user_id = ?').get(projectId, line, userId) as DraftRow | undefined;
  return r ? { cfg: JSON.parse(r.cfg), drawingId: r.drawing_id, updatedBy: r.updated_by, updatedAt: r.updated_at } : null;
}
/* 这条线上谁有草稿(新的在前)。05 用它提示「Skye 有未保存的草稿」,步骤条用它显示「草稿」。
   只算最新正式版本之后还动过的:早于正式版本的草稿已经被那一版盖过了,不该让项目一直挂「草稿」
   (老表搬过来、找不到账号的那几份也一样,下一次正式保存后就不再提示) */
export function draftOwners(projectId: string, line: BusinessLine): DraftOwner[] {
  draftTable();
  const since = (db().prepare('SELECT MAX(created_at) AS t FROM av_config WHERE project_id = ? AND line = ?').get(projectId, line) as { t: number | null }).t ?? 0;
  return (db().prepare('SELECT user_id, updated_by, updated_at FROM av_config_draft_u WHERE project_id = ? AND line = ? AND updated_at > ? ORDER BY updated_at DESC')
    .all(projectId, line, since) as DraftRow[]).map((r) => ({ userId: r.user_id, updatedBy: r.updated_by, updatedAt: r.updated_at }));
}
export function saveDraft(projectId: string, line: BusinessLine, cfg: unknown, drawingId: number | null, user: { id: number; name: string }): ConfigDraft {
  draftTable();
  const now = Date.now();
  db().prepare(`INSERT INTO av_config_draft_u (project_id, line, user_id, cfg, drawing_id, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(project_id, line, user_id) DO UPDATE SET cfg = excluded.cfg, drawing_id = excluded.drawing_id, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
    .run(projectId, line, user.id, JSON.stringify(cfg), drawingId, user.name, now);
  return { cfg, drawingId, updatedBy: user.name, updatedAt: now };
}
export function clearDraft(projectId: string, line: BusinessLine, userId: number): void {
  draftTable();
  db().prepare('DELETE FROM av_config_draft_u WHERE project_id = ? AND line = ? AND user_id = ?').run(projectId, line, userId);
}

/* AV-017: 正式版本号 = 这个项目这条线存过几次方案(第 N 次保存就是 vN) */
export function configCount(projectId: string, line: BusinessLine): number {
  return (db().prepare('SELECT count(*) AS n FROM av_config WHERE project_id = ? AND line = ?').get(projectId, line) as { n: number }).n;
}

export function latestConfig<S extends SummaryBase = SummaryBase>(projectId: string, line: BusinessLine): (SavedConfig<S> & { cfg: unknown }) | null {
  const r = db().prepare('SELECT * FROM av_config WHERE project_id = ? AND line = ? ORDER BY id DESC LIMIT 1').get(projectId, line) as ConfigRow | undefined;
  return r ? {
    id: r.id, projectId: r.project_id, line: r.line as BusinessLine, packVersion: r.pack_version, drawingId: r.drawing_id,
    summary: JSON.parse(r.summary) as S, createdBy: r.created_by, createdAt: r.created_at, cfg: JSON.parse(r.cfg),
  } : null;
}

/* ===== cost sheets ===== */

export interface CostSheet {
  id: number;
  projectId: string;
  line: BusinessLine;
  configId: number;
  lines: CostLine[];
  cost: number;
  list: number;
  status: 'draft' | 'confirmed';
  createdBy: string;
  createdAt: number;
  confirmedBy: string;
  confirmedAt: number;
}

type SheetRow = { id: number; project_id: string; line: string; config_id: number; lines: string; cost: number; list: number;
  status: string; created_by: string; created_at: number; confirmed_by: string; confirmed_at: number };
const toSheet = (r: SheetRow): CostSheet => ({
  id: r.id, projectId: r.project_id, line: r.line as BusinessLine, configId: r.config_id, lines: JSON.parse(r.lines),
  cost: r.cost, list: r.list, status: r.status as CostSheet['status'], createdBy: r.created_by, createdAt: r.created_at,
  confirmedBy: r.confirmed_by, confirmedAt: r.confirmed_at,
});

export function saveCostSheet(s: Pick<CostSheet, 'projectId' | 'line' | 'configId' | 'lines' | 'cost' | 'list'>, by: string, confirm: boolean): CostSheet {
  const now = Date.now();
  const { lastInsertRowid } = db().prepare(`INSERT INTO av_cost_sheet (project_id, line, config_id, lines, cost, list, status, created_by, created_at, confirmed_by, confirmed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(s.projectId, s.line, s.configId, JSON.stringify(s.lines), s.cost, s.list, confirm ? 'confirmed' : 'draft', by, now,
      confirm ? by : '', confirm ? now : 0);
  return toSheet(db().prepare('SELECT * FROM av_cost_sheet WHERE id = ?').get(Number(lastInsertRowid)) as SheetRow);
}

export function latestCostSheet(projectId: string, line: BusinessLine): CostSheet | null {
  const r = db().prepare('SELECT * FROM av_cost_sheet WHERE project_id = ? AND line = ? ORDER BY id DESC LIMIT 1').get(projectId, line) as SheetRow | undefined;
  return r ? toSheet(r) : null;
}

/* ===== 07 quotations =====
   A quotation freezes the sections it was built from, the discount, the GST
   rate and the margin floor of the day, so the document reads the same later.
   So are the cross-line savings it took off (xline.ts).
   Submitting a new one supersedes a quotation still waiting for approval. */

export type QuoteStatus = 'submitted' | 'approved' | 'rejected' | 'superseded';

export interface Quote {
  id: number;
  projectId: string;
  sections: QuoteSection[];
  dedup: Deduction[];
  discountPct: number;
  gstRate: number;
  marginFloor: number;
  reason: string;
  status: QuoteStatus;
  submittedBy: string;
  submittedAt: number;
  decidedBy: string;
  decidedAt: number;
  decisionNote: string;
}

type QuoteRow = { id: number; project_id: string; sections: string; dedup: string; discount_pct: number; gst_rate: number; margin_floor: number;
  reason: string; status: string; submitted_by: string; submitted_at: number; decided_by: string; decided_at: number; decision_note: string };
const toQuote = (r: QuoteRow): Quote => ({
  id: r.id, projectId: r.project_id, sections: JSON.parse(r.sections), dedup: JSON.parse(r.dedup), discountPct: r.discount_pct, gstRate: r.gst_rate,
  marginFloor: r.margin_floor, reason: r.reason, status: r.status as QuoteStatus, submittedBy: r.submitted_by,
  submittedAt: r.submitted_at, decidedBy: r.decided_by, decidedAt: r.decided_at, decisionNote: r.decision_note,
});

export function createQuote(q: Pick<Quote, 'projectId' | 'sections' | 'dedup' | 'discountPct' | 'gstRate' | 'marginFloor' | 'reason'>, by: string): Quote {
  const d = db();
  const id = d.transaction(() => {
    d.prepare("UPDATE av_quote SET status = 'superseded' WHERE project_id = ? AND status = 'submitted'").run(q.projectId);
    return Number(d.prepare(`INSERT INTO av_quote (project_id, sections, dedup, discount_pct, gst_rate, margin_floor, reason, submitted_by, submitted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(q.projectId, JSON.stringify(q.sections), JSON.stringify(q.dedup), q.discountPct, q.gstRate, q.marginFloor, q.reason, by, Date.now()).lastInsertRowid);
  })();
  return getQuote(id)!;
}

export function getQuote(id: number): Quote | null {
  const r = db().prepare('SELECT * FROM av_quote WHERE id = ?').get(id) as QuoteRow | undefined;
  return r ? toQuote(r) : null;
}

export function listQuotes(projectId: string): Quote[] {
  return (db().prepare('SELECT * FROM av_quote WHERE project_id = ? ORDER BY id DESC').all(projectId) as QuoteRow[]).map(toQuote);
}

/* Only a quotation still waiting can be decided; false when it no longer is. */
export function decideQuote(id: number, status: 'approved' | 'rejected', by: string, note: string): boolean {
  return db().prepare(`UPDATE av_quote SET status = ?, decided_by = ?, decided_at = ?, decision_note = ? WHERE id = ? AND status = 'submitted'`)
    .run(status, by, Date.now(), note, id).changes === 1;
}

/* ===== 历史案例 (ported from avcost-phase1, 2026-09-28; AV-014 2026-09-29) =====
   公司的《All the Project Links》统计表是正本,案例库是它两张 LED 工作表的
   可检索副本。

   AV-014 之后多了一层:人可以在平台上直接改。原始导入值仍然只存在 av_case
   (导入逻辑不变),人工值另放 av_case_edit —— 所以「重新导入整张表」冲不掉
   人改过的东西。页面看到的 = 原始值叠加人工值,下面统一叫**有效值**。

   排序和筛选都按有效值算,而且都在 SQL 里做:列表有 500 条上限,前端排序
   只排得到前 500 条,那是错的。 */

/** 保修期默认 12 个月(AV-014 §3.3)。等于默认值时不写 av_case_edit ——
 *  不然每块屏都挂一条「人工修改」,「已人工修改 · N 项」就没意义了。 */
export const DEFAULT_WARRANTY_MONTHS = 12;

export interface HistCase {
  id: number;
  sourceSheet: string;
  status: 'ongoing' | 'completed';
  refNo: string | null;
  year: number | null;
  name: string;
  client: string | null;
  address: string | null;
  widthMm: number | null;
  heightMm: number | null;
  sqm: number | null;
  pitch: number | null;
  modules: number | null;
  kw: number | null;
  powerCable: string | null;
  dataCable: string | null;
  product: string | null;
  remarks: string | null;
}

/** 页面拿到的一块屏:有效值 + AV-014 新增的几样。 */
export interface CaseRow extends HistCase {
  caseKey: string;
  /** 统计表里已经没有它了,但有人工修改所以留着(AV-014 §4) */
  missing: boolean;
  handover: string | null;          // YYYY-MM-DD,手填
  warrantyMonths: number;           // 默认 12
  expire: string | null;            // = handover + warrantyMonths,自动算
  /** 年份列显示的值:统计表年份,没有就取交付年份(§3.3) */
  effYear: number | null;
  manualFields: string[];           // 人工改过哪些字段
  /** 这一次到期已经有人联系过客户(谁、何时);到期日变了就回到 null */
  contactedBy: string | null;
  contactedAt: number | null;
}

type FieldType = 'text' | 'int' | 'real';
interface CaseField { key: string; col: string | null; type: FieldType }

/* 可编辑字段。col = null 表示统计表里没有这一项(交付日期、保修期),
   它们只可能来自人工填写。 */
const CASE_FIELDS: CaseField[] = [
  { key: 'name', col: 'name', type: 'text' },
  { key: 'client', col: 'client', type: 'text' },
  { key: 'year', col: 'year', type: 'int' },
  { key: 'address', col: 'address', type: 'text' },
  { key: 'status', col: 'status', type: 'text' },
  { key: 'refNo', col: 'ref_no', type: 'text' },
  { key: 'widthMm', col: 'width_mm', type: 'real' },
  { key: 'heightMm', col: 'height_mm', type: 'real' },
  { key: 'sqm', col: 'sqm', type: 'real' },
  { key: 'pitch', col: 'pitch', type: 'real' },
  { key: 'product', col: 'product', type: 'text' },
  { key: 'modules', col: 'modules', type: 'int' },
  { key: 'kw', col: 'kw', type: 'real' },
  { key: 'powerCable', col: 'power_cable', type: 'text' },
  { key: 'dataCable', col: 'data_cable', type: 'text' },
  { key: 'remarks', col: 'remarks', type: 'text' },
  { key: 'handover', col: null, type: 'text' },
  { key: 'warrantyMonths', col: null, type: 'int' },
];
export const CASE_FIELD_KEYS = CASE_FIELDS.map((f) => f.key);
const FIELD_BY_KEY = new Map(CASE_FIELDS.map((f) => [f.key, f]));

/* ---- 有效值视图 ----
   e 把 av_case_edit 竖表转成每块屏一行;v 逐字段叠加;w 再算依赖叠加结果的
   两样(到期日、年份口径)—— SQLite 不让在同一个 SELECT 里引用自己的别名,
   所以分了一层。 */
const editExpr = (f: CaseField) => {
  const e = `e."${f.key}"`;
  const cast = f.type === 'text' ? e : `CAST(${e} AS ${f.type === 'int' ? 'INTEGER' : 'REAL'})`;
  if (!f.col) {
    const dflt = f.key === 'warrantyMonths' ? String(DEFAULT_WARRANTY_MONTHS) : 'NULL';
    return `CASE WHEN ${e} IS NULL OR ${e} = '' THEN ${dflt} ELSE ${cast} END AS "${f.key}"`;
  }
  /* value = '' 是「人工清空」,与「没改过」(NULL)必须分得开 */
  return `CASE WHEN ${e} IS NULL THEN c.${f.col} WHEN ${e} = '' THEN NULL ELSE ${cast} END AS "${f.key}"`;
};

const EFF_VIEW = `
  WITH e AS (
    SELECT case_key,
      ${CASE_FIELDS.map((f) => `MAX(CASE WHEN field = '${f.key}' THEN value END) AS "${f.key}"`).join(',\n      ')},
      count(*) AS manualCount, group_concat(field) AS manualList
    FROM av_case_edit GROUP BY case_key
  ),
  v AS (
    SELECT c.id, c.case_key AS caseKey, c.missing, c.source_sheet AS sourceSheet,
      ${CASE_FIELDS.map(editExpr).join(',\n      ')},
      IFNULL(e.manualCount, 0) AS manualCount, e.manualList
    FROM av_case c LEFT JOIN e ON e.case_key = c.case_key
  ),
  w0 AS (
    SELECT v.*,
      /* SQLite 的月加法会把溢出的日子进位(1 月 31 日 + 1 个月 = 3 月 3 日),
         与前端 Date.setMonth 一致 —— 两边算出来的到期日不会打架。 */
      CASE WHEN handover IS NOT NULL AND handover <> ''
           THEN date(handover, '+' || warrantyMonths || ' months') END AS expire,
      CASE WHEN year IS NOT NULL THEN year
           WHEN handover IS NOT NULL AND handover <> '' THEN CAST(strftime('%Y', handover) AS INTEGER) END AS effYear
    FROM v
  ),
  /* 这一次到期有没有人标过「已联系」—— 按当前到期日对,到期日变了就对不上 */
  w AS (
    SELECT w0.*, r.by AS contactedBy, r.at AS contactedAt
    FROM w0 LEFT JOIN av_case_remind r ON r.case_key = w0.caseKey AND r.expire = w0.expire
  )`;

export interface CaseFilter {
  q?: string;
  status?: string;
  pitchMin?: number;
  pitchMax?: number;
  sqmMin?: number;
  sqmMax?: number;
  /** 年份多选,'none' = 未填年份(§3.2) */
  years?: string[];
  clients?: string[];
  /** 保修状态多选(§7 第 3 条):ok 在保 / soon 30 天内到期 / expired 已过保 / none 未填 */
  warranty?: string[];
  /** 交付日期范围,YYYY-MM-DD,含两端 */
  handoverFrom?: string;
  handoverTo?: string;
  /** '0' = 这次到期还没人联系过,'1' = 已联系(「我的待办」提醒用) */
  contacted?: string;
}

/** 「快到期」的窗口:距今 0–30 天(含两端),与页面上的琥珀色标签同一口径。 */
export const WARRANTY_SOON_DAYS = 30;

/** 服务器本地的「今天」。保修状态按它算 —— 内网服务器在新加坡,和同事看到的
 *  日子是同一天;不用 SQLite 的 date('now'),那是 UTC,早上八点前会差一天。 */
export function localToday(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/* 保修状态 → SQL 条件。? 依次是 today(、today)。 */
const WARRANTY_SQL: Record<string, { sql: string; n: number }> = {
  expired: { sql: 'expire < ?', n: 1 },
  soon: { sql: `(expire >= ? AND expire <= date(?, '+${WARRANTY_SOON_DAYS} days'))`, n: 2 },
  ok: { sql: `expire > date(?, '+${WARRANTY_SOON_DAYS} days')`, n: 1 },
  none: { sql: 'expire IS NULL', n: 0 },
};
export const WARRANTY_STATES = Object.keys(WARRANTY_SQL);

/* 排序白名单。前端传来的列名绝不拼进 ORDER BY —— 只认这张表里的 key。 */
const SORTS: Record<string, { expr: string; def: 'asc' | 'desc' }> = {
  sqm: { expr: 'sqm', def: 'desc' },
  year: { expr: 'effYear', def: 'desc' },
  handover: { expr: 'handover', def: 'desc' },
  expire: { expr: 'expire', def: 'asc' },
  name: { expr: 'lower(name)', def: 'asc' },
  client: { expr: 'lower(client)', def: 'asc' },
  pitch: { expr: 'pitch', def: 'asc' },
  kw: { expr: 'kw', def: 'desc' },
};
export const CASE_SORT_KEYS = Object.keys(SORTS);
export const caseSortDefaultDir = (k: string): 'asc' | 'desc' => SORTS[k]?.def ?? 'desc';

type CaseDbRow = Omit<CaseRow, 'missing' | 'manualFields'> & { missing: number; manualList: string | null };

const toCaseRow = (r: CaseDbRow): CaseRow => ({
  ...r,
  missing: !!r.missing,
  manualFields: r.manualList ? r.manualList.split(',') : [],
});

export function searchCases(
  f: CaseFilter,
  sortKey = 'sqm',
  dir?: 'asc' | 'desc',
  limit = 500,
): { cases: CaseRow[]; total: number } {
  const where: string[] = [];
  const args: (string | number)[] = [];
  const q = f.q?.trim();
  if (q) {
    where.push(`(name || ' ' || IFNULL(client,'') || ' ' || IFNULL(address,'') || ' ' || IFNULL(product,'') || ' ' ||
      IFNULL(refNo,'') || ' ' || IFNULL(remarks,'')) LIKE ? ESCAPE '\\'`);
    args.push(`%${q.replace(/[\\%_]/g, (c) => '\\' + c)}%`);
  }
  if (f.status) { where.push('status = ?'); args.push(f.status); }
  for (const [col, lo, hi] of [['pitch', f.pitchMin, f.pitchMax], ['sqm', f.sqmMin, f.sqmMax]] as const) {
    if (lo !== undefined) { where.push(`${col} >= ?`); args.push(lo); }
    if (hi !== undefined) { where.push(`${col} <= ?`); args.push(hi); }
  }
  /* 同一类里多选是 OR,类与类之间是 AND(§3.2) */
  if (f.years?.length) {
    const ys = f.years.filter((y) => y === 'none' || /^\d{4}$/.test(y));
    if (ys.length) {
      const nums = ys.filter((y) => y !== 'none');
      const parts: string[] = [];
      if (nums.length) { parts.push(`effYear IN (${nums.map(() => '?').join(',')})`); args.push(...nums.map(Number)); }
      if (ys.includes('none')) parts.push('effYear IS NULL');
      where.push(`(${parts.join(' OR ')})`);
    }
  }
  if (f.clients?.length) {
    where.push(`client IN (${f.clients.map(() => '?').join(',')})`);
    args.push(...f.clients);
  }
  if (f.warranty?.length) {
    const today = localToday();
    const parts = f.warranty.filter((w) => WARRANTY_SQL[w]).map((w) => {
      for (let i = 0; i < WARRANTY_SQL[w].n; i++) args.push(today);
      return WARRANTY_SQL[w].sql;
    });
    if (parts.length) where.push(`(${parts.join(' OR ')})`);
  }
  const isDate = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
  if (isDate(f.handoverFrom)) { where.push('handover >= ?'); args.push(f.handoverFrom!); }
  if (isDate(f.handoverTo)) { where.push('handover <= ?'); args.push(f.handoverTo!); }
  if (f.contacted === '0') where.push('contactedAt IS NULL');
  if (f.contacted === '1') where.push('contactedAt IS NOT NULL');

  const s = SORTS[sortKey] ?? SORTS.sqm;
  const d = (dir === 'asc' || dir === 'desc') ? dir : s.def;
  /* 空值永远排最后,不论升降序(§3.1);同值按导入顺序稳定排。 */
  const order = `${s.expr} IS NULL, ${s.expr} ${d === 'asc' ? 'ASC' : 'DESC'}, id`;
  const cond = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const conn = db();
  const total = (conn.prepare(`${EFF_VIEW} SELECT count(*) AS n FROM w ${cond}`).get(...args) as { n: number }).n;
  const rows = conn.prepare(`${EFF_VIEW} SELECT * FROM w ${cond} ORDER BY ${order} LIMIT ?`)
    .all(...args, limit) as CaseDbRow[];
  return { cases: rows.map(toCaseRow), total };
}

/** 「筛选」浮层的选项:整个库里出现过的年份与客户,各带块屏数(§3.2)。
 *  口径与年份列显示值一致 —— 用的是同一个 effYear。 */
export function caseFacets(): {
  years: { year: string; n: number }[]; clients: { client: string; n: number }[];
  warranty: Record<string, number>;
} {
  const conn = db();
  const years = conn.prepare(`${EFF_VIEW}
    SELECT IFNULL(CAST(effYear AS TEXT), 'none') AS year, count(*) AS n FROM w
    GROUP BY effYear ORDER BY effYear IS NULL, effYear DESC`).all() as { year: string; n: number }[];
  const clients = conn.prepare(`${EFF_VIEW}
    SELECT client, count(*) AS n FROM w WHERE client IS NOT NULL AND client <> ''
    GROUP BY client ORDER BY lower(client)`).all() as { client: string; n: number }[];
  /* 各保修状态的块屏数 —— 筛选浮层上的数字,也是「我的待办」里提醒的来源 */
  const today = localToday();
  const warranty: Record<string, number> = {};
  for (const [k, w] of Object.entries(WARRANTY_SQL)) {
    warranty[k] = (conn.prepare(`${EFF_VIEW} SELECT count(*) AS n FROM w WHERE ${w.sql}`)
      .get(...Array(w.n).fill(today)) as { n: number }).n;
  }
  return { years, clients, warranty };
}

/* ---- case_key:一块屏跨多次导入的身份(§4) ----
   用**原始导入值**算,不用编辑后的值 —— 否则谁改了项目名,下次导入就对不
   上了。不含工作表 / 状态:项目从「进行中」表挪到「已完成」表,人工修改要
   跟着走。 */
const norm = (s: string | null | undefined) => (s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
const mm = (v: number | null | undefined) => (v == null ? '' : String(Math.round(v)));

export const caseKeyOf = (c: Pick<HistCase, 'name' | 'client' | 'widthMm' | 'heightMm'>) =>
  [norm(c.name), norm(c.client), mm(c.widthMm), mm(c.heightMm)].join('|');

/** 同一次导入里完全相同的多块屏(8SW 那种)加出现序号区分。 */
function keysFor(cases: Pick<HistCase, 'name' | 'client' | 'widthMm' | 'heightMm'>[]): string[] {
  const seen = new Map<string, number>();
  return cases.map((c) => {
    const base = caseKeyOf(c);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}#${n}`;
  });
}

/** 演示模式的示例屏(数据在 demo.ts)。直接用传进来的连接写 —— 这时还在
 *  db() 的初始化里,调 db() 会重入。交付日期 / 非默认保修期走 av_case_edit,
 *  和真人填的一模一样,所以页面上会标「已人工修改」,那是如实的。 */
function seedDemoCases(d: ReturnType<typeof getDb>): void {
  const rows = DEMO_CASES.map((c) => ({
    sourceSheet: c.sheet === 'ongoing' ? 'LED ongoing project' : 'LED completed project',
    status: c.sheet, refNo: c.refNo, year: c.year, name: c.name, client: c.client, address: c.address,
    widthMm: c.w, heightMm: c.h, sqm: c.sqm, pitch: c.pitch, modules: c.modules, kw: c.kw,
    powerCable: c.pc, dataCable: c.dc, product: c.product, remarks: c.remarks,
  }));
  const keys = keysFor(rows);
  const at = Date.now();
  const ins = d.prepare(`INSERT INTO av_case (case_key, missing, source_sheet, status, ref_no, year, name, client, address,
    width_mm, height_mm, sqm, pitch, modules, kw, power_cable, data_cable, product, remarks, imported_by, imported_at)
    VALUES (@caseKey, 0, @sourceSheet, @status, @refNo, @year, @name, @client, @address,
    @widthMm, @heightMm, @sqm, @pitch, @modules, @kw, @powerCable, @dataCable, @product, @remarks, '演示数据', @at)`);
  const edit = d.prepare('INSERT INTO av_case_edit (case_key, field, value, edited_by, edited_at) VALUES (?, ?, ?, ?, ?)');
  d.transaction(() => {
    rows.forEach((r, i) => {
      ins.run({ ...r, caseKey: keys[i], at });
      const c = DEMO_CASES[i];
      if (c.handover) edit.run(keys[i], 'handover', c.handover, '演示数据', at);
      if (c.warrantyMonths !== DEFAULT_WARRANTY_MONTHS) edit.run(keys[i], 'warrantyMonths', String(c.warrantyMonths), '演示数据', at);
    });
  })();
}

/** AV-012 时代导入的行没有 case_key,补算一次。 */
function backfillCaseKeys(d: ReturnType<typeof getDb>): void {
  const rows = d.prepare('SELECT id, name, client, width_mm AS widthMm, height_mm AS heightMm FROM av_case ORDER BY id')
    .all() as { id: number; name: string; client: string | null; widthMm: number | null; heightMm: number | null }[];
  if (!rows.length) return;
  const keys = keysFor(rows);
  const up = d.prepare('UPDATE av_case SET case_key = ? WHERE id = ?');
  d.transaction(() => { rows.forEach((r, i) => up.run(keys[i], r.id)); })();
}

/* ---- 重新导入(§4)----
   两步:先 dry-run 出预览,确认后才写。统计表是正本,但人改过的字段和手填
   的交付日期 / 保修期一律保留。 */
export interface ImportPreview {
  added: number;
  updated: number;
  manualFields: number;      // 会保留的人工字段数
  manualScreens: number;     // 涉及几块屏
  handoverKept: number;      // 保留了手填交付日期的屏
  removed: number;           // 统计表里没有了、也没人改过 → 移除
  keptMissing: number;       // 统计表里没有了、但有人工修改 → 保留并标记
}

const val = (v: unknown): string => (v == null ? '' : String(v));
/** 人工值与原始值是否已经一样了 —— 数值按数比,文本按串比。 */
function sameAsRaw(f: CaseField, edit: string, raw: unknown): boolean {
  if (f.type === 'text') return edit === val(raw);
  if (edit === '') return raw == null;
  const a = Number(edit);
  return Number.isFinite(a) && raw != null && a === Number(raw);
}

export function applyImport(
  incoming: Omit<HistCase, 'id'>[],
  by: string,
  opts: { dryRun?: boolean } = {},
): ImportPreview {
  const d = db();
  const keys = keysFor(incoming);
  const incomingKeys = new Set(keys);
  const existing = new Set((d.prepare('SELECT DISTINCT case_key FROM av_case').all() as { case_key: string }[]).map((r) => r.case_key));
  const editedKeys = new Set((d.prepare('SELECT DISTINCT case_key FROM av_case_edit').all() as { case_key: string }[]).map((r) => r.case_key));

  const gone = [...existing].filter((k) => !incomingKeys.has(k));
  const keptMissing = gone.filter((k) => editedKeys.has(k));
  const removed = gone.filter((k) => !editedKeys.has(k));
  /* 留下来的屏(新导入的 + 标记保留的)身上有多少人工字段会被保住 */
  const survivors = new Set([...incomingKeys, ...keptMissing]);
  const edits = d.prepare('SELECT case_key, field FROM av_case_edit').all() as { case_key: string; field: string }[];
  const kept = edits.filter((e) => survivors.has(e.case_key));

  const preview: ImportPreview = {
    added: keys.filter((k) => !existing.has(k)).length,
    updated: keys.filter((k) => existing.has(k)).length,
    manualFields: kept.length,
    manualScreens: new Set(kept.map((e) => e.case_key)).size,
    handoverKept: kept.filter((e) => e.field === 'handover').length,
    removed: removed.length,
    keptMissing: keptMissing.length,
  };
  if (opts.dryRun) return preview;

  const ins = d.prepare(`INSERT INTO av_case (case_key, missing, source_sheet, status, ref_no, year, name, client, address,
    width_mm, height_mm, sqm, pitch, modules, kw, power_cable, data_cable, product, remarks, imported_by, imported_at)
    VALUES (@caseKey, 0, @sourceSheet, @status, @refNo, @year, @name, @client, @address,
    @widthMm, @heightMm, @sqm, @pitch, @modules, @kw, @powerCable, @dataCable, @product, @remarks, @by, @at)`);
  const at = Date.now();
  d.transaction(() => {
    /* 没人改过又不在新表里的 → 连行带记录一起走 */
    for (const k of removed) {
      d.prepare('DELETE FROM av_case WHERE case_key = ?').run(k);
      d.prepare('DELETE FROM av_case_edit WHERE case_key = ?').run(k);
      d.prepare('DELETE FROM av_case_edit_log WHERE case_key = ?').run(k);
      d.prepare('DELETE FROM av_case_remind WHERE case_key = ?').run(k);
    }
    /* 有人工修改但不在新表里的 → 留着,打上标记供人判断 */
    for (const k of keptMissing) d.prepare('UPDATE av_case SET missing = 1 WHERE case_key = ?').run(k);
    /* 新表里的:原始行整条换掉(人工值不在这张表里,冲不掉) */
    for (const k of incomingKeys) d.prepare('DELETE FROM av_case WHERE case_key = ?').run(k);
    incoming.forEach((c, i) => ins.run({ ...c, caseKey: keys[i], by, at }));

    /* 新统计表的值已经和人工值一样了 → 清掉那条人工标记(§4),
       不然页面会一直挂着「已人工修改」,而其实没差别了。 */
    const raws = d.prepare('SELECT case_key, ' + CASE_FIELDS.filter((f) => f.col).map((f) => `${f.col} AS "${f.key}"`).join(', ')
      + ' FROM av_case').all() as Record<string, unknown>[];
    const rawBy = new Map(raws.map((r) => [String(r.case_key), r]));
    for (const e of d.prepare('SELECT case_key, field, value FROM av_case_edit').all() as { case_key: string; field: string; value: string }[]) {
      const f = FIELD_BY_KEY.get(e.field);
      const raw = rawBy.get(e.case_key);
      if (!f || !f.col || !raw) continue;
      if (sameAsRaw(f, e.value, raw[f.key])) {
        d.prepare('DELETE FROM av_case_edit WHERE case_key = ? AND field = ?').run(e.case_key, e.field);
      }
    }
  })();
  return preview;
}

/* ---- 逐块屏编辑(§3.4)---- */
export interface CaseEditResult { row: CaseRow; changes: { field: string; from: string; to: string }[] }

const show = (v: unknown): string => (v == null || v === '' ? '' : String(v));

/** 写人工值。与原始值相同的字段不写(或删掉已有的那条),这样
 *  「已人工修改」只标真正跟统计表不一样的地方。
 *
 *  revert 列出的字段直接把人工值删掉,回去跟着统计表走 —— 没有这条的话,
 *  改错一个数字就只能凭记忆把统计表里那个数原样打回来(空字符串是「人工
 *  清空」,不等于「不改了」)。 */
export function editCase(
  caseKey: string,
  fields: Record<string, string>,
  by: string,
  revert: string[] = [],
): CaseEditResult | null {
  const d = db();
  const before = getCase(caseKey);
  if (!before) return null;
  const raw = d.prepare(`SELECT ${CASE_FIELDS.filter((f) => f.col).map((f) => `${f.col} AS "${f.key}"`).join(', ')}
    FROM av_case WHERE case_key = ?`).get(caseKey) as Record<string, unknown> | undefined;
  if (!raw) return null;

  const at = Date.now();
  d.transaction(() => {
    for (const key of revert) {
      if (FIELD_BY_KEY.has(key)) d.prepare('DELETE FROM av_case_edit WHERE case_key = ? AND field = ?').run(caseKey, key);
    }
    for (const [key, v] of Object.entries(fields)) {
      if (revert.includes(key)) continue;          // 刚恢复的字段别又被表单里的旧值写回去
      const f = FIELD_BY_KEY.get(key);
      if (!f) continue;                       // 不认的字段一律忽略
      const value = v.trim();
      const isDefault = !f.col
        ? (f.key === 'warrantyMonths' ? Number(value) === DEFAULT_WARRANTY_MONTHS : value === '')
        : sameAsRaw(f, value, raw[f.key]);
      if (isDefault) d.prepare('DELETE FROM av_case_edit WHERE case_key = ? AND field = ?').run(caseKey, key);
      else d.prepare(`INSERT INTO av_case_edit (case_key, field, value, edited_by, edited_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(case_key, field) DO UPDATE SET value = excluded.value, edited_by = excluded.edited_by, edited_at = excluded.edited_at`)
        .run(caseKey, key, value, by, at);
    }
  })();

  const row = getCase(caseKey)!;
  const changes = CASE_FIELDS
    .map((f) => ({ field: f.key, from: show((before as unknown as Record<string, unknown>)[f.key]), to: show((row as unknown as Record<string, unknown>)[f.key]) }))
    .filter((c) => c.from !== c.to);
  return { row, changes };
}

/** 同一项目的其它屏(AV-014 §7「同步到本项目其它屏」)。
 *  「同一项目」按页面上看到的项目名 + 客户认(有效值,去首尾空白、不分大小写)——
 *  不用 case_key:它是按原始导入值算的,谁改过项目名就对不上了,而人判断
 *  「这是不是同一个项目」看的是页面上那个名字。 */
export function caseSiblings(caseKey: string): CaseRow[] {
  const me = getCase(caseKey);
  if (!me) return [];
  const rows = db().prepare(`${EFF_VIEW} SELECT * FROM w
    WHERE lower(trim(name)) = lower(trim(?)) AND lower(trim(IFNULL(client, ''))) = lower(trim(?)) AND caseKey <> ?
    ORDER BY id`).all(me.name, me.client ?? '', caseKey) as CaseDbRow[];
  return rows.map(toCaseRow);
}

/** 同步时一并带过去的字段:只有交付与保修。尺寸、面积这些每块屏各不相同。 */
export const CASE_SYNC_FIELDS = ['handover', 'warrantyMonths'] as const;

/** 标 / 撤「已联系」,都针对这块屏**当前的**到期日。没有到期日(没填交付
 *  日期)的屏无从谈起,返回 null。 */
export function setContacted(caseKey: string, contacted: boolean, by: string): CaseRow | null {
  const row = getCase(caseKey);
  if (!row || !row.expire) return null;
  if (contacted) {
    db().prepare(`INSERT INTO av_case_remind (case_key, expire, by, at) VALUES (?, ?, ?, ?)
      ON CONFLICT(case_key, expire) DO UPDATE SET by = excluded.by, at = excluded.at`).run(caseKey, row.expire, by, Date.now());
  } else {
    db().prepare('DELETE FROM av_case_remind WHERE case_key = ? AND expire = ?').run(caseKey, row.expire);
  }
  return getCase(caseKey);
}

export function getCase(caseKey: string): CaseRow | null {
  const r = db().prepare(`${EFF_VIEW} SELECT * FROM w WHERE caseKey = ?`).get(caseKey) as CaseDbRow | undefined;
  return r ? toCaseRow(r) : null;
}

export function appendCaseLog(caseKey: string, by: string, k: string, p: Record<string, unknown>): void {
  db().prepare('INSERT INTO av_case_edit_log (case_key, at, by, k, p) VALUES (?, ?, ?, ?, ?)')
    .run(caseKey, Date.now(), by, k, JSON.stringify(p));
}

export function caseLog(caseKey: string, limit = 20): { at: number; by: string; k: string; p: Record<string, unknown> }[] {
  return (db().prepare('SELECT at, by, k, p FROM av_case_edit_log WHERE case_key = ? ORDER BY at DESC, id DESC LIMIT ?')
    .all(caseKey, limit) as { at: number; by: string; k: string; p: string }[])
    .map((r) => ({ ...r, p: JSON.parse(r.p) as Record<string, unknown> }));
}

export function caseLibraryInfo(): { count: number; importedBy: string; importedAt: number } {
  const r = db().prepare('SELECT count(*) AS count, MAX(imported_by) AS importedBy, MAX(imported_at) AS importedAt FROM av_case').get() as
    { count: number; importedBy: string | null; importedAt: number | null };
  return { count: r.count, importedBy: r.importedBy ?? '', importedAt: r.importedAt ?? 0 };
}
