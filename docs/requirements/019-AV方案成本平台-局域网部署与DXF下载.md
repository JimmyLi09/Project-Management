# 需求：AV 方案成本平台 · 局域网部署与 DXF 直接下载

- **需求编号**：REQ-019
- **所属系统**：AV 方案成本平台（系统一，Next.js）
- **状态**：已实现
- **创建日期**：2026-09-28
- **决策来源**：2026-09-28 Jimmy「以系统一为主继续开发」。对照 avcost-phase1（系统二），先补齐它有而系统一没有的一键部署与 DXF 下载。

## 1. 局域网部署

- `docker compose up -d --build`，浏览器访问 `http://<服务器IP>:8080`；步骤见根目录 README「局域网部署」。
- 单容器：Next.js 应用 + Python 制图服务。构建与运行都不依赖 apt：构建用完整版 node 镜像（自带编译 better-sqlite3 的工具链），
  运行用官方 python 精简镜像并拷入 node 可执行文件。
- 数据在卷 `audax-data`（`/app/data`）：SQLite 库、每日备份、图纸样本库。首次启动创建 pd / bd / sales 三个账号，首次登录必须改密码。
- 可选：`SESSION_SECRET`、`ANTHROPIC_API_KEY`（C 级视觉识别）、`WITH_OCR=1` 构建参数（C 级 OCR）、`AUDAX_BACKUP_DIR`（异地备份）。
- 修正：`services/drawing/requirements.txt` 原来只列了 ezdxf，缺 pymupdf（B 级 PDF 解析必需）与 anthropic（视觉识别），
  新环境部署会导致图纸解析失败，已补齐。

## 2. DXF 直接下载

- 05 LED 方案配置的「DXF」按钮直接下载 `led-layout.dxf`（R2010、单位 mm、§8.1 八图层），不再需要下载数据包再手工执行命令。
- 接口 `POST /api/av/dxf { cfg, packVersion, title }`：服务端按参数重新计算并再次执行导出闸门（未校准参数组、阻断项一律 400），
  再由制图服务渲染。仅 PM / PD / BD 可导出（与原导出权限一致）。

## 3. 验收

- [x] 沙盒中按 README 构建并启动；登录页 200。
- [x] 首次登录要求改密码；改密后建项目；容器内解析 A 级 DXF 与 B 级矢量 PDF（1:50）样张成功，读出宽高 4480 × 2560。
- [x] 接口导出 DXF：`application/dxf`，ezdxf 读回为 R2010、`$INSUNITS = 4`、八个 LED 图层齐全；室外参数组导出返回 400。
- [x] 重启容器后账号与项目仍在（卷持久化）。
- [x] 界面点「DXF」按钮下载 `led-layout.dxf`。
