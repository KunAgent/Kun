# Kun Agent Benchmark 一键评测

本文说明如何用同一套工程运行 Kun 的三项外部 Agent benchmark：

- SWE-bench Verified（官方 SWE-bench v5.0.1）；
- DeepSWE v1.1（固定任务 commit + Pier 0.3.0）；
- Terminal-Bench 2.1（Harbor 0.21.0）。

Windows 10/11 用户请使用 Docker Desktop WSL2 Linux engine，并按
[`agent-benchmarks-windows.md`](./agent-benchmarks-windows.md) 完成安装、PowerShell 委派、
资源配置和三套评测验证；不支持用 Windows Python 或 Windows containers 直接运行。

SWE-bench 的 patch 生成和评分细节另见
[`swe-bench-evaluation.md`](./swe-bench-evaluation.md)。

## 结论边界

仓库提供统一的 `benchmark:agents` 入口、固定依赖、Linux Kun archive builder、三套 suite
driver、Harbor/Pier import-path agent、JSONL→ATIF 转换、恢复、验证和汇总。

命令完成且 task reward 为 0 表示 Agent 被官方 verifier 判定未完成任务，不是工程故障；只有
镜像、CLI、patch、trajectory 或 verifier 没有正常走到终态才算 infrastructure failure。

当前本机工程验收只执行 dry-run、mock provider 和 fake environment 测试。执行时 Docker
daemon 未稳定可用，磁盘可用空间约 24 GiB，低于真实 smoke 的 60 GiB preflight 门槛，因此
没有声称三项真实任务已经跑过。

## 依赖

- `uv`；
- Docker Desktop/Engine 和 buildx；
- 至少 60 GiB 可用磁盘（全量 SWE-bench 需要更多）；
- 能运行 `linux/amd64` 容器；
- 一个 OpenAI-compatible 模型 endpoint。

主 benchmark 环境固定 Python 3.12、Harbor 0.21.0 和 Pier 0.3.0，锁文件在
`benchmarks/agent-evals/uv.lock`。SWE-bench 使用独立 Python 3.11 环境和独立锁文件，避免
官方 harness 的 Python 支持范围影响 Harbor/Pier。

## 模型环境变量

真实运行前设置：

```bash
export KUN_BENCH_BASE_URL="https://provider.example/v1"
export KUN_BENCH_API_KEY="..."
export KUN_BENCH_MODEL="provider-model-id"
export KUN_BENCH_ENDPOINT_FORMAT="openai-chat-completions"

# 可选
export KUN_BENCH_REASONING_EFFORT="max"
export KUN_BENCH_SERVICE_TIER="priority"
```

API key 只进入 Kun 进程环境，不出现在 argv、manifest、ATIF 或 command artifacts。运行产物
还会按精确 secret 值做二次 redaction。不要把 `.env` 或 credential store 放入 benchmark
workspace。

## 一键命令

不调用 Docker 或模型的完整命令预演：

```bash
npm run benchmark:agents -- \
  run --suite all --preset smoke --dry-run
```

真实三项 smoke：

```bash
npm run benchmark:agents -- \
  run --suite all --preset smoke
```

只运行一套：

```bash
npm run benchmark:agents -- run --suite swebench --preset smoke
npm run benchmark:agents -- run --suite deepswe --preset smoke
npm run benchmark:agents -- run --suite terminal-bench --preset smoke
```

可用操作：

```bash
npm run benchmark:agents -- preflight --suite all --preset smoke
npm run benchmark:agents -- build-kun
npm run benchmark:agents -- resume --run-id <run-id>
npm run benchmark:agents -- validate --run-id <run-id>
npm run benchmark:agents -- summarize --run-id <run-id>
```

`run` 未提供 `--kun-archive` 时，会在 Ubuntu 22.04/amd64 builder 中用 Node 22.23.1
构建当前 Git commit 的 standalone Kun 包。已有经过校验的包可以复用：

