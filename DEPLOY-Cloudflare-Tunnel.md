# Audax 项目协作台 · 公网独立链接（Cloudflare Tunnel）

> 目标：内网服务器照常运行，同事在公司外也能用一个 https 独立链接（如 `https://av.公司域名`）打开平台。
> 数据仍然只在公司服务器上；服务器**不开放任何端口**，由服务器主动连到 Cloudflare。
> 全程约 30 分钟，大部分在 Cloudflare 网页上点。卡在哪一步，把截图发给我。

---

## 一、开始前确认（必做）

- [ ] 服务器已按 `上线操作单.md` 更新到最新版，内网 `http://<服务器IP>:3000` 能正常打开。
- [ ] **所有账号都已改掉初始密码 `audax123`**（pd / bd / sales 及同事账号）。公网可访问后，初始密码等于没有密码。
      用 pd 登录 →「用户管理」逐个检查；不再使用的账号「停用」。
- [ ] 有一个公司域名（如 `audax.com.sg`），并能登录域名注册商后台。
- [ ] 注册一个 Cloudflare 账号：https://dash.cloudflare.com/sign-up （免费版即可）。

## 二、把域名接入 Cloudflare（一次性，约 10 分钟 + 生效等待）

1. Cloudflare 首页 →「Add a domain」→ 输入公司域名 → 选 **Free** 套餐。
2. Cloudflare 会自动导入现有 DNS 记录。**逐条核对邮件相关记录（MX、SPF/TXT）都在**，否则公司邮箱会收不到信。
3. 按提示到域名注册商后台，把 Nameserver 改成 Cloudflare 给的两个地址。
4. 等 Cloudflare 显示域名「Active」（通常几分钟到几小时）。

> 如果公司域名不方便整体迁到 Cloudflare，可以单独买一个便宜的新域名专门给平台用，步骤相同。

## 三、在服务器上装隧道（约 5 分钟）

1. Cloudflare 左侧进入 **Zero Trust** → **Networks** → **Tunnels** → **Create a tunnel** → 选 **Cloudflared** → 名称填 `audax` → Save。
2. 「Choose your environment」选 **Windows**。页面会给出一条带长串令牌的安装命令。
3. 在服务器上：
   - 下载并安装页面给的 **cloudflared** 安装包（64-bit）；
   - 以**管理员身份**打开命令行，粘贴执行页面上那条命令（形如 `cloudflared.exe service install eyJhIjoi...`）。
     它会把隧道装成 Windows 服务，开机自动运行。
4. 回到网页，下方「Connectors」出现一条 **Connected** 即成功。

## 四、给平台分配链接（约 2 分钟）

在同一个隧道里，添加公网地址（新版页面叫 **Published application routes**，旧版叫 **Public Hostname**）：

| 项 | 填 |
|---|---|
| Subdomain | `av`（或任意你想要的名字） |
| Domain | 选公司域名 |
| Service Type | `HTTP` |
| URL | `localhost:3000` |

保存。到 Cloudflare 该域名的 **SSL/TLS → Edge Certificates**，打开 **Always Use HTTPS**。

## 五、只允许公司的人打开（必做，约 5 分钟）

不做这一步，全世界都能看到登录页并反复猜密码。

1. **Zero Trust** → **Access** → **Applications** → **Add an application** → **Self-hosted**。
2. Application domain：填上一步的 `av.公司域名`。
3. 添加策略（Policy）：Action = **Allow**，规则 **Emails ending in** = `@公司域名`（例如 `@audax.com.sg`）；
   若有同事用私人邮箱，再加一条 **Emails** 逐个列出。
4. 登录方式保持默认 **One-time PIN**（输入邮箱 → 收验证码）。保存。

之后打开链接的流程：Cloudflare 验证页输入公司邮箱 → 收验证码 → 进入平台登录页 → 用平台账号密码登录。

## 六、验证

- [ ] 用手机**关掉 Wi-Fi、走 4G**，打开 `https://av.公司域名`：先出现 Cloudflare 邮箱验证页。
- [ ] 用非公司邮箱试一次：应被拒绝。
- [ ] 用公司邮箱收验证码进入 → 平台登录页 → 能正常登录、打开项目。
- [ ] AV 页面：「LED 方案配置」能下载 DXF 和技术方案书；「AV 历史案例」能搜索。
- [ ] 内网 `http://<服务器IP>:3000` 仍然能用（两种方式同时有效）。

## 七、平台自带的保护（已内置，无需设置）

- 经 https 链接登录时，登录凭证只通过加密连接发送（Secure Cookie）。
- 同一账号在同一地址连续输错 5 次密码，锁定 15 分钟。

## 八、日常与应急

- **更新系统**：照旧运行 `scripts\update.bat`，隧道不受影响。
- **临时关闭外网访问**：服务器管理员命令行执行 `sc stop cloudflared`（恢复：`sc start cloudflared`）。内网访问不受影响。
- **永久撤销**：在 Cloudflare Tunnels 里删除 `audax` 隧道，再到服务器「应用和功能」卸载 cloudflared。
- **有人离职**：先在平台「用户管理」停用账号；若 Access 里单独列了他的邮箱，一并删掉。
- **上传大小**：Cloudflare 免费版单个请求上限 100 MB，平台图纸上限 50 MB，不受影响。
