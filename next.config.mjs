/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['better-sqlite3'],
  /* scripts/update.bat / update.sh 先构建到 .next-build,成功了才换成 .next:
     构建失败时正在跑的旧版本原封不动,重启后照样能用 */
  distDir: process.env.NEXT_DIST_DIR || '.next',
};

export default nextConfig;
