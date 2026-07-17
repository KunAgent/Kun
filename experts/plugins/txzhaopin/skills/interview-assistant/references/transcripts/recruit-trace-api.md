# 招活内嵌转写接口 · 详细参考

> **接口（校招）**：`recruit.interview-arrange-campus.get_interview_trace_record`
> **接口（社招）**：`recruit.interview-arrange.get_interview_trace_record`
> **方法**：GET
> **MCP**：recruit-mcp
> **首选场景**：场景 D（面评填写）拉转写
> **首发**：2026-05-14 / interview-assistant v3.7（校招）· 2026-06-12 / v4.2（社招）
> **取代**：tencent-meeting-mcp 三跳路径（meetingCode → meetingId → recordFileId → transcripts）

---

## 一、为什么用它

| 维度 | 招活内嵌（本接口） | tencent-meeting-mcp 路径 |
|---|---|---|
| 步数 | 1 步（traceId → 转写） | 3 步（meetingCode → meetingId → recordFileId → transcripts） |
| 鉴权 | 复用 recruit-mcp 双 Token | 单独申请会议鉴权 |
| 安装依赖 | 无（已装 recruit-mcp 即可用） | 需另装 tencent-meeting-mcp skill |
| 转写质量 | 高（招活内部已对齐说话人） | 一般（遇到大段沉默有时缺失） |
| 失败常见因 | 转写未生成 / token 无权限 | 录制/转写未开 / 会议号过期 |

**结论**：能走招活就走招活，腾讯会议路径只作兜底。

### 校招 vs 社招接口选择

| 招聘类型 | 接口 apiId | fetch_transcript.py 参数 |
|---|---|---|
| 校招（campus） | `recruit.interview-arrange-campus.get_interview_trace_record` | `--recruit-type campus`（默认） |
| 社招（social） | `recruit.interview-arrange.get_interview_trace_record` | `--recruit-type social` |

⚠️ **校招和社招使用不同的接口**，传错接口会返回空数据或权限错误。判断方式：
- 从 T 待办联动时，待办本身可区分校招 / 社招来源
- 用户口述时以用户说的为准
- 不确定时反问"校招还是社招？"

---

## 二、参数

| 参数 | 类型 | 必填 | 说明 |
|---|---|:---:|---|
| `traceId` | string | ✅ | 转写 ID。**必须是 string**，传 integer 会失败 |

两个接口参数完全一致，仅 apiId 不同。

### traceId 来源（最容易踩坑的地方）

`traceId` = `flowTraceId`，**位置**：

**校招**：
```
T 待办接口 (recruit.campus-center-front.get_campus_interview_todo_list)
    └─ data.data.list[]
         └─ personList[]              ← 注意是嵌套在 personList 里
              └─ flowTraceId          ← 就是它，整数，调用前转 string
```

**社招**：
```
社招待办接口 (recruit.social-interview.get_social_interview_todo_list 或类似)
    └─ 对应结构中的 flowTraceId
```

⚠️ 不是：
- ❌ `data.list[].orderId`（这是面试单 ID，用于改期 / 取消）
- ❌ `data.list[].flowId`（这是流程 ID）
- ❌ `data.list[].personList[].interviewId`（这是面试 ID）
- ❌ `rid`（候选人 ID，是 UUID 不是数字）

✅ 正确字段：`personList[].flowTraceId`（数字，转 string 调用）

---

## 三、返回结构

```json
{
  "status": 200,
  "data": {
    "code": 0,
    "message": "",
    "requestId": "...",
    "success": true,
    "data": [
      {
        "userId": "interviewer_en_name",  // 面试官：英文名；候选人：通常显示"候选人"
        "speakTime": 1778659584110,     // 毫秒时间戳
        "content": "你好，X 同学，我们准时开始。",     // 发言内容
        "lang": "zh"
      },
      ...
    ]
  },
  "durationMs": 547
}
```

⚠️ **注意嵌套深度**：转写数组在 `data.data.data`（三层 data），不是 `data.data` 或 `data`。

---

## 四、调用方式

### 方式一：用 fetch_transcript.py 脚本（推荐）

```bash
# 校招：直接给 traceId（默认 campus）
python3 ~/.workbuddy/skills/interview-assistant/scripts/fetch_transcript.py \
    --trace-id <TRACE_ID> \
    --out-dir $TMP_DIR \
    --prefix candidate

# 社招：显式指定 --recruit-type social
python3 ~/.workbuddy/skills/interview-assistant/scripts/fetch_transcript.py \
    --trace-id 123456 \
    --recruit-type social \
    --out-dir $TMP_DIR \
    --prefix zhang_san

# 从 T 待办里按候选人姓名查 traceId 后拉
python3 ~/.workbuddy/skills/interview-assistant/scripts/fetch_transcript.py \
    --todo-file $TMP_DIR/todo_raw.json \
    --candidate <候选人姓名> \
    --out-dir $TMP_DIR

# 输出：
#   transcript_raw.json  原始招活返回
#   transcript.txt       人类可读纯文本
```

### 方式二：直接 mcporter call（如脚本不可用）

