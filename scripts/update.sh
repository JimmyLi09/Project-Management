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

echo "==> 重启服务 Restarting…"
if command -v pm2 >/dev/null 2>&1; then
  pm2 restart audax 2>/dev/null || pm2 start npm --name audax -- start
  pm2 save
  echo "✓ 已通过 pm2 重启 (进程名 audax)"
else
  echo "⚠ 未安装 pm2。请手动重启: 停掉旧的 npm start,再执行 npm start"
fi
echo "✓ 更新完成 Update done."
