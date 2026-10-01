'use client';

/* ===== AV-016 ② · 05 的草稿提示(四条业务线共用)=====
   原型 0930:右上角「● 正在保存草稿…」→「✓ 草稿已自动保存 · 19:32」;再次打开时
   「已恢复你 19:32 的草稿;正式版本 v1(28-Sep 由 PD 保存)」;别人打开看到的是正式
   版本,并提示「Skye 有未保存的草稿(今天 16:20)」;「放弃草稿」回到最新正式版本。 */

import React from 'react';

import { useLang } from '@/lib/i18n';
import { fmtDate } from '@/lib/project';

/* 「今天 16:20」/「28-Sep 16:20」 */
export function stamp(at: number, lang: string) {
  const d = new Date(at);
  const hm = d.toTimeString().slice(0, 5);
  const today = new Date().toDateString() === d.toDateString();
  return today ? (lang === 'zh' ? `今天 ${hm}` : `today ${hm}`) : `${fmtDate(d).slice(0, 6)} ${hm}`;
}

export default function DraftNotice({ testid, saved, restored, state, saving, cleared = false, onDiscard }: {
  testid: string;
  saved: { version: number; savedBy: string; savedAt: number; draft: { updatedAt: number } | null; others: { by: string; at: number }[] };
  restored: boolean;                       // 这次打开是从我的草稿恢复的
  state: { at: number; error: string } | null;
  saving: boolean;
  cleared?: boolean;                       // 我的草稿已经没了(改回正式版本 / 放弃 / 存成正式版本)
  onDiscard: (() => void) | null;          // 没有正式版本可回 / 没权限时为 null
}) {
  const { t, lang } = useLang();
  const formal = saved.version > 0
    ? t(`正式版本 v${saved.version}（${saved.savedAt ? fmtDate(new Date(saved.savedAt)).slice(0, 6) : '—'} 由 ${saved.savedBy || '—'} 保存）`,
      `saved version v${saved.version} (${saved.savedAt ? fmtDate(new Date(saved.savedAt)).slice(0, 6) : '—'} by ${saved.savedBy || '—'})`)
    : t('还没有正式版本', 'no saved version yet');
  const restoredLive = restored && !!saved.draft && !cleared;
  const mine = !!state?.at || restoredLive;
  /* 我的草稿之后,有人又存了正式版本:恢复的是旧草稿,要说清楚(复查 #68) */
  const outdated = restoredLive && !state?.at && saved.version > 0 && saved.savedAt > (saved.draft?.updatedAt ?? 0);
  return (
    <>
      {saving ? (
        <span style={{ color: 'var(--warning)' }} data-testid={testid}>{t('● 正在保存草稿…', '● Saving draft…')}</span>
      ) : state?.at ? (
        <span style={{ color: 'var(--success)' }} data-testid={testid}>
          {t(`✓ 草稿已自动保存 · ${new Date(state.at).toTimeString().slice(0, 5)}`, `✓ Draft saved automatically · ${new Date(state.at).toTimeString().slice(0, 5)}`)}
        </span>
      ) : restoredLive && saved.draft ? (
        <span style={{ color: outdated ? 'var(--warning)' : 'var(--success)' }} data-testid={testid}>
          {t(`已恢复你 ${stamp(saved.draft.updatedAt, lang)} 的草稿；${formal}。`, `Restored your draft from ${stamp(saved.draft.updatedAt, lang)}; ${formal}.`)}
          {outdated && <b data-testid={`${testid}-outdated`}>{t(
            ` 注意：你的草稿是在 v${saved.version} 之前改的，继续保存会以你的草稿为准；想看 v${saved.version} 请点「放弃草稿」。`,
            ` Note: your draft predates v${saved.version}; saving keeps your draft. Discard it to see v${saved.version}.`)}</b>}
        </span>
      ) : null}
      {mine && onDiscard && !saving && (
        <button style={{ fontSize: 12, textDecoration: 'underline', color: 'var(--text2)' }} onClick={onDiscard} data-testid={`${testid}-discard`}>
          {t(`放弃草稿，回到正式版本 v${saved.version}`, `Discard the draft, back to v${saved.version}`)}
        </button>
      )}
      {state?.error && <span style={{ color: 'var(--danger)' }} data-testid={`${testid}-error`}>{state.error}</span>}
      {saved.others.map((o) => (
        <span key={o.by + o.at} style={{ color: 'var(--text2)' }} data-testid={`${testid}-others`}>
          {t(`${o.by} 有未保存的草稿（${stamp(o.at, lang)}）`, `${o.by} has an unsaved draft (${stamp(o.at, lang)})`)}
          {!mine && !saving && saved.version > 0 ? t(`；你看到的是正式版本 v${saved.version}。`, `; you are looking at v${saved.version}.`) : ''}
        </span>
      ))}
    </>
  );
}