**校招**：
```bash
mcporter call recruit-mcp CallAPI \
  apiId='recruit.interview-arrange-campus.get_interview_trace_record' \
  params='{"traceId":"<TRACE_ID>"}' \
  > $TMP_DIR/trace_raw.json 2>&1
```

**社招**：
```bash
mcporter call recruit-mcp CallAPI \
  apiId='recruit.interview-arrange.get_interview_trace_record' \
  params='{"traceId":"123456"}' \
  > $TMP_DIR/trace_raw.json 2>&1
```

注意：
- **stdout 重定向到文件**：终端打印中文会乱码（`���`），必须写文件再 Read
- **traceId 数字也要加引号**：JSON 里要的是 string

### 方式三：subprocess 调用（编程时）

🔴 **必须把 stdout 重定向到文件**，不能用 `capture_output=True`：mcporter 转写返回常 >64KB，会被 pipe buffer 截断。

**校招**：
```python
with out_raw.open("wb") as f:
    subprocess.run(
        [mcporter, "call", "recruit-mcp", "CallAPI",
         "apiId=recruit.interview-arrange-campus.get_interview_trace_record",
         f'params={{"traceId":"{trace_id}"}}'],
        stdout=f, stderr=subprocess.PIPE, timeout=120, check=False
    )
```

**社招**：
```python
with out_raw.open("wb") as f:
    subprocess.run(
        [mcporter, "call", "recruit-mcp", "CallAPI",
         "apiId=recruit.interview-arrange.get_interview_trace_record",
         f'params={{"traceId":"{trace_id}"}}'],
        stdout=f, stderr=subprocess.PIPE, timeout=120, check=False
    )
```

---

## 五、解析转写

### 标准格式化（fetch_transcript.py 已封装）

```python
from datetime import datetime
import json

raw = open(out_raw, 'rb').read().decode('utf-8', errors='replace')
data = json.loads(raw)
items = data['data']['data']  # 三层 data！
lines = []
for it in items:
    t = datetime.fromtimestamp(it['speakTime']/1000).strftime('%H:%M:%S')
    user = it.get('userId', '?')
    content = (it.get('content') or '').strip()
    if content:
        lines.append(f"[{t}] {user}: {content}")
open('transcript.txt', 'w').write('\n'.join(lines))
```

### 输出样式

```
[10:00:05] interviewer: 你好，X 同学，我们准时开始。
[10:00:18] candidate: 你好，面试官，准备好了。
[10:00:24] interviewer: 那我先简单介绍下流程，本轮约 60 分钟……
[10:00:42] candidate: 好的，那我先做一下自我介绍……
```

> ⚠️ 示例片段为完全虚构，仅用于说明输出格式；任何真实面试转写不得入库或外传，参见 SKILL.md 合规红线。

---

## 六、错误码与排查

| errorCode | 含义 | 处理 |
|---|---|---|
| `VALIDATION_FAILED` (字段 traceId MISSING) | 没传 traceId | 检查参数名是否拼对、是否传成了 rid / orderId |
| `VALIDATION_FAILED` (类型错) | traceId 不是 string | 转字符串：`json.dumps({"traceId": str(trace_id)})` |
| `AUTH_PERMISSION_DENIED` | Token 无权访问该能力 | 联系招活管理员授权；或走 tencent-meeting-mcp 兜底 |
| 接口返回成功但 `data.data.data` 为空 | 转写未生成 | 常见于会议未开转写、转写仍在生成中。30 分钟后再试，或走兜底 |
| JSON 解析失败 / 内容截断 | subprocess pipe buffer 截断 | 把 stdout 重定向到**文件**，不要用 capture_output |

---

## 七、相关接口（一并整理）

### 拉简历主数据

```
recruit.campus-resume-front.getResumeByRId   (POST, 当前 token 通常被禁)
```

⚠️ **2026-05-14 现状**：此接口对常规面试官 Token 返回 `AUTH_PERMISSION_DENIED`。
- 影响：B/C/D 流程依赖的简历 + 测评数据 (`qualityAssessmentResults`) 拿不到
- 临时方案：HR 面只用转写也能写完整面评（因为 HR 面侧重气质 C 系，不强依赖测评红点）；专业面如需测评数据，须找招活管理员授权

### T 待办接口

```
recruit.campus-center-front.get_campus_interview_todo_list   (POST)
```

返回的 `personList[].flowTraceId` 就是本接口的输入 traceId。两个接口配合使用是 D 流程的核心。

### T2 推荐待办

```
recruit.campus-center-front.post_v1_evaluation_todoList   (POST)
```

不返回 traceId（推荐待办还没安排面试，自然没有转写）。

---

## 八、版本历史

- **v1.1 (2026-06-12)**：新增社招转写接口 `recruit.interview-arrange.get_interview_trace_record`。fetch_transcript.py v1.1 新增 `--recruit-type social` 参数，校招/社招自动路由到对应 apiId。返回结构与校招一致，解析逻辑复用。
- **v1.0 (2026-05-14)**：发现并验证校招转写接口。一名候选人 HR 面端到端拉到数百条转写，与 tencent-meeting-mcp 三跳路径输出对比一致且更完整。fetch_transcript.py v1.0 同期发布。
