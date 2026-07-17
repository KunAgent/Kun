# 会话临时目录（CPQ_SESSION_DIR）

cpq skill 把 A / B / C / D 各段的中间产物（`context.md` / `phase1.md` / `phase2.md` / `phase2_5/2_6/3/4.md` / `phase4_confirm.json` / `phase4_1.md` 等）以及若干 CLI 中转文件落盘到本次会话的临时目录，下文用占位符 `<CPQ_SESSION_DIR>` 表示。本文档是该占位符的**完整契约**：解析顺序、跨平台行为、文件命名、调试方法。

主 [SKILL.md](../SKILL.md) §会话目录 只声明"必须解析、占位符语义、解析顺序简述"，详细行为以本文为准。

---

## 设计目标

| 目标       | 含义                                                                  |
| ---------- | --------------------------------------------------------------------- |
| 可写       | 在任何沙箱里第一次 `write_to_file` 都不能 EACCES                      |
| 可读       | Phase N 写完，Phase N+1 必须能读到同一文件                            |
| 跨平台     | macOS / Linux / Windows 全适用，路径分隔符差异由脚本处理              |
| 沙箱兼容   | Claude Code CLI / CodeBuddy / WorkBuddy 容器 / 磐石+ 沙箱都默认走 cwd |
| 不污染 git | `<cwd>/.cpq-tmp/` 默认带 `.gitignore`（脚本首次运行时自动生成）       |
| 可调试     | 路径可预测、可枚举，维护者出问题时能直接 `ls .cpq-tmp/`               |
| 可覆盖     | 维护者 / 沙箱 operator 通过 `CPQ_TMP_DIR` env var 强制重定向          |

---

## 解析顺序

`scripts/resolve-session-dir.mjs` 按下列顺序尝试，前者命中即返回，**不再回退**：

| 优先级 | 来源                                  | 解析后的会话目录          | 何时命中                                               |
| ------ | ------------------------------------- | ------------------------- | ------------------------------------------------------ |
| 1      | `process.env.CPQ_TMP_DIR`（显式注入） | `$CPQ_TMP_DIR/<ts>/`      | 维护者 / 沙箱 operator 通过环境变量强制指定根目录      |
| 2      | `/workspace/outbox/`（**标准输出**）  | `/workspace/outbox/<ts>/` | 容器 / 沙箱环境下 `/workspace/outbox` 存在且可写时命中 |
| 3      | `<cwd>/.cpq-tmp/`                     | `<cwd>/.cpq-tmp/<ts>/`    | 本地开发场景；首次创建时自动写入 `.gitignore`          |
| 4      | `<os.tmpdir()>/cpq/`（兜底）          | `<os.tmpdir()>/cpq/<ts>/` | 仅当 1、2、3 都校验为不可写时（极端只读沙箱）          |

> **会话 id = `<ts>-<rand4>`**：`<ts>` 由 `date +%Y%m%d-%H%M%S` 生成（与 A 启动时刻同源），`resolve-session-dir.mjs` 追加 4 位随机后缀 `-<rand4>`（防同秒多任务碰撞）。**下文路径里出现的 `<ts>` 一律指这个带随机后缀的完整会话 id**（如 `20260621-103500-a3f9`）。同一会话内 A/B/C/D 全段复用同一会话 id。

---

## 跨平台落点

