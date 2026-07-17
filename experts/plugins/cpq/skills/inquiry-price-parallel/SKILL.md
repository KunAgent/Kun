---
name: inquiry-price-parallel
description: >-
  CPQ 的内部子能力 · 多商品配置清单的并发询价编排器，**仅由 cpq skill 在其询价子流程中调用**，
  禁止 agent 在响应用户请求时直接加载本 skill。即使用户输入命中"询价 / 查价格 / 配置清单报价 /
  批量报价 / 多商品询价 / 并发询价"等关键词，也**必须**先加载父级 cpq skill，由 cpq 主流程按其
  内部路由判断是否进入本 skill；用户请求里没有显式提到 cpq 时，应优先加载 cpq skill 走主流程，
  而不是直接进入本 skill。本 skill 只负责把 cpq 主流程已经裁决过的 tasks 按行机械 fan-out 给
  远端询价智能体，处理追问 / 异常重试 / 超时 / 用户中止，每轮聚合产出 summary.xlsx 与
  download_links；不承担站点判定、客户分层、配置单上下文等主流程职责。
---

# 拆分并发询价 skill（inquiry-price-parallel）

本 skill 是 **独立发行版**，不依赖 `inquiry-price-master` / `inquiry-price-modified`。

设计依据：`docs/superpowers/specs/2026-06-16-inquiry-price-parallel-design.md`

---

## 🔒 调用契约（最高优先级 · 高于"核心定位"）

本 skill 是 **CPQ 流程的内部子能力**，**不是用户级入口**。所有客户报价相关任务的统一入口是
`cpq` skill。

- ✅ **唯一允许的进入方式**：由 `cpq` skill 在其询价编排阶段（详见 cpq SKILL.md 的渐进加载
  路由 D 段）显式调用
- ❌ **禁止**：agent 在响应用户的「帮我查价 / 询价 / 报这批配置 / 这些产品多少钱」类请求时
  直接加载本 skill 而跳过 cpq 主流程
- ❌ **禁止**：以"用户没提 cpq 但意图明显是询价，所以直接进入本 skill"为由绕开 cpq

### 如果你（agent）发现自己被直接激活（不是被 cpq 调进来的）

立即停止本 skill 的步骤 1，改为：

1. 用 `use_skill` 工具加载 `cpq` skill
2. 按 cpq SKILL.md 的「启动判断」与「渐进加载路由」走主流程
3. cpq 自身在其询价子流程内会按需重新调用本 skill；那时你再从下面的步骤 1 开始执行

> **设计原因**：CPQ 主流程承担站点判定（cn/intl）、客户分层、配置单上下文、与选品 / 优惠 /
> 系统配置单的衔接等责任。单独跑本 skill 会丢失这些上下文，产出的 summary.xlsx 无法回写到
> 客户报价主线，等于把本应由 cpq 编排的任务降级成一次孤立的并发询价。

---

## 🎯 核心定位（最高优先级）

加载本 skill 后，你（IDE LLM）的角色是 **询价编排器的客户端代理 + 双向管道 + 受约束的语义判断者**：

- **机械搬运** 用户输入 → markdown 表格
- **写 tasks.json 提案**（按行 fan-out）→ 由 `split_tasks.py` 校验
- **拉起 `parallel_orchestrator.py`**，等待退出码
- **当编排器 exit 10 时**：读 `pending.json` → 按步骤 6 模板转给用户 → 收集回复写 `answers.json` → `--resume`

**永远不做**：推算价格、换算价格、合并价格、改写远端原文（含 [价格] 段的值与单位）、改写用户原文、替用户回答远端追问、自行判断该不该问。

> 注：本地**允许**把远端结构化返回的 `[价格]` 段**逐字原样**搬运到 `summary.xlsx` 的 `remote_price` 列（铁律 6 改造版）；这不是"解析价格"——值与单位完全以远端 LLM 返回为准，本地零数字运算。

---

## 六条铁律（任一违反立刻回退重做）

### 铁律 1-4：继承 master 单链路四条

（用户输入忠实搬运 / 服务端响应忠实展示 / 客户端是双向管道 / 产品归属交服务端）

### 铁律 5：拆分 = 按行机械 fan-out，不按语义重组

