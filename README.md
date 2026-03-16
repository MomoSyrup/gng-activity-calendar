# Google Sheet 实时同步网页

将 Google Sheet 的数据实时同步到网页上。后端定时轮询 Google Sheets API，检测到数据变化后通过 WebSocket 即时推送给所有已连接的客户端。

## 技术栈

- **后端** — Node.js + Express + Socket.io
- **前端** — 原生 HTML / CSS / JS + Socket.io 客户端
- **Google API 认证** — OAuth2（个人 Google 账号）
- **实时机制** — 后端轮询 + WebSocket 推送

## 项目结构

```
├── server.js           # Node.js 后端主文件
├── auth.js             # 一次性 OAuth2 授权脚本
├── package.json        # 依赖管理
├── .env                # 环境变量（不提交到 Git）
├── .env.example        # 环境变量模板
└── public/
    ├── index.html      # 前端页面
    ├── style.css       # 样式
    └── app.js          # 前端逻辑
```

## 设置步骤

### 第 1 步：创建 Google Cloud 项目并启用 API

1. 前往 [Google Cloud Console](https://console.cloud.google.com/) 创建一个新项目（或使用已有项目）。
2. 在左侧菜单找到 **API 和服务 → 库**，搜索并启用 **Google Sheets API**。

### 第 2 步：创建 OAuth2 凭据

1. 进入 **API 和服务 → 凭据**，点击 **创建凭据 → OAuth 客户端 ID**。
2. 如果提示需要配置同意屏幕，先完成配置：
   - 选择 **外部** 用户类型。
   - 填写应用名称和你的邮箱。
   - 在 **范围 (Scopes)** 页面可以跳过（auth.js 会自动请求所需范围）。
   - 在 **测试用户** 页面，添加你自己的 Google 邮箱地址。
   - 完成同意屏幕配置后，回到凭据页面继续创建。
3. 应用类型选择 **Web 应用**。
4. 在 **已获授权的重定向 URI** 中添加：`http://localhost:3001/oauth2callback`
5. 创建完成后，复制 **客户端 ID** 和 **客户端密钥**。

### 第 3 步：配置环境变量

复制 `.env.example` 为 `.env`：

```bash
cp .env.example .env
```

填入刚才获取的值：

```
GOOGLE_CLIENT_ID=你的客户端ID
GOOGLE_CLIENT_SECRET=你的客户端密钥
GOOGLE_SHEET_ID=你的Sheet_ID
```

> **获取 Sheet ID**：打开 Google Sheet，地址栏 URL 中 `/d/` 和 `/edit` 之间的字符串就是 Sheet ID。

### 第 4 步：安装依赖

```bash
npm install
```

### 第 5 步：运行授权脚本获取 Refresh Token

```bash
node auth.js
```

浏览器会自动打开 Google 登录页面。用你的 Google 账号登录并授权后，终端会输出一个 `GOOGLE_REFRESH_TOKEN=...`。将这行复制到 `.env` 文件中。

> 此步骤只需执行一次。Refresh token 长期有效，除非你手动撤销授权。

### 第 6 步：启动服务

```bash
npm start
```

在浏览器中打开 `http://localhost:3000` 即可看到实时同步的 Google Sheet 数据。

## 环境变量说明

| 变量名 | 说明 | 示例 |
|---|---|---|
| `GOOGLE_CLIENT_ID` | OAuth2 客户端 ID | `123456.apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` | OAuth2 客户端密钥 | `GOCSPX-xxxxx` |
| `GOOGLE_REFRESH_TOKEN` | 授权后获取的刷新令牌 | （运行 `node auth.js` 获取） |
| `GOOGLE_SHEET_ID` | Google Sheet 的 ID | `1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms` |
| `SHEET_RANGE` | 要读取的工作表范围 | `Sheet1` 或 `Sheet1!A1:D100` |
| `POLL_INTERVAL` | 轮询间隔（毫秒） | `5000`（即 5 秒） |
| `PORT` | 服务器端口 | `3000` |

## 工作原理

1. 服务启动时，使用 OAuth2 refresh token 认证访问 Google Sheets API，拉取初始数据。
2. 之后每隔 `POLL_INTERVAL` 毫秒重新读取 Sheet 数据，与缓存进行对比。
3. 检测到数据变化时，通过 Socket.io（WebSocket）将新数据推送给所有已连接的客户端。
4. 前端收到更新后，重新渲染表格，变化的单元格会有高亮闪烁动画。

## API

| 端点 | 方法 | 说明 |
|---|---|---|
| `/api/data` | GET | 返回当前缓存的 Sheet 数据 |

## WebSocket 事件

| 事件名 | 方向 | 说明 |
|---|---|---|
| `sheet:update` | 服务端 → 客户端 | 推送最新的 Sheet 数据（二维数组） |

## 注意事项

- `.env` 中包含敏感的 OAuth2 凭据，**不要提交到 Git**（已在 `.gitignore` 中排除）。
- Google Sheets API 有[配额限制](https://developers.google.com/sheets/api/limits)，默认每分钟 60 次读取请求。轮询间隔设为 5 秒（每分钟 12 次）留有充足余量。
- 如需读取多个工作表或特定范围，修改 `.env` 中的 `SHEET_RANGE`，例如 `Sheet1!A1:F50`。
- 如果应用处于 Google Cloud 的"测试"模式，refresh token 可能在 7 天后过期。将应用发布（或设为内部应用）可使 token 长期有效。
