'use client';

import React, { useState } from 'react';
import { ItemReceipts, ReceivingLog } from './ReceiptLog';
import { useStore, useWho } from '../store';
import { canEdit, canEditIn } from '@/lib/permissions';
import { getBuiltinTemplate, svcColor, svcName } from '@/lib/templates';
import { parseISO, todayMid } from '@/lib/project';
import { ALL, clGroups, clStats, inScope, projectSvcs, type ClScope } from '@/lib/sharedChecklist';
import { cellLabel, cellSvc, unitsOf, type ClFields } from '@/lib/clCells';
import { useLang } from '@/lib/i18n';
import { Avatar, CM, Icon, Pill } from '../ui';
import FragmentBar from '../FragmentBar';
import type { ChecklistItem, ChecklistStatus, Project } from '@/lib/types';

const CYCLE: Record<ChecklistStatus, ChecklistStatus> = {
  pending: 'received', received: 'confirmed', confirmed: 'na', na: 'revision', revision: 'rejected', rejected: 'pending',
};
const CL_OPTIONS: [ChecklistStatus, string, string][] = [
  ['pending', '未收到', 'Pending'], ['received', '已收到', 'Received'], ['confirmed', '已确认', 'Approved'],
  ['na', '不适用 N/A', 'N/A'], ['revision', '需修订', 'Revision'], ['rejected', '退回', 'Rejected'],
];

/* relative "time ago" for the Last Update column */
function relTime(ts: number | undefined, zh: boolean): string {
  if (!ts) return '—';
  const d = Math.max(0, Date.now() - ts);
  const m = Math.floor(d / 60000), h = Math.floor(d / 3600000), day = Math.floor(d / 86400000);
  if (m < 1) return zh ? '刚刚' : 'just now';
  if (h < 1) return zh ? `${m} 分钟前` : `${m} min ago`;
  if (day < 1) return zh ? `${h} 小时前` : `${h}h ago`;
  if (day < 30) return zh ? `${day} 天前` : `${day}d ago`;
  return zh ? `${Math.floor(day / 30)} 个月前` : `${Math.floor(day / 30)}mo ago`;
}

/* REQ-044: 一个项目一张信息清单。上面一排服务标签只是筛选(默认「全部」),
   在任一标签下改,别的标签看到的是同一条数据。 */
