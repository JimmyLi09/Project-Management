/* AV-015 · 识别服务实测（在服务器上跑一次，把生成的记录发回来）

     scripts\vision-selftest.bat                 用 0930 弧形屏照片
     scripts\vision-selftest.bat D:\某张图.jpg    用你指定的图片

   走的是平台同一套提示词、JSON Schema 和确定性后处理（src/av/core/imagejudge.ts），
   只是不经过网页：直接问本机 Ollama，量时间，看 GPU / CPU，把结果写进
   data/vision-selftest-<时间>.md。只读，不改数据库。 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { asks, emptyReview, JUDGE_PROMPT, JUDGE_SCHEMA, normalise, type JudgeResult } from '../src/av/core/imagejudge.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const URL_ = process.env.AV_VISION_URL || 'http://127.0.0.1:11434';
const MODEL = process.env.AV_VISION_MODEL || 'qwen2.5vl:7b';
const TIMEOUT = Number(process.env.AV_VISION_TIMEOUT || 600) * 1000;
const image = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'services', 'drawing', 'tests', 'fixtures', 'vision', 'arc_photo_0930.jpg');
const isDefaultPhoto = !process.argv[2];

const out: string[] = [];
const say = (s = '') => { console.log(s); out.push(s); };
const get = async <T,>(p: string, init?: RequestInit, ms = 5000): Promise<T | null> => {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { const r = await fetch(URL_ + p, { ...init, signal: ctl.signal }); return r.ok ? await r.json() as T : null; }
  catch { return null; } finally { clearTimeout(t); }
};

async function shrink(buf: Buffer): Promise<Buffer> {
  try {
    const sharp = (await import('sharp')).default;
    return await sharp(buf).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' }).jpeg({ quality: 85 }).toBuffer();
  } catch { return buf; }
}

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
say(`# 识别服务实测记录 · ${new Date().toLocaleString('zh-CN')}`);
say();
say(`- 电脑：${os.hostname()} · ${os.cpus()[0]?.model ?? '?'} × ${os.cpus().length} · 内存 ${(os.totalmem() / 1e9).toFixed(0)} GB · ${os.type()} ${os.release()}`);
let gpu = '没检测到 NVIDIA 显卡（nvidia-smi 不可用）';
try { gpu = execFileSync('nvidia-smi', ['--query-gpu=name,memory.total,driver_version', '--format=csv,noheader'], { encoding: 'utf8', timeout: 8000 }).trim(); } catch { /* none */ }
say(`- 显卡：${gpu}`);
const ver = await get<{ version: string }>('/api/version');
if (!ver) {
  say(`- 识别服务：× 连不上 ${URL_}。先按《上线操作单》「识别服务（Ollama）」一节装好再跑。`);
  finish(1);
}
say(`- Ollama：${ver!.version}（${URL_}）`);
const tags = await get<{ models?: { name: string; size: number }[] }>('/api/tags');
const m = (tags?.models ?? []).find((x) => x.name === MODEL || x.name === `${MODEL}:latest`);
if (!m) {
  say(`- 模型：× 没有 ${MODEL}。执行 ollama pull ${MODEL} 后再跑。`);
  finish(1);
}
const show = await get<{ license?: string; details?: { parameter_size?: string; quantization_level?: string } }>('/api/show',
  { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: MODEL }) });
const licence = (show?.license ?? '').split('\n').map((l) => l.trim()).find(Boolean) ?? '?';
say(`- 模型：${MODEL} · ${show?.details?.parameter_size ?? '?'} · ${show?.details?.quantization_level ?? '?'} · ${(m!.size / 1e9).toFixed(1)} GB · 许可证：${licence}`);
if (!existsSync(image)) { say(`- 图片：× 找不到 ${image}`); finish(1); }
const raw = readFileSync(image);
const small = await shrink(raw);
say(`- 图片：${path.basename(image)} · 原图 ${(raw.length / 1024).toFixed(0)} KB → 发给模型 ${(small.length / 1024).toFixed(0)} KB`);
say();

