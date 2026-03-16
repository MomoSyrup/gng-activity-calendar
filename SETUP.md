# Google Cloud 前置配置指南

本文档详细说明如何配置 Google Cloud，以便后端通过 OAuth 2.0（个人 Google 账号）访问 Google Sheets API。

---

## 第一步：创建 Google Cloud 项目

1. 打开 [Google Cloud Console](https://console.cloud.google.com/)
2. 如果你还没有 Google Cloud 账号，使用 Google 账号登录即可（免费）
3. 点击页面顶部的 **项目选择器**（显示 "Select a project" 或已有项目名）
4. 在弹窗中点击右上角的 **NEW PROJECT**（新建项目）
5. 填写项目信息：
   - **Project name**：输入一个容易识别的名称，例如 `sheet-sync`
   - **Organization**：如果有组织可以选择，个人账号保持默认即可
   - **Location**：保持默认
6. 点击 **CREATE** 创建项目
7. 等待几秒钟，页面顶部的通知会提示项目创建成功
8. 点击通知中的 **SELECT PROJECT**，切换到新创建的项目

## 第二步：启用 Google Sheets API

1. 确保当前已选中刚创建的项目（页面顶部可确认）
2. 在左侧导航栏中选择 **APIs & Services** > **Library**（API 库）
   - 或者直接访问：https://console.cloud.google.com/apis/library
3. 在搜索框中输入 `Google Sheets API`
4. 点击搜索结果中的 **Google Sheets API**
5. 在详情页中点击 **ENABLE**（启用）按钮
6. 等待启用完成，页面会自动跳转到 API 概览页

## 第三步：配置 OAuth 同意屏幕

OAuth 同意屏幕是用户授权时看到的页面，即使只有你自己使用也需要配置。

1. 在左侧导航栏中选择 **APIs & Services** > **OAuth consent screen**
   - 或者直接访问：https://console.cloud.google.com/apis/credentials/consent
2. **User Type** 选择 **External**（外部），点击 **CREATE**
3. 填写必填信息：
   - **App name**：应用名称，例如 `Sheet Sync`
   - **User support email**：选择你的邮箱
   - **Developer contact information**：填写你的邮箱
4. 其他字段可以留空，点击 **SAVE AND CONTINUE**
5. 在 **Scopes**（权限范围）页面：
   - 点击 **ADD OR REMOVE SCOPES**
   - 搜索并勾选 `Google Sheets API` 下的 `.../auth/spreadsheets.readonly`（只读权限）
   - 点击 **UPDATE**，然后 **SAVE AND CONTINUE**
6. 在 **Test users**（测试用户）页面：
   - 点击 **+ ADD USERS**
   - 输入你自己的 Google 邮箱地址
   - 点击 **ADD**，然后 **SAVE AND CONTINUE**
7. 确认摘要页无误，点击 **BACK TO DASHBOARD**

> **重要**：应用处于 "Testing"（测试）状态时，只有添加的测试用户才能授权。这对于个人使用完全足够，无需发布。

## 第四步：创建 OAuth Client ID（客户端凭据）

1. 在左侧导航栏中选择 **APIs & Services** > **Credentials**（凭据）
   - 或者直接访问：https://console.cloud.google.com/apis/credentials
2. 点击页面顶部的 **+ CREATE CREDENTIALS**（创建凭据）
3. 在下拉菜单中选择 **OAuth client ID**
4. **Application type** 选择 **Desktop app**（桌面应用）
5. **Name** 可以保持默认或输入一个名称，例如 `Sheet Sync Desktop`
6. 点击 **CREATE**（创建）
7. 弹窗会显示 Client ID 和 Client Secret，点击 **DOWNLOAD JSON**（下载 JSON）
8. **将下载的文件重命名为 `credentials.json`，并放置到项目根目录** `d:\C project\credentials.json`

> **安全提示**：`credentials.json` 包含你的客户端密钥，请勿提交到 Git 或分享给他人。

## 第五步：获取 Google Sheet ID

Sheet ID 是 Google Sheet URL 中的一段字符串，用于标识具体的表格。

例如，URL 为：
```
https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms/edit
```

其中 `1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms` 就是 Sheet ID。

记录下你的 Sheet ID，后续配置 `.env` 文件时需要用到。

## 第六步：首次授权（启动项目后）

首次运行服务器时，程序会自动引导你完成授权：

1. 终端会输出一个授权链接，在浏览器中打开
2. 使用你的 Google 账号登录
3. 如果看到 "Google hasn't verified this app" 警告，点击 **Advanced** > **Go to Sheet Sync (unsafe)**
4. 点击 **Allow**（允许）授权应用访问你的 Google Sheets
5. 授权成功后，程序会自动获取 token 并保存到 `token.json`
6. 之后每次启动服务器都会自动使用保存的 token，无需重复授权

> **注意**：`token.json` 会在首次授权后自动生成，包含 refresh token，同样不要提交到 Git。

---

## 配置完成后的检查清单

- [ ] Google Cloud 项目已创建
- [ ] Google Sheets API 已启用
- [ ] OAuth 同意屏幕已配置，并添加了测试用户
- [ ] OAuth Client ID 已创建（Desktop app 类型）
- [ ] 凭据文件已下载并保存为 `credentials.json`（在项目根目录）
- [ ] 已记录 Google Sheet ID

完成以上步骤后，就可以继续进行项目的代码开发了。首次启动服务器时会引导你完成 OAuth 授权。
