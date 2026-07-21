#!/usr/bin/env bash
# Audax 项目协作台 — 一键更新 (Mac / Linux)
# 用法: 在项目目录里执行  bash scripts/update.sh
set -e
cd "$(dirname "$0")/.."

echo "==> 拉取最新代码 Pulling latest code…"
git pull

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
