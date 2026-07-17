---
name: feedback
description: 反馈收集能力（feedback）。把终端用户对当前 skill/tool 的反馈（bug/建议/改进/文档问题）自动落成工蜂 Issue → Triage 分类 → AI 进化流水线消化。被 panshi、huijin3、cpq 等业务 skill 共同复用。**用户说「反馈、反馈一下、反馈这个问题、反馈一下这个问题、提反馈、我要反馈、上报、上报这个、上报这个问题、报上来、记录一下、报 bug、这个不对、错了、为啥/为什么（非教学语境）」等反馈意图词时，本 skill 必须触发**（也包含与 /feedback、evolution、triage、工蜂 Issue 同现的场景）；中文用户在客户端口语里几乎不会说"我要 /feedback"，不主动触发就反馈丢失——这是用户立工蜂 Issue 的唯一通道。
---

# AI 进化能力（反馈 / Triage 共享 skill）

> 这个 skill 是**通用基础能力**，不绑定任何业务模块。
> panshi、huijin3 等业务 skill 通过 `--plugin/--skill` 标识自己，统一从这里上报。

> 🧭 **本 skill 是注入式（injection）能力**：通过 `workbuddy.config.json` 的 feedback preset 投影进各专家的 `skills/feedback/`，**不出现在 use_skill / available_skills 全局列表**。Agent 要用它时直接走本专家 `skills/feedback/scripts/` 下的 `node dist/feedback.mjs`，无需 use_skill；定位不到时用 `glob "**/feedback/SKILL.md"` 找到本专家目录。

## 服务边界（plugin 白名单）

> ⚠️ **本 skill 仅服务于 `TCBTeam/panshi-ai-marketplace` 仓库内的 plugin**。外仓 plugin 的反馈应该走 plugin 自己的反馈通道，**不应**走本 skill —— 否则反馈会落到错误的仓库 · daily triage 流水线无法消化。

**本仓 plugin 白名单**（`--plugin` 字段允许值）：

| plugin       | 路径                  |
| ------------ | --------------------- |
| `panshi`     | `plugins/panshi/`     |
| `panshi-dev` | `plugins/panshi-dev/` |
| `huijin3`    | `plugins/huijin3/`    |
| `cpq`        | `plugins/cpq/`        |
| `o-helper`   | `plugins/o-helper/`   |
| `web2skill`  | `plugins/web2skill/`  |
| `evolution`  | `plugins/evolution/`  |

**Agent 校验逻辑**（在 Step 1 推断 `--plugin` 后立刻执行）：

- ✅ `--plugin` 在白名单内 → 正常进装配
- ❌ `--plugin` 不在白名单 → **abort**，向用户提示：「检测到反馈对象 `<plugin>` 不在 evolution skill 服务白名单。该反馈应投递到 `<plugin>` 自己的反馈通道。」
- ⚠️ 用户**明确**坚持要落本仓 → agent 可询问一次确认 + 让用户显式说明理由 · 把理由放进 `--detail`

## 工作目录

所有命令在本文件（SKILL.md）同级的 `scripts/` 目录下执行。
Agent 应先定位此 SKILL.md 的绝对路径，取其父目录，再拼接 `scripts/` 作为 `working_directory`。

## 调用入口

| 命令                                     | 用途                                                                                  | 谁调                               |
| ---------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------- |
| `node dist/feedback.mjs`                 | 终端用户提交 bug/建议/请求 → 工蜂 Issue（**默认走 BAC 公共账号 · 用户零配置**）       | 业务 skill 的 `/feedback` 命令转发 |
| `node dist/feedback.mjs --assemble-only` | 只本地装配 + 脱敏，`{title, body, labels, repo, host}` JSON 打到 stdout；**不走网络** | Agent 拿 payload 通过已有通道提交  |
| `node dist/triage-helper.mjs`            | 拉取待 triage Issue 列表                                                              | `evolution-triage` agent           |

## 反馈通道：`/feedback`（Pipeline A）

把问题提交到**工蜂**（腾讯内网代码托管，域名 `git.woa.com`）的 Issue，由 AI 进化流水线消化。

