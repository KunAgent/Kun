# 并发编排器流程参考（结论协议版）

> **加载触发**：
>
> - **MANDATORY READ** — 当 SKILL.md 步骤 5 第一次启动编排器 / 步骤 6 末尾 --resume 时，本文件 §"启动模板" 段必读
> - **MANDATORY READ** — 当需要排查任务状态机 / 退出码 / 异常重试预算 / pending.json schema 时必读对应段
> - **Do NOT Load** — 编排器尚未启动、或本会话已成功跑过同一 run 的相同阶段时，不需要重复加载本文件
>
> 本文档配套 `scripts/orchestrator/main_loop.py` 与 `scripts/parallel_orchestrator.py` 的实际行为；与 `SKILL.md` 步骤 5/6 对应。

---

## 启动模板（SKILL.md 步骤 5 / 步骤 6 --resume 必用）

> **2026-06-22 简化（重要）**：为最大化跨系统兼容性，N ≥ 3 也统一使用前台直跑。后台运行虽然可以实时播报进度，但在 WorkBuddy agent 环境下 `nohup` / `&` 会被回收，`run_in_background:true` 的行为也不够稳定。
>
> | 任务数 N | 默认范式 | 进度反馈 |
> |---------|---------|---------|
> | N ≤ 2   | 5A 前台直跑 | 命令返回即终态 |
> | N ≥ 3   | 5A 前台直跑 | 命令返回即终态（期间无中间反馈） |
>
> 编排器自身的保护机制不变：
> - 入口持有 **run-dir 单实例锁**（POSIX fcntl / Windows msvcrt 跨平台兼容）
> - 误重启会 `exit 1`，不会污染 task_states.json

### 5A 前台直跑（默认）

```bash
python3 "$SKILL_BASE_DIR/scripts/parallel_orchestrator.py" \
  --tasks-file "$RUN_DIR/tasks.json" \
  --run-dir "$RUN_DIR" \
  --concurrency 6 \
  --per-task-timeout 300 \
  --progress-interval 30
EXIT_CODE=$?
echo "orchestrator_exit_code=$EXIT_CODE"
```

退出码语义见 5C。前台直跑命令一旦返回，`summary.md` / `summary.xlsx` / `pending.json` 一定是最终状态，AI 直接读它们即可。

### 5A' --resume 续跑（步骤 6 末尾用）

```bash
python3 "$SKILL_BASE_DIR/scripts/parallel_orchestrator.py" --resume "$RUN_DIR"
EXIT_CODE=$?
echo "orchestrator_exit_code=$EXIT_CODE"
```

退出码处理同步骤 5。

---

## 5B 分批轮次循环（N > 15 必走 · 主 agent 调度）

> **2026-06-22 引入**。设计依据：`docs/2026-06-22-batching-design.md`。
>
> 解决问题：长任务（N=90 量级）在 5A 单次调用模式下，编排器作为主 agent 前台子进程跑 ~15 分钟，容易被主 agent 活跃时间窗口杀掉。
>
> 解决思路：把 N 行切成每批 ≤15 行，每批一次编排器调用 = 主 agent 活跃时间天然重置点。批次智能完全在主 agent，编排器无状态化。

### 5B 调度伪代码（主 agent 执行）

