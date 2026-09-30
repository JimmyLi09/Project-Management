/* AV-015 · 识别服务状态检测（update.bat / update.sh 更新完调用；也可以单独跑）
     node scripts/vision-check.mjs
   只读、只问本机，永远以 0 退出 —— 识别服务不在不影响平台本身，图片会自动改为手填。
   这是给管理员在命令行里看的，所以可以出现命令；同事的界面上不会有。 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let url = 'http://127.0.0.1:11434';
let model = 'qwen2.5vl:7b';
let enabled = true;
/* 管理员在「规则设置 › 识别服务」改过就以那里为准 */
try {
  const { default: Database } = await import('better-sqlite3');
  const file = path.join(process.env.AUDAX_DATA_DIR || path.join(root, 'data'), 'audax.db');
  if (existsSync(file)) {
    const db = new Database(file, { readonly: true, fileMustExist: true });
    const row = db.prepare("SELECT value FROM app_settings WHERE key = 'av_vision'").get();
    db.close();
    if (row?.value) { const v = JSON.parse(row.value); url = v.url || url; model = v.model || model; enabled = v.enabled !== false; }
  }
} catch { /* 没有库或读不了：用默认值 */ }

const line = (k, v) => console.log(`  ${k.padEnd(4, '　')} ${v}`);
const get = async (p, init) => {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 4000);
  try { const r = await fetch(url + p, { ...init, signal: ctl.signal }); return r.ok ? await r.json() : null; }
  catch { return null; } finally { clearTimeout(t); }
};

console.log('==> 识别服务状态 Recognition service (AV-015)');
if (!enabled) line('开关', '- 管理员已在「规则设置 › 识别服务」关闭本机视觉模型，图片一律手填');
const ver = await get('/api/version');
if (!ver) {
  line('服务', `× 连不上 ${url} —— 同事上传图片会自动改为手填，平台其它功能不受影响`);
  line('', '  安装方法见《上线操作单》「识别服务（Ollama）」一节');
} else {
  line('服务', `√ Ollama ${ver.version} 在运行（${url}）`);
  const tags = await get('/api/tags');
  const m = (tags?.models || []).find((x) => x.name === model || x.name === `${model}:latest`);
  line('模型', m ? `√ ${model} 已装（${(m.size / 1e9).toFixed(1)} GB）` : `× 没有 ${model} —— 执行：ollama pull ${model}`);
  const ps = await get('/api/ps');
  const loaded = (ps?.models || []).find((x) => x.name === model || x.name === `${model}:latest`);
  line('加载', !loaded ? '- 现在没加载（第一次识别时加载，空闲后自动卸载）'
    : loaded.size_vram <= 0 ? '√ 已加载，用 CPU' : loaded.size_vram >= loaded.size * 0.99 ? '√ 已加载，用显卡 GPU' : '√ 已加载，显卡 + CPU 混合（显存不够）');
}
try {
  const out = execFileSync('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader'], { encoding: 'utf8', timeout: 5000 }).trim();
  line('显卡', `√ ${out.split('\n').join(' / ')}`);
} catch { line('显卡', '- 没检测到 NVIDIA 显卡：识别用 CPU（单张约 1–3 分钟）'); }
const ocr = process.platform === 'win32' ? 'services/drawing/.venv-ocr/Scripts/python.exe' : 'services/drawing/.venv-ocr/bin/python';
line('文字识别', existsSync(path.join(root, ocr)) ? '√ 已装（视觉模型不可用时退回它）' : '- 没装（可选；视觉模型不可用时直接手填）');
