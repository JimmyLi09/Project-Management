/* ===== REQ-027: 资料卡公式字段的表达式求值 =====

   公式由用户在界面里填写,并且对该服务类型下**所有项目**全局生效 ——
   所以绝不能用 eval / new Function 求值:那等于给任何能改字段的人一个
   在全公司同事浏览器里执行任意代码的入口。

   这里是一个只认四样东西的小解析器:数字、字段 key、`+ - * / ( )`、空白。
   见到别的字符直接判非法,不做任何形式的代码执行。

   文法(递归下降,标准优先级):
     expr   := term   (('+' | '-') term)*
     term   := factor (('*' | '/') factor)*
     factor := '-'? primary
     primary:= number | ident | '(' expr ')'
*/

export interface FormulaError { at: number; message: string }

type Tok =
  | { t: 'num'; v: number; at: number }
  | { t: 'id'; v: string; at: number }
  | { t: 'op'; v: '+' | '-' | '*' | '/' | '(' | ')'; at: number };

const OPS = new Set(['+', '-', '*', '/', '(', ')']);

/* 分词。非法字符在这里就被挡住,后面不会再见到意外输入。 */
function lex(src: string): Tok[] | FormulaError {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
    if (OPS.has(c)) { out.push({ t: 'op', v: c as '+', at: i }); i++; continue; }
    if (c >= '0' && c <= '9') {
      let j = i, dot = false;
      while (j < src.length && ((src[j] >= '0' && src[j] <= '9') || (src[j] === '.' && !dot))) {
        if (src[j] === '.') dot = true;
        j++;
      }
      out.push({ t: 'num', v: parseFloat(src.slice(i, j)), at: i });
      i = j; continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
      out.push({ t: 'id', v: src.slice(i, j), at: i });
      i = j; continue;
    }
    return { at: i, message: `不认识的字符「${c}」—— 公式只支持数字、字段名和 + - * / ( )` };
  }
  return out;
}

interface Node { kind: 'num' | 'id' | 'bin' | 'neg'; num?: number; id?: string; op?: string; l?: Node; r?: Node }

function parse(toks: Tok[]): Node | FormulaError {
  let i = 0;
  const peek = () => toks[i];
  const end = () => i >= toks.length;

  function primary(): Node | FormulaError {
    if (end()) return { at: -1, message: '公式不完整,末尾还缺一项' };
    const tk = toks[i];
    if (tk.t === 'num') { i++; return { kind: 'num', num: tk.v }; }
    if (tk.t === 'id') { i++; return { kind: 'id', id: tk.v }; }
    if (tk.t === 'op' && tk.v === '(') {
      i++;
      const e = expr();
      if ('message' in e) return e;
      const cl = peek();
      if (!cl || cl.t !== 'op' || cl.v !== ')') return { at: tk.at, message: '括号没有闭合' };
      i++;
      return e;
    }
    return { at: tk.at, message: `这里应该是数字、字段名或「(」,却是「${'v' in tk ? tk.v : '?'}」` };
  }

  function factor(): Node | FormulaError {
    const tk = peek();
    if (tk && tk.t === 'op' && tk.v === '-') { i++; const p = factor(); return 'message' in p ? p : { kind: 'neg', l: p }; }
    return primary();
  }

  function term(): Node | FormulaError {
    let l = factor();
    if ('message' in l) return l;
    for (;;) {
      const tk = peek();
      if (!tk || tk.t !== 'op' || (tk.v !== '*' && tk.v !== '/')) return l;
      i++;
      const r = factor();
      if ('message' in r) return r;
      l = { kind: 'bin', op: tk.v, l, r };
    }
  }

  function expr(): Node | FormulaError {
    let l = term();
    if ('message' in l) return l;
    for (;;) {
      const tk = peek();
      if (!tk || tk.t !== 'op' || (tk.v !== '+' && tk.v !== '-')) return l;
      i++;
      const r = term();
      if ('message' in r) return r;
      l = { kind: 'bin', op: tk.v, l, r };
    }
  }

  const root = expr();
  if ('message' in root) return root;
  if (!end()) return { at: toks[i].at, message: '公式里有多余的内容' };
  return root;
}