```python
BATCH_SIZE = 15  # 常量 · 不暴露 CLI · 修改需改 SKILL.md 文案
ROUND = 1

while True:
    # ─── 1. 收集本轮还需处理的 task_id ───
    task_states_path = f"{RUN_DIR}/task_states.json"
    if exists(task_states_path):
        states = read_json(task_states_path)
        TODO_IDS = [
            tid for tid, st in states.items()
            if st.get("status", "pending") in ("pending", "exception")
        ]
    else:
        # 首轮启动：还没有 task_states.json · 全部 task_id 都是 pending
        TODO_IDS = [t["task_id"] for t in read_json(f"{RUN_DIR}/tasks.json")["tasks"]]

    # ─── 2. 终止条件 ───
    if not TODO_IDS:
        # 没有未终态非 asking 行
        if any(st.get("status") == "asking" for st in states.values()):
            goto STEP_6  # 一次性问用户
        else:
            goto FINAL_DISPLAY  # 全终态 · 跳「完成态展示」

    # ─── 3. 切批 ───
    M = ceil(len(TODO_IDS) / BATCH_SIZE)

    # ─── 4. 逐批跑 ───
    for batch_idx in range(M):
        BATCH_IDS = TODO_IDS[batch_idx * BATCH_SIZE : (batch_idx + 1) * BATCH_SIZE]
        BATCH_IDS_CSV = ",".join(BATCH_IDS)

        if ROUND == 1 and batch_idx == 0:
            # 首轮首批：用 --tasks-file 初始化 task_states.json
            cmd = [
                "python3", f"{SKILL_BASE_DIR}/scripts/parallel_orchestrator.py",
                "--tasks-file", f"{RUN_DIR}/tasks.json",
                "--run-dir", RUN_DIR,
                "--batch-task-ids", BATCH_IDS_CSV,
                "--concurrency", "6",
                "--per-task-timeout", "300",
            ]
        else:
            # 其它批 / 轮次 2+：用 --resume
            cmd = [
                "python3", f"{SKILL_BASE_DIR}/scripts/parallel_orchestrator.py",
                "--resume", RUN_DIR,
                "--batch-task-ids", BATCH_IDS_CSV,
                "--concurrency", "6",
                "--per-task-timeout", "300",
            ]

        EXIT_CODE = run(cmd)  # 阻塞等编排器返回

        if EXIT_CODE in (0, 10):
            print(f"[轮次 {ROUND} · 批 {batch_idx + 1}/{M}] 完成（exit={EXIT_CODE}）")
            # 不阻塞 · 不等用户 · 继续下一批
        else:
            print(f"[轮次 {ROUND} · 批 {batch_idx + 1}/{M}] 编排器异常 exit={EXIT_CODE}")
            abort()  # 主 agent 终止整个循环

    # ─── 5. 本轮所有批跑完 · 检查是否要进步骤 6 ───
    states = read_json(task_states_path)  # 重新读一遍
    if any(st.get("status") == "asking" for st in states.values()):
        # 有 asking → 跳出 · 走步骤 6 一次性问 · 写 answers.json · 然后回到 while 顶
        ROUND += 1
        goto STEP_6
    # 否则 · 继续 while 顶 · 自然 break（TODO_IDS = []）
```

### 5B Bash 实现（主 agent 实际执行的命令）

> 以下是给主 agent 的可执行模板。实际由主 agent 按伪代码逻辑分步发出 · 不是一次性写到 shell 脚本里跑。

```bash
# 准备
SKILL_BASE_DIR="<...>"
RUN_DIR="<...>"
BATCH_SIZE=15
ROUND=1

# 收集 TODO_IDS · 用 python 一行
TODO_IDS=$(python3 -c "
import json, os, sys
sp = '$RUN_DIR/task_states.json'
if os.path.exists(sp):
    states = json.load(open(sp))
    ids = [tid for tid, st in states.items() if st.get('status', 'pending') in ('pending', 'exception')]
else:
    tasks = json.load(open('$RUN_DIR/tasks.json'))
    ids = [t['task_id'] for t in tasks['tasks']]
print(','.join(ids))
")

# 切批 · 逐批跑
IFS=',' read -ra TODO_ARR <<< "$TODO_IDS"
TOTAL=${#TODO_ARR[@]}
M=$(( (TOTAL + BATCH_SIZE - 1) / BATCH_SIZE ))

for ((i=0; i<M; i++)); do
  START=$((i * BATCH_SIZE))
  END=$((START + BATCH_SIZE))
  [ $END -gt $TOTAL ] && END=$TOTAL
  BATCH=$(IFS=,; echo "${TODO_ARR[*]:$START:$((END - START))}")
  BATCH_NUM=$((i + 1))

  if [ "$ROUND" = "1" ] && [ "$i" = "0" ]; then
    python3 "$SKILL_BASE_DIR/scripts/parallel_orchestrator.py" \
      --tasks-file "$RUN_DIR/tasks.json" \
      --run-dir "$RUN_DIR" \
      --batch-task-ids "$BATCH" \
      --concurrency 6 --per-task-timeout 300
  else
    python3 "$SKILL_BASE_DIR/scripts/parallel_orchestrator.py" \
      --resume "$RUN_DIR" \
      --batch-task-ids "$BATCH" \
      --concurrency 6 --per-task-timeout 300
  fi
  EXIT_CODE=$?
  echo "[轮次 $ROUND · 批 $BATCH_NUM/$M] exit=$EXIT_CODE"
  if [ "$EXIT_CODE" != "0" ] && [ "$EXIT_CODE" != "10" ]; then
    echo "编排器异常退出 · 中止"
    exit $EXIT_CODE
  fi
done

# 本轮 M 批跑完 · 检查是否进步骤 6
HAS_ASKING=$(python3 -c "
import json
states = json.load(open('$RUN_DIR/task_states.json'))
print('1' if any(st.get('status') == 'asking' for st in states.values()) else '0')
")
# HAS_ASKING=1 → 主 agent 进 SKILL.md 步骤 6（一次性 ask_followup_question 收 answers.json）
# HAS_ASKING=0 → 全终态 · 跳「完成态展示」
```

