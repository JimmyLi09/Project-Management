'use client';

import React, { useState } from 'react';
import { useLang } from '@/lib/i18n';
import { LIGHTING_PRESETS } from '@/lib/archviz/mockData';
import type { Dcc } from '@/lib/archviz/types';
import { useArchviz } from '../store';

export default function NewAnalysisView() {
  const { t } = useLang();
  const { startAnalysis, runs } = useArchviz();
  const [name, setName] = useState('');
  const [dcc, setDcc] = useState<Dcc>('sketchup');
  const [presetIds, setPresetIds] = useState<string[]>([LIGHTING_PRESETS[0].id]);
  const [uploaded, setUploaded] = useState(false);

  const togglePreset = (id: string) => {
    setPresetIds((ids) => (ids.includes(id) ? ids.filter((i) => i !== id) : [...ids, id]));
  };

  const canSubmit = uploaded && presetIds.length > 0;

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
            className={`avd-dropzone ${uploaded ? 'done' : ''}`}
            onClick={() => { setUploaded(true); if (!name) setName(t('未命名建筑模型', 'Untitled Building Model')); }}
          >
            {uploaded ? (
              <>
                <div className="avd-dropzone-icon">✓</div>
                <div>{t('模型已解析', 'Model parsed')}</div>
                <div className="avd-dropzone-sub">{t('包围盒 / 楼层 / 入口 / 主立面 / 地面 已识别', 'Bounding box / floors / entrance / facade / ground detected')}</div>
              </>
            ) : (
              <>
                <div className="avd-dropzone-icon">＋</div>
                <div>{t('点击上传 .skp / .max 文件（演示：模拟上传）', 'Click to upload .skp / .max (demo: simulated upload)')}</div>
                <div className="avd-dropzone-sub">{t('渲染节点需装有对应软件与授权', 'Render node must have the matching DCC + license')}</div>
              </>
            )}
          </button>

          <div className="avd-row">
            <div className="avd-field">
              <label>{t('模型名称', 'Model name')}</label>
              <input className="avd-input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('例如：滨江综合体 A 栋', 'e.g. Riverside Complex — Tower A')} />
            </div>
            <div className="avd-field">
              <label>{t('源软件', 'Source DCC')}</label>
              <select className="avd-input" value={dcc} onChange={(e) => setDcc(e.target.value as Dcc)}>
                <option value="sketchup">SketchUp</option>
                <option value="3dsmax">3ds Max</option>
              </select>
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
          {runs.length > 0 && t(`已有 ${runs.length} 次历史分析`, `${runs.length} previous analysis run(s)`)}
        </div>
        <button
          className="avd-btn-primary"
          disabled={!canSubmit}
          onClick={() => startAnalysis(name, dcc, presetIds)}
        >
          {t('开始智能选角', 'Start Smart Shot Analysis')}
        </button>
      </div>
    </div>
  );
}
