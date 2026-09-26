/* ===== Solar PV (太阳能光伏) · deterministic engine =====
   Runs the pack's formulas with a provenance trace (§9), then the PV checks.
   With no target capacity the roof is filled (fill = 1); with one, the target
   is capped by what the roof holds. */

import { evalExpr, varsOf } from '../expr.ts';
import type { Finding, Provenance, TraceNode } from '../types.ts';
import {
  getPvPack, type PvInverterCode, type PvInverterProfile, type PvModuleCode, type PvModuleProfile,
  type PvMount, type PvMountProfile, type PvRulePack,
} from './rulepack.ts';

/* PV field dictionary — prefix pv_, never shared with other lines (§4). */
export interface PvConfig {
  pv_area: number;            // ㎡ of usable roof, obstacles and setbacks excluded
  pv_mount: PvMount;
  pv_module: PvModuleCode;
  pv_inverter: PvInverterCode;
  pv_target_kwp?: number;     // optional; empty = fill the roof
  pv_dc_run: number;          // m, average one-way run from a string to its inverter
  pv_ac_run: number;          // m, inverter to the AC distribution board
}

export interface PvResult {
  pack: PvRulePack;
  mount: PvMountProfile;
  module: PvModuleProfile;
  inverter: PvInverterProfile;
  cfg: PvConfig;
  trace: Record<string, TraceNode>;
  findings: Finding[];
  ok: boolean;
  exportable: boolean;
}

const UNITS: Record<string, string> = {
  area: '㎡', target_kwp: 'kWp', dc_run: 'm', ac_run: 'm', mod_w: 'Wp', mod_l: 'mm', mod_wd: 'mm', voc: 'V', vmp: 'V',
  mod_kg: 'kg', inv_kw: 'kW', inv_vmax: 'V', mppt_min: 'V', t_min: '°C', t_cell_max: '°C', ghi: 'kWh/㎡·年', mount_kg: 'kg/㎡',
  mod_area: '㎡', n_max: '块', n_mod: '块', kwp: 'kWp', n_inv: '台', ac_kw: 'kW', voc_cold: 'V', vmp_hot: 'V',
  str_max: '块', str_min: '块', n_str: '串', str_short: '块', spec_yield: 'kWh/kWp', yield_kwh: 'kWh', dc_m: 'm', ac_m: 'm',
  n_mc4: '对', load_kg: 'kg/㎡',
};

