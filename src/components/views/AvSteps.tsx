'use client';

/* The AV platform's step bar (01 → 07), shown on each AV screen. */

import React from 'react';
import { useLang } from '@/lib/i18n';
import { useStore, type View } from '../store';

type Step = { no: string; zh: string; en: string; view: View['name']; sub?: string };

/* 0929 改版:05 的四条业务线合成了一页,06 与 07 合成了一页两个标签,
   所以这里指向合并后的页面(带上要落到哪个标签)。 */
const STEPS: Step[] = [
  { no: '01', zh: '立项询价', en: 'Inquiry', view: 'avinquiry' },
  { no: '02–04', zh: '图纸 · 解析 · 校核', en: 'Drawings & review', view: 'ledingest' },
  { no: '05', zh: '方案配置', en: 'Configuration', view: 'avconfig' },
  { no: '06', zh: '成本核算', en: 'Costing', view: 'avcostquote', sub: 'cost' },
  { no: '07', zh: '报价审批', en: 'Quotation', view: 'avcostquote', sub: 'quote' },
];

/* 合并页自己带面包屑 + 页内标签,再叠一条七步条就太满了 —— 那几页不显示。
   还留着它的是「立项询价」和「图纸校核」,那两页不在壳里。 */
const SHELLED: View['name'][] = ['avhome', 'avconfig', 'avcostquote', 'avlibrary'];

/* 05 is one step with one screen per business line */
const STUDIOS: View['name'][] = ['ledstudio', 'prjstudio', 'elvstudio', 'pvstudio'];

export default function AvSteps() {
  const { view, setView } = useStore();
  const { t } = useLang();
  if (SHELLED.includes(view.name)) return null;
  return (
    <nav aria-label={t('AV 方案流程', 'AV workflow')}
      style={{ display: 'flex', gap: 4, flexWrap: 'wrap', background: 'var(--card)', border: '1px solid var(--border)',
        borderRadius: 10, padding: 4, marginBottom: 20 }}>
      {STEPS.map((s) => {
        const on = s.view === view.name || (s.view === 'avconfig' && STUDIOS.includes(view.name));
        return (
          <button key={s.no} onClick={() => setView({ name: s.view, sub: s.sub })}
            style={{
              flex: '1 1 150px', textAlign: 'left', padding: '8px 12px', borderRadius: 7, border: 0,
              background: on ? 'var(--navy900)' : 'transparent', color: on ? '#fff' : 'var(--text)', cursor: 'pointer', font: 'inherit',
            }}>
            <span className="tnum" style={{ fontSize: 11, fontWeight: 700, opacity: 0.8 }}>{s.no}</span>{' '}
            <span style={{ fontSize: 13, fontWeight: 600 }}>{t(s.zh, s.en)}</span>
          </button>
        );
      })}
      {/* 业务线切换归页内标签管了(AvShell),这里不再重复一排 */}
    </nav>
  );
}
