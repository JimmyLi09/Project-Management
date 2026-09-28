/* ===== ELV (弱电) · system diagram =====
   A schematic, not a floor plan: the equipment room on the left, each enabled
   subsystem's endpoints on the right with their counts, joined by the path they
   take. Same drawing model as the other lines, so SVG and DXF both render it. */

import type { Drawing, Entity } from '../drawing.ts';
import type { ElvResult } from './compute.ts';

const LAYERS = [
  { name: 'ELV-01-机房', aci: 7, rgb: '#FFFFFF' },
  { name: 'ELV-02-网络', aci: 3, rgb: '#3FBF6A' },
  { name: 'ELV-03-安防', aci: 1, rgb: '#E4443C' },
  { name: 'ELV-04-广播', aci: 2, rgb: '#F2C230' },
  { name: 'ELV-07-文字', aci: 7, rgb: '#FFFFFF' },
] as const;
type Name = (typeof LAYERS)[number]['name'];

const BOX_W = 2600, BOX_H = 700, GAP = 300, RACK_W = 2000, END_X = 4200;

export function buildElvDrawing(r: ElvResult, meta: { project: string }): Drawing | null {
  if (!r.ok) return null;
  const v = (k: string) => r.trace[k].value;
  const c = r.cfg;
  const lay = new Map<Name, Entity[]>(LAYERS.map((l) => [l.name, []]));
  const put = (k: Name, ...e: Entity[]) => { lay.get(k)!.push(...e); };
  const txt = (x: number, y: number, s: string, h = 110, anchor: 'start' | 'middle' | 'end' = 'start'): Entity => ({ k: 'text', x, y, h, s, anchor });

  /* endpoint groups, top to bottom */
  const groups: { layer: Name; title: string; detail: string }[] = [];
  if (c.elv_net) {
    groups.push({ layer: 'ELV-02-网络', title: `数据点位 × ${v('n_outlet')}`, detail: `六类线 ${Math.round(v('cable_m')).toLocaleString('en-US')} m（${v('n_box')} 箱）` });
    groups.push({ layer: 'ELV-02-网络', title: `无线 AP × ${v('n_ap')}`, detail: `PoE 802.3at · ${v('n_ap') * r.pack.eng.apPoeW} W` });
  }
  if (c.elv_cctv) groups.push({ layer: 'ELV-03-安防', title: `网络摄像机 × ${v('n_cam')}`, detail: `PoE 802.3af · 录像 ${v('nvr_tb').toFixed(1)} TB / ${r.pack.eng.retentionDays} 天` });
  if (c.elv_access) groups.push({ layer: 'ELV-03-安防', title: `门禁点 × ${v('n_door')}`, detail: '读卡器 + 电锁 + 出门按钮' });
  if (c.elv_pa) groups.push({ layer: 'ELV-04-广播', title: `吸顶扬声器 × ${v('n_spk')}`, detail: `${v('n_pa_zone')} 个分区 · 间距 ${v('spk_spacing').toFixed(1)} m` });

  const totalH = groups.length * BOX_H + (groups.length - 1) * GAP;
  const rackLines = [
    `接入交换机 × ${v('n_switch')}（${r.pack.eng.switchPorts} 口）`,
    `配线架 × ${v('n_patch')}`,
    ...(c.elv_cctv ? [`NVR × ${v('n_nvr')}`] : []),
    ...(c.elv_pa ? [`功放 ${Math.round(v('amp_w'))} W`] : []),
  ];
  const rackH = Math.max(totalH, 400 + rackLines.length * 220);
  put('ELV-01-机房',
    { k: 'rect', x: 0, y: 0, w: RACK_W, h: rackH },
    txt(RACK_W / 2, rackH - 220, `弱电机房 · 机柜 × ${v('n_rack')}`, 130, 'middle'),
    ...rackLines.map((s, i) => txt(160, rackH - 520 - i * 220, s, 100)));

  groups.forEach((g, i) => {
    const y = totalH - (i + 1) * BOX_H - i * GAP + (rackH - totalH) / 2;
    const ym = y + BOX_H / 2;
    put(g.layer,
      { k: 'rect', x: END_X, y, w: BOX_W, h: BOX_H },
      txt(END_X + 150, ym + 60, g.title, 120),
      txt(END_X + 150, ym - 170, g.detail, 90),
      { k: 'line', x1: RACK_W, y1: ym, x2: END_X, y2: ym });
  });

  const info = [
    `项目：${meta.project}`,
    `服务面积 ${c.elv_area} ㎡ · ${c.elv_floors} 层 · ${r.space.label} · 出入口 ${c.elv_entrances} 处`,
    `网络端口 ${v('n_port')} · PoE ${Math.round(v('poe_w'))} W · 机柜 ${v('n_rack')} 台（约 ${v('rack_u')} U）`,
    `规则包 ${r.pack.version}`,
    '本图为方案阶段系统示意，点位数量与路由需按平面图深化并现场复核后方可施工。',
  ];
  if (!r.pack.calibrated) info.push('草图 · 弱电规则包为草案，不得用于正式报价或施工。');
  info.forEach((s, i) => put('ELV-07-文字', txt(0, -400 - i * 160, s, 100)));

  const layers = LAYERS.map((l) => ({ ...l, entities: lay.get(l.name)! }));
  const minY = -400 - info.length * 160 - 100;
  return { title: meta.project, bbox: { minX: 0, minY, maxX: END_X + BOX_W + 200, maxY: rackH + 100 }, layers };
}
