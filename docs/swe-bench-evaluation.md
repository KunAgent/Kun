# Kun SWE-bench 评测方案

本文定义如何用 Kun 的非交互 CLI 生成 SWE-bench patch，再交给官方 harness 评分。
它同时记录当前能力审查、评测脚本应实现的契约、可复现性要求和上线门禁。

## 结论与范围

结论：**Kun CLI 的基础能力足以接入 SWE-bench，可以开始编写评测适配脚本。**

当前可用的最小闭环是：

```text
SWE-bench instance
  -> 官方 instance image（/testbed 位于 base_commit）
  -> kun run --workspace /testbed --jsonl <problem_statement>
  -> 收集 base_commit 到工作树的 Git diff
  -> predictions.jsonl
  -> 官方 swebench.harness.run_evaluation
  -> resolved / unresolved + 明细日志
```

本方案先覆盖文本版 SWE-bench Lite、Verified 和 Full。Multimodal test split、远程
Computer Use、GUI Design 工具不在首期范围内。建议先用 1 个实例做 smoke，再跑 10 个
固定 pilot，最后跑 SWE-bench Verified；不要一开始直接跑完整集合。

本文是评测设计和操作契约。具体实现位于 `benchmarks/agent-evals`，统一入口与 DeepSWE、
Terminal-Bench 的运行方式见 [`agent-benchmark-evaluation.md`](./agent-benchmark-evaluation.md)。
实现存在不等于已经产出可提交分数；仍须在满足 Docker、磁盘和模型条件的环境中完成真实任务。

## 当前 CLI 能力审查

| 评测需要 | 当前能力 | 结论 |
| --- | --- | --- |
| 单次非交互执行 | `kun run [options] <prompt>` 创建 thread、执行一个 turn 后退出 | 支持 |
| 指定被测仓库 | `--workspace <path>` 写入 thread，并传给全部本地工具 | 支持 |
| 修改和验证代码 | 默认工具包含 `read`、`grep`、`glob`、`bash`、`edit`、`write`、`git_inspect`、`verify_changes` | 支持 |
| 无人值守 | turn 设置 `clientSurface: cli` 和 `disableUserInput: true` | 支持；prompt 必须要求模型自行决策 |
| 自动权限 | 可显式传 `--approval-policy auto --sandbox-mode workspace-write` | 支持；仍必须依赖 Docker 做外层隔离 |
| 机器可读输出 | `--json` 输出最终 items；`--jsonl` 输出 runtime events 和 `run_finished` | 支持；评测脚本应使用 `--jsonl` |
| 终态和退出码 | 只有 turn 为 `completed` 时退出 0，其余终态退出非 0 | 支持，但 `completed` 不代表 patch 正确 |
| token/成本记录 | JSONL 中的 `usage` event 包含 token、cache、cost 和模型路由字段 | 支持；需由适配器聚合 |
| 时限和步数 | config 与 `kun run` flags 支持 wall time、step 和单步 tool-call 上限 | 支持；run flags 只覆盖本次 embedded runtime |
| 并发隔离 | `--data-dir` 可为每个实例指定独立持久化目录 | 支持；禁止多个实例共享 data dir |
| Linux 无 GUI 发行物 | standalone TUI/CLI 压缩包携带固定 Node.js，并发布 Linux x64/arm64 目标 | 支持；首期固定 Linux x64 |

实现证据主要位于：

- [`kun/src/cli/agent-cli.ts`](../kun/src/cli/agent-cli.ts)：`run`、JSON/JSONL、workspace、权限和退出码。
- [`kun/src/adapters/tool/builtin-tools.ts`](../kun/src/adapters/tool/builtin-tools.ts)：代码 Agent 默认工具集合。
- [`kun/src/loop/turn-limits.ts`](../kun/src/loop/turn-limits.ts)：turn 的默认和可配置硬上限。
- [`scripts/package-tui.mjs`](../scripts/package-tui.mjs)：带 Node.js 的独立 Linux CLI 包。
- [`KUN_CONFIG.md`](./KUN_CONFIG.md)：配置文件结构和覆盖顺序。

