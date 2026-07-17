# 招聘链路 MCP 自检 + 安装引导 · mcp-setup

> **用途**：招聘业务场景路由前的 MCP 探活、依赖矩阵、失败时的安装引导。
> **加载时机**：① 首轮触发 agent 时 ② 切换到任何 MCP 依赖场景前 ③ MCP 调用失败需要引导用户安装时。**非常驻**——正常会话已确认 MCP 接通后无需重复 Read。
> **白名单例外**：用户问的是 §依赖矩阵里标 🟢 的事（建模/JD/出题/审核/面评清洗/岗位建模），**跳过自检**直接进 skill，不用读本文件。

---

## §0 招聘链路 MCP 自检（CRITICAL — 招聘业务场景路由前必做）

招聘业务的所有数据请求（待办 / 面试安排 / 简历搜索 / 简历详情 / 知识库检索 / 面评提交等）都依赖 **`recruit-mcp`**。

**首轮触发本 agent 时**（或用户切换到任何 MCP 依赖场景前），**必须先做一次 MCP 探活**。失败时直接进入"安装引导"，**不要**进入正式 skill 流程，**不要**走兜底话术（"知识库未收录"会误导用户以为是内容缺失）。

### MCP 依赖矩阵

| Skill / 场景 | 是否依赖 MCP | 失败时行为 |
|---|---|---|
| `recruitment-inquiry-bot`（招聘智能问询） | 🔴 强依赖 | 必须 MCP 才能检索知识库 |
| `zhaopin-operations`（校招搜简历） | 🔴 强依赖 | 必须 MCP 调 `post_v1_resume_search` |
| `zhaopin-social-operations`（社招搜简历） | 🔴 强依赖 | 必须 MCP 调社招搜索 API |
| `interview-assistant · T/T2`（待办） | 🔴 强依赖 | 必须 MCP 拉本人待办（v4.5 起 T 默认同时查校招 + 社招两类待办） |
| `interview-assistant · S`（面试安排） | 🔴 强依赖 | 必须 MCP 调度 |
| `interview-assistant · A`（按 RID 拉简历详情） | 🔴 强依赖 | 必须 MCP |
| `interview-assistant · D`（面评填写/转写） | 🔴 强依赖 | 必须 MCP |
| `interview-assistant · B`（评简历） | 🟡 部分依赖 | 候选人主数据需 MCP；本地材料兜底可跑 |
| `interview-assistant · C`（出题/面试计划） | 🟡 部分依赖 | 候选人主数据需 MCP；本地材料兜底可跑 |
| `requirement-communication-assistant`（需求沟通链路） | 🟡 部分依赖 | 模型/词典走 MCP 文档接口；拉取失败静默降级走本地兜底，链路不中断 |
| `assessment-quality-expert`（建模/JD/出题/审核） | 🟢 不依赖 | 纯方法论本地可跑 |
| `interview-data-processor`（面评清洗） | 🟢 不依赖 | 本地 Excel 处理 |
| `interview-talent-modeler`（岗位建模） | 🟢 不依赖 | 本地脚本 |

### 探活方法（任一可用即视为接通）

1. 检查当前会话是否暴露了 `mcp__recruit-mcp__*` 工具（最直观）
2. 或 Read `~/.workbuddy/mcp.json`，看 `mcpServers` 里是否有未 disabled 的 `recruit-mcp` 段（含 `url: https://zhaopin.mcp.it.woa.com`）

### 失败时的接入引导（WorkBuddy 口径 · 一键弹窗连接优先）

> 🆕 **recruit-mcp 已支持一键弹窗连接**：地址 `https://zhaopin.mcp.it.woa.com`，连接时**只需太湖 SSO 授权**，**不再需要单独申请「招活 Token」**。绝大多数情况引导用户走「方式 A 弹窗连接」即可。

当探活失败时，**不要进入任何 MCP 依赖 skill**，按下面顺序引导：

**方式 A · 一键弹窗连接（首选，最简单）**

```
⚠️ 招聘 MCP（recruit-mcp）还没连上，本次请求需要它（场景：xxx）。

连接很简单，只要一步：
① WorkBuddy 会弹出「是否连接 recruit-mcp（https://zhaopin.mcp.it.woa.com）」窗口 → 点「连接」
② 按提示用太湖 SSO 授权即可（无需手填任何 Token）

如果没弹窗，去 WorkBuddy 左侧「连接器」→ 右上角「自定义连接器」→ 找到 recruit-mcp → 点「连接」/「Trust」。

连好后告诉我「继续」。
```

**方式 B · 手动写配置（仅当客户端不支持弹窗连接时）**

```
打开 ~/.workbuddy/mcp.json，把以下段加进 mcpServers 字段：

{
    "mcpServers": {
        "recruit-mcp": {
            "url": "https://zhaopin.mcp.it.woa.com",
            "headers": {
                "Authorization": "Bearer <太湖PAT>"
            },
            "disabled": false
        }
    }
}

- 太湖 PAT 申请：https://tai.it.woa.com/user/pat（Authorization 必须带 "Bearer " 前缀）
- ⚠️ 已有 mcpServers 字段时只合并 "recruit-mcp" 这个键，不要覆盖你已有的 MCP（如 hr_data_service）
- 保存后到「连接器」→「自定义连接器」→ recruit-mcp → 点「连接」/「Trust」

完成后告诉我「继续」。
```

**安全提醒**：太湖 PAT 不要贴在对话里 / 提交 Git / 截图外发；mcp.json 仅存本地（权限建议 0o600）；泄漏立刻到 https://tai.it.woa.com/user/pat 吊销重申。

> 💡 **不再需要「招活 Token / recruit-Authorization」**：旧版要求的第二个 token 已下线，连接只认太湖授权。若在旧文档/旧配置里看到 `recruit-Authorization` / `ZHAOPIN_TOKEN`，可忽略或删除。

**你可以先做的（不依赖 MCP，立刻可用）**：列出 §依赖矩阵中标 🟢 的 skill，让用户在等接入时也能继续工作。

### 自检例外（白名单）

如果用户问的就是 §依赖矩阵里 🟢 标识的事（建模 / JD / 出题 / 审核 / 面评清洗 / 岗位建模），**跳过 MCP 自检**，直接进入对应 skill。
