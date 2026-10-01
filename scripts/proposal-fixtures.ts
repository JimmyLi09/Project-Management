/* Regenerate services/drawing/tests/fixtures/proposal/*.json — the ProposalDoc
   the TS core hands the Word typesetter — after changing src/av/core/proposal.ts:
     node --import ./scripts/ts-register.mjs scripts/proposal-fixtures.ts */
import { writeFileSync } from 'node:fs';
import { compute } from '../src/av/core/compute.ts';
import { FIXTURES, fixtureConfig } from '../src/av/core/fixtures.ts';
import { proposalDoc } from '../src/av/core/proposal.ts';

const OUT = 'services/drawing/tests/fixtures/proposal';
const plain = compute({ ...fixtureConfig(FIXTURES[0]), led_view_min: 3 }, 'led@1.0');
const warn = compute({ ...fixtureConfig(FIXTURES[0]), led_view_min: 1.5, led_pwr_dist: 35 }, 'led@1.0');
for (const lang of ['zh', 'en'] as const) {
  writeFileSync(`${OUT}/doc-${lang}.json`, JSON.stringify(proposalDoc(plain, { title: '144 Chuan Grove', client: '海晟置业', lang, date: '2026-09-28' })));
  writeFileSync(`${OUT}/doc-${lang}-warn.json`, JSON.stringify(proposalDoc(warn, { title: '144 Chuan Grove', client: '', lang, date: '2026-09-28' })));
}
console.log(`written to ${OUT}`);
