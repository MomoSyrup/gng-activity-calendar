# GNG 活动日历

GNG 活动日历是一个基于 Node.js 的活动聚合服务。它会从多份 Google Sheets、第二份活动排期/配置表以及 `Event.xlsx` 中抽取活动信息，合并成统一的 `activities` 数据，再同时提供给网页前端、SeaTalk 机器人推送、图片海报渲染和 Alpha Knowledge 知识库同步。

当前线上版本已不是最早的“单一 Sheet 实时同步网页”形态，项目的真实能力和部署方式以本文档与代码为准。

## 当前能力

- 聚合多份 Google Sheets 活动数据
- 解析第二份表中的甘特排期与奖励配置
- 读取 `Event.xlsx`，补齐活动类型、Event ID 和期别
- 输出统一的 `/api/calendar` 活动接口
- 前端展示进行中活动、月历、侧栏、泳道时间线、活动卡片
- 支持网页端手动上传最新 `Event.xlsx`
- 通过 Socket.io 在数据变更后通知前端刷新
- 支持 SeaTalk 私聊回复、群消息推送、群图片推送
- 可将活动数据同步到 Alpha Knowledge
- 支持通过 Cloudflare Worker 代理 Google API 请求
- 支持通过 GitHub Actions 自动连接服务器并完成发布

## 技术栈

- 后端：Node.js + Express + Socket.io
- 数据源：Google Sheets API + 本地/服务器 `Event.xlsx`
- 前端：原生 HTML / CSS / JavaScript
- 文件上传：Multer
- 图片渲染：Puppeteer / Chromium
- 第三方集成：SeaTalk、Alpha Knowledge、Cloudflare Worker

## 关键目录

```text
.
├── server.js                     # 服务主入口，整合 API、轮询、推送、上传、部署回调
├── parser.js                     # Google Sheets / 甘特 / 配置表活动解析核心
├── excel-reader.js               # Event.xlsx 读取与类型映射
├── seatalk-bot.js                # SeaTalk 鉴权、消息发送、摘要生成、定时推送
├── alpha-knowledge-sync.js       # Alpha Knowledge Markdown 同步
├── auth.js                       # 获取 GOOGLE_REFRESH_TOKEN 的一次性授权脚本
├── public/
│   ├── index.html                # 页面骨架与更新日志
│   ├── app.js                    # 页面逻辑与交互
│   └── style.css                 # 主题与样式
├── scripts/
│   ├── send-group-calendar-image-push.js
│   ├── render-calendar-image-html.js
│   └── render-calendar-image.py  # 旧版渲染器，当前主链路已改为 HTML/Puppeteer
├── .github/workflows/deploy.yml  # GitHub Actions 自动部署
├── ecosystem.config.cjs          # PM2 运行配置
├── ops/
│   ├── deploy.sh                 # 服务器发布脚本
│   ├── bootstrap-server.sh       # 服务器初始化脚本
│   └── nginx/                    # Nginx 反向代理模板
├── cloudflare-worker/            # Google API 代理 Worker（可选）
├── data/                         # 活动快照、上传目录、Event.xlsx 等运行时数据
├── README.md
├── SETUP.md
└── .env.example
```

## 核心数据流

1. `server.js` 启动后使用 OAuth2 refresh token 访问 Google Sheets API。
2. 主表 `GOOGLE_SHEET_ID` 提供活动基础数据。
3. 第二份表 `GOOGLE_SHEET_ID_2` 中的 `1.0 event calendar` 与 `活动配置` 补充排期和奖励。
4. `excel-reader.js` 从 `Event.xlsx` 读取 Event 配置和活动类型。
5. `parser.js` 与 `buildTypedActivities()` 将多路数据合并、去重、别名归并、补期别、补类型、做少量人工修正。
6. 统一结果通过 `/api/calendar` 暴露给网页、SeaTalk、图片推送与 Alpha Knowledge。
7. 数据变更后通过 `sheet:update` 事件通知前端重新拉取。

## 统一活动模型

`/api/calendar` 返回的每项活动大致包含：

```json
{
  "name": "活动名",
  "source": "来源 sheet",
  "category": "分类（可选）",
  "startDate": "2026-04-01",
  "endDate": "2026-04-14",
  "eventId": 12345,
  "excelName": "Event 表名称",
  "types": ["任务活动", "网页活动"],
  "rewards": [
    { "name": "奖励名称", "itemId": "10001" }
  ]
}
```

## 快速开始

完整初始化请看 [SETUP.md](./SETUP.md)。

最短流程如下：

1. 安装依赖：`npm install`
2. 复制环境变量模板：`copy .env.example .env`
3. 配置 Google OAuth 与 Sheet ID
4. 运行 `node auth.js` 获取 `GOOGLE_REFRESH_TOKEN`
5. 准备 `Event.xlsx`（可选但推荐）
6. 启动：`npm start`
7. 打开 `http://localhost:3000`

## 当前 API

| 路径 | 方法 | 说明 |
|---|---|---|
| `/api/data` | `GET` | 返回原始 Google Sheets 缓存 |
| `/api/calendar` | `GET` | 返回合并后的统一活动数据 |
| `/api/event-upload` | `POST` | 上传 `Event.xlsx`，字段名为 `eventFile` |
| `/callback` | `POST` | SeaTalk 机器人回调入口 |
| `/api/seatalk-push` | `POST` | 触发文字版群推送，需 `x-internal-key` |
| `/api/seatalk-image-push` | `POST` | 触发图片版群推送，需 `x-internal-key` |
| `/healthz` | `GET` | 返回进程健康状态与运行时间 |
| `/readyz` | `GET` | 返回是否已完成初始化加载或快照兜底可用 |

