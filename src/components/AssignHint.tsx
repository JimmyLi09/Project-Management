'use client';

/* ===== REQ-062 · 派项目限制的前端提示 =====
   选负责 PM(指派、新建项目、交接、转交)时先问 /api/assign-check:
   没到「可协助」→ 开关开着:按钮不可点 + 红字原因;关着:黄字提醒。
   只到「可协助」→ 黄字「建议再指定一位可独立的 PM」。真正的拦在保存的接口里。 */
import React, { useEffect, useState } from 'react';
import { useLang } from '@/lib/i18n';
import { bizLabel } from '@/lib/train';

export interface CheckRes { blocked: boolean; kind: 'skip' | 'ok' | 'below' | 'assistOnly'; biz?: string }

export function useAssignCheck(arg: { pid?: string; svcs?: string[]; pkgSvc?: string }, names: string[]) {
  const [state, setState] = useState<{ gate: boolean; results: Record<string, CheckRes> }>({ gate: false, results: {} });
  const key = JSON.stringify([arg.pid || '', arg.svcs || [], arg.pkgSvc || '', [...new Set(names.filter(Boolean))].sort()]);
  useEffect(() => {
    const list = [...new Set(names.filter(Boolean))];
    if (!list.length) { setState((s) => ({ ...s, results: {} })); return; }
    let alive = true;
    const t = setTimeout(async () => {
      const r = await fetch('/api/assign-check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...arg, names: list }) }).catch(() => null);
      if (!alive || !r || !r.ok) return;
      setState(await r.json());
    }, 200);
    return () => { alive = false; clearTimeout(t); };
  }, [key]);   // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}

export function gateText(name: string, r: CheckRes | undefined, gate: boolean, lang: 'zh' | 'en'): { tone: 'block' | 'warn'; text: string } | null {
  if (!r || r.kind === 'skip' || r.kind === 'ok') return null;
  const where = r.biz ? (lang === 'zh' ? bizLabel(r.biz, 'zh') : bizLabel(r.biz, 'en')) : '';
  if (r.kind === 'below') {
    const text = lang === 'zh'
      ? `${name}在${where || '这个项目的业务'}上还没到「可协助」,${r.biz ? '不能当这个服务包的负责人' : '不能指定为负责 PM。可以加为「跟项目」成员'}。${gate ? '' : '(派项目限制还没打开,这次只提醒。)'}`
      : `${name} has not reached “Can assist” in ${where || 'any service on this project'}${r.biz ? ', so cannot own this service' : ' and cannot be the lead PM — add them as a shadow member instead'}.${gate ? '' : ' (The assignment rule is off, so this is only a reminder.)'}`;
    return { tone: r.blocked ? 'block' : 'warn', text };
  }
  return { tone: 'warn', text: lang === 'zh'
    ? `${name}在${where || '这个项目的业务'}上只到「可协助」,建议再指定一位「可独立」的 PM 一起带。`
    : `${name} is only at “Can assist” in ${where || 'this project\'s services'} — consider adding an independent PM as well.` };
}

export function GateNote({ name, r, gate, testid }: { name: string; r: CheckRes | undefined; gate: boolean; testid?: string }) {
  const { lang } = useLang();
  const g = gateText(name, r, gate, lang);
  if (!g) return null;
  return (
    <div data-testid={testid || 'gate-note'} data-tone={g.tone}
      style={{ fontSize: 12, lineHeight: 1.6, marginTop: 6, padding: '6px 10px', borderRadius: 6,
        background: g.tone === 'block' ? '#fdecea' : '#fbf0dc', color: g.tone === 'block' ? '#98342b' : '#8a5a08' }}>
      {g.tone === 'block' ? '✗ ' : '⚠ '}{g.text}
    </div>
  );
}
