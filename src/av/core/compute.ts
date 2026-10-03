/* ===== Deterministic calculation engine =====

   Drives the rule pack's formula library in declaration order and records a
   provenance-tagged trace node for every value it produces (§9 / A9).

   §1's design rule: the AI touches only the two ends of the chain — drawing
   extraction and document wording. Everything here is deterministic code; no
   quantity, power figure or circuit count is ever produced by a model. */

import { evalExpr, varsOf } from './expr.ts';
import { layout as solveLayout, solveAxis, type LayoutResult } from './layout.ts';
import { circuitDensity, getRulePack, hasMaxPower, type RulePack, type ScreenProfile } from './rulepack.ts';
import { blocksExport, usableLib, validate } from './rules.ts';
import { cellId, layoutSig, wiring as solveWiring, type WiringOverrideInput, type WiringResult } from './wiring.ts';
import type { Finding, LedConfig, Provenance, Size, TraceNode } from './types.ts';

export interface ComputeResult {
  pack: RulePack;
  profile: ScreenProfile;
  cfg: LedConfig;
  trace: Record<string, TraceNode>;
  layout: LayoutResult | null;
  wiring: WiringResult | null;
  findings: Finding[];
  /* No blocking finding bars a formal export (LED-TYPE-01 and friends, A6). */
  exportable: boolean;
  /* AV-019 §2.3:人工调整生效时是谁、什么时候改的;输入变了对不上时 stale 记着原来那份 */
  manual: { by: string; at: number; power: boolean; data: boolean } | null;
  manualStale: { by: string; at: number } | null;
  /* 人工调整有违规(超限 / 没分配)时不能存正式版本,只能存草稿 —— 原因 */
  manualBlock: { zh: string; en: string } | null;
}

/* 人工调整按箱体编号存;换成这次排布的箱体下标。对不上(指纹不同、编号缺)就返回 null */
function overrideInput(cfg: LedConfig, layout: LayoutResult): WiringOverrideInput | null {
  const ov = cfg.led_wiring_override;
  if (!ov || (!ov.power && !ov.data)) return null;
  if (ov.sig !== layoutSig(layout.cells)) return null;
  const byId = new Map(ov.cells.map((c) => [c.id, c]));
  const rows = layout.cells.map((c) => byId.get(cellId(c)));
  if (rows.some((x) => !x)) return null;
  return {
    circuit: ov.power ? rows.map((x) => x!.circuit ?? null) : null,
    run: ov.data ? rows.map((x) => x!.run ?? null) : null,
    seq: ov.data ? rows.map((x) => x!.seq ?? null) : null,
    ports: ov.ports,
  };
}

const UNITS: Record<string, string> = {
  L: 'mm', H: 'mm', mod_w: 'mm', mod_h: 'mm', p: 'mm', w_sqm: 'W/㎡',
  circuit_kw: 'kW', data_px: 'px', sqm: '㎡', mods: '块', px_w: 'px', px_h: 'px',
  px: 'px', kw: 'kW', kw_max: 'kW', w_sqm_max: 'W/㎡', n_circuit: '路', n_power_cable: '根', n_data_run: '条',
  n_data_cable: '根',
};

/* `inputProv` lets 04 校核 hand in where each drawing-derived field came from
   (file / layer / coordinate, AI method, confidence). Anything not supplied is
   recorded as confirmed manual input. */
