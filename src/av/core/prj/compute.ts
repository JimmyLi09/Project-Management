/* ===== Projection · deterministic engine =====
   Runs the pack's formulas in order with a provenance-tagged trace (§9), then
   the PRJ validation rules. No model touches any figure here (§1). */

import { evalExpr, varsOf } from '../expr.ts';
import type { Finding, Provenance, TraceNode } from '../types.ts';
import { getPrjPack, type PrjContent, type PrjProfile, type PrjProfileCode, type PrjRulePack } from './rulepack.ts';

/* Projection field dictionary — prefix prj_, never shared with other lines (§4). */
export interface PrjConfig {
  prj_image_w: number;        // mm, projected image width
  prj_image_h: number;        // mm
  prj_throw_dist: number;     // m, lens to screen
  prj_ambient_lux: number;    // lx on the screen surface
  prj_screen_gain: number;
  prj_content: PrjContent;
  prj_profile: PrjProfileCode;
  prj_view_far?: number;      // m, farthest viewer
  prj_view_near?: number;     // m, nearest viewer
}

export interface PrjResult {
  pack: PrjRulePack;
  profile: PrjProfile;
  cfg: PrjConfig;
  trace: Record<string, TraceNode>;
  findings: Finding[];
  ok: boolean;          // inputs valid, figures computed
  exportable: boolean;  // no blocking finding (PRJ-TYPE-01 while the pack is a draft)
}

const UNITS: Record<string, string> = {
  W: 'mm', H: 'mm', throw_dist: 'm', ambient: 'lx', gain: '', contrast: ':1', native_aspect: '', native_px_w: 'px',
  native_px_h: 'px', overlap: '', util_min: '', derate: '', min_nits: 'cd/㎡', w_per_klm: 'W/klm', circuit_kw: 'kW',
  aspect: '', area: '㎡', n_proj: '台', w_proj: 'mm', h_proj: 'mm', throw_ratio: '', e_req: 'lx', lm_proj: 'lm',
  px_w: 'px', px_h: 'px', pixel_mm: 'mm', kw: 'kW', n_circuit: '路', n_signal_cable: '根',
};