2026-08-20 的本地临时目录冒烟已经验证以下真实链路：mock OpenAI-compatible 流式
模型发出 `write` tool call，Kun 在 workspace 内创建文件，模型完成第二步回复，JSONL
出现 `run_started`、tool events、`turn_completed` 和 `run_finished/status=completed`，进程
随后退出。冒烟也确认 workspace 必须在启动前存在。

本次 checkout 的开发态 `dist` 还报告了本机 Node/native module ABI 不一致，并自动降级到
JSONL storage。它没有阻止上述 one-shot 闭环，但不能代替 Linux 发行物验证；这也是下文
Gate A 要求在真实 SWE-bench image 内检查 standalone archive 和 native dependency 的原因。

### 不能误解的终态语义

`run_finished.status=completed` 只表示 Agent loop 正常结束，不表示：

- issue 已修复；
- 所有工具都成功；
- patch 非空或可应用；
- SWE-bench tests 通过。

适配器必须分别记录 CLI 终态、工具错误、patch 状态和官方评分。即使某个工具失败，
模型仍可能正常收尾并得到 `completed`；最终正确性只能由官方 harness 判定。

## 已实现的评测工程

仓库已提供以下能力：

1. 固定 SWE-bench 5.0.1 的独立 Python 3.11 runtime。
2. Verified dataset/image 准备、逐实例 Kun 调用、binary patch 收集和新 checkout apply-check。
3. 官方 prediction JSONL 生成、official evaluator 调用、幂等 run state 和统一 summary。
4. 固定 endpoint、turn limits、关闭敏感 debug capture 的 Kun config。
5. Linux standalone CLI builder、archive SHA-256/runtime build identity 和真实环境 preflight。
6. one-shot CLI 的 mock-provider 回归测试，覆盖文件修改、tool error、usage、终态和 shutdown。

这些工作属于评测适配层，不需要新增第二套 Agent runtime，也不应绕过 `kun run` 直接调用
内部 AgentLoop。

## 固定依赖与运行清单

每次评测必须生成一份不可变 `run-manifest.json`，至少记录：

- Kun commit、应用版本、runtime build ID、standalone archive SHA-256；
- SWE-bench Git commit 或精确包版本、数据集名称、split、数据集 revision；
- 完整 instance ID 列表及其 SHA-256；
- 模型请求 ID、实际 provider/model、endpoint format、reasoning/service tier；
- prompt template 版本；
- turn timeout、max steps、单步 tool-call 上限；
- generation workers、official evaluation workers；
- Docker、宿主 OS、CPU 架构、CPU、内存和可用磁盘；
- 网络策略、是否允许 partial patch、基础镜像 namespace/tag；
- 开始/结束时间和适配器 commit。

SWE-bench 和数据集不能使用未固定的 `main`/`latest` 做正式结果。脚本可以接受易用别名，
但启动时必须解析成精确 revision 并写入 manifest。运行前后都不得静默升级 Kun、模型或
官方 harness。

官方文档建议在 Linux x86_64 机器上准备至少 120 GB 可用磁盘、16 GB 内存和 8 CPU cores，
并让 evaluation worker 少于 `min(0.75 * CPU, 24)`。arm64 支持仍不应作为首期正式基线。

## 推荐目录结构

实现适配器时使用以下结构：

```text
scripts/swebench/
  run_kun.py
  validate_predictions.py
  summarize_run.py
  config/
    kun-swebench.json
  prompts/
    v1.txt

artifacts/swebench/<run-id>/
  run-manifest.json
  target-instances.txt
  predictions.jsonl
  generation-results.jsonl
  summary.json
  instances/<instance-id>/
    metadata.json
    prompt.txt
    kun-events.jsonl
    kun-stderr.log
    patch.diff
    git-status-before.txt
    git-status-after.txt
```

`artifacts/` 是运行产物，不应提交到仓库。日志中不得包含 API key、Authorization header、
OAuth token 或完整 credential store。

## Kun 评测配置

配置应版本化，但 secret 必须来自容器外的受控模型代理。示例：

