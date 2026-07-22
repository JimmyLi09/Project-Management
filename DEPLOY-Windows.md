# Audax 项目协作台 · Windows 安装速查（给 IT / 管理员）

> 目标：在公司一台**常开的 Windows 电脑**上把系统跑起来，同事用浏览器通过内网访问。
> 全程约 15 分钟。遇到问题把报错截图发给我。

---

## 准备（各装一次）

1. **Node.js 20 LTS** —— https://nodejs.org → 下载「LTS」版 → 一路「Next」安装。
2. **Git** —— https://git-scm.com/download/win → 下载安装 → 一路默认。
3. 建议给这台电脑在路由器里**固定内网 IP**（如 `192.168.1.50`），避免重启后地址变化。

验证：按 `Win+R` 输入 `cmd` 回车，打开命令行，逐条执行，能显示版本号即可：
```
node -v
git -v
```

---

## 安装并启动（第一次）

在命令行里逐行执行（建议装到 D 盘）：
```
d:
git clone -b claude/project-management-system-siumg2 https://github.com/JimmyLi09/Project-Management.git audax-platform
cd audax-platform
npm install
npm run build
npm start
```
看到 **Ready** 就成功了。本机浏览器打开 **http://localhost:3000** 验证。

**初始账号**：`pd` / `bd` / `sales`，密码都是 `audax123`。
> ⚠️ 首次登录会**强制要求改密码**，请立即改掉。
> 用 `pd` 登录 →「用户管理」为每位同事建账号（姓名要填将来用于派活的名字）。

---

## 让全公司能访问

1. 查本机内网 IP：命令行执行 `ipconfig`，看「IPv4 地址」（如 `192.168.1.50`）。
2. 同事浏览器访问：**http://192.168.1.50:3000**（换成上一步的实际 IP）。
3. 若同事打不开 → 放行防火墙 3000 端口：
   控制面板 → Windows Defender 防火墙 → 高级设置 → **入站规则** → 新建规则 → 端口 → TCP → 特定端口 `3000` → 允许连接 → 完成。

---

## 让它开机自启、后台常驻（强烈建议）

不设这步的话，关掉命令行窗口系统就停了。执行一次：
```
npm install -g pm2 pm2-windows-startup
pm2-startup install
cd /d d:\audax-platform
pm2 start npm --name audax -- start
pm2 save
```
以后开机会自动运行。常用命令：
- `pm2 status` 看运行状态
- `pm2 logs audax` 看日志
- `pm2 restart audax` 重启

---

## 数据与备份（重要）

- 全部数据在一个文件夹：`d:\audax-platform\data`（`audax.db` 是数据库）。
- 程序**每天自动备份**一份到 `data\backups\`（保留 30 天）。
- **异机备份（建议）**：让备份多存一份到 NAS/网盘同步盘。设一个系统环境变量后重启服务即可：
  变量名 `AUDAX_BACKUP_DIR`，值填目标文件夹（如 `\\NAS\audax-backup` 或 `E:\audax-backup`）。
- **手动备份/迁移**：直接复制整个 `data` 文件夹即可；换电脑时把 `data` 拷到新机器同目录，重启就原样恢复。

---

## 更新到新版本（我发通知后）

双击 `d:\audax-platform\scripts\update.bat` 即可（自动拉代码 → 重装 → 重构 → 重启，约 1-2 分钟）。

---

## 常见问题

| 现象 | 处理 |
|---|---|
| 同事打不开，但本机 localhost 正常 | 防火墙没放行 3000 端口（见「让全公司能访问」第 3 步） |
| `npm install` 报 better-sqlite3 错误 | Node 版本太旧，装 Node 20 LTS 后删掉 `node_modules` 文件夹重来 |
| 关了命令行系统就停 | 没配 pm2 常驻（见上一节） |
| 忘记某人密码 | 用 pd 登录 →「用户管理」→ 编辑该用户 →「重置密码」 |
| 有人离职 | 团队页「转交全部」把项目转给他人 → 用户管理「停用账号」 |

---
**技术摘要**（给懂技术的同事）：Next.js 15 + SQLite 单机部署，默认端口 3000（`set PORT=8080 && npm start` 可改），无需数据库服务器、无需公网。
