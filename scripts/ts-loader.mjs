/* 让服务器上的 Node 20 LTS 直接跑 .ts 脚本(实测工具、单元测试、LED 回归)。

   原来写的是 node --experimental-strip-types,那个参数要 Node 22.6+;部署文档规定
   服务器装 Node 20 LTS,一跑就是「bad option」。这里换成 Node 20.6+ 就有的模块钩子:
   遇到 .ts 文件,用项目里本来就装着的 typescript(npm install 会装,npm run build
   也要用它)把类型去掉再交给 Node。不用另装任何东西,Node 22 上一样能用。

   用法:node --import ./scripts/ts-register.mjs 某个脚本.ts
   只转译、不做类型检查(类型检查是 next build 的事)。 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

let ts;
async function typescript() {
  if (!ts) {
    try { ts = (await import('typescript')).default; }
    catch {
      throw new Error('找不到 typescript 包。请在项目目录先运行 npm install(update.bat 会自动做)。');
    }
  }
  return ts;
}

/* 让脚本 / 单元测试直接复用 src 里的代码(和网站跑的是同一份):
     ./xxx(没扩展名)→ 有 ./xxx.ts / ./xxx.tsx 就用它(Next 打包时的写法);
     @/xxx → 项目根的 src/xxx(tsconfig 里的路径别名);
     'vitest' → scripts/vitest-shim.mjs(REQ-046:排期日历的测试是 vitest 写法,
     用基于 node:test 的最小实现跑,不用另装 vitest)。 */
const SRC = new URL('../src/', import.meta.url);
export async function resolve(specifier, context, next) {
  if (specifier === 'vitest') return { url: new URL('./vitest-shim.mjs', import.meta.url).href, shortCircuit: true };
  let base = null, rest = specifier;
  if (specifier.startsWith('@/')) { base = SRC; rest = './' + specifier.slice(2); }
  else if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL?.startsWith('file:')) base = context.parentURL;
  if (base && !/\.[cm]?[jt]sx?$|\.json$/.test(rest)) {
    for (const ext of ['.ts', '.tsx', '/index.ts']) {
      const candidate = new URL(rest + ext, base);
      if (existsSync(fileURLToPath(candidate))) return { url: candidate.href, shortCircuit: true };
    }
  }
  if (base && specifier.startsWith('@/')) return next(new URL(rest, base).href, context);
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (!/\.(ts|mts|tsx)$/.test(new URL(url).pathname)) return next(url, context);
  const t = await typescript();
  const file = fileURLToPath(url);
  const src = await readFile(file, 'utf8');
  const out = t.transpileModule(src, {
    fileName: file,
    compilerOptions: {
      module: t.ModuleKind.ESNext, target: t.ScriptTarget.ES2022, jsx: t.JsxEmit.ReactJSX,
      sourceMap: false, inlineSourceMap: true, inlineSources: false,
    },
  });
  return { format: 'module', source: out.outputText, shortCircuit: true };
}
