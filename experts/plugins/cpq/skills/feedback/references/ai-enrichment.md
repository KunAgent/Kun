# AI 分析 + 环境探测 Prompt（v2 · ai-enrichment/v1）

> 从 SKILL.md 提取 · 给执行 skill 的 agent 的自我执行指令
> 本段决定 issue body 4 段 + sidecar comment AI 5 段能否填上

## 概述

你正在执行 `/feedback` skill 的 stage 1（创建 issue 之前的装配阶段）。在用户 y/N 确认前，
你需要把以下 5 段信息提炼成一份 `ai-enrichment/v1` JSON，通过 `--ai-enrichment=<path>` 传给 `bin/feedback.ts`。

- 与 `lib/ai-enrichment.ts` 的 `AiEnrichment` interface 保持字段级对齐
- agent 一次性产出 JSON · 装配器 + sidecar 共享同一份输入
- 不在场 / agent 拒绝跑 / 装配器没传 `--ai-enrichment`：行为完全向后兼容（降级）

## 输入

- 用户的 `--detail` 原话（已在 prompt 上下文里）
- 当前 client 的 transcript（如果你能看到）
- 当前 cwd / git repo / plugin 列表 / 各 package.json 等可读环境

## 输出 Schema（`ai-enrichment/v1`）

```jsonc
{
  "schema": "ai-enrichment/v1",
  // ── 段 1 · 渲染到 issue body 4 段 ──────────────────────
  "body_sections": {
    "root_cause": "≤300 字 · 一句话根因 · 已脱敏",
    "steps_to_reproduce": [
      "进入 panshi-cpq skill",
      "创建报价单（任意 project_code）",
      "跑 `row import --month ...`"
    ],
    "expected": "从 4 月账单导入产品到报价单",
    "actual": "命令退出 · 无产品被导入 · stderr 有 `JSON parse fail` 错误"
  },
  // ── 段 2 · 环境探测 · 装配器摊进 yaml header context ──
  "probed_context": {
    "llm_model": "claude-sonnet-4.5",
    "cli_versions": {
      "cpq_cli": "0.0.29",
      "panshi_skill": "2.1.5"
    },
    "reproducible": "yes",
    "severity": "blocker"
  },
  // ── 段 3 · sidecar comment 的 AI 5 段 ─
  "sidecar_analysis": {
    "root_cause": "维表服务返回 HTML 错误页 · 而非 JSON",
    "error_log_excerpt": [
      "[Panshi] ✗ batch_request_dim: 响应非合法 JSON",
      "[Panshi] CPQStore 初始化中断"
    ],
    "causal_chain": [
      { "step": 1, "description": "batch_request_dim 接口异常" },
      { "step": 2, "description": "返回 HTML 而非 JSON" }
    ],
    "candidate_causes": [
      {
        "description": "磐石维表服务当前不稳定",
        "likelihood": "high",
        "rationale": "<!DOCTYPE 是典型 5xx 网关页"
      }
    ],
    "remediation": {
      "for_user": ["稍后重试 row import", "用 row add --spu-ids 替代"],
      "for_maintainer": ["在 batch_request_dim 客户端加 content-type 校验"]
    }
  },
  // ── 段 4 · transcript 摘要（可选）─
  "summary_card": {
    "user_intent": "用户在做什么 · ≤500 字",
    "agent_outcome": "agent 做了什么 · ≤500 字",
    "pivot_signal": "问题最可能发生在哪一步 · ≤500 字",
    "pivot_index": 8
  },
  // ── 段 5 · 用户原话 vs transcript（可选）──────────────
  "cross_check": {
    "verdict": "consistent",
    "reasoning": "≤300 字 · 解释 verdict 怎么来的",
    "supporting_tool_call_indices": [8, 12]
  }
}
```

## 探测命令清单（agent 自由组合）

环境字段不是必填 · 探测不到留空 · 装配器自动归到 `missing_fields`。

| 字段 | 建议探测命令 |
|---|---|
| `llm_model` | **填用户出问题时 invoke 的模型**（transcript 里的 `model` 字段 / 或 client 自己当前的 `system.model`）· CLI 场景下 = 你自己 · **企微 / 反馈采集类 agent 必缺**（别把自己填进去） |
| `cli_versions.cpq_cli` | `npx @tencent/cpq-command@latest --version` 或 `node_modules/@tencent/cpq-command/package.json` |
| `cli_versions.panshi_skill` | `cat plugins/panshi/skills/panshi/scripts/package.json \| jq -r .version` |
| `cli_versions.<plugin>_cli` | `cat plugins/<plugin>/.claude-plugin/plugin.json \| jq -r .version` |
| `reproducible` | transcript 里同一错误出现 ≥2 次 → `yes` · 仅 1 次 → `no` · 无证据 → `unknown` |
| `severity` | 阻塞所有用户 → `blocker` · 单一 feature → `major` · 体验问题 → `minor` |

## 调用方式

```bash
# 1) 写 JSON 到临时文件
jq -n '{ schema: "ai-enrichment/v1", body_sections: {...}, ... }' > ./feedback-enrich.json

# 2) 调装配器
node dist/feedback.mjs \
  --plugin <plugin> --skill <skill> \
  --kind <bug|...> --summary "..." --detail "..." \
  --ai-enrichment ./feedback-enrich.json

# 3) 装配器渲染预览给用户 y/N 确认
```

## 护栏

1. 输出必须是 valid JSON · schema 字符串必须严格等于 `"ai-enrichment/v1"`
2. 5 段全 optional：能提供多少给多少
3. 不要虚构原文里没有的内容（尤其 `root_cause` / `error_log_excerpt` / `causal_chain`）
4. 同一指代用相同占位符
5. agent 缺席不是错 · 不传 `--ai-enrichment` → 装配器走降级

## 失败兜底

| 失败类型 | 处理 |
|---|---|
| JSON parse 失败 / schema 不是 v1 | stderr 警告 · 走降级 · status=missing |
| 文件不存在 / 读不到 | 同上 |
| 字段类型异常（非致命） | 装配器不深 type check · 渲染时静默兜底 |

详细的 sidecar enrichment 透传见 `lib/sidecar/index.ts` Step 4 注释。