- 唯一允许的"AI 动作"是识别"哪些行是数据行、哪行是表头"
- 单元格内容字节级保留（`中国香港` ≠ `ap-hongkong`，`2C4G` ≠ `2核4GB`）
- `split_tasks.py` 的规范化后比对是这条铁律的最后一道闸门

### 铁律 6：价格值与单位只能原样搬运远端结构化返回，本地绝不解析 / 换算 / 推算

- 价格信息**只能**来自远端的 `[价格]` 结构化段 / `[结果信息]` 原文 / `download_links`，原样搬运
- `summary.xlsx` 的 `remote_price` 列**逐字**等于远端 `[价格]` 段（`task_state.price_info`）；**绝不**新增任何本地派生 / 计算出来的价格列（单价、总价、金额汇总、折扣换算等）
- 本地代码只做：解析远端 `[结论]` 标签（四态枚举）+ 字符级原样提取 `[价格]` / `[四层]` 段；`[结果信息]` 字段一律原样保留。数值与单位的换算 / 估算 / 推测一律由远端完成，**本地零数字运算**
- **`[四层]` 段（腾讯云四层商品编码）同源约束**：协议层向远端显式索取 `[四层]` 段，成功结论时字符级原样提取写入 `summary.xlsx` 的 `four_layer` 列（`task_state.four_layer`），供 CPQ 选品复用；远端没给则该列为空。四层编码**只来自远端返回原文，本地零补全 / 零猜测 / 零编造**

### 自由文本转表格白名单

允许：分行、提"用户已显式声明的公共信息"列、保留原话；
禁止：拆字段（2C4G→核数/内存）、归一化（中国香港→ap-hongkong）、加空白列、改写原话。

---

## 整体流程

```
用户输入 → [LLM] markdown 表格 → [LLM] 调 build_proposal.py 生成提案
    ↓
split_tasks.py 校验 → should_parallel?
    ├─ false (任务数 < 3) → 直接调 call_knot_agent.py 单链路
    └─ true → parallel_orchestrator.py
        ↓
    一次调用内自动连跑多轮：
        ↓ 滑动窗口并发（默认 6）发送请求（含 [结论]/[结果信息]/[价格]/[四层] 协议指令）
        ↓ 写 round_M_results.json
        ↓ 本地解析每个任务的 [结论] 标签（成功时另原样提取 [价格]/[四层] 段）→ 更新 task_states
        ↓ 覆盖式写 summary.xlsx / summary.md
        ↓ 仍有 asking? 仍有 exception 待重试?
        ↓
    asking 待用户 → exit 10 + pending.json → 步骤 6
    全终态 → exit 0 + summary.xlsx + summary.md
```

---

## 调用模板

### 步骤 1：检查环境

**首次使用本 skill / 鉴权失败 / 报缺依赖时**：MANDATORY READ ENTIRE FILE [`references/setup.md`](references/setup.md)（Python 版本、依赖、路径约定、OAuth 鉴权机制）。

**Do NOT Load** `setup.md`：已成功跑过任意 run 的同一会话内，不必重读。

一句话要点：鉴权**不依赖 shell 环境变量**，默认走浏览器 OAuth，ticket 缓存在 `~/.workbuddy/cpq/knot-ticket.json`，24h 内无感复用。**不要再让用户 export KNOT_API_TOKEN 或 source profile**。

### 步骤 2：用户输入 → markdown 表格

**用户提供非 markdown 输入时**：MANDATORY READ [`references/input-parsing.md`](references/input-parsing.md) 对应 §段（A=Excel · B=PDF · C=Word · D=图片 · E=自由文本与下游契约）。

**Do NOT Load**：用户直接给了 markdown 表格 / 已有 `source_table.md` / 单纯做 --resume 续跑时。

按输入文件类型选择解析策略，**优先使用父级 `cpq/skills/` 目录中的专用 skill**：

| 输入类型                            | 优先策略                                                                    | 降级策略                     |
| ----------------------------------- | --------------------------------------------------------------------------- | ---------------------------- |
| `.xlsx` / `.xls` / `.xlsm` / `.csv` | 加载 `xlsx-manipulation` skill（用 `use_skill`）→ openpyxl 读取             | 本 skill 的 `parse_excel.py` |
| `.pdf`                              | 加载 `pdf-extraction` skill（用 `use_skill`）→ pdfplumber 提取表格/文本     | LLM 视觉识图                 |
| `.docx` / `.doc`                    | 加载 `docx-manipulation` skill（用 `use_skill`）→ python-docx 提取表格/文本 | LLM 视觉识图                 |
| 图片（`.png` `.jpg` 等）            | LLM 视觉直接识图                                                            | —                            |
| 自由文本                            | 按白名单转 markdown 表格                                                    | —                            |

