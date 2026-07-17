# 腾讯招聘专家 · Tencent Recruitment Expert

> WorkBuddy 招聘 agent — 三层能力架构：① 招聘全流程（校招/社招）② HR 数据查询 ③ 定时任务调度。覆盖 招聘需求沟通 → 人才搜索 → 简历筛选 → 胜任力建模 / JD / 面试设计 → 面评审核 → 面试数据分析 → 待办查询 → 面试安排 → **招聘流程跟踪** → **校招签约后保温** → 招聘智能问询 → **HR 数仓查询（员工/组织/招聘漏斗等）** → **定时任务调度**。服务 **招聘经理 / 面试官 / HR / BP / 数据分析**。

- **包名**：`txzhaopin`
- **版本**：1.9.21
- **分类**：`09-OperationsHR`
- **运行环境**：WorkBuddy

---

## 目录结构

```
txzhaopin/
├── .codebuddy-plugin/
│   └── plugin.json                              # 插件清单
├── agents/
│   └── recruitment-expert.md                    # 招聘专家 agent（路由 + 双链路 + 定时任务横切层）
├── avatars/
│   └── expert.png                               # 头像 512×512
├── skills/                                      # 17 个 skills
│   # —— 招聘业务域（9 个 · 核心）——
│   ├── requirement-communication-assistant/     # 招聘需求沟通：需求识别 → 画像+胜任力 → JD 端到端
│   ├── assessment-quality-expert/               # 甄选方法论 + 质量裁判 + 面试设计中心
│   ├── zhaopin-operations/                      # 校招简历搜索 / 筛选 / 推荐
│   ├── zhaopin-social-operations/               # 社招简历搜索 / 粗读 / 精读
│   ├── interview-assistant/                     # 面试官日常：T 待办 / S 安排 / A 拉简历 / B 评 / C 出题 / D 写面评
│   ├── interview-data-processor/                # 面评 Excel → 标准化 JSON
│   ├── interview-talent-modeler/                # 面评数据 → 岗位能力模型
│   ├── recruitment-inquiry-bot/                 # 招聘智能问询（知识库检索）
│   ├── recruitment-process-tracker/             # 招聘流程跟踪（社招专用 · 招聘经理 case-level 视角）
│   # —— 校招专属应用层 ——
│   ├── warming-recruit-manager/                 # 校招签约后保温工作台（招聘经理日常 SOP）
│   # —— HR 数据副链路（5 个）——
│   ├── hr-data-router/                          # HR 数仓查询统一入口（编排下面 4 个）
│   ├── hr-data-sql-builder/                     # NL2SQL（StarRocks）
│   ├── data-permission-checker/                 # 数据权限排查
│   ├── data-warehouse-api-codegen/              # 前端调数仓接口代码生成
│   ├── hr-vue-next/                             # HR 业务组件库（员工/组织/岗位选择器）
│   # —— 横切能力 ——
│   ├── daily-routine-builder/                   # 把"每天/每周自动跑"翻译为 automation_update 调度
│   └── hrclaw-messenger/                        # HRClaw 邮件 + 企微 Tips 通用发送通道（被其他 skill 调用）
└── README.md                                    # 本文件
```

---

## 17 个技能（skills）

### 🎯 招聘业务域（9 个 · 核心）

