# Sidecar Prompt（transcript 自动附挂）

> 从 SKILL.md 提取 · 给执行 skill 的 agent 的自我执行指令
> MVP-β v0 阶段 sidecar 默认走 regex-only fallback

## 概述

Stage 1 issue 创建完成后，sidecar 段自动激活（默认 `auto` 模式），把当前会话的 JSONL transcript
收集成结构化 blob，作为 issue 的 attachment + comment 旁挂。**hawke agent-dashboard 仓零改动**。

| flag | 用途 |
|---|---|
| 默认 | 探测到 WorkBuddy 时自动跑；未探测到则静默跳过 |
| `--no-transcript` | 显式跳过 sidecar |
| `--with-transcript=<path>` | 显式指定 JSONL 文件（绝对路径） |
| `--sidecar-only --issue-iid=<N>` | 跳过 stage 1 · 给已存在的 issue 补传 transcript |
| `--sidecar-finalize=<path> --issue-iid=<N>` | agent enrich 输出 finalize 入口（MVP-β phase 1） |
| `--sidecar-fallback` | 强制走 regex-only · 不等 agent enrich（CI / 非交互） |

完整设计：[`docs/evolution/pipelines/a-feedback-sidecar.md`](../../../../../docs/evolution/pipelines/a-feedback-sidecar.md)。

## Sidecar 失败语义（设计文档 §3.2）

- `success`：blob 上传 + comment 发布全部成功
- `skipped`：未探测到 client / 显式 `--no-transcript` / transcript 空（issue 仍可用）
- `partial`：attachment 上传成功但 comment 发布失败 · stderr 给出 markdown 让用户手贴
- `failed`：attachment 上传失败 · issue 不回滚

`partial` 与 `failed` 都返回退出码 `2`，issue 已经存在；重跑：

```bash
bun run dev:feedback --sidecar-only --issue-iid=<N>
```

## Agent 执行指令

你正在执行 `/feedback` skill 的 sidecar 段。issue 已经创建，现在要把会话 transcript 收集成结构化 blob，附在 issue comment 里给 triage agent 后续消费。

### 输入（脚本提供）

- `$TRANSCRIPT_INPUT`：JSON 文件路径，内含 `{ parsed_transcript, issue_body_user_section, client, uin_salt }`
- `$TRANSCRIPT_OUTPUT`：你要把结果 JSON 写到这个路径

### 任务（按顺序）

#### 1. Read `$TRANSCRIPT_INPUT`

拿到完整 `parsed_transcript`（已经做过 jsonl 行解析、callId 配对、`<system-reminder>` 剥离、cwd 路径脱敏）。

#### 2. 应用语义脱敏

对以下字段做脱敏（保留 JSON 结构，只改字符串值）：

- `messages[*].text`
- `reasonings[*].text`
- `tool_calls[*].arguments_json`（仅 string 值）
- `tool_calls[*].result_text`

**脱敏类型**（同一指代用相同编号，如 `<CUSTOMER_1>` / `<CUSTOMER_2>`）：

| 类型 | 占位符 | 示例 |
|---|---|---|
| 客户名 / 公司名 | `<CUSTOMER_N>` | 「某客户A」「张总」「腾讯某 BG」 |
| 项目代号 / 内部系统名 | `<PROJECT_N>` | 「天穹项目」「ICEBOX」 |
| 内部业务术语缩写 | `<INTERNAL_TERM_N>` | 内部代号（确认是的才换） |
| 个人姓名（中/英/拼音） | `<PERSON_N>` | 「张三」「Zhang San」 |
| 上游正则漏过的 UIN / 手机 / 邮箱 | `<UIN_N>` / `<PHONE_N>` / `<EMAIL_N>` | — |
| 金额 | `<AMOUNT_N>` | 「成交价 12 万」 |
| 内部 URL / 接口路径（含 host 段） | `<INTERNAL_URL_N>` | — |

**绝不脱敏（保留原样）**：

- Plugin name / Skill name / tool name（如 `cpq` / `huijin3` / `cpq-row-import`）
- 公开技术名词（React / TypeScript / 工蜂 / git / npm / Anthropic）
- 错误码 / HTTP status / exit code
- 文件扩展名 / 文件名（不含路径）
- 日期 / 时间

