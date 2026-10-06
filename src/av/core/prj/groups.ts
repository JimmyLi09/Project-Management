/* ===== Projection · prj@0.2 engine (AV-020 §3.3) =====
   A space is split into blend groups; a group is one continuous blended image
   made of one or more faces (walls with a turn angle, or floor). A single wall
   is one group with one face. Every figure is deterministic code; findings are
   rules, not suggestions from a model. The prototype's calcGroup() is the
   reference implementation; the three finished projects are the unit tests. */

import type { Finding } from '../types.ts';
import { lensOf, PRJ_LIBRARY_SEED, type PrjLens, type PrjLibrary, type PrjProjector } from './library.ts';
import type { PrjConfig } from './compute.ts';
import { getPrjGroupsPack, type PrjEnv, type PrjRulePack2 } from './rulepack.ts';

export type PrjFaceKind = 'wall' | 'floor';
export interface PrjFace {
  kind: PrjFaceKind;
  w: number;          // mm (floor: length)
  h: number;          // mm (floor: width)
  turn: number;       // ° turn from the previous face, plan view (walls)
}
export interface PrjGroup {
  name: string;
  projector: string;  // library code
  lens: string;       // lens code of that projector
  dmax: number;       // m, available throw distance (walls)
  bottom: number;     // m, image bottom above the floor (walls)
  faces: PrjFace[];
}
export type PrjInteract = 'none' | 'wall' | 'floor';

/* Projection field dictionary for prj@0.2 — prefix prj_, as on prj@0.1. */
export interface PrjGroupsConfig {
  prj_ceiling: number;      // m
  prj_env: PrjEnv;
  prj_view_near: number;    // m, nearest viewer to the image; 0 = not given
  prj_interact: PrjInteract;
  prj_groups: PrjGroup[];
}

export interface PrjGroupResult {
  group: PrjGroup;
  projector: PrjProjector;
  lens: PrjLens;
  floor: boolean;
  L: number;          // m, unfolded width
  H: number;          // m, tallest face
  aspect: number;
  overlap: number;
  n: number;
  reason: 'height' | 'brightness';
  w: number;          // m, one projector's image
  h: number;
  blend: number;      // m
  lux: number;        // company rule: lumens ÷ (w × h)
  luxIndustry: number;
  target: number;
  tMin: number;       // m, throw needed at the lens's shortest / longest ratio
  tMax: number;
  d: number;          // m, throw used
  dOk: boolean;
  lensH: number;      // m above the floor (floor groups: hanging height)
  shift: number | null;  // vertical lens shift needed, share of h (null: UST / floor)
  ceilOk: boolean;
  shadowY: number | null;  // m, ray height at the nearest viewer
  shadow: boolean;
  pixel: number;      // mm
  kw: number;
}

export interface PrjGroupsResult {
  pack: PrjRulePack2;
  cfg: PrjGroupsConfig;
  groups: PrjGroupResult[];
  findings: Finding[];
  nProj: number;
  kw: number;
  nCircuit: number;
  ok: boolean;          // inputs valid, figures computed
  exportable: boolean;  // no red finding (export carries「部分常数待校准」while the pack is uncalibrated)
}

const f2 = (x: number) => x.toFixed(2);
const mm = (m: number) => Math.round(m * 1000);