| Skill | 作用 | 典型触发 |
|---|---|---|
| **requirement-communication-assistant** | 招聘需求沟通三段式链路：需求识别 → 人才画像 + 胜任力模型 → 可发布 JD | `/需求沟通` "我有一个招聘需求" "新开了一个 HC" |
| **assessment-quality-expert** | 甄选方法论 + 质量裁判 + 面试设计中心（建模 / JD / 出题 / 审题 / 审面评 / 测评方案 / AI 防作弊） | `/搭模型` `/写JD` `/出套题` `/审面评` |
| **zhaopin-operations** | 腾讯校招平台简历搜索 / 筛选 / 推荐（recruit-mcp 直连） | `/搜简历` "校招搜索" |
| **zhaopin-social-operations** | 腾讯社招平台简历搜索 / 粗读 / 精读 / 收藏 | `/社招搜索` "社招简历" |
| **interview-assistant** | 面试官日常工具入口（T 待办 / S 面试安排 / A 拉简历 / B 评 / C 出题 / D 写面评） | `/待办` `/面试安排` `/评简历` `/面试计划` `/填面评` |
| **interview-data-processor** | 面评 Excel / CSV → 标准化 JSON | `/清洗面评` |
| **interview-talent-modeler** | 清洗后面评数据 → 按部门生成岗位能力模型 | `/建岗位模型` |
| **recruitment-inquiry-bot** | 招聘智能问询：知识库回答活水/伯乐/Offer/三方协议/HR 系统操作 | `/招聘问询` "活水规则" "伯乐奖金" |
| **recruitment-process-tracker** | 招聘流程跟踪（**社招专用** · 招聘经理 case-level 视角）：我负责的流程 / 跨人查别的 hr / 偏慢预警 | `/流程跟踪` `/招聘进度` "查我负责的岗位流程" |

### ⭐ 校招专属应用层

| Skill | 作用 | 典型触发 |
|---|---|---|
| **warming-recruit-manager** | 校招签约后**保温工作台**：识别毁约风险 / 重点关注名单 / 写保温话术 / 通知导师上级 / 按 BG/部门组织视角 / 每日保温播报 | "校招保温" "待入职名单" "通知导师" "重点关注" |

### 📊 HR 数据副链路

| Skill | 作用 | 典型触发 |
|---|---|---|
| **hr-data-router** | HR 数仓查询统一入口（编排下面 4 个）：员工 / 组织 / 合同 / 调动 / 入离职 / 编制 / 招聘漏斗历史 / 渠道转化 / 校招学校分布等 | "查员工花名册" "招聘漏斗" "组织架构" |
| **hr-data-sql-builder** | NL2SQL（StarRocks 数仓） — 自然语言 → SQL | 由 hr-data-router 编排 |
| **data-permission-checker** | 数据权限排查（脱敏值是否因权限不足） | "我有哪些表权限" "为什么这个字段是 0" |
| **data-warehouse-api-codegen** | 前端调数仓接口代码生成（**仅前端**用，后端禁调） | "给前端项目生成调数仓的代码" |
| **hr-vue-next** | HR 业务组件库（员工 / 组织 / 岗位选择器，Vue 3 + TDesign） | 开发 HR 页面时 |

### 🛠️ 横切能力

| Skill | 作用 | 典型触发 |
|---|---|---|
| **daily-routine-builder** | 把"每天/每周自动跑"翻译成 `automation_update` 调度任务（已预置喝水提醒/晨报/招聘漏斗/校招保温模板） | `/定时任务` "每周一发我招聘漏斗" "每月 1 号给我组织变动月报" |
| **hrclaw-messenger** | HRClaw 邮件 + 企微 Tips 通用发送通道（playwright-cli + OA SSO Cookie），**被其他 skill 调用** | （内部工具，不直接对用户暴露） |

完整的 slash 命令与关键词路由表见 [`agents/recruitment-expert.md`](./agents/recruitment-expert.md)。

---

## 安装

在 WorkBuddy 专家中心找到「腾讯招聘专家」一键安装（agent + 17 个 skills 一起进来）。安装时会弹出 userConfig 表单，按下面 §配置招聘 MCP 填好 Token 即完成。

### 技能依赖概览（统一索引）

> 一张表看清本专家所有外部依赖、归属、安装方式与必选性。**绝大多数用户开箱即用**——核心运行只需 Python 标准库 + 一个 MCP；其余皆为可选/特定场景才用。