export function computePv(cfg: PvConfig, packVersion: string, inputProv: Partial<Record<keyof PvConfig, Provenance>> = {}): PvResult {
  const pack = getPvPack(packVersion);
  const mount = pack.mounts[cfg.pv_mount];
  const module = pack.modules[cfg.pv_module];
  const inverter = pack.inverters[cfg.pv_inverter];
  if (!mount || !module || !inverter) throw new Error('unknown PV mount, module or inverter');
  const e = pack.eng;

  const env: Record<string, number> = {};
  const trace: Record<string, TraceNode> = {};
  const seed = (key: string, value: number, prov: Provenance) => {
    env[key] = value;
    trace[key] = { key, value, unit: UNITS[key] ?? '', prov, inputs: [] };
  };
  const manual = (f: keyof PvConfig): Provenance =>
    inputProv[f] ?? { source: `人工输入 · ${f}`, method: 'manual', confidence: 'confirmed' };
  const note = pack.calibrated ? undefined : '草案常量，待校准';
  const from = (what: string, sheet = false): Provenance =>
    ({ source: what, method: 'lookup', confidence: 'confirmed', note: sheet ? '通用规格，按选用型号核对' : note });
  const target = cfg.pv_target_kwp ?? 0;

  seed('area', cfg.pv_area, manual('pv_area'));
  seed('target_kwp', target, target > 0 ? manual('pv_target_kwp') : { source: '未设目标容量', method: 'manual', confidence: 'confirmed' });
  seed('fill', target > 0 ? 0 : 1, { source: target > 0 ? '按目标容量' : '未设目标，按屋面铺满', method: 'manual', confidence: 'confirmed' });
  seed('dc_run', cfg.pv_dc_run, manual('pv_dc_run'));
  seed('ac_run', cfg.pv_ac_run, manual('pv_ac_run'));
  seed('coverage', mount.coverage, from(`安装方式 · ${mount.code}`));
  seed('mount_kg', mount.mountKg, from(`安装方式 · ${mount.code}`));
  const mod = from(`组件 · ${module.code}`, true);
  seed('mod_w', module.w, mod);
  seed('mod_l', module.l, mod);
  seed('mod_wd', module.wd, mod);
  seed('voc', module.voc, mod);
  seed('vmp', module.vmp, mod);
  seed('mod_kg', module.kg, mod);
  const inv = from(`逆变器 · ${inverter.code}`, true);
  seed('inv_kw', inverter.kw, inv);
  seed('inv_vmax', inverter.vmax, inv);
  seed('mppt_min', inverter.mpptMin, inv);
  seed('beta_voc', e.betaVoc, from('工程常量 · 晶硅组件常规温度系数', true));
  seed('beta_vmp', e.betaVmp, from('工程常量 · 晶硅组件常规温度系数', true));
  seed('t_min', e.tMin, from(`工程常量 · ${pack.version}`));
  seed('t_cell_max', e.tCellMax, from(`工程常量 · ${pack.version}`));
  seed('dc_ac', e.dcAc, from(`工程常量 · ${pack.version}`));
  seed('ghi', e.ghi, from(`工程常量 · ${pack.version}`));
  seed('pr', e.pr, from(`工程常量 · ${pack.version}`));
  seed('slack', e.slack, from(`工程常量 · ${pack.version}`));

  const findings: Finding[] = [];
  const block = (code: string, message: string) => findings.push({ code, severity: 'block', gate: 'compute', message });
  const bad = [
    !(cfg.pv_area > 0) && '可用屋面面积', !(target >= 0) && '目标容量',
    !(cfg.pv_dc_run > 0) && '直流线长', !(cfg.pv_ac_run > 0) && '交流线长',
  ].filter(Boolean);
  if (bad.length) block('PV-FIT-01', `${bad.join('、')}填写有误，无法计算。`);

  if (!findings.length) {
    for (const f of pack.formulas) {
      if (f.kind !== 'expr' || !f.exprs) continue;
      for (const [out, src] of Object.entries(f.exprs)) {
        env[out] = evalExpr(src, env);
        trace[out] = {
          key: out, value: env[out], unit: UNITS[out] ?? '', inputs: varsOf(src),
          prov: { source: '公式输出', method: 'rule', rule: f.id, confidence: 'deterministic', note: pack.calibrated ? undefined : '草案公式' },
        };
      }
      /* nothing fits: stop before the string maths divides by zero */
      if (f.id === 'S2' && env.n_mod < 1) {
        block('PV-FIT-02', `可用面积 ${cfg.pv_area} ㎡ 按覆盖率 ${mount.coverage} 放不下一块组件。`);
        break;
      }
    }
  }
  const ok = !findings.length;

  if (ok) {
    if (env.str_short < env.str_min) {
      block('PV-STR-01', `组件只有 ${env.n_mod} 块，每串 ${env.str_short} 块达不到逆变器 MPPT 下限 ${inverter.mpptMin} V 所需的 ${env.str_min} 块，请换小型逆变器。`);
    }
    if (target > 0 && Math.ceil(target * 1000 / module.w) > env.n_max) {
      findings.push({ code: 'PV-FIT-03', severity: 'warn', gate: 'compute',
        message: `目标 ${target} kWp 超过屋面可装 ${(env.n_max * module.w / 1000).toFixed(2)} kWp，按屋面铺满计算。` });
    }
    if (env.dc_ac_real < e.dcAcMin) {
      findings.push({ code: 'PV-INV-01', severity: 'warn', gate: 'compute',
        message: `容配比仅 ${env.dc_ac_real.toFixed(2)}（低于 ${e.dcAcMin}），逆变器偏大，宜换小一档。` });
    }
    if (env.ac_kw >= e.gridLicenceKw) {
      findings.push({ code: 'PV-GRID-01', severity: 'info', gate: 'compute',
        message: `交流容量 ${env.ac_kw} kW 达到 1 MWac，需向 EMA 申请发电许可并按大型嵌入式发电并网流程办理。` });
    }
    findings.push({ code: 'PV-STRUCT-01', severity: 'info', gate: 'compute',
      message: `组件区附加荷载约 ${env.load_kg.toFixed(1)} kg/㎡，须由结构工程师（PE）核算屋面承载后方可施工。` });
  }
  if (!pack.calibrated) {
    findings.push({ code: 'PV-TYPE-01', severity: 'block', gate: 'export', message: `光伏规则包 ${pack.version} 为草案，禁止导出正式文件或确认正式成本。${pack.note}` });
  }
  return {
    pack, mount, module, inverter, cfg, trace, findings,
    ok: !findings.some((f) => f.gate === 'compute' && f.severity === 'block'),
    exportable: !findings.some((f) => f.severity === 'block'),
  };
}
