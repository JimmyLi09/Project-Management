export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { currentUser } from '@/server/session';
import { getArchvizDb, uid } from '@/server/archviz/db';
import { mulberry32, hashSeed } from '@/lib/archviz/rng';
import { rowToModel } from '@/server/archviz/mapRow';

const ALLOWED_EXT = ['skp', 'max'];
const MAX_BYTES = 200 * 1024 * 1024; // 200MB — generous for a real .skp/.max, keeps SQLite blobs sane

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: '无效的上传请求' }, { status: 400 });
  const file = form.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: '缺少文件' }, { status: 400 });

  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (!ALLOWED_EXT.includes(ext)) {
    return NextResponse.json({ error: `不支持的文件格式 — 仅支持 .${ALLOWED_EXT.join(' / .')}` }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: '文件过大' }, { status: 400 });
  }

  const name = String(form.get('name') || file.name.replace(/\.[^.]+$/, ''));
  const dcc = ext === 'skp' ? 'sketchup' : '3dsmax';
  const seed = hashSeed(`${file.name}|${file.size}`);
  const rnd = mulberry32(seed);
  const floors = 3 + Math.floor(rnd() * 12);
  const buf = Buffer.from(await file.arrayBuffer());

  const db = getArchvizDb();
  const id = uid('model');
  db.prepare(`
    INSERT INTO models (id, name, dcc, original_filename, file_blob, status, seed, bbox_floors, created_at)
    VALUES (?, ?, ?, ?, ?, 'ready', ?, ?, ?)
  `).run(id, name, dcc, file.name, buf, seed, floors, Date.now());

  const row = db.prepare('SELECT * FROM models WHERE id = ?').get(id);
  return NextResponse.json({ model: rowToModel(row) });
}