```json
{
  "serve": {
    "baseUrl": "http://kun-model-proxy:8080/v1",
    "endpointFormat": "openai-chat-completions",
    "model": "benchmark-model",
    "approvalPolicy": "auto",
    "sandboxMode": "workspace-write",
    "approvalReviewer": "user"
  },
  "runtime": {
    "streamIdleTimeoutMs": 450000,
    "turnLimits": {
      "maxSteps": 100,
      "maxWallTimeMs": 1800000,
      "maxToolCallsPerStep": 16
    },
    "llmDebug": {
      "enabled": false
    }
  }
}
```

正式运行应根据被测模型 profile 补齐上下文窗口和输出上限。`--data-dir` 必须由适配器按
实例覆盖，不能写成所有 worker 共享的目录。

不要把 API key 放在 CLI 参数、prompt、workspace 或实例容器环境里。推荐把模型代理作为
双网卡 sidecar：它一侧访问供应商并注入 secret，另一侧只暴露固定的模型路径给内部 Docker
network。instance container 只加入 internal network，不能直接访问公网。这样 Agent 的
`bash` 能访问模型代理，但不能搜索 GitHub issue、gold patch 或其他泄漏源。

内部探索性评测如果暂时允许公网，结果必须标为 `network_unrestricted`，不得与隔离网络的
正式分数直接比较。

## 单实例生成流程

### 1. 准备实例

适配器只给 Agent 传以下公开任务信息：

- `instance_id`；
- `repo`；
- `base_commit`；
- `problem_statement`。

不要传 `patch`、`test_patch`、gold、`FAIL_TO_PASS`、`PASS_TO_PASS` 或评分日志。`hints_text`
是否使用必须在实验配置中固定；首个基线建议不用。

使用 pinned SWE-bench 生成或拉取官方 instance image。容器启动后必须断言：

```bash
test "$(pwd)" = /testbed
test "$(git rev-parse HEAD)" = "$BASE_COMMIT"
test -z "$(git status --porcelain)"
```

任一断言失败都归类为 `infra_failed`，不能继续让 Agent 修复一个污染的工作树。

### 2. 挂载 Kun

在 Linux x64 宿主构建或下载与 manifest 匹配的 standalone archive，校验 SHA-256 后解压。
把解压后的 `kun/` 只读挂载到实例容器的 `/opt/kun`。不要把开发机的 `node_modules` 或
macOS 构建产物挂进 Linux 容器。

每个实例使用独立且位于 `/testbed` 之外的目录：

```text
/run/kun-eval/config.json
/run/kun-eval/data/<instance-id>/
/run/kun-eval/output/<instance-id>/
```

### 3. 构造固定 prompt

prompt template 必须版本化。v1 建议表达以下约束：

```text
You are solving one SWE-bench issue in the repository at /testbed.
Inspect the repository, implement the smallest correct fix for the problem below,
and run relevant tests when practical. Work autonomously: this is a non-interactive
run, so do not ask questions or wait for user input. Do not search for or use a gold
patch, hidden tests, or external issue solution. Leave the final code changes in the
working tree and finish with a concise summary.

Instance: {{instance_id}}
Repository: {{repo}}
Base commit: {{base_commit}}

Problem statement:
{{problem_statement}}
```

不要按 repo 或 instance 手工加提示；需要修改 prompt 时创建新版本，并把旧结果视为不同实验。

### 4. 调用 CLI

容器内以 exec-form 参数数组调用，不经过 shell 拼接：

```text
timeout --signal=TERM --kill-after=30s 1830s \
  /opt/kun/bin/kun run \
  --config /run/kun-eval/config.json \
  --data-dir /run/kun-eval/data/<instance-id> \
  --workspace /testbed \
  --model <model-id> \
  --approval-policy auto \
  --sandbox-mode workspace-write \
  --jsonl \
  --prompt <rendered-prompt>
```

上面是参数结构示意；Python/Docker SDK 必须传字符串数组，不能把 prompt 插值进一整段 shell。
Kun 内部 wall time 建议为 1800 秒，外层进程 timeout 多留 30 秒用于 shutdown 和日志 flush。

