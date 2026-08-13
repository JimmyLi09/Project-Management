import { compileFormula, evalFormula, findFormulaCycle } from './formula';

const keys = new Set(['L', 'H', 'qtyL', 'qtyH', 'price']);
const vals: Record<string, string> = { L: '4000', H: '2500', qtyL: '8', qtyH: '5', price: '' };
let fail = 0;
const ok = (c: boolean, m: string) => { if (!c) fail++; console.log((c ? '✓' : '✗') + ' ' + m); };

/* ---- 正常求值 ---- */
ok(evalFormula('L * H / 1000000', vals) === 10, 'L*H/1000000 = 10 (SQM 面积)');
ok(evalFormula('qtyL * qtyH', vals) === 40, 'qtyL*qtyH = 40');
ok(evalFormula('(L + H) * 2', vals) === 13000, '括号优先级正确');
ok(evalFormula('L / H', vals) === 1.6, '除法');
ok(evalFormula('-L + 5000', vals) === 1000, '一元负号');
ok(evalFormula('2 + 3 * 4', vals) === 14, '乘法优先于加法');
ok(evalFormula('1.5 * 4', vals) === 6, '小数');

/* ---- 算不出来时返回 null,不抛 ---- */
ok(evalFormula('L / 0', vals) === null, '除以零 → null(显示「—」)');
ok(evalFormula('price * 2', vals) === null, '引用空字段 → null');
ok(evalFormula('L +', vals) === null, '语法不全 → null,不抛异常');
ok(evalFormula('', vals) === null, '空公式 → null');

/* ---- 编译期校验 ---- */
ok(compileFormula('L * H / 1000000', keys).ok === true, '合法公式编译通过');
const r1 = compileFormula('L * nope', keys);
ok(!r1.ok && r1.error.includes('不存在的字段'), '引用不存在的字段 → 拦下');
const r2 = compileFormula('L * (H', keys);
ok(!r2.ok && r2.error.includes('括号'), '括号不闭合 → 拦下');
const r3 = compileFormula('L ** H', keys);
ok(!r3.ok, '不支持的运算符 → 拦下');
const r4 = compileFormula('L * H)', keys);
ok(!r4.ok, '多余右括号 → 拦下');

/* ---- 安全:任何代码执行的企图都必须在词法层被挡住 ---- */
const attacks = [
  'fetch("http://evil")',                 // 括号内是函数调用形式
  'alert(1)',
  'window.location="x"',
  'process.env.SESSION_SECRET',
  'this.constructor.constructor("return 1")()',
  '[].constructor',
  'L; alert(1)',
  '`${L}`',
  'L + document.cookie',
];
attacks.forEach((a) => {
  const c = compileFormula(a, keys);
  ok(!c.ok, `拒绝执行企图: ${a.slice(0, 34)}`);
  let threw = false;
  try { evalFormula(a, vals); } catch { threw = true; }
  ok(!threw, `  求值同一串不抛异常: ${a.slice(0, 24)}`);
});

/* ---- 循环引用 ---- */
ok(findFormulaCycle({ a: ['b'], b: ['a'] }) !== null, '直接循环 a↔b 被检出');
ok(findFormulaCycle({ a: ['b'], b: ['c'], c: ['a'] }) !== null, '三节点环被检出');
ok(findFormulaCycle({ a: ['b'], b: [] }) === null, '无环 → null');
ok(findFormulaCycle({ a: ['a'] }) !== null, '自引用 a→a 被检出');
ok(findFormulaCycle({ a: ['b', 'c'], b: ['d'], c: ['d'], d: [] }) === null, '菱形依赖不是环');

/* ---- 递归深度兜底 ---- */
const chain: Record<string, string> = {};
for (let i = 0; i < 30; i++) chain['f' + i] = 'f' + (i + 1);
const resolve = (k: string, d: number): number | null => (chain[k] ? evalFormula(chain[k], {}, resolve, d) : null);
let deepThrew = false;
try { evalFormula('f0', {}, resolve); } catch { deepThrew = true; }
ok(!deepThrew, '深链求值不炸栈(depth 兜底生效)');

console.log(fail === 0 ? '\n公式解析器全部通过' : `\n${fail} 项失败`);
process.exit(fail === 0 ? 0 : 1);
