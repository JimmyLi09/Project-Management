/* ===== REQ-049 上线迁移:旧登记表字段 → Job Record 4 栏行 =====
   服务端第一次启动时跑一次(server/db.ts,meta 记 mig.req049.jobRecord),先整库备份,出报告。
   这里是单个项目的纯逻辑,单元测试直接测。

   每份业务(服务包)里 pk.record 有值的字段,一个字段转成一行:
     Service Item = 业务英文名(Perspectives / LED Display …)
     Detail       = 字段名(「中文 English」;同类两份时前面带实例名,如「LED ② · 尺寸 Dimension」)
     Quantity     = 数量类的值(数字字段、名字叫数量 / Quantity 的、或值本身像「2」「180s」「1 set」)
     Special Notes = 其余的值(下拉显示选项名)
   排期页那张「服务内容 / 交付清单」(pk.scopeItems:item / qty / note)也是报价单上的东西,一条转成一行。
   不转的:状态、更新时间(结构性的)、公式字段(由别的字段算出来)、项目名 / 客户联系人 / 交付日
   (这三项其实存在项目上,项目页里一直看得到)。
   原数据一个不动:pk.record、pk.scopeItems 原样留着,Job Record 下方「旧字段(只读)」照旧能看。 */

import { ensureJobRows, jobRowId, serviceItemOf } from './jobRecord';
import { optionLabel, projSourceOf, type FieldDef } from './records';
import type { JobRow, Project } from './types';

const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];
const looksQty = (v: string) => /^\s*\d+([.,]\d+)?\s*(x|×|pcs?|nos?\.?|sets?|spots?|s|sec|min(ute)?s?|m|mm|cm|sqm|m2|㎡|units?|个|套|块|台|张|秒|分钟|部)?\s*$/i.test(v);
const isQtyField = (f: FieldDef) => f.type === 'number' || /^(quantity|qty|数量)$/i.test(f.en || '') || /^(quantity|qty)$/i.test(f.key) || /数量/.test(f.zh || '');

export interface Mig049Entry { project: string; rows: number; bySvc: Record<string, number> }

export function migrateProject049(p: Project, defsFor: (svc: string) => FieldDef[], at: number): Mig049Entry | null {
  if (Array.isArray(p.jobRecord)) return null;   // 已经有了(新建的项目 / 迁移过)
  const rows: JobRow[] = [];
  const bySvc: Record<string, number> = {};
  (p.packages || []).forEach((pk) => {
    const same = p.packages.filter((x) => x.svc === pk.svc);
    const inst = pk.label || (same.length > 1 ? `${serviceItemOf(pk.svc)} ${CIRCLED[same.indexOf(pk)] || '#' + (same.indexOf(pk) + 1)}` : '');
    const item = serviceItemOf(pk.svc);
    const rec = pk.record || {};
    const fields = defsFor(pk.svc);
    const push = (detail: string, qty: string, note: string) => {
      rows.push({ id: jobRowId(), svc: pk.svc, item, detail: (inst ? `${inst} · ` : '') + detail, qty, note });
      bySvc[pk.svc] = (bySvc[pk.svc] || 0) + 1;
    };
    const seen = new Set<string>();
    for (const f of fields) {
      seen.add(f.key);
      if (f.type === 'formula' || projSourceOf(f.key)) continue;
      const raw = rec[f.key];
      if (raw === undefined || raw === null || String(raw).trim() === '') continue;
      const v = f.type === 'select' ? optionLabel(f, String(raw), 'zh') : String(raw).trim();
      /* 字段名中英都带上;中文名里本来就带英文的(「Model Maker 模型师」「Length 长 (mm)」)不再重复 */
      const zh = (f.zh || '').trim(), en = (f.en || '').trim();
      const name = zh && en && !/[A-Za-z]{3,}/.test(zh) && !en.includes(zh) ? `${zh} ${en}` : zh || en || f.key;
      if (isQtyField(f) || looksQty(v)) push(name, v, ''); else push(name, '', v);
    }
    /* 字段定义里已经没有、但值还存着的(PD 删过的列):照样转,字段名用 key */
    for (const [k, raw] of Object.entries(rec)) {
      if (seen.has(k) || k === 'status' || k === 'updatedAt' || projSourceOf(k)) continue;
      const v = String(raw ?? '').trim();
      if (!v) continue;
      if (looksQty(v)) push(k, v, ''); else push(k, '', v);
    }
    for (const s of pk.scopeItems || []) {
      if (!s.item && !s.qty && !s.note) continue;
      push(s.item || '', s.qty || '', s.note || '');
    }
  });
  p.jobRecord = rows;
  const added = ensureJobRows(p);   // 一个值都没有的业务:给 1 行预填业务名
  p.mig049 = { at, rows: rows.length - added };
  return { project: p.name, rows: rows.length - added, bySvc };
}
