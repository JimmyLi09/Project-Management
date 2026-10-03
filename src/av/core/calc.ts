/* ===== AV-019 §2.2 计算依据表 =====
   「这些电线需要计算基础」—— 从单箱功率一路推到回路数、每路电流、线径、网线条数。
   05 的图下方、技术方案、DXF 说明栏三处用的都是这一份,数字不会对不上。 */

import type { ComputeResult } from './compute.ts';
import { manualLabel } from './override.ts';
import { circuitDensity, hasMaxPower } from './rulepack.ts';

export interface CalcRow {
  key: string;
  item: string;
  formula: string;
  result: string;
  ok: boolean | null;          // true ✓ · false 超限 · null 不判断(或待填)
  source: string;              // 公司参数 / 规则包 / 屏体参数 / 人工调整
  params?: string[];           // 展开看用到的参数
}

const n1 = (x: number) => (Math.round(x * 10) / 10).toString();
const int = (x: number, en: boolean) => Math.round(x).toLocaleString(en ? 'en-US' : 'zh-CN');
const m = (mm: number) => String(mm / 1000);

/* 箱体种类编号 A / B / C …(按数量多少排,和图例一致) */
export const cabLetter = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : `T${i + 1}`);

export function calcBasis(r: ComputeResult, lang: 'zh' | 'en' = 'zh', opt: { manual?: string } = {}): CalcRow[] {
  const { layout: lay, wiring: w, pack, profile, cfg } = r;
  if (!lay || !w) return [];
  const en = lang === 'en';
  const T = (zh: string, e: string) => (en ? e : zh);
  /* led@1.2:单箱功率按最大功耗密度(回路校核用);平均值只算整屏平均功耗 */
  const maxMode = hasMaxPower(profile);
  const wSqm = circuitDensity(profile);
  const dens = (x: number) => String(Math.round(x * 100) / 100);
  const p = cfg.led_pitch;
  const types = lay.bom.map((b, i) => ({ ...b, L: cabLetter(i), W: (b.w * b.h / 1e6) * wSqm, px: Math.round(b.w / p) * Math.round(b.h / p) }));
  const total = w.cellW.reduce((a, b) => a + b, 0);
  const limitW = w.limitW;
  const chain = w.algo === 'chain';
  /* 人工调整:来源一律写「人工调整 · 谁 · 何时」(只标人改过的那部分) */
  const who = opt.manual ?? manualLabel(r.manual);
  const manualP = who && (opt.manual || r.manual?.power) ? T(`人工调整 · ${who}`, `Manual · ${who}`) : '';
  const manualD = who && (opt.manual || r.manual?.data) ? T(`人工调整 · ${who}`, `Manual · ${who}`) : '';
  const srcCompany = T(`公司参数 · ${pack.version}`, `Company parameter · ${pack.version}`);
  const srcPack = T(`规则包 ${pack.version}`, `Rule pack ${pack.version}`);
  const srcScreen = T('屏体参数', 'Screen parameters');
  const rows: CalcRow[] = [];

  const maxPending = maxMode && profile.wSqmMax == null;
  rows.push({
    key: 'cab_w', item: maxMode ? T('单箱最大功率', 'Max power per cabinet') : T('单箱功率', 'Power per cabinet'),
    formula: types.map((t) => `${types.length > 1 ? t.L + ' ' : ''}${m(t.w)} × ${m(t.h)} × ${dens(wSqm)}`).join('；'),
    result: types.map((t) => `${types.length > 1 ? t.L + ' ' : ''}${n1(t.W)} W`).join('；') + (maxPending ? T('（最大功耗密度待填，暂按平均）', ' (max density to be set; average used)') : ''),
    ok: maxPending ? false : null, source: `${srcScreen} · ${en ? profile.code : profile.label}`,
    params: maxMode
      ? [maxPending
          ? T(`最大功耗密度待填，暂按平均 ${profile.wSqm} W/㎡（参数组 ${profile.label}）`, `Max power density to be set; average ${profile.wSqm} W/m² used (profile ${profile.code})`)
          : T(`最大功耗密度 ${dens(wSqm)} W/㎡（${profile.wSqmMaxNote ?? '参数组'}；参数组 ${profile.label}）`, `Max power density ${dens(wSqm)} W/m² (profile ${profile.code}${profile.code === 'in_fixed' ? ', from 640 × 640 measured 240 W' : ''})`),
        T(`平均功耗密度 ${profile.wSqm} W/㎡，只用来算整屏平均功耗`, `Average ${profile.wSqm} W/m², used only for the average screen power`)]
      : [T(`功耗密度 ${wSqm} W/㎡（参数组 ${profile.label}${profile.calibrated ? '' : '，待校准'}）`, `Power density ${wSqm} W/m² (profile ${profile.code}${profile.calibrated ? '' : ', uncalibrated'})`)],
  });
  const avgTotal = maxMode ? lay.bom.reduce((a, b) => a + b.count * (b.w * b.h / 1e6) * profile.wSqm, 0) : total;
  rows.push({
    key: 'total', item: maxMode ? T('总功率（最大）', 'Total power (max)') : T('总功率', 'Total power'),
    formula: types.length === 1 ? `${types[0].count} × ${n1(types[0].W)}` : types.map((t) => `${t.L} ${t.count} × ${n1(t.W)}`).join(' + '),
    result: `${n1(total)} W` + (maxMode ? T(`（平均 ${n1(avgTotal)} W）`, ` (average ${n1(avgTotal)} W)`) : ''), ok: null, source: srcScreen,
  });
  const nAuto = Math.ceil(total / limitW - 1e-9);
  rows.push({
    key: 'circuits', item: T('回路数', 'Circuits'),
    formula: manualP
      ? T(`人工划分 ${w.nCircuit} 路（逐路校核）`, `${w.nCircuit} circuits assigned by hand (each checked)`)
      : chain
      ? T(`ceil(${n1(total)} ÷ ${limitW})，逐路校核${w.nCircuit > nAuto ? `，超限加到 ${w.nCircuit}` : ''}`, `ceil(${n1(total)} ÷ ${limitW}), each circuit checked${w.nCircuit > nAuto ? `, raised to ${w.nCircuit}` : ''}`)
      : T(`ceil(${n1(total / 1000)} ÷ ${pack.company.circuitKw})，按整列分组（不校核）`, `ceil(${n1(total / 1000)} ÷ ${pack.company.circuitKw}), grouped by whole column (not checked)`),
    result: T(`${w.nCircuit} 路 + 1 备用`, `${w.nCircuit} + 1 spare`),
    ok: null, source: manualP || T(`公司参数 单回路 ≤ ${pack.company.circuitKw} kW`, `Company parameter ≤ ${pack.company.circuitKw} kW per circuit`),
    params: [T(`单回路上限 ${pack.company.circuitKw} kW（${srcCompany}）`, `Circuit limit ${pack.company.circuitKw} kW (${srcCompany})`),
      T(chain ? '电源按列竖向成链（第 1 列自下而上、第 2 列自上而下……），允许一列中途换回路' : '按整列均衡分组', chain ? 'Power chained up / down each column in turn; a column may switch circuit part-way' : 'Balanced by whole column')],
  });
  const maxW = Math.max(...w.power.map((x) => x.w));
  const loadOk = maxW <= limitW + 1e-6 && w.circuitOf.every((k) => k >= 0 && k < w.power.length);
  const unP = w.unassigned.power.length, unD = w.unassigned.data.length;
  const same = w.power.every((x) => x.cells.length === w.power[0].cells.length) && types.length === 1;
  const amps = w.voltage ? maxW / w.voltage : null;
  rows.push({
    key: 'load', item: T('每路负载 / 电流', 'Load / current per circuit'),
    formula: same
      ? `${w.power[0].cells.length} × ${n1(types[0].W)}${w.voltage ? ` ÷ ${w.voltage} V` : ''}`
      : w.power.map((x, k) => T(`回路 ${k + 1}：${x.cells.length} 只 ${n1(x.w)} W`, `C${k + 1}: ${x.cells.length} pcs ${n1(x.w)} W`)).join('；'),
    result: `${same ? '' : T('最大 ', 'max ')}${n1(maxW)} W${amps !== null ? ` / ${n1(amps)} A` : ''} ${loadOk ? '✓' : unP && maxW <= limitW + 1e-6 ? T(`✕ ${unP} 只没分配`, `✕ ${unP} unassigned`) : T('✕ 超限', '✕ over limit')}`,
    ok: loadOk, source: manualP || srcCompany,
    params: w.voltage ? [T(`电压 ${w.voltage} V（公司参数）`, `Voltage ${w.voltage} V (company parameter)`)] : [T('规则包没有电压参数，不算电流', 'No voltage in this rule pack; current not calculated')],
  });
  if (w.voltage) {
    const spec = cfg.led_power_cable;
    const cap = pack.company.cableAmps?.[spec];
    rows.push({
      key: 'cable', item: T('线径', 'Cable size'),
      formula: cap != null ? T(`电源线 ${spec}，载流上限 ${cap} A`, `Power cable ${spec}, rated ${cap} A`) : T(`电源线 ${spec}，载流上限待填`, `Power cable ${spec}, rating not set`),
      result: cap == null ? T('待填', 'to be set') : (amps! <= cap + 1e-9 ? `✓ ${n1(amps!)} A ≤ ${cap} A` : T(`✕ ${n1(amps!)} A > ${cap} A，加大线径或加回路`, `✕ ${n1(amps!)} A > ${cap} A — upsize or add circuits`)),
      ok: cap == null ? null : amps! <= cap + 1e-9, source: T('公司参数 · 线径表', 'Company parameter · cable table'),
    });
    const cmax = pack.company.cascadeMax;
    const longest = Math.max(...w.power.map((x) => x.cells.length));
    rows.push({
      key: 'cascade', item: T('箱体电源级联', 'Power cascade'),
      formula: T(`每路最多串 ${longest} 只`, `up to ${longest} cabinets per chain`),
      result: cmax == null ? T('上限待填，按厂家规格', 'limit to be set (per manufacturer)') : (longest <= cmax ? `✓ ≤ ${cmax}` : T(`✕ > ${cmax}`, `✕ > ${cmax}`)),
      ok: cmax == null ? null : longest <= cmax, source: T('公司参数 · 箱体规格书', 'Company parameter · cabinet datasheet'),
    });
  }
  rows.push({
    key: 'cab_px', item: T('单箱像素', 'Pixels per cabinet'),
    formula: types.map((t) => `${types.length > 1 ? t.L + ' ' : ''}${t.w} ÷ ${p} × ${t.h} ÷ ${p}`).join('；'),
    result: types.map((t) => `${types.length > 1 ? t.L + ' ' : ''}${Math.round(t.w / p)} × ${Math.round(t.h / p)} = ${int(t.px, en)}`).join('；'),
    ok: null, source: srcScreen,
  });
  const cap = pack.control.dataPx;
  const maxRun = Math.max(...w.runs.map((x) => x.px));
  const runOk = maxRun <= cap + 1e-6 && !unD;
  const rowFormula = () => {
    const widest = Math.max(...lay.heights.map((_, ri) => lay.cells.filter((c) => c.r === ri + 1).reduce((a, c) => a + w.cellPx[lay.cells.indexOf(c)], 0)));
    const nc = lay.widths.length;
    return types.length === 1
      ? T(`每行一条：${nc} × ${int(types[0].px, en)} = ${int(widest, en)} ${widest <= cap ? '≤' : '>'} ${int(cap, en)}${widest > cap ? '，拆成多条' : ''}`,
        `One per row: ${nc} × ${int(types[0].px, en)} = ${int(widest, en)} ${widest <= cap ? '≤' : '>'} ${int(cap, en)}${widest > cap ? ', split' : ''}`)
      : T(`每行一条：最宽一行 ${int(widest, en)} ${widest <= cap ? '≤' : '>'} ${int(cap, en)}`, `One per row: widest row ${int(widest, en)} ${widest <= cap ? '≤' : '>'} ${int(cap, en)}`);
  };
  rows.push({
    key: 'data', item: T('网线', 'Data runs'),
    formula: manualD
      ? T(`人工串接 ${w.nDataRun} 条，每条 ≤ ${int(cap, en)}`, `${w.nDataRun} runs chained by hand, each ≤ ${int(cap, en)}`)
      : !chain
      ? T(`每行 ceil(行像素 ÷ ${int(cap, en)})`, `per row ceil(row px ÷ ${int(cap, en)})`)
      : w.dataMode === 'snake'
        ? T(`蛇形按带载：每条最多 floor(${int(cap, en)} ÷ ${int(types[0].px, en)}) = ${Math.floor(cap / types[0].px)} 只`, `Serpentine by load: up to floor(${int(cap, en)} ÷ ${int(types[0].px, en)}) = ${Math.floor(cap / types[0].px)} per run`)
        : rowFormula(),
    result: `${T(`${w.nDataRun} 条 + 1 备用`, `${w.nDataRun} + 1 spare`)} · ${T('最大带载', 'max load')} ${int(maxRun, en)} ${runOk ? '✓' : '✕'}${unD ? T(` · ${unD} 只没接`, ` · ${unD} unassigned`) : ''}`,
    ok: runOk, source: manualD || T(`单线带载 ${int(cap, en)} px（${srcPack}）`, `${int(cap, en)} px per port (${srcPack})`),
  });
  return rows;
}
