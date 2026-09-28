/* ===== Solar PV (太阳能光伏) · single-line diagram =====
   A schematic, not a roof layout: array → inverters → AC distribution board →
   grid, with the DC and AC runs between them. Same drawing model as the other
   lines, so SVG and DXF both render it. */

import type { Drawing, Entity } from '../drawing.ts';
import type { PvResult } from './compute.ts';

const LAYERS = [
  { name: 'PV-01-阵列', aci: 4, rgb: '#4FC3D9' },
  { name: 'PV-02-直流', aci: 1, rgb: '#E4443C' },
  { name: 'PV-03-交流', aci: 5, rgb: '#4A7BE0' },
  { name: 'PV-04-并网', aci: 2, rgb: '#F2C230' },
  { name: 'PV-07-文字', aci: 7, rgb: '#FFFFFF' },
] as const;
type Name = (typeof LAYERS)[number]['name'];

const BOX_W = 2600, BOX_H = 1400, GAP = 1300;

export function buildPvDrawing(r: PvResult, meta: { project: string }): Drawing | null {
  if (!r.ok) return null;
  const v = (k: string) => r.trace[k].value;
  const lay = new Map<Name, Entity[]>(LAYERS.map((l) => [l.name, []]));
  const put = (k: Name, ...e: Entity[]) => { lay.get(k)!.push(...e); };
  const txt = (x: number, y: number, s: string, h = 110, anchor: 'start' | 'middle' | 'end' = 'start'): Entity => ({ k: 'text', x, y, h, s, anchor });

  const boxes: { layer: Name; lines: string[] }[] = [
    { layer: 'PV-01-阵列', lines: [`光伏阵列 ${v('kwp').toFixed(2)} kWp`, `${r.module.label} × ${v('n_mod')}`, `${v('n_str')} 串 · 每串 ≤ ${v('str_max')} 块`] },
    { layer: 'PV-02-直流', lines: [`逆变器 × ${v('n_inv')}`, `${r.inverter.label}`, `容配比 ${v('dc_ac_real').toFixed(2)}`] },
    { layer: 'PV-03-交流', lines: ['交流配电箱', '隔离开关 · 防雷 · 保护', `${v('ac_kw')} kW`] },
    { layer: 'PV-04-并网', lines: ['电网并网点', '计量表', `年发电约 ${Math.round(v('yield_kwh')).toLocaleString('en-US')} kWh`] },
  ];
  const links: [Name, string][] = [
    ['PV-02-直流', `直流光伏线 ${v('dc_m').toLocaleString('en-US')} m`],
    ['PV-03-交流', `交流电缆 ${v('ac_m').toLocaleString('en-US')} m`],
    ['PV-04-并网', ''],
  ];
  boxes.forEach((b, i) => {
    const x = i * (BOX_W + GAP);
    put(b.layer, { k: 'rect', x, y: 0, w: BOX_W, h: BOX_H },
      ...b.lines.map((s, j) => txt(x + BOX_W / 2, BOX_H - 360 - j * 330, s, j ? 100 : 130, 'middle')));
    if (i < links.length) {
      const [layer, label] = links[i];
      put(layer, { k: 'line', x1: x + BOX_W, y1: BOX_H / 2, x2: x + BOX_W + GAP, y2: BOX_H / 2 });
      if (label) put(layer, txt(x + BOX_W + GAP / 2, BOX_H / 2 + 120, label, 90, 'middle'));
    }
  });

  const c = r.cfg;
  const info = [
    `项目：${meta.project}`,
    `可用屋面 ${c.pv_area} ㎡ · ${r.mount.label} · ${c.pv_target_kwp ? `目标 ${c.pv_target_kwp} kWp` : '按屋面铺满'}`,
    `组件区附加荷载约 ${v('load_kg').toFixed(1)} kg/㎡ · 年发电 ${Math.round(v('spec_yield'))} kWh/kWp`,
    `规则包 ${r.pack.version}`,
    '本图为方案阶段单线示意，组件排布、组串与保护配置须按屋面勘测深化，经结构与电气专业核定后方可施工。',
  ];
  if (!r.pack.calibrated) info.push('草图 · 光伏规则包为草案，不得用于正式报价或施工。');
  info.forEach((s, i) => put('PV-07-文字', txt(0, -400 - i * 160, s, 100)));

  const layers = LAYERS.map((l) => ({ ...l, entities: lay.get(l.name)! }));
  const minY = -400 - info.length * 160 - 100;
  return { title: meta.project, bbox: { minX: 0, minY, maxX: 4 * BOX_W + 3 * GAP + 200, maxY: BOX_H + 100 }, layers };
}
