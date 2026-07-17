# pending.json 展示与回收模板（exit 10 处理）

> **加载触发**：MANDATORY READ ENTIRE FILE — 当 `parallel_orchestrator.py` 或 `--resume` 退出码为 **10** 时（即 `$RUN_DIR/pending.json` 已生成、有 asking 任务待用户回复）必读。
>
> **Do NOT Load**：编排器尚未退出 / 退出码为 0 / 退出码为 1 时不必加载本文件。

本文件承接 `SKILL.md` 步骤 6，给出"读 pending.json → 汇总表格 → 交互式收答案 → 写 answers.json"的完整模板。**所有展示模板源自实战 issue 的历史教训，不要凭直觉简化。**

---

## 总流程

```
读 $RUN_DIR/pending.json
  ↓
步骤 6A：展示汇总表格（一览所有待确认 / 失败 / 超时）
  ↓
步骤 6B：调 ask_followup_question 交互式收答案（强制 · 不允许纯文本逐条追问）
  ↓
写 $RUN_DIR/answers.json
  ↓
回到 SKILL.md 步骤 6 末尾 → 后台 --resume
```

---

## 步骤 6A：展示汇总表格

先展示**本轮进度总览**，再分三块（待补 / 失败 / 超时）给表格。**省略规则按 `pending.summary` 字段判断**（见下方"展示规则"）。

### 进度总览行

```
本轮进度：共 N 个商品 — X 已询完价、Y 失败、Z 需要补充信息、W 本地超时；E 个异常下一轮自动重试。
```

字段对应：N=`summary.total`，X=`concluded`，Y=`failed`，Z=`asking`，W=`timeout`，E=`exception_will_retry`。

### 【需要补充信息的任务汇总】（asking_tasks）

| 任务     | 原表行 | 产品    | 远端追问（摘要）                 |
| -------- | ------ | ------- | -------------------------------- |
| task_001 | 1      | CVM SA5 | 请确认地域：广州 / 上海 / 北京？ |
| task_003 | 3      | MongoDB | 架构类型：副本集 or 分片集群？   |

> 「远端追问（摘要）」：从 `asking_tasks[i].remote_question` 提取关键词/选项，不超过一行。完整原文留给步骤 6B 的交互式 question 文本。
>
> 「产品」：从 `asking_tasks[i].source_row_md` 中提取识别性字段（如产品名 + 规格），不强求精确。

### 【已失败的任务】（failed_tasks · 终态 · 不会重试）

| 任务     | 原表行 | 产品    | 失败原因（来自 result_info_excerpt） |
| -------- | ------ | ------- | ------------------------------------ |
| task_005 | 5      | CVM SA4 | Saving Plan 不支持 API 询价          |

### 【已超时的任务】（timeouts · 终态 · 不会重试）

| 任务     | 原表行 | 产品       | 说明                                |
| -------- | ------ | ---------- | ----------------------------------- |
| task_009 | 9      | PostgreSQL | 本地超时（>300s）· `timeout_text` 原文 |

### 展示规则（按 pending.summary 字段省略）

- `summary.asking == 0` → 整个 6B 跳过（无 asking 任务则直接结束本轮展示，不再调 ask_followup_question）
- `summary.failed == 0` → 整个「已失败」表格省略
- `summary.timeout == 0` → 整个「已超时」表格省略
- `summary.exception_will_retry == 0` → 进度行省略「E 个异常下一轮自动重试」

### 兜底说明（始终显示）

```
说明：
- 异常类（限流 / 500 等）已自动安排下轮重试，无需您处理。
- 失败、超时是终态，如需重查请新建一次 run。
- 您可以随时回复"终止"来结束本次询价。
```

---

## 步骤 6B：调 ask_followup_question 交互式收答案

**强制要求**：有 asking 任务时**必须**调 `ask_followup_question` 工具，**绝对不能**用纯文本逐条追问（用户反馈：纯文本追问容易丢失答案、错位映射 task_id）。

### 1) 提取选项的识别模式

从 `asking_tasks[i].remote_question` 提取可选项。识别规则：

| 远端追问模式                                | 提取出的 options                       |
| ------------------------------------------- | -------------------------------------- |
| `副本集 or 分片集群`                        | `["副本集", "分片集群"]`               |
| `广州 / 上海 / 北京`                        | `["广州", "上海", "北京"]`             |
| `包月 / 按量`                               | `["包月", "按量"]`                     |
| 表格中的版本/规格名（如 `专业版 / 高级版`） | `["专业版", "高级版"]`                 |
| 纯开放式问题（无明确可选项）                | `["其它（请在下方自由补充）"]` 单选项 |