### 5B 退出码与 5A 的差异

5B 单批调用的 exit code 含义维度是"本批"，不是"全局"：

| exit | 5B 单批含义 | 主 agent 处理 |
|---|---|---|
| `0` | 本批指定的 task_ids 全终态 | 继续下一批 |
| `10` | 本批至少 1 个 task_id status=asking（其它任务可能仍 pending） | **不立即问用户** · 继续跑下一批 · 攒到本轮所有批跑完后一次性进步骤 6 |
| `1` | 编排器自身错误 | 中止整个 5B 循环 · 报错给用户 |
| `3` | CPQ 委托校验失败（A 段未完成） | 中止 · 引导用户回 cpq 主流程 |

### 5B 关键约束（铁律）

1. ✅ **全程同一个 `$RUN_DIR`**：所有批次共享 `tasks.json` / `task_states.json` / `summary.xlsx`
2. ✅ **`summary.xlsx` 仍是全量快照**：编排器在批模式下也按全量 task_states 写入 · 已跑批的行有结果 · 未跑批的行 status=pending
3. ✅ **`pending.json` 由编排器每批 exit 10 时覆盖式写**：内容是当前 `task_states` 中**所有** asking 行 · 主 agent 在轮次末读最后一次的快照即可
4. ❌ **禁止**让两个编排器进程并发跑同一个 RUN_DIR：run-dir 单实例锁会拒绝第二个（exit 1）·但主 agent 自身要保证不并发调度
5. ❌ **禁止**每批一个独立 RUN_DIR：会把 summary.xlsx 切碎 · 违反 CPQ 主流程的产物契约
6. ❌ **禁止**轮次 2+ 用 `--resume` 不带 `--batch-task-ids`：会把全量 pending+exception 一次性发出去 · 丧失分批保护

### 5B 适用边界

| 场景 | 走 5A 还是 5B |
|---|---|
| N ≤ 15 | 5A · 一次调用搞定 · 不必引入分批复杂度 |
| 16 ≤ N ≤ 60（短中长任务） | 5B · 但 1 个轮次就够 · 看不到很多调度循环 |
| N > 60（长任务，本次主因） | 5B · 多个轮次 · 5B 的真正价值场景 |
| 任意 N + cpq 主流程委托调用 | 走与 N 匹配的路径（cpq 主流程不感知分批） |

---

## 退出码

| exit code | 含义                                                    | 下一步                                          |
| --------- | ------------------------------------------------------- | ----------------------------------------------- |
| `0`       | 全部终态（concluded / failed / timeout / aborted_by_user 任意组合） | 读 `$RUN_DIR/summary.md` + `summary.xlsx` 给用户 |
| `10`      | 至少 1 个 asking 任务待用户回复                         | MANDATORY READ `references/pending-presentation.md` |
| `1`       | 编排器自身错误（CLI 误用 / IO 异常 / run-dir 已被另一 orchestrator 持锁） | 检查 stderr / 锁信息                            |

> 不再有 `exit 20`（旧后台模式的"仍在运行"状态码）和 `exit 127`（旧 `wait` 超时码）。

### 关于 `--per-task-timeout 300`

远端单任务可能深度耗时（曾观测到单任务 573 秒）。**无超时时整轮 bash 会被最慢的一个拖死**。300s 超时即标 `timeout` 终态，**不会重试**，让首轮反馈在 ≤ 5 分钟内可达。

### 跨 shell 兼容性