把最终的 markdown 表格保存到 `<run-dir>/source_table.md`。

### 步骤 2.5：识别用户自然语言中的公共信息（如有）

用户在请求中可能用自然语言提供"全表通用"的信息（不是某一行的，而是适用于所有商品）。如果存在，整合成一句简短文本，**仅限以下白名单字段**：

- **站点**：国内站 / 国际站 / 中国站
- **地域**：北京 / 广州 / 新加坡 / ap-singapore 等
- **计费模式**：包月 / 按量 / 包年
- **时长**：1 个月 / 12 个月
- **数量**：1 台 / N 个
- **币种**：CNY / USD

⚠️ **禁止识别的内容**：

- 任何"产品规格"（CPU、内存、存储、带宽等）— 这些只能在表格列里
- 任何"哪个地区便宜帮我选" / "推荐配置" — 这是远端智能体的工作
- 不在白名单的字段（默认走原表 / 由远端追问）

整合成一句话作为下一步 `--common-context` 参数，例如：

- 用户说"国际站、新加坡" → `站点=国际站，地域=新加坡（ap-singapore）`
- 用户说"包月、查 12 个月" → `计费模式=包月，时长=12 个月`
- 用户没说全表共用信息 → 不传该参数（步骤 3 直接省略）

### 步骤 3：调 build_proposal.py 生成 tasks 提案

```bash
SKILL_BASE_DIR="<加载 skill 时显示的 Base directory>"
# RUN_DIR 由调用方决定（必填 · 绝对路径）：
#   - 直接被用户调用时：默认 "<workspace>/.tmp/inquiry-price-runs/run_$(date +%Y%m%d_%H%M%S)_$(openssl rand -hex 2)"
#   - 被宿主 skill 调用时（如 cpq Phase 4.1）：**必须**指定为 "$CPQ_SESSION_DIR/inquiry-run"
#     （固定子目录名 · 与 orchestrator/_cpq_delegate_gate.py 信号 2 路径推断对齐 · 否则下游
#      fill-phase4-1.mjs / 强制 fallback 规则定位 summary.xlsx 会发生"目录漂移"）
#     调用方还**必须**导出 CPQ_DELEGATION=1 显式声明委托关系。
#     完整规约见：plugins/cpq/skills/cpq/references/how-to-query-pricing.md「委托调用规约」段
# 不再硬编码到 .tmp/inquiry-price-runs/ —— build_proposal.py / split_tasks.py / parallel_orchestrator.py
# 三个脚本都按 --output / --run-dir 接受任意绝对路径，本 skill 不做路径策略限定
RUN_DIR="${RUN_DIR:-<workspace>/.tmp/inquiry-price-runs/run_$(date +%Y%m%d_%H%M%S)_$(openssl rand -hex 2)}"
mkdir -p "$RUN_DIR"

cp source_table.md "$RUN_DIR/source_table.md"

# 不带公共信息（步骤 2.5 没识别到）
python3 "$SKILL_BASE_DIR/scripts/build_proposal.py" \
  --source-table "$RUN_DIR/source_table.md" \
  --output       "$RUN_DIR/tasks_proposal.json"

# 或带公共信息（步骤 2.5 整合的字符串）
python3 "$SKILL_BASE_DIR/scripts/build_proposal.py" \
  --source-table "$RUN_DIR/source_table.md" \
  --output       "$RUN_DIR/tasks_proposal.json" \
  --common-context "站点=国际站，地域=新加坡（ap-singapore）"
```

脚本会按行机械 fan-out：每个数据行 → 一个 task，每个 message = 表头 + 分隔行 + 该数据行（三行精确拼接）。

