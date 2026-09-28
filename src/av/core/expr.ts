/* ===== Arithmetic expression evaluator =====
   §5 stores every formula as configuration ("公式以配置形式存储，不得硬编码");
   §14 repeats it for the rule engine. This is the evaluator those stored
   expressions run through.

   Grammar: + - * / ( ), unary minus, decimal literals, identifiers bound from
   the calculation environment, and the functions floor / ceil / round / min /
   max / abs. Nothing else — no property access, no host calls — so a formula
   edited by an engineer (§11) can change arithmetic but cannot execute code. */

export type Env = Record<string, number>;

const FN: Record<string, (...a: number[]) => number> = {
  floor: Math.floor, ceil: Math.ceil, round: Math.round,
  min: Math.min, max: Math.max, abs: Math.abs,
};

export function evalExpr(src: string, env: Env): number {
  let i = 0;
  const ws = () => { while (i < src.length && src[i] === ' ') i++; };
  const peek = () => { ws(); return src[i]; };
  const eat = (c: string) => { ws(); if (src[i] !== c) throw new Error(`expected "${c}" at ${i} in "${src}"`); i++; };

  const primary = (): number => {
    ws();
    if (src[i] === '(') { i++; const v = expr(); eat(')'); return v; }
    if (src[i] === '-') { i++; return -primary(); }
    const lit = /^\d+(\.\d+)?/.exec(src.slice(i));
    if (lit) { i += lit[0].length; return parseFloat(lit[0]); }
    const id = /^[A-Za-z_]\w*/.exec(src.slice(i));
    if (!id) throw new Error(`unexpected "${src[i] ?? 'end of input'}" at ${i} in "${src}"`);
    i += id[0].length;
    const name = id[0];
    if (peek() === '(') {
      const fn = FN[name];
      if (!fn) throw new Error(`unknown function "${name}" in "${src}"`);
      eat('(');
      const args = [expr()];
      while (peek() === ',') { i++; args.push(expr()); }
      eat(')');
      return fn(...args);
    }
    if (!(name in env)) throw new Error(`unbound variable "${name}" in "${src}"`);
    return env[name];
  };

  const term = (): number => {
    let v = primary();
    for (;;) {
      const c = peek();
      if (c === '*') { i++; v *= primary(); }
      else if (c === '/') { i++; v /= primary(); }
      else return v;
    }
  };

  const expr = (): number => {
    let v = term();
    for (;;) {
      const c = peek();
      if (c === '+') { i++; v += term(); }
      else if (c === '-') { i++; v -= term(); }
      else return v;
    }
  };

  const out = expr();
  ws();
  if (i < src.length) throw new Error(`trailing "${src.slice(i)}" in "${src}"`);
  return out;
}

/* Identifiers an expression depends on — the "变量绑定" half of a formula
   record, and what a trace node lists as its inputs (§9). */
export function varsOf(src: string): string[] {
  const out = new Set<string>();
  for (const m of src.matchAll(/[A-Za-z_]\w*/g)) {
    if (!(m[0] in FN)) out.add(m[0]);
  }
  return [...out];
}
