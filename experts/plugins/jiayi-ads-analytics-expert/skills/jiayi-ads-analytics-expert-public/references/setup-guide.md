# 广告平台 MCP Server 配置指南

本指南帮助你从零开始配置5个广告平台的 MCP Server，使其在 WorkBuddy 中可用。

---

## 1. 前置条件

| 依赖 | 最低版本 | 用途 |
|------|---------|------|
| Node.js | 18+ | 百度/360/腾讯/Google MCP |
| Python | 3.9+ | Microsoft Ads MCP |
| npm | 9+ | 安装 Node.js 依赖 |
| WorkBuddy 桌面端 | 最新版 | MCP Server 宿主 |

验证环境：
```bash
node --version   # v18.x+
python3 --version # 3.9+
npm --version    # 9.x+
```

---

## 2. 各平台凭证获取

### 2.1 百度营销

| 步骤 | 操作 | 说明 |
|------|------|------|
| 1 | 注册开发者 | 访问 [dev2.baidu.com](https://dev2.baidu.com)，注册百度商业开发者账号 |
| 2 | 创建应用 | 在"应用管理"中创建新应用，获取 **AppID** 和 **SecretKey** |
| 3 | 查看 userId | 登录百度营销后台 → 账户中心 → 查看账户 userId |
| 4 | OAuth 授权 | 使用 MCP 工具 `oauth_get_auth_url` 生成授权链接 → 浏览器授权 → `oauth_exchange_code` 换取 token |

配置文件：`~/.workbuddy/mcp-servers/baidu-ads-mcp/accounts.json`

### 2.2 360点睛

| 步骤 | 操作 | 说明 |
|------|------|------|
| 1 | 登录后台 | 访问360点睛后台 (e.jinqiaoai.com) |
| 2 | 获取 API 凭证 | 工具中心 → API管理 → 获取 **apiKey** 和 **apiSecret** |
| 3 | 准备账号密码 | 即登录360点睛的用户名和密码 |
| 4 | 登录验证 | 使用 MCP 工具 `login` 自动完成登录 |

配置文件：`~/.workbuddy/mcp-servers/360-ads-mcp/accounts.json`

### 2.3 腾讯广告

| 步骤 | 操作 | 说明 |
|------|------|------|
| 1 | 注册开发者 | 访问腾讯广告开发者中心，注册并创建应用 |
| 2 | 获取凭证 | 获取 **Client ID** 和 **Client Secret** |
| 3 | 查看 account_id | 在腾讯广告后台查看广告账户 ID |
| 4 | OAuth 授权 | 通过开发者中心 OAuth 授权页面获取 access_token 和 refresh_token |

通过环境变量配置（见 mcp.json 模板）。

### 2.4 Google Ads

| 步骤 | 操作 | 说明 |
|------|------|------|
| 1 | 创建项目 | 访问 [Google Cloud Console](https://console.cloud.google.com)，创建新项目 |
| 2 | 启用 API | 启用 Google Ads API |
| 3 | 创建 OAuth 凭证 | APIs & Services → Credentials → Create OAuth 2.0 Client ID |
| 4 | 获取 Developer Token | 在 Google Ads 后台 → Tools & Settings → API Center → 申请 developer token |
| 5 | 获取 Customer ID | Google Ads 后台右上角的 xxx-xxx-xxxx 格式 ID（去掉横线） |
| 6 | 获取 Refresh Token | 使用 OAuth Playground 或 gcloud CLI 获取 refresh_token |

通过环境变量配置（见 mcp.json 模板）。

### 2.5 Microsoft Ads (Bing)

| 步骤 | 操作 | 说明 |
|------|------|------|
| 1 | Azure AD 注册 | 访问 [Azure Portal](https://portal.azure.com) → App registrations → 新建注册 |
| 2 | 获取 Client ID | 应用概述页的 Application (client) ID |
| 3 | 获取 Developer Token | 在 [Microsoft Advertising](https://ads.microsoft.com) → Tools → Developer Token |
| 4 | 获取 Account/Customer ID | Accounts & Billing → 查看 Account ID 和 Customer ID |
| 5 | 设备码授权 | 使用 MCP 工具 `complete_auth` 完成设备码流程获取 refresh_token |

通过环境变量配置（见 mcp.json 模板）。

---

## 3. mcp.json 配置模板

将以下内容添加到 WorkBuddy 的 MCP 配置中（设置 → MCP Servers 或直接编辑 mcp.json）：

```json
{
  "mcpServers": {
    "baidu-ads": {
      "command": "node",
      "args": ["~/.workbuddy/mcp-servers/baidu-ads-mcp/index.mjs"],
      "env": {}
    },
    "qihu-ads": {
      "command": "node",
      "args": ["~/.workbuddy/mcp-servers/360-ads-mcp/index.mjs"],
      "env": {}
    },
    "tencent-ad": {
      "command": "node",
      "args": ["~/.workbuddy/mcp-servers/tencent-ad-mcp/dist/index.js"],
      "env": {
        "TENCENT_AD_CLIENT_ID": "YOUR_CLIENT_ID",
        "TENCENT_AD_CLIENT_SECRET": "YOUR_CLIENT_SECRET",
        "TENCENT_AD_ACCESS_TOKEN": "YOUR_ACCESS_TOKEN",
        "TENCENT_AD_REFRESH_TOKEN": "YOUR_REFRESH_TOKEN"
      }
    },
    "google-ads": {
      "command": "node",
      "args": ["~/.workbuddy/mcp-servers/google-ads-mcp/node_modules/@isteam/google-ads-mcp/dist/index.js"],
      "env": {
        "GOOGLE_ADS_CLIENT_ID": "YOUR_CLIENT_ID",
        "GOOGLE_ADS_CLIENT_SECRET": "YOUR_CLIENT_SECRET",
        "GOOGLE_ADS_REFRESH_TOKEN": "YOUR_REFRESH_TOKEN",
        "GOOGLE_ADS_DEVELOPER_TOKEN": "YOUR_DEVELOPER_TOKEN",
        "GOOGLE_ADS_CUSTOMER_ID": "YOUR_CUSTOMER_ID",
        "GOOGLE_ADS_LOGIN_CUSTOMER_ID": "YOUR_MCC_ID"
      }
    },
    "microsoft-ads": {
      "command": "~/.workbuddy/mcp-servers/microsoft-ads-mcp/.venv/bin/python3",
      "args": ["~/.workbuddy/mcp-servers/microsoft-ads-mcp/server.py"],
      "env": {
        "MICROSOFT_ADS_DEVELOPER_TOKEN": "YOUR_DEVELOPER_TOKEN",
        "MICROSOFT_ADS_CLIENT_ID": "YOUR_CLIENT_ID",
        "MICROSOFT_ADS_CUSTOMER_ID": "YOUR_CUSTOMER_ID",
        "MICROSOFT_ADS_ACCOUNT_ID": "YOUR_ACCOUNT_ID"
      }
    }
  }
}
```

> **注意**：将所有 `YOUR_XXX` 替换为你的实际凭证值。

---

## 4. Token 刷新自动化

### 各平台 Token 有效期

| 平台 | Access Token 有效期 | Refresh Token 有效期 | 刷新方式 |
|------|-------------------|---------------------|---------|
| 百度营销 | 10小时 | 30天 | MCP 内置自动刷新 + refresh-tokens.mjs 定时刷新 |
| 360点睛 | 会话级 | 随 session 过期 | 重新 login |
| 腾讯广告 | 24小时 | 30天 | 需定期用 refresh_token 换新 |
| Google Ads | 1小时 | 永久(除非撤销) | SDK 自动刷新 |
| Microsoft Ads | 1小时 | 90天 | MCP 内置自动刷新 |

### 使用 WorkBuddy Automation 定时刷新

推荐为百度和腾讯创建定时自动化任务：

1. 打开 WorkBuddy → 设置 → Automation
2. 创建新自动化：
   - **百度 Token 刷新**：每天执行 `node ~/.workbuddy/mcp-servers/baidu-ads-mcp/refresh-tokens.mjs`
   - **腾讯 Token 刷新**：每天通过 MCP 工具 `oauth_refresh_token` 刷新

---

## 5. 验证安装

安装完成后，在 WorkBuddy 中测试各平台连接：

| 平台 | 验证命令（MCP 工具） | 预期结果 |
|------|-------------------|---------|
| 百度营销 | `get_account_info` | 返回账户余额、状态信息 |
| 360点睛 | `get_account_info` | 返回账户基本信息 |
| 腾讯广告 | `advertiser_get` | 返回广告主信息 |
| Google Ads | `list_campaigns` | 返回广告系列列表 |
| Microsoft Ads | `search_accounts` | 返回账户列表 |

如果返回错误信息，请检查：
1. 凭证是否正确填写
2. Token 是否过期
3. MCP Server 进程是否正常启动（查看 WorkBuddy 日志）

---

## 6. 常见问题 FAQ

### Q: 安装时 npm install 报错？
**A**: 确保 Node.js 版本 >= 18，尝试清除缓存 `npm cache clean --force` 后重试。

### Q: 百度 OAuth 授权失败？
**A**: 检查 AppID 是否正确，确保应用状态为"已上线"。授权回调地址需要在 dev2.baidu.com 后台配置。

### Q: 360 登录提示密码错误？
**A**: 360 API 密码经过加密传输（AES），确保 apiSecret 长度为32位。如果修改过密码需要重新配置。

### Q: 腾讯广告 token 频繁过期？
**A**: access_token 仅24小时有效，建议配置自动刷新。refresh_token 30天有效，过期需重新授权。

### Q: Google Ads 报 DEVELOPER_TOKEN_NOT_APPROVED？
**A**: 新申请的 developer token 需要 Google 审核（通常1-3个工作日）。测试阶段可使用 Test Account。

### Q: Microsoft Ads 设备码授权超时？
**A**: 设备码有15分钟有效期，请在显示码后及时在浏览器中完成授权。

### Q: 如何同时管理多个账户？
**A**: 
- 百度/360：在 accounts.json 中添加多个账户条目
- 腾讯/Google/Microsoft：为每个账户创建独立的 MCP Server 实例（不同环境变量）

### Q: MCP Server 无法启动？
**A**: 
1. 检查 WorkBuddy 日志：Help → Toggle Developer Tools → Console
2. 手动运行命令测试：如 `node ~/.workbuddy/mcp-servers/baidu-ads-mcp/index.mjs`
3. 确认依赖已安装：检查对应目录下是否有 node_modules 或 .venv

### Q: 如何更新 MCP Server？
**A**: 重新运行 `bash setup-mcp.sh <platform>` 即可覆盖更新源码（不会覆盖 accounts.json 配置）。
