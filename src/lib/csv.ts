/* CSV 一格:加引号;开头是 = + - @(或制表 / 回车)的前面垫一个 ' —— Excel 打开时不当公式算
   (Detail 里常见「- 项目」这种列表,否则显示 #NAME?;=HYPERLINK(…) 这类也不会被执行)。
   普通数字(-5、+3.5)不垫。导回来时 csvUnguard 去掉这个 '。 */
export function csvCell(v: unknown): string {
  let s = String(v ?? '');
  if (/^[=@\t\r]/.test(s) || (/^[+-]/.test(s) && !/^[+-]?\d+(\.\d+)?$/.test(s))) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}
export const csvUnguard = (s: string) => s.replace(/^'(?=[=+\-@\t\r])/, '');
