/* ===== REQ-038: 积分定义标准(积分规则) =====

   口径来源:用户《项目积分算法》。下面的 DEFAULT_POINT_RULES 只是**落库初始值**
   —— 上线后总监在「规则设置 · 积分规则」里改的那一版才是准的,改动存成新版本、
   带生效日,历史项目按它创建时生效的那一版计分(REQ-038 默认口径)。

   一个业务(服务类型)下面是若干**档位**:
   - 固定档:`points` 就是分值(效果图 10 张 = 2 分)。
   - 区间档:`min`–`max`(LED 3–7)。区间内取哪个值,按用户确认的默认口径 ——
     **由 PM 在项目里手选**,选完存在这份业务包上。
   - 档位可以带一个自动匹配条件 `match`:能从这份业务的资料卡里读到数(比如
     沙盘的比例、LED 的面积),就自动落档;读不到就由 PM 选档。

   附加规则(准时加成 / 积分归属)《项目积分算法》里没有,按用户确认**默认关闭**,
   关着的时候完全不参与计算。 */

import type { Project, ServicePackage } from './types';

export type MatchOp = 'lte' | 'gte' | 'range';

export interface PointTier {
  id: string;
  zh: string;
  en: string;
  points: number;                 // 固定档的分值;区间档忽略此值
  min?: number;                   // 区间档下限
  max?: number;                   // 区间档上限
  /* 自动落档条件:读 metric 指定的那个资料卡字段,按 op 判断 */
  match?: { op: MatchOp; from?: number; to?: number };
}

export interface PointRule {
  svc: string;                    // 服务类型 key(SVC 里的);也可自定义新增
  zh: string;
  en: string;
  /* 自动判档读哪个字段。field 是资料卡(REQ-023)里的字段 key;
     留空 = 这个业务没法自动判,一律由 PM 选档。 */
  metric?: { field: string; zh: string; en: string };
  tiers: PointTier[];
}

export interface BonusRule {
  enabled: boolean;               // 默认 false —— 关着就完全不参与计算
  onTime: number;                 // 准时交付加成
  late: number;                   // 逾期扣减(正数,计算时相减)
}

export interface AttributionRule {
  mode: 'pm' | 'split';           // 默认 pm:全归 PM
  pm: number; production: number; sales: number;   // split 时的百分比
}

export interface PointRules {
  services: PointRule[];
  bonus: BonusRule;
  attribution: AttributionRule;
}

/* 一个版本 = 一份规则 + 生效日。项目按 created 落到某一版上。 */
export interface PointRuleVersion {
  version: number;
  rules: PointRules;
  effectiveFrom: string;          // ISO 日期;空 = 一直有效
  note: string;
  createdAt: number;
  createdBy: string;
}

const T = (id: string, zh: string, en: string, points: number, match?: PointTier['match']): PointTier =>
  ({ id, zh, en, points, ...(match ? { match } : {}) });
const R = (id: string, zh: string, en: string, min: number, max: number): PointTier =>
  ({ id, zh, en, points: min, min, max });

