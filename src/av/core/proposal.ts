/* ===== LED technical proposal (技术方案书) · content =====
   The whole document — headings, paragraphs, tables, items to confirm and the
   copyright page — in Chinese or English, built from one computation (the same
   numbers as the drawing, cabinet list and costing). The Python side
   (services/drawing/avdrawing/proposal.py) only typesets it into Word with the
   letterhead and logo; the test bench previews the same content.
   Template ported from avcost-phase1 (2026-09-28), English added 2026-09-28. */

import { calcBasis } from './calc.ts';
import { KIND_LABEL, USE_LABEL, type CtrlAdvice } from './controller.ts';
import { manualLabel } from './override.ts';
import type { ComputeResult } from './compute.ts';
import type { CtrlBrand, ScreenType } from './types.ts';

export type ProposalLang = 'zh' | 'en';
export const COMPANY = 'AUDAX';

export interface ProposalSection {
  heading: string;
  paragraphs?: string[];
  table?: { header: string[]; rows: string[][] };
  notes?: string[];
  items?: { text: string; severity: 'block' | 'warn' | 'info' }[];
}

export interface ProposalDoc {
  lang: ProposalLang;
  company: string;
  title: string;
  project: string;
  client: string;
  date: string;                        // YYYY-MM-DD
  cover: { label: string; value: string }[];
  copyright: { heading: string; paragraphs: string[] };
  sections: ProposalSection[];
  footer: string;
}

const PROFILE_EN: Record<ScreenType, string> = { in_fixed: 'indoor fixed', out_fixed: 'outdoor fixed', rental: 'rental' };
const CTRL: Record<CtrlBrand, [string, string]> = { novastar: ['诺瓦', 'NovaStar'], colorlight: ['卡莱特', 'Colorlight'], other: ['其他', 'other'] };

const n = (x: number) => String(Number(x.toPrecision(10)));
const kw2 = (x: number) => x.toFixed(2);
const px = (x: number, lang: ProposalLang) => x.toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US');