| 依赖 | 类型 | 谁用到 | 必选性 | 安装方式 |
|---|---|---|---|---|
| **Python ≥ 3.8**（建议 3.10+）| 运行时 | 所有带脚本的 skill | ✅ 必选 | 系统自带 / 官网 |
| **Python 标准库**（`json`/`subprocess`/`pathlib`/`urllib`…）| 运行时 | 所有运行时脚本 | ✅ 必选 | 无需安装，开箱即用 |
| **`recruit-mcp`**（招聘 MCP）| MCP 服务 | 招聘业务全域（待办/简历/面评/问询…）| ✅ 必选 | 见下方 §配置招聘 MCP（写 `~/.workbuddy/mcp.json` + 连接器连接）|
| **`hr_data_service`**（HR 数仓 MCP）| MCP 服务 | hr-data-router / hr-data-sql-builder / recruit-data-dashboard | ⬜ 用到 HR 数据/社招看板时 | 写 `~/.workbuddy/mcp.json` 的 `hr_data_service` 段 + 连接器连接（探活引导内置在 skill 里）|
| **`iWiki` 连接器** | MCP 服务 | mapping（仅"沉淀到知识库"环节）| ⬜ 用 mapping 且要沉淀时 | WorkBuddy 左侧「连接器」→「自定义连接器」→ iWiki → 连接（搜索/出报告不依赖它）|
| **mcporter** | CLI | recruit-mcp 命令行兼容路径 / zhaopin-* 老用户 | ⬜ 可选（WorkBuddy 直配则不需要）| `npm install -g mcporter` |
| **playwright-cli** | CLI | hrclaw-messenger（邮件 + 企微 Tips 发送通道）| ⬜ 用 HRClaw 发送时 | `npm install -g @playwright/cli@latest` |
| **pdfplumber** | Python 包 | 解析 PDF 类输入的 skill（如简历/转写 PDF）| ⬜ 可选 | `pip install pdfplumber` |
| **pandas + openpyxl** | Python 包 | `recruitment-inquiry-bot/scripts/build_term_dict.py`（**离线维护工具**，agent 运行时不调）| ⬜ 仅开发者维护术语词典时 | `pip install pandas openpyxl` |

> 💡 **一句话**：普通用户装好专家 + 一键连上 `recruit-mcp`（弹窗点「连接」，太湖 SSO 授权，无需手填 Token）即可用；HR 数据/看板再连 `hr_data_service`；mapping 沉淀再连 iWiki；mcporter/playwright/pdfplumber/pandas 都是特定场景才需要的可选项。
>
> ⚠️ 30+ 运行时脚本的环境要求按所属 skill 分散在各自 `SKILL.md` 中，本表是**统一索引**，细节仍以各 skill 文档为准。

---

## 连接招聘 MCP（必做）

招聘业务的所有数据（待办 / 面试安排 / 简历 / 知识库问询 / 面评 / 转写等）都通过 **`recruit-mcp`** 拉取，地址 `https://zhaopin.mcp.it.woa.com`。

### 一键弹窗连接（推荐 · 只需太湖授权）

🆕 recruit-mcp 已支持在 WorkBuddy 直接弹窗连接，**不再需要单独申请「招活 Token」**：

1. 首次触发招聘专家时，WorkBuddy 会弹出「**是否连接 recruit-mcp（https://zhaopin.mcp.it.woa.com）**」窗口 → 点「**连接**」。
2. 按提示用**太湖 SSO 授权**即可（无需手填任何 Token）。
3. 没弹窗时：WorkBuddy 左侧「连接器」→ 右上角「自定义连接器」→ 找到 recruit-mcp → 点「连接」/「Trust」。

> ✅ 连接只认**太湖授权**一项。旧版要求的第二个「招活 Token / recruit-Authorization」已下线，不用再申请。

### 手动配置（仅当客户端不支持弹窗连接时）

打开 `~/.workbuddy/mcp.json`，在 `mcpServers` 里加：

```json
{
  "mcpServers": {
    "recruit-mcp": {
      "url": "https://zhaopin.mcp.it.woa.com",
      "headers": { "Authorization": "Bearer <太湖PAT>" },
      "disabled": false
    }
  }
}
```

- 太湖 PAT 申请：<https://tai.it.woa.com/user/pat>（`Authorization` 要带 `Bearer ` 前缀）
- 另：`TRAG_TOKEN`（可选）仅 `requirement-communication-assistant` 用（参照人法 / 内部盘活），不用可留空，申请见 tRAG 控制台 → 个人中心 → PAT 管理（http://api.trag.woa.com）。

