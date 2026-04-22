# 初始化与部署说明

本文档用于把当前版本的 GNG 活动日历从零配置到可运行状态，并补充服务器同步方式。

注意：旧版文档里提到的 `credentials.json`、`token.json`、Desktop App OAuth 流程已经不适用于当前代码。当前实现以 `.env` 中的 `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`、`GOOGLE_REFRESH_TOKEN` 为准，并通过 `node auth.js` 获取 refresh token。

## 1. 准备条件

- Node.js 18 或更高版本
- 一个可访问 Google Sheets API 的 Google 账号
- 至少一份活动 Google Sheet
- 可选：第二份活动排期/配置表
- 可选：`Event.xlsx`
- 可选：SeaTalk 机器人配置
- 可选：Chromium/Chrome（用于图片渲染）

## 2. 安装依赖

在项目根目录执行：

```bash
npm install
```

## 3. 创建 Google Cloud 配置

### 3.1 创建项目并启用 API

1. 打开 [Google Cloud Console](https://console.cloud.google.com/)
2. 创建或选择一个项目
3. 进入 `APIs & Services -> Library`
4. 启用 `Google Sheets API`

### 3.2 配置 OAuth consent screen

1. 进入 `APIs & Services -> OAuth consent screen`
2. 选择 `External`
3. 填写应用名称、支持邮箱、开发者邮箱
4. 在测试用户中加入你自己的 Google 账号

### 3.3 创建 OAuth Client ID

当前项目的 `auth.js` 使用本地回调地址：

```text
http://localhost:3001/oauth2callback
```

所以这里应创建：

- 类型：`Web application`
- Authorized redirect URI：
  `http://localhost:3001/oauth2callback`

创建完成后，记下：

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

## 4. 配置环境变量

复制模板：

```bash
copy .env.example .env
```

至少填写以下内容：

```env
GOOGLE_CLIENT_ID=你的客户端ID
GOOGLE_CLIENT_SECRET=你的客户端密钥
GOOGLE_SHEET_ID=主活动表ID
```

如果你有第二份排期/配置表，再补：

```env
GOOGLE_SHEET_ID_2=第二份表ID
```

补充说明：

- `POLL_INTERVAL` 即使设置得更小，代码也会强制至少使用 `30000` 毫秒。
- `EVENT_EXCEL_PATH` 默认是项目内的 `data/Event.xlsx`。
- 所有可选配置项都已经写在 `.env.example` 里。

## 5. 获取 refresh token

运行：

```bash
node auth.js
```

脚本会：

1. 打开浏览器授权页
2. 回调到本地 `http://localhost:3001/oauth2callback`
3. 在终端打印：

```env
GOOGLE_REFRESH_TOKEN=xxxx
```

把这行内容写入 `.env`。

## 6. 准备 Event.xlsx

项目支持通过 `Event.xlsx` 补齐活动类型与 Event 配置。

有两种方式：

### 方式 A：直接放到默认路径

把文件放到：

```text
data/Event.xlsx
```

### 方式 B：自定义路径

在 `.env` 中设置：

```env
EVENT_EXCEL_PATH=你的绝对路径
```

### 方式 C：运行后手动上传

服务启动后可以在网页的“配置检查”页手动上传 `Event.xlsx`，接口为：

```text
POST /api/event-upload
```

字段名是 `eventFile`。

## 7. 启动项目

```bash
npm start
```

默认访问地址：

```text
http://localhost:3000
```

启动后会发生这些事：

1. 读取活动快照 `data/activity-snapshot.json`
2. 加载 `Event.xlsx`
3. 拉取 Google Sheets 数据
4. 生成统一活动数据
5. 提供网页与 API
6. 启动轮询和前端推送

## 8. 验证是否运行正常

重点检查：

- 浏览器是否能打开首页
- `/api/calendar` 是否返回活动数组
- 上传 `Event.xlsx` 后页面是否刷新
- 控制台是否出现 Google Sheets 拉取成功日志
- 如果启用了 Google 企业邮箱登录，首页是否先显示登录卡片，登录成功后是否自动恢复到原页面

可直接访问：

```text
http://localhost:3000/api/calendar
```

## 9. 可选功能配置

### 9.1 第二份活动表

如果你需要补充甘特排期与奖励配置，请设置：

```env
GOOGLE_SHEET_ID_2=第二份表ID
```

当前代码默认会尝试读取第二份表中的：

- `1.0 event calendar`
- `活动配置`

### 9.2 SeaTalk 机器人

配置以下变量：

```env
SEATALK_APP_ID=
SEATALK_APP_SECRET=
SEATALK_SIGNING_SECRET=
SEATALK_GROUP_ID=
```

说明：

- `/callback` 用于接收 SeaTalk 事件回调
- `/api/seatalk-push` 与 `/api/seatalk-image-push` 也会使用 `SEATALK_SIGNING_SECRET` 作为内部调用校验
- 工作日推送日期可通过 `PUSH_HOLIDAYS` 和 `PUSH_MAKEUP_WORKDAYS` 控制
- 当前 `server.js` 里每日定时推送逻辑被注释暂停，如需恢复，请先确认业务状态

### 9.3 Alpha Knowledge 同步

配置：

```env
ALPHA_KNOWLEDGE_API_KEY=
ALPHA_KNOWLEDGE_EXPERT_ID=7420
ALPHA_KNOWLEDGE_CITATION_URL=
```

配置完成后，服务会在活动数据变化后自动同步 Markdown 知识文档。

### 9.4 Google 企业邮箱登录

如果你希望给网页数据加一层登录保护，现在推荐直接使用 Google 企业邮箱登录。前端会拉起 Google Identity Services，服务端会校验返回的 Google ID token，并只放行指定邮箱后缀。

你需要先在 Google Cloud Console 为当前域名创建 Web Client，并把网页地址加入 Authorized JavaScript origins，例如：

```text
http://localhost:3000
https://你的域名
```

`.env` 中需要：

```env
GOOGLE_LOGIN_ENABLED=true
GOOGLE_LOGIN_CLIENT_ID=
GOOGLE_LOGIN_ALLOWED_EMAIL_DOMAINS=garena.com,garena-external.com
APP_SESSION_TTL_HOURS=24
APP_SESSION_SECRET=请填写足够长的随机字符串
```

说明：

- 默认只允许 `@garena.com` 和 `@garena-external.com`
- `GOOGLE_LOGIN_ALLOWED_EMAIL_DOMAINS` 可改成逗号分隔的后缀白名单
- 开启后，`/api/calendar`、`/api/data`、`/api/event-upload` 和 Socket 连接都需要先登录
- 登录成功后，前端会自动恢复到原来的筛选/页签地址

### 9.5 Google API 代理

如果服务器无法直接访问 Google API，可配置 Cloudflare Worker 代理。

主项目 `.env` 中需要：

```env
GOOGLE_API_PROXY=
GOOGLE_API_PROXY_KEY=
```

Worker 项目位于：

```text
cloudflare-worker/
```

### 9.6 图片海报渲染

图片推送使用 HTML + Puppeteer 渲染器，常见变量：

```env
CALENDAR_IMAGE_OUTPUT_PATH=
CALENDAR_IMAGE_API_URL=
PUPPETEER_EXECUTABLE_PATH=
```

如果服务器环境无法自动发现 Chromium，请显式设置 `PUPPETEER_EXECUTABLE_PATH`。

## 10. 服务器同步与部署

这个项目最后是要同步到服务器上的，当前代码里已经体现了两种方式。

### 10.1 推荐方式：GitHub Actions 自动部署

当前仓库已经改为更推荐的路径：GitHub Actions 通过 SSH 登录服务器执行部署脚本。

仓库内的关键文件：

- `.github/workflows/deploy.yml`
- `ecosystem.config.cjs`
- `ops/deploy.sh`
- `ops/bootstrap-server.sh`
- `ops/nginx/gng-activity-calendar.conf`

首次上服务器建议先执行：

```bash
bash ops/bootstrap-server.sh
```

然后把生产环境 `.env` 放到：

```text
/opt/gng-activity-calendar/.env
```

GitHub Actions 需要以下仓库 Secrets：

```text
SERVER_HOST
SERVER_USER
SERVER_SSH_KEY
SERVER_PORT        # 可选，默认 22
SERVER_APP_DIR     # 可选，默认 /opt/gng-activity-calendar
```

每次 push 到 `master` 后，Actions 会远程执行：

1. 将当前仓库打成发布包
2. 通过 SSH 上传到服务器
3. 使用 `rsync` 同步到 `/opt/gng-activity-calendar`
4. 保留服务器本地的 `.env`、`data/`
5. 执行 `npm ci --omit=dev`
6. 使用 PM2 启动或重启 `gng-activity-calendar`
7. 调用本机 `/api/calendar` 做健康检查

### 10.2 旧方式：服务端 webhook 自动部署

项目里仍然保留了旧的 webhook 入口：

```text
- `GET /healthz`
- `GET /readyz`
```

它收到 GitHub `push` 事件后会：

1. 访问 `GET /healthz` 检查进程是否存活
2. 查看 GitHub Actions 部署 run 是否成功
3. 在服务器上执行 `npm run check`
4. 确认 `pm2 restart gng-activity-calendar --update-env` 已由部署脚本完成

`/api/deploy` 已从服务代码中移除，正式发布链路只保留 GitHub Actions。

### 10.3 备用方式：本地直传服务器

项目本地还有两个辅助脚本：

- 旧的 `upload.js` / `deploy.js` 已退役

它们是本地运维脚本，已被 `.gitignore` 忽略，可用于：

- 紧急上传文件到服务器
- 在服务器上执行命令

建议：

- 仅在可信机器保留这些脚本
- 不要把敏感凭据重新提交进仓库
- 把正式发布流程尽量收敛到 GitHub Actions

### 10.4 当前服务器约定

根据现有脚本，线上一般约定为：

- 项目目录：`/opt/gng-activity-calendar`
- PM2 进程名：`gng-activity-calendar`
- 服务器 Event 文件：`/opt/gng-activity-calendar/data/Event.xlsx`
- Nginx 模板：`ops/nginx/gng-activity-calendar.conf`

## 11. 常见问题

### 11.1 为什么我把 `POLL_INTERVAL` 设成 5000 也没有每 5 秒轮询？

因为代码里有最小保护，实际不会低于 30 秒。

### 11.2 为什么旧文档说要 `credentials.json` 或 `token.json`？

那是旧流程。当前版本通过 `auth.js` 直接输出 `GOOGLE_REFRESH_TOKEN`，不再依赖这两个文件。

### 11.3 没有第二份表或 Event.xlsx 能跑吗？

能跑，但活动类型、奖励信息、期别和某些补充排期会不完整。

### 11.4 为什么部署后页面和本地不一致？

优先检查：

- 服务器 `.env` 是否同步
- 服务器上的 `Event.xlsx` 是否是最新的
- GitHub Actions workflow 是否成功执行
- PM2 是否真的重启到了最新代码