export default function ChecklistTab({ p, scope, onScope, onExport }: {
  p: Project; scope: ClScope; onScope: (s: ClScope) => void; onExport: () => void;
}) {
  const { me, dispatch, users, setToast } = useStore();
  const { lang, t, dual } = useLang();
  const who = useWho();   // REQ-051
  const [editMode, setEditMode] = useState(false);
  /* REQ-005: 信息清单默认只读,点「编辑」才可改字段(状态/日期/备注/图片) */
  const [fieldEdit, setFieldEdit] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({});
  /* REQ-012: drag-to-reorder items inside a category. REQ-044: 按项 id 记(筛选后序号会错位) */
  const [drag, setDrag] = useState<{ gi: number; id: string } | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  /* REQ-042: 两套视图 —— 对外清单(每项只看最新)/ 内部收料记录(全部记录+路径)。
     展开某一项看它的全部收料历史时记下它的 id。 */
  const [view, setView] = useState<'external' | 'log'>('external');
  const [openRec, setOpenRec] = useState<{ id: string; cell?: string } | null>(null);
  /* REQ-050: 展开某一项的修改记录;改回同步时选以哪一格为准 */
  const [openHist, setOpenHist] = useState<string | null>(null);
  const [syncPick, setSyncPick] = useState<string | null>(null);
  const ed = canEditIn(me, p, 'checklist');   // REQ-051: 再过权限表
  const fe = ed && fieldEdit;
  const assigneeNames = users.filter((u) => u.role !== 'viewer').map((u) => u.name);
  const today = todayMid();
  const svcs = projectSvcs(p);
  const short = (k: string) => svcName(k, lang).replace(/^其他\s*/, '');
  const scopeName = scope === ALL ? t('全部服务合计 · 同步项只算一次,分格的按格算', 'All services · synced items once, split items per cell') : svcName(scope, lang);

  /* REQ-003: overdue = 未收到(pending) 且已过截止日。已收到/需修改/已确认等
     都不算逾期(资料已到位或已在处理),避免把「已收到」误报成逾期。
     REQ-044: 按当前标签算 */
  const st = clStats(p, scope, today);
  const doneN = st.done, totalN = st.total, pendingN = st.pending, overdueN = st.overdue, pct = st.pct;

  /* 「添加信息项」的常用默认项:当前标签对应服务的模板;「全部」下是所有服务的 */
  function defaultsForGroup(group: string, groupEn: string): { zh: string; en: string }[] {
    const out: { zh: string; en: string }[] = [];
    (scope === ALL ? svcs : [scope]).forEach((k) => {
      const tg = getBuiltinTemplate(k).checklist.find((g) => g[0] === group || g[1] === groupEn);
      (tg ? tg[3] : []).forEach(([zh, en]) => { if (!out.some((x) => x.zh === zh)) out.push({ zh, en }); });
    });
    return out;
  }
  /* 改了一项共用的:提示一句别的服务也同步了(本来就是同一条) */
  const synced = (it: { svcs?: string[] }) => {
    const others = (it.svcs || []).filter((k) => k !== scope);
    if ((it.svcs || []).length > 1 && others.length) setToast(t(`已同步到 ${(it.svcs || []).map((k) => svcName(k, 'zh')).join('、')}`, `Synced to ${(it.svcs || []).map((k) => svcName(k, 'en')).join(', ')}`));
  };

  /* shared image pipeline: compress to <=560px JPEG and attach (multi-image). */
  function processImageFile(item: string, f: File | null | undefined, cell?: string) {
    if (!f) return;
    if (!f.type.startsWith('image/')) { alert(t('只支持图片文件', 'Only image files are supported')); return; }
    const rd = new FileReader();
    rd.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const mx = 560;
        let w = img.width, h = img.height;
        if (w > mx) { h = Math.round((h * mx) / w); w = mx; }
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d')!.drawImage(img, 0, 0, w, h);
        let data: string;
        try { data = c.toDataURL('image/jpeg', 0.6); } catch { alert(t('图片处理失败', 'Failed to process image')); return; }
        dispatch(p.id, { type: 'attachShot', item, data, ...(cell ? { cell } : {}) });
      };
      img.onerror = () => alert(t('无法读取图片', 'Could not read image'));
      img.src = e.target!.result as string;
    };
    rd.readAsDataURL(f);
  }
  function attachShot(item: string, input: HTMLInputElement, cell?: string) {
    const files = input.files ? Array.from(input.files) : [];
    files.forEach((f) => processImageFile(item, f, cell));
    input.value = '';
  }
  function imageFromDataTransfer(dt: DataTransfer | null): File | null {
    if (!dt) return null;
    if (dt.files && dt.files.length) { for (let i = 0; i < dt.files.length; i++) if (dt.files[i].type.startsWith('image/')) return dt.files[i]; }
    if (dt.items && dt.items.length) {
      for (let i = 0; i < dt.items.length; i++) { const it = dt.items[i]; if (it.kind === 'file' && it.type.startsWith('image/')) { const f = it.getAsFile(); if (f) return f; } }
    }
    return null;
  }

  /* ── REQ-050: 一格(或不分格的项本身)的几列 —— 备注、参考图、负责人、状态 / 收到内容、日期。
     c 是这一格的内容,cell 是格的键(不分格时为空);所有改动都带上 cell ── */
  const withCell = (cell?: string) => (cell ? { cell } : {});
  function remarkBox(it: ChecklistItem, c: ClFields, cell?: string) {
    return (
      <div style={{ marginTop: 10, display: 'flex', alignItems: 'flex-start', gap: 6 }}>
        {fe && (
          <button title={c.highlight ? t('取消重点', 'Unmark important') : t('标为重点', 'Mark important')}
            onClick={() => dispatch(p.id, { type: 'toggleHighlight', item: it.id!, ...withCell(cell) })}
            style={{ flex: '0 0 auto', fontSize: 15, lineHeight: 1, padding: '3px 3px', background: 'none', color: c.highlight ? '#D98A12' : '#c2cad3' }}>
            {c.highlight ? '★' : '☆'}
          </button>
        )}
        <textarea className="in sm" rows={1} key={`rmk-${it.id}-${cell || ''}-${c.remark || ''}`}
          data-testid={`cl-remark-${it.id}${cell ? '-' + cell : ''}`}
          placeholder={t('下一步 / 备注…(可换行)', 'Next step / note… (multi-line)')}
          defaultValue={c.remark} readOnly={!fe}
          style={{
            width: '100%', minHeight: 30, resize: 'vertical', lineHeight: 1.5, whiteSpace: 'pre-wrap',
            ...(c.highlight ? { background: '#fff6e2', borderColor: '#e6b657', color: '#8a5a0f', fontWeight: 600 } : {}),
          }}
          onBlur={(e) => { if (fe && e.target.value !== c.remark) dispatch(p.id, { type: 'editCl', item: it.id!, field: 'remark', value: e.target.value, ...withCell(cell) }).then((ok) => ok && !cell && synced(it)); }} />
      </div>
    );
  }
  function cellCols(it: ChecklistItem, c: ClFields & { shot?: string }, cell?: string) {
    const due = parseISO(c.date);
    // REQ-003: 仅「未收到 pending」且过期才标逾期(已收到不算)
    const overdue = due && due < today && c.status === 'pending';
    const shots = c.shots && c.shots.length ? c.shots : (c.shot ? [c.shot] : []);
    const nRec = (c.receipts || []).length;
    const key = `${it.id}:${cell || ''}`;
    const setStatus = (value: ChecklistStatus) => dispatch(p.id, { type: 'setClStatus', item: it.id!, value, ...withCell(cell) }).then((ok) => ok && !cell && synced(it));
    return (
      <>
        {/* ── REQ-024 参考图 Reference ──
            查看态只读缩略图(点开看大图),编辑态可上传 / 拖入 / 粘贴 / 删除。 */}
        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {shots.map((s, si) => (
              <span key={si} style={{ position: 'relative', display: 'inline-flex' }}>
                <img src={s} alt="" title={t('点击放大', 'Click to enlarge')}
                  style={{ width: 58, height: 42, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)', cursor: 'zoom-in' }}
                  onClick={() => setLightbox(s)} />
                {fe && (
                  <button title={t('删除此图', 'Remove image')}
                    onClick={() => dispatch(p.id, { type: 'removeShot', item: it.id!, shotIdx: si, ...withCell(cell) })}
                    style={{ position: 'absolute', top: -6, right: -6, width: 16, height: 16, borderRadius: 8, background: 'var(--danger)', color: '#fff', fontSize: 10, lineHeight: '16px', textAlign: 'center' }}>✕</button>
                )}
              </span>
            ))}
          </div>
          {fe ? (
            <label
              tabIndex={0}
              title={t('点击选择,或拖入 / 粘贴图片(可多张)', 'Click to select, or drag / paste images (multiple)')}
              style={{ fontSize: 11, color: '#234f97', background: '#e7eefb', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', outline: 'none', textAlign: 'center' }}
              onDragOver={(e) => { e.preventDefault(); (e.currentTarget as HTMLElement).style.background = '#c9dcff'; }}
              onDragLeave={(e) => { (e.currentTarget as HTMLElement).style.background = '#e7eefb'; }}
              onDrop={(e) => { e.preventDefault(); (e.currentTarget as HTMLElement).style.background = '#e7eefb'; processImageFile(it.id!, imageFromDataTransfer(e.dataTransfer), cell); }}
              onPaste={(e) => { const f = imageFromDataTransfer(e.clipboardData); if (f) { e.preventDefault(); processImageFile(it.id!, f, cell); } }}>
              📎 {shots.length ? t('加图', 'Add') : t('上传 / 拖入 / 粘贴', 'Upload / drag / paste')}
              <input type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={(e) => attachShot(it.id!, e.target, cell)} />
            </label>
          ) : shots.length === 0 ? (
            <span style={{ fontSize: 11.5, color: '#b6bfc9' }}>{t('暂无参考图', 'No reference')}</span>
          ) : null}
        </div>

        {/* ── Owner (hidden in flat mode, REQ-014) ── */}
        {!flat && (
          <div style={{ minWidth: 0 }}>
            {editMode && ed ? (
              <input className="in sm" list="cl-owner-names" defaultValue={c.owner || ''} placeholder={t('负责人', 'Owner')} key={`own-${key}-${c.owner || ''}`}
                onBlur={(e) => e.target.value !== (c.owner || '') && dispatch(p.id, { type: 'editCl', item: it.id!, field: 'owner', value: e.target.value, ...withCell(cell) })} />
            ) : c.owner ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 700, color: 'var(--navy900)' }}>
                <Avatar name={c.owner} size={24} />{who(c.owner)}
              </span>
            ) : (
              <span style={{ fontSize: 12, color: '#b6bfc9' }}>{t('未指派', 'Unassigned')}</span>
            )}
          </div>
        )}

        {/* ── Status + 收到内容 (REQ-013/019) ── */}
        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {fe ? (
            <button title={t('点击推进状态,右键选择', 'Click to advance, right-click to pick')} style={{ padding: 0, background: 'none', alignSelf: 'flex-start' }}
              data-testid={`cl-status-${it.id}${cell ? '-' + cell : ''}`}
              onClick={() => setStatus(CYCLE[c.status])}
              onContextMenu={(e) => {
                e.preventDefault();
                const pick = prompt(
                  t(`状态(输入编号):\n${CL_OPTIONS.map((o, k) => `${k + 1}. ${o[1]}`).join('\n')}`,
                    `Status (enter number):\n${CL_OPTIONS.map((o, k) => `${k + 1}. ${o[2]}`).join('\n')}`),
                  String(CL_OPTIONS.findIndex((o) => o[0] === c.status) + 1));
                const k = parseInt(pick || '') - 1;
                if (k >= 0 && k < CL_OPTIONS.length) setStatus(CL_OPTIONS[k][0]);
              }}>
              <Pill m={CM[c.status]} />
            </button>
          ) : (
            <span style={{ alignSelf: 'flex-start' }} data-testid={`cl-status-ro-${it.id}${cell ? '-' + cell : ''}`}><Pill m={CM[c.status]} /></span>
          )}
          {fe ? (
            <input className="in sm" defaultValue={c.received || ''} key={`rcv-${key}-${c.received || ''}`}
              placeholder={t('收到内容 / 文件名…', 'Received content / file name…')}
              title={t('填入后自动标记「已收到」并填今天的日期', 'Filling this auto-sets Received + today’s date')}
              onBlur={(e) => e.target.value !== (c.received || '') && dispatch(p.id, { type: 'editCl', item: it.id!, field: 'received', value: e.target.value, ...withCell(cell) }).then((ok) => ok && !cell && synced(it))} />
          ) : c.received ? (
            <span style={{ fontSize: 12, color: 'var(--text)', wordBreak: 'break-word' }}>📄 {c.received}</span>
          ) : null}
          {/* REQ-042: 这一项(这一格)收过几次 —— 点开看全部历史 */}
          <button className="btn-line sm" style={{ alignSelf: 'flex-start', marginTop: 2 }} data-testid={`cl-rec-btn-${it.id}${cell ? '-' + cell : ''}`}
            title={t('查看 / 追加这一项的收料记录(多次收料不会互相覆盖)',
                     'View / append this item’s receiving records — versions never overwrite each other')}
            onClick={() => setOpenRec(openRec && openRec.id === it.id && openRec.cell === cell ? null : { id: it.id!, cell })}>
            🗂 {t('记录', 'Records')} ({nRec})
            {nRec > 1 && (
              <span className="badge" style={{ background: 'var(--navy900)', color: '#fff', marginLeft: 5 }}>
                {t(`${nRec} 版`, `${nRec} versions`)}
              </span>
            )}
          </button>
        </div>

        {/* ── Date received ── */}
        <div>
          <input type="date" className="in sm" style={{ width: '100%', ...(overdue ? { borderColor: '#e7a19b', color: '#b23a32' } : {}) }} value={c.date} disabled={!fe}
            onChange={(e) => dispatch(p.id, { type: 'editCl', item: it.id!, field: 'date', value: e.target.value, ...withCell(cell) })} />
          <div style={{ fontSize: 10.5, color: 'var(--text2)', marginTop: 3 }}>{relTime(c.updatedAt, lang === 'zh')}</div>
        </div>
      </>
    );
  }

  /* REQ-014: flat mode drops the Owner column (Item / Status+received / Date / Remark);
     REQ-019: template columns are Item · Status(含收到内容) · Date received. */
  const flat = !!p.noCategories;   // REQ-044: 项目级开关
  /* REQ-024: 「参考图」列插在 信息项 与 负责人 之间(无分类模式下就在信息项之后) */
  const cols = flat
    ? (editMode && ed ? 'minmax(260px,2.4fr) 132px 220px 132px 34px' : 'minmax(260px,2.4fr) 132px 220px 132px')
    : (editMode && ed ? 'minmax(240px,2.2fr) 132px 150px 220px 124px 34px' : 'minmax(240px,2.2fr) 132px 150px 220px 124px');

  return (
    <>
      {/* REQ-044: 「全部」+ 各服务。服务标签只是筛选 */}
      {svcs.length > 1 && (
        <div data-testid="cl-scope-tabs" style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 16 }}>
          <button className={`chip ${scope === ALL ? 'active' : ''}`} data-scope={ALL}
            style={scope === ALL ? { background: 'var(--navy900)', borderColor: 'var(--navy900)' } : undefined}
            onClick={() => onScope(ALL)}>{t('全部', 'All')}</button>
          {svcs.map((k) => (
            <button key={k} className={`chip ${scope === k ? 'active' : ''}`} data-scope={k}
              style={scope === k ? { background: svcColor(k), borderColor: svcColor(k) } : undefined}
              onClick={() => onScope(k)}>
              {svcName(k, lang)}
            </button>
          ))}
        </div>
      )}

      {/* KPI cards (image7) */}
      <div className="kpi-grid" style={{ marginBottom: 16, display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14 }}>
        <div className="kpi" style={{ padding: '18px 20px', display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ flex: 1 }}>
            <div className="kpi-label">{t('完成率', 'Completion rate')}</div>
            <div className="tnum" style={{ fontSize: 30, fontWeight: 600, color: 'var(--navy900)', marginTop: 4, lineHeight: 1 }}>{pct}%</div>
            <div data-testid="cl-kpi-done" style={{ fontSize: 11.5, color: 'var(--text2)', marginTop: 5 }}>{t(`${doneN} / ${totalN} 项已确认`, `${doneN} / ${totalN} confirmed`)}{svcs.length > 1 ? ` · ${scopeName}` : ''}</div>
          </div>
          <Ring pct={pct} />
        </div>
        <div className="kpi" style={{ padding: '18px 20px' }}>
          <div className="kpi-label">{t('待处理项', 'Pending items')}</div>
          <div className="tnum" data-testid="cl-kpi-pending" style={{ fontSize: 30, fontWeight: 600, color: pendingN ? 'var(--warning)' : 'var(--navy900)', marginTop: 4, lineHeight: 1 }}>{pendingN}</div>
          <div style={{ fontSize: 11.5, color: 'var(--text2)', marginTop: 5 }}>{svcs.length > 1 ? scopeName : t('全部栏目合计', 'across all sections')}</div>
        </div>
        <div className="kpi" style={{ padding: '18px 20px' }}>
          <div className="kpi-label">{t('已逾期项', 'Overdue items')}</div>
          <div className="tnum" data-testid="cl-kpi-overdue" style={{ fontSize: 30, fontWeight: 600, color: overdueN ? 'var(--danger)' : 'var(--navy900)', marginTop: 4, lineHeight: 1 }}>{overdueN}</div>
          <div style={{ fontSize: 11.5, color: 'var(--text2)', marginTop: 5 }}>{svcs.length > 1 ? scopeName : t('需要跟进', 'require action')}</div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, color: 'var(--text2)' }}>
          {editMode && ed
            ? <span style={{ color: 'var(--navy700)' }}>⠿ {t('拖动右侧手柄可在同一分类内调整信息项顺序', 'Drag the ⠿ handle to reorder items within a category')}</span>
            : t('点状态徽章向前推进(右键选择指定状态)', 'Click a status badge to advance it (right-click to pick)')}
        </div>
        <div style={{ flex: 1 }} />
        {ed && editMode && (
          <button className="btn-line sm" style={{ color: 'var(--danger)' }}
            title={scope === ALL
              ? t('用各服务的默认模板重建整张清单(当前的项移到「已移除的项」,可恢复)', 'Rebuild the whole checklist from the default templates (current items move to “Removed”, restorable)')
              : t('用默认模板恢复这个服务的清单(只属于它的项移到「已移除的项」,共用项保留)', 'Reset this service’s items from the template (its own items move to “Removed”; shared items stay)')}
            onClick={() => {
              const msg = scope === ALL
                ? t('用各服务的默认模板重建整张清单?当前所有信息项会移到「已移除的项」(可恢复)。', 'Rebuild the whole checklist from the default templates? All current items move to “Removed” (restorable).')
                : t(`用默认模板恢复「${svcName(scope, 'zh')}」的清单?只属于它的项会移到「已移除的项」(可恢复),和别的服务共用的项保留。`, `Reset “${svcName(scope, 'en')}” from the template? Its own items move to “Removed” (restorable); shared items stay.`);
              if (confirm(msg)) dispatch(p.id, { type: 'resetChecklist', scope });
            }}>
            ↺ {t('恢复默认', 'Reset')}
          </button>
        )}
        {ed && (
          <button className={`btn-line sm ${fieldEdit ? '' : ''}`} style={fieldEdit ? { borderColor: 'var(--navy700)', color: 'var(--navy900)', fontWeight: 600 } : undefined}
            onClick={() => setFieldEdit(!fieldEdit)}>
            {fieldEdit ? t('完成', 'Done') : t('编辑', 'Edit')}
          </button>
        )}
        {ed && <button className="btn-line sm" onClick={() => setEditMode(!editMode)}>{editMode ? t('完成编辑', 'Done editing') : t('增减信息项', 'Edit items')}</button>}
        {/* REQ-014: category mode toggle */}
        {ed && (
          <label className="btn-line sm" style={{ cursor: 'pointer', display: 'inline-flex', gap: 6, alignItems: 'center' }}
            title={t('开启后清单不分分类,仅 信息项/状态/日期/备注', 'Flat list — Item / Status / Date / Remark only')}>
            <input type="checkbox" checked={flat} onChange={(e) => dispatch(p.id, { type: 'setNoCategories', value: e.target.checked })} />
            {t('无固定分类', 'No categories')}
          </label>
        )}
        <button className="btn-line sm" onClick={onExport}><Icon name="download" size={13} />{t('导出清单', 'Export Checklist')}</button>
      </div>

      {/* REQ-042: 对外清单 / 内部收料记录 两套视图 */}
      <div className="detail-tabs" style={{ borderTop: 'none', marginBottom: 4 }}>
        <button className={`detail-tab${view === 'external' ? ' active' : ''}`} onClick={() => setView('external')}
          title={t('给顾问 / 客户看的:每项只显示最新状态,不含服务器路径与内部备注',
                   'For consultants / clients: latest status per item, no server paths or internal remarks')}>
          {t('对外清单', 'External checklist')}
        </button>
        <button className={`detail-tab${view === 'log' ? ' active' : ''}`} onClick={() => setView('log')}
          title={t('团队内部用:每项的全部收料记录,含路径与备注', 'Internal: every receiving record with paths and remarks')}>
          {t('内部收料记录', 'Receiving log')}
        </button>
      </div>

      {view === 'log' ? (
        <ReceivingLog p={p} scope={scope} canEd={ed}
          onOpenItem={(id, cell) => { setView('external'); setOpenRec({ id, cell }); }} />
      ) : (
      <>
      {/* REQ-012: import this package's checklist from another project / a saved template */}
      {ed && <FragmentBar p={p} pkgIdx={0} scope={scope} kind="checklist" />}

      <div className="panel clip">
        {/* column headers (image7) */}
        <div style={{
          display: 'grid', gridTemplateColumns: cols, gap: 16, padding: '14px 24px',
          background: 'var(--hover-bg)', borderBottom: '1px solid var(--row-line)',
          fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--text2)',
        }}>
          <div>{t('信息项', 'Item')}</div>
          <div>{t('参考图', 'Reference')}</div>
          {!flat && <div>{t('负责人', 'Owner')}</div>}
          <div>{t('状态 / 收到内容', 'Status / Received')}</div>
          <div>{t('收到日期', 'Date received')}</div>
          {editMode && ed && <div />}
        </div>

        {clGroups(p).map((g, gi) => {
          /* REQ-044: 只显示当前标签的项;一项都不剩的分组不显示 */
          const vis = g.items.filter((it) => inScope(it, scope));
          if (!vis.length) return null;
          /* REQ-050: 按格算(规格项 / 单独填按份数 / 业务数) */
          const applicable = vis.flatMap((it) => unitsOf(p, it, scope)).filter((u) => u.c.status !== 'na');
          const conf = applicable.filter((u) => u.c.status === 'confirmed').length;
          const gpct = applicable.length ? Math.round((conf / applicable.length) * 100) : 0;
          const isCol = !!collapsed[gi];
          return (
            <div key={gi}>
              {/* collapsible bold section header — hidden in flat mode (REQ-014) */}
              {!flat && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '16px 24px', borderBottom: '1px solid var(--row-line)' }}>
                <button onClick={() => setCollapsed((s) => ({ ...s, [gi]: !s[gi] }))}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'none', textAlign: 'left', flex: 1, minWidth: 0, padding: 0 }}>
                  <span style={{ transform: isCol ? 'rotate(-90deg)' : 'none', transition: 'transform .15s', color: 'var(--text2)', fontSize: 12 }}>▾</span>
                  <span style={{ width: 9, height: 9, borderRadius: 2, background: g.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--navy900)' }}>{lang === 'zh' ? g.group : g.groupEn}</span>
                  {/* REQ-041: 另一种语言的栏目名,受「双语并排」开关控制 */}
                  {dual && <span style={{ fontWeight: 400, color: 'var(--text2)', fontSize: 12 }}>{lang === 'zh' ? g.groupEn : g.group}</span>}
                  <span className="badge" style={{ background: 'var(--hover-bg)', color: 'var(--text2)' }}>{applicable.length}</span>
                  <div style={{ flex: 1 }} />
                  <span className="tnum" style={{ fontSize: 12.5, fontWeight: 600, color: gpct >= 100 ? 'var(--success)' : 'var(--text2)' }}>{gpct}%</span>
                </button>
                {/* REQ-014: rename / delete category */}
                {ed && editMode && (
                  <>
                    <button className="btn-line sm" title={t('重命名分类', 'Rename category')}
                      onClick={() => {
                        const name = prompt(t('分类名称(中)', 'Category name'), g.group);
                        if (name == null || !name.trim()) return;
                        const nameEn = prompt(t('分类名称(英,可空)', 'Category name (EN, optional)'), g.groupEn) ?? g.groupEn;
                        dispatch(p.id, { type: 'renameGroup', gi, name: name.trim(), nameEn });
                      }}>✎</button>
                    <button className="btn-line sm danger" title={t('删除分类', 'Delete category')}
                      onClick={() => {
                        const others = g.items.length - vis.length;
                        const msg = t(`删除分类「${g.group}」?它的 ${g.items.length} 个信息项会移到「已移除的项」(可恢复)${others ? `,其中 ${others} 项属于别的服务、当前标签下看不到` : ''}。`,
                          `Delete category "${g.group}"? Its ${g.items.length} items move to “Removed” (restorable)${others ? `; ${others} of them belong to other services` : ''}.`);
                        if (confirm(msg)) dispatch(p.id, { type: 'removeGroup', gi });
                      }}>✕</button>
                  </>
                )}
              </div>
              )}

              {!isCol && vis.map((it, ii) => {
                const over = dragOver === it.id && drag && drag.gi === gi && drag.id !== it.id;
                const shared = (it.svcs || []).length > 1;
                /* REQ-050: 分格的项 —— 在当前标签下显示哪几格(单独填只显示这个业务那一格) */
                const cellKeys = it.cells ? Object.keys(it.cells).filter((k) => scope === ALL || cellSvc(p, k) === scope) : null;
                const sep = it.mode === 'sep' && !!it.cells;
                const histN = (it.history || []).length;
                const nameBlock = editMode && ed ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <input className="in sm" defaultValue={it.zh}
                      onBlur={(e) => e.target.value !== it.zh && dispatch(p.id, { type: 'editCl', item: it.id!, field: 'zh', value: e.target.value })} />
                    <input className="in sm" defaultValue={it.en}
                      onBlur={(e) => e.target.value !== it.en && dispatch(p.id, { type: 'editCl', item: it.id!, field: 'en', value: e.target.value })} />
                    {/* REQ-044: 这一项哪些服务需要 —— 勾掉 / 加上 */}
                    {svcs.length > 1 && (
                      <div data-testid={`cl-svcs-${it.id}`} style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', fontSize: 11.5, color: 'var(--text2)' }}>
                        {t('适用服务', 'Applies to')}:
                        {svcs.map((k) => {
                          const on = (it.svcs || []).includes(k);
                          return (
                            <label key={k} style={{ display: 'inline-flex', gap: 3, alignItems: 'center', cursor: 'pointer' }}>
                              <input type="checkbox" checked={on} data-svc={k}
                                onChange={() => {
                                  const next = on ? (it.svcs || []).filter((x) => x !== k) : [...(it.svcs || []), k];
                                  if (!next.length) { setToast(t('至少留一个服务;不需要这一项就点右边的 ✕', 'Keep at least one service — use ✕ to remove the item')); return; }
                                  dispatch(p.id, { type: 'setItemSvcs', item: it.id!, svcs: next });
                                }} />
                              {short(k)}
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    <div style={{ fontSize: 13.5, fontWeight: 500 }}>
                      {lang === 'zh' ? it.zh : it.en || it.zh}
                      {/* REQ-050: 规格项(同一业务多份,每份一格)/ 单独填 / 只此业务 */}
                      {it.cells && !sep && (
                        <span className="badge" data-testid="cl-inst" title={t('同一业务的每一份各一格,各自有状态、内容和收料记录', 'One cell per instance of the service — each with its own status, content and records')}
                          style={{ marginLeft: 7, background: '#eef1fb', color: '#3b4f8f', fontWeight: 600 }}>{t('规格项 · 每份一格', 'Spec · one per instance')}</span>
                      )}
                      {sep && (
                        <span className="badge" data-testid="cl-sep" title={t('每个业务各填各的', 'Each service fills its own')}
                          style={{ marginLeft: 7, background: '#fdf3e6', color: '#8f5b1d', fontWeight: 600 }}>{t('单独填', 'Filled separately')}</span>
                      )}
                      {!shared && svcs.length > 1 && !it.cells && (
                        <span className="badge" data-testid="cl-only" style={{ marginLeft: 7, background: 'var(--hover-bg)', color: 'var(--text2)' }}>{t('只此业务', 'This service only')} · {short((it.svcs || [])[0] || '')}</span>
                      )}
                    </div>
                    {dual && <div style={{ fontSize: 11.5, color: 'var(--text2)' }}>{lang === 'zh' ? it.en : it.zh}</div>}
                    {/* REQ-050: 同步的共用项 —— 在任一标签下改,别的业务同时更新 */}
                    {shared && !sep && (
                      <div data-testid="cl-sync-note" title={t('几个业务共用这一份,改一处各处同步', 'Shared by several services — one record, kept in sync')}
                        style={{ fontSize: 11.5, color: '#1f6f5a', marginTop: 3 }}>
                        ↔ {t('同步到', 'Synced to')} {(it.svcs || []).map(short).join(' · ')}
                      </div>
                    )}
                  </>
                );
                const modeCtl = ed && (fe || editMode) && shared && (
                  <span style={{ display: 'inline-flex', gap: 6, marginTop: 6 }}>
                    {!sep ? (
                      <button className="btn-line sm" data-testid={`cl-mode-sep-${it.id}`}
                        title={t('每个业务各填一份(先各复制一份现在的内容)', 'Fill separately per service (each starts with a copy of the current content)')}
                        onClick={() => dispatch(p.id, { type: 'setClMode', item: it.id!, mode: 'sep' })}>⇉ {t('单独填', 'Fill separately')}</button>
                    ) : (
                      <button className="btn-line sm" data-testid={`cl-mode-sync-${it.id}`}
                        title={t('几个业务改回共用一份,选以哪一份为准', 'Share one record again — pick which version to keep')}
                        onClick={() => setSyncPick(it.id!)}>↔ {t('改回同步', 'Sync again')}</button>
                    )}
                  </span>
                );
                const histBtn = histN > 0 && (
                  <button className="btn-line sm" data-testid={`cl-history-btn-${it.id}`} style={{ marginTop: 6 }}
                    title={t('合并重复项、改回同步、删掉一份业务时没被采用的内容都在这里', 'Versions not kept when merging, re-syncing or removing an instance')}
                    onClick={() => setOpenHist(openHist === it.id ? null : it.id || null)}>🕘 {t('修改记录', 'History')} ({histN})</button>
                );
                const actions = editMode && ed && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'center' }}>
                    {/* REQ-012: drag handle — reorder inside this category */}
                    <span draggable
                      onDragStart={(e) => { setDrag({ gi, id: it.id! }); e.dataTransfer.effectAllowed = 'move'; }}
                      onDragEnd={() => { setDrag(null); setDragOver(null); }}
                      title={t('拖动调整顺序（同一分类内）', 'Drag to reorder within this category')}
                      style={{ cursor: 'grab', color: 'var(--text2)', userSelect: 'none', fontSize: 14, lineHeight: 1 }}>⠿</span>
                    <button title={t('上移', 'Move up')} disabled={ii === 0} style={{ opacity: ii === 0 ? 0.3 : 1, fontSize: 12, lineHeight: 1 }}
                      onClick={() => dispatch(p.id, { type: 'moveItem', item: it.id!, dir: -1, scope })}>▲</button>
                    <button style={{ color: 'var(--danger)', fontWeight: 700 }} data-testid={`cl-remove-${it.id}`}
                      title={shared ? t('移除(多个服务共用,移到「已移除的项」可恢复;只想不给这个服务用,勾掉上面的服务即可)', 'Remove (shared — restorable from “Removed”; to drop just one service, untick it above)') : t('移除(可在「已移除的项」恢复)', 'Remove (restorable from “Removed”)')}
                      onClick={() => dispatch(p.id, { type: 'removeItem', item: it.id! })}>✕</button>
                    <button title={t('下移', 'Move down')} disabled={ii === vis.length - 1} style={{ opacity: ii === vis.length - 1 ? 0.3 : 1, fontSize: 12, lineHeight: 1 }}
                      onClick={() => dispatch(p.id, { type: 'moveItem', item: it.id!, dir: 1, scope })}>▼</button>
                  </div>
                );
                const dragProps = {
                  onDragOver: editMode && ed ? (e: React.DragEvent) => { if (drag && drag.gi === gi) { e.preventDefault(); setDragOver(it.id || null); } } : undefined,
                  onDrop: editMode && ed ? (e: React.DragEvent) => {
                    e.preventDefault();
                    if (drag && drag.gi === gi && drag.id !== it.id) dispatch(p.id, { type: 'reorderItem', item: drag.id, to: it.id! });
                    setDrag(null); setDragOver(null);
                  } : undefined,
                };
                const rowStyle = (pending: boolean): React.CSSProperties => ({
                  display: 'grid', gridTemplateColumns: cols, gap: 16,
                  alignItems: 'start', padding: '18px 24px 18px 21px', borderBottom: '1px solid var(--row-line)',
                  /* REQ-019: 未收到 Pending 用黄底高亮 */
                  background: pending ? '#fffbeb' : undefined,
                  borderLeft: `3px solid ${over ? 'var(--navy700)' : 'transparent'}`,
                  opacity: drag && drag.id === it.id ? 0.45 : 1,
                });
                return (
                  <React.Fragment key={it.id || ii}>
                  {!cellKeys ? (
                    <div data-testid={`cl-row-${it.id}`} {...dragProps} style={rowStyle(it.status === 'pending')}>
                      {/* ── Item: name, thumbnails, remark ── */}
                      <div style={{ minWidth: 0 }}>
                        {nameBlock}
                        <div>{modeCtl}{histBtn ? <> {histBtn}</> : null}</div>
                        {remarkBox(it, it)}
                      </div>
                      {cellCols(it, it)}
                      {actions}
                    </div>
                  ) : (
                    <>
                      {/* REQ-050: 分格的项 —— 名字一行,下面每格一行 */}
                      <div data-testid={`cl-row-${it.id}`} {...dragProps}
                        style={{ ...rowStyle(false), padding: '14px 24px 6px 21px', borderBottom: 'none' }}>
                        <div style={{ minWidth: 0, gridColumn: `1 / span ${flat ? 4 : 5}` }}>
                          {nameBlock}
                          <div>{modeCtl}{histBtn ? <> {histBtn}</> : null}</div>
                        </div>
                        {actions}
                      </div>
                      {cellKeys.map((k) => {
                        const c = it.cells![k];
                        const csvc = cellSvc(p, k);
                        return (
                          <div key={k} data-testid={`cl-cell-${it.id}-${k}`} data-cell={cellLabel(p, k, 'zh')}
                            style={{ ...rowStyle(c.status === 'pending'), padding: '10px 24px 12px 21px', borderBottom: '1px dashed var(--row-line)' }}>
                            <div style={{ minWidth: 0, paddingLeft: 14, borderLeft: `3px solid ${svcColor(csvc)}` }}>
                              <span className="badge" data-testid="cl-cell-label" style={{ background: 'var(--hover-bg)', color: 'var(--navy900)', fontWeight: 700 }}>{cellLabel(p, k, lang)}</span>
                              {remarkBox(it, c, k)}
                            </div>
                            {cellCols(it, c, k)}
                            {editMode && ed && <div />}
                          </div>
                        );
                      })}
                      <div style={{ borderBottom: '1px solid var(--row-line)' }} />
                    </>
                  )}
                  {/* REQ-042: 展开这一项(这一格)的全部收料记录(Item History) */}
                  {openRec && openRec.id === it.id && (
                    <ItemReceipts p={p} item={it.id!} cell={openRec.cell} cellName={openRec.cell ? cellLabel(p, openRec.cell, lang) : undefined}
                      receipts={(openRec.cell ? it.cells?.[openRec.cell]?.receipts : it.receipts) || []} canEd={ed}
                      onClose={() => setOpenRec(null)} />
                  )}
                  {openHist === it.id && <ItemHistory it={it} onClose={() => setOpenHist(null)} />}
                  </React.Fragment>
                );
              })}

              {!isCol && editMode && ed && (
                <AddItemPanel
                  defaults={defaultsForGroup(g.group, g.groupEn)}
                  present={g.items.map((it) => it.zh)}
                  svcs={svcs} initial={scope === ALL ? svcs : [scope]} short={short}
                  onAdd={(items, sv) => dispatch(p.id, { type: 'addItem', gi, items, svcs: sv })}
                  onBlank={(sv) => dispatch(p.id, { type: 'addItem', gi, svcs: sv })}
                />
              )}
            </div>
          );
        })}
      </div>

      {editMode && ed && (
        <button className="btn-line" style={{ width: '100%', marginTop: 16, justifyContent: 'center', borderStyle: 'dashed' }}
          onClick={() => {
            const nm = prompt(t('新栏目名称(中文):', 'New section name:'), t('特殊需求', 'Special requirements'));
            if (nm) dispatch(p.id, { type: 'addGroup', name: nm, svcs: scope === ALL ? svcs : [scope] });
          }}>+ {t('添加新栏目', 'Add section')}</button>
      )}

      {/* REQ-044: 删服务包 / 删分类 / 删项 / 套用模板换下来的项都在这里,可恢复 */}
      {editMode && ed && (p.checklistRemoved || []).length > 0 && <RemovedItems p={p} scope={scope} />}

      </>
      )}

      <datalist id="cl-owner-names">{assigneeNames.map((n) => <option key={n} value={n} />)}</datalist>

      {syncPick && (() => {
        const it = clGroups(p).flatMap((g) => g.items).find((x) => x.id === syncPick);
        return it?.cells ? <SyncPickModal p={p} it={it} onClose={() => setSyncPick(null)} /> : null;
      })()}

      {lightbox && (
        <div className="overlay" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="" style={{ maxWidth: '92vw', maxHeight: '92vh', borderRadius: 8, boxShadow: '0 12px 48px rgba(0,0,0,.55)' }} />
        </div>
      )}
    </>
  );
}

