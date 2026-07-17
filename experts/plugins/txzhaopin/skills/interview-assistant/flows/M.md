# 面试助手 · M 模型选择子模块（M-0~M-4）

> 子模块路径：`flows/M.md`  
> 触发：在主 SKILL.md 的 Router-0 命中本类目后，**第一件事是 Read 本文件**，再执行内部步骤。  
> 本文件由 v3.6 单文件 SKILL.md 拆分而来，原章节内容完整保留。

<!-- skill-tracker sub_flow: begin (auto-generated) -->

> 🚨 **FIRST ACTION（读到本文件第一件事 · MANDATORY · 静默执行）**：上报 `sub_flow_entered` 事件，标记本次进入了 **`M` 子流程（胜任力模型路由 M-Auto）**。这是 v4.6 双轨埋点的精准维度——配合 SKILL.md 主 FIRST ACTION 的 `skill_invoked`，看板能拉出"哪个 sub_flow 用得最频繁"。

```bash
bash ./scripts/track.sh "0WEB06ZI7OVDOZQW" "interview-assistant" "sub_flow_entered" '{"session_id":"'"$(date +%s)"'","sub_flow":"M","sub_flow_name":"胜任力模型路由 M-Auto"}'
```

**约束**：每次读到本文件就执行一次（不要因为同会话内"刚跑过"就跳过）。静默后台，失败容忍，不询问用户。

<!-- skill-tracker sub_flow: end -->

---

## 🧩 M. 岗位考核标准与模型管理（新增）

> **定位**：本模块是场景 B（简历评估）、C（出题）、D（面评）的**上游依赖**。简历评估、出题、写面评的质量 = **模型好不好 × 流程好不好**。不选对模型，后面做得再细也是空中楼阁。
>
> **改动**：原版 skill 默认**静默加载**集团校招通用兜底模型，岗位特性无法体现。新版在进入 B/C/D 前**强制询问**用户，若用户无暇建模再 fallback 到内置默认模型——**让用户有感知地选，而不是黑盒**。
>
> **与 `assessment-quality-expert` 的分工**：
> - `assessment-quality-expert` = 建模工厂（搭模型、写 JD、出题指导、面评审核等 8 大能力），重方法论
> - `interview-assistant` = 面试执行 SOP（查待办、下单、评估、出题、写面评），重执行
> - **建模 → 用甄选专家；用模型做面试 → 用面试助手**。M 模块就是衔接两者的接驳口。

### M-0. 模型选择入口（进入场景 B/C/D 前必走）

**触发条件**：用户任何表达"帮我评估简历 / 给候选人出题 / 写面评 / 做面试计划"的需求时，**执行具体场景 B/C/D 前**，先检查活跃模型状态：

```
检测到你要进入【{场景名}】，需要先选一份考核标准（胜任力模型）。

当前可用：
  1️⃣ 🎯 本次会话已上传/指定：{文件名 或 "无"}
  2️⃣ 🏢 assessment-quality-expert 导出的模型：{如有则列出岗位名}
  3️⃣ 📁 本地 references/models/ 岗位模型：{如有则列出}
  4️⃣ 🟢 内置兜底：腾讯校招通用胜任力模型（远程资产 `model_default_campus`）

请选：
  [A] 为本岗位搭一个专属模型 — 推荐，比通用模型精准 30-50%
      → 调 assessment-quality-expert skill 建模，约 10-15 分钟
  [B] 直接用内置兜底 (4️⃣) — 赶时间就选这个
  [C] 我粘贴/上传现成模型 — 按甄选专家的模式 2 做完整性校验
  [D] 看甄选专家的标杆库 — 已有 TEG 专精、天美游戏策划、WXG 微信气质 2.0 等
```

**路由决策表**：

| 用户选择 | 动作 | 对应 assessment-quality-expert 模块 |
|---|---|---|
| **A 搭专属模型** | 转到 `assessment-quality-expert` 的**模块 B 建模**；建完导出后由后端登记到 `_remote-assets.yaml`，agent 按语义键加载 | 模块 B（智能入口 → 模式 1/3） |
| **B 用兜底** | 加载远程资产语义键 `model_default_campus`；候选人 BG 命中特殊条线则叠加 `redline_s3` / `qizhi_wxg`；进入场景 | —（本 skill 内置） |
| **C 用户上传** | 让用户贴模型或给文件路径；按模式 2（用户上传）做格式完整性检查（定义+行为描述+评分标准三件套）后激活 | 模块 B 模式 2 |
| **D 看标杆库** | 读取 `~/.workbuddy/skills/assessment-quality-expert/references/existing-models/_index.md` 按 BG+岗位匹配；命中则加载，未命中回到 A/B | 现成模型智能匹配 |