```bash
npm run benchmark:agents -- run \
  --suite all \
  --preset smoke \
  --kun-archive /absolute/path/Kun-TUI-...-linux-x64.tar.gz
```

## Presets

| Preset | SWE-bench | DeepSWE | Terminal-Bench | Attempts |
| --- | --- | --- | --- | --- |
| `smoke` | `sympy__sympy-20590` | `abs-module-cache-flags` | `regex-log` | 1 |
| `pilot` | 排序后的前 10 项 | seed 0 的 10 项 | 固定任务 ID 的 10 项 | 1 |
| `full` | Verified 全量 | v1.1 全量 113 | 2.1 全量 | 1 |

Terminal-Bench leaderboard 要求每任务至少五次并公开上传轨迹；本工程默认是内部评测的一次
attempt，不执行上传或 leaderboard PR。

## 各 suite 的真实流程

### SWE-bench

1. 独立 Python 3.11 环境加载官方 v5.0.1 harness 和 Verified dataset。
2. 根据官方 TestSpec 拉取/构建 instance image，在 `/testbed` 运行 Kun。
3. 以 `base_commit` 对工作树做 binary diff，包括未跟踪文件和 Agent 自建 commit。
4. 在新的 detached checkout 中执行 `git apply --check`。
5. 写 `predictions.jsonl`，调用官方 evaluator，并保存逐实例日志。

### DeepSWE

1. checkout 固定为 `3cda4081fed96103a6395de39c85e9b20275e307`。
2. Pier 通过 `kun_bench.pier_agent:KunPierAgent` 把固定 Kun archive 上传到任务容器。
3. Kun 在 `/app` 完成长任务；adapter 把修改提交为单一 benchmark commit。
4. DeepSWE 的 `pre_artifacts.sh` 提取 `base_commit..HEAD` patch，独立 verifier container 评分。
5. 保存 reward、CTRF、verifier logs、原始 Kun events 和 ATIF v1.7 trajectory。

### Terminal-Bench

1. Harbor 解析 `terminal-bench/terminal-bench-2-1` 数据集。
2. `kun_bench.harbor_agent:KunHarborAgent` 上传并运行 Kun。
3. 原始 events 转换成 Harbor 可校验的 ATIF v1.7 trajectory。
4. 官方 task verifier 评分；reward 0 仍是一次完成的评测。

## 产物

默认写入 `artifacts/benchmarks/<run-id>/`：

```text
run-manifest.json
generation-results.jsonl
summary.json
swebench-request.json
suites/
  swebench/
    predictions.jsonl
    tasks/<instance>/
  deepswe/
    jobs/
  terminal-bench/
    jobs/
```

manifest 固定仓库 commit、preset digest、模型公开身份、archive SHA-256 和外部 harness pins。
`resume` 会拒绝仓库、preset、model 或 archive 漂移，并跳过已经有 terminal result 的 suite。

## 失败处理

- `dry_run`：只验证配置和命令，不证明 Docker/model 可用。
- `evaluated` + reward 0：官方评测完成，Agent 没有通过。
- `empty_patch`：SWE-bench Agent 正常结束但没有 patch。
- `infrastructure_failed`：外部命令、容器、CLI、patch 或 verifier 未完成。
- preflight blocker：缺少 uv、Docker、磁盘、模型变量或 archive。

不要删除失败的 run 目录后改 prompt 重跑并沿用同一个 run ID。调整 prompt、模型、limits 或
网络策略后应创建新 run，使 manifest 与结果保持一一对应。

## 工程验证

```bash
uv run --project benchmarks/agent-evals pytest -q
uv run --project benchmarks/agent-evals ruff check benchmarks/agent-evals
uv run --project benchmarks/agent-evals ruff format --check benchmarks/agent-evals
npm run benchmark:agents -- run --suite all --preset smoke --dry-run
npm --prefix kun run typecheck
```

真实 smoke 只有在 preflight 通过并生成官方 verifier 结果后才能标记为通过。