| 运行环境                              | 无 env override 时的默认会话目录 | 兜底落点                        | 是否可写 |
| ------------------------------------- | -------------------------------- | ------------------------------- | -------- |
| WorkBuddy 服务侧容器 / 磐石+ 沙箱     | `/workspace/outbox/<ts>/`        | `/tmp/cpq/<ts>/`                | ✅       |
| 用户本地 macOS / Linux（Claude Code） | `<cwd>/.cpq-tmp/<ts>/`           | `/var/folders/.../T/cpq/<ts>/`  | ✅       |
| 用户本地 Windows（Claude Code）       | `<cwd>\.cpq-tmp\<ts>\`           | `%LOCALAPPDATA%\Temp\cpq\<ts>\` | ✅       |
| cwd 只读（极端沙箱）                  | 跳过优先级 2/3 直接走兜底        | `<os.tmpdir()>/cpq/<ts>/`       | ✅       |

> Node `os.tmpdir()` 已经在三大平台上做了正确抽象（macOS = per-user 目录，Linux = `/tmp` 或 `$TMPDIR`，Windows = `%LOCALAPPDATA%\Temp`），不需要 skill 自己分支处理。

---

## 一次性解析命令

Phase 1 启动前执行一次（跨平台单行）：

```bash
node scripts/resolve-session-dir.mjs
# 输出例（末段带随机后缀 -<rand4>）：
#   macOS:   /Users/<u>/work/myproj/.cpq-tmp/20260528-163045-a3f9
#   Windows: C:\Users\<u>\work\myproj\.cpq-tmp\20260528-163045-a3f9
#   极端兜底:/var/folders/xx/.../T/cpq/20260528-163045-a3f9
```

把输出的**绝对路径**绑定到本次会话上下文，下游 Phase 全部用 `<CPQ_SESSION_DIR>/phase<N>.md` 形式引用。

### 复用同一会话目录（跨阶段）

B/C/D 等下游段不需要重新解析。如果某个 reference 提示"复用上游会话 id"，调用同一脚本并传入**完整会话 id**（含随机后缀）即可：

```bash
node scripts/resolve-session-dir.mjs 20260528-163045-a3f9
```

---

## 文件命名约定

| 段 / 用途                       | 文件名                                                  | 写入方                                                                                                                                                                                              |
| ------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A 上下文准备                    | `<CPQ_SESSION_DIR>/context.md`                          | AI（任务身份证 / 路线 / exec_mode）                                                                                                                                                                 |
| A 解析清单（Phase 1）           | `<CPQ_SESSION_DIR>/phase1.md`                           | AI（`write_to_file` 写纯 Markdown）                                                                                                                                                                 |
| B Winback（Phase 2）            | `<CPQ_SESSION_DIR>/phase2.md`                           | AI                                                                                                                                                                                                  |
| C 规范化（Phase 2.5）           | `<CPQ_SESSION_DIR>/phase2_5.md`                         | AI（cn 调用脚本后 / intl 透传后）                                                                                                                                                                   |
| C 选品意图（Phase 2.6）         | `<CPQ_SESSION_DIR>/phase2_6.md`                         | AI                                                                                                                                                                                                  |
| C 匹配产品（Phase 3）           | `<CPQ_SESSION_DIR>/phase3.md`                           | AI（汇总搜索结果）                                                                                                                                                                                  |
| C 确认映射表（Phase 4）         | `<CPQ_SESSION_DIR>/phase4.md`                           | AI（面客映射表）                                                                                                                                                                                    |
| C 确认证据（Phase 4）           | `<CPQ_SESSION_DIR>/phase4_confirm.json`                 | AI（机器确认证据，`check-phase4-confirm.mjs` 校验）                                                                                                                                                 |
| D 询价（漏斗汇总）              | `<CPQ_SESSION_DIR>/phase4_1.md`                         | `fill-phase4-1.mjs`（唯一写盘入口）                                                                                                                                                                 |
| D 询价 · 上游指纹               | `<CPQ_SESSION_DIR>/phase4_1_source.json`                | AI（D 启动前、调 inquiry-price-parallel 前写，记录来源行指纹）                                                                                                                                      |
| D 询价 · ②③层结果中转           | `<CPQ_SESSION_DIR>/layer{2,3}-results.json`             | AI（②/③ 层 CLI 跑完后整理给 `fill-phase4-1.mjs`）                                                                                                                                                   |
| D 询价 · ①层并发 run            | `<CPQ_SESSION_DIR>/inquiry-run/`                        | `inquiry-price-parallel` skill（cpq 宿主把 RUN_DIR 覆写到此，聚合 source_table.md / tasks.json / task_states.json / summary.xlsx / 日志；`summary.xlsx` 仅作回补 `phase4_1.md` 的数据源，非交付物） |
| `batch-search` 中转产物（弃用） | `<CPQ_SESSION_DIR>/batch-search-result.json`（弃用）    | `cpq product batch-search -o ...`（弃用）                                                                                                                                                           |
| `quick-search` 大结果（弃用）   | `<CPQ_SESSION_DIR>/quick-search-<keyword>.json`（弃用） | `cpq product quick-search -o ...`（弃用）                                                                                                                                                           |
| 折扣计算输入                    | `<CPQ_SESSION_DIR>/calc-discount-params.json`           | AI                                                                                                                                                                                                  |
| bash 输出乱码重定向             | `<CPQ_SESSION_DIR>/cpq_out.txt`                         | shell 重定向                                                                                                                                                                                        |

> 所有 reference 文件中出现 `<CPQ_SESSION_DIR>` 的位置 = `resolve-session-dir.mjs` 解析出的绝对路径，**禁止**用裸 `/tmp/...` 替代。

---

## 环境变量覆盖（CPQ_TMP_DIR）

什么时候需要：

- **沙箱要求 temp 落到指定卷**：例如 WorkBuddy 给容器挂载了 `/data/scratch/`，要求 cpq 临时文件落该卷
- **维护者本地调试**：临时把所有 cpq 中间产物集中到一个目录方便对比，例如 `CPQ_TMP_DIR=/Users/me/cpq-debug`
- **CI / 测试环境**：要求每个测试 case 一个独立 tempdir

用法：

```bash
export CPQ_TMP_DIR=/data/scratch/cpq
node scripts/resolve-session-dir.mjs
# → /data/scratch/cpq/20260528-163045-a3f9
```

注意：`CPQ_TMP_DIR` 命中后，**默认不会**自动写 `.gitignore`（只有 `<cwd>/.cpq-tmp/` 默认路径才会自动写 ignore）。如果你把 `CPQ_TMP_DIR` 指向 git 仓库内的某子目录，**自己**负责加 ignore。

---

## 调试与清理

### 找上次会话的产物

```bash
# 默认路径下：
ls -lt .cpq-tmp/                       # 按时间排序看最近会话
ls .cpq-tmp/20260528-163045-a3f9/      # 看该会话有哪些文件

