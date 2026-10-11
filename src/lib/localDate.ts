/* 本地时区的 YYYY-MM-DD(「今天」、某个时刻是哪一天)。
   不能用 toISOString().slice(0, 10) —— 那是 UTC:服务器 / 浏览器在新加坡、马来西亚(UTC+8)时,
   每天 0 点到 8 点给的是前一天。这里不依赖别的模块,哪儿都能引。 */
export const localDay = (d: Date = new Date()): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
