# scripts/ — 工具脚本说明

本目录辅助脚本，全部可独立运行，供 SKILL.md 各场景调用。

## fetch_transcript.py（v3.7 新增）

**用途**：场景 D 一键拉面试转写。调用招活内嵌接口 `recruit.interview-arrange-campus.get_interview_trace_record`，输出人类可读纯文本，取代 tencent-meeting-mcp 三跳路径。

**用法**：
```bash
# 模式 A：从 T 待办原始文件按候选人姓名找 traceId 后拉（最常用，从场景 T 自动联动）
python3 scripts/fetch_transcript.py \
    --todo-file $TMP_DIR/todo_raw.json \
    --candidate <候选人姓名> \
    --out-dir $TMP_DIR \
    --prefix candidate

# 模式 B：已知 traceId（即 personList[].flowTraceId，必须 string）
python3 scripts/fetch_transcript.py \
    --trace-id <TRACE_ID> \
    --out-dir $TMP_DIR \
    --prefix candidate
```

**输出**：
- `<prefix>_raw.json` — 招活原始返回
- `<prefix>.txt` — 人类可读纯文本，格式 `[HH:MM:SS] userId: content`，一行一句

**退出码**：
- 0 = 成功
- 1 = 参数错（traceId 找不到 / 候选人姓名不匹配）
- 2 = mcporter 调用失败
- 3 = 接口成功但**转写为空**（开会方未开转写）→ 走 tencent-meeting-mcp 兜底
- 4 = 鉴权失败（AUTH_PERMISSION_DENIED）→ 走 tencent-meeting-mcp 兜底

**核心功能**：
- 处理 mcporter 大返回（>64KB）的 stdout 截断问题（直接重定向到文件）
- 按候选人姓名自动从 T 待办 `personList[].flowTraceId` 提取 traceId
- speakTime 毫秒时间戳转 HH:MM:SS
- userId 已对齐说话人（候选人 / 面试官英文名）

详见 `references/transcripts/recruit-trace-api.md`。

---

## decode_todo.py

**用途**：解码 `get_campus_interview_todo_list` 接口返回的 JSON，解决 mcporter 终端中文乱码问题。

**用法**：
```bash
python3 scripts/decode_todo.py <输入原始JSON文件> <输出可读文本文件>

# 示例
python3 scripts/decode_todo.py $TMP_DIR/todo_raw.json $TMP_DIR/todo_decoded.txt
```

**输出格式**：结构化文本，每条待办包含候选人姓名、学校、岗位、面试时间、RID、会议号等字段。

---

## decode_resume.py

**用途**：解码 `getResumeByRId` 接口返回的 JSON，提取场景 C（出题）需要的字段。

**用法**：
```bash
python3 scripts/decode_resume.py <简历JSON> <可读文本>

# 示例
python3 scripts/decode_resume.py $TMP_DIR/resume_raw.json $TMP_DIR/resume_decoded.txt
```

**输出包含**：基本信息 / 教育经历 / 实习 / 项目 / 获奖 / 自我描述 / 技能标签 / **测评数据** / **简历漂亮数字扫描**。

> ⚠️ 必读：mcporter 返回的 JSON 中文在终端是乱码，**必须**用本脚本解码后用 Read 工具查看。严禁直接从终端输出推断中文内容。
> ⚠️ 当前现状（2026-05-14）：`getResumeByRId` 对常规面试官 Token 返回 `AUTH_PERMISSION_DENIED`。需找招活管理员授权后才能用。

---

## format_evaluation.py

**用途**：面评字数控制 + 重复检测 + 空话检测。场景 D 交付前必跑。

**用法**：
```bash
# 系统录入版（上限 400 字）
python3 scripts/format_evaluation.py <面评文件> system

# IM 速递版 / 微信转发版（上限 200 字）
python3 scripts/format_evaluation.py <面评文件> wechat
```

**检测项**：
- 字数超标 → 提示缩减
- 空话比例过高（"综合能力强"、"沟通较好"等）→ 提示加行为证据
- 相同表述重复 ≥2 次 → 提示改写

---

## mcporter_call.py

**用途**：跨平台 mcporter 调用封装。解决两类问题：
1. Windows `cmd.exe` 把 keyword 中 `|` 当管道符截断（如 `"后台开发|后端开发"`）
2. subprocess 调用 mcporter 时 cwd 不在 Workspace 根，导致 `Unknown MCP server 'recruit-mcp'`

**用法**：
```bash
python3 scripts/mcporter_call.py \
  <mcporter路径> <服务器名> <工具名> \
  <apiId> <params.json> <output.jsonl>

# 示例（搜简历）
which mcporter  # 先拿到 mcporter 绝对路径
cat > $TMP_DIR/params.json <<'EOF'
{"keyword":"后台开发|后端开发","schoolLevel":["985"],"pageNum":1,"pageSize":30}
EOF
python3 scripts/mcporter_call.py \
  /opt/homebrew/bin/mcporter recruit-mcp CallAPI \
  recruit.campus-resume-search.post_v1_resume_search \
  $TMP_DIR/params.json $TMP_DIR/result.jsonl
```

**输出格式**：JSONL（每行一个 JSON）。
- 第 1 行：`{"_meta": {"total": N, "status": 0, ...}}`
- 后续每行：一条简历

---

## 何时用哪个脚本

| 场景 | 场景 T / T2 查待办 | 场景 A 搜简历 | 场景 C 拉简历 | 场景 D 拉转写 | 场景 D 格式化面评 |
|:---:|:---:|:---:|:---:|:---:|:---:|
| 直接 `mcporter call` | ✅ | keyword 不含 `\|` 时 | ✅ | — | — |
| 需要 `mcporter_call.py` | — | keyword 含 `\|` / Windows | — | — | — |
| 需要 `fetch_transcript.py` | — | — | — | ✅ | — |
| 需要解码脚本 | decode_todo | （搜索结果量大时建议） | decode_resume | （脚本内置）| — |
| 需要 format_evaluation | — | — | — | — | ✅ |

---

## 依赖

- Python 3.8+
- 标准库即可，无需 pip install

## 跨平台说明

- macOS / Linux：直接 `python3` 运行
- Windows（Git Bash / WSL）：同上；原生 cmd 请改用 WSL
- 临时文件统一走 `$TMP_DIR`，首次使用先：
  ```bash
  export TMP_DIR="${TMPDIR:-/tmp}"             # macOS/Linux
  export TMP_DIR="$HOME/.workbuddy/tmp" && mkdir -p "$TMP_DIR"   # Windows
  ```
