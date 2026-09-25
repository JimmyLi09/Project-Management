/* ===== ELV (弱电) · rule pack elv@0.1-draft =====

   A DRAFT from industry practice, covering the three subsystems of the
   prototype's ELV line: security (CCTV + access control), network (structured
   cabling, switches, Wi-Fi) and public address. Standards give some constants
   (TIA-568 link length, IEEE 802.3af/at PoE power); the densities per space
   type are rules of thumb. Every constant is uncalibrated and the pack is marked
   so, which blocks formal export and cost confirmation (ELV-TYPE-01). Sources
   and calibration notes: docs/requirements/015. */

import type { Formula } from '../rulepack.ts';

export type ElvSpace = 'office' | 'showroom' | 'retail' | 'residential';

export interface ElvSpaceProfile {
  code: ElvSpace;
  label: string;
  dataPerSqm: number;   // data outlets per ㎡
  apCovSqm: number;     // ㎡ served by one Wi-Fi access point
  camCovSqm: number;    // ㎡ watched by one indoor camera
}

export interface ElvRulePack {
  line: 'elv';
  version: string;
  issued: string;
  calibrated: boolean;
  note: string;
  spaces: Record<ElvSpace, ElvSpaceProfile>;
  /* engineering constants shared by every space type */
  eng: {
    spare: number; switchPorts: number; patchPorts: number; slack: number; boxM: number;
    apPoeW: number; camPoeW: number; camPerEntrance: number; doorPerEntrance: number;
    earH: number; spkSpread: number; tapW: number; ampHeadroom: number;
    bitrateMbps: number; retentionDays: number; nvrChannels: number; rackSpare: number;
    maxRun: number; switchPoeBudget: number; maxCeilingSpk: number; nvrMaxTb: number;
  };
  formulas: Formula[];
}

const ELV_FORMULAS: Formula[] = [
  { id: 'E1', name: '数据点位', unit: '个', source: '空间类型密度（草案）', kind: 'expr',
    exprs: { n_outlet: 'ceil(area * data_per_sqm) * use_net' } },
  { id: 'E2', name: '无线 AP', unit: '台', source: '覆盖面积（草案）', kind: 'expr',
    exprs: { n_ap: 'ceil(area / ap_cov) * use_net' } },
  { id: 'E3', name: '摄像机', unit: '台', source: '覆盖面积 + 每出入口（草案）', kind: 'expr',
    exprs: { n_cam: '(ceil(area / cam_cov) + entrances * cam_per_entrance) * use_cctv' } },
  { id: 'E4', name: '门禁点', unit: '门', source: '每出入口（草案）', kind: 'expr',
    exprs: { n_door: 'entrances * door_per_entrance * use_access' } },
  { id: 'E5', name: '网络端口', unit: '口', source: '点位 + AP + IP 摄像机', kind: 'expr',
    exprs: { n_port: 'n_outlet + n_ap + n_cam' } },
  { id: 'E6', name: '接入交换机', unit: '台', source: '端口 × (1 + 余量) ÷ 每台端口', kind: 'expr',
    exprs: { n_switch: 'ceil(n_port * (1 + spare) / switch_ports)' } },
  { id: 'E7', name: 'PoE 功率预算', unit: 'W', source: 'IEEE 802.3af 15.4 W / 802.3at 30 W', kind: 'expr',
    exprs: { poe_w: 'n_ap * ap_poe_w + n_cam * cam_poe_w' } },
  { id: 'E8', name: '六类线', unit: 'm', source: '端口 × 平均水平长度 × (1 + 余量)', kind: 'expr',
    exprs: { cable_m: 'n_port * avg_run * (1 + slack)', n_box: 'ceil(cable_m / box_m)' } },
  { id: 'E9', name: '配线架', unit: '个', source: '端口 × (1 + 余量) ÷ 每架端口', kind: 'expr',
    exprs: { n_patch: 'ceil(n_port * (1 + spare) / patch_ports)' } },
  { id: 'E10', name: '吸顶扬声器', unit: '只', source: '90° 覆盖角，边到边布置', kind: 'expr',
    exprs: { spk_spacing: '2 * (ceiling_h - ear_h) * spk_spread', n_spk: 'ceil(area / (spk_spacing * spk_spacing)) * use_pa' } },
  { id: 'E11', name: '功放与分区', unit: 'W', source: '定压抽头 × 扬声器数 × 余量', kind: 'expr',
    exprs: { amp_w: 'n_spk * tap_w * amp_headroom', n_pa_zone: 'floors * use_pa' } },
  { id: 'E12', name: '录像存储与 NVR', unit: 'TB', source: '码率 × 保存天数', kind: 'expr',
    exprs: { nvr_tb: 'n_cam * bitrate * 86400 * retention / 8 / 1000000', n_nvr: 'ceil(n_cam / nvr_ch)' } },
  { id: 'E13', name: '机柜', unit: '台', source: '设备 U 数 × (1 + 余量) ÷ 42U', kind: 'expr',
    exprs: { rack_u: 'n_switch + 2 * n_patch + 2 * n_nvr + 2 * use_pa + 2', n_rack: 'max(1, ceil(rack_u * (1 + rack_spare) / 42))' } },
];

const ELV_V01: ElvRulePack = {
  line: 'elv',
  version: 'elv@0.1-draft',
  issued: '2026-09-25',
  calibrated: false,
  note: '按行业常规编制的草案，点位密度等常量待用公司实际弱电项目校准，校准前不得用于正式报价。',
  spaces: {
    office: { code: 'office', label: '办公', dataPerSqm: 0.2, apCovSqm: 150, camCovSqm: 150 },
    showroom: { code: 'showroom', label: '展厅 / 售楼处', dataPerSqm: 0.05, apCovSqm: 150, camCovSqm: 100 },
    retail: { code: 'retail', label: '零售', dataPerSqm: 0.03, apCovSqm: 200, camCovSqm: 80 },
    residential: { code: 'residential', label: '住宅公区', dataPerSqm: 0.01, apCovSqm: 300, camCovSqm: 150 },
  },
  eng: {
    spare: 0.2, switchPorts: 48, patchPorts: 24, slack: 0.1, boxM: 305,
    apPoeW: 30, camPoeW: 15.4, camPerEntrance: 1, doorPerEntrance: 1,
    earH: 1.2, spkSpread: 1, tapW: 6, ampHeadroom: 1.25,
    bitrateMbps: 4, retentionDays: 30, nvrChannels: 32, rackSpare: 0.3,
    maxRun: 90, switchPoeBudget: 740, maxCeilingSpk: 6, nvrMaxTb: 64,
  },
  formulas: ELV_FORMULAS,
};

const PACKS: Record<string, ElvRulePack> = { [ELV_V01.version]: ELV_V01 };

export const LATEST_ELV_PACK = ELV_V01.version;

export function getElvPack(version: string): ElvRulePack {
  const p = PACKS[version];
  if (!p) throw new Error(`unknown ELV rule pack "${version}"`);
  return p;
}

export function registerElvPack(p: ElvRulePack): void {
  if (PACKS[p.version]) throw new Error(`rule pack "${p.version}" already exists — bump the version`);
  PACKS[p.version] = p;
}
