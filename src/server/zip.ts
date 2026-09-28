/* ===== 最小 ZIP 读写(REQ-035 的 .docx / .xlsx 导入导出用) =====

   平台的依赖只有 better-sqlite3 / next / react —— 为了导个 Word 去装一个
   Office 文档库不值当,而 .docx / .xlsx 本质就是「ZIP 里放几个 XML」。
   这里只做需要的那一点点:
   - 读:遍历中央目录,取出指定文件(存储 or deflate,用 Node 自带 zlib 解)
   - 写:一律用「存储」方式(不压缩),Word / Excel 都认

   刻意不做:加密、多卷、zip64、目录项 —— 遇到就直接报错,不猜。 */
import { inflateRawSync } from 'zlib';

const EOCD = 0x06054b50;         // 中央目录结束标记
const CEN = 0x02014b50;          // 中央目录项
const LOC = 0x04034b50;          // 本地文件头

export interface ZipEntry { name: string; data: Buffer }

/* 读出 zip 里的全部文件。坏包 / 不支持的压缩方式一律抛错,由调用方兜住。 */
export function unzip(buf: Buffer, maxFiles = 512, maxTotal = 64 * 1024 * 1024): Map<string, Buffer> {
  /* EOCD 在文件末尾,注释最长 64K,所以从后往前找 */
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 22 - 65535; i--) {
    if (buf.readUInt32LE(i) === EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是有效的 ZIP 文件');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  if (count > maxFiles) throw new Error('文件里的条目太多');

  const out = new Map<string, Buffer>();
  let total = 0;
  for (let i = 0; i < count; i++) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== CEN) throw new Error('ZIP 中央目录已损坏');
    const method = buf.readUInt16LE(off + 10);
    const csize = buf.readUInt32LE(off + 20);
    const usize = buf.readUInt32LE(off + 24);
    const nlen = buf.readUInt16LE(off + 28);
    const elen = buf.readUInt16LE(off + 30);
    const clen = buf.readUInt16LE(off + 32);
    const lho = buf.readUInt32LE(off + 42);
    const name = buf.slice(off + 46, off + 46 + nlen).toString('utf8');
    off += 46 + nlen + elen + clen;

    if (name.endsWith('/')) continue;                       // 目录项,跳过
    total += usize;
    if (total > maxTotal) throw new Error('解出来的内容过大');

    /* 本地头的扩展字段长度可能和中央目录不一样,必须按本地头来算数据起点 */
    if (buf.readUInt32LE(lho) !== LOC) throw new Error('ZIP 本地文件头已损坏');
    const lnlen = buf.readUInt16LE(lho + 26);
    const lelen = buf.readUInt16LE(lho + 28);
    const start = lho + 30 + lnlen + lelen;
    const raw = buf.slice(start, start + csize);
    if (method === 0) out.set(name, raw);
    else if (method === 8) out.set(name, inflateRawSync(raw));
    else throw new Error(`不支持的压缩方式 ${method}`);
  }
  return out;
}

/* ---- 写:全部用「存储」方式。文件不大(一篇文档),不压缩换来的是零依赖。 ---- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(b: Buffer): number {
  let c = -1;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

export function zip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const crc = crc32(e.data);

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(LOC, 0);
    lh.writeUInt16LE(20, 4);          // 需要 2.0 版本
    lh.writeUInt16LE(0, 6);           // 标志位
    lh.writeUInt16LE(0, 8);           // 方式 0 = 存储
    lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0, 12);   // 时间 / 日期(留 0)
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(e.data.length, 18);
    lh.writeUInt32LE(e.data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    lh.writeUInt16LE(0, 28);
    locals.push(lh, name, e.data);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(CEN, 0);
    ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0, 8); ch.writeUInt16LE(0, 10);
    ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(e.data.length, 20);
    ch.writeUInt32LE(e.data.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(0, 42);          // 本地头偏移(下面回填)
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name);

    offset += 30 + name.length + e.data.length;
  }

  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(EOCD, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