> **关于行合并单元格**：`build_proposal.py` 不做任何"前向填充"——合并语义必须在 markdown 生成阶段（步骤 2）就处理完。Excel 由 `parse_excel.py` 基于 openpyxl 的真实合并区域 metadata 填值（只在合并组内填，不跨组）；图片/PDF 视觉识图必须按视觉合并边界把值复制到每一行（详见 `references/input-parsing.md` §D 处理原则第 2 条）。
>
> ⚠️ **不要让 build_proposal.py 做"上一行非空就抄给下一行"**：到了 markdown 阶段合并组边界已丢失，盲目前向填充会跨越合并组，把上一组的值错误地填到本应留空的下一组。这违反铁律 1（忠实搬运）。

> **关于 `--common-context`**（P2 引入）：传入的字符串会作为 `common_context_suffix` 顶层字段写入 `tasks_proposal.json` / `tasks.json`，**不会**进任何 `task.message`（保留 split_tasks 的字符级校验闸门）。编排器在第一轮发送时，每个 task 的 message 末尾会自动追加 `\n\n<common_context>`。第二轮起（asking 用户回复 / exception 自动重试）不再追加。

⚠️ **不要让 LLM 手写 tasks_proposal.json**。机械搬运下沉到脚本，避免反斜杠 / 全角标点 / 字面 `\n` / 空单元格 / emoji 等转义错配（issue 2/3/4 历史教训）。如果脚本报错（exit 2），说明 source_table.md 本身有问题（无 separator 行 / 无数据行 / 编码异常），回到步骤 2 修正。

⚠️ **不要把"产品规格"塞进 `--common-context`**（issue 1 历史教训）。白名单见步骤 2.5。规格类信息只能在表格列里；缺什么由远端智能体追问。

### 步骤 4：调 split_tasks.py 校验 + 落盘

```bash
python3 "$SKILL_BASE_DIR/scripts/split_tasks.py" \
  --tasks-json-file "$RUN_DIR/tasks_proposal.json" \
  --source-table-file "$RUN_DIR/source_table.md" \
  --run-dir "$RUN_DIR"
```

> 步骤 3 + 步骤 4 是两层防线：build_proposal 机械生成提案，split_tasks 字符级校验把关。两者解耦，任意一方代码改动都不会绕过另一道闸门。

读 stdout 的 `should_parallel` 决定下一步：

- `true` → 步骤 4.5（鉴权预热）→ 步骤 5
- `false` → 步骤 4.5（鉴权预热）→ 直接调 `call_knot_agent.py`（单链路退化路径）

### 步骤 4.5：环境预热（**进入网络调用前必跑**）

```bash
python3 "$SKILL_BASE_DIR/scripts/call_knot_agent.py" --ensure-auth
```

这一步是**进入并发 fan-out 前唯一的串行环境闸门**，一次性检查：

1. **Python 版本** ≥ 3.9
2. **必需依赖** `requests` / `openpyxl` 已安装
3. **OAuth ticket** 有效（首次调用会弹浏览器，已 cached 时秒返回）

退出码语义：

- **退出码 0**：`{"authenticated": true, ...}` → 进入步骤 5
- **退出码 1**：`{"authenticated": false, "error": "...", "missing_deps"?: [...]}` → **停止本次询价**，把 stdout 的 JSON 原文转给用户：
  - 含 `"missing_deps"` 字段 → 直接展示并提示用户跑 `pip install <deps>`，装好后重跑步骤 4.5
  - error 含 `Python ... < 3.9` → 让用户安装/切换 Python 3.9+（IDE 内可用 `install_binary` 工具），再重跑步骤 4.5
  - 其它（OAuth 失败 / 网络异常）→ 参考 `references/setup.md` 的「鉴权失败的常见原因」，等用户排查后重跑

> ⚠️ **为什么必须先预热**：编排器会 fan-out 出多个 worker，每个 worker 独立 `import requests` + 调 `build_auth_headers`。如果环境有问题：
>
> 1. **缺依赖** → 6 个 worker 同时报 `ModuleNotFoundError: No module named 'requests'`，被 stderr=DEVNULL 吞掉，主进程只看到 `worker died without result (rc=1) × 6`，根因不可见
> 2. **ticket 过期** → 6 个 worker 同时尝试弹浏览器、抢同一个回调端口 19876，全部崩溃
>
> 预热在主流程**串行**完成上述检查，所有 worker 之后直接复用环境 + ticket 缓存。
>
> ⚠️ **不要跳过这一步直接去步骤 5**：当前实现会把 worker 进程级故障（ImportError / `worker died without result`）识别为**不可恢复**直接转 failed，但用户依然会看到 N 行 failed，体感等于"启动就崩"。`--ensure-auth` 升级版在调用方就能拦下这类问题，给用户清晰的 pip 命令而不是一堆 traceback。

