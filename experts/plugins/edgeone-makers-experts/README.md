# Makers 开发专家团

4 位专家协作完成基于 EdgeOne Makers 平台的 Web 全栈一站式开发与部署任务。

## 类型

Team 型（专家团）

## 功能

帮助用户在 EdgeOne Makers 平台上完成从开发到部署的 Web 全栈一站式流程：
- **前端开发**：React/Vue/Next.js/Nuxt/Astro、静态页面、SPA/MPA、Tailwind CSS
- **后端开发**：Edge Functions (V8)、Cloud Functions (Node.js/Go/Python)、Middleware、KV Storage
- **AI Agent 开发**：Claude Agent SDK、OpenAI Agents SDK、LangGraph、CrewAI、DeepAgents
- **部署**：CLI 安装、Token 认证、一键部署（支持 China/Global 双站点、`--json` 机器可读输出）

## 团队成员

| 角色 | Agent ID | 名称 | 职责 | 绑定 Skills |
|------|----------|------|------|-------------|
| 主理人（交付总监） | `edgeone-makers-team-lead` | 齐上线 (Qi) | 需求分析、技术选型、团队调度、部署执行 | makers-deploy, makers-cli |
| 前端工程师 | `frontend-specialist` | 裴知页 (Pei) | UI 页面、React/Vue/Next.js、静态资源、样式交互 | makers-recipes |
| 后端工程师 | `backend-specialist` | 范云申 (Fan) | Edge/Cloud Functions、Middleware、KV Storage | makers-edge-functions, makers-cloud-functions, makers-middleware, makers-storage |
| AI Agent 工程师 | `agent-specialist` | 智行远 (Zhi) | AI Agent 端点、LLM 框架集成、SSE 流式响应 | makers-agents |

## 技能（Skills）

Skills 通过软链接引用自 [edgeone-makers-tools](https://github.com/TencentEdgeOne/edgeone-makers-tools) 仓库，以该仓库为内容源头。

| 技能名 | 说明 |
|--------|------|
| makers-deploy | 部署流程、CLI 命令、Token 管理、`--json` 输出解析 |
| makers-agents | AI Agent 开发（5 框架）、SSE 协议、Store API |
| makers-edge-functions | Edge Functions (V8 运行时) |
| makers-cloud-functions | Cloud Functions (Node.js/Go/Python) |
| makers-middleware | 请求中间件（拦截、重写、鉴权） |
| makers-storage | KV Storage 持久化存储 |
| makers-recipes | 项目模板与常用配方 |
| makers-cli | CLI 命令参考与非交互 flag |

## 使用示例

- 帮我搭建并部署一个 Web 全栈应用
- 把我的 Web 项目部署到 EdgeOne Makers
- 用 Edge Functions 和 KV 存储创建一个 API
- 帮我开发一个基于 Claude Agent SDK 的 AI 聊天应用

## 环境准备

> 一站式速查表。**主理人**会在执行 `edgeone makers dev/deploy` 前自动检查并兜底；这里给出最常用变量与安装命令的总览，便于团队和用户快速对齐。

### 必备工具

| 工具 | 安装命令 | 备注 |
|------|----------|------|
| EdgeOne CLI（>= 1.6.7） | `npm install -g edgeone@latest` | 部署、本地预览、登录、项目管理。低于 1.6.7 在沙箱里会卡交互 prompt |
| Node.js | 参考 [nodejs.org](https://nodejs.org/) 或 `nvm install --lts` | 用于前端构建、Cloud Functions Node 运行时 |
| Go（按需） | 参考 [go.dev/dl](https://go.dev/dl/) | 仅 Cloud Functions Go 运行时需要 |
| Python（按需） | `python3 --version` | Cloud Functions Python / CrewAI 框架需要 |

### 鉴权（二选一）

- **浏览器登录（推荐）**：`edgeone login --site <china|global> --local`
- **Token 登录**：`edgeone login --token <token> --local`，或导出 `EDGEONE_PAGES_API_TOKEN` 环境变量
- 验证：`edgeone whoami`

### 关键环境变量

| 变量名 | 用途 | 来源 / 设置方式 |
|--------|------|----------------|
| `EDGEONE_PAGES_API_TOKEN` | EdgeOne Pages API Token，用于非交互 / CI 部署 | 控制台 → API Token；或 `edgeone login --token` 自动写入 `<cwd>/.edgeone/auth.json` |
| `AI_GATEWAY_API_KEY` | Makers AI Gateway 网关密钥（agents 项目调用 LLM） | **平台自动注入**（部署时根据 `.env.example` 申明） |
| `AI_GATEWAY_BASE_URL` | Makers AI Gateway 网关地址 | **平台自动注入** |
| `AI_GATEWAY_MODEL` | （可选）默认模型名 | `.env.example` 中可声明默认值 |
| `WSA_API_KEY` | 仅在 Agent 使用 `context.tools.web_search` 时需要 | `edgeone makers env set WSA_API_KEY <value>` |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | （可选）Supabase 数据库 | `edgeone makers env set <NAME> <value>` |

> 💡 `AI_GATEWAY_API_KEY` 与 `AI_GATEWAY_BASE_URL` 由 EdgeOne Makers 平台自动注入，**不需要也不应当**人工设置。**前提**：项目 `.env.example` 中必须声明这两个变量名（无须填值），CLI 部署时才会注入对应运行时。

### 常用安装/初始化命令速查

```bash
# 1. 安装 / 升级 CLI（必须 >= 1.6.7）
npm install -g edgeone@latest && edgeone -v

# 2. 登录（推荐浏览器）
edgeone login --site china --local        # 国内站
edgeone login --site global --local       # 国际站
edgeone whoami                            # 验证登录态

# 3. 关联项目并启动本地预览（必带 --skip-env-sync，避免交互卡死）
edgeone makers dev --name <project> --skip-env-sync

# 4. 部署（机器可读 JSON 输出）
edgeone makers deploy -n <project> -t <token> --json

# 5. 设置环境变量（非自动注入的密钥）
edgeone makers env set <NAME> "<value>"
```

## 非交互模式（WorkBuddy / CI）

CLI >= 1.6.7 支持全非交互执行，避免沙箱中交互 prompt 卡住：

```bash
# Dev (Agent 项目)
edgeone makers dev --name <project> --skip-env-sync -t <token>

# Deploy (JSON 输出)
edgeone makers deploy -n <name> -t <token> --json

# Login (Token，自动检测站点)
edgeone login --token <token>
```

## 头像

头像在 `avatars/` 目录下。如需替换为自定义头像，要求：
- 格式：PNG（推荐）或 JPG
- 尺寸：512×512 px
- 大小：单张不超过 500KB

## 打包

```bash
zip -r edgeone-makers-experts.zip edgeone-makers-experts/
```