### 2) 强制追加「其它」兜底

每个问题**必须**追加一个 `"其它（请在下方自由补充）"` 选项，供用户手写不在 options 内的答案。**不允许省略**——历史教训：远端提供的选项可能不完整，用户被迫硬选错误选项。

### 3) 上限：4 个问题

`ask_followup_question` 限制最多 4 个问题。如果 `asking_tasks.length > 4`：

- **本轮**只取前 4 个（按 source_row 升序）发问
- 剩余 asking 任务在用户回答前 4 个并 --resume 后，下一轮 exit 10 时再继续

### 4) 调用样例（完整可复用骨架）

```
ask_followup_question(
  title="本批次需要补充的信息（共 Z 个产品）",
  questions=[
    {
      "id": "task_001",
      "question": "▌CVM SA5（原表第 1 行）\n远端追问：请确认地域？",
      "options": ["广州", "上海", "北京", "其它（请在下方自由补充）"],
      "multiSelect": false
    },
    {
      "id": "task_003",
      "question": "▌MongoDB Storage（原表第 30 行）\n远端追问：架构类型？",
      "options": ["副本集", "分片集群", "其它（请在下方自由补充）"],
      "multiSelect": false
    }
  ]
)
```

> 关键约定：question 的 `id` **必须**等于 `pending.json` 里的 `task_id`（不要自己重新编号），后续写 `answers.json` 时按此 id 反查。

---

## 写 answers.json

收到用户通过 `ask_followup_question` 的选择后，按下面 schema 写入 `$RUN_DIR/answers.json`：

```json
{
  "task_answers": {
    "task_001": "<用户选择的选项原文，选'其它'则取用户手写内容>",
    "task_003": "..."
  },
  "abort": false
}
```

### 字段处理规则

- 用户选了某个具体选项 → 取选中选项的**原文**（含括号、空格、全角字符都原样保留）
- 用户选了「其它」+ 手动填写 → `task_answers` 的值 = **用户手动填写的字符串原文**（不裁剪、不归一化）
- 用户选了「其它」但未填写 → 留空串 `""`（远端会再次追问）
- 用户回复中包含 "终止" / "停止" / "abort" / "cancel" 任一关键词 → `abort=true`，所有非终态任务在 --resume 时立即转 `aborted_by_user`

### ⚠️ 唯一允许的语义动作

整个 exit 10 处理流程中，**唯一允许**的 LLM 语义判断只有一项：**识别用户中止意图**。其他所有字段都是字符级搬运。

- ❌ 不要把用户填写的 "北京 1 区" 归一化成 "ap-beijing"
- ❌ 不要把用户填写的 "副本" 补全成 "副本集"
- ❌ 不要把用户回复改写、翻译、缩写、合并

---

## 回到 SKILL.md 步骤 6 末尾

answers.json 写完后，按调用模式分流（详见 SKILL.md 步骤 6）：

- **5A 单次调用模式**（N ≤ 15）：按 SKILL.md 步骤 6 末尾命令模板**前台直跑** `--resume`：
  ```bash
  python3 "$SKILL_BASE_DIR/scripts/parallel_orchestrator.py" --resume "$RUN_DIR"
  ```
  退出码处理同步骤 5。

- **5B 分批轮次模式**（N > 15 · 2026-06-22 引入）：回到 5B 主循环顶部（ROUND += 1）·
  重新扫 `task_states.json` 收集新一轮 `TODO_IDS` · 重新切批 ·
  逐批用 `--resume --batch-task-ids "<本批 IDs>"` 跑（详见 `references/parallel-flow.md` §5B）。
  ❌ **禁止**轮次 2+ 用 `--resume` 不带 `--batch-task-ids` —— 会把全量 pending+exception 一次性发出去 · 丧失分批保护。

> **5B 整轮末统一问**：编排器在 5B 模式下每批 exit 10 也会写 `pending.json`，**主 agent 应只在本轮所有批跑完后**读最后一次的 pending.json（含全量 asking 行）一次性问用户。不要每批 exit 10 都立即调 ask_followup_question · 用户会被打扰过多次。