| 平台 | N ≤ 2 推荐 | N ≥ 3 推荐（agent 环境） | N ≥ 3 推荐（外部 shell / CI） | 状态查询 |
|------|------------|------------------------|------------------------------|---------|
| macOS / Linux | 5A 前台直跑 | `run_in_background:true` | `nohup ... & disown` | `--status` |
| Windows PowerShell | 5A 前台直跑 | `run_in_background:true` | `Start-Process -NoNewWindow` | `--status` |
| WSL / Cygwin | 与 Linux 相同 | 与 Linux 相同 | 与 Linux 相同 | `--status` |

**铁律**：
1. 无论哪个 shell · **不再依赖 `kill -0 $PID` 或 `wait $PID` 判断编排器状态** · 只用 `--status`
2. N ≥ 3 时**必须**走后台 + 30s 轮询 · **禁止**前台阻塞 · 用户在长任务里看不到进度是 P0 级体验缺陷
3. 在 WorkBuddy agent 环境内，`nohup` / `&` / `disown` 会被回收（2026-06-22 探测复现），应使用 `run_in_background:true`。外部 shell / CI 环境下可正常使用 fallback 写法。

---

## 任务状态机

| status | 来源 | 终态? |
|--------|------|-------|
| `pending` | 初始状态（首轮尚未发送） | ❌ |
| `concluded` | 远端 `[结论] 成功` | ✅ |
| `failed` | 远端 `[结论] 失败` / 异常重试 1 次仍异常 | ✅ |
| `asking` | 远端 `[结论] 待确认` | ❌（等用户回答） |
| `exception` | 远端 `[结论] 异常` / 格式不符 / `call_knot` 系统失败 | ❌（自动重试 1 次） |
| `timeout` | 本地挂钟超时 | ✅ |
| `aborted_by_user` | 用户 `answers.json.abort=true` | ✅ |

终态集合：`{concluded, failed, timeout, aborted_by_user}`。

---

## 退出码

| code | 含义 |
|------|------|
| `0` | 全部任务为终态 |
| `10` | 至少 1 个 `asking` 待用户回复 → 写 `pending.json`，等 `--resume` |
| `1` | 编排器自身错误（CLI 误用 / IO 异常） |

> 不再有 `exit 11` / `exit 12`（旧 strict-classify 模式已删除）。

---

## 单次调用内自动多轮

一次 `parallel_orchestrator.py` 调用会**连续跑多轮**直到：
- 全部终态 → exit 0
- 或出现 `asking` 等用户 → exit 10

每轮内部：

1. `_build_round_request_for_task` 决定本轮 todo（pending / exception-retry / asking-with-answer）
2. `_run_round_with_timeout` 滑动窗口并发执行（默认窗口 6）
3. `apply_result_to_state` 解析每个任务的 `[结论]` 并更新 `task_state`
4. 写 `round_N_results.json`、`task_states.json`、覆盖式 `summary.xlsx` + `summary.md`

每轮结束后立刻进入下一轮的 `build_request`；只有当 todo 为空时才退出循环。

`max_auto_rounds` 默认 20（远超正常 exception retry 与 asking 多轮的合理上限）。达到上限会强制返回（exit 0 若全终态，否则 exit 10）。

---

## 远端结论协议

每次发送给远端的 message 末尾会拼接 `PROTOCOL_SUFFIX`，强制远端按下面结构返回：

```
[结论] 成功 | 失败 | 异常 | 待确认（四选一）
[结果信息] <远端完整原始回复，原样保留>
[价格] 原价=<数值+单位> 折扣价=<数值+单位> 币种=<CNY|USD> 计费周期=<1月|1年|1小时按量>
```

`[价格]` 段（可选）：仅在 `[结论]=成功` 且确有价格时由远端给出，独立成行放在最后。本地 `parse_price()` 对其做**字符级原样提取**写入 `task_state.price_info`，并由 `summary.py` 落到 `remote_price` 列——值与单位完全以远端返回为准，本地零解析 / 零换算（铁律 6 改造版）。远端不返回 `[价格]` 段时 `price_info=""`，行为与旧版完全一致（向后兼容）。`[结果信息]` 在有 `[价格]` 段时截断到该段之前，不被价格段污染。

四态语义：