/* small completion ring for the KPI card */
function Ring({ pct }: { pct: number }) {
  const r = 22, c = 2 * Math.PI * r, off = c * (1 - pct / 100);
  const col = pct >= 100 ? '#16865B' : pct >= 60 ? 'var(--navy700)' : '#D98A12';
  return (
    <svg width={56} height={56} viewBox="0 0 56 56" style={{ flexShrink: 0 }}>
      <circle cx="28" cy="28" r={r} fill="none" stroke="var(--row-line)" strokeWidth="6" />
      <circle cx="28" cy="28" r={r} fill="none" stroke={col} strokeWidth="6" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={off} transform="rotate(-90 28 28)" />
    </svg>
  );
}

/* B3: add-item panel — pick from the service's default library, or a blank item. */
function AddItemPanel({ defaults, present, svcs, initial, short, onAdd, onBlank }: {
  defaults: { zh: string; en: string }[];
  present: string[];
  svcs: string[]; initial: string[]; short: (k: string) => string;   // REQ-044: 新项挂哪些服务
  onAdd: (items: { zh: string; en: string }[], svcs: string[]) => void;
  onBlank: (svcs: string[]) => void;
}) {
  const { lang, t } = useLang();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [sv, setSv] = useState<string[]>(initial);
  const presentSet = new Set(present);
  const avail = defaults.filter((d) => !presentSet.has(d.zh));

  if (!open) {
    return (
      <div style={{ padding: '12px 20px' }}>
        <button className="btn-line sm" onClick={() => { setPicked({}); setSv(initial); setOpen(true); }}>+ {t('添加信息项', 'Add item')}</button>
      </div>
    );
  }
  const chosen = avail.filter((d) => picked[d.zh]);
  return (
    <div style={{ padding: '12px 20px', background: 'var(--hover-bg)', borderTop: '1px solid var(--row-line)' }}>
      {avail.length > 0 ? (
        <>
          <div className="mini-label" style={{ marginBottom: 8, color: 'var(--text2)', fontSize: 11.5 }}>
            {t('从常用默认项勾选(可多选):', 'Tick common default items (multi-select):')}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
            {avail.map((d) => (
              <label key={d.zh} style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, cursor: 'pointer',
                border: '1px solid var(--border)', borderRadius: 7, padding: '5px 10px',
                background: picked[d.zh] ? '#e7eefb' : 'var(--card-bg, #fff)', borderColor: picked[d.zh] ? '#8fb0e8' : 'var(--border)',
              }}>
                <input type="checkbox" checked={!!picked[d.zh]} onChange={() => setPicked((s) => ({ ...s, [d.zh]: !s[d.zh] }))} />
                {lang === 'zh' ? d.zh : d.en || d.zh}
              </label>
            ))}
          </div>
        </>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 10 }}>{t('默认项已全部添加。', 'All default items are already added.')}</div>
      )}
      {svcs.length > 1 && (
        <div data-testid="cl-add-svcs" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', fontSize: 12.5, marginBottom: 10 }}>
          <span style={{ color: 'var(--text2)', fontSize: 11.5 }}>{t('适用服务', 'Applies to')}:</span>
          {svcs.map((k) => (
            <label key={k} style={{ display: 'inline-flex', gap: 4, alignItems: 'center', cursor: 'pointer' }}>
              <input type="checkbox" checked={sv.includes(k)} data-svc={k}
                onChange={() => setSv((x) => (x.includes(k) ? x.filter((y) => y !== k) : [...x, k]))} />
              {short(k)}
            </label>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn-navy sm" disabled={!chosen.length || !sv.length}
          onClick={() => { onAdd(chosen, sv); setOpen(false); }}>
          + {t('添加所选', 'Add selected')}{chosen.length ? ` (${chosen.length})` : ''}
        </button>
        <button className="btn-line sm" disabled={!sv.length} onClick={() => { onBlank(sv); setOpen(false); }}>+ {t('自定义空白项', 'Blank custom item')}</button>
        <button className="btn-line sm" onClick={() => setOpen(false)}>{t('取消', 'Cancel')}</button>
      </div>
    </div>
  );
}

/* REQ-044: 已移除的项(可恢复)。删服务包、删分类、删项、套用模板 / 恢复默认换下来的都在这 */
function RemovedItems({ p, scope }: { p: Project; scope: ClScope }) {
  const { dispatch } = useStore();
  const { lang, t } = useLang();
  const who = useWho();   // REQ-051
  const [open, setOpen] = useState(false);
  const list = p.checklistRemoved || [];
  const why = (r: string) => (r.startsWith('svc:') ? t(`删了业务 ${svcName(r.slice(4), 'zh')}`, `service ${svcName(r.slice(4), 'en')} removed`)
    : r === 'group' ? t('删了分类', 'section deleted') : r === 'reset' ? t('套用模板 / 恢复默认', 'template applied') : t('移除', 'removed'));
  return (
    <div className="panel" data-testid="cl-removed" style={{ marginTop: 16, padding: '12px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <b style={{ fontSize: 13 }}>{t('已移除的项', 'Removed items')} ({list.length})</b>
        <span style={{ fontSize: 11.5, color: 'var(--text2)' }}>{t('不会真的删掉,随时可以恢复', 'Nothing is deleted — restore any time')}</span>
        <div style={{ flex: 1 }} />
        <button className="btn-line sm" data-testid="cl-removed-toggle" onClick={() => setOpen(!open)}>{open ? t('收起', 'Collapse') : t('展开', 'Show')}</button>
      </div>
      {open && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {list.slice(0, 200).map((r) => (
            <div key={r.item.id} data-testid="cl-removed-row" style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5, borderTop: '1px solid var(--row-line)', paddingTop: 5 }}>
              <span style={{ fontWeight: 600 }}>{lang === 'zh' ? r.item.zh : r.item.en || r.item.zh}</span>
              <span style={{ color: 'var(--text2)' }}>{lang === 'zh' ? r.group : r.groupEn || r.group} · {why(r.reason)} · {who(r.by)}</span>
              <div style={{ flex: 1 }} />
              <button className="btn-line sm" data-testid="cl-restore" onClick={() => dispatch(p.id, { type: 'restoreClItem', item: r.item.id!, scope })}>{t('恢复', 'Restore')}</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* REQ-050: 一项的修改记录 —— 合并重复项、改回同步、删掉一份业务时没被采用的那一份,原样在这里 */
function ItemHistory({ it, onClose }: { it: ChecklistItem; onClose: () => void }) {
  const { lang, t } = useLang();
  const who = useWho();
  const list = it.history || [];
  const st = (s?: string) => (s ? (lang === 'zh' ? CM[s as ChecklistStatus]?.zh : CM[s as ChecklistStatus]?.label) || s : '—');
  return (
    <div data-testid="cl-history" style={{ padding: '12px 24px 16px 44px', background: '#f7f8fb', borderBottom: '1px solid var(--row-line)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--navy900)' }}>{t('修改记录', 'History')} ({list.length})</span>
        <span style={{ fontSize: 11.5, color: 'var(--text2)' }}>{t('没被采用的内容和收料记录都留在这里,不会丢。', 'Versions that were not kept stay here with their records — nothing is lost.')}</span>
        <div style={{ flex: 1 }} />
        <button className="btn-line sm" onClick={onClose}>{t('收起', 'Close')}</button>
      </div>
      {list.map((h, i) => (
        <div key={i} data-testid="cl-history-row" style={{ borderTop: '1px solid var(--row-line)', padding: '7px 0', fontSize: 12.5 }}>
          <div style={{ color: 'var(--text2)', fontSize: 11.5 }}>{new Date(h.at).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-GB')} · {who(h.by) || (lang === 'zh' ? '系统' : 'System')}{h.cell ? ` · ${h.cell}` : ''}</div>
          <div>{lang === 'zh' ? h.text : historyEn(h)}</div>
          {h.data && (
            <div style={{ marginTop: 4, display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 12, color: 'var(--text)' }}>
              <span>{t('状态', 'Status')}: <b>{st(h.data.status)}</b></span>
              {h.data.received && <span>📄 {h.data.received}</span>}
              {h.data.date && <span>{t('日期', 'Date')}: {h.data.date}</span>}
              {h.data.owner && <span>{t('负责人', 'Owner')}: {who(h.data.owner)}</span>}
              {h.data.remark && <span style={{ whiteSpace: 'pre-wrap' }}>{t('备注', 'Remark')}: {h.data.remark}</span>}
              {(h.data.receipts || []).length > 0 && (
                <span>{t('收料记录', 'Records')}: {(h.data.receipts || []).map((r) => `${r.date || '—'} ${r.fileName || ''}`.trim()).join(' · ')}</span>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
const historyEn = (h: { k: string; cell?: string }) => ({
  'mig050.merge': `Duplicate merged at go-live; this version${h.cell ? ` (${h.cell})` : ''} was not kept and is saved here.`,
  'mode.sync': `Synced again; the ${h.cell || 'other'} version was not kept and is saved here.`,
  'mode.sep': 'Switched to filling separately per service — each started with a copy.',
  'cell.drop': `The ${h.cell || ''} cell was removed (instance deleted / one service left); its content is saved here.`,
  'cell.import': 'An imported cell clashed with an existing one; the imported version is saved here.',
} as Record<string, string>)[h.k] || 'History entry';

/* REQ-050: 改回同步 —— 选以哪个业务那份为准,其余的进修改记录 */
function SyncPickModal({ p, it, onClose }: { p: Project; it: ChecklistItem; onClose: () => void }) {
  const { dispatch } = useStore();
  const { lang, t } = useLang();
  const keys = Object.keys(it.cells || {});
  const [from, setFrom] = useState(keys[0]);
  const [busy, setBusy] = useState(false);
  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth: 560 }} data-testid="cl-sync-modal">
        <h2>{t('改回同步', 'Sync again')} · {lang === 'zh' ? it.zh : it.en || it.zh}</h2>
        <div className="msub">{t('几个业务改回共用一份。选以哪个业务那份为准;其余几份的内容和收料记录原样留在这一项的修改记录里,不会丢。',
          'The services will share one record again. Pick the version to keep; the others (with their records) stay in this item’s history.')}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, margin: '12px 0 16px' }}>
          {keys.map((k) => {
            const c = it.cells![k];
            return (
              <label key={k} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 10px', border: `1px solid ${from === k ? 'var(--navy700)' : 'var(--border)'}`, borderRadius: 8, cursor: 'pointer' }}>
                <input type="radio" name="cl-sync-from" checked={from === k} onChange={() => setFrom(k)} data-testid={`cl-sync-from-${k}`} />
                <b style={{ minWidth: 80 }}>{cellLabel(p, k, lang)}</b>
                <Pill m={CM[c.status]} />
                <span style={{ fontSize: 12, color: 'var(--text2)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {[c.received, c.remark].filter(Boolean).join(' · ') || '—'} · {t(`${(c.receipts || []).length} 条记录`, `${(c.receipts || []).length} records`)}
                </span>
              </label>
            );
          })}
        </div>
        <div className="modal-actions">
          <button className="btn-line" onClick={onClose}>{t('取消', 'Cancel')}</button>
          <button className="btn-navy" disabled={busy} data-testid="cl-sync-go"
            onClick={async () => { setBusy(true); const ok = await dispatch(p.id, { type: 'setClMode', item: it.id!, mode: 'sync', from }); setBusy(false); if (ok) onClose(); }}>
            {t(`以「${cellLabel(p, from, 'zh')}」为准,改回同步`, `Keep ${cellLabel(p, from, 'en')} and sync`)}
          </button>
        </div>
      </div>
    </div>
  );
}
