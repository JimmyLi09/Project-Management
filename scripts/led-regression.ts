/* ===== LED 系数回归对照报告 =====
   Prints the nine real projects of §7.3 against the system's output, including
   both data-cable readings, so engineering can settle the 逐行 / 整屏 divergence
   with the numbers in front of them.

   Run: npm run led:regression */

import { compute } from '../src/av/core/compute.ts';
import { FIXTURES, fixtureConfig, wholeScreenRuns } from '../src/av/core/fixtures.ts';
import { getRulePack } from '../src/av/core/rulepack.ts';

const PACK = process.argv[2] ?? 'led@1.0';
const pack = getRulePack(PACK);

const pad = (s: string, n: number) => {
  const w = [...s].reduce((a, c) => a + (c.charCodeAt(0) > 0x2000 ? 2 : 1), 0);
  return s + ' '.repeat(Math.max(0, n - w));
};
const mark = (a: number, b: number) => (a === b ? '一致' : Math.abs(a - b) / Math.max(b, 1) <= 0.25 ? '接近' : '偏差');

console.log(`规则包 ${pack.version}（${pack.issued}） · circuit_kw=${pack.company.circuitKw} kW · data_px=${pack.control.dataPx} px\n`);
const head = ['项目', '尺寸 mm', '㎡ 表/算', 'kW 表/算', '电源 表/算', '数据 表/逐行/整屏', '排布'];
const widths = [18, 14, 15, 15, 16, 20, 22];
console.log(head.map((h, i) => pad(h, widths[i])).join(''));
console.log('─'.repeat(widths.reduce((a, b) => a + b, 0)));

let powerAgree = 0, powerTotal = 0;
for (const f of FIXTURES) {
  const r = compute(fixtureConfig(f), PACK);
  const t = r.trace;
  const perRow = t.n_data_run ? t.n_data_run.value : null;
  const whole = wholeScreenRuns(t.px.value, pack.control.dataPx);
  const power = t.n_power_cable.value;
  if (f.id !== '021') { powerTotal++; if (power === f.recorded.powerCable) powerAgree++; }

  const shape = r.layout
    ? `${r.layout.widths.length}列×${r.layout.heights.length}行 ${r.layout.cells.length}只${r.layout.custom ? ' 含定制' : ''}`
    : r.findings.filter((x) => x.severity === 'block').map((x) => x.code).join(',');

  console.log([
    pad(f.name, widths[0]),
    pad(`${f.L}×${f.H}`, widths[1]),
    pad(`${f.recorded.sqm} / ${t.sqm.value.toFixed(2)}`, widths[2]),
    pad(`${f.recorded.kw.toFixed(2)} / ${t.kw.value.toFixed(2)}`, widths[3]),
    pad(`${f.recorded.powerCable} / ${power} ${mark(power, f.recorded.powerCable)}`, widths[4]),
    pad(`${f.recorded.dataCable} / ${perRow ?? '—'} / ${whole}`, widths[5]),
    pad(shape + (f.note ? ` · ${f.note}` : ''), widths[6]),
  ].join(''));
}

console.log(`\n电源线与表内一致：${powerAgree} / ${powerTotal}（§12 A3 要求 5/8）`);
console.log('数据线三列为「表内记录 / F8 逐行（已裁定的规范口径）/ 整屏一次取整（仅供对照 §7.3 旧算出列）」。');
console.log('两种口径在多行屏上必然不同：一条数据线不跨行，取整发生在每一行，逐行结果不会更少。');