export function compute(
  cfg: LedConfig,
  packVersion: string,
  inputProv: Partial<Record<keyof LedConfig, Provenance>> = {},
): ComputeResult {
  const pack = getRulePack(packVersion);
  const profile = pack.profiles[cfg.led_screen_type];
  const lib: Size[] = cfg.led_cab_lib ?? profile.cabLib;
  const [modW, modH] = cfg.led_mod ?? [profile.modW, profile.modH];
  const { lib: usable, dropped } = usableLib(lib, modW, modH);

  const env: Record<string, number> = {};
  const trace: Record<string, TraceNode> = {};

  const seed = (key: string, value: number, prov: Provenance) => {
    env[key] = value;
    trace[key] = { key, value, unit: UNITS[key] ?? '', prov, inputs: [] };
  };
  const manual = (field: keyof LedConfig): Provenance =>
    inputProv[field] ?? { source: `人工输入 · ${field}`, method: 'manual', confidence: 'confirmed' };
  const fromProfile: Provenance = { source: `参数组 · ${profile.code}`, method: 'lookup', confidence: 'confirmed' };
  const modProv: Provenance = cfg.led_mod ? manual('led_mod') : fromProfile;

  seed('L', cfg.led_opening_w, manual('led_opening_w'));
  seed('H', cfg.led_opening_h, manual('led_opening_h'));
  seed('p', cfg.led_pitch, manual('led_pitch'));
  seed('mod_w', modW, modProv);
  seed('mod_h', modH, modProv);
  seed('w_sqm', profile.wSqm, { ...fromProfile, note: profile.calibrated ? undefined : '待校准占位值' });
  /* led@1.2:最大功耗密度(回路按它);待填时先按平均值,并告警 */
  if (hasMaxPower(profile)) seed('w_sqm_max', circuitDensity(profile), { ...fromProfile, note: profile.wSqmMax == null ? '最大功耗密度待填，暂按平均值' : profile.wSqmMaxNote });
  seed('circuit_kw', pack.company.circuitKw, { source: `公司参数 · ${pack.version}`, method: 'lookup', confidence: 'confirmed' });
  seed('data_px', pack.control.dataPx, { source: `控制系统 · ${pack.control.brand}`, method: 'lookup', confidence: 'confirmed' });

  const emit = (key: string, value: number, ruleId: string, inputs: string[]) => {
    env[key] = value;
    trace[key] = {
      key, value, unit: UNITS[key] ?? '',
      prov: { source: '公式输出', method: 'rule', rule: ruleId, confidence: 'deterministic' },
      inputs,
    };
  };

  let layout: LayoutResult | null = null;
  let wiring: WiringResult | null = null;
  let ovInput: WiringOverrideInput | null = null;

  for (const f of pack.formulas) {
    if (f.id === 'F3') {
      layout = solveLayout(cfg.led_opening_w, cfg.led_opening_h, modW, modH, usable, cfg.led_cabinet);
      continue;
    }
    if (f.id === 'F10') continue; // F10's aggregation is produced with the layout
    /* AV-019 led@1.1:F6 / F8 是算法 —— 按箱体成链分回路、逐路校核;数据线按走法逐只累加 */
    if (f.kind === 'algorithm' && (f.id === 'F6' || f.id === 'F8')) {
      if (!layout) continue;
      if (!wiring) {
        ovInput = overrideInput(cfg, layout);
        wiring = solveWiring({
          override: ovInput,
          widths: layout.widths, heights: layout.heights, H: cfg.led_opening_h, cells: layout.cells,
          algo: 'chain', dataMode: cfg.led_data_mode ?? 'row', voltage: pack.company.voltage ?? null,
          pitch: cfg.led_pitch, wSqm: circuitDensity(profile), circuitKw: pack.company.circuitKw,
          dataPx: pack.control.dataPx, pxW: env.px_w, kw: env.kw_max ?? env.kw,
          rowRunOf: () => 0,
        });
      }
      if (f.id === 'F6') emit('n_circuit', wiring.nCircuit, f.id, [hasMaxPower(profile) ? 'kw_max' : 'kw', 'circuit_kw']);
      else emit('n_data_run', wiring.nDataRun, f.id, ['px', 'p', 'data_px']);
      continue;
    }
    if (f.kind !== 'expr' || !f.exprs) continue;

    if (f.scope === 'row') {
      if (!layout) continue;
      const src = f.exprs.row_runs;
      wiring = solveWiring({
        widths: layout.widths, heights: layout.heights, H: cfg.led_opening_h, cells: layout.cells,
        voltage: pack.company.voltage ?? null,
        pitch: cfg.led_pitch, wSqm: profile.wSqm, circuitKw: pack.company.circuitKw,
        dataPx: pack.control.dataPx, pxW: env.px_w, kw: env.kw,
        rowRunOf: (row_h) => evalExpr(src, { ...env, row_h }),
      });
      emit('n_data_run', wiring.nDataRun, f.id, ['px_w', 'p', 'data_px']);
      continue;
    }

    for (const [out, src] of Object.entries(f.exprs)) {
      const inputs = varsOf(src);
      if (inputs.some((v) => !(v in env))) continue; // depends on a skipped step
      emit(out, evalExpr(src, env), f.id, inputs);
    }
  }

  const findings = validate({
    cfg, profile, dropped, modW, modH,
    layoutSolved: !!layout,
    widthSolved: !!layout || solvedAxis(cfg.led_opening_w, usable.map((s) => s[0]), cfg.led_cabinet[0], modW),
    heightSolved: !!layout || solvedAxis(cfg.led_opening_h, usable.map((s) => s[1]), cfg.led_cabinet[1], modH),
    custom: layout?.custom ?? false,
  });
  if (wiring?.circuitsExceedColumns) {
    findings.push({
      code: 'LED-PWR-08', severity: 'info', gate: 'compute',
      message: `回路数 ${wiring.nCircuit} 多于箱体列数 ${layout!.widths.length}，部分列需承载一路以上，分组图仅按列示意。`,
    });
  }

  if (wiring) findings.push(...powerFindings(wiring, pack, cfg));

  /* AV-019 §2.3 人工调整 */
  const ov = cfg.led_wiring_override;
  const chain = wiring?.algo === 'chain';
  const manualInfo = ov && ovInput && chain ? { by: ov.by, at: ov.at, power: !!ov.power, data: !!ov.data } : null;
  const manualStale = ov && (ov.power || ov.data) && layout && chain && !ovInput ? { by: ov.by, at: ov.at } : null;
  if (manualStale) {
    findings.push({ code: 'LED-MAN-01', severity: 'warn', gate: 'compute',
      message: `输入已变，人工调整（${ov!.by}）已失效，已回到自动结果；原调整留在历史版本里。` });
  }
  let manualBlock: ComputeResult['manualBlock'] = null;
  if (manualInfo && wiring) {
    const zh: string[] = [], en: string[] = [];
    const ids = (list: number[]) => list.slice(0, 6).map((i) => cellId(layout!.cells[i])).join('、') + (list.length > 6 ? ` 等 ${list.length} 只` : ' ');
    const idsEn = (list: number[]) => list.slice(0, 6).map((i) => cellId(layout!.cells[i])).join(', ') + (list.length > 6 ? ` and ${list.length - 6} more` : '');
    if (wiring.unassigned.power.length) {
      zh.push(`${ids(wiring.unassigned.power)}没分配回路`); en.push(`${idsEn(wiring.unassigned.power)} not on any circuit`);
    }
    if (wiring.unassigned.data.length) {
      zh.push(`${ids(wiring.unassigned.data)}没接网线`); en.push(`${idsEn(wiring.unassigned.data)} not on any data run`);
    }
    const over = wiring.power.map((pc, k) => ({ k, pc })).filter(({ pc }) => pc.w > wiring!.limitW + 1e-6);
    if (over.length) {
      zh.push(`回路 ${over.map(({ k }) => k + 1).join('、')} 超过 ${pack.company.circuitKw} kW`);
      en.push(`circuit ${over.map(({ k }) => k + 1).join(', ')} over ${pack.company.circuitKw} kW`);
    }
    const fat = wiring.runs.map((r, k) => ({ k, r })).filter(({ r }) => r.px > pack.control.dataPx + 1e-6);
    if (fat.length) {
      zh.push(`网线 ${fat.map(({ k }) => k + 1).join('、')} 超过 ${pack.control.dataPx.toLocaleString('en-US')} px`);
      en.push(`data run ${fat.map(({ k }) => k + 1).join(', ')} over ${pack.control.dataPx.toLocaleString('en-US')} px`);
    }
    const dup = [...new Set(wiring.ports.filter((p, k) => wiring!.ports.indexOf(p) !== k))];
    if (dup.length) { zh.push(`网口 ${dup.join('、')} 接了不止一条网线`); en.push(`port ${dup.join(', ')} used by more than one run`); }
    const cmax = pack.company.cascadeMax;
    if (typeof cmax === 'number') {
      const long = wiring.power.map((pc, k) => ({ k, n: pc.cells.length })).filter((x) => x.n > cmax);
      if (long.length) { zh.push(`回路 ${long.map((x) => x.k + 1).join('、')} 串接超过 ${cmax} 只`); en.push(`circuit ${long.map((x) => x.k + 1).join(', ')} chains more than ${cmax} cabinets`); }
    }
    if (zh.length) {
      manualBlock = { zh: `人工调整有违规，只能存草稿：${zh.join('；')}。`, en: `The manual wiring breaks the rules and can only be kept as a draft: ${en.join('; ')}.` };
      findings.push({ code: 'LED-MAN-02', severity: 'warn', gate: 'compute', message: manualBlock.zh });
    }
  }

  return { pack, profile, cfg, trace, layout, wiring, findings, exportable: !blocksExport(findings), manual: manualInfo, manualStale, manualBlock };
}

