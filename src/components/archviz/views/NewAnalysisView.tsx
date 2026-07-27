'use client';

import React, { useRef, useState } from 'react';
import { useLang } from '@/lib/i18n';
import { LIGHTING_PRESETS } from '@/lib/archviz/mockData';
import { useArchviz } from '../store';

const ALLOWED_EXT = ['skp', 'max'];

export default function NewAnalysisView() {
  const { t } = useLang();
  const { startAnalysis, busy, error } = useArchviz();
  const [name, setName] = useState('');
  const [presetIds, setPresetIds] = useState<string[]>([]);
  const [file, setFile] = useState<File>();
  const [fileError, setFileError] = useState<string>();
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const togglePreset = (id: string) => {
    setPresetIds((ids) => (ids.includes(id) ? ids.filter((i) => i !== id) : [...ids, id]));
  };

  const handleFiles = (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    const ext = (f.name.split('.').pop() || '').toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) {
      setFile(undefined);
      setFileError(t('不支持的文件格式 — 仅支持 .skp / .max，请重新选择', 'Unsupported file type — only .skp / .max are accepted, choose another file'));
      return;
    }
    setFileError(undefined);
    setFile(f);
    if (!name) setName(f.name.replace(/\.[^.]+$/, ''));
  };

  const canSubmit = !!file && presetIds.length > 0 && !busy;

  return (
    <div className="avd-screen avd-narrow">
      <div className="avd-panel">
        <div className="avd-panel-head">
          <div className="avd-panel-title">1. {t('上传模型', 'Upload model')}</div>
          <div className="avd-panel-sub">{t('SketchUp (.skp) 或 3ds Max (.max) 源文件', 'SketchUp (.skp) or 3ds Max (.max) source file')}</div>
        </div>
        <div className="avd-panel-body">
          <button
            type="button"
            className={`avd-dropzone ${file ? 'done' : ''} ${fileError ? 'error' : ''} ${dragOver ? 'dragover' : ''}`}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
          >
            <input
              ref={inputRef} type="file" accept=".skp,.max" style={{ display: 'none' }}
              onChange={(e) => handleFiles(e.target.files)}
            />
            {file ? (
              <>
                <div className="avd-dropzone-icon">✓</div>
                <div>{file.name}</div>
                <div className="avd-dropzone-sub">{t('包围盒 / 楼层 / 入口 / 主立面 / 地面 已识别', 'Bounding box / floors / entrance / facade / ground detected')}</div>
              </>
            ) : fileError ? (
              <>
                <div className="avd-dropzone-icon">✕</div>
                <div className="avd-dropzone-err">{fileError}</div>
              </>
            ) : (
              <>
                <div className="avd-dropzone-icon">＋</div>
                <div>{t('点击或拖拽上传 .skp / .max 文件', 'Click or drag to upload a .skp / .max file')}</div>
                <div className="avd-dropzone-sub">{t('渲染节点需装有对应软件与授权', 'Render node must have the matching DCC + license')}</div>
              </>
            )}
          </button>

          <div className="avd-row">
            <div className="avd-field">
              <label>{t('模型名称', 'Model name')}</label>
              <input className="avd-input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('例如：滨江综合体 A 栋', 'e.g. Riverside Complex — Tower A')} />
            </div>
          </div>
        </div>
      </div>

      <div className="avd-panel">
        <div className="avd-panel-head">
          <div className="avd-panel-title">2. {t('选择灯光预设', 'Select lighting presets')}</div>
          <div className="avd-panel-sub">{t('可多选：多预设将各渲一组，用于 Relight 对比', 'Multi-select: each renders its own pass, for Relight comparison')}</div>
        </div>
        <div className="avd-panel-body">
          <div className="avd-preset-grid">
            {LIGHTING_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`avd-preset-card ${presetIds.includes(p.id) ? 'active' : ''}`}
                onClick={() => togglePreset(p.id)}
              >
                <div className="avd-preset-swatch" data-preset={p.id} />
                <div className="avd-preset-name">{t(p.name[0], p.name[1])}</div>
                <div className="avd-preset-blurb">{t(p.blurb[0], p.blurb[1])}</div>
                <div className="avd-preset-params">
                  {p.type === 'exterior'
                    ? `${t('方位', 'Az')} ${p.params.sunAzimuth}° · ${t('高度角', 'El')} ${p.params.sunElevation}°`
                    : `${p.params.colorTempK}K · ${t('间接', 'cove')} ${Math.round((p.params.coveIntensity ?? 0) * 100)}%`}
                </div>
                <div className={`avd-preset-check ${presetIds.includes(p.id) ? 'on' : ''}`}>{presetIds.includes(p.id) ? '✓' : ''}</div>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="avd-actions-row">
        <div className="avd-hint">
          {error ? <span style={{ color: 'var(--avd-danger)' }}>{error}</span> : null}
        </div>
        <button
          className="avd-btn-primary"
          disabled={!canSubmit}
          onClick={() => file && startAnalysis(file, name, presetIds)}
        >
          {busy ? t('上传中…', 'Uploading…') : t('开始智能选角', 'Start Smart Shot Analysis')}
        </button>
      </div>
    </div>
  );
}