### 验证

- 当前会话工具列表能看到 `mcp__recruit-mcp__*` 系列工具 ✅
- 或检查 `~/.workbuddy/mcp.json` 出现 `recruit-mcp` 段（含 `Authorization` 一个 header 即可）

授权过期 → 重新点一次「连接」走太湖 SSO 即可。

---

## 故障排查

### ❌ 现象：agent "假装"完成了任务，但输出明显不准确

**典型表现**：
- 声称已调用 `assessment-quality-expert · A` 搭模型，但维度组合不对、缺少素质词典锚点
- 声称已调用 `zhaopin-operations` 搜简历，但没有真实候选人 RID
- 声称面试已下单，但拿不到 orderId

**根本原因**：通过 `task` 工具（subagent 方式）调用 `recruitment-expert`。

`task` 启动的是**轻量级子代理**，工具集被裁剪——子进程**没有 `use_skill` 工具**，无法加载 17 个子 skill 的完整上下文（SOP 文档、素质词典、模型库、招聘知识库等），只能基于训练记忆"编"答案。

### ✅ 正确触发方式

| 方式 | 示例 |
|---|---|
| **@ 提及 agent** | `@腾讯招聘专家 帮我搭一个产品经理的胜任力模型` |
| **直接说招聘关键词** | "帮我搭模型 / 写 JD / 出整套题 / 搜简历 / 填面评 / 看面试待办 ..." |
| **直接喊 agent 名** | "腾讯招聘专家"、"招聘专家"、"招聘助手" |

### ❌ 严禁的调用方式

```
task(subagent_name="recruitment-expert", prompt="...")  ← 严禁！
```

详细约束见 [`agents/recruitment-expert.md`](./agents/recruitment-expert.md) 顶部的「调用方式硬约束」章节。

---

## 客服反馈入口（Support Contacts）

> 用户在使用任意 skill 过程中遇到问题、反馈、建议时，agent 应在交付内容/报错信息末尾**附上对应 skill 的产品负责人**联系入口（企微/RTX 同名搜索可达）。

### 路由表（17 个 skill）

| 分组 | Skill | 产品负责人 |
|---|---|---|
| **数据查询副链路** | hr-data-router | `ansleyyu` |
| | hr-data-sql-builder | `ansleyyu` |
| | data-permission-checker | `ansleyyu` |
| | data-warehouse-api-codegen | `ansleyyu` |
| | hr-vue-next | `ansleyyu` |
| **校招专属应用层** | warming-recruit-manager | `ansleyyu` |
| **业务问询** | recruitment-inquiry-bot | `ansleyyu` |
| **招聘需求 / 找人** | requirement-communication-assistant | `fayellawang` |
| | zhaopin-operations | `fayellawang` |
| | zhaopin-social-operations | `fayellawang` |
| **面试官日常 / 面试设计 / 面评** | interview-assistant | `elioyao` |
| | assessment-quality-expert | `elioyao` |
| | interview-data-processor | `elioyao` |
| | interview-talent-modeler | `elioyao` |
| | recruitment-process-tracker | `elioyao` |
| **横切能力** | daily-routine-builder | `elioyao` |
| | hrclaw-messenger | `elioyao` |

### 何时展示

每个 skill 在以下场景**必须**在消息末尾原样附上「💬 有问题或建议可联系产品负责人 **<contact>**（企微/RTX 同名）」：
1. 查询结果交付时
2. 调用接口报错时
3. 用户表达疑问 / 不满 / 反馈意图时

### 写法约定

- 各 SKILL.md frontmatter 中 `support_contact: <对应英文名>` 字段固化产品负责人
- SKILL.md 顶部「📮 客服 / 反馈入口（MANDATORY）」段使用对应路由表中的英文名
- 严禁把别的 skill 的 contact 当成本 skill 的 contact 输出（每个 SKILL.md 段内已加反向警示）

---

## 许可与作者

见 `.codebuddy-plugin/plugin.json` 的 `author` / `license` 字段。
