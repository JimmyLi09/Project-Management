/* ===== REQ-042: 收料记录 =====

   一个信息项下面挂一串收料记录,按时间倒序,第 0 条就是 Latest。
   追加**不覆盖**:收到 v02 是新增一条,v01 还在历史里。

   和老字段的关系(很重要,别改坏):
   item 上原来的 status / date / received / remark 四个字段全平台都在读
   (导出、KPI、进度统计、对外清单),所以它们保留,并且**永远跟着 Latest 走** ——
   追加 / 编辑 / 删除记录之后都要重新同步一次。这样老代码一行不用改,
   新功能也拿得到完整历史。 */

import type { ChecklistItem, ChecklistStatus, ReceiptRecord } from './types';

export const RECEIVE_VIA: [string, string, string][] = [
  ['email', 'Email 邮件', 'Email'],
  ['whatsapp', 'WhatsApp', 'WhatsApp'],
  ['wechat', '微信', 'WeChat'],
  ['server', '服务器 / 网盘', 'Server / cloud drive'],
  ['usb', 'U 盘 / 硬盘', 'USB / drive'],
  ['inperson', '当面交付', 'In person'],
  ['other', '其他', 'Other'],
];
export const viaName = (k: string, lang: 'zh' | 'en') => {
  const f = RECEIVE_VIA.find((x) => x[0] === k);
  return f ? (lang === 'zh' ? f[1] : f[2]) : k;
};

export const newReceiptId = () => 'rc' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/* 排序:日期倒序,同一天按录入时间倒序。返回新数组,不改原数组。 */
export function sortReceipts(list: ReceiptRecord[]): ReceiptRecord[] {
  return [...list].sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.at || 0) - (a.at || 0));
}

export const latestOf = (it: ChecklistItem): ReceiptRecord | undefined => (it.receipts || [])[0];

/* 老数据 → 第一条记录。
   只有真的收到过东西(有文件名 / 日期 / 备注,或状态已经不是 pending)才生成,
   否则一个空项会凭空多出一条什么都没有的「记录」。 */
export function seedReceipt(it: ChecklistItem): ReceiptRecord | null {
  const has = !!(it.received?.trim() || it.date?.trim() || it.remark?.trim() || (it.status && it.status !== 'pending'));
  if (!has) return null;
  return {
    id: newReceiptId(),
    date: it.date || '',
    fileName: it.received || '',
    from: '',
    via: '',
    path: '',
    status: it.status || 'pending',
    remark: it.remark || '',
    at: it.updatedAt || 0,
    by: '',
  };
}

/* 把 Latest 同步回 item 的老字段。每次动过 receipts 都要调一次。 */
export function syncFromLatest(it: ChecklistItem) {
  const l = latestOf(it);
  if (!l) return;
  it.status = l.status;
  it.date = l.date;
  it.received = l.fileName;
  /* 备注**不同步**。这是两个不同的东西:
     - it.remark   清单项备注 —— 对外清单和导出里都会出现,是给顾问 / 客户看的;
     - 记录里的备注 —— 内部的,说这一版为什么退回、缺哪张图之类。
     早先把后者同步进前者,结果内部备注跟着对外清单漏出去了。分开。 */
}

/* 反方向:有人在清单行上直接改了「状态 / 收到内容 / 日期 / 备注」(老的那套快捷编辑),
   把这次改动落到 Latest 上 —— 一条都没有就现开一条。
   不这么做的话两套表示会分叉:行上写着「已收到 CAD_v01」,展开记录却是空的。 */
export function syncToLatest(it: ChecklistItem, by: string) {
  if (!Array.isArray(it.receipts)) it.receipts = [];
  const l = it.receipts[0];
  if (!l) {
    const seed = seedReceipt(it);
    if (seed) { seed.by = by; seed.at = Date.now(); it.receipts = [seed]; }
    return;
  }
  l.status = it.status;
  l.date = it.date || '';
  l.fileName = it.received || '';
  /* 同上:清单项备注不往记录里灌,两边各管各的 */
}

/* 清洗一条来自浏览器的记录输入 */
export function cleanReceipt(raw: Partial<ReceiptRecord>, by: string, keepId?: string): ReceiptRecord {
  const s = (v: unknown, n: number) => String(v ?? '').trim().slice(0, n);
  return {
    id: keepId || newReceiptId(),
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(raw.date || '')) ? String(raw.date) : '',
    fileName: s(raw.fileName, 300),
    from: s(raw.from, 120),
    via: s(raw.via, 40),
    path: s(raw.path, 500),
    status: (raw.status || 'received') as ChecklistStatus,
    remark: s(raw.remark, 1000),
    at: Date.now(),
    by: s(by, 60),
  };
}
