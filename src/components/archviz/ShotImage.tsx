'use client';

/* Real render when the backend has one (shot.imageUrl, served from
   src/app/api/archviz/frames/[id]/image), falling back to the procedural
   placeholder (ShotThumb) only if a shot somehow has no image yet. */

import React from 'react';
import type { Shot } from '@/lib/archviz/types';
import { ShotThumb } from './ShotThumb';

export function ShotImage({ shot, className }: { shot: Shot; className?: string }) {
  if (shot.imageUrl) return <img src={shot.imageUrl} alt="" className={className} />;
  return <ShotThumb shot={shot} className={className} />;
}
