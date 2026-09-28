/* ===== §5.1 validation rules ===== */

import type { Finding, LedConfig, Size } from './types.ts';
import type { ScreenProfile } from './rulepack.ts';

const isWhole = (x: number) => Math.abs(x - Math.round(x)) < 1e-6;
const fmt = (s: Size) => `${s[0]}×${s[1]}`;

/* Cabinet sizes that are not a whole number of modules are dropped from the
   layout and reported (LED-FIT-03). */
export function usableLib(lib: Size[], modW: number, modH: number): { lib: Size[]; dropped: Size[] } {
  const ok: Size[] = [];
  const dropped: Size[] = [];
  for (const s of lib) (isWhole(s[0] / modW) && isWhole(s[1] / modH) ? ok : dropped).push(s);
  return { lib: ok, dropped };
}

export interface RuleContext {
  cfg: LedConfig;
  profile: ScreenProfile;
  modW: number;
  modH: number;
  dropped: Size[];
  layoutSolved: boolean;
  widthSolved: boolean;
  heightSolved: boolean;
  custom: boolean;
}

export function validate(ctx: RuleContext): Finding[] {
  const { cfg, profile, modW, modH } = ctx;
  const out: Finding[] = [];

  /* LED-VD-01 — "最近观看距离 ≥ 点间距 × 1000（单位换算后）": pitch mm × 1000
     is a distance in mm, i.e. the viewing distance in metres must be at least
     the pitch in millimetres. */
  if (cfg.led_view_min !== undefined && cfg.led_view_min < cfg.led_pitch) {
    out.push({
      code: 'LED-VD-01', severity: 'warn', gate: 'compute',
      message: `最近观看距离 ${cfg.led_view_min} m 小于点间距 P${cfg.led_pitch} 对应的 ${cfg.led_pitch} m，近距离会看到颗粒。`,
    });
  }

  if (!ctx.widthSolved) {
    out.push({
      code: 'LED-FIT-01', severity: 'block', gate: 'compute',
      message: `屏体宽 ${cfg.led_opening_w} mm 无法由模组 ${modW} mm 与箱体库整除拼出，排布无解。需调整屏体尺寸至模组整数倍，或补充箱体规格。`,
    });
  }
  if (!ctx.heightSolved) {
    out.push({
      code: 'LED-FIT-02', severity: 'block', gate: 'compute',
      message: `屏体高 ${cfg.led_opening_h} mm 无法由模组 ${modH} mm 与箱体库整除拼出，排布无解。需调整屏体尺寸至模组整数倍，或补充箱体规格。`,
    });
  }
  if (ctx.dropped.length) {
    out.push({
      code: 'LED-FIT-03', severity: 'warn', gate: 'compute',
      message: `箱体库中 ${ctx.dropped.map(fmt).join('、')} 不是模组 ${modW}×${modH} 的整数倍，已在排布中忽略。`,
    });
  }
  if (ctx.custom) {
    out.push({
      code: 'LED-CAB-01', severity: 'warn', gate: 'compute',
      message: '排布结果出现库外规格组合，需向厂家定制或补充箱体库。',
    });
  }
  if (cfg.led_pwr_dist !== undefined && cfg.led_pwr_dist > 30) {
    out.push({
      code: 'LED-PWR-07', severity: 'info', gate: 'compute',
      message: `强电井距离 ${cfg.led_pwr_dist} m 超过 30 m，建议加装分配电箱。`,
    });
  }
  if (!profile.calibrated) {
    out.push({
      code: 'LED-TYPE-01', severity: 'block', gate: 'export',
      message: `屏体类型「${profile.label}」参数组为待校准（${profile.wSqm} W/㎡ 为占位值），禁止导出正式文件。${profile.note}`,
    });
  }
  return out;
}

export const blocksCompute = (f: Finding[]) => f.some((x) => x.severity === 'block' && x.gate === 'compute');
export const blocksExport = (f: Finding[]) => f.some((x) => x.severity === 'block');