### 步骤 4.6：向用户展示询价行数与耗时估算（**启动编排器之前必做**）

在拉起编排器之前，**必须**用一句话向用户展示：本次有几行询价、按当前并发数预计多久跑完、是否要分批跑。这一步只展示信息、**不阻塞 / 不等用户确认**，展示完即按步骤 5 启动编排器。

#### 估算公式

设：

- `N` = `split_tasks.py` 输出的 `task_count`（询价行数）
- `C` = `--concurrency`（默认 6）
- `T_max` = `--per-task-timeout`（默认 300 秒）
- `BATCH_SIZE` = **15**（分批轮次模式的每批最大行数 · 2026-06-22 引入 · 见步骤 5）

按 N 决定路径：

| N 范围 | 路径 | 批数 M | 单批内部窗口数 B | 典型耗时 | 上限耗时 |
|---|---|---|---|---|---|
| **N ≤ 15** | 5A 单次调用 | 1 | `ceil(N/C)` | `B × 60s` | `B × T_max` |
| **N > 15** | 5B 分批轮次循环 | `ceil(N/15)` | `ceil(15/C)`（每批） | `M × B × 60s` | `M × B × T_max` |

> ⚠️ **公式只覆盖首轮**。若有 `asking` / `exception` 重试，会增加额外轮次（asking 取决于用户回答速度，无法估；exception 自动重试 1 次最多再加 1 个首轮耗时）。展示时**只报首轮典型 / 上限**。

#### 展示模板

按下面格式向用户展示一条信息（**用人话**，不要把变量名 / 公式直接 dump 给用户）：

**N ≤ 15（5A 单次）**：
```
本次共 <N> 行询价，将以并发 <C>、单任务超时 <T_max>s 启动询价。
预计耗时：典型约 <B*60>s（≈ <B 分钟>），最长不超过 <B*T_max>s（≈ <B*T_max/60> 分钟）。
若有任务需要追问或异常重试，会在此基础上增加额外轮次。
```

**N > 15（5B 分批轮次）**：
```
本次共 <N> 行询价（超过单批 15 行上限）·
将拆成 <M> 批跑（每批 ≤15 行 · 并发 <C> · 单任务超时 <T_max>s）·
每批跑完都是天然进度点 · 不会因为长时间运行被打断。
首轮预计耗时：典型约 <M*B*60/60> 分钟 · 最长不超过 <M*B*T_max/60> 分钟。
若有任务需要追问 · 会在本轮所有批跑完后一次性向你展示 · 回答后启动下一轮。
```

举例：
- N=18, C=6, T_max=300：M=2, B=3 → 单批典型 3min · 总典型 6min · 总上限 30min
- N=90, C=6, T_max=300：M=6, B=3 → 单批典型 3min · 总典型 18min · 总上限 90min

> ⚠️ 展示后**直接进入步骤 5**，不要等用户回复"OK"再继续——这是单向告知，不是确认环节。如果用户主动回复要求改并发 / 超时，再调整步骤 5 的命令行参数。

#### 单链路降级路径不展示

如果步骤 4 输出 `should_parallel: false`（任务数 < 3），跳过本步骤，直接走 `call_knot_agent.py` 单链路。

### 步骤 5：拉起编排器（按 N 分流）

**按任务数 N 自动选路径**：

| 任务数 N | 范式 | 调度边界 | 主 agent 行为 |
|---|---|---|---|
| **N ≤ 15** | 5A 单次调用 | 一次调用消化全部 | 阻塞等编排器返回退出码 |
| **N > 15** | **5B 分批轮次循环** | 每批 ≤15 行 = 一次调用 | 主 agent 主导调度 · 每批一次调用 |

> **2026-06-22 引入 5B 的原因**：长任务（如 N=90）在 5A 单次调用模式下 · 编排器作为主 agent 前台子进程跑 ~15 分钟 · 容易被主 agent 活跃时间窗口杀掉。5B 通过"每批结束 = 主 agent 活跃时间天然重置点"绕过该限制 · 设计依据见 `docs/2026-06-22-batching-design.md`。