> 📎 transcript 富化上下文由 sidecar（dashboard 链路）自动处理，见 [Sidecar 段](#sidecartranscript-自动附挂)，无需 agent 额外自检任何协同 skill。

### 用法

> **默认形式 = 带 `--ai-enrichment-inline`**（或 `--ai-enrichment <path>`）。先按下方
> [「触发后 4 步」](#何时主动触发给-ai-agent-的提示)的 **Step 2** 装配出 `ai-enrichment/v1` JSON
> 再调本命令——这是首选，能让 issue 带上 AI 根因 / 复现步骤而不是占位符。
>
> 🟡 **铁律：上报简单问题 > 完整问题报不上来。** enrichment 是**强默认**、不是**准入门槛**。
> 当你确实提炼不出（信息太少 / 不在 client 环境 / 提炼出错），**不要因此放弃提交**——
> 直接裸 `--summary/--detail` 上报即可（会产出 `ai_analysis_status: missing` 的 issue ·
> triage 仍能消费 · 之后还能用 sidecar transcript 补提炼）。**唯一不可接受的是反馈丢失。**
> 选择顺序永远是：**带 enrichment 的完整 issue ＞ 缺 enrichment 的简单 issue ＞ 不提交**。

```bash
# ✅ 首选形式（带 AI 分析包 · inline 跨平台无需落盘 · 详见 references/ai-enrichment.md）
node dist/feedback.mjs \
  --plugin <cpq|huijin3|panshi|...> --skill <skill-name> \
  --kind <bug|suggestion|enhancement|documentation> \
  --summary "≤80字摘要" --detail "重现步骤 / 期望 / 实际..." \
  --ai-enrichment-inline '{"schema":"ai-enrichment/v1","body_sections":{...},"probed_context":{...}}' \
  --severity critical   # 可选，仅 kind=bug 时有意义

# 备选：分析包走文件（内容与 inline 等价 · 适合 JSON 较大时）
#   把上面的 --ai-enrichment-inline '...' 换成 --ai-enrichment ./feedback-enrich.json

# 🆘 兜底：实在提炼不出时，去掉 --ai-enrichment-* 裸提交也要把 issue 提上去（别丢反馈）
node dist/feedback.mjs \
  --plugin <...> --skill <...> --kind bug \
  --summary "..." --detail "..."

# 叠加开关（可与上面任一形式组合 · 优先组合首选形式）
#   --dry-run        仅本地预览不上报
#   --assemble-only  仅本地装配 + 脱敏 → 输出 JSON（由 Agent 通过已有工蜂 skill / MCP 提交）
```

### 提交通道优先级（**Agent 内部判定 · 不要对用户复述**）

> ⚠️ 本段是 Agent 内部判定流程 · 用户对话中**禁止**出现路径选择的心路独白。

**默认沉默走 BAC**（用户零感知）。仅在**用户明确指定通道**时才走其它路径：

- **3c BAC（默认）** — 走 `node dist/feedback.mjs` 默认路径 · issue URL 直接给用户
- **3a 已有 skill / MCP（仅用户显式触发）** — 用户明确说「用我配的 gongfeng-mcp 提交」时才走
- **3b PAT 直连（仅 `--use-pat` opt-in）** — 运维兜底场景

设计依据见 [`docs/evolution/pipelines/a-feedback.md`](../../../../docs/evolution/pipelines/a-feedback.md#cli-提交路径选择) 与 [`docs/evolution/specs/feedback-channel-public-account/02-design.md`](../../../../docs/evolution/specs/feedback-channel-public-account/02-design.md) ADR-001。

### 何时主动触发（给 AI Agent 的提示）

除了用户显式说"提反馈 / 报 bug / 帮我反馈"外，**AI Agent 在下列场景应主动询问用户是否要走 `/feedback`**：

#### A. 工程信号（来自 tool 输出 / 系统行为）

- 同一个 skill 的 tool 连续 **≥2 次**返回同类错误
- tool 返回业务错误码但文档里都查不到含义
- 某个 skill 的 CLI 输出格式与 AI 预期严重不符
- 用户的需求明显落在某个 skill 的边界之外，且重复出现（→ `--kind enhancement`）

#### B. 用户情绪 / 态度信号（来自用户对 **Agent 自己回复**的反应）

> 关键区别：用户不一定会说"我要反馈"，而是会用**否定 / 情绪 / 退场**信号表达不满。Agent 必须能识别这些信号。

| 信号类型                | 典型措辞                                       | 推断 kind                      | 备注                                               |
| ----------------------- | ---------------------------------------------- | ------------------------------ | -------------------------------------------------- |
| **直接否定 Agent 输出** | "不对"、"不是这个"、"这就是错的"               | `bug` / `documentation`        | 辨别"否定 Agent 逻辑"还是"Agent 引用的文档"        |
| **失望 / 挫败**         | "怎么搞这么复杂"、"算了"、"不弄了"、"我自己来" | `suggestion` / `documentation` | "算了/不弄了"是**沉默退场信号** · 比直接骂更值得追 |
| **连续否定多轮输出**    | "再来一次"、"还不行"、"还是不对"（≥2 次）      | `bug`                          | agent 推理层面的反复                               |
| **语气激化**            | "？？？"、"认真的吗"、"你在逗我"               | `bug` / `suggestion`           | 单次出现就该警觉                                   |
| **被动接受但有保留**    | "好吧"、"那就这样吧"、"先这样"                 | `suggestion`                   | 比直接否定更隐蔽 · 应主动追问                      |

#### C. 反向白名单（**不该**触发 `/feedback`，避免误伤）

- 用户抱怨任务本身的难度 / 复杂度（抱怨对象不是 Agent）
- 用户抱怨外部系统 / 第三方依赖（除非明显是本仓库 skill 引发）
- 用户在自嘲 / 调侃（情绪冲自己）
- 用户讨论别人的反馈（转述，不是当事人）
- Agent 已识别并明确说要修，用户只是回应"好"
- 用户在 ≤ 1 轮内同意了 Agent 的更正方案

> **判断原则**：负面情绪的**指向**比情绪本身更重要。

**触发话术建议**：

> 我注意到你对刚才那个 `<推断的不满点>` 不太满意。这看起来像 `<kind>`，
> 我可以把它用 `/feedback` 上报——错误码、调用参数、你的原话和我的回复摘要我会自动收集并脱敏。
> 要现在发吗？等下会给你一次脱敏后的完整预览让你 `y/N` 确认。

**触发后 AI 必须按序执行以下 5 步（不可跳过 · 不可乱序）**：

#### Step 1: 收集 — 从对话推断结构化字段

拿不准再追问，**一次问完**：

- `plugin` / `skill`：CWD + 最近读写文件 + 最近 tool 调用名
- `kind`：用户情绪 + 措辞 + 不满指向（参考上方 B 类对照表）
- `summary`：提炼用户不满的核心点 ≤ 80 字 · **不原样抄用户原话**
- `severity`：只有"阻塞 / 线上 / 全员挂"才设 critical
- `detail`：**只放「用户视角的原始素材」**——根因 / 复现步骤 / 期望 / 实际
  统一交给 Step 2 的 `ai-enrichment.body_sections` 产出，**不在这里重复写**
  （避免「写完 detail 就以为分析做完」而漏掉 enrichment）：

  ```text
  ## 用户原话（脱敏后）
  <最近一条体现不满的用户消息原文>

  ## Agent 上一轮回复摘要
  <≤ 3 行>

  ## 用户否定的具体点
  <如：「Agent 推荐了 A 方案 · 用户认为应该是 B」>
  ```

  > 重现路径 / 期望 / 实际 / 根因放进 Step 2 的 `body_sections`
  > （`steps_to_reproduce` / `expected` / `actual` / `root_cause`）·
  > 装配器据此渲染 issue body 4 段。一份输入、一处产出，不要两头各写一遍。

#### Step 2: AI Enrichment 装配（必经 · 不可跳过）

> 本步骤决定 issue 的 AI 分析质量。**无论环境是否完整，都必须执行本步并产出 JSON**。

1. 探测 `llm_model` — 填**用户出问题时 invoke 的模型**（你自己 = 当前 model ID）
2. 判定 `reproducible` — transcript 中同类错误 ≥2 次 → `yes`；仅 1 次 → `no`；无证据 → `unknown`
3. 产出 `ai-enrichment/v1` JSON（至少填 `body_sections` + `probed_context`）
4. 后续 CLI 调用**必须**带 `--ai-enrichment-inline '<json>'`（推荐 · 跨平台无需落盘文件）或 `--ai-enrichment <path>`

探测不到的字段留空即可，装配器会归入 `missing_fields`。完整 schema 见 [references/ai-enrichment.md](references/ai-enrichment.md)。

> 🟡 **「必经」指「默认都要尽力做」· 不是「提交前的硬门槛」。** 字段缺就留空（装配器
> 兜底）。如果整步实在做不出（信息太少 / 非 client 环境 / 提炼出错）·**照样先把 issue
> 裸提交上去**（铁律：完整 ＞ 不完整 ＞ 报不上来）。但**跳过 ≠ 沉默**：提交后**必须**在
> Step 5 回看校验里发一条 `--note-kind=blocked` 评论 · 书面说明「为什么这次提炼不出
> enrichment」· 让 triage 知道这是客观受限而非遗漏。
>
> 一句话：**跳过 enrichment 是允许的 · 但「跳过且不留痕」不允许。**

#### Step 3: 预览 — 唯一用户确认点

跑 `--assemble-only` 拿脱敏 payload，把 `title / body / labels` 甩给用户 `y/N`。

#### Step 4: 提交

按提交通道优先级提交（默认 BAC · 不要让用户自己去敲命令）。

#### Step 5: 回看校验（post-create · 必做 · 永不阻断）<!-- = commands/feedback.md 的 Step 4 -->

> 📎 对应 `commands/feedback.md` 的 **Step 4**（该命令流程含 Step 0 / 1.5 / 3.5 等更细粒度 · 编号与此处不一一对应 · 但指同一个回看校验环节）。

> issue **已经提交成功之后**才执行。这一步怎样都不会回滚已落库的反馈——它只把
> 「提交时来不及补的上下文 / 分析」**增量补回去** · 正是 **完整 ＞ 不完整 ＞ 报不上来**
> 的兑现：先保证报上去，再回头逼近完整。

CLI 在创建成功后会打印一份「回看清单」（含 `ai_analysis_status` / `missing_fields` /
transcript 附挂状态 + 下一步命令）。`must-act` 时清单里会有一段 `<agent_reminder>` **直接给你
单条命令**——照着跑即可。

> ⚠️ **重心：原始上下文（transcript）必达 > AI 分析**。原始对话上下文是 triage 的硬证据 ·
> AI 分析脱离原始环境可能误导。**统一用 `--finalize-review` 一条命令**（内部：①优先补挂 transcript
> ②可选补一条评论）· **不要**自己纠结 PAT/BAC 通道（默认沉默走 BAC）。

1. **WorkBuddy · 原始上下文没上报**（`must-act`）→ 补挂 transcript（一条就够）：

   ```bash
   node dist/feedback.mjs --finalize-review --issue-iid=<N>
   ```

2. **非 WorkBuddy 的 bug · 采集不到 transcript**（`must-act`）→ 书面留痕一次：

   ```bash
   node dist/feedback.mjs --finalize-review --note-kind=blocked --issue-iid=<N> --note-body="本 client 无 transcript（非 WorkBuddy）"
   ```

3. **次要补充**（`recommended` · 原始上下文已附挂 · 补根因/复现/环境）：

   ```bash
   node dist/feedback.mjs --finalize-review --issue-iid=<N> --note-body="<补根因/复现/环境>"
   ```

**门控**：清单标 `must-act` 时**必做**（1 或 2 视 client）· 不可沉默略过；`recommended` 尽量补（3）；`clear` 无需动作。`--review-note` / `--sidecar-only` 仍是底层入口（向后兼容）· 日常回看只用 `--finalize-review`。

> 回看评论失败不影响 issue 本体（与 sidecar / M11 评论一致）· 退出码可能为 2 但 issue 仍在。
> 这一步是「AI 老忘上传上下文 / 补充分析」的兜底闭环：报上去后强制回看一次 · 补不了也留痕。

---

### 自动脱敏

详见 [references/redaction.md](references/redaction.md)（非 critical path · agent 无需读即可执行主流程）。

### Sidecar（transcript 自动附挂）

详见 [references/sidecar-prompt.md](references/sidecar-prompt.md)（装配器内部自动处理 · agent 无需额外操作）。

### Issue 结构 & Completeness

详见 [references/issue-structure.md](references/issue-structure.md) · [references/completeness.md](references/completeness.md)。

## Triage 辅助：`triage-helper.mjs`

供 `evolution-triage` agent（`.agent/agents/evolution-triage.md`）使用：

```bash
node dist/triage-helper.mjs --list                     # 列出待 triage Issue
node dist/triage-helper.mjs --issue <iid>              # 拉单个 Issue 的完整 body + meta
```

复用 `bin/feedback.ts` 的同一份工蜂客户端（`lib/gongfeng.ts`），鉴权 / 错误处理一致。

## 与业务 skill 的关系

| 业务 skill | 怎么用 evolution                                                                                                                 |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `panshi`   | 在 panshi SKILL.md 的"反馈通道"段落里转发到 `evolution/.../dist/feedback.mjs --plugin panshi --skill panshi`；本身不实现反馈逻辑 |
| `huijin3`  | 同上，传 `--plugin huijin3 --skill huijin3`                                                                                      |
| 未来新业务 | 加新 plugin/skill 时，**不要再实现自己的反馈通道**，统一指向这里                                                                 |

## 与 worker / CI 的关系

`scripts/feedback.mjs` 只负责**提单**。Issue 落地后，由仓库根 `scripts/` 下的 worker / CI 脚本消费：

- `scripts/worker/run-impl.sh` — Triage 完成后跑 LLM 改代码
- `scripts/post-merge-hook.ts` — MR merge 后自动关 Issue + 加跟踪评论
- `scripts/lint-patch-scope.ts` — patch MR 范围守卫

这些脚本会 import 本 skill 的 `lib/{gongfeng,triage,redaction}.ts`（通过构建产物 `dist/*.mjs`）。
完整流水线见 [`docs/evolution/architecture.md`](../../../../docs/evolution/architecture.md)。

## 故障排查

- **仅 `--use-pat` 路径报 `GongfengError: missing GONGFENG_PAT`** → 默认路径走 BAC 公共账号、不读 env PAT，普通用户**不会**触发此错。仅当显式加 `--use-pat` 时才需要本人 PAT。
- **`401/403` 调工蜂 API 失败**（仅 `--use-pat` 路径） → token 过期或 scope 不含 `api`
- **本地脱敏漏掉敏感词** → `EVOLUTION_UIN_SALT` 设置后能让 UIN 跨 Issue 聚合；其他规则改 `lib/redaction.ts` 后重新 `bun run build`
- **sidecar 跳过 / 报错** → MVP-β 仅支持 WorkBuddy client · 其它 client 跳过 sidecar 但**不影响 `/feedback` 主路径**

## Agent 错误处理约束（reference · 不要 paraphrase stderr）

> ⚠️ 完整约束在 [`plugins/evolution/commands/feedback.md` § 错误信息处理约束（Agent 必读）](../../commands/feedback.md#错误信息处理约束agent-必读)。

执行 `/feedback` 流程出现 stderr 时，agent 必须：

1. **stderr 原样透传**给用户（用代码块包裹）· 禁止 paraphrase / 翻译 / 概括
2. **不要猜根因** · 不确定就说不确定
3. **不要拼接多条 stderr** · 每条独立呈现
4. **不要主动建议替代方案** · 除非用户明确要求 fallback