/* AV-019 §2.2:逐路校核。led@1.0 的分组也照样查 —— 数字不改,但要让人看见超限。 */
function powerFindings(w: WiringResult, pack: RulePack, cfg: LedConfig): Finding[] {
  const out: Finding[] = [];
  const prof = pack.profiles[cfg.led_screen_type];
  if (prof && hasMaxPower(prof) && prof.wSqmMax == null) {
    out.push({ code: 'LED-PWR-12', severity: 'warn', gate: 'compute',
      message: `参数组「${prof.label}」的最大功耗密度待填：回路暂按平均 ${prof.wSqm} W/㎡ 校核，实际可能超载，施工前补实测值。` });
  }
  const over = w.power.map((pc, k) => ({ k, pc })).filter(({ pc }) => pc.w > w.limitW + 1e-6);
  if (over.length) {
    out.push({
      code: 'LED-PWR-09', severity: 'warn', gate: 'compute',
      message: `回路 ${over.map(({ k, pc }) => `${k + 1}（${Math.round(pc.w)} W）`).join('、')} 超过单回路上限 ${pack.company.circuitKw} kW`
        + (w.algo === 'columns' ? `：${pack.version} 按整列分组、分完不校核，升级到新版规则包会按箱体重新分配。` : '。'),
    });
  }
  const spec = cfg.led_power_cable;
  const amp = pack.company.cableAmps?.[spec];
  if (w.voltage && pack.company.cableAmps) {
    if (amp == null) {
      out.push({ code: 'LED-PWR-10', severity: 'info', gate: 'compute', message: `电源线 ${spec} 的载流上限还没填（公司参数 · 线径表），每路电流照算，暂不核对。` });
    } else {
      const hot = w.power.map((pc, k) => ({ k, a: pc.amps ?? 0 })).filter((x) => x.a > amp + 1e-9);
      if (hot.length) {
        out.push({ code: 'LED-PWR-10', severity: 'warn', gate: 'compute',
          message: `回路 ${hot.map((x) => `${x.k + 1}（${x.a.toFixed(1)} A）`).join('、')} 电流超过电源线 ${spec} 的载流上限 ${amp} A：加大线径或加回路。` });
      }
    }
  }
  if (pack.company.cascadeMax === null) {
    out.push({ code: 'LED-PWR-11', severity: 'info', gate: 'compute', message: '箱体电源级联上限：待填，按厂家规格（公司参数）。' });
  } else if (typeof pack.company.cascadeMax === 'number') {
    const max = pack.company.cascadeMax;
    const long = w.power.map((pc, k) => ({ k, n: pc.cells.length })).filter((x) => x.n > max);
    if (long.length) out.push({ code: 'LED-PWR-11', severity: 'warn', gate: 'compute', message: `回路 ${long.map((x) => `${x.k + 1}（${x.n} 只）`).join('、')} 一条电源链串的箱体超过级联上限 ${max} 只。` });
  }
  const fat = w.runs.map((r, k) => ({ k, r })).filter(({ r }) => r.px > (pack.control.dataPx + 1e-6));
  if (fat.length) out.push({ code: 'LED-DATA-01', severity: 'warn', gate: 'compute', message: `数据线 ${fat.map(({ k, r }) => `${k + 1}（${r.px.toLocaleString('en-US')} px）`).join('、')} 超过单线带载 ${pack.control.dataPx.toLocaleString('en-US')} px。` });
  return out;
}

/* Which axis failed, so LED-FIT-01 and -02 can be reported separately. */
const solvedAxis = (total: number, options: number[], primary: number, unit: number) =>
  solveAxis(total, options, primary, unit) !== null;
