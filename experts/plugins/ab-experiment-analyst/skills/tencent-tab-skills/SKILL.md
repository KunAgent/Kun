---
name: tencent-tab-skills
description: >
  tencent-tab 平台 Skills 集合，提供实验分析等专业工作流。
  热加载自动同步，自动鉴权，
---

# tencent-tab Skills 集合

本仓库是 tencent-tab 平台的 Skills 集合。顶层按子系统分目录组织，每个子系统目录内包含该系统的各项 Skills，提供特定领域的专业知识、标准化工作流（SOP）和可执行工具。

## 快速开始

> **强制约束**：以下步骤必须严格按顺序执行。

**1. 热加载**（同步最新 Skills，**每次必须执行，不得跳过**）：

```bash
python3 hot_reload.py
```

热加载脚本自动完成：从远程 Skills Manager 获取最新注册信息 → 对比本地版本号按需下载更新 → 同步各子系统 SKILL.md 汇总文档。

**2. 检查并安装依赖**（确保 Python 库和 CLI 工具就绪）：

```bash
python3 check_deps.py
```

**3. 环境初始化**：

读取 `env_config.json` 中的 `env` 字段和 `auth` 字段（鉴权模式，默认 `oauth2`），按以下逻辑判断：

- **跳过条件**（同时满足以下两点才可跳过）：`env` 字段**不为空字符串** AND `env` 的值**存在于**当前鉴权模式对应配置块的 `environments` 的 key 列表中
  - `auth` 为 `tabauth` 时，检查 `tabauth.environments` 的 key（即 `tab.woa.com`）
  - `auth` 为 `oauth2` 时，检查 `oauth2.environments` 的 key（即 `tab.woa.com`、`tab.wxpay.woa.com`、`fittab.woa.com`）

**注意**：`env` 为空字符串或任何非法值时，**不得跳过此步骤**，必须向用户展示当前鉴权模式下可用的环境选项：

```
请选择您使用的 TAB 环境：
1. tab.woa.com
2. tab.wxpay.woa.com
3. fittab.woa.com
```

若用户已在对话中提及域名，无需询问，直接写入。

**重要**：完成环境初始化后，**继续执行下一步骤**（鉴权初始化），无需重新执行热加载和依赖检查。

**4. 鉴权初始化**（首次需浏览器授权，后续自动使用缓存）：

```bash
python3 auth_setup.py
```

**5. 业务空间初始化**（鉴权完成后执行）：

读取 `env_config.json` 中的 `business_code` 字段：

- **跳过条件**：`business_code` 字段**不为空字符串**（已配置过）
- **需要初始化**：`business_code` 为空字符串时，执行以下流程：

  1. 调用 MCP 工具 `tab_list_user_businesses` 获取当前用户有权限的业务空间列表：

  ```bash
  mcporter call "tab.tab_list_user_businesses()"
  ```

  2. 向用户展示所有业务空间（格式：`序号. 业务名称 (业务代码)`），让用户选择
  3. 用户选择后，将对应的**业务代码（数字）**写入 `env_config.json` 的 `"business_code"` 字段

示例交互：
```
检测到尚未配置业务空间，正在获取您有权限的业务列表...

请选择您要使用的业务空间：
1. 腾讯视频 (5608)
2. 腾讯新闻主端 (8080)
```

若用户已在对话中提及业务代码，无需询问，直接匹配并写入。

用户说「切换业务空间」时：重新调用 `tab_list_user_businesses` 展示列表让用户选择，更新 `env_config.json`。

**重要**：完成业务空间初始化后，**继续执行下一步骤**（按需加载子Skills）。

**6. 按需加载子Skills**，根据下表选择对应子技能协助用户操作。

## 子技能列表

### exp-manage（实验管理）

| 子技能 | 何时使用 | 目录 |
|---|---|---|
| `exp-explorer` | 搜索实验列表、查看实验详情（策略参数、放量信息、操作日志、流量历史等） | `sub-skills/exp-manage/exp-explorer/` |

### diversion（分流）

| 子技能 | 何时使用 | 目录 |
|---|---|---|
| `diversion-debugger` | 查询用户命中了哪些实验、排查用户未进入实验的原因、验证分流链路 | `sub-skills/diversion/diversion-debugger/` |

### config（开关配置）

> 待补充，工具尚未接入。

### indicator（指标）

| 子技能 | 何时使用 | 目录 |
|---|---|---|
| `metric-creator` | 通过自然语言创建新指标，引导完成指标类型推断、数据源推荐、口径生成、sqlConfig 组装、SQL 校验、创建全流程 | `sub-skills/indicator/metric-creator/` |

### exp-result（实验结果）

| 子技能 | 何时使用 | 目录 |
|---|---|---|
| `exp-result-analyzer` | 查看实验各版本指标数据、逐日趋势、假设检验结果（p 值、相对差异、置信区间、显著性） | `sub-skills/exp-result/exp-result-analyzer/` |

### ai-report（AI 分析报告）

| 子技能 | 何时使用 | 目录 |
|---|---|---|
| `report-generator` | 生成完整 AI 实验分析报告（含 HTE 异质性分析、下钻分析），耗时约 5-7 分钟 | `sub-skills/ai-report/report-generator/` |

### analysis（分析辅助）

