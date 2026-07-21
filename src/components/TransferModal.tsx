'use client';

/* Handover dialog — single-project or batch (all projects of a person). */

import React, { useState } from 'react';
import { useStore } from './store';
import { useLang } from '@/lib/i18n';

export default function TransferModal({ from, pid, onClose }: {
  from: string;
  pid?: string; // set = transfer this project only; unset = batch (all projects)
  onClose: () => void;
}) {
  const { users, dispatch, refresh } = useStore();
  const { t } = useLang();
  const [to, setTo] = useState('');
  const [includeTasks, setIncludeTasks] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const candidates = users
    .map((u) => u.name)
    .filter((n) => n !== from);

  async function submit() {
    const target = to.trim();
    if (!target) { setMsg(t('请选择接收人', 'Pick a recipient')); return; }
    setBusy(true);
    setMsg('');
    if (pid) {
      const ok = await dispatch(pid, { type: 'transferProject', from, to: target, includeTasks });
      setBusy(false);
      if (ok) onClose();
    } else {
      const res = await fetch('/api/transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: target, includeTasks }),
      });
      setBusy(false);
      if (res.ok) {
        const { transferred } = await res.json();
        await refresh();
        alert(t(`已转交 ${transferred} 个项目:${from} → ${target}`, `Transferred ${transferred} project(s): ${from} → ${target}`));
        onClose();
      } else {
        const body = await res.json().catch(() => ({}));
        setMsg(body.error || t('转交失败', 'Transfer failed'));
      }
    }
  }

  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth: 440 }}>
        <h2>{t('项目转交', 'Project Handover')}</h2>
        <div className="msub">
          {pid
            ? t('将本项目的负责权从转出人移交给接收人。', 'Move this project from one person to another.')
            : t(`将 ${from} 名下的全部项目(含服务包负责)一次性移交。适用于休假或离职。`, `Move all of ${from}'s projects at once. For vacations or departures.`)}
        </div>
        {msg && <div className="login-err">{msg}</div>}
        <div className="field">
          <label>{t('转出人 From', 'From')}</label>
          <input value={from} disabled />
        </div>
        <div className="field">
          <label>{t('接收人 To', 'To')}</label>
          <input list="transfer-names" value={to} onChange={(e) => setTo(e.target.value)} placeholder={candidates.slice(0, 3).join(' / ')} autoFocus />
          <datalist id="transfer-names">{candidates.map((n) => <option key={n} value={n} />)}</datalist>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 14, cursor: 'pointer' }}>
          <input type="checkbox" checked={includeTasks} onChange={(e) => setIncludeTasks(e.target.checked)} />
          {t('同时把排期中指派给转出人的任务(👤)改为接收人', 'Also move schedule tasks assigned (👤) to them')}
        </label>
        <div className="modal-actions">
          <button className="btn-line" onClick={onClose}>{t('取消', 'Cancel')}</button>
          <button className="btn-navy" onClick={submit} disabled={busy}>{busy ? t('转交中…', 'Transferring…') : t('确认转交', 'Transfer')}</button>
        </div>
      </div>
    </div>
  );
}
