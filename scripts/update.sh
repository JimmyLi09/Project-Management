#!/usr/bin/env bash
# Audax 项目协作台 — 一键更新 (Mac / Linux)
# 用法: 在项目目录里执行  bash scripts/update.sh
set -e
cd "$(dirname "$0")/.."

echo "==> 更新前快照 Snapshotting the database first…"
# 更新前先给数据库留一份带时间戳的快照,和每日自动备份分开存,
# 万一新版本有问题,可以直接用这一份回到更新前那一刻。
if [ -f data/audax.db ]; then
  mkdir -p data/backups
  SNAP="data/backups/pre-update-$(date +%Y%m%d-%H%M%S).db"
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
npm install

echo "==> 构建 Building…"
npm run build

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

echo "==> 重启服务 Restarting…"
if command -v pm2 >/dev/null 2>&1; then
  pm2 restart audax 2>/dev/null || pm2 start npm --name audax -- start
  pm2 save
  echo "✓ 已通过 pm2 重启 (进程名 audax)"
else
  echo "⚠ 未安装 pm2。请手动重启: 停掉旧的 npm start,再执行 npm start"
fi
echo "✓ 更新完成 Update done."