export function computePrj(cfg: PrjConfig, packVersion: string, inputProv: Partial<Record<keyof PrjConfig, Provenance>> = {}): PrjResult {
  const pack = getPrjPack(packVersion);
  const profile = pack.profiles[cfg.prj_profile];
  const content = pack.content[cfg.prj_content];
  if (!profile || !content) throw new Error('unknown projector profile or content class');

  const env: Record<string, number> = {};
  const trace: Record<string, TraceNode> = {};
  const seed = (key: string, value: number, prov: Provenance) => {
    env[key] = value;
    trace[key] = { key, value, unit: UNITS[key] ?? '', prov, inputs: [] };
  };
  const manual = (f: keyof PrjConfig): Provenance =>
    inputProv[f] ?? { source: `人工输入 · ${f}`, method: 'manual', confidence: 'confirmed' };
  const draft = pack.calibrated ? undefined : '草案常量，待校准';
  const fromProfile: Provenance = { source: `参数组 · ${profile.code}`, method: 'lookup', confidence: 'confirmed', note: draft };
  const fromContent: Provenance = { source: `内容类别 · ${content.code}（ANSI/INFOCOMM 3M-2011）`, method: 'lookup', confidence: 'confirmed' };

  seed('W', cfg.prj_image_w, manual('prj_image_w'));
  seed('H', cfg.prj_image_h, manual('prj_image_h'));
  seed('throw_dist', cfg.prj_throw_dist, manual('prj_throw_dist'));
  seed('ambient', cfg.prj_ambient_lux, manual('prj_ambient_lux'));
  seed('gain', cfg.prj_screen_gain, manual('prj_screen_gain'));
  seed('contrast', content.contrast, fromContent);
  seed('native_px_w', profile.nativePxW, fromProfile);
  seed('native_px_h', profile.nativePxH, fromProfile);
  seed('native_aspect', profile.nativePxW / profile.nativePxH, fromProfile);
  seed('overlap', profile.overlap, fromProfile);
  seed('util_min', profile.utilMin, fromProfile);
  seed('derate', profile.derate, fromProfile);
  seed('min_nits', profile.minNits, fromProfile);
  seed('w_per_klm', profile.wPerKlm, fromProfile);
  seed('circuit_kw', pack.company.circuitKw, { source: `公司参数 · ${pack.version}`, method: 'lookup', confidence: 'confirmed' });

  const findings: Finding[] = [];
  const bad = [
    !(cfg.prj_image_w > 0) && '画面宽', !(cfg.prj_image_h > 0) && '画面高', !(cfg.prj_throw_dist > 0) && '投射距离',
    !(cfg.prj_ambient_lux >= 0) && '环境照度', !(cfg.prj_screen_gain > 0) && '幕布增益',
  ].filter(Boolean);
  if (bad.length) {
    findings.push({ code: 'PRJ-FIT-01', severity: 'block', gate: 'compute', message: `${bad.join('、')}须为正数，无法计算。` });
  } else {
    for (const f of pack.formulas) {
      if (f.kind !== 'expr' || !f.exprs) continue;
      for (const [out, src] of Object.entries(f.exprs)) {
        const inputs = varsOf(src);
        env[out] = evalExpr(src, env);
        trace[out] = {
          key: out, value: env[out], unit: UNITS[out] ?? '', inputs,
          prov: { source: '公式输出', method: 'rule', rule: f.id, confidence: 'deterministic', note: pack.calibrated ? undefined : '草案公式' },
        };
      }
    }
    const t = pack.thresholds;
    const tr = env.throw_ratio;
    if (tr < t.ustThrow) {
      findings.push({ code: 'PRJ-TR-01', severity: 'warn', gate: 'compute', message: `投射比 ${tr.toFixed(2)} 低于 ${t.ustThrow}，需超短焦镜头，选型受限。` });
    } else if (tr < profile.lensMin || tr > profile.lensMax) {
      findings.push({ code: 'PRJ-TR-02', severity: 'info', gate: 'compute', message: `投射比 ${tr.toFixed(2)} 超出标准镜头 ${profile.lensMin}–${profile.lensMax}，需选配镜头。` });
    }
    const hM = cfg.prj_image_h / 1000;
    if (cfg.prj_view_far !== undefined && cfg.prj_view_far > content.viewFactor * hM) {
      findings.push({ code: 'PRJ-VD-01', severity: 'warn', gate: 'compute',
        message: `最远观看距离 ${cfg.prj_view_far} m 超过「${content.label}」的 ${content.viewFactor} 倍画面高（${(content.viewFactor * hM).toFixed(1)} m），远处看不清，建议加大画面。` });
    }
    const visible = env.pixel_mm * t.arcminFactor;
    if (cfg.prj_view_near !== undefined && cfg.prj_view_near < visible) {
      findings.push({ code: 'PRJ-VD-02', severity: 'info', gate: 'compute',
        message: `最近观看距离 ${cfg.prj_view_near} m 小于像素可见距离 ${visible.toFixed(1)} m（像素 ${env.pixel_mm.toFixed(2)} mm），近处可见像素颗粒。` });
    }
    if (env.lm_proj > profile.maxLm) {
      findings.push({ code: 'PRJ-BR-01', severity: 'warn', gate: 'compute',
        message: `单机需 ${Math.round(env.lm_proj).toLocaleString('en-US')} lm，超过常规上限 ${profile.maxLm.toLocaleString('en-US')} lm，需叠加投影或降低环境光。` });
    }
    if (cfg.prj_ambient_lux > t.ambientMax) {
      findings.push({ code: 'PRJ-AMB-01', severity: 'warn', gate: 'compute',
        message: `环境照度 ${cfg.prj_ambient_lux} lx 超过 ${t.ambientMax} lx，投影难以保证对比度，建议改用 LED。` });
    }
  }
  if (!pack.calibrated) {
    findings.push({ code: 'PRJ-TYPE-01', severity: 'block', gate: 'export', message: `投影规则包 ${pack.version} 为草案，禁止导出正式文件或确认正式成本。${pack.note}` });
  }
  const ok = !findings.some((f) => f.severity === 'block' && f.gate === 'compute');
  return { pack, profile, cfg, trace, findings, ok, exportable: !findings.some((f) => f.severity === 'block') };
}
