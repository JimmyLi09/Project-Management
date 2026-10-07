/* ===== Projection · calculation basis (AV-020 §3.3, §3.7) =====
   One row per step of the prj@0.2 calculation, one cell per blend group, and
   the formula / source on the right. Every constant shows where it came from
   (公司填写 / 样本反推 / 草案 / 行业常规 / 公司常量) and whether PD has
   confirmed it. 05, the proposal and the DXF notes all read this one table. */

import type { PrjGroupsResult } from './groups.ts';
import { PRJ_SOURCE_LABEL, type PrjConst } from './rulepack.ts';

export interface PrjCalcCell {
  text: string;
  ok: boolean | null;       // true ✓ · false ✕ · null not judged
  warn?: boolean;           // a failed check that is only yellow (shadow, pixel size)
}
export interface PrjCalcRow {
  key: string;
  item: string;
  cells: PrjCalcCell[];     // one per group
  basis: string;            // formula and where the constants come from
}
export interface PrjCalcBasis {
  groups: string[];
  rows: PrjCalcRow[];
  total: string;            // power and circuits for the whole project
}

const f2 = (x: number) => x.toFixed(2);
const mm = (m: number) => Math.round(m * 1000);
const pct = (x: number) => `${Math.round(x * 100)}%`;

export function prjCalcBasis(r: PrjGroupsResult, lang: 'zh' | 'en' = 'zh'): PrjCalcBasis {
  const en = lang === 'en';
  const T = (zh: string, e: string) => (en ? e : zh);
  const K = r.pack.constants;
  const src = (k: PrjConst<unknown>) => {
    const [zh, e] = PRJ_SOURCE_LABEL[k.src];
    return k.confirmed ? T(`${zh} · 已确认`, `${e} · confirmed`) : T(`${zh} · 待确认`, `${e} · to confirm`);
  };
  const near = r.cfg.prj_view_near;
  const head = K.head.value;
  const lux = K.lux.value;
  /* AV-020 §3.4 ⑦:人工调整过的格子写「人工调整 · 谁 · 何时」 */
  const manTag = (g: PrjGroupsResult['groups'][number], part: 'd' | 'lensH') =>
    g.manual && g.group.manual?.[part] != null && !(part === 'lensH' && g.floor) ? T(` · 人工调整 · ${g.manual}`, ` · adjusted by hand · ${g.manual}`) : '';
  const row = (key: string, item: string, cell: (g: PrjGroupsResult['groups'][number]) => PrjCalcCell, basis: string): PrjCalcRow =>
    ({ key, item, cells: r.groups.map(cell), basis });

  const rows: PrjCalcRow[] = [
    row('faces', T('投影面（展开）', 'Faces (unfolded)'), (g) => ({
      text: `${g.group.faces.map((f) => f.w).join(' + ')}${g.group.faces.length > 1 ? ` = ${mm(g.L)}` : ''} × ${mm(g.H)} mm${g.floor ? T('（地面）', ' (floor)') : ''}`, ok: null,
    }), T('输入：展开宽 L = 各面宽之和，高 H = 最高的面', 'Input: unfolded width L = sum of face widths; height H = tallest face')),
    row('model', T('机型 / 镜头', 'Projector / lens'), (g) => ({
      text: `${g.projector.name} · ${g.projector.lumens.toLocaleString('en-US')} lm · ${en ? g.lens.nameEn : g.lens.name}`, ok: null,
    }), T('设备库（规格书）', 'Device library (spec sheets)')),
    row('n', T('台数', 'Projectors'), (g) => ({
      text: T(`${g.n} 台（由「${g.reason === 'height' ? '覆盖高度' : '亮度'}」决定）`, `${g.n} (set by ${g.reason === 'height' ? 'covering the height' : 'brightness'})`), ok: null,
    }), T('n = ceil((L ÷ (H × 1.6) − o) ÷ (1 − o))；照度不够再加台', 'n = ceil((L ÷ (H × 1.6) − o) ÷ (1 − o)); add one while illuminance falls short')),
    row('image', T('单台画面', 'Image per projector'), (g) => ({ text: `${mm(g.w)} × ${mm(g.h)} mm`, ok: null }),
      T('w = max(L ÷ (n(1 − o) + o), H × 1.6)；h = w ÷ 1.6（WUXGA）', 'w = max(L ÷ (n(1 − o) + o), H × 1.6); h = w ÷ 1.6 (WUXGA)')),
    row('blend', T('融合带', 'Blend band'), (g) => ({ text: g.n > 1 ? T(`${mm(g.blend)} mm（${pct(g.overlap)}）`, `${mm(g.blend)} mm (${pct(g.overlap)})`) : '—', ok: null }),
      T(`融合带占比 o = ${K.overlap.value}（${src(K.overlap)}）`, `Blend share o = ${K.overlap.value} (${src(K.overlap)})`)),
    row('lux', T('照度（公司算法）', 'Illuminance (company rule)'), (g) => ({
      text: `${g.projector.lumens.toLocaleString('en-US')} ÷ ${f2(g.w * g.h)} ㎡ = ${Math.round(g.lux)} lx ${g.lux >= g.target ? '≥' : '<'} ${g.target}`, ok: g.lux >= g.target,
    }), T(`流明 ÷ 单台画面面积（MY016 图纸同算法）；目标 暗室 ${lux.dark} / 有窗 ${lux.window} / 明亮 ${lux.bright} lx（${src(K.lux)}）`,
      `Lumens ÷ one image's area (as on the MY016 drawing); targets dark ${lux.dark} / windows ${lux.window} / bright ${lux.bright} lx (${src(K.lux)})`)),
    row('lux_ind', T('照度（行业参考）', 'Illuminance (industry reference)'), (g) => ({ text: `${Math.round(g.luxIndustry)} lx`, ok: null }),
      T(`扣 ${pct(1 - K.industryDerate.value)} 老化与镜头折减（${src(K.industryDerate)}），只作参考，不参与判断`,
        `After ${pct(1 - K.industryDerate.value)} ageing and lens losses (${src(K.industryDerate)}); reference only, not judged`)),
    row('throw', T('投射距离', 'Throw distance'), (g) => ({
      text: `${f2(g.d)} m · ${T('镜头范围', 'lens range')} ${f2(g.tMin)}–${f2(g.tMax)} m${g.floor ? '' : ` · ${T('可用', 'available')} ${g.group.dmax} m`}${manTag(g, 'd')}`, ok: g.dOk,
    }), T('投射比 × 单台画面宽，在可用距离内尽量往后', 'Throw ratio × image width, as far back as the room allows')),
    row('lens_h', T('镜头离地', 'Lens height'), (g) => ({
      text: (g.floor ? T(`${f2(g.lensH)} m（吊顶向下）`, `${f2(g.lensH)} m (hung, facing down)`)
        : g.lens.ust ? T(`${f2(g.lensH)} m（超短焦：画面顶 + ${K.ustTop.value} m）`, `${f2(g.lensH)} m (UST: image top + ${K.ustTop.value} m)`)
        : T(`${f2(g.lensH)} m · 镜头位移 ${pct(g.shift ?? 0)}（${g.lens.shiftUp != null ? '镜头' : '机器'} +${pct(g.shiftUp)} / −${pct(g.shiftDown)}）`,
          `${f2(g.lensH)} m · lens shift ${pct(g.shift ?? 0)} (${g.lens.shiftUp != null ? 'lens' : 'unit'} +${pct(g.shiftUp)} / −${pct(g.shiftDown)})`)) + manTag(g, 'lensH'),
      ok: g.ceilOk,
    }), T(`min(天花 − 吊装下沉 ${K.drop.value} m, 画面中心 + 最大位移 × h)（${src(K.drop)}）`,
      `min(ceiling − ${K.drop.value} m hanging drop, image centre + max shift × h) (${src(K.drop)})`)),
    row('shadow', T('遮挡', 'Shadow'), (g) => g.shadowY != null
      ? { text: T(`离墙 ${near} m 处光线高 ${f2(g.shadowY)} m`, `Ray at ${f2(g.shadowY)} m where viewers stand ${near} m from the wall`), ok: !g.shadow, warn: g.shadow }
      : { text: g.floor ? (g.shadow ? T('地面互动会有人影', 'Floor interaction casts shadows') : T('地面：俯投', 'Floor: projected down')) : g.lens.ust ? T('超短焦：贴墙投射', 'UST: close to the wall') : '—', ok: g.floor && g.shadow ? false : null, warn: g.floor && g.shadow },
    T(`光线低于人头 ${head} m 会挡光（${src(K.head)}）`, `A ray below head height ${head} m is blocked by viewers (${src(K.head)})`)),
    row('pixel', T('单像素', 'Pixel size'), (g) => ({ text: `${g.pixel.toFixed(2)} mm`, ok: near > 0 ? g.pixel <= near : null, warn: near > 0 && g.pixel > near }),
      T('单台画面宽 ÷ 1920；单像素(mm) ≤ 最近观看距离(m) 才算清晰（行业常规）', 'Image width ÷ 1920; clear when pixel (mm) ≤ nearest viewing distance (m) (industry practice)')),
    row('power', T('用电', 'Power'), (g) => (g.projector.watts == null
      ? { text: T('功耗待录入', 'power not entered'), ok: false, warn: true }
      : { text: `${g.n} × ${g.projector.watts} W = ${f2(g.kw)} kW`, ok: null }),
      T('规格书功耗', 'Spec-sheet power')),
  ];
  const total = T(
    `合计 ${r.nProj} 台 · ${f2(r.kw)} kW → ceil(${f2(r.kw)} ÷ ${K.circuitKw.value}) = ${r.nCircuit} 路（单回路 ${K.circuitKw.value} kW，${src(K.circuitKw)}）`,
    `Total ${r.nProj} projectors · ${f2(r.kw)} kW → ceil(${f2(r.kw)} ÷ ${K.circuitKw.value}) = ${r.nCircuit} circuit${r.nCircuit > 1 ? 's' : ''} (${K.circuitKw.value} kW each, ${src(K.circuitKw)})`);
  return { groups: r.groups.map((g) => g.group.name), rows, total };
}
