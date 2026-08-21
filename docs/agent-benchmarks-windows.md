# Windows 运行 Kun 三套 Agent Benchmark

本文给出在 Windows 10/11 上运行以下评测的完整流程：

- SWE-bench Verified；
- DeepSWE v1.1；
- Terminal-Bench 2.1。

支持架构是：

```text
Windows 10/11 x86_64
  -> WSL2 Ubuntu（代码、Node、uv、benchmark controller）
  -> Docker Desktop WSL2 Linux engine
  -> linux/amd64 benchmark containers
  -> Kun standalone Linux CLI
```

不要使用 Windows Python 或 Windows containers 直接运行完整 harness。PowerShell 只负责把
经过验证的参数委派给 WSL；真正的 Node、Python、Git 和 benchmark 命令都在 Ubuntu 内执行。

## 1. 系统要求

建议使用当前仍受 Microsoft 和 Docker 支持的 Windows 版本。Docker Desktop 当前列出的 WSL2
x86_64 要求包括：WSL 2.1.5 或更高、Windows 10 22H2 build 19045，或 Windows 11 23H2
build 22631 及以上，并在 BIOS/UEFI 中启用硬件虚拟化。

硬件建议：

| 项目 | Smoke/Pilot | Full |
| --- | --- | --- |
| CPU | 至少 8 logical CPUs | 8+，并发越高要求越高 |
| RAM | 至少 16 GiB | 建议 24–32 GiB |
| WSL swap | 8–16 GiB | 16 GiB 或更多 |
| 可用磁盘 | smoke 60 GiB，pilot 80 GiB | 至少 120 GiB |
| 架构 | x86_64/amd64 | x86_64/amd64 |

SWE-bench 官方 Docker 指南要求至少约 120 GB 可用磁盘和 16 GB RAM，并建议 Docker Desktop
分配至少 8 CPUs。Kun preflight 对 `smoke`、`pilot`、`full` 分别执行 60/80/120 GiB 的硬门槛。

官方参考：

