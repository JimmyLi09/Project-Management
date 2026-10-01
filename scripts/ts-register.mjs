/* node --import ./scripts/ts-register.mjs xxx.ts —— 见 ts-loader.mjs */
import { register } from 'node:module';

register('./ts-loader.mjs', import.meta.url);