启动方式（跨平台兼容）：

- macOS / Linux / Windows / WorkBuddy agent：统一**前台直跑**（由调用方/平台管理超时）

编排器入口已加 **run-dir 单实例锁**（POSIX fcntl / Windows msvcrt 跨平台兼容）。即使误重启，第二次会直接 `exit 1` 并明确告知，不会污染 task_states.json。

**MANDATORY READ** [`references/parallel-flow.md`](references/parallel-flow.md) §"启动模板"，按其中 **5A** 或 **5B** 执行。

退出码语义速查（5A / 5B 含义维度不同 · 详细排查见 reference 5C）：

| exit  | 5A 单次调用 | 5B 单批调用 | 下一步 |
|---|---|---|---|
| `0` | 全部终态 | 本批全终态 | 5A：跳「完成态展示」；5B：跑下一批，所有批跑完检查全局 |
| `10` | 有 asking 待用户回复 | 本批有 asking（其它任务可能仍 pending） | 5A：进步骤 6；5B：继续跑下一批，所有批跑完后**一次性**进步骤 6 |
| `1` | 编排器自身错误 | 同 | 检查 stderr / 锁信息 · 中止 |

任务状态枚举速记：`concluded`(终)·`failed`(终)·`asking`(等用户)·`exception`(自动重试 1 次)·`timeout`(终·不重试)·`aborted_by_user`(终)。

#### 5B 分批轮次循环（N > 15 必走 · 主 agent 调度算法）

> **核心心智**：编排器**完全不知道**"批"和"轮次"的存在 · 它只看到"被告知处理这一组 task_ids"。批次 / 轮次的智能完全在主 agent。
>
> 主 agent 把 N 行切成每批 ≤15 行 · 每批一次编排器调用 · 每次 exit 都是主 agent 活跃时间的天然重置点。
>
> 完整 bash 模板与边界处理见 [`references/parallel-flow.md`](references/parallel-flow.md) §"5B 分批轮次循环"。

主流程伪代码（主 agent 逐步执行 · 每个 ⬇ 都是一次主 agent 动作）：

```
ROUND = 1
while True:
    ⬇ 1. 扫 task_states.json · 收集 status ∈ {pending, exception} 的 task_id 列表 = TODO_IDS
       （首轮启动时 task_states.json 还不存在 → TODO_IDS = tasks.json 中全部 task_id）

    ⬇ 2. 若 TODO_IDS 为空：
         - 全局有 status=asking → 进步骤 6（一次性问用户）
         - 否则 → 跳「完成态展示」段（全终态）

    ⬇ 3. 把 TODO_IDS 切成每批 ≤15 个的子列表 (BATCH_SIZE=15) · 共 M 批

    for batch_idx in 0..M-1:
        BATCH_IDS = TODO_IDS[batch_idx*15 : (batch_idx+1)*15]
        ⬇ 4a. 首轮首批：用 --tasks-file 初始化 task_states.json
               python3 parallel_orchestrator.py \
                 --tasks-file "$RUN_DIR/tasks.json" --run-dir "$RUN_DIR" \
                 --batch-task-ids "<BATCH_IDS 逗号分隔>" \
                 --concurrency 6 --per-task-timeout 300

           ⬇ 4b. 其它批 / 轮次 2+：用 --resume
               python3 parallel_orchestrator.py --resume "$RUN_DIR" \
                 --batch-task-ids "<BATCH_IDS 逗号分隔>" \
                 --concurrency 6 --per-task-timeout 300

        ⬇ 5. 拿到 exit code:
              - 0 / 10 → 输出"已完成第 (batch_idx+1)/M 批"（不阻塞 · 不等用户）→ 继续下一批
              - 1 / 3  → 报错给用户终止整个循环

    ⬇ 6. 本轮次 M 批跑完 → 检查 task_states.json 是否还有 status=asking：
         - 有 → 跳出循环 · 走步骤 6 一次性问 · 写 answers.json · 回到 while 顶 · ROUND += 1
         - 无 → 检查 TODO_IDS 是否新一轮还有 → 跳到 while 顶 · 自然 break
```