- **成功**：远端已查到完整有效价格 / 生成完整报价单
- **失败**：明确无法报价（商品不存在 / 配置不支持 / 区域不支持）
- **异常**：系统类错误（限流 / 上游 500 / 工具调用失败等可重试错误）
- **待确认**：需要用户补充信息才能继续

格式不符或 `[结论]` 值不在四枚举内 → 本地判定为 `malformed`，按 `异常` 处理（走重试预算）。

---

## 跨平台兼容性

| 平台 | 推荐方式 | 备选方式 |
|------|---------|---------|
| macOS / Linux | 前台直跑 | `nohup ... &` + `disown` |
| Windows PowerShell | 前台直跑 | `Start-Process -NoNewWindow` |
| WSL / Cygwin | 与 Linux 相同 | 与 Linux 相同 |

**铁律**：
1. 无论哪个 shell · **不再依赖 `kill -0 $PID` 或 `wait $PID` 判断编排器状态** · 退出码本身就是结果
2. N ≥ 3 时前台直跑，命令返回后读 `summary.md` / `summary.xlsx` 给用户

---

## 异常重试预算

- 任一任务首次 `[结论]=异常` 或 `malformed`：`exception_retry_count = 1`，状态置为 `exception`，下一轮自动重发（复用 `last_round_message`，不重复拼协议）
- 第二次仍异常：直接转 `failed` 终态，`result_info = "[orchestrator] 异常重试耗尽；最后一轮原因：<原文>"`
- `asking` 多轮不计入异常预算（用户可来回澄清多次）

---

## CLI 参数

| 参数 | 默认 | 说明 |
|------|------|------|
| `--tasks-file` | — | 首次启动，传 split_tasks 校验产物 |
| `--resume RUN_DIR` | — | 续跑，读 `answers.json` |
| `--inspect RUN_DIR` | — | 只读查看当前状态 |
| `--run-dir` | — | 与 `--tasks-file` 一起使用 |
| `--concurrency` | `6` | 滑动窗口并发数 |
| `--per-task-timeout` | `300` | 单任务挂钟上限（秒）；`0` 关闭超时 |
| `--progress-interval` | `30` | 进度心跳间隔（秒），每 N 秒输出一行 stdout 进度；`0` 关闭 |
| `--batch-task-ids` | `""` | 【2026-06-22 引入 · 5B 分批轮次模式专用】逗号分隔的 task_id 列表 · 本次只处理这个子集 ∩ (pending + exception + 已答 asking) · 退出码 0/10 按"本批"判定 · 详见 §5B |

不再有 `--strict-exit-on-classify` / `--classify-poll-timeout`。

---

## 磁盘契约

`$RUN_DIR/` 内：

| 文件 | 写入方 | 时机 |
|------|--------|------|
| `tasks.json` | `split_tasks.py` | 仅一次（启动前） |
| `task_states.json` | `main_loop` | 每轮覆盖 |
| `round_N_results.json` | `main_loop` | 每轮结束 |
| `pending.json` | `main_loop` | 仅 exit 10 时 |
| `summary.xlsx` / `summary.md` | `main_loop` | 每轮覆盖 |
| `answers.json` | IDE LLM（用户回复） | exit 10 后 |
| `answers_round_N.json` | `main_loop` | 消费 `answers.json` 后归档 |

`answers.json` schema：

```json
{
  "task_answers": {
    "task_001": "<用户回复原文>",
    "task_007": "..."
  },
  "abort": false
}
```

`abort=true` 时所有非终态任务立即转 `aborted_by_user` 并 exit 0，不再发送任何远端请求。

---

## pending.json schema

仅当 exit 10 时写出：

```json
{
  "round": 2,
  "summary": {
    "total": 10,
    "concluded": 6,
    "failed": 1,
    "asking": 2,
    "timeout": 0,
    "exception_will_retry": 1
  },
  "asking_tasks": [
    {
      "task_id": "task_003",
      "source_row": 3,
      "source_row_md": "| 站点 | 配置 |\n|---|---|\n| 国际站 | 4C8G |",
      "remote_question": "请问需要哪个地域?"
    }
  ],
  "failed_tasks": [
    {
      "task_id": "task_007",
      "source_row": 7,
      "source_row_md": "...",
      "result_info_excerpt": "<最多 300 字符；超长追加 …>"
    }
  ],
  "timeouts": [
    {
      "task_id": "task_009",
      "source_row": 9,
      "source_row_md": "...",
      "timeout_text": "本地超时（>300s 未完成，已标记终态，不重试）"
    }
  ],
  "instruction_to_llm": "请按 SKILL.md 步骤 6 的『回应用户模板』..."
}
```

