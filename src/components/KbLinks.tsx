'use client';

import React, { useEffect, useState } from 'react';
import { useStore } from './store';
import { useLang } from '@/lib/i18n';
import type { KbDoc } from '@/lib/kb';

/* ===== REQ-035 内嵌调用 =====
   把挂在某个服务类型 / 工作流阶段上的知识库文档,就地列在那个位置 ——
   人在资料卡上干活时不该为了看一眼 SOP 跑去另一个模块翻。
   文档清单全局只取一次(多个卡片共用),取不到就整条不显示,绝不挡住主流程。 */
let cache: KbDoc[] | null = null;
let inflight: Promise<KbDoc[]> | null = null;
const subs = new Set<(d: KbDoc[]) => void>();

function loadDocs(): Promise<KbDoc[]> {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = fetch('/api/kb')
      .then((r) => (r.ok ? r.json() : { docs: [] }))
      .then((j) => {
        cache = (j.docs || []) as KbDoc[];
        subs.forEach((f) => f(cache!));
        return cache;
      })
      .catch(() => [] as KbDoc[])
      .finally(() => { inflight = null; });
  }
  return inflight;
}
/* 知识库那边改完文档要让这些位置跟着更新 */
export const invalidateKbCache = () => { cache = null; };

export default function KbLinks({ svc, stage, compact }: { svc?: string; stage?: string; compact?: boolean }) {
  const { go } = useStore();
  const { lang, t } = useLang();
  const [docs, setDocs] = useState<KbDoc[]>(cache || []);

  useEffect(() => {
    let alive = true;
    const on = (d: KbDoc[]) => { if (alive) setDocs(d); };
    subs.add(on);
    loadDocs().then(on);
    return () => { alive = false; subs.delete(on); };
  }, []);

  const hits = docs.filter((d) =>
    (svc && d.anchors.svc.includes(svc)) || (stage && d.anchors.stage.includes(stage)));
  if (!hits.length) return null;

  return (
    <div style={{
      display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap',
      padding: compact ? '7px 18px' : '9px 18px',
      borderTop: '1px solid var(--row-line)', background: 'var(--hover-bg)',
    }}>
      <span style={{ fontSize: 11.5, color: 'var(--text2)', fontWeight: 600 }}>📘 {t('相关文档', 'Related docs')}</span>
      {hits.slice(0, 6).map((d) => (
        <button key={d.id} className="badge"
          style={{ background: 'var(--card,#fff)', color: 'var(--info)', border: '1px solid var(--border)', cursor: 'pointer' }}
          title={t('在知识库中打开', 'Open in the knowledge base')}
          onClick={() => go('knowledge')}>
          {lang === 'zh' ? d.title : (d.titleEn || d.title)}
        </button>
      ))}
      {hits.length > 6 && <span style={{ fontSize: 11, color: 'var(--text2)' }}>+{hits.length - 6}</span>}
    </div>
  );
}
