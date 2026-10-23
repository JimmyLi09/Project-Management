'use client';

import React, { useEffect, useState } from 'react';
import { useStore } from '../store';
import { isFull } from '@/lib/permissions';
import { fmtDate, parseISO, pkgStart, planDates, projCode, projStage, todayMid } from '@/lib/project';
import { useLang } from '@/lib/i18n';
import { STAGES, stageIdx, SVC, svcColor } from '@/lib/templates';
import type { ChecklistItem, Project, ServicePackage } from '@/lib/types';
import { cellLabel, pkgLabel, type ClFields } from '@/lib/clCells';
import { clGroupHidden } from '@/lib/interior';
import type { XBook, XCover, XHead, XRow, XSection, XSheet, XStyle, XTable } from '@/lib/exportXlsx';
import {
  dayMon, edgeOf, ganttLine, ganttPos, ganttWeeks, GANTT_STATUS, holidayOf, inMonth, keyDates, monthTitle, monthWeeks, monthsOf,
  spanLabel, spanOf, stagesInMonth, toneOf, weekSegments, ymd, type ExpStage,
} from '@/lib/schedExport';

/* REQ-016: built-in fallback when no global note has been saved yet.
   0917 收尾:导出是发给客户的,一份文件不该中英各来一段 —— 拆成两份,
   按导出时的语言出对应那一份,各自可编辑、各自存全局默认。 */
const DEFAULT_NOTES_ZH = '注:资料不齐可能影响交付时间;确认后如需多次修改,可能酌收修改费。';
const DEFAULT_NOTES_EN = 'Note: incomplete information may affect the delivery schedule; repeated revisions after confirmation may incur additional charges.';
/* 周数合计:每行是一位小数(1 天 = 0.1 周),加起来会出 4.300000000000001 */
const round1 = (n: number) => Math.round(n * 10) / 10;

/* 拆之前那一版是中英拼在一起的一整段。库里存的如果**一字不差**就是这一段,
   说明没人改过,可以放心拆开;改过的就是人家自己写的东西,不拆 —— 见下面
   resolveNotes 的注释。 */
const LEGACY_DEFAULT_NOTES = '注 Note:资料不齐可能影响交付时间;确认后如需多次修改,可能酌收修改费。\nIncomplete information may affect the delivery schedule; repeated revisions after confirmation may incur additional charges.';

/* 把库里存的(可能只有老的那一个键)解析成中英两份。
   规矩是「不猜、不抹」:
   · 老键存的正好是出厂那段 → 是我们自己的字符串,拆成两份出厂文案;
   · 老键存的是别的 → 那是 PD 自己写的免责声明,**原样**当中文那份用,
     英文那份在有人专门存过之前也跟着它 —— 也就是维持今天的行为,
     不拿一段出厂英文去顶掉人家写好的东西;
   · 两个键都没有 → 出厂两份。 */
function resolveNotes(zhRaw: string | null, enRaw: string | null): { zh: string; en: string } {
  const factory = !zhRaw || zhRaw === LEGACY_DEFAULT_NOTES;
  const zh = factory ? DEFAULT_NOTES_ZH : zhRaw;
  const en = enRaw || (factory ? DEFAULT_NOTES_EN : zhRaw);
  return { zh, en };
}

type Cols = { owner: boolean; start: boolean; due: boolean; status: boolean; clOwner: boolean; clStatus: boolean; clDate: boolean; clRemark: boolean; clSvcs: boolean };
export type ExportScope = 'all' | 'schedule' | 'checklist';
type Order = 'byPkg' | 'schedFirst' | 'clFirst';
/* REQ-018 的三种表格样式 + REQ-056 的月历 / 甘特(只用于预览和 PDF) */
type SchedLayout = 'classic' | 'weeks' | 'dates' | 'calendar' | 'gantt';

/* ===== REQ-015 / REQ-017: flexible, print-solid export =====
   - content multi-select: services + (schedule / checklist / both)
   - three ordering presets: interleaved by service / all schedules first /
     all checklists first — one unified table template throughout
   - print: A4 portrait|landscape, real margins, page numbers & header/footer
     via @page margin boxes, repeating table heads, no mid-row page breaks */
