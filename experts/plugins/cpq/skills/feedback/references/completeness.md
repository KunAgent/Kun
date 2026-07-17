# AI Enrichment Completeness & 降级语义

> 从 SKILL.md 提取 · 装配器根据 `--ai-enrichment` 有无自动判定

## field_completeness 规则

装配器在 yaml header 中写入：

| 字段 | 值 | 含义 |
|---|---|---|
| `field_completeness` | `complete` | 所有环境字段都探测到了 |
| `field_completeness` | `partial` | 有 ≥1 个环境字段探测不到 |
| `ai_analysis_status` | `success` | ai-enrichment 全 5 段 + sidecar 全部成功 |
| `ai_analysis_status` | `partial-no-sidecar` | ai-enrichment body 4 段成功 · sidecar 降级/跳过 |
| `ai_analysis_status` | `missing` | 未传 `--ai-enrichment` 或 JSON 无效 |
| `missing_fields` | `string[]` | 缺失的具体字段名列表 |

## 降级行为

- `ai_analysis_status: missing` → body 4 段渲染「由提交者补充」占位 + WARNING block
- sidecar 走 regex-only fallback → `blob.redaction.level = 'regex-only'` · comment 加 NOTE
- **不在场即降级 · 不阻塞主路径** — `/feedback` 依然能跑通

## 回看校验闭环（post-create · 兑现「完整 ＞ 不完整 ＞ 报不上来」）

降级**不是终点**。issue 创建成功后，CLI 会基于 `missing_fields` / `ai_analysis_status` /
sidecar 附挂状态打印一份「回看清单」，要求 agent **在提交之后**回看并补全：

- 能补 → `--review-note --issue-iid=<N> --note-body="<补充>"`（或 `--sidecar-only` 补 transcript）
- 补不出 → `--review-note --note-kind=blocked --issue-iid=<N> --note-body="<原因>"`（书面留痕）
- 门控：`kind=bug` 且 body 缺 → 清单标 `must-act` · 上述二选一必做（不阻断提交 · 只在 post-create 强制）

实现见 `lib/self-review.ts`（清单计算）+ `lib/review-note.ts`（补充/说明评论回写）。

## 护栏

1. 输出必须是 valid JSON · schema 严格等于 `"ai-enrichment/v1"`
2. 5 段全 optional · 装配器按缺失项自动算 `missing_fields`
3. 不要虚构原文里没有的内容
4. 同一指代用相同占位符编号
5. agent 缺席不是错 · 不传即降级

## 失败兜底

| 失败类型 | 处理 |
|---|---|
| JSON parse 失败 / schema 不是 v1 | stderr 警告 · 走降级路径 · status=missing |
| 文件不存在 / 读不到 | 同上 |
| 字段类型异常（非致命） | 装配器不深 type check · 渲染时静默兜底 |
