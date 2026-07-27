'use client';

/* ===== Procedural placeholder "render" =====
   There is no real render farm behind this prototype, so shot thumbnails are
   generated as deterministic inline SVG (seeded by shot.seed) rather than
   loaded from a renderer — massing silhouette + sky/ambient gradient vary by
   lighting preset and camera azimuth/elevation so cards still read as
   distinct "angles" on a Shot Board. */

import React from 'react';
import { LIGHTING_PRESETS, mulberry32 } from '@/lib/archviz/mockData';
import type { Shot } from '@/lib/archviz/types';

export function ShotThumb({ shot, className }: { shot: Shot; className?: string }) {
  const preset = LIGHTING_PRESETS.find((p) => p.id === shot.lighting.presetId) || LIGHTING_PRESETS[0];
  const rnd = mulberry32(shot.seed);
  const uid = shot.id.replace(/[^a-zA-Z0-9]/g, '');

  const azimuth = shot.camera.position[0] === 0 && shot.camera.position[2] === 0
    ? 0 : (Math.atan2(shot.camera.position[2], shot.camera.position[0]) * 180) / Math.PI;
  const sunX = 50 + 42 * Math.cos((azimuth * Math.PI) / 180);
  const sunElev = preset.params.sunElevation ?? 30;
  const sunY = 62 - (sunElev / 90) * 46;

  const GROUND_Y = 48;
  const blocks = Array.from({ length: 2 + Math.floor(rnd() * 3) }, () => {
    const w = 10 + rnd() * 22;
    const bh = 12 + rnd() * 26;
    const x = rnd() * (100 - w);
    return { x, w, h: bh, y: GROUND_Y - bh };
  }).sort((a, b) => a.x - b.x);

  const isExterior = preset.type === 'exterior';
  const isDusk = preset.id.includes('dusk');

  return (
    <svg viewBox="0 0 100 62" className={className} preserveAspectRatio="xMidYMid slice" role="img" aria-label="shot preview">
      <defs>
        <linearGradient id={`sky_${uid}`} x1="0" y1="0" x2="0" y2="1">
          {isExterior ? (
            isDusk ? (
              <>
                <stop offset="0%" stopColor="#2b3a67" />
                <stop offset="45%" stopColor="#8a5a7a" />
                <stop offset="75%" stopColor="#e8985a" />
                <stop offset="100%" stopColor="#f6c98a" />
              </>
            ) : (
              <>
                <stop offset="0%" stopColor="#6fb3e0" />
                <stop offset="55%" stopColor="#bfe0ef" />
                <stop offset="100%" stopColor="#eef6f3" />
              </>
            )
          ) : (
            <>
              <stop offset="0%" stopColor="#3a2a1c" />
              <stop offset="55%" stopColor="#6b4527" />
              <stop offset="100%" stopColor="#c98b46" />
            </>
          )}
        </linearGradient>
        <radialGradient id={`glow_${uid}`} cx={`${isExterior ? sunX : 50}%`} cy={`${isExterior ? sunY : 30}%`} r="55%">
          <stop offset="0%" stopColor={isExterior ? '#fff6dd' : '#ffd9a0'} stopOpacity="0.85" />
          <stop offset="100%" stopColor={isExterior ? '#fff6dd' : '#ffd9a0'} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`ground_${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={isExterior ? '#d8dad2' : '#4a3421'} />
          <stop offset="100%" stopColor={isExterior ? '#b7bab0' : '#2a1c11'} />
        </linearGradient>
      </defs>

      <rect x="0" y="0" width="100" height="62" fill={`url(#sky_${uid})`} />
      <rect x="0" y="0" width="100" height="62" fill={`url(#glow_${uid})`} />

      {isExterior && <circle cx={sunX} cy={sunY} r="3.2" fill={isDusk ? '#ffcf8f' : '#fff8e6'} opacity="0.9" />}

      <rect x="0" y={GROUND_Y} width="100" height={62 - GROUND_Y} fill={`url(#ground_${uid})`} />

      {blocks.map((b, i) => (
        <g key={i}>
          {/* faint contact shadow, cast away from the sun */}
          {isExterior && (
            <ellipse
              cx={b.x + b.w / 2 + (sunX > 50 ? -1 : 1) * 4}
              cy={GROUND_Y + 1.2}
              rx={b.w * 0.7}
              ry={1.4}
              fill="#000"
              opacity={0.12}
            />
          )}
          <rect x={b.x} y={b.y} width={b.w} height={b.h} fill={isExterior ? '#eceeea' : '#5d4530'} opacity={0.94} />
          {/* window grid hint */}
          {gridLines(b).map((ln, j) => (
            <line key={j} x1={ln.x} y1={b.y + 2} x2={ln.x} y2={b.y + b.h - 2} stroke={isExterior ? '#c7cbc3' : '#3a2a1a'} strokeWidth="0.4" opacity="0.5" />
          ))}
        </g>
      ))}

      {!isExterior && (
        <>
          <circle cx="30" cy="10" r="1.3" fill="#ffe3b0" opacity={(preset.params.keyLightIntensity ?? 0.5) + 0.2} />
          <circle cx="70" cy="9" r="1.3" fill="#ffe3b0" opacity={(preset.params.keyLightIntensity ?? 0.5) + 0.2} />
          <rect x="0" y="6" width="100" height="1.2" fill="#ffd7a0" opacity={preset.params.coveIntensity ?? 0.6} />
        </>
      )}
    </svg>
  );
}

function gridLines(b: { x: number; w: number }) {
  const n = Math.max(1, Math.floor(b.w / 4));
  return Array.from({ length: n - 1 }, (_, i) => ({ x: b.x + ((i + 1) * b.w) / n }));
}
