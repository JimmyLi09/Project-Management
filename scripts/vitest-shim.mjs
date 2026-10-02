/* 'vitest' 的最小替身(见 ts-loader.mjs):describe / it / expect,用 node:test + node:assert 实现。
   只做排期日历那几份测试用到的匹配器;不够用时在这里补,不要为此装 vitest。 */
import assert from 'node:assert/strict';
import { describe, it, test } from 'node:test';

function matchObject(actual, expected, path = '') {
  if (expected === null || typeof expected !== 'object') {
    assert.deepStrictEqual(actual, expected, `${path || 'value'} 不相等`);
    return;
  }
  assert.ok(actual !== null && typeof actual === 'object', `${path || 'value'} 不是对象`);
  for (const [k, v] of Object.entries(expected)) matchObject(actual[k], v, path ? `${path}.${k}` : k);
}

export function expect(actual) {
  const m = {
    toBe: (v) => assert.strictEqual(actual, v),
    toEqual: (v) => assert.deepStrictEqual(actual, v),
    toStrictEqual: (v) => assert.deepStrictEqual(actual, v),
    toMatchObject: (v) => matchObject(actual, v),
    toBeNull: () => assert.strictEqual(actual, null),
    toBeUndefined: () => assert.strictEqual(actual, undefined),
    toBeTruthy: () => assert.ok(actual),
    toBeFalsy: () => assert.ok(!actual),
    toBeLessThan: (v) => assert.ok(actual < v, `${actual} 应 < ${v}`),
    toBeGreaterThan: (v) => assert.ok(actual > v, `${actual} 应 > ${v}`),
    toHaveLength: (n) => assert.strictEqual(actual?.length, n),
    toContain: (v) => assert.ok(actual.includes(v), `应包含 ${JSON.stringify(v)}`),
  };
  m.not = Object.fromEntries(Object.entries(m).map(([k, fn]) => [k, (...a) => assert.throws(() => fn(...a), `not.${k} 不成立`)]));
  return m;
}

export { describe, it, test };