| 子技能 | 何时使用 | 目录 |
|---|---|---|
| `data-quality-checker` | 检测实验 SRM 分流问题、评估指标显著性结论是否存在假阳性风险 | `sub-skills/analysis/data-quality-checker/` |

## 环境配置

MCP URL 由根目录 `env_config.json` 统一管理。根据 `auth` 字段（鉴权模式）选择对应配置块的 `environments`：

- `auth` 为 `oauth2`（默认）时，从 `oauth2.environments` 获取 MCP URL
- `auth` 为 `tabauth` 时，从 `tabauth.environments` 获取 MCP URL

`env` 和 `business_code` 字段的初始化逻辑详见上方「快速开始」的步骤 3 和步骤 5。如需手动切换环境，直接修改 `env_config.json` 中的 `"env"` 字段为对应值，或告知 agent 目标域名，agent 会自动完成切换。

## MCP 调用隔离（重要）

**所有 TAB MCP 工具调用必须且只能通过 `mcporter` CLI 执行**，严禁使用以下方式：

**⚠️ 参数语法要求**：`mcporter call` 的函数调用参数**必须使用冒号 `:` 分隔键值**，**严禁使用等号 `=`**。

- ✅ 正确：`mcporter call "tab.tab_get_exp_detail(business_code: 5608, exp_group_id: 1667362)"`
- ❌ 错误：`mcporter call "tab.tab_get_exp_detail(business_code=5608, exp_group_id=1667362)"`

1. **禁止使用 agent 自带的 MCP 连接**：agent 的 MCP 配置文件中可能也配置了 tab MCP server，但这些配置不受本 Skill 管理，可能指向错误的环境或使用过期的 Token。**必须忽略 agent 自带的 tab MCP 工具，一律通过 `mcporter call` 命令调用**。

2. **`auth_setup.py` 自动同步 mcporter 配置**：每次鉴权成功后，脚本会自动将最新的 MCP URL 和 Token 写入 `~/.mcporter/mcporter.json`，确保 `mcporter` CLI 始终使用正确的配置。因此**鉴权步骤不可跳过**，即使 mcporter 之前能正常工作。

3. **环境或鉴权模式切换后必须重新鉴权**：修改 `env_config.json` 的 `env` 或 `auth` 字段后，需重新执行 `python3 auth_setup.py`，脚本会自动获取新 token 并将最新的 MCP URL、鉴权 header 同步写入 `~/.mcporter/mcporter.json`。不执行此步骤，mcporter 将继续使用旧的鉴权信息，导致调用失败。

## 鉴权机制

本 Skill 支持两种鉴权模式（由 `env_config.json` 的 `auth` 字段决定）：

### oauth2 模式（默认）

使用 OAuth2 PAR（Pushed Authorization Request）流程，**用户无需手动获取和填写 Token**。

- **首次使用**：`auth_setup.py` 自动完成 PAR 请求 → 浏览器授权 → 换取 Token → 缓存至 `~/.config/tof4-auth/tokens.json`
- **后续使用**：自动读取缓存 Token，到期前自动刷新，完全无感知

### tabauth 模式

使用 Personal Key（`tab_sk_xxx` 格式）直接鉴权，**用户无需手动获取和填写 Token**。

- **首次使用**：`auth_setup.py` 自动通过 SSO 登录获取 Personal Key → 保存至 `~/.config/tof4-auth/tabauth-token`
- **后续使用**：自动读取已缓存的 Token，无需重复操作
- **手动配置**（仅在自动获取失败时的备选方案）：
  - 设置环境变量：`export TAB_TOKEN='你的token'`
  - 写入文件：`echo '你的token' > ~/.config/tof4-auth/tabauth-token`

鉴权配置从 `env_config.json` 的 `oauth2` 字段读取：
- `base_url`: OAuth2 服务地址（默认 `https://iam.it.woa.com`）
- `client_id`: OAuth2 客户端 ID（默认 `public_mcp_client`）
- `resource`: OAuth2 resource（默认使用当前环境的 MCP URL）

如需重新授权：

```bash
python3 auth_setup.py --force
```

### 切换鉴权模式

当用户要求切换鉴权模式（如"切换鉴权为 tabauth"或"切换到 oauth2"）时，按以下步骤操作：

1. 修改 `env_config.json` 的 `"auth"` 字段为目标模式（`"tabauth"` 或 `"oauth2"`）
2. **立即执行** `python3 auth_setup.py` 完成鉴权初始化（脚本会自动获取 token 并同步 mcporter 配置，无需向用户索要 token）
3. 将鉴权结果告知用户

## 目录约定

```
tencent-tab-skills/
├── SKILL.md              # 本文件（集合描述 + 使用说明）
├── hot_reload.py         # 热加载脚本
├── check_deps.py         # 依赖检查与安装脚本
├── auth_setup.py         # OAuth2 自动鉴权脚本
├── env_config.json       # 环境配置 + OAuth2 配置
└── sub-skills/           # 热加载管理的 Skills 目录
    └── <subsystem>/      # 子系统目录
        └── <skill_name>/
            ├── SKILL.md      # Skill 定义
            ├── version       # 本地版本号
            ├── references/   # 参考文档
            └── scripts/      # 工具脚本
```