export function proposalDoc(r: ComputeResult, meta: { title: string; client?: string; lang: ProposalLang; date: string; ctrl?: CtrlAdvice | null }): ProposalDoc | null {
  if (!r.layout || !r.wiring) return null;
  const { lang } = meta;
  const zh = lang === 'zh';
  const c = r.cfg;
  const w = r.wiring;
  const lay = r.layout;
  const v = (k: string) => r.trace[k].value;
  const profile = zh ? r.profile.label : PROFILE_EN[c.led_screen_type];
  const ctrl = CTRL[c.led_ctrl_brand][zh ? 0 : 1];
  const spareP = w.nPowerCable - w.nCircuit;
  const spareD = w.nDataCable - w.nDataRun;
  const codes = new Set(r.findings.map((f) => f.code));
  const client = meta.client ?? '';
  const year = meta.date.slice(0, 4);

  /* 一、方案概述 — pre-written paragraphs picked by the results */
  const overview = zh ? [
    `本方案针对 ${n(c.led_opening_w)} × ${n(c.led_opening_h)} mm 的显示区域，采用 P${n(c.led_pitch)} ${profile} LED 显示屏，`
      + `显示面积 ${n(v('sqm'))} ㎡，实际物理分辨率 ${v('px_w')} × ${v('px_h')} 像素。`,
    `屏体由 ${lay.cells.length} 只箱体拼装而成，共计 ${v('mods')} 块模组。`
      + (lay.custom ? '部分箱体为库外规格，需向厂家定制，交期与价格另行确认。' : '箱体规格全部取自公司标准箱体库，无需定制。'),
    `整屏最大功耗 ${kw2(v('kw'))} kW，按单回路 ${n(r.pack.company.circuitKw)} kW 配置，共需 ${w.nCircuit} 个供电回路，`
      + `另预留 ${spareP} 路备用，合计电源线 ${w.nPowerCable} 根。`,
    `控制系统采用${ctrl}，按单网口带载 ${px(r.pack.control.dataPx, lang)} 像素计算，需数据线 ${w.nDataRun} 条，`
      + `另预留 ${spareD} 条备用，合计 ${w.nDataCable} 根。`,
  ] : [
    `This proposal covers a display area of ${n(c.led_opening_w)} × ${n(c.led_opening_h)} mm using a P${n(c.led_pitch)} ${profile} LED display, `
      + `with a display area of ${n(v('sqm'))} m² and a native resolution of ${v('px_w')} × ${v('px_h')} pixels.`,
    `The screen is assembled from ${lay.cells.length} cabinets with ${v('mods')} modules in total. `
      + (lay.custom ? 'Some cabinet sizes are outside the standard library and must be custom-made; lead time and price to be confirmed.'
        : 'All cabinet sizes come from the company\'s standard cabinet library; no custom cabinets are required.'),
    `Maximum power consumption is ${kw2(v('kw'))} kW. At ${n(r.pack.company.circuitKw)} kW per circuit, ${w.nCircuit} power circuits are required, `
      + `plus ${spareP} spare, for a total of ${w.nPowerCable} power cables.`,
    `The control system is ${ctrl}. At ${px(r.pack.control.dataPx, lang)} pixels per network port, ${w.nDataRun} data runs are required, `
      + `plus ${spareD} spare, for a total of ${w.nDataCable} data cables.`,
  ];
  if (c.led_view_min) {
    overview.push(codes.has('LED-VD-01')
      ? (zh ? `最近观看距离 ${n(c.led_view_min)} m，小于 P${n(c.led_pitch)} 的推荐最小观看距离，近距离可能看到颗粒，建议复核点间距。`
        : `The nearest viewing distance of ${n(c.led_view_min)} m is below the recommended minimum for P${n(c.led_pitch)}; pixels may be visible at close range. Please review the pixel pitch.`)
      : (zh ? `最近观看距离 ${n(c.led_view_min)} m，与 P${n(c.led_pitch)} 的点间距配置相匹配。`
        : `The nearest viewing distance of ${n(c.led_view_min)} m suits the P${n(c.led_pitch)} pixel pitch.`));
  }
  if (codes.has('LED-PWR-07')) {
    overview.push(zh ? `强电井距屏体 ${n(c.led_pwr_dist!)} m，超过 30 m，建议在屏体附近加装分配电箱以降低压降。`
      : `The electrical riser is ${n(c.led_pwr_dist!)} m from the screen, beyond 30 m; a local distribution board near the screen is recommended to limit voltage drop.`);
  }

  /* items to confirm: the findings an exportable proposal can carry */
  const EN: Record<string, string> = {
    'LED-VD-01': `The nearest viewing distance of ${n(c.led_view_min ?? 0)} m is less than ${n(c.led_pitch)} m for P${n(c.led_pitch)}; pixels will be visible at close range.`,
    'LED-FIT-03': `Some cabinet sizes in the library are not whole multiples of the ${v('mod_w')} × ${v('mod_h')} module and were left out of the layout.`,
    'LED-CAB-01': 'The layout uses cabinet sizes outside the library; they must be custom-made or added to the library.',
    'LED-PWR-07': `The electrical riser is ${n(c.led_pwr_dist ?? 0)} m away, beyond 30 m; a local distribution board is recommended.`,
    'LED-PWR-08': `${w.nCircuit} circuits exceed the ${lay.widths.length} cabinet columns; some columns carry more than one circuit and the grouping diagram is indicative only.`,
    'LED-PWR-09': `Circuit(s) ${w.power.map((pc, k) => ({ k, pc })).filter(({ pc }) => pc.w > w.limitW + 1e-6).map(({ k, pc }) => `${k + 1} (${Math.round(pc.w)} W)`).join(', ')} exceed the ${n(r.pack.company.circuitKw)} kW circuit limit`
      + (w.algo === 'columns' ? `: ${r.pack.version} groups whole columns without checking each circuit; a newer rule pack reassigns cabinets circuit by circuit.` : '.'),
    'LED-PWR-10': `The current on one or more circuits exceeds the rating of the ${c.led_power_cable} power cable; upsize the cable or add circuits.`,
    'LED-PWR-11': 'One or more power chains exceed the cabinet power-cascade limit.',
    'LED-MAN-01': 'The inputs changed, so the manual wiring no longer fits and the automatic result is used.',
    'LED-MAN-02': 'The manual wiring breaks the rules (over-limit or unassigned cabinets).',
    'LED-DATA-01': `One or more data runs exceed ${px(r.pack.control.dataPx, lang)} pixels per port.`,
  };
  /* AV-019:「线径待填」「级联上限待填」是公司内部参数没填,不写进给客户的方案书(计算依据表里照样显示) */
  const items = r.findings.filter((f) => !(f.severity === 'info' && (f.code === 'LED-PWR-10' || f.code === 'LED-PWR-11'))).map((f) => ({ text: `[${f.code}] ${zh ? f.message : EN[f.code] ?? f.message}`, severity: f.severity }));

  const pcs = (k: number, zhUnit: string) => (zh ? `${k} ${zhUnit}` : `${k}`);
  const sections: ProposalSection[] = [
    { heading: zh ? '一、方案概述' : '1. Overview', paragraphs: overview },
    {
      heading: zh ? '二、屏体参数' : '2. Screen Parameters',
      table: {
        header: zh ? ['项目', '参数', '依据'] : ['Item', 'Specification', 'Basis'],
        rows: [
          [zh ? '屏体尺寸' : 'Screen size', `${n(c.led_opening_w)} × ${n(c.led_opening_h)} mm`, zh ? '图纸 / 人工确认' : 'Drawing / confirmed'],
          [zh ? '显示面积' : 'Display area', `${n(v('sqm'))} ${zh ? '㎡' : 'm²'}`, 'F1'],
          [zh ? '点间距' : 'Pixel pitch', `P${n(c.led_pitch)}`, zh ? '人工选择' : 'Selected'],
          [zh ? '物理分辨率' : 'Native resolution', `${v('px_w')} × ${v('px_h')}`, 'F4'],
          [zh ? '模组数量' : 'Modules', pcs(v('mods'), '块'), 'F2'],
          [zh ? '箱体数量' : 'Cabinets', pcs(lay.cells.length, '只'), 'F3'],
          [zh ? '最大功耗' : 'Max. power', `${kw2(v('kw'))} kW`, 'F5'],
        ],
      },
    },
    {
      heading: zh ? '三、箱体清单' : '3. Cabinet List',
      table: {
        header: zh ? ['规格 (mm)', '数量', '状态'] : ['Size (mm)', 'Quantity', 'Status'],
        rows: lay.bom.map((b) => [`${n(b.w)} × ${n(b.h)}`, pcs(b.count, '只'),
          b.inLib ? (zh ? '库内标准' : 'Standard (in library)') : (zh ? '库外，需定制' : 'Custom (outside library)')]),
      },
    },
    {
      heading: zh ? '四、供电与信号' : '4. Power and Signal',
      table: {
        header: zh ? ['项目', '配置', '依据'] : ['Item', 'Configuration', 'Basis'],
        rows: [
          [zh ? '供电回路' : 'Power circuits', pcs(w.nCircuit, '路'), 'F6'],
          [zh ? '回路分配' : 'Circuit loads', w.power.map((x) => `${Math.round(x.w)}W`).join(' / '),
            w.algo === 'chain'
              ? (zh ? `按箱体逐路分配，每路 ≤ ${n(r.pack.company.circuitKw)} kW` : `Cabinet by cabinet, each ≤ ${n(r.pack.company.circuitKw)} kW`)
              : (zh ? '按列均衡' : 'Balanced by column')],
          [zh ? '电源线（含备用）' : 'Power cables (incl. spare)', pcs(w.nPowerCable, '根'), 'F7'],
          [zh ? '数据线' : 'Data runs', pcs(w.nDataRun, '条'), 'F8'],
          [zh ? '数据线（含备用）' : 'Data cables (incl. spare)', pcs(w.nDataCable, '根'), 'F9'],
        ],
      },
    },
    ctrlSection(meta.ctrl ?? null, zh),
    {
      /* AV-019 §2.2:和 05 图下方、DXF 说明栏同一份计算依据 */
      heading: zh ? '六、计算依据' : '6. Calculation Basis',
      table: {
        header: zh ? ['项目', '计算', '结果', '来源'] : ['Item', 'Calculation', 'Result', 'Source'],
        rows: calcBasis(r, lang).map((x) => [x.item, x.formula, x.result, x.source]),
      },
    },
    {
      heading: zh ? '七、说明与限制' : '7. Notes and Limitations',
      notes: zh ? [
        '本方案数值由规则引擎确定性计算，未使用生成式模型，每项结果均可追溯至公式编号。',
        `计算依据规则包 ${r.pack.version}，参数组「${profile}」。`,
        ...(r.manual ? [`${[r.manual.power && '电源回路', r.manual.data && '网线'].filter(Boolean).join('、')}为人工调整（${manualLabel(r.manual)}），已逐路校核。`] : []),
        '箱体规格与回路分组需现场复核后方可施工。结构承重、既有管线、实际净高不在本方案判断范围内。',
        '规范合规性（SCDF / BCA 等）须由工程师另行确认，系统不作判断。',
      ] : [
        'All figures are calculated deterministically by the rule engine without generative models; every result traces back to a formula number.',
        `Calculated with rule pack ${r.pack.version}, parameter group "${profile}".`,
        ...(r.manual ? [`The ${[r.manual.power && 'power circuits', r.manual.data && 'data runs'].filter(Boolean).join(' and ')} were adjusted by hand (${manualLabel(r.manual)}) and checked one by one.`] : []),
        'Cabinet sizes and circuit grouping must be verified on site before installation. Structural loading, existing services and actual clear height are outside the scope of this proposal.',
        'Code compliance (SCDF / BCA etc.) must be confirmed separately by a qualified engineer; the system does not assess it.',
      ],
    },
  ];
  if (items.length) sections.push({ heading: zh ? '八、待确认事项' : '8. Items to Confirm', items });

  const title = zh ? 'LED 显示屏系统技术方案' : 'LED Display System Technical Proposal';
  return {
    lang, company: COMPANY, title, project: meta.title, client, date: meta.date,
    cover: [
      { label: zh ? '项目' : 'Project', value: meta.title },
      ...(client ? [{ label: zh ? '客户' : 'Client', value: client }] : []),
      { label: zh ? '日期' : 'Date', value: meta.date },
    ],
    copyright: zh ? {
      heading: '版权声明',
      paragraphs: [
        `© ${year} ${COMPANY}。保留所有权利。`,
        `本方案书及其中的设计、数据与图纸为 ${COMPANY} 所有，仅供${client ? `${client}就` : ''}「${meta.title}」项目评估使用。`
          + `未经 ${COMPANY} 书面许可，不得复制、转发或用于其他用途。`,
        `本方案书由 ${COMPANY} AV 方案成本平台依据规则包 ${r.pack.version} 生成，生成日期 ${meta.date}。`,
      ],
    } : {
      heading: 'Copyright',
      paragraphs: [
        `© ${year} ${COMPANY}. All rights reserved.`,
        `This proposal, including its designs, data and drawings, is the property of ${COMPANY} and is provided${client ? ` to ${client}` : ''} `
          + `solely for evaluating the "${meta.title}" project. It may not be copied, forwarded or used for any other purpose without the written consent of ${COMPANY}.`,
        `Generated by the ${COMPANY} AV solution costing platform with rule pack ${r.pack.version} on ${meta.date}.`,
      ],
    },
    sections,
    footer: `${COMPANY} · ${title}`,
  };
}

