/* ===== ELV (弱电) · deterministic engine =====
   Runs the pack's formulas with a provenance trace (§9), then the ELV checks.
   Subsystems switch on and off through 0/1 flags inside the formulas, so the
   same expressions serve every combination. */

import { evalExpr, varsOf } from '../expr.ts';
import type { Finding, Provenance, TraceNode } from '../types.ts';
import { getElvPack, type ElvRulePack, type ElvSpace, type ElvSpaceProfile } from './rulepack.ts';

/* ELV field dictionary — prefix elv_, never shared with other lines (§4). */
export interface ElvConfig {
  elv_area: number;          // ㎡ served
  elv_floors: number;
  elv_entrances: number;     // controlled entrances
  elv_ceiling_h: number;     // m
  elv_avg_run: number;       // m, average horizontal cable run to the rack
  elv_space: ElvSpace;
  elv_cctv: boolean;
  elv_access: boolean;
  elv_net: boolean;
  elv_pa: boolean;
}

export interface ElvResult {
  pack: ElvRulePack;
  space: ElvSpaceProfile;
  cfg: ElvConfig;
  trace: Record<string, TraceNode>;
  findings: Finding[];
  ok: boolean;
  exportable: boolean;
}

const UNITS: Record<string, string> = {
  area: '㎡', floors: '层', entrances: '处', ceiling_h: 'm', avg_run: 'm', n_outlet: '个', n_ap: '台', n_cam: '台',
  n_door: '门', n_port: '口', n_switch: '台', poe_w: 'W', cable_m: 'm', n_box: '箱', n_patch: '个', spk_spacing: 'm',
  n_spk: '只', amp_w: 'W', n_pa_zone: '区', nvr_tb: 'TB', n_nvr: '台', rack_u: 'U', n_rack: '台',
};