说明：

- `/api/seatalk-push` 和 `/api/seatalk-image-push` 会校验请求头 `x-internal-key`，其值需等于 `SEATALK_SIGNING_SECRET`。

## 前端说明

前端不是独立业务层，而是 `/api/calendar` 的多视图展示层，主要包括：

- 顶部“正在进行”横向卡片
- 类型筛选栏
- 迷你月历
- 日期侧栏
- 按活动类型分组的泳道时间线
- 本月活动详情卡片
- 配置检查页中的 `Event.xlsx` 手动上传入口

## 环境变量

请以 [`.env.example`](./.env.example) 为准。这里列出最常用的一组：

### 必填

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REFRESH_TOKEN`
- `GOOGLE_SHEET_ID`

### 常用可选

- `GOOGLE_SHEET_ID_2`
- `EVENT_EXCEL_PATH`
- `PORT`
- `POLL_INTERVAL`
- `CALENDAR_PUBLIC_URL`

### SeaTalk

- `SEATALK_APP_ID`
- `SEATALK_APP_SECRET`
- `SEATALK_SIGNING_SECRET`
- `SEATALK_GROUP_ID`
- `PUSH_HOLIDAYS`
- `PUSH_MAKEUP_WORKDAYS`

### Alpha Knowledge

- `ALPHA_KNOWLEDGE_API_KEY`
- `ALPHA_KNOWLEDGE_EXPERT_ID`
- `ALPHA_KNOWLEDGE_CITATION_URL`

### 代理与渲染

- `GOOGLE_API_PROXY`
- `GOOGLE_API_PROXY_KEY`
- `CALENDAR_IMAGE_OUTPUT_PATH`
- `CALENDAR_IMAGE_API_URL`
- `PUPPETEER_EXECUTABLE_PATH`
- `HTTPS_PROXY` / `HTTP_PROXY`

### 部署

- GitHub Actions Secrets：`SERVER_HOST`、`SERVER_USER`、`SERVER_SSH_KEY`、`SERVER_PORT`、`SERVER_APP_DIR`

## 服务器同步与发布

这个项目当前就是要同步到服务器上的，代码里已经保留了两种链路。

### 推荐链路：GitHub Actions -> SSH -> 服务器自动部署

当前仓库已内置以下部署骨架：

- [`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml)
- [`ecosystem.config.cjs`](./ecosystem.config.cjs)
- [`ops/deploy.sh`](./ops/deploy.sh)
- [`ops/bootstrap-server.sh`](./ops/bootstrap-server.sh)
- [`ops/nginx/gng-activity-calendar.conf`](./ops/nginx/gng-activity-calendar.conf)

推荐发布流程：

1. 本地提交并 push 到 GitHub `master`
2. GitHub Actions 连接服务器
3. Actions 将当前仓库打包成发布包并上传到服务器
4. 服务器执行 `ops/deploy.sh`
5. 脚本在服务器上执行：
   - 解压发布包
   - `rsync` 到应用目录（保留 `.env`、`data/`）
   - `npm ci --omit=dev`
   - `pm2 restart gng-activity-calendar --update-env`
   - `curl http://127.0.0.1:<PORT>/api/calendar` 健康检查

这条链路适合正式更新，也是最推荐的同步方式。

### GitHub Actions 需要的 Secrets

在仓库 Settings -> Secrets and variables -> Actions 中配置：

- `SERVER_HOST`
- `SERVER_USER`
- `SERVER_SSH_KEY`
- `SERVER_PORT`（可选，默认 `22`）
- `SERVER_APP_DIR`（可选，默认 `/opt/gng-activity-calendar`）

### 备用链路：本地直传服务器

项目中存在本地辅助脚本：

- 旧的 `upload.js` / `deploy.js` 已退役，不再作为正式发布方式

它们已被 `.gitignore` 忽略，属于本地/运维脚本，不是共享仓库的一部分。若继续使用这条链路，请只在可信机器上维护，并自行管理其中的敏感配置。

### 当前服务器约定

- 线上目录：`/opt/gng-activity-calendar`
- 进程名：`gng-activity-calendar`
- 服务器上的 `Event.xlsx` 默认路径通常应为：
  `/opt/gng-activity-calendar/data/Event.xlsx`

## Cloudflare Worker（可选）

`cloudflare-worker/` 是一个可选的 Google API 代理，用于受限网络场景。

大致流程：

1. 进入 `cloudflare-worker/`
2. 配置 Wrangler
3. 设置 `PROXY_KEY`
4. 部署 Worker
5. 在主项目 `.env` 中配置：
   - `GOOGLE_API_PROXY`
   - `GOOGLE_API_PROXY_KEY`

## 维护注意事项

- `POLL_INTERVAL` 在代码中有最小值保护，实际不会低于 `30000` 毫秒。
- 当前 `Event.xlsx` 已改为手动上传同步，不再自动监听本地文件变更。
- SeaTalk 每日定时推送代码目前在 `server.js` 中被注释暂停，恢复前请先确认业务需要。
- 活动解析依赖较多业务规则和别名匹配，调整 Sheet 结构时要重点检查 `parser.js`。
- 第二份表的甘特解析包含固定行号与年度假设，跨新年度时需要重点复核。
- `/api/deploy` 已从服务代码中移除，当前正式发布链路为 GitHub Actions -> SSH -> PM2。

## 文档说明

- [SETUP.md](./SETUP.md)：初始化与环境配置
- [README.md](./README.md)：项目总览、能力与部署链路

如果文档与代码不一致，以代码实现为准，并优先补正文档。
