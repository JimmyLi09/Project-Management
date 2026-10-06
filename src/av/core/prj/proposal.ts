/* ===== Projection technical proposal (AV-020 §3.4 ⑥) · content =====
   Configuration, system devices, the calculation basis (the same table as 05
   and the DXF notes), the rule checks and the common pitfalls, in Chinese or
   English. Same ProposalDoc shape as LED, so services/drawing/avdrawing/proposal.py
   typesets it unchanged. Until PD has confirmed every constant the cover and
   the notes say「部分常数待校准」(§3.7). */

import { COMPANY, type ProposalDoc, type ProposalLang, type ProposalSection } from '../proposal.ts';
import { prjCalcBasis } from './calc.ts';
import type { PrjGroupResult, PrjGroupsResult } from './groups.ts';
import { prjSystem } from './system.ts';

const f2 = (x: number) => x.toFixed(2);
const mm = (m: number) => Math.round(m * 1000);
const ENV: Record<string, [string, string]> = { dark: ['暗室', 'dark room'], window: ['有窗', 'windows'], bright: ['明亮', 'bright'] };

export function prjProposalDoc(r: PrjGroupsResult, meta: { title: string; client?: string; lang: ProposalLang; date: string }): ProposalDoc | null {
  if (!r.ok) return null;
  const { lang } = meta;
  const zh = lang === 'zh';
  const T = (a: string, b: string) => (zh ? a : b);
  const K = r.pack.constants;
  const sys = prjSystem(r);
  const client = meta.client ?? '';
  const year = meta.date.slice(0, 4);
  const it = r.cfg.prj_interact;
  const lensName = (g: PrjGroupResult) => (zh ? g.lens.name : g.lens.nameEn);
  const faces = (g: PrjGroupResult) => {
    const fs = g.group.faces;
    if (g.floor) return T(`地面 ${fs.map((f) => `${f.w} × ${f.h}`).join(' + ')} mm`, `floor ${fs.map((f) => `${f.w} × ${f.h}`).join(' + ')} mm`);
    const turns = fs.slice(1).map((f) => `${f.turn}°`).join(' / ');
    return fs.length > 1
      ? T(`${fs.length} 面墙 ${fs.map((f) => f.w).join(' + ')} × ${mm(g.H)} mm（转角 ${turns}）`, `${fs.length} walls ${fs.map((f) => f.w).join(' + ')} × ${mm(g.H)} mm (turns ${turns})`)
      : T(`墙面 ${fs[0].w} × ${fs[0].h} mm`, `wall ${fs[0].w} × ${fs[0].h} mm`);
  };
  const env = ENV[r.cfg.prj_env][zh ? 0 : 1];
  const target = K.lux.value[r.cfg.prj_env];

  /* 一、方案概述 */
  const overview: string[] = [
    T(`本方案共 ${r.groups.length} 个融合组、${r.nProj} 台投影机。照度按公司算法（单机流明 ÷ 单台画面面积）计算，环境为「${env}」，目标 ${target} lx。`,
      `The design has ${r.groups.length} blend group${r.groups.length > 1 ? 's' : ''} and ${r.nProj} projector${r.nProj > 1 ? 's' : ''}. Illuminance follows the company rule (lumens ÷ one projector's image area); ambient light: ${env}, target ${target} lx.`),
    ...r.groups.map((g) => T(
      `${g.group.name}：${faces(g)}，${g.n} 台 ${g.projector.name}（${lensName(g)}），单台画面 ${mm(g.w)} × ${mm(g.h)} mm${g.n > 1 ? `，融合带 ${mm(g.blend)} mm` : ''}，照度 ${Math.round(g.lux)} lx；`
        + (g.floor ? `吊顶向下投，吊装高度 ${f2(g.lensH)} m。` : `投射距离 ${f2(g.d)} m，镜头离地 ${f2(g.lensH)} m。`),
      `${g.group.name}: ${faces(g)}, ${g.n} × ${g.projector.name} (${lensName(g)}), each image ${mm(g.w)} × ${mm(g.h)} mm${g.n > 1 ? `, ${mm(g.blend)} mm blend bands` : ''}, ${Math.round(g.lux)} lx; `
        + (g.floor ? `hung facing down at ${f2(g.lensH)} m.` : `throw ${f2(g.d)} m, lens ${f2(g.lensH)} m above the floor.`))),
    T(`投影机合计功耗 ${f2(r.kw)} kW，按单回路 ${K.circuitKw.value} kW 需 ${r.nCircuit} 路供电。`,
      `Projectors draw ${f2(r.kw)} kW in total; at ${K.circuitKw.value} kW per circuit, ${r.nCircuit} circuit${r.nCircuit > 1 ? 's are' : ' is'} required.`),
  ];
  if (it !== 'none') overview.push(T(`含${it === 'wall' ? '墙面' : '地面'}互动：雷达接交换机进 PC（CJ-Sync 交互）。`,
    `Includes ${it} interaction: radars connect through the switch to the PCs (CJ-Sync).`));

  /* 三、系统配置 */
  const sysRows: string[][] = [
    [T('投影机', 'Projectors'), String(sys.projectors), r.groups.map((g) => `${g.group.name} ${g.n} × ${g.projector.name}`).join(T('；', '; '))],
    [T('PC 主机', 'Media PC'), String(sys.pcs), T('每个融合组 1 台', 'One per blend group')],
  ];
  if (sys.blends) {
    sysRows.push([T('融合软件', 'Blending software'), String(sys.blends), T('2 台及以上的融合组各 1 套（几何校正 / 融合）', 'One per group of two or more projectors (warp / blend)')]);
    sysRows.push([T('多屏宝', 'Multi-output box'), String(sys.boxes), T(`每 ${K.boxPerSet.value} 台 1 套（待确认）`, `One per ${K.boxPerSet.value} projectors (to be confirmed)`)]);
  }
  sysRows.push([T('信号线', 'Signal cables'), String(sys.projectors), T('HDMI 光纤线，每台 1 条；超过 50 m 改光纤延长', 'HDMI fibre, one per projector; fibre extenders beyond 50 m')]);
  if (it !== 'none') sysRows.push([T('雷达', 'Radars'), sys.radars == null ? T('待定', 'TBC') : String(sys.radars),
    it === 'wall' ? T(`墙面互动，每 ${K.radarWall.value} m 墙宽 1 颗（待校准）`, `Wall interaction, one per ${K.radarWall.value} m of wall (to be calibrated)`)
      : T('地面互动，按覆盖面积配置（规则待定）', 'Floor interaction, sized by area (rule to be set)')]);
  sysRows.push([T('交换机', 'Network switch'), '1', T('网络、中控分配 IP', 'Network and control IP addressing')]);
  sysRows.push([T('中控系统', 'Control system'), '1', T('开关机 + 程序', 'Power on / off and programming')]);

  /* 四、计算依据(和 05、DXF 同一份) */
  const calc = prjCalcBasis(r, lang);

  /* 五、检查结果:红 / 黄,加上值得写给客户的提示;常数确认状态在封面和说明里写 */
  const items = r.findings
    .filter((f) => f.code !== 'PRJ-CAL-01' && f.code !== 'PRJ-SHAKE-01')
    .map((f) => ({ text: `[${f.code}] ${zh ? f.message : f.messageEn ?? f.message}`, severity: f.severity }));

  const sections: ProposalSection[] = [
    { heading: T('一、方案概述', '1. Overview'), paragraphs: overview },
    {
      heading: T('二、投影配置', '2. Projection Layout'),
      table: {
        header: zh ? ['融合组', '投影面', '投影机 / 镜头', '台数', '单台画面 (mm)', '融合带', '投射距离', '镜头离地']
          : ['Group', 'Faces', 'Projector / lens', 'Qty', 'Image each (mm)', 'Blend', 'Throw', 'Lens height'],
        rows: r.groups.map((g) => [
          g.group.name, faces(g), `${g.projector.name} / ${lensName(g)}`, String(g.n), `${mm(g.w)} × ${mm(g.h)}`,
          g.n > 1 ? `${mm(g.blend)} mm` : '—', g.floor ? '—' : `${f2(g.d)} m`,
          `${f2(g.lensH)} m${g.manual ? T('（人工调整）', ' (by hand)') : ''}`,
        ]),
      },
    },
    { heading: T('三、系统配置', '3. System Devices'), table: { header: zh ? ['设备', '数量', '说明'] : ['Device', 'Qty', 'Notes'], rows: sysRows } },
    {
      heading: T('四、计算依据', '4. Calculation Basis'),
      table: {
        header: [T('项目', 'Item'), ...calc.groups, T('公式 / 来源', 'Formula / source')],
        rows: calc.rows.map((x) => [x.item, ...x.cells.map((c) => c.text + (c.ok === true ? ' ✓' : c.warn ? ' !' : c.ok === false ? ' ✕' : '')), x.basis]),
      },
      notes: [calc.total],
    },
  ];
  if (items.length) sections.push({ heading: T('五、检查结果', '5. Checks'), items });
  sections.push({
    heading: T('六、常见坑提示', '6. Common Pitfalls'),
    notes: [
      T('融合缝：转角和弧面处最明显，安装后逐组复核几何校正与融合带。', 'Blend seams show most at corners and curves; recheck warping and blend bands group by group after installation.'),
      T('天花 / 建筑抖动会让融合错位：用防震吊架，安装后复核融合。', 'Ceiling or building vibration shifts the blend: use anti-vibration mounts and recheck after installation.'),
      T('天花太矮、镜头位移不够：现场核实天花净高和吊装下沉后再定机位。', 'Low ceilings and limited lens shift: verify the clear height and hanging drop on site before fixing positions.'),
      T('清晰度：观众离得近时单像素偏大会觉得不清晰（114 / MY016 验收问题）。', 'Sharpness: large pixels look soft to viewers standing close (handover issue on 114 / MY016).'),
      T('信号：HDMI 超过 50 m 改光纤延长。', 'Signal: switch to fibre extenders for HDMI runs beyond 50 m.'),
      ...(it !== 'none' ? [T('互动：预留雷达标定时间（MY014 验收问题「互动不灵敏」）；人站在画面前会挡光时考虑背投或超短焦。',
        'Interaction: allow time to calibrate the radars (MY014 found it unresponsive); where people block the light, consider rear projection or ultra-short throw.')] : []),
    ],
  });
  const manual = r.groups.filter((g) => g.manual);
  sections.push({
    heading: T('七、说明与限制', '7. Notes and Limitations'),
    notes: [
      T('本方案数值由规则引擎确定性计算，未使用生成式模型；每项结果都能在计算依据里找到公式和来源。',
        'All figures are calculated deterministically by the rule engine without generative models; every result traces to a formula and source in the calculation basis.'),
      T(`计算依据规则包 ${r.pack.version}。`, `Calculated with rule pack ${r.pack.version}.`),
      ...(r.pack.calibrated ? [] : [T('部分常数待校准：融合带占比、吊装下沉、目标照度等为完工样本反推的初值，待 PD 确认后发布正式规则包。',
        'Some constants not yet calibrated: blend share, hanging drop, target illuminance and others are initial values from finished projects, pending PD confirmation.')]),
      ...manual.map((g) => T(`${g.group.name} 的机位为人工调整（${g.manual}），已按镜头范围和位移复核。`,
        `The projector position in ${g.group.name} was adjusted by hand (${g.manual}) and checked against the lens range and shift.`)),
      T('机位、镜头与融合带需现场复核后方可施工；结构承重、既有管线、实际净高不在本方案判断范围内。',
        'Projector positions, lenses and blend bands must be verified on site before installation. Structural loading, existing services and actual clear height are outside the scope of this proposal.'),
      T('规范合规性（SCDF / BCA 等）须由工程师另行确认，系统不作判断。', 'Code compliance (SCDF / BCA etc.) must be confirmed separately by a qualified engineer; the system does not assess it.'),
    ],
  });

  const title = T('投影系统技术方案', 'Projection System Technical Proposal');
  return {
    lang, company: COMPANY, title, project: meta.title, client, date: meta.date,
    cover: [
      { label: T('项目', 'Project'), value: meta.title },
      ...(client ? [{ label: T('客户', 'Client'), value: client }] : []),
      { label: T('日期', 'Date'), value: meta.date },
      ...(r.pack.calibrated ? [] : [{ label: T('状态', 'Status'), value: T('部分常数待校准', 'Some constants not yet calibrated') }]),
    ],
    copyright: zh ? {
      heading: '版权声明',
      paragraphs: [
        `© ${year} ${COMPANY}。保留所有权利。`,
        `本方案书及其中的设计、数据与图纸为 ${COMPANY} 所有，仅供${client ? `${client}就` : ''}「${meta.title}」项目评估使用。未经 ${COMPANY} 书面许可，不得复制、转发或用于其他用途。`,
        `本方案书由 ${COMPANY} AV 方案成本平台依据规则包 ${r.pack.version} 生成，生成日期 ${meta.date}。`,
      ],
    } : {
      heading: 'Copyright',
      paragraphs: [
        `© ${year} ${COMPANY}. All rights reserved.`,
        `This proposal, including its designs, data and drawings, is the property of ${COMPANY} and is provided${client ? ` to ${client}` : ''} solely for evaluating the "${meta.title}" project. It may not be copied, forwarded or used for any other purpose without the written consent of ${COMPANY}.`,
        `Generated by the ${COMPANY} AV solution costing platform with rule pack ${r.pack.version} on ${meta.date}.`,
      ],
    },
    sections,
    footer: `${COMPANY} · ${title}`,
  };
}