### M-1. 模型匹配与加载规则（复用 assessment-quality-expert 策略）

**逐级叠加**（不是回退）：

```
公司级（按招聘类型）  +  BG 级  +  岗位级  =  最终模型
```

| 招聘类型 | 公司级 | BG 级 | 岗位级 |
|---|---|---|---|
| 校招 | 集团价值观 + 2021 校招生模型 → `model_default_campus`（docId=15） | TEG/WXG/IEG/S1 等对应 BG 模型（TEG=19 / IEG=17 / WXG=18 / S1=53 等） | 游戏策划、用研等岗位模型 |
| 社招（v4.5 临时方案）| 集团公司价值观 → `model_default_social`（docId=49） | 命中 BG 时叠加：WXG=`qizhi_wxg`(14) / TEG=`model_teg`(19) / S3=`redline_s3`(13)（**校招/社招共用同一份 BG 资产**）| **暂无社招岗位级专属模型**，后续业务方提供后再补 |
| 产培 | 集团价值观 + 产培生模型（`model_product_trainee` docId=20）| BG 模型 | — |

- **S3 红线模型**：独立负面筛查区块，不计入 1-5 分评分（校招/社招都适用）
- **核心维度权重**：岗位级模型中 ⭐ 标注的维度在多简历对比（B2）中 1.5x，BG 级和公司级默认 1.0x
- **社招兜底逻辑**：`match_model.py` 看到 `recruit_type=social` → 自动命中 `model_default_social`（docId=49），warning 提示"暂无岗位级专属模型"。BG 叠加由 agent 按候选人 BG 选叠 `qizhi_wxg` / `model_teg` / `redline_s3`

### M-2. 活跃模型的来源标记

模型确认后记录 `source`，决定后续题目/面评审核的严格度：

| 来源 | 标记 | 出题/审题/面评时的约束 |
|---|---|---|
| 甄选专家·集团词典建模 | `source: dictionary` | 维度名称、定义必须原文引用 `competency-dictionary.md` 的 25 项 |
| 用户上传 | `source: uploaded` | 按用户定义，不受词典约束，但做基础格式完整性校验 |
| 混合自建 | `source: hybrid` | 词典项对标词典，自定义项按用户定义 |
| 本 skill 内置 fallback | `source: builtin-default` | 使用远程资产 `model_default_campus`（集团校招通用） |
| 标杆库加载 | `source: library` | 使用现成模型，可在其上细化 |

### M-3. 什么时候推荐用户去搭专属模型（vs 用兜底）

| 场景 | 推荐路径 |
|---|---|
| 今天就要面试（< 2 小时） | **B 用兜底**，先把这次面试做完，事后让 HR 补建模 |
| 这个岗位会持续招（一个招聘季 10+ 人） | **A 搭专属**，一次投入 10 分钟，后面所有人都用它 |
| 岗位稀缺/特殊（如 AI 研究员、安全蓝军） | **A 搭专属**，通用模型 miss 太多关键维度 |
| 招聘经理 / HRBP 已经给了一份标准 | **C 上传**，按照业务方认定的标准走 |
| 就是个常规校招岗（产品/运营/一般开发） | **D 看标杆库** → 有就用、没有就 B 兜底 |

### M-4. Skill 之间的数据传递

- **建完模型的归宿**：由 `assessment-quality-expert` 提交到后端知识库，登记到 `references/_remote-assets.yaml` 并分配 `documentId`
- **加载流程**：本 skill 通过 `scripts/match_model.py` 按候选人三元组（BG/岗位族/招聘类型/环节）匹配语义键，agent 据此调 MCP `get_document` 拉正文
- **会话内变量**：`$ACTIVE_MODEL_KEY=<asset_key>`、`$ACTIVE_MODEL_SOURCE=<来源标记>`
- **被 B/C/D 场景读取**：B-0、C-0、D-0 的第一步都读 `$ACTIVE_MODEL_KEY`，未设置时**回到 M-0 提示用户选**，而不是硬塞默认值

---
