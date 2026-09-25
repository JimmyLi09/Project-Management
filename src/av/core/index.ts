/* ===== AV platform · LED deterministic core =====
   Framework-free: no React, no Next.js, no database. The whole directory lifts
   into a standalone AV platform repository unchanged. */

export * from './types.ts';
export * from './rulepack.ts';
export * from './layout.ts';
export * from './wiring.ts';
export * from './rules.ts';
export * from './compute.ts';
export * from './drawing.ts';
export * from './svg.ts';
export * from './bom.ts';
export * from './handoff.ts';
export { FIXTURES, fixtureConfig, wholeScreenRuns, type Fixture } from './fixtures.ts';
export { evalExpr, varsOf } from './expr.ts';
