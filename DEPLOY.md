# 内测部署指南(B2:本地服务器直接跑 Node,仅内网访问)

适用:公司内网一台常开的 Windows / Mac / Linux 电脑或 NAS。
数据落在本机 `data/audax.db`(单文件数据库),程序内置**每日自动备份**到 `data/backups/`(保留 30 天),无需额外配置。

---

## 一、准备(一次性,约 10 分钟)

1. **安装 Node.js 20 或更高**
   - Windows / Mac:到 https://nodejs.org 下载 LTS 版安装(一路下一步)。
   - 验证:打开终端(Windows 用 cmd 或 PowerShell)执行 `node -v`,显示 v20.x 或以上即可。
2. **安装 Git**(用于拿代码和后续更新)
   - https://git-scm.com/downloads ,默认选项安装。验证:`git -v`。
3. **给服务器设固定内网 IP**(路由器里把这台机器的 IP 固定,例如 `192.168.1.50`),避免 IP 变了大家打不开。

## 二、安装并启动(第一次)

在终端逐行执行(Windows / Mac / Linux 相同):

```bash
# 1. 选一个存放目录并进入(示例:D 盘或家目录)
git clone -b main https://github.com/JimmyLi09/Project-Management.git audax-platform
cd audax-platform

# 2. 安装依赖并构建(首次约 2-5 分钟)
npm install
npm run build

# 3. 启动
npm start
```

看到 `Ready` 字样即启动成功。本机浏览器打开 `http://localhost:3000` 验证。

**初始账号**:`pd` / `bd` / `sales`,密码均为 `audax123`。
> ⚠️ 安全:本地部署时这三个账号**首次登录会强制要求修改密码**,请立即改掉初始密码。
登录 pd → 「用户管理」为每位同事创建账号(姓名务必填将来用于指派的名字)。

**账号安全功能**(用户管理页 / 侧栏):
- 每人可在左下角 🔒 图标**自助修改密码**;
- PD/BD 可在「编辑用户」里**重置他人密码**(对方下次登录须改)、**停用/恢复账号**(离职闭环:先「转交全部」项目,再「停用账号」);
- 登录支持**账号名或 Email** + 密码;停用的账号无法登录。
> 本地部署**不会**生成任何演示假数据,数据库从零开始,只有你们录入的真实项目。

## 三、让全公司能访问

1. 查服务器内网 IP:Windows 执行 `ipconfig`(看 IPv4 地址),Mac/Linux 执行 `ifconfig` 或 `ip a`。
2. 员工浏览器访问:`http://<服务器IP>:3000`,例如 `http://192.168.1.50:3000`。
3. 打不开时,放行防火墙 3000 端口:
   - Windows:控制面板 → Windows Defender 防火墙 → 高级设置 → 入站规则 → 新建规则 → 端口 → TCP 3000 → 允许。
   - Mac:系统设置 → 网络 → 防火墙,允许 Node。
   - Linux:`sudo ufw allow 3000`。

## 四、开机自启 / 后台常驻(推荐,一次性)

用 pm2 让服务在后台跑、崩溃自动拉起、开机自启:

```bash
npm install -g pm2
pm2 start npm --name audax -- start
pm2 save
```

开机自启:
- **Mac / Linux**:执行 `pm2 startup`,按它输出的提示再执行一条命令即可。
- **Windows**:`npm install -g pm2-windows-startup && pm2-startup install`,然后 `pm2 save`。

常用命令:`pm2 status`(看状态) / `pm2 logs audax`(看日志) / `pm2 restart audax`(重启)。

## 五、日常更新(每次我发新版后)

- **Windows**:双击项目里的 `scripts\update.bat`。
- **Mac / Linux**:执行 `bash scripts/update.sh`。

脚本自动完成:拉代码 → 装依赖 → 构建 → 重启。全程约 1-2 分钟,期间页面短暂不可用。

## 六、数据与备份

| 内容 | 位置 |
|---|---|
| 数据库(全部项目/账号) | `data/audax.db` |
| 自动备份(每日一份,留 30 天) | `data/backups/audax-YYYY-MM-DD.db` |

- **手动备份**:直接复制 `data` 整个文件夹到任何地方即可。
- **恢复**:停止服务(`pm2 stop audax`),用备份文件覆盖 `data/audax.db`,再 `pm2 start audax`。
- **异机备份(推荐)**:设置环境变量 `AUDAX_BACKUP_DIR` 指向一个 NAS / 网盘同步文件夹,每日快照会自动多存一份到那里,硬盘损坏也不丢。示例(Mac/Linux):`AUDAX_BACKUP_DIR=/Volumes/NAS/audax-backup pm2 start npm --name audax -- start`。

## 七、可选环境变量

| 变量 | 作用 | 默认 |
|---|---|---|
| `PORT` | 端口 | 3000 |
| `AUDAX_DATA_DIR` | 数据目录位置 | 项目内 `data/` |
| `AUDAX_BACKUP_DIR` | **异机备份目录**:指向 NAS / 网盘同步文件夹,每日快照会额外复制一份到这里 | 不复制 |
| `AUDAX_NO_BACKUP=1` | 关闭内置自动备份 | 不关闭 |
| `SESSION_SECRET` | 自定义会话密钥 | 自动生成并保存 |

改端口示例:`PORT=8080 npm start`(Windows PowerShell:`$env:PORT=8080; npm start`)。

## 常见问题

- **员工打不开** → 先确认服务器本机 `http://localhost:3000` 正常,再查防火墙(见第三节)。
- **换机器迁移** → 新机器按第二节装好后,把旧机器的 `data` 文件夹整个拷过来,重启即可,所有数据和账号原样保留。
- **npm install 报错 better-sqlite3** → 一般是 Node 版本过旧,升级到 Node 20 LTS 后删除 `node_modules` 重装。