/* 编译一条公式:语法 + 引用的字段是否存在。返回它引用了哪些字段,
   供上层做循环引用检测。 */
export function compileFormula(src: string, knownKeys: Set<string>):
  { ok: true; refs: string[]; node: unknown } | { ok: false; error: string } {
  if (!src.trim()) return { ok: false, error: '公式不能为空' };
  if (src.length > 500) return { ok: false, error: '公式过长(上限 500 字符)' };
  const toks = lex(src);
  if ('message' in toks) return { ok: false, error: toks.message };
  if (!Array.isArray(toks) || toks.length === 0) return { ok: false, error: '公式不能为空' };
  const node = parse(toks as Tok[]);
  if ('message' in node) return { ok: false, error: node.message };

  const refs: string[] = [];
  const walk = (n: Node) => {
    if (n.kind === 'id') { if (!refs.includes(n.id!)) refs.push(n.id!); return; }
    if (n.l) walk(n.l);
    if (n.r) walk(n.r);
  };
  walk(node as Node);

  const bad = refs.filter((r) => !knownKeys.has(r));
  if (bad.length) return { ok: false, error: `引用了不存在的字段:${bad.join('、')}` };
  return { ok: true, refs, node };
}

/* 求值。values 是同一张资料卡上其它字段的原始字符串值。
   任何算不出来的情况(空值、非数字、除以零、深度超限)都返回 null,
   由调用方显示「—」—— 不抛异常,不让一条坏公式把整页带崩。 */
export function evalFormula(
  src: string,
  values: Record<string, string>,
  resolve?: (key: string, depth: number) => number | null,
  depth = 0,
): number | null {
  if (depth > 16) return null; // 兜底:万一循环引用漏检了,也不会无限递归
  const toks = lex(src);
  if ('message' in toks) return null;
  const node = parse(toks as Tok[]);
  if ('message' in node) return null;

  const run = (n: Node): number | null => {
    switch (n.kind) {
      case 'num': return n.num!;
      case 'neg': { const v = run(n.l!); return v == null ? null : -v; }
      case 'id': {
        if (resolve) { const v = resolve(n.id!, depth + 1); if (v != null) return v; }
        const raw = (values[n.id!] ?? '').trim();
        if (!raw) return null;
        const v = Number(raw);
        return Number.isFinite(v) ? v : null;
      }
      case 'bin': {
        const a = run(n.l!), b = run(n.r!);
        if (a == null || b == null) return null;
        switch (n.op) {
          case '+': return a + b;
          case '-': return a - b;
          case '*': return a * b;
          case '/': return b === 0 ? null : a / b;   // 除以零显示「—」,不是 Infinity
        }
        return null;
      }
    }
    return null;
  };

  const out = run(node as Node);
  return out != null && Number.isFinite(out) ? out : null;
}

/* 循环引用检测:A 引用 B、B 又引用 A(或更长的环)。
   保存前必须查出来 —— 漏掉的话渲染时会无限递归,页面直接卡死。 */
export function findFormulaCycle(formulas: Record<string, string[]>): string[] | null {
  const state: Record<string, 0 | 1 | 2> = {}; // 0 未访问 1 在栈上 2 已完成
  const stack: string[] = [];
  let cycle: string[] | null = null;

  const visit = (k: string): boolean => {
    if (state[k] === 1) {                       // 回到栈上的节点 → 找到环
      cycle = [...stack.slice(stack.indexOf(k)), k];
      return true;
    }
    if (state[k] === 2) return false;
    state[k] = 1; stack.push(k);
    for (const nx of formulas[k] || []) {
      if (formulas[nx] && visit(nx)) return true;
    }
    stack.pop(); state[k] = 2;
    return false;
  };

  for (const k of Object.keys(formulas)) {
    if (state[k] !== 2 && visit(k)) return cycle;
  }
  return null;
}