/* ---- 出厂默认:逐条对应《项目积分算法》 ---- */
export const DEFAULT_POINT_RULES: PointRules = {
  services: [
    {
      svc: 'cgi', zh: '效果图(CGI 静帧)', en: 'CGI (stills)',
      metric: { field: 'shots', zh: '张数', en: 'Shots' },
      tiers: [
        T('cgi5', '5 张', '5 stills', 1, { op: 'lte', to: 5 }),
        T('cgi10', '10 张', '10 stills', 2, { op: 'range', from: 6, to: 10 }),
        T('cgi15', '15 张', '15 stills', 3, { op: 'range', from: 11, to: 15 }),
        T('cgi20', '20 张', '20 stills', 5, { op: 'gte', from: 16 }),
      ],
    },
    {
      svc: 'ani', zh: '动画', en: 'Animation',
      metric: { field: 'minutes', zh: '时长(分钟)', en: 'Duration (min)' },
      tiers: [
        T('ani1', '1 分钟', '1 minute', 2, { op: 'lte', to: 1 }),
        T('ani2', '2 分钟', '2 minutes', 4, { op: 'range', from: 1.01, to: 2 }),
        T('ani3', '2 分钟以上', 'Over 2 minutes', 5, { op: 'gte', from: 2.01 }),
      ],
    },
    {
      svc: 'vrar', zh: '360 / 720 全景', en: '360 / 720 Panorama',
      metric: { field: 'rooms', zh: '房数', en: 'Rooms' },
      tiers: [
        T('vr12', '1–2 房 VR', '1–2 room VR', 2, { op: 'range', from: 1, to: 2 }),
        T('vr34', '3–4 房', '3–4 rooms', 3.5, { op: 'range', from: 3, to: 4 }),
        T('vr5', '4 房以上', 'Over 4 rooms', 5, { op: 'gte', from: 5 }),
        R('vr720', '室外 720', 'Outdoor 720', 3, 5),
        T('vr360', '项目 360', 'Project 360', 5),
      ],
    },
    {
      svc: 'scale', zh: '实体模型', en: 'Scale Model',
      /* 用户确认:「50 以上 / 30–50」指**比例**(1:50、1:30)。比例数字越大 =
         模型越小 = 工作量越低,所以 50 以上给 3 分、30–50 给 5 分。 */
      metric: { field: 'scaleRatio', zh: '比例 1:N', en: 'Scale 1:N' },
      tiers: [
        T('sc50', '比例 50 以上', 'Scale over 1:50', 3, { op: 'gte', from: 50.01 }),
        T('sc3050', '比例 30–50', 'Scale 1:30–1:50', 5, { op: 'range', from: 30, to: 50 }),
      ],
    },
    {
      svc: 'unitmodel', zh: '单元 / 景观模型', en: 'Unit / Landscape Model',
      tiers: [T('um', 'Unit / Landscape Model', 'Unit / Landscape Model', 3)],
    },
    {
      svc: 'saleskit', zh: 'Sales Kit', en: 'Sales Kit',
      tiers: [
        T('sk0', '不带 360', 'Without 360', 5),
        T('sk0ui', '不带 360 · 自设计 UI', 'Without 360 · own UI design', 7),
        T('sk1', '带 360', 'With 360', 7),
        T('sk1ui', '带 360 · 自设计 UI', 'With 360 · own UI design', 10),
      ],
    },
    {
      svc: 'led', zh: 'LED', en: 'LED',
      metric: { field: 'sqm', zh: '面积 SQM', en: 'SQM' },
      tiers: [R('led', 'LED 计算与安装', 'LED calculation & installation', 3, 7)],
    },
    {
      svc: 'projector', zh: '投影 Projector', en: 'Projector',
      tiers: [R('proj', 'Projector 融合与调试', 'Projector blending & calibration', 3, 10)],
    },
  ],
  /* 《项目积分算法》未含 —— 用户确认默认关闭 */
  bonus: { enabled: false, onTime: 0, late: 0 },
  attribution: { mode: 'pm', pm: 100, production: 0, sales: 0 },
};

export const isRangeTier = (t: PointTier) => t.min != null && t.max != null;
export const ruleFor = (rules: PointRules, svc: string) => rules.services.find((r) => r.svc === svc);
export const tierOf = (rule: PointRule, id: string) => rule.tiers.find((t) => t.id === id);

/* 一个档位在某个数值下是否成立 */
function tierMatches(t: PointTier, v: number): boolean {
  if (!t.match) return false;
  const { op, from, to } = t.match;
  if (op === 'lte') return to != null && v <= to;
  if (op === 'gte') return from != null && v >= from;
  return from != null && to != null && v >= from && v <= to;
}

