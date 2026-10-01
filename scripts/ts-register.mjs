/* node --import ./scripts/ts-register.mjs xxx.ts —— 见 ts-loader.mjs */
import { register } from 'node:module';

/* 报错时的行号对回 .ts 原文件(转译时带了内联 source map) */
process.setSourceMapsEnabled(true);
register('./ts-loader.mjs', import.meta.url);