export function computePrjGroups(cfg: PrjGroupsConfig, packVersion: string, lib: PrjLibrary = PRJ_LIBRARY_SEED): PrjGroupsResult {
  const pack = getPrjGroupsPack(packVersion);
  const K = pack.constants;
  const findings: Finding[] = [];
  const push = (code: string, severity: Finding['severity'], gate: Finding['gate'], message: string, messageEn: string) =>
    findings.push({ code, severity, gate, message, messageEn });

  /* PRJ-FIT-01: inputs the engine cannot work with */
  const bad: [string, string][] = [];
  if (!(cfg.prj_ceiling > 0)) bad.push(['天花高度', 'ceiling height']);
  if (!(cfg.prj_view_near >= 0)) bad.push(['最近观众离墙距离', 'nearest viewer distance']);
  if (!cfg.prj_groups?.length) bad.push(['至少一个融合组', 'at least one blend group']);
  for (const g of cfg.prj_groups ?? []) {
    if (!lib[g.projector]) bad.push([`${g.name} 的投影机`, `projector of ${g.name}`]);
    if (!g.faces?.length) bad.push([`${g.name} 至少一个投影面`, `at least one face in ${g.name}`]);
    else if (g.faces.some((f) => !(f.w > 0) || !(f.h > 0))) bad.push([`${g.name} 的投影面宽高`, `face sizes in ${g.name}`]);
    else if (new Set(g.faces.map((f) => f.kind)).size > 1) bad.push([`${g.name} 不能同时有墙和地面（分成两组）`, `${g.name} mixes wall and floor (split into two groups)`]);
    else if (g.faces[0].kind === 'wall' && !(g.dmax > 0)) bad.push([`${g.name} 的可用投射距离`, `available throw in ${g.name}`]);
    if (!(g.bottom >= 0)) bad.push([`${g.name} 的画面离地`, `image height above floor in ${g.name}`]);
  }
  if (bad.length) {
    push('PRJ-FIT-01', 'block', 'compute', `${bad.map((b) => b[0]).join('、')}无效，无法计算。`, `Invalid input: ${bad.map((b) => b[1]).join(', ')}.`);
    return { pack, cfg, groups: [], findings, nProj: 0, kw: 0, nCircuit: 0, ok: false, exportable: false };
  }

  const o = K.overlap.value;
  const head = K.head.value;
  const near = cfg.prj_view_near;
  const groups = cfg.prj_groups.map((g): PrjGroupResult => {
    const p = lib[g.projector];
    const lens = lensOf(p, g.lens);
    const aspect = p.resW / p.resH;
    const floor = g.faces[0].kind === 'floor';
    const L = g.faces.reduce((a, f) => a + f.w, 0) / 1000;
    const H = Math.max(...g.faces.map((f) => f.h)) / 1000;
    const target = K.lux.value[cfg.prj_env];
    /* §3.3 ②–⑤: one image must cover the full height; enough projectors to span
       the width with blend bands; more if the company brightness rule fails */
    const wH = H * aspect;
    let n = Math.max(1, Math.ceil((L / wH - o) / (1 - o) - 1e-9));
    let reason: PrjGroupResult['reason'] = 'height';
    let w = 0, h = 0, lux = 0;
    for (;;) {
      w = Math.max(L / (n * (1 - o) + o), wH);
      h = w / aspect;
      lux = p.lumens / (w * h);
      if (lux >= target || n >= 40) break;
      n += 1;
      reason = 'brightness';
    }
    /* ⑥ throw: anywhere in the lens's range that the room allows, as far back as it allows */
    const tMin = lens.throwMin * w, tMax = lens.throwMax * w;
    let d: number, dOk: boolean;
    if (floor) {
      d = cfg.prj_ceiling - K.drop.value;
      dOk = d >= tMin - 1e-6 && d <= tMax + 1e-6;
    } else if (tMin > g.dmax + 1e-6) {
      d = tMin; dOk = false;
    } else {
      d = Math.min(Math.max(g.dmax, tMin), tMax); dOk = true;
    }
    /* ⑦ lens height: hung from the ceiling, limited by the lens shift the projector has */
    const bottom = g.bottom;
    const top = bottom + h;
    let lensH: number, shift: number | null = null, ceilOk = true;
    if (floor) {
      lensH = d;
    } else if (lens.ust) {
      lensH = Math.min(top + K.ustTop.value, cfg.prj_ceiling - 0.05);
      ceilOk = top + K.ustTop.value <= cfg.prj_ceiling + 1e-6;
    } else {
      const centre = bottom + h / 2;
      lensH = Math.min(cfg.prj_ceiling - K.drop.value, centre + p.shiftUp * h);
      shift = (lensH - centre) / h;
      ceilOk = shift >= -p.shiftDown - 1e-6;
    }
    /* ⑧ shadow: height of the lowest ray where the nearest viewer stands */
    let shadowY: number | null = null, shadow = false;
    if (!floor && !lens.ust && near > 0 && d > near) {
      shadowY = bottom + (lensH - bottom) * (near / d);
      shadow = shadowY < head;
    }
    if (floor && cfg.prj_interact === 'floor') shadow = true;
    return {
      group: g, projector: p, lens, floor, L, H, aspect, overlap: o, n, reason, w, h, blend: o * w,
      lux, luxIndustry: lux * K.industryDerate.value, target, tMin, tMax, d, dOk, lensH, shift, ceilOk, shadowY, shadow,
      pixel: (w * 1000) / p.resW, kw: (n * p.watts) / 1000,
    };
  });

  for (const r of groups) {
    const nm = r.group.name;
    if (!r.dOk && !r.floor) {
      push('PRJ-THROW-01', 'block', 'export',
        `${nm}：镜头「${r.lens.name}」投 ${f2(r.w)} m 宽的画面至少要 ${f2(r.tMin)} m，可用距离只有 ${r.group.dmax} m —— 换短焦镜头或加台数。`,
        `${nm}: the lens "${r.lens.nameEn}" needs at least ${f2(r.tMin)} m for a ${f2(r.w)} m wide image, but only ${r.group.dmax} m is available — use a shorter-throw lens or more projectors.`);
    }
    if (!r.dOk && r.floor) {
      push('PRJ-THROW-02', 'block', 'export',
        `${nm}：天花 ${cfg.prj_ceiling} m 减吊装下沉 ${K.drop.value} m 后投射距离 ${f2(r.d)} m，镜头「${r.lens.name}」需要 ${f2(r.tMin)}–${f2(r.tMax)} m —— 换镜头或调整单台画面。`,
        `${nm}: after the ${K.drop.value} m drop from a ${cfg.prj_ceiling} m ceiling the throw is ${f2(r.d)} m, but the lens "${r.lens.nameEn}" needs ${f2(r.tMin)}–${f2(r.tMax)} m — change the lens or the image size.`);
    }
    if (!r.ceilOk) {
      push('PRJ-CEIL-01', 'block', 'export',
        r.lens.ust
          ? `${nm}：天花太矮 —— 超短焦机要装在画面顶 ${f2(r.group.bottom + r.h)} m 上方 ${K.ustTop.value} m，超过天花 ${cfg.prj_ceiling} m（常见坑 3）。`
          : `${nm}：天花太矮 —— 镜头最高只能装到 ${f2(r.lensH)} m，需要向下位移 ${Math.round(-(r.shift ?? 0) * 100)}%，机器最多 ${Math.round(r.projector.shiftDown * 100)}%（常见坑 3）。`,
        r.lens.ust
          ? `${nm}: ceiling too low — the ultra-short-throw unit must sit ${K.ustTop.value} m above the image top (${f2(r.group.bottom + r.h)} m), above the ${cfg.prj_ceiling} m ceiling.`
          : `${nm}: ceiling too low — the lens can go no higher than ${f2(r.lensH)} m, which needs ${Math.round(-(r.shift ?? 0) * 100)}% downward lens shift; the projector allows ${Math.round(r.projector.shiftDown * 100)}%.`);
    }
    if (r.lux < r.target) {
      push('PRJ-LUX-01', 'block', 'export',
        `${nm}：照度 ${Math.round(r.lux)} lx 低于目标 ${r.target} lx。`,
        `${nm}: illuminance ${Math.round(r.lux)} lx is below the ${r.target} lx target.`);
    }
    if (near > 0 && r.pixel > near) {
      push('PRJ-PX-01', 'warn', 'compute',
        `${nm}：单像素 ${r.pixel.toFixed(1)} mm，观众最近 ${near} m —— 会觉得不够清晰（114 / MY016 验收问题）。建议 4K 机型或加台数缩小单台画面。`,
        `${nm}: one pixel is ${r.pixel.toFixed(1)} mm with viewers as close as ${near} m — it will look soft (handover issue on 114 / MY016). Use 4K projectors or more units with smaller images.`);
    }
    if (r.shadow && !r.floor) {
      push('PRJ-SHADOW-01', 'warn', 'compute',
        `${nm}：人站在离墙 ${near} m 处，光线在 ${f2(r.shadowY ?? 0)} m 高，低于人头 ${head} m，会挡光${cfg.prj_interact === 'wall' ? ' —— 有墙面互动，建议背投或超短焦' : ''}。`,
        `${nm}: at ${near} m from the wall the lowest ray is ${f2(r.shadowY ?? 0)} m high, below head height (${head} m), so people will cast shadows${cfg.prj_interact === 'wall' ? ' — with wall interaction, consider rear projection or ultra-short throw' : ''}.`);
    }
    if (r.shadow && r.floor) {
      push('PRJ-SHADOW-02', 'warn', 'compute',
        `${nm}：地面互动会有人影 —— 建议两台交叉覆盖同一区域，或按公司做法接受人影。`,
        `${nm}: floor interaction will show people's shadows — cover the area from two projectors, or accept shadows per company practice.`);
    }
    if (r.n >= 2) {
      push('PRJ-BLEND-01', 'info', 'compute',
        `${nm}：${r.n} 台融合，融合带 ${mm(r.blend)} mm（占 ${Math.round(r.overlap * 100)}%）—— 需要融合软件 / 融合器（公司规则：2 台以上）。`,
        `${nm}: ${r.n} projectors blended, ${mm(r.blend)} mm bands (${Math.round(r.overlap * 100)}%) — needs blending software (company rule: two or more projectors).`);
    }
    if (r.n >= 2 && r.overlap < K.blendMin.value) {
      push('PRJ-BLEND-02', 'warn', 'compute',
        `${nm}：融合带占比 ${Math.round(r.overlap * 100)}% 小于 ${Math.round(K.blendMin.value * 100)}%，容易出融合缝。`,
        `${nm}: a ${Math.round(r.overlap * 100)}% blend band is under ${Math.round(K.blendMin.value * 100)}% and seams are likely.`);
    }
    if (r.projector.lumens > K.maxLm.value) {
      push('PRJ-LM-01', 'warn', 'compute',
        `${nm}：单机 ${r.projector.lumens.toLocaleString('en-US')} lm，超出公司常用上限 ${K.maxLm.value.toLocaleString('en-US')} lm。`,
        `${nm}: ${r.projector.lumens.toLocaleString('en-US')} lm per projector is above the company's usual ${K.maxLm.value.toLocaleString('en-US')} lm.`);
    }
  }
  if (cfg.prj_interact !== 'none') {
    push('PRJ-INT-01', 'info', 'compute',
      `有${cfg.prj_interact === 'wall' ? '墙面' : '地面'}互动：按覆盖面积配雷达；MY014 验收问题「互动不灵敏」—— 技术方案提示预留雷达标定时间。`,
      `${cfg.prj_interact === 'wall' ? 'Wall' : 'Floor'} interaction: radars sized to the area; MY014 handover found it unresponsive — allow time to calibrate the radars.`);
  }
  push('PRJ-SHAKE-01', 'info', 'compute',
    '常见坑 4「天花 / 建筑抖动导致融合错位」：用防震吊架，安装后复核融合。',
    'Common pitfall 4, building vibration shifts the blend: use anti-vibration mounts and recheck after installation.');
  if (!pack.calibrated) {
    const open = Object.values(K).filter((k) => !k.confirmed).length;
    push('PRJ-CAL-01', 'info', 'export',
      `规则包 ${pack.version} 有 ${open} 个常数待 PD 确认：可以导出，文件上标「部分常数待校准」。`,
      `${open} constants in ${pack.version} await PD confirmation: files can be exported and are marked "some constants not yet calibrated".`);
  }

  const nProj = groups.reduce((a, r) => a + r.n, 0);
  const kw = groups.reduce((a, r) => a + r.kw, 0);
  return {
    pack, cfg, groups, findings, nProj, kw, nCircuit: Math.ceil(kw / K.circuitKw.value - 1e-9), ok: true,
    exportable: !findings.some((f) => f.severity === 'block'),
  };
}