- [Microsoft：安装 WSL](https://learn.microsoft.com/windows/wsl/install)
- [Microsoft：`.wslconfig` 配置](https://learn.microsoft.com/windows/wsl/wsl-config)
- [Docker Desktop：WSL2 backend](https://docs.docker.com/desktop/features/wsl/)
- [Docker：WSL2 best practices](https://docs.docker.com/desktop/features/wsl/best-practices/)
- [SWE-bench：Docker setup](https://github.com/SWE-bench/SWE-bench/blob/main/docs/guides/docker_setup.md)

## 2. 安装并确认 WSL2

以管理员身份打开 PowerShell：

```powershell
wsl --install -d Ubuntu
```

重启 Windows，首次打开 Ubuntu 并创建 Linux 用户。随后在 PowerShell 更新并验证：

```powershell
wsl --update
wsl --version
wsl --list --verbose
```

目标输出中 Ubuntu 的 `VERSION` 必须为 `2`。如果仍是 1：

```powershell
wsl --set-version Ubuntu 2
wsl --set-default-version 2
```

Kun wrapper 还会在运行前检查 Ubuntu 的 kernel release 是否包含 `WSL2` 或
`microsoft-standard`；WSL1 会直接失败。

## 3. 配置 WSL CPU、内存和 swap

在 `%UserProfile%\.wslconfig` 创建配置，例如一台有 32 GB RAM、16 logical CPUs 的机器：

```ini
[wsl2]
memory=24GB
processors=12
swap=16GB

[experimental]
autoMemoryReclaim=gradual
sparseVhd=true
```

不要照抄超过物理机容量的数值，要给 Windows 和 Docker Desktop UI 留出资源。修改后执行：

```powershell
wsl --shutdown
```

重新打开 Docker Desktop 和 Ubuntu。Microsoft 说明 `.wslconfig` 只作用于 WSL2，并且修改后
通常需要 `wsl --shutdown` 才能生效。

在 Ubuntu 中检查实际可见资源：

```bash
nproc
free -h
df -h ~
```

## 4. 安装 Docker Desktop

1. 安装最新 Docker Desktop for Windows。
2. Docker Desktop → Settings → General，启用 **Use the WSL 2 based engine**。
3. Settings → Resources → WSL Integration，启用 Ubuntu。
4. 确认 Docker 处于 **Linux containers** 模式。
5. 调大 Docker data/disk image 可用空间；Docker 文档给出的默认数据位置通常是
   `%LOCALAPPDATA%\Docker\wsl`，可以在 Resources → Advanced 调整位置。

Docker 官方不建议在同一个 Ubuntu 发行版中再安装一套独立 Docker Engine/CLI，因为它可能与
Docker Desktop WSL integration 冲突。

在 Ubuntu 中验证：

```bash
docker version
docker info --format '{{.ServerVersion}} {{.OSType}} {{.Architecture}}'
docker run --rm hello-world
docker buildx version
```

第二条必须报告 `linux` 和 `amd64`。如果报告 `windows`，从 Docker Desktop 菜单切换到
Linux containers。

## 5. 把仓库放在 WSL Linux 文件系统

在 Ubuntu 中：

```bash
mkdir -p ~/projects
cd ~/projects
git clone <Kun-repository-url> DeepSeek-GUI
cd DeepSeek-GUI
```

推荐路径类似：

```text
/home/<linux-user>/projects/DeepSeek-GUI
```

不要放在：

```text
/mnt/c/Users/<windows-user>/...
/mnt/d/...
```

Microsoft 和 Docker 都明确建议 Linux build/container bind mount 使用 WSL 自己的 ext4 文件系统；
`/mnt/c` 会有明显的 Git、小文件、`node_modules`、bind mount 和 inotify 性能损失。Kun 的真实
preflight 在 WSL2 中发现 `/mnt/<drive>` 会拒绝执行。

Windows 可以通过以下 UNC 路径浏览代码：

```text
\\wsl.localhost\Ubuntu\home\<linux-user>\projects\DeepSeek-GUI
```

## 6. 安装 WSL 内的开发工具

在 Ubuntu 中安装基础包：

```bash
sudo apt update
sudo apt install -y build-essential ca-certificates curl git python3-venv
```

安装 Node.js 22.23.1 和 npm。可以使用团队现有 Node 管理方案；完成后必须满足：

```bash
node --version
# v22.23.1

npm --version
```

安装 uv：

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
exec "$SHELL" -l
uv --version
```

安装仓库依赖和两个锁定的 benchmark 环境：

```bash
cd ~/projects/DeepSeek-GUI
npm ci
npm --prefix kun ci
uv sync --project benchmarks/agent-evals --all-groups
uv sync --project benchmarks/agent-evals/swebench
```

## 7. 配置模型，不把 secret 放进 PowerShell 参数

创建 WSL-local 配置：

```bash
mkdir -p ~/.config/kun
cp benchmarks/agent-evals/benchmark.env.example ~/.config/kun/benchmark.env
chmod 600 ~/.config/kun/benchmark.env
```

编辑 `~/.config/kun/benchmark.env`：

```dotenv
KUN_BENCH_BASE_URL=https://provider.example/v1
KUN_BENCH_API_KEY=replace-me
KUN_BENCH_MODEL=provider-model-id
KUN_BENCH_ENDPOINT_FORMAT=openai-chat-completions
KUN_BENCH_REASONING_EFFORT=max
# KUN_BENCH_SERVICE_TIER=priority
```

`--env-file` 支持 dotenv 语法。已经 export 到进程环境的同名变量优先于文件值。文件必须位于
WSL Linux filesystem 且权限为 `600`；API key 不会进入 manifest、ATIF 或 command argv。

## 8. 先运行 dry-run 和 preflight

在 Ubuntu 中：

```bash
npm run benchmark:agents -- \
  run \
  --suite all \
  --preset smoke \
  --env-file ~/.config/kun/benchmark.env \
  --dry-run \
  --run-id windows-dry-run
```

Dry-run 不调用 Docker 或模型，但会报告 deferred blockers。随后执行真实 preflight：

```bash
npm run benchmark:agents -- \
  preflight \
  --suite all \
  --preset smoke \
  --env-file ~/.config/kun/benchmark.env
```

必须满足：

- `host.kind` 为 `wsl2`；
- `repository_on_windows_mount` 为 `false`；
- Docker `available=true`、`os_type=linux`、`architecture=amd64`；
- disk/model/uv 没有非 deferred blocker。

CPU 或 RAM 不足以 recommendation 显示，不会阻止 smoke；磁盘、WSL、Docker 和模型配置错误会
阻止真实运行。

## 9. 从 PowerShell 调用 WSL wrapper

PowerShell wrapper 自身可以从 WSL UNC 路径启动。将下例用户名和路径替换成真实值：

```powershell
$Script = "\\wsl.localhost\Ubuntu\home\me\projects\DeepSeek-GUI\scripts\benchmarks\Invoke-KunBench.ps1"

& $Script `
  -Action preflight `
  -Distro Ubuntu `
  -RepoPath /home/me/projects/DeepSeek-GUI `
  -EnvFile /home/me/.config/kun/benchmark.env `
  -Suite all `
  -Preset smoke
```

Dry-run：

```powershell
& $Script `
  -Action run `
  -Distro Ubuntu `
  -RepoPath /home/me/projects/DeepSeek-GUI `
  -EnvFile /home/me/.config/kun/benchmark.env `
  -Suite all `
  -Preset smoke `
  -RunId windows-dry-run `
  -DryRun
```

Wrapper 只把 distro、WSL path、suite、preset、run ID 等非 secret 参数放入 `wsl.exe` argv。
API key 由 WSL 内的 Python 从 `EnvFile` 读取。

## 10. 官方 harness sanity checks

这些检查只验证官方环境，不代表 Kun 已通过任务。

### SWE-bench gold

在 Ubuntu 仓库根目录：

```bash
uv run --project benchmarks/agent-evals/swebench \
  python -m swebench.harness.run_evaluation \
  --dataset_name princeton-nlp/SWE-bench_Verified \
  --predictions_path gold \
  --max_workers 1 \
  --instance_ids sympy__sympy-20590 \
  --run_id windows-gold-smoke
```

### DeepSWE oracle

先让 Kun runner 下载固定 DeepSWE checkout，或手工 clone 到 WSL filesystem，然后：

```bash
uv run --project benchmarks/agent-evals \
  pier run \
  --path <deep-swe-path>/tasks/abs-module-cache-flags \
  --agent oracle \
  --env docker \
  --n-concurrent 1 \
  --yes
```

### Terminal-Bench oracle

```bash
uv run --project benchmarks/agent-evals \
  harbor run \
  --dataset terminal-bench/terminal-bench-2-1 \
  --agent oracle \
  --include-task-name regex-log \
  --env docker \
  --n-concurrent 1 \
  --yes
```

## 11. 运行 Kun smoke

三套一键运行：

```bash
npm run benchmark:agents -- \
  run \
  --suite all \
  --preset smoke \
  --env-file ~/.config/kun/benchmark.env \
  --run-id windows-smoke-001
```

PowerShell：

```powershell
& $Script `
  -Action run `
  -Distro Ubuntu `
  -RepoPath /home/me/projects/DeepSeek-GUI `
  -EnvFile /home/me/.config/kun/benchmark.env `
  -Suite all `
  -Preset smoke `
  -RunId windows-smoke-001
```

单独运行：

```bash
npm run benchmark:agents -- run --suite swebench --preset smoke \
  --env-file ~/.config/kun/benchmark.env --run-id windows-swebench-001

npm run benchmark:agents -- run --suite deepswe --preset smoke \
  --env-file ~/.config/kun/benchmark.env --run-id windows-deepswe-001

npm run benchmark:agents -- run --suite terminal-bench --preset smoke \
  --env-file ~/.config/kun/benchmark.env --run-id windows-terminal-001
```

先保持 concurrency 1。Smoke 全部进入官方 verifier 后，再考虑 pilot/full 或提高并发。

## 12. 恢复、验证和汇总

Ubuntu：

```bash
npm run benchmark:agents -- resume \
  --run-id windows-smoke-001 \
  --env-file ~/.config/kun/benchmark.env

npm run benchmark:agents -- validate --run-id windows-smoke-001
npm run benchmark:agents -- summarize --run-id windows-smoke-001
```

PowerShell：

```powershell
& $Script -Action resume -Distro Ubuntu `
  -RepoPath /home/me/projects/DeepSeek-GUI `
  -EnvFile /home/me/.config/kun/benchmark.env `
  -RunId windows-smoke-001

& $Script -Action validate -Distro Ubuntu `
  -RepoPath /home/me/projects/DeepSeek-GUI `
  -RunId windows-smoke-001

& $Script -Action summarize -Distro Ubuntu `
  -RepoPath /home/me/projects/DeepSeek-GUI `
  -RunId windows-smoke-001
```

产物默认位于 WSL 仓库的 `artifacts/benchmarks/<run-id>/`。

## 13. 常见问题

### `native_windows_unsupported`

不要在 PowerShell 中直接执行 Windows Python/uv。进入 Ubuntu，或使用
`Invoke-KunBench.ps1` 委派。

### `wsl2_required`

```powershell
wsl --set-version Ubuntu 2
wsl --shutdown
```

### `wsl_windows_filesystem`

把仓库和 env file 移到 `/home/...`。不要只把 `node_modules` 移走；Git repo、artifacts 和
Docker bind-mounted 文件都应在 WSL ext4。

### `docker_unavailable`

- 启动 Docker Desktop；
- 启用 Ubuntu 的 WSL Integration；
- 在 Ubuntu 内运行 `docker version`；
- 不要同时启动另一套 dockerd。

### `docker_linux_engine_required`

Docker Desktop 当前处于 Windows container mode。切换到 Linux containers 后重新运行
preflight。

### `disk_space`

检查两层空间：

```bash
df -h ~
docker system df
```

不要让脚本自动执行 `docker system prune -a`，它会删除其他项目仍需的缓存。先在 Docker
Desktop 中扩容/移动 data disk，再由用户决定清理哪些 image/build cache。

### WSL 内存没有更新

确认 `.wslconfig` 位于 `%UserProfile%`，然后：

```powershell
wsl --shutdown
```

重新启动 Docker Desktop 和 Ubuntu，再用 `free -h` 检查。

### 公司代理或证书

先分别验证：

```bash
docker pull hello-world
curl -I "$KUN_BENCH_BASE_URL"
git ls-remote https://github.com/SWE-bench/SWE-bench.git HEAD
```

Docker Hub、GitHub、Python/npm registry 和模型 endpoint 可能需要在 Docker Desktop、WSL 和
公司 CA 三处分别配置。不要把 proxy password 写进仓库或 benchmark manifest。

## 14. 结果解释

- `dry_run`：参数和命令成立，不证明 Docker/模型可用。
- `evaluated` + reward 0：官方 verifier 已完成，Agent 没通过。
- `empty_patch`：SWE-bench 没有生成 patch。
- `infrastructure_failed`：镜像、CLI、patch、trajectory 或 verifier 没有完成。
- PowerShell `$LASTEXITCODE` 会原样反映 WSL 内 `kun-bench` 的退出状态。

Windows 可以可靠承担 smoke/pilot 和较小并发；全量 Verified、DeepSWE、Terminal-Bench 会消耗
大量时间、模型费用和 Docker 空间。需要稳定大规模分数时，仍建议 Linux x86_64 裸机或云环境。