# 兜底路径下（cwd 只读时）：
ls "$(node -e "console.log(require('os').tmpdir())")/cpq/"
```

### 强制清理

```bash
# 默认路径
rm -r .cpq-tmp/

# 兜底路径
rm -r "$(node -e "console.log(require('os').tmpdir())")/cpq/"
```

### 系统自动清理边界

| 落点                            | 系统自动清理                            | 维护者建议                          |
| ------------------------------- | --------------------------------------- | ----------------------------------- |
| `<cwd>/.cpq-tmp/`               | ❌ 不自动清理（gitignored 但留着）      | 项目结束 / 阶段验证完后手动 `rm -r` |
| macOS `/var/folders/.../T/cpq/` | ✅ 默认 ~3 天                           | 通常无需手动                        |
| Linux `/tmp/cpq/`               | 视发行版（systemd-tmpfiles 默认 10 天） | 通常无需手动                        |
| Windows `%TEMP%\cpq\`           | ❌ 不自动清理                           | 定期手动 / 用清理工具               |

---

## 落点合规性

### end-user 运行态（主要场景）

cpq skill 分发到 end-user 后，`<CPQ_SESSION_DIR>` 的三层解析全部落在 end-user 可控范围内：

- **优先级 1（env override）**：由 end-user / 沙箱 operator 显式设置 `CPQ_TMP_DIR`，责任在调用方
- **优先级 2（默认）**：`<cwd>/.cpq-tmp/<ts>/` 是 end-user 当前项目目录下的子目录，写入完全在 end-user 自己的工作区内
- **优先级 3（兜底）**：`<os.tmpdir()>/cpq/<ts>/` 是各平台标准的 ephemeral 临时目录，由 Node `os.tmpdir()` 抽象（macOS per-user / Linux `/tmp` 或 `$TMPDIR` / Windows `%LOCALAPPDATA%\Temp`），符合 CLI 工具惯例

end-user 侧的 Claude / CodeBuddy / 沙箱是否对其它路径写入有额外限制，由 end-user 自己的 AI 工具或运行环境配置决定，cpq skill 不假设也不依赖。

---

## 故障排查

| 现象                                         | 可能原因                         | 处理                                        |
| -------------------------------------------- | -------------------------------- | ------------------------------------------- |
| `cpq: no writable session dir found` 报错    | cwd / tmpdir 都不可写            | 检查 `CPQ_TMP_DIR` 是否指向可写卷           |
| Phase 2 读不到 `<CPQ_SESSION_DIR>/phase1.md` | Phase 1 写盘失败 / 用了不同的 ts | 重跑 Phase 1，确认 ts 一致                  |
| `cpq batch-search` 输出未到 stdout           | 没传 `--stdout` 参数             | 显式加 `--stdout` 参数                      |
| Windows 路径出现 `\` 和 `/` 混用             | shell 转义问题                   | 用 `path.join` 或 PowerShell 的 `Join-Path` |