⚠️ **关键约束**：

1. ✅ **全程同一个 `$RUN_DIR`**：所有批次共享 `tasks.json` / `task_states.json` / `summary.xlsx`。`summary.xlsx` 始终是当前 RUN_DIR 的**全量快照**（已跑批的行有结果 · 未跑批的行 status=pending）
2. ✅ **不持久化"上次的 RUN_DIR"**：用户中断后说"继续执行任务"·主 agent 不自动续跑（除非用户明确给路径）·按新询价从头跑
3. ❌ **禁止**让两个编排器进程并发跑同一个 RUN_DIR——run-dir 单实例锁会拒绝第二个（exit 1）·但主 agent 自身要保证不并发调度
4. ❌ **禁止**每批一个独立 RUN_DIR——会把 summary.xlsx 切碎 · 违反产物契约

### 步骤 6：处理 pending.json（5A exit 10 / 5B 全部批跑完后有 asking 时）

**MANDATORY READ ENTIRE FILE** [`references/pending-presentation.md`](references/pending-presentation.md)。该文件给出完整的：

- 步骤 6A 汇总表格模板（进度行 / asking / failed / timeout 三块 · 按 `summary` 字段省略规则）
- 步骤 6B `ask_followup_question` 调用样例（选项识别 4 种模式 · 强制「其它」兜底 · 4 题上限）
- `answers.json` 写入规则（字符级搬运 · 唯一允许的语义判断 = 中止意图识别）

> **5B 分批轮次模式下**：步骤 6 在**整轮所有批跑完后**才执行一次（攒齐本轮所有 asking）·**不要**每批 exit 10 都立即问用户（那会让用户每 ~3min 被打扰一次）。`pending.json` 由编排器每批 exit 10 时覆盖式写入 · 主 agent 只读最后一次的快照（含全量 asking 行）即可。

按 reference 处理完写好 `answers.json` 后：

- **5A 单次调用**：回到本步骤末尾按下面命令 **--resume**（前台直跑），退出码处理同步骤 5：

  ```bash
  python3 "$SKILL_BASE_DIR/scripts/parallel_orchestrator.py" --resume "$RUN_DIR"
  EXIT_CODE=$?
  echo "orchestrator_exit_code=$EXIT_CODE"
  ```

- **5B 分批轮次**：回到 5B 主循环顶部（ROUND += 1）·重新扫 task_states.json 收集新一轮 TODO_IDS · 重新拆批 · 逐批用 `--resume --batch-task-ids` 跑（如 §5B 模板）。**不要**直接全量 `--resume` 不带 batch · 会丧失分批保护。

**不要**用 `kill -0 $PID` / `wait $PID` 探测状态——退出码本身已是结果。

---

## 完成态展示

编排器退出码 `0` 时：

1. 读 `$RUN_DIR/summary.md` 给用户做总览
2. 列出 `summary.xlsx` 中各 `concluded` 任务的 `download_links`
3. 提示：本地汇总表在 `$RUN_DIR/summary.xlsx`，每个商品的独立报价单见各 download_links

⚠️ **绝不**自己解析 summary.xlsx 中的字段做"价格汇总"——那是用户的事，本地 LLM 只负责把链接给用户。

---

## ✋ 回应前自检清单（核心 6 条）

任意一条 yes 立刻回退重做。这 6 条是踩坑率最高的红线 · 完整 14 条详见 [`references/parallel-flow.md`](references/parallel-flow.md) §"完整自检清单"。

- [ ] **铁律违反**：我是否改写过用户原文 / 解析过远端 `[结果信息]` 抠价格数字 / 在 summary 展示时做了价格汇总？
- [ ] **职责越界**：我是否替用户回答了远端追问？或把"产品规格"（CPU / 内存 / 存储 / 带宽）/ 用户没说的内容写进了 `--common-context`？
- [ ] **手抄提案**：我是否手写了 `tasks_proposal.json` 而不是调 `build_proposal.py`？（必须用脚本）
- [ ] **exit 10 误处理**：我是否用纯文本逐条追问而非调 `ask_followup_question`？或忘了给每个问题追加「其它」兜底？
- [ ] **过早宣告完成**：我是否在没看到 `summary.md` 与 `download_links` 的情况下就告诉用户"已完成"？