console.log('正在识别（没有显卡时第一张要几分钟，请稍候）…');
const t0 = Date.now();
let tFirst = 0;
let content = '';
let evalCount = 0;
try {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT);
  const res = await fetch(`${URL_}/api/chat`, {
    method: 'POST', signal: ctl.signal, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL, stream: true, format: JUDGE_SCHEMA, keep_alive: '10m', options: { temperature: 0, num_predict: 1500 },
      messages: [{ role: 'user', content: JUDGE_PROMPT, images: [small.toString('base64')] }],
    }),
  });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} ${await res.text().catch(() => '')}`);
  let buf = '';
  const dec = new TextDecoder();
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buf += dec.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const lineStr = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!lineStr) continue;
      const msg = JSON.parse(lineStr) as { message?: { content?: string }; done?: boolean; eval_count?: number; error?: string };
      if (msg.error) throw new Error(msg.error);
      if (!tFirst && msg.message?.content) tFirst = Date.now();
      content += msg.message?.content ?? '';
      if (msg.done) evalCount = msg.eval_count ?? 0;
      process.stdout.write('.');
    }
  }
  clearTimeout(timer);
} catch (e) {
  console.log();
  say(`## 结果：× 识别失败 —— ${(e as Error).message}`);
  finish(1);
}
console.log();
const total = (Date.now() - t0) / 1000;
const ps = await get<{ models?: { name: string; size: number; size_vram: number }[] }>('/api/ps');
const loaded = (ps?.models ?? []).find((x) => x.name === MODEL || x.name === `${MODEL}:latest`);
const proc = !loaded ? '查不到' : loaded.size_vram <= 0 ? 'CPU' : loaded.size_vram >= loaded.size * 0.99 ? 'GPU（全部在显存）' : `GPU + CPU 混合（显存 ${(loaded.size_vram / 1e9).toFixed(1)} / ${(loaded.size / 1e9).toFixed(1)} GB）`;

say('## 耗时与硬件');
say();
say(`- 总耗时：**${total.toFixed(1)} 秒**（目标：GPU < 60 秒，CPU < 180 秒）${total < 60 ? ' √' : total < 180 ? (proc === 'CPU' ? ' √（CPU）' : ' △ 超过 GPU 目标') : ' × 超过 3 分钟'}`);
say(`- 其中加载模型 + 看图：${tFirst ? ((tFirst - t0) / 1000).toFixed(1) : '?'} 秒；输出 ${evalCount} 个 token`);
say(`- 跑在：**${proc}**`);
say();

let parsed: unknown = null;
try { parsed = JSON.parse(content); } catch { const mm = /\{[\s\S]*\}/.exec(content); try { parsed = mm ? JSON.parse(mm[0]) : null; } catch { /* bad */ } }
if (!parsed) { say('## 结果：× 模型输出不是合法 JSON'); say('```'); say(content.slice(0, 2000)); say('```'); finish(1); }
const r: JudgeResult = normalise(parsed);
const v = (k: string) => r.items.find((i) => i.key === k);

say('## 识别结果（已经过平台的确定性后处理）');
say();
say(`- 图片类型：${r.kind ?? '—'}（把握 ${Math.round(r.kindConfidence * 100)}%）· 场景：${[r.env, r.space, r.description].filter(Boolean).join(' · ')}`);
say(`- 用途猜测：${r.intentGuess ?? '—'} —— ${r.intentWhy}`);
say();
say('| 要素 | 值 | 把握 | 估 | 来源 / 丢弃原因 |');
say('|---|---|---|---|---|');
for (const i of r.items) say(`| ${i.key} | ${i.value ?? '—'} ${i.value !== null ? i.unit : ''} | ${Math.round(i.confidence * 100)}% | ${i.estimated && i.value !== null ? '估' : ''} | ${i.dropped ?? (i.source || i.raw || '')} |`);
say();
const qs = asks(r, { ...emptyReview(), intent: 'site' }).map((a) => a.id);
say(`- 还缺什么（规则表）：${qs.join('、') || '—'}`);
say();

if (isDefaultPhoto) {
  say('## 对照验收第 1 条（0930 弧形屏照片）');
  say();
  const checks: [boolean, string][] = [
    [r.kind === 'site_photo', '类型识别为「现场照片」'],
    [v('led_opening_w')?.value === 2400, '屏宽 2400（手写「2400m m」换算正确）'],
    [v('led_opening_h')?.value === 2000, '屏高 2000'],
    [v('shape')?.value === 'concave' || v('shape')?.value === 'convex', '形状识别为弧形'],
    [qs.includes('arc') && qs.includes('rad'), '「还缺什么」有「弧长还是弦长」「弧半径 / 弧高」'],
    [qs.includes('view'), '「还缺什么」有「最近观看距离」'],
    [qs.includes('maint'), '「还缺什么」有「前 / 后维护」（需要模型认出嵌墙）'],
    [r.items.every((i) => i.confidence <= 0.75), '把握度都不超过 75%'],
  ];
  for (const [ok, s] of checks) say(`- ${ok ? '√' : '×'} ${s}`);
  say();
}
say('<details><summary>模型原始输出</summary>');
say();
say('```json');
say(JSON.stringify(parsed, null, 2));
say('```');
say('</details>');
finish(0);

function finish(code: number): never {
  const dir = path.join(root, 'data');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `vision-selftest-${stamp}.md`);
  writeFileSync(file, out.join('\n') + '\n', 'utf8');
  console.log(`\n记录已写到：${file}\n把这个文件发给我即可。`);
  process.exit(code);
}