/* Old prj@0.1 configurations (one flat image) become one group with one wall
   when the project is upgraded. Fields prj@0.1 never had get conservative
   defaults the user is told to check. */
export function migratePrjV01(old: PrjConfig): PrjGroupsConfig {
  const env: PrjEnv = old.prj_ambient_lux <= 150 ? 'dark' : old.prj_ambient_lux <= 300 ? 'window' : 'bright';
  return {
    prj_ceiling: Math.max(3.5, Math.ceil((old.prj_image_h / 1000 + 0.8) * 10) / 10),
    prj_env: env,
    prj_view_near: old.prj_view_near ?? 0,
    prj_interact: 'none',
    prj_groups: [{
      name: '主画面', projector: 'PU800', lens: 'std', dmax: old.prj_throw_dist, bottom: 0,
      faces: [{ kind: 'wall', w: old.prj_image_w, h: old.prj_image_h, turn: 0 }],
    }],
  };
}

/* Rollback only (scripts/av020-rollback): turn a prj@0.2 configuration back into
   the single image prj@0.1 understands — the first group, unfolded, at its
   available throw. The original is kept in the rollback log for re-deployment. */
export function demotePrjV02(cfg: PrjGroupsConfig): PrjConfig {
  const g = cfg.prj_groups[0];
  const floor = g.faces[0]?.kind === 'floor';
  return {
    prj_image_w: g.faces.reduce((a, f) => a + f.w, 0),
    prj_image_h: Math.max(...g.faces.map((f) => f.h)),
    prj_throw_dist: floor ? Math.max(0.5, cfg.prj_ceiling - 0.4) : g.dmax,
    prj_ambient_lux: { dark: 150, window: 250, bright: 500 }[cfg.prj_env],
    prj_screen_gain: 1,
    prj_content: 'basic',
    prj_profile: 'laser_wuxga',
    ...(cfg.prj_view_near > 0 ? { prj_view_near: cfg.prj_view_near } : {}),
  };
}

export const isGroupsConfig = (cfg: unknown): cfg is PrjGroupsConfig =>
  !!cfg && typeof cfg === 'object' && Array.isArray((cfg as PrjGroupsConfig).prj_groups);
