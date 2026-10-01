/* 让服务器上的 Node 20 LTS 直接跑 .ts 脚本(实测工具、单元测试、LED 回归)。

   原来写的是 node --experimental-strip-types,那个参数要 Node 22.6+;部署文档规定
   服务器装 Node 20 LTS,一跑就是「bad option」。这里换成 Node 20.6+ 就有的模块钩子:
   遇到 .ts 文件,用项目里本来就装着的 typescript(npm install 会装,npm run build
   也要用它)把类型去掉再交给 Node。不用另装任何东西,Node 22 上一样能用。

   用法:node --import ./scripts/ts-register.mjs 某个脚本.ts
   只转译、不做类型检查(类型检查是 next build 的事)。 */

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