export function computeElv(cfg: ElvConfig, packVersion: string, inputProv: Partial<Record<keyof ElvConfig, Provenance>> = {}): ElvResult {
  const pack = getElvPack(packVersion);
  const space = pack.spaces[cfg.elv_space];
  if (!space) throw new Error('unknown ELV space type');
  const e = pack.eng;

  const env: Record<string, number> = {};
  const trace: Record<string, TraceNode> = {};
  const seed = (key: string, value: number, prov: Provenance) => {
    env[key] = value;
    trace[key] = { key, value, unit: UNITS[key] ?? '', prov, inputs: [] };
  };
  const manual = (f: keyof ElvConfig): Provenance =>
    inputProv[f] ?? { source: `人工输入 · ${f}`, method: 'manual', confidence: 'confirmed' };
  const note = pack.calibrated ? undefined : '草案常量，待校准';
  const fromSpace: Provenance = { source: `空间类型 · ${space.code}`, method: 'lookup', confidence: 'confirmed', note };
  const fromEng = (std?: string): Provenance => ({ source: std ? `工程常量 · ${std}` : `工程常量 · ${pack.version}`, method: 'lookup', confidence: 'confirmed', note: std ? undefined : note });

  seed('area', cfg.elv_area, manual('elv_area'));
  seed('floors', cfg.elv_floors, manual('elv_floors'));
  seed('entrances', cfg.elv_entrances, manual('elv_entrances'));
  seed('ceiling_h', cfg.elv_ceiling_h, manual('elv_ceiling_h'));
  seed('avg_run', cfg.elv_avg_run, manual('elv_avg_run'));
  seed('use_cctv', cfg.elv_cctv ? 1 : 0, manual('elv_cctv'));
  seed('use_access', cfg.elv_access ? 1 : 0, manual('elv_access'));
  seed('use_net', cfg.elv_net ? 1 : 0, manual('elv_net'));
  seed('use_pa', cfg.elv_pa ? 1 : 0, manual('elv_pa'));
  seed('data_per_sqm', space.dataPerSqm, fromSpace);
  seed('ap_cov', space.apCovSqm, fromSpace);
  seed('cam_cov', space.camCovSqm, fromSpace);
  seed('spare', e.spare, fromEng());
  seed('switch_ports', e.switchPorts, fromEng());
  seed('patch_ports', e.patchPorts, fromEng());
  seed('slack', e.slack, fromEng());
  seed('box_m', e.boxM, fromEng('305 m / 箱'));
  seed('ap_poe_w', e.apPoeW, fromEng('IEEE 802.3at'));
  seed('cam_poe_w', e.camPoeW, fromEng('IEEE 802.3af'));
  seed('cam_per_entrance', e.camPerEntrance, fromEng());
  seed('door_per_entrance', e.doorPerEntrance, fromEng());
  seed('ear_h', e.earH, fromEng());
  seed('spk_spread', e.spkSpread, fromEng());
  seed('tap_w', e.tapW, fromEng());
  seed('amp_headroom', e.ampHeadroom, fromEng());
  seed('bitrate', e.bitrateMbps, fromEng());
  seed('retention', e.retentionDays, fromEng());
  seed('nvr_ch', e.nvrChannels, fromEng());
  seed('rack_spare', e.rackSpare, fromEng());

  const findings: Finding[] = [];
  const bad = [
    !(cfg.elv_area > 0) && '服务面积', !(cfg.elv_floors >= 1) && '层数', !(cfg.elv_entrances >= 0) && '出入口数',
    !(cfg.elv_avg_run > 0) && '平均水平线长',
    cfg.elv_pa && !(cfg.elv_ceiling_h > e.earH) && `吊顶高度（须高于耳高 ${e.earH} m）`,
  ].filter(Boolean);
  if (!(cfg.elv_cctv || cfg.elv_access || cfg.elv_net || cfg.elv_pa)) {
    findings.push({ code: 'ELV-SUB-01', severity: 'block', gate: 'compute', message: '至少勾选一个弱电子系统。' });
  }
  if (bad.length) {
    findings.push({ code: 'ELV-FIT-01', severity: 'block', gate: 'compute', message: `${bad.join('、')}填写有误，无法计算。` });
  }
  const ok = !findings.some((f) => f.severity === 'block');

  if (ok) {
    for (const f of pack.formulas) {
      if (f.kind !== 'expr' || !f.exprs) continue;
      for (const [out, src] of Object.entries(f.exprs)) {
        /* spacing is meaningless without PA; keep it out of a zero-divide */
        if (out === 'spk_spacing' && !cfg.elv_pa) { env[out] = 1; }
        else env[out] = evalExpr(src, env);
        const off = out === 'spk_spacing' && !cfg.elv_pa;
        trace[out] = {
          key: out, value: env[out], unit: UNITS[out] ?? '', inputs: varsOf(src),
          prov: { source: '公式输出', method: 'rule', rule: f.id, confidence: 'deterministic',
            note: off ? '未启用广播，不参与计算' : pack.calibrated ? undefined : '草案公式' },
        };
      }
    }
    if (cfg.elv_avg_run > e.maxRun) {
      findings.push({ code: 'ELV-NET-01', severity: 'warn', gate: 'compute',
        message: `平均水平线长 ${cfg.elv_avg_run} m 超过 TIA-568 永久链路 ${e.maxRun} m，须增设楼层弱电间（IDF）。` });
    }
    const perSwitch = env.n_switch > 0 ? env.poe_w / env.n_switch : 0;
    if (perSwitch > e.switchPoeBudget) {
      findings.push({ code: 'ELV-POE-01', severity: 'warn', gate: 'compute',
        message: `每台交换机平均 PoE 负载 ${Math.round(perSwitch)} W，超过常规 ${e.switchPoeBudget} W，需大功率 PoE 交换机或增加台数。` });
    }
    if (cfg.elv_pa && cfg.elv_ceiling_h > e.maxCeilingSpk) {
      findings.push({ code: 'ELV-PA-01', severity: 'warn', gate: 'compute',
        message: `吊顶高度 ${cfg.elv_ceiling_h} m 超过 ${e.maxCeilingSpk} m，吸顶扬声器不适用，宜改用号角或音柱。` });
    }
    if (env.nvr_tb > e.nvrMaxTb) {
      findings.push({ code: 'ELV-NVR-01', severity: 'info', gate: 'compute',
        message: `录像存储约 ${env.nvr_tb.toFixed(1)} TB，超过单台 NVR 常规 ${e.nvrMaxTb} TB，需存储扩展或多台 NVR。` });
    }
  }
  if (!pack.calibrated) {
    findings.push({ code: 'ELV-TYPE-01', severity: 'block', gate: 'export', message: `弱电规则包 ${pack.version} 为草案，禁止导出正式文件或确认正式成本。${pack.note}` });
  }
  return { pack, space, cfg, trace, findings, ok, exportable: !findings.some((f) => f.severity === 'block') };
}