/* AV-019 §2.5 / §2.6「控制与信号源」:推荐型号和理由(F11,按设备库 + 01 的回答) */
function ctrlSection(a: CtrlAdvice | null, zh: boolean): ProposalSection {
  const heading = zh ? '五、控制与信号源' : '5. Control and Signal Source';
  if (!a) return { heading, paragraphs: [zh ? '设备库里还没有控制系统型号，控制器待定。' : 'The device library has no control-system models yet; the controller is to be confirmed.'] };
  const L = (x: { zh: string; en: string }) => (zh ? x.zh : x.en);
  const dev = (d: { model: string; kind: keyof typeof KIND_LABEL }) => (zh ? `${d.model}（${KIND_LABEL[d.kind][0]}）` : `${d.model} (${KIND_LABEL[d.kind][1]})`);
  const rows: string[][] = [
    [zh ? '播放内容' : 'Content', `${USE_LABEL[a.use][zh ? 0 : 1]}${a.pending ? (zh ? '（待确认）' : ' (to be confirmed)') : ''}`],
    [zh ? '信号源' : 'Signal source', L(a.signal)],
    [zh ? '控制器 / 播放盒' : 'Controller / player', a.primary ? `${dev(a.primary.device)}${a.manual ? (zh ? ' · 人工选择' : ' · chosen by hand') : ''}` : L(a.fail!)],
  ];
  if (a.primary) rows.push([zh ? '满足条件' : 'Checks', a.primary.checks.map((c) => `${c.ok ? '✓' : '✕'} ${L(c)}`).join(zh ? '；' : '; ')]);
  if (a.needMedia) rows.push([zh ? '媒体播放器' : 'Media player', zh ? '1 台（HDMI 输出，接控制器）' : '1 (HDMI out into the controller)']);
  if (a.needPc) rows.push([zh ? '播控电脑' : 'Playback PC', zh ? '1 台（我们报）' : '1 (quoted by us)']);
  if (a.alternates.length) rows.push([zh ? '备选' : 'Alternatives', a.alternates.map((x) => x.device.model).join(' / ')]);
  return {
    heading,
    paragraphs: a.reason.map(L),
    table: { header: zh ? ['项目', '建议'] : ['Item', 'Recommendation'], rows },
  };
}