`exception` 状态的任务**不**出现在 `asking_tasks` / `failed_tasks` / `timeouts`（它们会自动重试，无需用户介入），但会在 `summary.exception_will_retry` 计数中。

---

## 典型场景

### 场景 A：所有任务首轮即成功
1 轮跑完 → exit 0

### 场景 B：偶发异常自动恢复
轮 1：部分任务 `异常` → 轮 2：自动重试 → 全 `成功` → exit 0（**单次调用完成**）

### 场景 C：持续异常 → 失败
轮 1：异常 → 轮 2：仍异常 → 转 `failed` → exit 0（全终态）

### 场景 D：远端追问
轮 1：`asking` → exit 10，`pending.json` 含 `asking_tasks`
IDE LLM 读 `pending.json` → 展示汇总表格 → 调 `ask_followup_question` 交互式收答案 → 写 `answers.json` → `--resume` → 轮 2：携用户回复 → 终态 → exit 0

### 场景 E：超时
轮 1：部分任务挂钟超时 → 直接标 `timeout` 终态（**不重试**）
其余任务正常处理；若全部终态 → exit 0

### 场景 F：用户中止
任一轮后，用户回复 `abort=true` → 续跑时所有非终态立即转 `aborted_by_user` → exit 0

---

## 与 SKILL.md 的关系

- 步骤 5（首次启动）：`parallel_orchestrator.py --tasks-file ... --run-dir ... --concurrency 6 --per-task-timeout 300`
- 步骤 6（处理 exit 10）：读本文档「pending.json schema」，按 SKILL 模板转给用户，收集回复写 `answers.json`，再 `--resume`

`SKILL.md` 是给 IDE LLM 看的「怎么用」；本文件是给 reviewer / 维护者看的「怎么实现 / 怎么调试」。

---

## 完整自检清单（14 条 · SKILL.md 核心 6 条的展开）

> SKILL.md 的「✋ 回应前自检清单」只列了踩坑率最高的 6 条。下面是完整 14 条，覆盖所有铁律 + 流程红线，任意一条 yes 立刻回退重做。

### 铁律相关（5 条）

- [ ] 我是否在 tasks 提案 message 里改写了用户原文（哪怕只改了空格、单位、地理位置归一化）？
- [ ] 我是否解析过远端 `[结果信息]` 内容、抠出价格数字、合并金额？（应一律原样保留；`remote_price` 仅逐字搬运远端 `[价格]` 段，不算抠数字，但本地仍禁止换算 / 汇总 / 推算）
- [ ] 我是否在 `answers.json` 的 `task_answers` 里把用户回复改写 / 翻译 / 缩写？
- [ ] 我是否在 summary 展示给用户时解析 / 计算 / 汇总了任何价格数据？
- [ ] 我是否替用户回答了远端追问？（即使原表里有答案也必须转给用户）

### 完成态判定（1 条）

- [ ] 我是否在没看到 `summary.md` 与 download_links 的情况下就告诉用户"已完成"？

### --common-context 边界（2 条）

- [ ] 我是否把"产品规格"信息（CPU / 内存 / 存储 / 带宽）提取进了 `--common-context`？（应留在表格 / 由远端追问）
- [ ] 我是否在 `--common-context` 里写了用户没说的内容？（应只搬运用户显式声明的字段，不脑补）

### 提案构造（1 条）

- [ ] 我是否手抄了 `tasks_proposal.json` 而不是调用 `build_proposal.py`？

### exit 10 处理（3 条）

- [ ] exit 10 时，我是否用纯文本逐条追问而非调 `ask_followup_question`？（必须调）
- [ ] 我是否有 asking 任务但没有先展示汇总表格？（必须先表格、再交互式选答）
- [ ] 我是否忘了给每个问题追加「其它」选项？（必须追加）

### 编排器执行方式（1 条）

- [ ] 我是否用前台直跑运行编排器并等待退出码？（N ≤ 2 和 N ≥ 3 都用前台直跑）

