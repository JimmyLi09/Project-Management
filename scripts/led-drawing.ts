/* ===== LED 出图 CLI =====
   Emits the §8 drawing model as JSON (input to the Python DXF renderer) and as
   SVG. The JSON is the cross-language contract between src/av/core and
   services/drawing, so both renderers stay on one geometry source (§8.2).

   Run: npm run led:drawing -- <fixture-id> <out-dir> */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertExportable, buildDrawing } from '../src/av/core/drawing.ts';
import { bomCsv } from '../src/av/core/bom.ts';
import { compute } from '../src/av/core/compute.ts';
import { FIXTURES, fixtureConfig } from '../src/av/core/fixtures.ts';
import { toSvg } from '../src/av/core/svg.ts';

const id = process.argv[2] ?? '144';
const dir = process.argv[3] ?? 'out';
const fixture = FIXTURES.find((f) => f.id === id);
if (!fixture) throw new Error(`unknown fixture "${id}" — one of ${FIXTURES.map((f) => f.id).join(', ')}`);

const result = compute(fixtureConfig(fixture), process.argv[4] ?? 'led@1.0');
assertExportable(result);
const drawing = buildDrawing(result, { project: fixture.name });
if (!drawing) throw new Error(`${fixture.name} 排布无解：${result.findings.map((f) => f.code).join(', ')}`);

mkdirSync(dir, { recursive: true });
const slug = fixture.name.replace(/[^\w-]+/g, '-').toLowerCase();
const write = (ext: string, body: string) => {
  const path = join(dir, `${slug}.${ext}`);
  writeFileSync(path, body);
  console.log(path);
};
write('drawing.json', JSON.stringify(drawing, null, 2));
write('svg', toSvg(drawing));
write('bom.csv', bomCsv(result.layout!));