当前 `kun run` 支持 `--prompt-file <path>` 和 `--prompt-file -`。适配器把完整 prompt 上传为
UTF-8 文件，CLI 按 2 MiB 上限读取；文件输入与 positional/`--prompt` 互斥，不能截断
problem statement 后继续当成可比较结果。

stdout 原样写入 `kun-events.jsonl`，stderr 写入独立日志。适配器解析 JSONL 时至少保存：

- `run_started.threadId` 和 `run_finished.turnId/status`；
- `turn_failed`、`turn_aborted`、`error`；
- 所有 tool result 的 `isError`；
- 每个 `usage` event 的 token、cache、cost、实际 provider/model；
- 开始时间、首个 assistant delta 时间、结束时间。

### 5. 提取 patch

即使 CLI 超时或失败，也先尝试从工作树提取 partial patch，并在 metadata 中保留真实终态。
固定策略建议是：每个目标实例都输出一条 prediction；没有有效 patch 时 `model_patch` 为空。
这样 official report 的分母不会因适配器失败而悄悄缩小。

在 `/testbed` 中执行等价操作：

```bash
git add -N -- .
git -c core.fileMode=false diff \
  --binary --no-ext-diff --full-index "$BASE_COMMIT" -- > patch.diff
```

`git add -N` 只用于让未跟踪的新文件进入 diff；不要提交、stash、reset 或清理 Agent 的结果。
比较 `base_commit` 而不是只运行 `git diff HEAD`，这样 Agent 即使创建了 commit，修改也不会丢失。

随后必须在一个全新的 base-commit checkout 中执行 `git apply --check patch.diff`。还要校验：

- patch 是合法 UTF-8 文本或合法 Git binary patch；
- 路径全部属于仓库；
- patch 字节数不超过 manifest 中的固定上限；
- prediction 中 instance ID 唯一且属于 target list；
- `model_name_or_path` 对整个 run 保持一致；
- 失败和空 patch 也有 `generation-results.jsonl` 记录。

### 6. 写 prediction

官方 prediction JSONL 每行只包含：

```json
{
  "instance_id": "sympy__sympy-20590",
  "model_name_or_path": "kun/benchmark-model@<run-config-id>",
  "model_patch": "diff --git a/..."
}
```

额外的 token、成本、错误和 timing 不要混进官方 prediction 对象，统一写入
`generation-results.jsonl`，通过 `instance_id` 关联。

## 批量、恢复与并发

生成脚本必须具备幂等恢复，而不是整批失败后重跑全部实例：

1. 启动时读取 target list 和已有 per-instance metadata。
2. 只有 `patch_validated` 或明确的 terminal empty-patch 记录才算完成。
3. `infra_failed` 按固定次数重试；`agent_timeout`、`cli_failed` 默认不自动换 prompt 或模型重试。
4. 每次重试保留 attempt 编号和旧日志，不能覆盖失败证据。
5. 原子写 per-instance 结果，最后按 target list 顺序重新生成 `predictions.jsonl`。
6. 重启时重新验证 archive、config、dataset 和 target-list digest，发现漂移立即停止。

generation workers 与 official evaluation workers 是两个独立参数。先把 generation workers 设为
1，完成 10-instance pilot 后再逐步增加。每个 worker 必须拥有独立 container、workspace、
data dir 和输出目录；只读 Kun archive 和模型代理可以共享。

不要在多个实例间复用 Kun thread 或 data dir。SWE-bench 的每个 instance 都应是冷启动的独立
任务，避免历史、Memory、Skill 状态、cache usage 或失败恢复相互污染。

## 官方评分

先验证官方 harness 本身：

```bash
python -m swebench.harness.run_evaluation \
  --predictions_path gold \
  --max_workers 1 \
  --instance_ids sympy__sympy-20590 \
  --run_id validate-gold
```

gold smoke 通过后再评分 Kun predictions：

```bash
python -m swebench.harness.run_evaluation \
  --dataset_name princeton-nlp/SWE-bench_Verified \
  --split test \
  --predictions_path artifacts/swebench/<run-id>/predictions.jsonl \
  --max_workers <workers> \
  --timeout 1800 \
  --run_id <run-id>
```