/* clScope(REQ-044):从信息清单的某个服务标签点「导出清单」时带进来 —— 默认只勾这个服务 */
export default function ExportOverlay({ p, onClose, scope = 'all', clScope = 'all' }: { p: Project; onClose: () => void; scope?: ExportScope; clScope?: string }) {
  const { lang: appLang } = useLang();
  const { me, setToast } = useStore();
  const [lang, setLang] = useState<'en' | 'zh'>(appLang);
  /* REQ-055:清单的「负责人」也有开关了 —— 默认和以前一样:有分类就出,无分类(REQ-014)不出 */
  const [cols, setCols] = useState<Cols>({ owner: true, start: true, due: true, status: true, clOwner: !p.noCategories, clStatus: true, clDate: true, clRemark: true, clSvcs: true });
  const [sec, setSec] = useState<ExportScope>(scope);
  const [order, setOrder] = useState<Order>('byPkg');
  const [orient, setOrient] = useState<'portrait' | 'landscape'>('portrait');
  /* REQ-048:排期页不再选「样式」,导出时在这里选(默认沿用项目上次用的那种) */
  const [schedStyle, setSchedStyle] = useState<SchedLayout>(p.schedStyle || 'classic');
  /* REQ-056:月历的三个显示开关,默认都勾 */
  const [calHol, setCalHol] = useState(true);
  const [calKey, setCalKey] = useState(true);
  const [calList, setCalList] = useState(true);
  const [pkgSel, setPkgSel] = useState<boolean[]>(() => p.packages.map((pk) => clScope === 'all' || pk.svc === clScope));
  const [blanks, setBlanks] = useState(true); // REQ-013: include blank (Pending) items — default on
  /* REQ-021 封面页。0917 变更单:「Checklist 导出第一页空白太多」——
     量过正文本身已经很紧凑(标题在最顶、表格 103px 处就开始),空白来自
     默认开着的封面:封面独占一页,对外发的信息清单上那一页确实是白费。
     所以**清单导出默认不带封面**,排期 / 全量导出保持原样默认开;
     需要封面随时勾回来。 */
  const [cover, setCover] = useState(scope !== 'checklist');
  /* REQ-016: company notes — global default, per-export toggle + tweak */
  const [notesOn, setNotesOn] = useState(true);
  const [notesZh, setNotesZh] = useState(DEFAULT_NOTES_ZH);
  const [notesEn, setNotesEn] = useState(DEFAULT_NOTES_EN);
  /* 英文那份有没有被人单独存过 —— 没有的话编辑区提示一句,免得 PD 以为
     改了中文英文就跟着变了。 */
  const [enOwn, setEnOwn] = useState(true);
  const [notesEdit, setNotesEdit] = useState(false);
  const [xBusy, setXBusy] = useState(false); // REQ-055:Excel 生成中(第一次要先加载 exceljs)
  useEffect(() => {
    const get = (k: string) => fetch(`/api/settings?key=${k}`)
      .then((r) => (r.ok ? r.json() : null)).then((d) => (d && d.value) || null).catch(() => null);
    Promise.all([get('exportNotes'), get('exportNotesEn')]).then(([zhRaw, enRaw]) => {
      const r = resolveNotes(zhRaw, enRaw);
      setNotesZh(r.zh); setNotesEn(r.en); setEnOwn(!!enRaw);
    });
  }, []);
  async function saveDefaultNotes() {
    /* 存的是**当前导出语言**那一份 —— 中文模式存中文那段,英文模式存英文那段 */
    const key = L === 'zh' ? 'exportNotes' : 'exportNotesEn';
    const r = await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value: L === 'zh' ? notesZh : notesEn }) });
    if (r.ok && L === 'en') setEnOwn(true);
    setToast(r.ok
      ? T('已保存为全局默认说明(中文版)', 'Saved as the global default note (English)')
      : T('保存失败(仅 PD/BD 可存默认)', 'Could not save — only PD / BD can set the default'));
  }

  const L = lang;
  const T = (zh: string, en: string) => (L === 'zh' ? zh : en);
  /* 导出文档与编辑区用的都是「当前导出语言」那一份 */
  const notes = L === 'zh' ? notesZh : notesEn;
  const setNotes = L === 'zh' ? setNotesZh : setNotesEn;
  const showSched = sec !== 'checklist';
  /* REQ-056:月历 / 甘特固定 A4 横向;Excel 里的排期照旧是表格(阶段表) */
  const fixedLand = showSched && (schedStyle === 'calendar' || schedStyle === 'gantt');
  const effOrient = fixedLand ? 'landscape' : orient;
  const tableStyle: 'classic' | 'weeks' | 'dates' = schedStyle === 'calendar' || schedStyle === 'gantt' ? 'classic' : schedStyle;
  const showCl = sec !== 'schedule';
  const scopeLabel = sec === 'schedule' ? T('生产排期', 'Schedule') : sec === 'checklist' ? T('信息清单', 'Checklist') : '';
  const svcNames = p.services.map((k) => (SVC[k] ? (L === 'zh' ? SVC[k].label : SVC[k].en) : k)).join(', ');
  const selPkgs = p.packages.map((pkg, pi) => ({ pkg, pi })).filter((x) => pkgSel[x.pi]);
  const multi = p.packages.length > 1;

  const colToggle = (c: keyof Cols, zh: string, en: string) => (
    <label className="ex-col" key={c}>
      <input type="checkbox" checked={cols[c]} onChange={() => setCols({ ...cols, [c]: !cols[c] })} data-testid={`ex-col-${c}`} /> {T(zh, en)}
    </label>
  );
  const svcName = (pkg: ServicePackage) => (SVC[pkg.svc] ? (L === 'zh' ? SVC[pkg.svc].label : SVC[pkg.svc].en) : pkg.svc);

  /* REQ-017: page header/footer + page numbers via @page margin boxes
     (Chromium 131+; older browsers just ignore). Orientation switch included. */
  const headerTxt = `${projCode(p) ? projCode(p) + ' · ' : ''}${p.name}`.replace(/"/g, '\\"');
  const pageCss = `
@page {
  size: A4 ${effOrient};
  margin: 16mm 12mm 18mm;
  @top-left { content: "${headerTxt}"; font-size: 9px; color: #999; }
  @bottom-left { content: "Audax Visuals"; font-size: 9px; color: #999; }
  @bottom-right { content: counter(page) " / " counter(pages); font-size: 9px; color: #999; }
}`;

  /* REQ-055:预览 / PDF 和 Excel 共用同一份表 —— 下面的 schedTable / clTable 出数据,
     预览按它画 <table>,Excel(lib/exportXlsx)按它画工作表,两边不再各拼各的 */
  const cssOf = (st?: XStyle): React.CSSProperties | undefined => (st ? {
    textAlign: st.align, fontWeight: st.bold ? 700 : undefined, color: st.color, background: st.fill,
    letterSpacing: st.spacing ? '.06em' : undefined, whiteSpace: st.pre ? 'pre-wrap' : undefined,
  } : undefined);
  const headRow = (heads: XHead[]) => (
    <tr>{heads.map((h, i) => <th key={i} style={h.w ? { width: h.w } : undefined}>{h.v}</th>)}</tr>
  );
  /* 打印时表格是 table-layout: fixed,列宽只看第一行 —— 清单每组第一行是合并的分组标题,
     表头上的宽度就不算了,PDF 里几栏一样宽。用 <colgroup> 把宽度直接给到列上,PDF 和预览一样。 */
  const colGroup = (heads: XHead[]) => (
    <colgroup>{heads.map((h, i) => <col key={i} style={h.w ? { width: h.w } : undefined} />)}</colgroup>
  );
  const bodyRow = (row: XRow, testid?: string) => (row.sec
    /* REQ-058:组内小标题行 */
    ? <tr key={row.key} className="ex-sec" data-testid="ex-cl-sec"><td colSpan={row.cells[0]?.span}>{row.cells[0]?.v}</td></tr>
    : (
      <tr key={row.key} data-testid={testid}>
        {row.cells.map((c, i) => <td key={i} colSpan={c.span} style={cssOf(c.st)}>{c.v}{c.sub && <div className="ex-sub">{c.sub}</div>}</td>)}
      </tr>
    ));

  /* ── unified schedule block (per package) — follows the project's REQ-018 template ── */
  function schedTable(pkg: ServicePackage): { heading: string; color: string; table: XTable; scope: XTable | null } {
    const pd = planDates(pkg, pkgStart(p, pkg));
    const style = tableStyle;   // REQ-056:月历 / 甘特只用于预览和 PDF,Excel 里排期仍是表格(阶段表)
    const sub = round1(pkg.schedule.filter((r) => !r.kind).reduce((n, r) => n + (Number(r.weeks) || 0), 0));
    const band = (r: { phase: string; task: string; taskEn: string }) => {
      const s = `${r.phase} ${r.task} ${r.taskEn}`.toLowerCase();
      if (/交接|移交|签收|handover|sign-?off/.test(s)) return 2;
      if (/交付|deliver|出图|提交|final|高清/.test(s)) return 1;
      return 0;
    };
    const BAND_L: [string, string][] = [['制作 Production', 'Production'], ['交付 Delivery', 'Delivery'], ['交接 Handover', 'Handover']];
    const task = (r: { task: string; taskEn: string }) => (L === 'zh' ? r.task : r.taskEn || r.task);
    const key = (r: { id?: string }, i: number) => r.id || String(i);
    let table: XTable;
    if (style === 'dates') {
      /* REQ-018 style B: date-based (Scale Model) */
      let lastBand = -1;
      table = {
        heads: [
          { v: T('日期区间 Date Range', 'Date Range'), w: '26%', xw: 26 },
          { v: T('任务 Task', 'Task'), xw: 34 },
          { v: T('时长', 'Duration'), w: '11%', xw: 12 },
          { v: T('阶段', 'Stage'), w: '17%', xw: 18 },
        ],
        rows: pkg.schedule.map((r, i): XRow => {
          if (r.kind === 'holiday') return { key: key(r, i), cells: [{ v: task(r).toUpperCase(), span: 4, st: { align: 'center', color: '#b23a32', bold: true, fill: '#fdecec', spacing: true } }] };
          if (r.kind === 'milestone') return { key: key(r, i), cells: [{ v: `⚑ ${task(r)}${r.s ? ` · ${r.s}` : ''}`, span: 4, st: { color: '#b23a32', bold: true, fill: '#fff5f5' } }] };
          const d = pd[i];
          const b = band(r); const showBand = b !== lastBand; lastBand = b;
          return { key: key(r, i), cells: [
            { v: d ? `${fmtDate(d.start)} – ${fmtDate(d.end)}` : '—' },
            { v: `${task(r)}${r.freeze ? ' ★' : ''}` },
            { v: r.weeks ? T(`${r.weeks} 周`, `${r.weeks}w`) : '—' },
            { v: showBand ? `${b + 1}. ${L === 'zh' ? BAND_L[b][0] : BAND_L[b][1]}` : '' },
          ] };
        }),
      };
    } else if (style === 'weeks') {
      /* REQ-018 style A: per-service weeks table + subtotal
         0917 变更单:导出的生产排期表去掉最左 # 序号列 —— 顺序仍按排期先后,只是不再显示这个系统序号。 */
      table = {
        heads: [
          { v: T('阶段 / 任务', 'Phase / Task'), xw: 34 },
          { v: T('日期', 'Dates'), w: '26%', xw: 26 },
          { v: T('时长', 'Duration'), w: '13%', xw: 14 },
        ],
        rows: [
          ...pkg.schedule.flatMap((r, i): XRow[] => {
            if (r.kind) return [];
            const d = pd[i];
            return [{ key: key(r, i), cells: [
              { v: `${task(r)}${r.freeze ? ' ★' : ''}` },
              { v: d ? `${fmtDate(d.start)} – ${fmtDate(d.end)}` : '—' },
              { v: r.weeks ? T(`${r.weeks} 周`, `${r.weeks} week${r.weeks > 1 ? 's' : ''}`) : '—' },
            ] }];
          }),
          /* 去掉 # 列后本表 3 列,小计跨前 2 列 */
          { key: 'sub', cells: [
            { v: T('小计 Subtotal', 'Subtotal'), span: 2, st: { align: 'right', bold: true } },
            { v: T(`${sub} 周`, `${sub} weeks`), st: { bold: true } },
          ] },
        ],
      };
    } else {
      /* 0917 变更单:同上,去掉 # 序号列;其余栏位跟导出时勾的排期栏位走 */
      const stt = (s: string) => ({
        todo: T('未开始', 'Not started'), wip: T('进行中', 'In progress'),
        done: T('已完成', 'Done'), block: T('受阻', 'Blocked'),
      } as Record<string, string>)[s] || '';
      table = {
        heads: [
          { v: T('阶段/任务', 'Phase / Task'), xw: 34 },
          ...(cols.owner ? [{ v: T('负责', 'Owner'), w: '14%', xw: 16 }] : []),
          ...(cols.start ? [{ v: T('开始', 'Start'), w: '11%', xw: 14 }] : []),
          ...(cols.due ? [{ v: T('到期', 'Due'), w: '11%', xw: 14 }] : []),
          ...(cols.status ? [{ v: T('状态', 'Status'), w: '10%', xw: 14 }] : []),
        ],
        rows: pkg.schedule.map((r, i): XRow => {
          const d = pd[i];
          return { key: key(r, i), cells: [
            { v: `${task(r)}${r.freeze ? ' ★' : ''}${r.custom ? ` (${T('自定义', 'custom')})` : ''}` },
            ...(cols.owner ? [{ v: r.assignee || r.owner || '' }] : []),
            ...(cols.start ? [{ v: d ? fmtDate(d.start) : '—' }] : []),
            ...(cols.due ? [{ v: d ? fmtDate(d.end) : '—' }] : []),
            ...(cols.status ? [{ v: stt(r.status) }] : []),
          ] };
        }),
      };
    }
    const scope: XTable | null = pkg.scopeItems && pkg.scopeItems.length > 0 ? {
      heads: [
        { v: T('服务项', 'Service item'), w: '34%', xw: 34 },
        { v: T('数量', 'Detail'), w: '16%', xw: 16 },
        { v: T('特别说明', 'Special notes'), xw: 30 },
      ],
      rows: pkg.scopeItems.map((s, si) => ({ key: String(si), cells: [{ v: s.item || '—' }, { v: s.qty || '—' }, { v: s.note || '—' }] })),
    } : null;
    return { heading: `${svcName(pkg)} — ${T('生产排期', 'Production Schedule')}`, color: svcColor(pkg.svc), table, scope };
  }
  const scopeTitle = T('服务内容 / 交付清单', 'Service Scope / Deliverables');
  function SchedBlock({ pkg }: { pkg: ServicePackage }) {
    const { heading, color, table, scope } = schedTable(pkg);
    return (
      <React.Fragment>
        <h2 style={{ color }}>{heading}</h2>
        <table className="t-fix">
          <thead>{headRow(table.heads)}</thead>
          <tbody>{table.rows.map((r) => bodyRow(r))}</tbody>
        </table>
        {scope && (
          <>
            <h3 style={{ fontSize: 12.5, margin: '12px 0 6px' }}>{scopeTitle}</h3>
            <table className="t-fix">
              <thead>{headRow(scope.heads)}</thead>
              <tbody>{scope.rows.map((r) => bodyRow(r))}</tbody>
            </table>
          </>
        )}
      </React.Fragment>
    );
  }

  /* ===== REQ-056:月历 / 甘特(只用于预览和 PDF;固定 A4 横向) =====
     阶段 = 排期里不是假日 / 节点的那些行,日期和其他样式一样来自 planDates(pkg.schedule + 日历边界) */
  const STT: Record<string, string> = { todo: T('未开始', 'Not started'), wip: T('进行中', 'In progress'), done: T('已完成', 'Done'), block: T('受阻', 'Blocked') };
  function stagesOf(pkg: ServicePackage): ExpStage[] {
    const pd = planDates(pkg, pkgStart(p, pkg));
    let n = 0;
    return pkg.schedule.flatMap((r, i) => (r.kind ? [] : [{
      no: ++n, name: L === 'zh' ? r.task : r.taskEn || r.task, star: !!r.freeze,
      start: pd[i] ? ymd(pd[i]!.start) : null, end: pd[i] ? ymd(pd[i]!.end) : null, status: r.status,
    }]));
  }
  const nn = (n: number) => String(n).padStart(2, '0');
  const WD = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
  const WD_ZH = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  function CalendarBlock({ pkg, first }: { pkg: ServicePackage; first: boolean }) {
    const stages = stagesOf(pkg);
    const sp = spanOf(stages);
    const key = keyDates(stages);
    const heading = <h2 style={{ color: svcColor(pkg.svc) }}>{svcName(pkg)} — {T('生产排期', 'Production Schedule')}</h2>;
    if (!sp) return <>{heading}<p style={{ color: '#888', fontSize: 12 }}>{T('这一项业务的排期还没有日期。', 'This service has no scheduled dates yet.')}</p></>;
    const finalTxt = `Final: ${spanLabel(sp.start, sp.end)} · ${T(`${sp.weeks} 周`, `${sp.weeks} weeks`)}`;
    const months = monthsOf(stages);
    const undated = stages.filter((x) => !x.start || !x.end);
    return (
      <React.Fragment>
        {months.map(({ year, month }, mi) => {
          const weeks = monthWeeks(year, month);
          const inMo = (d: string) => inMonth(d as never, year, month);
          /* 没有日期的阶段不画色条,放在最后一页的列表里,日期写「—」 */
          const list = [...stagesInMonth(stages, year, month), ...(mi === months.length - 1 ? undated : [])].sort((a, b) => a.no - b.no);
          return (
            <section key={`${year}-${month}`} className={`exc-month${mi > 0 || !first ? ' exc-page' : ''}`} data-testid="ex-cal-month">
              {(mi > 0 || !first) && <div className="exc-cont">{titleOf(T('生产排期', 'Schedule'))}{T('(续)', ' (cont.)')}</div>}
              {mi === 0 && heading}
              <div className="exc-mhead"><b data-testid="ex-cal-title">{monthTitle(year, month, L === 'zh')}</b><span>{finalTxt}</span></div>
              <div className="exc-grid">
                <div className="exc-wd">{(L === 'zh' ? WD_ZH : WD).map((w, i) => <span key={w} className={i > 4 ? 'we' : ''}>{w}</span>)}</div>
                {weeks.map((week) => {
                  const clip = week.filter(inMo);
                  const segs = clip.length ? weekSegments(week, stages, [clip[0], clip[clip.length - 1]]) : [];
                  const lanes = segs.reduce((n, x) => Math.max(n, x.lane + 1), 0);
                  return (
                    <div key={week[0]} className="exc-week" style={{ height: 52 + Math.max(0, lanes - 1) * 15 }}>
                      {week.map((d, ci) => {
                        const out = !inMo(d);
                        const hol = !out && calHol ? holidayOf(d) : null;
                        const isEnd = !out && calKey && key.end === d;
                        const isKey = !out && calKey && (key.starts.has(d) || isEnd);
                        return (
                          <div key={d} className={`exc-day${ci > 4 ? ' we' : ''}${out ? ' out' : ''}${hol ? ' hol' : ''}`} data-date={d}>
                            <span className="n">{Number(d.slice(8))}</span>
                            {hol && <span className="hn" data-testid="ex-cal-holiday">{hol}</span>}
                            {isKey && <i className="kd" data-testid="ex-cal-key" />}
                            {isEnd && <span className="endl" data-testid="ex-cal-end">END · Delivery</span>}
                          </div>
                        );
                      })}
                      {segs.map((g) => (
                        <div key={`${g.stage.no}-${g.from}`} className="exc-bar" data-testid="ex-cal-bar" data-stage={g.stage.no}
                          style={{ left: `${(g.from / 7) * 100}%`, width: `${((g.to - g.from + 1) / 7) * 100}%`, top: 30 + g.lane * 15,
                            background: toneOf(g.stage.no), borderLeft: g.isStart ? `3px solid ${edgeOf(g.stage.no)}` : undefined }}>
                          {nn(g.stage.no)} · {g.stage.name}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
              {calList && list.length > 0 && (
                <table className="exc-list" data-testid="ex-cal-list">
                  <thead><tr><th colSpan={3}>{T('本月阶段', 'Stages this month')}</th></tr></thead>
                  <tbody>
                    {list.map((x) => (
                      <tr key={x.no}>
                        <td style={{ width: '55%' }}><i className="sw" style={{ background: toneOf(x.no), borderColor: edgeOf(x.no) }} />{nn(x.no)} · {x.name}{x.star ? ' ★' : ''}</td>
                        <td>{x.start && x.end ? `${fmtDate(parseISO(x.start))} → ${fmtDate(parseISO(x.end))}` : '—'}</td>
                        <td style={{ width: '14%' }}>{STT[x.status] || ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          );
        })}
      </React.Fragment>
    );
  }
  function GanttBlock({ pkg }: { pkg: ServicePackage }) {
    const stages = stagesOf(pkg);
    const sp = spanOf(stages);
    const heading = <h2 style={{ color: svcColor(pkg.svc) }}>{svcName(pkg)} — {T('生产排期', 'Production Schedule')}</h2>;
    if (!sp) return <>{heading}<p style={{ color: '#888', fontSize: 12 }}>{T('这一项业务的排期还没有日期。', 'This service has no scheduled dates yet.')}</p></>;
    const weeks = ganttWeeks(stages);
    const d0 = weeks[0], n = weeks.length;
    const grid = { backgroundImage: 'linear-gradient(to right, transparent calc(100% - 1px), #e3e3e3 calc(100% - 1px))', backgroundSize: `${100 / n}% 100%` };
    const used = [...new Set(stages.map((x) => x.status))];
    return (
      <React.Fragment>
        {heading}
        <table className="t-fix exg" data-testid="ex-gantt">
          <colgroup><col style={{ width: '27%' }} /><col style={{ width: '11%' }} />{weeks.map((w) => <col key={w} />)}</colgroup>
          <thead>
            <tr>
              <th>{T('阶段 / 任务', 'Phase / Task')}</th>
              <th style={{ textAlign: 'center' }}>{T('日期', 'Dates')}</th>
              {weeks.map((w) => <th key={w} className="exg-wk" data-testid="ex-gantt-week">{dayMon(w)}</th>)}
            </tr>
          </thead>
          <tbody>
            {stages.map((x) => {
              const pos = x.start && x.end ? ganttPos(d0, n, x.start, x.end) : null;
              return (
                <tr key={x.no} data-testid="ex-gantt-row">
                  <td>{nn(x.no)} · {x.name}{x.star ? ' ★' : ''}</td>
                  <td style={{ textAlign: 'center', fontSize: 11 }}>{x.start && x.end ? `${dayMon(x.start)} – ${dayMon(x.end)}` : '—'}</td>
                  <td colSpan={n} className="exg-tl" style={grid}>
                    {pos && <i className="exg-bar" data-testid="ex-gantt-bar" data-status={x.status} style={{ left: `${pos.left}%`, width: `${pos.width}%`, background: GANTT_STATUS[x.status] || GANTT_STATUS.todo }} />}
                  </td>
                </tr>
              );
            })}
            <tr className="exg-del">
              <td style={{ color: '#b23a32', fontWeight: 700 }}>{T('交付 Delivery', 'Delivery')}</td>
              <td style={{ textAlign: 'center', fontSize: 11, color: '#b23a32' }}>{dayMon(sp.end)}</td>
              <td colSpan={n} className="exg-tl" style={grid}><i className="exg-line" data-testid="ex-gantt-delivery" style={{ left: `${ganttLine(d0, n, sp.end)}%` }} /></td>
            </tr>
          </tbody>
        </table>
        <div className="exg-legend">
          {(['wip', 'todo', 'done', 'block'] as const).filter((k) => k !== 'block' || used.includes('block')).map((k) => (
            <span key={k}><i style={{ background: GANTT_STATUS[k] }} />{STT[k]}</span>
          ))}
          <span>· {T('每格一周,周一开始', 'one column per week, starting Monday')}</span>
        </div>
      </React.Fragment>
    );
  }

  /* ── unified checklist block — REQ-019 template columns ──
     REQ-044: 清单是项目一张,导出也是一张:勾了哪些服务就出适用这些服务的项
     (共用项只出一次),多一列「适用服务」。
     REQ-050: 同步项导一次,「适用业务」写全部业务;单独填的项和规格项只导所勾业务 / 实例的那几格。 */
  const clStat: Record<string, string> = {
    pending: T('未收到', 'Pending'), received: T('已收到', 'Received'), confirmed: T('已确认', 'Confirmed'),
    na: 'N/A', revision: T('需修订', 'Revision'), rejected: T('退回', 'Rejected'),
  };
  const svcLabel = (k: string) => (SVC[k] ? (L === 'zh' ? SVC[k].label : SVC[k].en) : k);
  const selSvcs = [...new Set(selPkgs.map((x) => x.pkg.svc))];
  const selIds = new Set(selPkgs.map((x) => x.pkg.id).filter(Boolean) as string[]);
  const allSvcs = [...new Set(p.packages.map((x) => x.svc))];
  type ClRow = { key: string; name: string; svcs: string; owner: string; status: string; pending: boolean; received: string; date: string; remark: string; sub: string; sec: string };
  function clRows(): { g: { group: string; groupEn: string }; rows: ClRow[] }[] {
    /* REQ-013: blank items are exported too (kept Pending) unless the user
       unticks 「含空白项」. N/A rows are always dropped. */
    const keepC = (c: ClFields) => c.status !== 'na' && (blanks || !!(c.date || c.remark || c.received) || c.status !== 'pending');
    const name = (it: ChecklistItem) => (L === 'zh' ? it.zh : it.en || it.zh);
    /* REQ-058:分项、组内小标题按导出语言取(英文没写用中文) */
    const subOf = (it: ChecklistItem) => (L === 'zh' ? it.sub : it.subEn || it.sub) || '';
    const secOf = (it: ChecklistItem) => (L === 'zh' ? it.sec : it.secEn || it.sec) || '';
    const rowOf = (it: ChecklistItem, c: ClFields, key: string, nm: string, svcs: string): ClRow => ({
      key, name: nm, svcs, owner: c.owner || '', status: clStat[c.status] || c.status, pending: c.status === 'pending', received: c.received || '', date: c.date || '', remark: c.remark || '',
      sub: subOf(it), sec: secOf(it),
    });
    const one = (it: ChecklistItem): ClRow[] => {
      if (!(it.svcs || allSvcs).some((sv) => selSvcs.includes(sv))) return [];
      /* 迁移时没对上服务包、留下来的「(#2)」/「(实例名)」项:属于哪一份认得出来的,那一份没勾就不导 */
      if (it.inst && (it.svcs || []).length === 1) {
        const same = p.packages.filter((x) => x.svc === it.svcs![0]);
        const m = /^#(\d+)$/.exec(it.inst);
        const pk = m ? same[Number(m[1]) - 1] : same.find((x) => x.label === it.inst);
        if (pk?.id && !selIds.has(pk.id)) return [];
      }
      if (!it.cells) return keepC(it) ? [rowOf(it, it, it.id || '', name(it), (it.svcs || allSvcs).map(svcLabel).join(L === 'zh' ? '、' : ', '))] : [];
      return Object.entries(it.cells)
        .filter(([k]) => (it.mode === 'sep' ? selSvcs.includes(k) : selIds.has(k)))
        .filter(([, c]) => keepC(c))
        .map(([k, c]) => rowOf(it, c, `${it.id}:${k}`, `${name(it)} · ${cellLabel(p, k, L)}`, it.mode === 'sep' ? svcLabel(k) : cellLabel(p, k, L)));
    };
    /* REQ-058:不包含室内部分时,「室内资料」那一组不导出 */
    const cl = (p.checklist || []).filter((g) => !clGroupHidden(p, g));
    return p.noCategories
      ? [{ g: { group: '', groupEn: '' }, rows: cl.flatMap((g) => g.items).flatMap(one) }]
      : cl.map((g) => ({ g, rows: g.items.flatMap(one) })).filter((x) => x.rows.length);
  }
  /* 导出的文件名带上所选业务(171-50JHS_Checklist_CGI+Animation);打印成 PDF 时浏览器拿 document.title 当文件名 */
  const pickedNames = selPkgs.map(({ pkg }) => (p.packages.filter((x) => x.svc === pkg.svc).length > 1 ? pkgLabel(p, pkg, 'en') : (SVC[pkg.svc]?.en || pkg.svc)));
  const fileBase = `${p.name}_${sec === 'checklist' ? 'Checklist' : sec === 'schedule' ? 'Schedule' : 'Export'}_${[...new Set(pickedNames)].join('+') || 'none'}`.replace(/[\\/:*?"<>|]/g, '_');
  useEffect(() => {
    const was = document.title;
    document.title = fileBase;
    return () => { document.title = was; };
  }, [fileBase]);
  /* 清单这一块的表:栏位跟导出时勾的走(REQ-055 起「负责人」也有开关),
     clSpan(分组标题合并多宽)就是表头的栏数,自动同步 */
  function clTable(): { heading: string; color?: string; flat: boolean; heads: XHead[]; tables: XTable[]; empty: boolean } {
    const partial = selSvcs.length < allSvcs.length || selIds.size < p.packages.length;
    const flat = !!p.noCategories; // REQ-014: export follows the chosen mode
    const showOwner = cols.clOwner;
    const showSvcs = cols.clSvcs && (allSvcs.length > 1 || p.packages.length > 1);
    const heads: XHead[] = [
      { v: T('信息项', 'Item'), xw: 58 },
      ...(showSvcs ? [{ v: T('适用服务', 'Applies to'), w: '14%', xw: 18 }] : []),
      ...(showOwner ? [{ v: T('负责人', 'Owner'), w: '12%', xw: 16 }] : []),
      ...(cols.clStatus ? [{ v: T('状态 / 收到内容', 'Status / Received'), w: '22%', xw: 26 }] : []),
      ...(cols.clDate ? [{ v: T('收到日期', 'Date received'), w: '12%', xw: 14 }] : []),
      ...(cols.clRemark ? [{ v: T('备注', 'Remark'), w: '20%', xw: 30 }] : []),
    ];
    const row = (r: ClRow): XRow => ({ key: r.key, cells: [
      { v: r.name, ...(r.sub ? { sub: r.sub } : {}) },
      ...(showSvcs ? [{ v: r.svcs }] : []),
      ...(showOwner ? [{ v: r.owner || '—' }] : []),
      ...(cols.clStatus ? [{ v: `${r.status}${r.received ? ` — ${r.received}` : ''}`, st: r.pending ? { fill: '#fffbeb' } : undefined }] : []),
      ...(cols.clDate ? [{ v: r.date || '—' }] : []),
      ...(cols.clRemark ? [{ v: r.remark || '—', st: { pre: true } }] : []),
    ] });
    const groups = clRows();
    const empty = groups.length === 0 || groups.every((x) => !x.rows.length);
    /* REQ-058:组内小标题 —— 和上一行不同时先出一行(只有一格,横跨整行) */
    const withSec = (rows: ClRow[]): XRow[] => rows.flatMap((r, i) => [
      ...(r.sec && r.sec !== (rows[i - 1]?.sec || '') ? [{ key: `sec:${r.key}`, sec: true, cells: [{ v: r.sec, span: heads.length }] }] : []),
      row(r),
    ]);
    const tables: XTable[] = empty ? [] : flat
      ? [{ heads, rows: withSec(groups[0].rows) }]
      : groups.map(({ g, rows }) => ({ group: (L === 'zh' ? g.group : g.groupEn || g.group) || '', heads, rows: withSec(rows) }));
    const heading = `${T('信息清单', 'Information Checklist')}${partial ? ` — ${[...new Set(selPkgs.map(({ pkg }) => (p.packages.filter((x) => x.svc === pkg.svc).length > 1 ? pkgLabel(p, pkg, L) : svcLabel(pkg.svc))))].join(L === 'zh' ? '、' : ', ')}` : ''}`;
    return { heading, color: selSvcs.length === 1 ? svcColor(selSvcs[0]) : undefined, flat, heads, tables, empty };
  }
  const clEmptyTxt = T('暂无信息项。', 'No checklist items.');
  function ClBlock() {
    const { heading, color, flat, heads, tables, empty } = clTable();
    return (
      <React.Fragment>
        <h2 style={{ color }}>{heading}</h2>
        {empty ? (
          <p style={{ color: '#888', fontSize: 12 }}>{clEmptyTxt}</p>
        ) : flat ? (
          <table className="t-fix"><thead>{headRow(heads)}</thead><tbody>{tables[0].rows.map((r) => bodyRow(r, 'ex-cl-row'))}</tbody></table>
        ) : tables.map((t, gi) => (
          <table key={gi} className="t-fix">
            {colGroup(heads)}
            <thead>
              <tr className="grp-h"><td colSpan={heads.length}>{t.group}</td></tr>
              {headRow(heads)}
            </thead>
            <tbody>{t.rows.map((r) => bodyRow(r, 'ex-cl-row'))}</tbody>
          </table>
        ))}
      </React.Fragment>
    );
  }

  /* 文档开头那两行(预览的 h1 / 副标题,Excel 每张表的第 1-2 行)和封面 —— 两边共用 */
  const titleOf = (label: string) => `${projCode(p) ? projCode(p) + ' · ' : ''}${p.name}${label ? ` — ${label}` : ''}`;
  const stageTxt = L === 'zh' ? STAGES[stageIdx(projStage(p))][1] : STAGES[stageIdx(projStage(p))][2];
  const subTxt = `${T('客户', 'Client')}: ${p.client || '—'} · ${T('服务', 'Services')}: ${svcNames} · ${T('阶段', 'Stage')}: ${stageTxt}`;
  /* REQ-056:封面信息表去掉「项目编号」那一格 —— 客户占整行,其余两两一对。标题里的编号照旧 */
  const coverMeta: [string, string][][] = [
    [[T('客户', 'Client'), p.client || '—']],
    [[T('交付日期', 'Delivery date'), p.delivery ? fmtDate(parseISO(p.delivery)) : '—'], [T('导出日期', 'Exported'), fmtDate(new Date())]],
    [[T('服务', 'Services'), svcNames], ['PM', (p.owners || []).join(' / ') || '—']],
  ];
  /* REQ-018 style A: overall Sum across the exported services */
  const sumWeeks = round1(selPkgs.reduce((n, x) => n + x.pkg.schedule.filter((r) => !r.kind).reduce((m, r) => m + (Number(r.weeks) || 0), 0), 0));
  const sumLabel = T('Sum · 合计 Overall duration', 'Sum · Overall duration');
  const sumVal = T(`${sumWeeks} 周`, `${sumWeeks} weeks`);

  /* REQ-055:Excel 和预览是同一份表。清单固定在第一张、排期第二张(「清单在前 / 排期在前」
     只管 PDF);只出排期就只有排期一张。封面、公司说明放在第一张上。 */
  function xlsxBook(): XBook {
    const coverX: XCover | undefined = cover ? {
      brand: 'AUDAX', kind: scopeLabel, code: projCode(p) || '', name: p.name, client: p.client || '—', meta: coverMeta,
    } : undefined;
    const notesX = notesOn && notes.trim() ? { title: T('公司说明', 'Notes'), text: notes } : undefined;
    const sheets: XSheet[] = [];
    if (showCl) {
      const c = clTable();
      sheets.push({
        name: T('清单', 'Checklist'), title: titleOf(T('信息清单', 'Checklist')), sub: subTxt,
        sections: [{ heading: c.heading, color: c.color, level: 2, tables: c.tables, empty: c.empty ? clEmptyTxt : undefined }],
      });
    }
    if (showSched) {
      const secs: XSection[] = selPkgs.flatMap(({ pkg }) => {
        const s = schedTable(pkg);
        return [
          { heading: s.heading, color: s.color, level: 2 as const, tables: [s.table] },
          ...(s.scope ? [{ heading: scopeTitle, level: 3 as const, tables: [s.scope] }] : []),
        ];
      });
      if (tableStyle === 'weeks' && secs.length) secs.push({ tight: true, tables: [{ heads: [], rows: [{ key: 'sum', cells: [
        { v: sumLabel, span: 2, st: { align: 'right', bold: true, fill: '#f0f2f5' } }, { v: sumVal, st: { bold: true, fill: '#f0f2f5' } },
      ] }] }] });
      sheets.push({ name: T('排期', 'Schedule'), title: titleOf(T('生产排期', 'Schedule')), sub: subTxt, sections: secs });
    }
    if (sheets[0]) { sheets[0].cover = coverX; sheets[0].notes = notesX; }
    return { sheets, orient, header: `${projCode(p) ? projCode(p) + ' · ' : ''}${p.name}` };
  }
  async function downloadXlsx() {
    if (xBusy || !selPkgs.length) return;
    setXBusy(true);
    try {
      /* 点了才加载 exceljs(体积不小),不进首屏 */
      const [mod, { buildXlsx }] = await Promise.all([import('exceljs'), import('@/lib/exportXlsx')]);
      const m = mod as unknown as { default?: typeof mod };
      const X = m.default && 'Workbook' in m.default ? m.default : mod;
      const buf = await buildXlsx(X, xlsxBook());
      const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const a = document.createElement('a');
      a.href = url; a.download = `${fileBase}.xlsx`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      console.error(e);
      setToast(T('Excel 生成失败,请再试一次', 'Could not create the Excel file — please try again'));
    } finally {
      setXBusy(false);
    }
  }

  /* REQ-015: assemble blocks per ordering preset */
  const blocks: React.ReactNode[] = [];
  /* REQ-044: 清单项目一张 —— 不再按服务包穿插;「清单在前」放最前,其余放在排期后面 */
  if (order === 'clFirst' && showCl && selPkgs.length) blocks.push(<ClBlock key="cl" />);
  if (showSched) selPkgs.forEach(({ pkg, pi }, k) => blocks.push(
    schedStyle === 'calendar' ? <CalendarBlock key={`s${pi}`} pkg={pkg} first={k === 0 && !(order === 'clFirst' && showCl)} />
      : schedStyle === 'gantt' ? <GanttBlock key={`s${pi}`} pkg={pkg} />
      : <SchedBlock key={`s${pi}`} pkg={pkg} />));
  if (order !== 'clFirst' && showCl && selPkgs.length) blocks.push(<ClBlock key="cl" />);

  return (
    <div className="ex-wrap">
      <style media="print">{pageCss}</style>
      <div className="ex-actions">
        <button className="btn-line sm" style={L === 'en' ? { borderColor: 'var(--navy900)' } : undefined} onClick={() => setLang('en')}>English</button>
        <button className="btn-line sm" style={L === 'zh' ? { borderColor: 'var(--navy900)' } : undefined} onClick={() => setLang('zh')}>中文</button>
        {/* REQ-056:月历 / 甘特固定 A4 横向,这时方向按钮置灰 */}
        <button className="btn-line sm" onClick={() => setOrient(orient === 'portrait' ? 'landscape' : 'portrait')} disabled={fixedLand} data-testid="ex-orient"
          title={fixedLand ? T('月历 / 甘特固定 A4 横向', 'Calendar / Gantt are always A4 landscape') : undefined}>
          {effOrient === 'portrait' ? T('A4 纵向', 'A4 Portrait') : T('A4 横向', 'A4 Landscape')} ⇄
        </button>
        {/* REQ-055:.xlsx,和预览一样;只出排期时按钮照样在,只出排期那一张 */}
        <button className="btn-line sm" onClick={downloadXlsx} disabled={!selPkgs.length || xBusy} data-testid="ex-xlsx" title={`${fileBase}.xlsx`}>
          {xBusy ? T('生成中…', 'Preparing…') : showCl ? T('清单下载 Excel', 'Checklist as Excel') : T('下载 Excel', 'Download Excel')}
        </button>
        {fixedLand && <span style={{ fontSize: 11.5, color: 'var(--text2)', alignSelf: 'center' }} data-testid="ex-xlsx-hint">{T('Excel 中排期为表格', 'Excel shows the schedule as a table')}</span>}
        <button className="btn-navy sm" onClick={() => window.print()} title={`${fileBase}.pdf`}>{T('打印 / 另存 PDF', 'Print / Save PDF')}</button>
        <button className="btn-line sm" onClick={onClose}>{T('关闭', 'Close')}</button>
      </div>

      {/* REQ-015: content picker + ordering */}
      <div className="ex-colbar">
        {/* REQ-021 */}
        <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}
          title={T('第一页放项目封面(编号 / 名称 / 客户 / 日期)', 'Put a project cover on page 1 (no. / name / client / dates)')}>
          <input type="checkbox" checked={cover} onChange={(e) => setCover(e.target.checked)} data-testid="ex-cover" />
          {T('封面页', 'Cover page')}
        </label>
        <span className="ex-grp">
          {T('内容', 'Content')}:
          <label className="ex-col"><input type="radio" name="exsec" checked={sec === 'all'} onChange={() => setSec('all')} data-testid="ex-sec-all" /> {T('排期+清单', 'Schedule + Checklist')}</label>
          <label className="ex-col"><input type="radio" name="exsec" checked={sec === 'schedule'} onChange={() => setSec('schedule')} data-testid="ex-sec-schedule" /> {T('仅排期', 'Schedule only')}</label>
          <label className="ex-col"><input type="radio" name="exsec" checked={sec === 'checklist'} onChange={() => setSec('checklist')} data-testid="ex-sec-checklist" /> {T('仅清单', 'Checklist only')}</label>
        </span>
        {/* REQ-050: 业务选择总是显示;同一业务两份时可以分别勾「LED-1 / LED-2」 */}
        <span className="ex-grp" data-testid="ex-svcs">
          {T('服务', 'Services')}:
          {p.packages.map((pkg, pi) => (
            <label className="ex-col" key={pi}>
              <input type="checkbox" checked={pkgSel[pi]} data-testid={`ex-svc-${pi}`}
                onChange={() => setPkgSel((s) => s.map((v, i) => (i === pi ? !v : v)))} /> {p.packages.filter((x) => x.svc === pkg.svc).length > 1 ? pkgLabel(p, pkg, L) : svcName(pkg)}
            </label>
          ))}
        </span>
        {showSched && (
          <span className="ex-grp">
            {T('排期样式', 'Schedule layout')}:
            <select className="in sm" value={schedStyle} onChange={(e) => setSchedStyle(e.target.value as SchedLayout)} style={{ width: 'auto', padding: '3px 6px' }} data-testid="export-sched-style">
              <option value="classic">{T('阶段表', 'Stage table')}</option>
              <option value="weeks">{T('按服务分组(周)', 'By service (weeks)')}</option>
              <option value="dates">{T('按日期(Scale Model)', 'By date (Scale Model)')}</option>
              <option value="calendar">{T('月历', 'Calendar')}</option>
              <option value="gantt">{T('甘特', 'Gantt')}</option>
            </select>
          </span>
        )}
        {showSched && schedStyle === 'calendar' && (
          <span className="ex-grp" data-testid="ex-cal-toggles">
            {T('显示', 'Show')}:
            <label className="ex-col"><input type="checkbox" checked={calHol} onChange={() => setCalHol(!calHol)} data-testid="ex-cal-show-hol" /> {T('节假日', 'Holidays')}</label>
            <label className="ex-col"><input type="checkbox" checked={calKey} onChange={() => setCalKey(!calKey)} data-testid="ex-cal-show-key" /> {T('关键日期点', 'Key dates')}</label>
            <label className="ex-col"><input type="checkbox" checked={calList} onChange={() => setCalList(!calList)} data-testid="ex-cal-show-list" /> {T('本页阶段列表', 'Stages this month')}</label>
          </span>
        )}
        {multi && showSched && showCl && (
          <span className="ex-grp">
            {T('排列', 'Order')}:
            <select className="in sm" value={order} onChange={(e) => setOrder(e.target.value as Order)} style={{ width: 'auto', padding: '3px 6px' }} data-testid="ex-order">
              {/* REQ-044: 清单是项目一张,不再按服务穿插 —— 只剩谁在前 */}
              <option value="byPkg">{T('排期在前,清单在后', 'Schedules, then checklist')}</option>
              <option value="clFirst">{T('清单在前', 'Checklist first')}</option>
            </select>
          </span>
        )}
        {T('栏位', 'Columns')}:
        {showSched && <span className="ex-grp">{T('排期', 'Schedule')} {colToggle('owner', '负责', 'Owner')}{colToggle('start', '开始', 'Start')}{colToggle('due', '到期', 'Due')}{colToggle('status', '状态', 'Status')}</span>}
        {showCl && (
          <span className="ex-grp">{T('清单', 'Checklist')} {colToggle('clOwner', '负责人', 'Owner')}{colToggle('clStatus', '状态', 'Status')}{colToggle('clDate', '日期', 'Date')}{colToggle('clRemark', '备注', 'Remark')}{(p.packages.length > 1) && colToggle('clSvcs', '适用服务', 'Applies to')}
            <label className="ex-col" title={T('未收到的空白项也一并导出(状态 Pending)', 'Export blank items too (kept Pending)')}>
              <input type="checkbox" checked={blanks} onChange={() => setBlanks(!blanks)} data-testid="ex-blanks" /> {T('含空白项', 'Include blanks')}
            </label>
          </span>
        )}
        <span className="ex-grp">
          <label className="ex-col"><input type="checkbox" checked={notesOn} onChange={() => setNotesOn(!notesOn)} data-testid="ex-notes" /> {T('公司说明', 'Company notes')}</label>
          {notesOn && <button className="btn-line sm" onClick={() => setNotesEdit(!notesEdit)}>{notesEdit ? T('收起', 'Done') : T('编辑', 'Edit')}</button>}
        </span>
      </div>
      {notesOn && notesEdit && (
        <div className="ex-noteedit" style={{ maxWidth: 860, margin: '0 auto 10px', padding: '0 10px' }}>
          <div style={{ fontSize: 11.5, color: 'var(--text2)', marginBottom: 4 }}>
            {T('正在编辑「中文」那一份 —— 导出成英文时用的是另一份,切到 English 再改。',
               'Editing the English version — the Chinese export uses a separate one; switch to 中文 to edit that.')}
            {/* 只在英文这一份还没被单独存过时提醒 —— 它现在显示的是中文那份的
                文字(维持拆分前的行为),存一次就分开了。 */}
            {!enOwn && L === 'en' && (
              <span style={{ color: '#8f5b1d' }}>
                {' '}This one has never been saved separately, so it still shows the Chinese version’s text. Save it to split the two.
              </span>
            )}
          </div>
          <textarea className="in" value={notes} onChange={(e) => setNotes(e.target.value)}
            style={{ width: '100%', minHeight: 64, fontSize: 12.5 }} placeholder={T('公司说明 / 免责声明…', 'Company notes / disclaimer…')} />
          {isFull(me) && <button className="btn-line sm" style={{ marginTop: 4 }} onClick={saveDefaultNotes}>
            {T('存为全局默认(中文)', 'Save as global default (English)')}
          </button>}
        </div>
      )}

      <div className="ex-doc">
        {/* REQ-021: 封面页 —— 项目编号 / 名称 / 客户 / 日期,独占第一页。
            日期给两行:交付日是客户关心的,导出日期用来区分同一项目的不同版本。 */}
        {cover && (
          <section className="ex-cover">
            <div className="exc-top">
              <div className="exc-brand">AUDAX</div>
              {scopeLabel && <div className="exc-kind">{scopeLabel}</div>}
            </div>
            <div className="exc-mid">
              {projCode(p) && <div className="exc-no">{projCode(p)}</div>}
              <h1 className="exc-name">{p.name}</h1>
              <div className="exc-client">{p.client || '—'}</div>
            </div>
            <table className="exc-meta">
              <colgroup><col style={{ width: '16%' }} /><col style={{ width: '34%' }} /><col style={{ width: '16%' }} /><col style={{ width: '34%' }} /></colgroup>
              <tbody>
                {coverMeta.map((pairs, i) => (
                  <tr key={i}>{pairs.map(([k, v]) => <React.Fragment key={k}><th>{k}</th><td colSpan={pairs.length === 1 ? 3 : undefined}>{v}</td></React.Fragment>)}</tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        <h1>{titleOf(scopeLabel)}</h1>
        <div className="exsub">{subTxt}</div>
        {selPkgs.length === 0 ? (
          <p style={{ color: '#888' }}>{T('请至少勾选一个服务。', 'Select at least one service.')}</p>
        ) : blocks}
        {/* REQ-018 style A: overall Sum across the exported services */}
        {schedStyle === 'weeks' && showSched && selPkgs.length > 0 && (
          <table className="t-fix" style={{ marginTop: 4 }}>
            <tbody>
              <tr>
                <td style={{ textAlign: 'right', fontWeight: 700, background: '#f0f2f5' }}>{sumLabel}</td>
                <td style={{ width: '13%', fontWeight: 700, background: '#f0f2f5' }}>{sumVal}</td>
              </tr>
            </tbody>
          </table>
        )}
        {/* REQ-016: company notes / disclaimer at the bottom of every export */}
        {notesOn && notes.trim() && (
          <div style={{ marginTop: 22, padding: '10px 12px', border: '1px solid #d9d9d9', borderLeft: '3px solid #a8690b', fontSize: 11.5, whiteSpace: 'pre-wrap', color: '#555' }}>
            {notes}
          </div>
        )}
        <p style={{ color: '#999', fontSize: 11, marginTop: 24 }}>Audax Visuals · {T('导出于', 'Exported')} {fmtDate(todayMid())}</p>
      </div>
    </div>
  );
}
