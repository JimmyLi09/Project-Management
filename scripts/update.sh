#!/usr/bin/env bash
# Audax 项目协作台 — 一键更新 (Mac / Linux)
# 用法: 在项目目录里执行  bash scripts/update.sh
#       要一并装「文字识别 OCR」(可选,AV-015 的第二道兜底): bash scripts/update.sh --with-ocr
set -e
# 1001: 整个脚本包在 main() 里、最后一行才调用 —— bash 先把函数整段读进来再执行,
# 下面 git reset 把这个文件换成新版本时,不会从错位的地方接着读。
main() {
cd "$(dirname "$0")/.."
[ "${1:-}" = "--with-ocr" ] && WITH_OCR=1
TS=$(date +%Y%m%d-%H%M%S)

echo "==> 更新前快照 Snapshotting the database first…"
# 更新前先给数据库留一份带时间戳的快照,和每日自动备份分开存,
# 万一新版本有问题,可以直接用这一份回到更新前那一刻。
if [ -f data/audax.db ]; then
  mkdir -p data/backups
  SNAP="data/backups/pre-update-$TS.db"
  # 用 sqlite3 的 .backup 更稳(会一并合并 WAL);没装就退回直接复制三件套。
  if command -v sqlite3 >/dev/null 2>&1; then
    sqlite3 data/audax.db ".backup '$SNAP'"
  else
    cp data/audax.db "$SNAP"
    [ -f data/audax.db-wal ] && cp data/audax.db-wal "$SNAP-wal"
    [ -f data/audax.db-shm ] && cp data/audax.db-shm "$SNAP-shm"
  fi
  echo "✓ 已快照到 $SNAP"
else
  echo "(未发现 data/audax.db,首次部署,跳过快照)"
fi

echo "==> 拉取最新代码 Pulling latest code (branch: main)…"
# data/ 是 .gitignore 里的,git 操作不会动它 —— 数据库安全。
git fetch origin main
git checkout main 2>/dev/null || git checkout -b main origin/main
git reset --hard origin/main

echo "==> 安装依赖 Installing dependencies…"
if ! npm install; then
  echo "✗ 安装依赖失败。照样重启服务,尽量让网站继续能用。"
  restart_app; echo "✗ 更新失败,请把上面 npm install 的报错发给管理员。"; exit 1
fi

# 1001: 先构建到 .next-build,成功了才换成 .next;失败时旧的 .next 原封不动、照样重启。
mkdir -p data/logs
BLOG="data/logs/build-$TS.log"
echo "==> 构建 Building…(约 1–3 分钟,输出写在 $BLOG)"
rm -rf .next-build
if ! NEXT_DIST_DIR=.next-build npm run build > "$BLOG" 2>&1; then
  echo "✗ 构建失败:新版本没换上,继续用更新前构建好的版本,并照样重启。"
  restart_app
  echo "  构建日志最后 30 行(完整日志:$BLOG):"; tail -n 30 "$BLOG"
  echo "✗ 更新失败,请把 $BLOG 发给管理员。"; exit 1
fi
echo "✓ 构建完成"
echo "==> 换上新版本并重启 Switching to the new build…"
command -v pm2 >/dev/null 2>&1 && pm2 stop audax >/dev/null 2>&1 || true
rm -rf .next-prev
[ -d .next ] && mv .next .next-prev
mv .next-build .next
restart_app

echo "==> 制图服务 Python（AV 平台：图纸解析 / DXF / 技术方案书 / 历史案例）…"
# 虚拟环境在 services/drawing/.venv(已 .gitignore,更新不会动它)。没装 Python 时
# 只提示,不中断:AV 以外的功能不受影响。
# PYTHONUTF8=1 与 update.bat 保持一致:这边的 locale 通常本来就是 UTF-8,
# 但两个脚本的行为最好别有差别,免得只在其中一台上复现的问题。
export PYTHONUTF8=1
PYV=services/drawing/.venv
if [ ! -x "$PYV/bin/python" ] && command -v python3 >/dev/null 2>&1; then
  python3 -m venv "$PYV" || true
fi
if [ -x "$PYV/bin/python" ]; then
  "$PYV/bin/python" -m pip install -q -r services/drawing/requirements.txt \
    && echo "✓ 制图服务依赖已就绪" \
    || echo "⚠ 制图服务依赖安装失败(需能上外网),AV 的图纸解析 / DXF / 方案书 / 案例导入暂不可用"
else
  echo "⚠ 未找到 python3(建议 3.11)。AV 的图纸解析 / DXF / 方案书 / 案例导入需要它,装好后重新运行本脚本"
fi

# AV-015: OCR 放独立的 .venv-ocr(paddleocr 2.9.1 要 numpy<2,和制图服务冲突)。默认不装。
if [ "${WITH_OCR:-0}" = "1" ]; then
  echo "==> 文字识别 OCR（可选，独立虚拟环境 services/drawing/.venv-ocr）…"
  OCV=services/drawing/.venv-ocr
  [ -x "$OCV/bin/python" ] || python3 -m venv "$OCV" || true
  if [ -x "$OCV/bin/python" ]; then
    "$OCV/bin/python" -m pip install -q -r services/drawing/requirements-ocr.txt \
      && echo "✓ 文字识别已就绪" \
      || echo "⚠ 文字识别安装失败，不影响其它功能：图片识别仍可用本机视觉模型或手填"
    # 第一次运行要下载识别权重，这里先跑一张
    (cd services/drawing && .venv-ocr/bin/python -m avdrawing.ingest.ocrcli tests/fixtures/vision/arc_photo_0930.jpg >/dev/null 2>&1) \
      && echo "✓ 文字识别权重已下载" || echo "⚠ 文字识别权重暂未下载成功，首次使用时会再试"
  else
    echo "⚠ 未找到 python3，跳过文字识别"
  fi
fi

# AV-015: 更新完查一次识别服务(本机 Ollama),只打印,不影响更新结果
node scripts/vision-check.mjs || true
echo "✓ 更新完成 Update done."
}

restart_app() {
  echo "==> 重启服务 Restarting…"
  if command -v pm2 >/dev/null 2>&1; then
    pm2 restart audax 2>/dev/null || pm2 start npm --name audax -- start
    pm2 save
    echo "✓ 已通过 pm2 重启 (进程名 audax)"
  else
    echo "⚠ 未安装 pm2。请手动重启: 停掉旧的 npm start,再执行 npm start"
  fi
}

main "$@"; exit
