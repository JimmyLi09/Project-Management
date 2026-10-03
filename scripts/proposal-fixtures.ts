/* Regenerate services/drawing/tests/fixtures/proposal/*.json — the ProposalDoc
   the TS core hands the Word typesetter — after changing src/av/core/proposal.ts:
     node --import ./scripts/ts-register.mjs scripts/proposal-fixtures.ts */
import { writeFileSync } from 'node:fs';
import { compute } from '../src/av/core/compute.ts';
import { FIXTURES, fixtureConfig } from '../src/av/core/fixtures.ts';
import { proposalDoc } from '../src/av/core/proposal.ts';
import { LATEST_LED_PACK } from '../src/av/core/rulepack.ts';
import { advise, NOVASTAR_SEED } from '../src/av/core/controller.ts';
import type { ComputeResult } from '../src/av/core/compute.ts';

const OUT = 'services/drawing/tests/fixtures/proposal';
const plain = compute({ ...fixtureConfig(FIXTURES[0]), led_view_min: 3 }, LATEST_LED_PACK);
const warn = compute({ ...fixtureConfig(FIXTURES[0]), led_view_min: 1.5, led_pwr_dist: 35 }, LATEST_LED_PACK);
/* AV-019:「控制与信号源」按首批诺瓦数据、会议 / 演示 · 客户自备 */
const lib = NOVASTAR_SEED.map(({ note: _n, ...d }) => ({ ...d, price: null }));
const ctrlOf = (r: ComputeResult) => advise(lib, { px: r.trace.px.value, pxW: r.trace.px_w.value, pxH: r.trace.px_h.value, runs: r.wiring!.nDataRun }, { use: 'meeting', pc: 'client' });
for (const lang of ['zh', 'en'] as const) {
  writeFileSync(`${OUT}/doc-${lang}.json`, JSON.stringify(proposalDoc(plain, { title: '144 Chuan Grove', client: '海晟置业', lang, date: '2026-09-28', ctrl: ctrlOf(plain) })));
  writeFileSync(`${OUT}/doc-${lang}-warn.json`, JSON.stringify(proposalDoc(warn, { title: '144 Chuan Grove', client: '', lang, date: '2026-09-28', ctrl: ctrlOf(warn) })));
}
console.log(`written to ${OUT}`);