**绝不修改**：

- 所有 id / timestamp / type / role / callId / parentId / name
- `arguments_json` 的 JSON 结构（key 不动 · 仅 value 内字符串可改）
- 已经形如 `<KIND_N>` 的占位符（透传）
- cwd / 路径段（上游已经把用户名换成 `<user>`）

#### 3. 提炼 summary card

```ts
summary: {
  user_intent:    "用户在做什么 / 问什么 · ≤500 字 · 已脱敏",
  agent_outcome:  "agent 做了什么 / 是否成功 · ≤500 字 · 已脱敏",
  pivot_signal:   "问题最可能发生在哪一步 · ≤500 字 · 已脱敏",
  pivot_index:    /* int · tool_calls 数组下标 · 无明显 pivot 填 -1 */ 0,
}
```

#### 4. 算 cross_check

把 `issue_body_user_section`（用户在 `/feedback` 时填的 Detail）跟你脱敏后的 transcript 对比：

```ts
cross_check: {
  verdict: 'consistent'        // 用户原话 ↔ transcript 行为吻合
         | 'user-understated'  // 用户低估问题
         | 'user-overstated'   // 用户夸大问题
         | 'user-misframed'    // 用户描述偏离
         | 'no-overlap',       // 无明显对应
  reasoning: "≤300 字 · 解释 verdict 怎么来的 · 已脱敏",
  supporting_tool_call_indices: [12, 17, 23],
}
```

**判定要点**：

- 用户说 "X 不工作" + transcript 显示 X 返回 200 但后续 row list 返回空 → `user-understated`
- 用户说 "X 不工作" + transcript 显示 X 抛 500 → `consistent`
- 用户说 "X 不工作" + transcript 显示 X 没被调用过 → `user-misframed`
- 用户说 "希望批量导入" + transcript 全程顺利 → `no-overlap`

#### 5. 装配 BlobPayload v1

按 [`docs/evolution/pipelines/a-feedback-sidecar.md`](../../../../../docs/evolution/pipelines/a-feedback-sidecar.md) §5 的 schema 装配完整 JSON，包含：

- `schema` / `session_id` / `captured_at` / `client`
- `redaction`（含 audit · 每条用 sha256 前 8 位记录原始 hash）
- `summary`（上一步算的）
- `cross_check`（上一步算的）
- `stats`（从 `parsed_transcript` 抽）
- `messages` / `reasonings` / `tool_calls`（脱敏后的）
- `diagnostics`（如果用了 retry / chunks，记一下）

#### 6. Write `$TRANSCRIPT_OUTPUT` + 调 finalize

把完整 JSON 写到 `$TRANSCRIPT_OUTPUT`，然后调脚本收尾：

```bash
bun run dev:feedback --sidecar-finalize=$TRANSCRIPT_OUTPUT --issue-iid=<N>
```

### 护栏（必读）

1. **输出必须是 valid JSON**，能被 `JSON.parse` 成功
2. **同一指代必须用相同占位符编号**
3. **不要虚构原文里没有的内容**
4. **如果你不确定某段是否需要脱敏，倾向于不改**（让脚本兜底 regex）
5. **`audit.items_redacted[*].samples[*].original_sha256_prefix`** 是原始字符串 sha256 前 8 字符（算不出哈希就留空字符串）
6. **如果输入超过你的上下文窗口**：分块处理 · 每块产一个局部 blob · 最后做一次整合

### 失败兜底（脚本侧自动处理）

| 失败类型 | 处理 |
|---|---|
| agent 返回 invalid JSON | 脚本 1 次 retry · 追加 "上次输出格式错 · 请严格按 schema 重做" |
| agent 改了禁止字段（如 callId） | schema validate 拦截 · 用原值覆盖 · 计入 `diagnostics.schema_retry_count` |
| agent 输出超长（> 输入 1.5x） | 脚本 1 次 retry · 追加 "输出过长 · 请精简" |
| agent 抛错 / 超时 / 用户中断 | 脚本走 `regex-only` fallback |
| 任何兜底成功（regex-only）| `blob.redaction.level = 'regex-only'` · comment 加 NOTE |