/* 从这份业务包里读出用来判档的数。资料卡字段优先(REQ-023 同源),
   读不到就返回 null —— 上层据此提示 PM 手选。 */
export function metricValue(rule: PointRule, pkg: ServicePackage): number | null {
  if (!rule.metric?.field) return null;
  const raw = pkg.record?.[rule.metric.field];
  if (raw == null || String(raw).trim() === '') return null;
  const v = Number(raw);
  return Number.isFinite(v) ? v : null;
}

export type PkgPoints = {
  points: number;
  tier?: PointTier;
  /* auto  = 按资料卡的数自动落档
     manual= PM 手选(含区间档选值)
     none  = 判不出来,等 PM 选 —— 计 0 分并在界面上提示 */
  source: 'auto' | 'manual' | 'none';
  needsPick: boolean;
};

/* 一份业务包得几分 */
export function pkgPoints(rules: PointRules, pkg: ServicePackage): PkgPoints {
  const rule = ruleFor(rules, pkg.svc);
  if (!rule || rule.tiers.length === 0) return { points: 0, source: 'none', needsPick: false };

  /* PM 手选优先 —— 他看得见实际情况,自动判档只是省事,不该盖过人的判断 */
  const picked = pkg.pointTier ? tierOf(rule, pkg.pointTier.id) : undefined;
  if (picked) {
    const v = isRangeTier(picked)
      ? clamp(pkg.pointTier?.value ?? picked.min ?? 0, picked.min ?? 0, picked.max ?? 0)
      : picked.points;
    return { points: v, tier: picked, source: 'manual', needsPick: false };
  }

  const mv = metricValue(rule, pkg);
  if (mv != null) {
    const hit = rule.tiers.find((t) => tierMatches(t, mv));
    if (hit) {
      /* 自动落到区间档上:分值还是定不了,仍然要 PM 选 */
      if (isRangeTier(hit)) return { points: 0, tier: hit, source: 'none', needsPick: true };
      return { points: hit.points, tier: hit, source: 'auto', needsPick: false };
    }
  }
  /* 只有一个固定档、没有别的可选 —— 没有歧义,直接给分 */
  if (rule.tiers.length === 1 && !isRangeTier(rule.tiers[0])) {
    return { points: rule.tiers[0].points, tier: rule.tiers[0], source: 'auto', needsPick: false };
  }
  return { points: 0, source: 'none', needsPick: true };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/* 整个项目按规则得几分 = 各业务包相加(+ 附加加成,默认关闭时不参与) */
export function rulePoints(rules: PointRules, p: Project): { total: number; parts: PkgPoints[] } {
  const parts = (p.packages || []).map((pk) => pkgPoints(rules, pk));
  let total = parts.reduce((a, x) => a + x.points, 0);
  if (rules.bonus.enabled && total > 0) {
    const onTime = onTimeDelivered(p);
    if (onTime === true) total += rules.bonus.onTime;
    if (onTime === false) total -= rules.bonus.late;
  }
  return { total: round1(Math.max(0, total)), parts };
}

/* 准时与否:有交付日、且项目已完工/交付才判得了;判不了返回 null。 */
function onTimeDelivered(p: Project): boolean | null {
  if (!p.delivery) return null;
  const done = p.packages?.every((pk) => pk.schedule.length > 0 && pk.schedule.every((r) => r.status === 'done'));
  if (!done) return null;
  const last = p.packages.reduce((mx, pk) => {
    pk.schedule.forEach((r) => { if (r.e && r.e > mx) mx = r.e; });
    return mx;
  }, '');
  return last ? last <= p.delivery : null;
}

export const round1 = (n: number) => Math.round(n * 10) / 10;

/* 按项目创建时间挑该用哪一版规则:生效日 <= 项目创建日 的最后一版。
   一版都没排到(比如规则的生效日全在项目之后)就用最早那一版,
   免得老项目忽然变成 0 分。 */
export function rulesAt(versions: PointRuleVersion[], at: number): PointRules {
  if (!versions.length) return DEFAULT_POINT_RULES;
  const sorted = [...versions].sort((a, b) => a.version - b.version);
  const day = new Date(at).toISOString().slice(0, 10);
  let pick = sorted[0];
  for (const v of sorted) if (!v.effectiveFrom || v.effectiveFrom <= day) pick = v;
  return pick.rules;
}

/* 落库前校验一份规则。分值和区间都夹到合理范围,坏数据不进库。 */
export function validateRules(raw: unknown): { ok: true; rules: PointRules } | { ok: false; error: string } {
  const r = raw as Partial<PointRules>;
  if (!r || !Array.isArray(r.services)) return { ok: false, error: '规则格式不对:缺 services' };
  if (r.services.length > 60) return { ok: false, error: '业务最多 60 个' };
  const seen = new Set<string>();
  const services: PointRule[] = [];
  for (const s of r.services) {
    const svc = String(s?.svc || '').trim().slice(0, 40);
    if (!svc) return { ok: false, error: '业务 key 不能为空' };
    if (seen.has(svc)) return { ok: false, error: `业务「${svc}」重复` };
    seen.add(svc);
    if (!Array.isArray(s.tiers) || s.tiers.length === 0) return { ok: false, error: `业务「${svc}」至少要有一个档位` };
    if (s.tiers.length > 40) return { ok: false, error: `业务「${svc}」的档位最多 40 个` };
    const tseen = new Set<string>();
    const tiers: PointTier[] = [];
    for (const t of s.tiers) {
      const id = String(t?.id || '').trim().slice(0, 40);
      if (!id) return { ok: false, error: `业务「${svc}」有档位缺 id` };
      if (tseen.has(id)) return { ok: false, error: `业务「${svc}」档位 id「${id}」重复` };
      tseen.add(id);
      const zh = String(t?.zh || id).slice(0, 80);
      const tier: PointTier = { id, zh, en: String(t?.en || zh).slice(0, 80), points: num(t?.points, 0, 0, 1000) };
      if (t?.min != null && t?.max != null) {
        tier.min = num(t.min, 0, 0, 1000);
        tier.max = num(t.max, 0, 0, 1000);
        if (tier.max < tier.min) return { ok: false, error: `业务「${svc}」档位「${zh}」的区间上限小于下限` };
        tier.points = tier.min;
      }
      const m = t?.match;
      if (m && (m.op === 'lte' || m.op === 'gte' || m.op === 'range')) {
        tier.match = { op: m.op };
        if (m.from != null) tier.match.from = num(m.from, 0, -1e6, 1e6);
        if (m.to != null) tier.match.to = num(m.to, 0, -1e6, 1e6);
      }
      tiers.push(tier);
    }
    const rule: PointRule = { svc, zh: String(s.zh || svc).slice(0, 80), en: String(s.en || s.zh || svc).slice(0, 80), tiers };
    if (s.metric?.field) {
      const field = String(s.metric.field).trim().slice(0, 40);
      if (!/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(field)) return { ok: false, error: `业务「${svc}」的判档字段名不合法` };
      rule.metric = { field, zh: String(s.metric.zh || field).slice(0, 40), en: String(s.metric.en || s.metric.zh || field).slice(0, 40) };
    }
    services.push(rule);
  }
  const b = r.bonus;
  const a = r.attribution;
  return {
    ok: true,
    rules: {
      services,
      bonus: { enabled: !!b?.enabled, onTime: num(b?.onTime, 0, 0, 100), late: num(b?.late, 0, 0, 100) },
      attribution: {
        mode: a?.mode === 'split' ? 'split' : 'pm',
        pm: num(a?.pm, 100, 0, 100), production: num(a?.production, 0, 0, 100), sales: num(a?.sales, 0, 0, 100),
      },
    },
  };
}

function num(v: unknown, dflt: number, lo: number, hi: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return round1(clamp(n, lo, hi));
}
