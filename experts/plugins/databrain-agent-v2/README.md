# DataBrain Agent 2.0

融合 DataBrain 经分、情报与舆情等多源数据，提供游戏及行业的综合分析与洞察。

- **插件 ID**：`databrain-agent-v2`
- **Agent**：`databrain-agent-v2`（`agents/databrain-agent-v2.md`）
- **展示名称**：DataBrain 数据专家 2.0

## 类型

Agent 型（单个 AI 专家）

## 功能

- 实体解析与权限路由（`databrain-entity-resolver`）
- 经分一方数据查询（revenue、DAU、留存等），支持经分权限游戏
- 三方市场情报（竞品排名 / 行业趋势 / SensorTower 等）
- 舆情报告与情感分析（评论 / Steam / YouTube / 社交媒体）
- 舆情纯指标（声量、KOL 榜单、直播数据、商店评分等）
- 经分 Datalab 报表兜底（`databrain-datalab-analyst`）
- 归因下钻与统计检验（`databrain-analysis` sandbox）
- 管理层数据查询（需 MGMT 权限，当前默认关闭）
- AI Gallery 作品上传（`databrain-ai-gallery-upload`）

## 使用示例

- 对比一下王者荣耀和原神最近 3 个月的流水趋势
- 【游戏名】近期在 Steam 上的玩家口碑如何？总结主要情绪和痛点
- MLBB 最近三十天每天的收入和下载
- 上周新增用户下降的归因分析，按渠道拆解贡献度

## 配置

在插件根目录创建 `.env`（勿提交到 Git）：

```bash
DATABRAIN_TOKEN="<your-token>"
DATABRAIN_HOST="https://databrain.intlgame.com"
DATABRAIN_DISPLAY_HOST="https://databrain.woa.com"
```

Token 获取地址：<https://databrain.woa.com/v2/user-center/personal-tokens-center>

也可在 WorkBuddy 专家配置的 `requiredConfig` 中填写 `DATABRAIN_TOKEN`（secret 类型）。

## Hooks

- `SessionStart`：加载 token、校验会话上下文
- `UserPromptSubmit`：校验 token、异步上报 expert operationLog

Hook 定义见 `hooks/hooks.json`。

## 头像

默认头像：`avatars/expert.png`（512×512 px，约 220KB）。在 `.workbuddy-plugin/plugin.json` 的 `avatar` 字段修改路径，或直接替换该文件。

- 格式：PNG（推荐）或 JPG
- 尺寸：512×512 px
- 大小：≤ 500KB

## 安装

将本目录放到 marketplace 下：

```
~/.workbuddy/plugins/marketplaces/my-experts/plugins/databrain-agent-v2/
```

确保 `my-experts` marketplace 已注册（见 `~/.workbuddy/plugins/marketplaces/my-experts/.codebuddy-plugin/marketplace.json`），然后在 WorkBuddy 中启用 **DataBrain 数据专家 2.0** 专家即可。

## 环境准备

插件内 Python skill 依赖第三方包，首次使用前在**本机 Python 3.10+** 安装：

```bash
cd ~/.workbuddy/plugins/marketplaces/my-experts/plugins/databrain-agent-v2
python3 -m pip install -r requirements.txt
```

### 依赖分组

| 分组 | 包 | 用途 |
|------|-----|------|
| 核心 | `requests`, `httpx` | hooks、entity-resolver、intelligence、datalab、gallery |
| 经分 / 舆情 / MGMT | `openai-agents`, `pydantic`, `loguru`, `pandas`, `numpy`, `aiohttp`, `openpyxl` | `databrain-dashboard-service`、`databrain-opinion-service`、`databrain-mgmt-service` |
| 舆情 BigQuery | `google-cloud-bigquery` | opinion 工具链 import；凭证由服务端/Rainbow 配置 |
| 分析 | `scipy`, `statsmodels`, `matplotlib`, `seaborn`, `shap` | `databrain-analysis` 统计检验与归因下钻（本地脚本 + sandbox） |

`databrain-opinion-metrics-service` 的 SQL 脚本仅需 `requests`（已含在核心分组）。

### 验证安装

```bash
# 核心 + 数据 skill 运行时
python3 -c "import requests, httpx, pandas, pydantic, loguru, aiohttp, openpyxl; print('runtime deps OK')"

# 经分 MCP 工具（Miniclip 等）
python3 -c "from agents import Agent; print('openai-agents OK')"

# 舆情 BigQuery 客户端
python3 -c "from google.cloud import bigquery; print('google-cloud-bigquery OK')"

# 分析 skill（可选，归因/统计场景）
python3 -c "import scipy, statsmodels, matplotlib, seaborn, shap; print('analysis deps OK')"

# hooks / token 校验
python3 scripts/get_user_context.py
```

### Sandbox 说明

`databrain-analysis` 在 E2B sandbox 内执行时，若环境缺包，agent 会先运行：

```bash
pip install pandas scipy statsmodels
# 归因下钻可选
pip install shap
```

本地已 `pip install -r requirements.txt` 可减少 sandbox 内重复安装。

## 目录结构

```
databrain-agent-v2/
├── .workbuddy-plugin/plugin.json   # WorkBuddy 专家配置
├── .codebuddy-plugin/plugin.json   # CodeBuddy 插件配置
├── agents/databrain-agent-v2.md    # Agent 定义
├── hooks/                          # SessionStart / UserPromptSubmit
├── scripts/                        # token、telemetry、env 工具
├── skills/                         # 数据与分析技能
└── avatars/expert.png
```