参数名以 manifest 中 pinned SWE-bench 版本的 `--help` 为准。正式运行保存官方生成的
`evaluation_results`、`logs/run_evaluation` 和 harness stdout/stderr，不能只抄最终百分比。

官方资料：

- [SWE-bench Evaluation Guide](https://github.com/SWE-bench/SWE-bench/blob/main/docs/guides/evaluation.md)
- [SWE-bench README](https://github.com/SWE-bench/SWE-bench/blob/main/README.md)
- [Official run_evaluation implementation](https://github.com/SWE-bench/SWE-bench/blob/main/swebench/harness/run_evaluation.py)

## 指标与结果解释

主指标必须是 target list 全分母上的 resolved rate。至少同时报告：

| 类别 | 指标 |
| --- | --- |
| 正确性 | resolved、unresolved、resolved rate |
| 生成可靠性 | attempted、CLI completed、timeout、CLI failed、infra failed |
| patch 质量 | non-empty、apply-valid、empty、invalid、patch bytes |
| 性能 | wall time P50/P95、模型 TTFT P50/P95、tool time |
| 资源 | input/output/reasoning/total tokens、cache hit、cost、peak RSS（可得时） |
| 行为 | tool calls、tool errors、测试命令调用率 |

失败原因使用稳定枚举，至少包括：

```text
resolved
unresolved
empty_patch
invalid_patch
agent_timeout
cli_failed
model_error
container_failed
image_failed
harness_failed
```

不要把 infrastructure failure 从主分母中静默排除。可以另报“排除 infra 的诊断率”，但必须同时
给出原始全分母结果和重试策略。不要从多个 attempt 中挑最高分 patch；若要跑多次采样，应把每次
作为独立 run 报告均值、方差和完整 manifest。

## 分阶段验收门禁

### Gate A：CLI 包

- Linux x64 archive SHA-256 与 runtime build ID 匹配。
- 在目标 instance image 内 `kun --version` 成功。
- `kun exec --list-tools --json` 包含 read/bash/edit/write。
- native dependency 能加载，无 ABI、glibc 或 missing shared library 错误。

### Gate B：单实例生成

- base commit 和 clean tree 断言通过。
- 实际模型完成至少一次 tool call。
- JSONL 可逐行解析且恰有一个 `run_started`、一个 `run_finished`。
- 进程在 timeout/grace 内退出，无残留子进程。
- 新文件、未提交修改和 Agent 自建 commit 都能进入 patch。
- patch 能在新 checkout 中 `git apply --check`。

### Gate C：10-instance pilot

- 10 个固定实例全部产生 prediction 行和 metadata。
- 进程重启后可幂等恢复，不重复计费已完成实例。
- secret 不出现在 argv dump、JSONL、stderr、patch 和 manifest。
- 至少一个空 patch、CLI failure 或 timeout fixture 能被正确分类。
- generation 并发 1 和目标并发下没有 data-dir/container 名称冲突。

### Gate D：官方评分

- gold smoke 在同一 pinned harness 上通过。
- predictions validator 通过，行数等于 target count。
- official harness 完成并保留 instance 级日志。
- summary 中的 resolved 数与 official report 完全一致。
- 同一 run 的 Kun、模型、prompt、数据集和网络策略无漂移。

只有 Gate A-D 全部通过，才能把结果称为 Kun SWE-bench 评测。Lite/pilot 结果不能写成 Verified
结果，公网开放结果不能与隔离网络结果合并，失败后人工修补的 patch 不能回填到原 run。

## 已知限制与后续改进

以下问题不阻塞当前工程，但可在后续 change 中继续改进：

- 让 `run_finished` 可选携带 turn usage 汇总和 terminal error 摘要，降低适配器解析成本。
- 为 Linux standalone archive 增加 Ubuntu 22.04/SWE-bench image 兼容 smoke。
- 评估增加 benchmark 专用 `--output-dir`/run metadata 契约，但不要把 SWE-bench 逻辑塞进 AgentLoop。

在这些改进完成前，本文规定的 config、外层 timeout、JSONL 聚合和 patch validator 是必须保留的
兼容层，不能由评测人员临时省略。
