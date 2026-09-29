# AV 方案成本平台 · 单容器部署：Next.js 应用 + Python 制图服务（services/drawing）
# 数据（SQLite 库、每日备份、图纸样本库）在 /app/data，由 docker-compose 挂成卷。
# 两个阶段都不用 apt：完整版 node 镜像自带编译 better-sqlite3 所需的 python3 / make / g++；
# 运行镜像是官方 python 精简版，只从 node 镜像拷入 node 可执行文件。

FROM node:22-bookworm AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM python:3.11-slim-bookworm
WORKDIR /app
COPY --from=node:22-bookworm-slim /usr/local/bin/node /usr/local/bin/node
COPY services/drawing/requirements.txt services/drawing/requirements-ocr.txt services/drawing/
# 需要处理 C 级扫描件时：docker compose build --build-arg WITH_OCR=1（体积大，首次运行会下载 OCR 权重）
ARG WITH_OCR=0
RUN python -m venv services/drawing/.venv \
 && services/drawing/.venv/bin/pip install --no-cache-dir -r services/drawing/requirements.txt \
 && if [ "$WITH_OCR" = "1" ]; then services/drawing/.venv/bin/pip install --no-cache-dir -r services/drawing/requirements-ocr.txt; fi
COPY services/drawing/avdrawing services/drawing/avdrawing
COPY --from=build /app/package.json /app/next.config.mjs ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
ENV NODE_ENV=production AUDAX_DATA_DIR=/app/data
VOLUME /app/data
EXPOSE 3000
CMD ["node", "node_modules/next/dist/bin/next", "start", "-p", "3000", "-H", "0.0.0.0"]
