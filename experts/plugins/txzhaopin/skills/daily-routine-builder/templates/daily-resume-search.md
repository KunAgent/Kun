---
id: daily-resume-search
name: 每日简历搜推·新增推送
category: 招聘类
defaultName: 每日简历搜推-{RECRUIT_TYPE}-Daily-{HHMM}
scheduleType: recurring
rrule: FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9;BYMINUTE=0
connectorIds:
  - recruit-mcp
configurable:
  - key: time
    label: 触发时间
    type: time
    default: "09:00"
  - key: recruit_type
    label: 招聘类型（决定走校招还是社招搜简历 skill）
    type: enum
    options: ["社招", "校招"]
    default: "社招"
    required: true
  - key: search_brief
    label: 🔴 搜索条件 / 岗位画像（一句话说清楚要搜什么人，定时任务每天按它搜）
    type: string
    default: ""
    required: true
  - key: task_key
    label: 任务隔离 key（跨天去重用 · 留空则按岗位自动生成，社招前缀 social-daily- / 校招 campus-daily-）
    type: string
    default: ""
  - key: top_n
    label: 每天推送几份候选人（由你决定；因企微卡片长度有限，建议 ≤10，默认 10）
    type: number
    default: 10
    max: 10
  - key: webhook
    label: 企业微信群机器人 Webhook（🔴 必填 · 所有定时任务都通过它推送结果）
    type: string
    default: ""
    required: true
---

# 每日简历搜推·新增推送

## 任务描述

每个工作日 {HH:MM} 按你预设的**岗位画像 / 搜索条件**自动跑一轮简历搜推，**只推近 30 天没推过的新增候选人**，避免「每天推的简历几乎一样」。

> 🔴 **本模板走「自托闭环·只粗筛」**（方案 B · 2026-06-22 定）：定时搜推**不再 `use_skill` 进 zhaopin-operations / zhaopin-social-operations**——那两个交互式搜简历 skill 的 SOP 很重（校招两轮 + 逐份点开简历详情精读），定时无人值守时链路过长，经常半路被调度器 cancel / internal error。
>
> 本模板改为调用 daily-routine-builder 自带的轻量脚本 **`scripts/daily_resume_pick.py`**：**搜一次 → 用搜索结果里直接带的字段粗筛排序 → 取 Top N**，全程**不点开任何一份简历详情**、不翻页、不二次扩搜。链路从「重得跑不完」变成「几秒线性完成」。
>
> ⚠️ 这是**定时上下文专用**的减重通道。用户**手动/交互式**搜简历时，仍走 `zhaopin-operations` / `zhaopin-social-operations` 的完整精读 SOP，本模板不影响它们。

## prompt

> 你是每日简历搜推助手。本次是定时触发的「每日简历搜推·新增推送」，请严格按下面顺序执行。**全程只用脚本，不要 `use_skill` 进任何搜简历 skill，不要逐份点开简历详情。**
>
> **【Step 0 · 定位】**
>  - 招聘类型 = {recruit_type}（社招 → `--type social`，task-key 前缀 `social-daily-`；校招 → `--type campus`，task-key 前缀 `campus-daily-`）。
>  - 脚本目录 PICK_DIR = daily-routine-builder 的 `scripts/`；搜简历 skill 目录仅用于脚本内部复用其 mcporter 封装，你**不进它的 SOP**。
>
> **【Step 1 · MCP 探活】** 确认 `recruit-mcp` 接通（检查工具列表或 `~/.workbuddy/mcp.json` 有未禁用的 recruit-mcp 段）；不通则本次不推半成品，输出一行「⚠️ recruit-mcp 未接通，本次跳过，下次重试」。
>
> **【Step 2 · 生成搜索参数】**
>  - 搜索条件（岗位画像）：**{search_brief}**。
>  - 这是定时任务，**不要向用户反问确认画像**（无人值守）。按这句话把画像翻译成搜索参数 JSON 落盘 `search_params.json`：
>    - 校招（campus）字段参照 `zhaopin-operations/interfaces/search-campus-resume.md`（必带 page/limit/searchId/searchStrategy + graduate_time + startInterviewEnable 等默认项，limit 建议 30）。
>    - 社招（social）字段参照 `zhaopin-social-operations/interfaces/search-social-resume.md`（驼峰命名 + positionTags/location/workYear 等，size 建议 30）。
>  - ⚠️ keyword 不要堆太多空格词当 AND，会过严召回 0；优先用结构化字段（学校梯队/专业/岗位标签）收窄。
>
> **【Step 3 · 搜 + 粗筛（一条命令闭环）】**
>    ```
>    cd {workspace} && python3 {PICK_DIR}/daily_resume_pick.py \
>      --type {campus|social} \
>      --params search_params.json \
>      --top-n {top_n}
>    ```
>  - 脚本内部：搜 1 轮 → 按搜索返回字段（学校/学历/专业/岗位/技能高亮标签等）打分排序 → 取 Top {top_n}，输出纯 JSON（含 rows[]，每项 name/school_or_company/education/major/position/score/rid/link）。
>  - 退出码：0=成功（picked 可能为 0）；2=鉴权/搜索失败 → 读 stdout 的 `msg` 给一行提示，本次不推半成品。
>
> **【Step 4 · 🔴 跨天去重（定时上下文必走 · 只推新增）】**
>  - 对 Step 3 选出的 rows 跑差集脚本（用 rid 做差集），只保留近 30 天没推过的新增：
>    ```
>    # 先把 Step 3 的 rows 落成 jsonl（每行一个含 rid 的对象）→ picked.jsonl
>    cd {workspace} && python3 {SEARCH_SKILL_DIR}/scripts/dedup_pushed.py \
>      --task-key {task_key_resolved} \
>      --input picked.jsonl \
>      --output new_picked.jsonl
>    ```
>  - `{SEARCH_SKILL_DIR}` = campus → zhaopin-operations / social → zhaopin-social-operations（仅借用其 `dedup_pushed.py`，不进 SOP）。
>  - `{task_key_resolved}`：用户配了 task_key 就用；没配则 `<前缀>+岗位关键词`（如 `campus-daily-客户端开发`）自动生成**稳定**别名，同一任务每天用同一 key。
>  - 读 `new_count`：>0 → 用 new_picked.jsonl 出表，标题注明「今日新增 N 人（已过滤近 30 天推过的 M 人）」；==0 → **明确推「今日无新增」**（告诉用户近 30 天已推 M 人均覆盖），不要静默不推。
>
> **【Step 5 · 输出】** 一段完整 Markdown 推荐表，**最多 {top_n} 份**（默认 10；企微单条卡片 4096 字节上限，>10 时拆两条推）：候选人 / 学校（或现司）/ 学历 / 专业（或现职位）/ 意向岗位 / 简历链接。
>  - 链接直接用脚本返回的 `link` 字段。
>  - **标题自带日期戳 + 招聘类型**（如 `🧲 6-22 周一 · 校招简历搜推`）。
>  - 候选人姓名可显示；🔴 **不展示手机 / 邮箱 / 身份证等敏感字段**（脚本默认已不输出）。
>  - 不寒暄、不暴露内部 SOP 词汇（不写 Step / 脚本名 / 粗筛分等）。

## 适用场景

- 长招某个岗位，希望每天自动收到「新进简历库的对口候选人」，不用手动重复搜
- 校招高峰盯某几个目标专业 / 学校，每天看有没有新投递
- 社招稀缺岗，候选池更新慢，每天一次差集推送刚好不漏不重

## 注意事项

- 🔴 **search_brief（搜索条件）是必填**——定时任务无人值守，没有条件就没法搜。创建时一次性问清楚要搜什么人。
- **推送份数（top_n）由用户决定**：创建时问一句「每天想推几份？」，默认 10。⚠️ 因企微单条卡片有 4096 字节长度上限，**份数上限 10**；用户要更多时提示「单条卡片放不下，建议 ≤10 份，要更多可改成分两条推」。
- 🔴 **自托闭环·只粗筛（防超时核心）**：定时上下文走 `daily_resume_pick.py` 一条命令闭环——**搜 1 轮 → 按搜索返回字段粗筛排序 → 取 Top {top_n}**，**全程不点开简历详情、不翻页、不二次扩搜、不 `use_skill` 进搜简历 skill**。这是治校招定时任务半路 cancel / internal error 的关键（根因 = 旧链路 `use_skill` 进 zhaopin-operations 走两轮逐份精读，太重跑不完）。⚠️ 交互式手动搜简历**不受此限**，仍走 zhaopin-* 完整精读 SOP。
- 💡 **粗筛 vs 精读的取舍**：只用搜索返回字段做粗筛，准度不如逐份精读，但定时任务要的是「稳定跑完、每天给一批对口的头部候选」，看上去合适的再由用户点进简历详情人工核对。要更准就缩窄 search_brief 的结构化条件（学校梯队/专业/岗位标签）。
- 跨天去重靠 `task-key` 隔离：**不同岗位 / 校招 vs 社招必须用不同 key**，否则名单会串。同一任务每天用同一 key。
- 历史名单存 `~/.workbuddy/skills/txzhaopin-pushed-history/<task-key>.json`（用户级、跨 workspace 共享）；写名单失败只告警不阻断（宁可某天多推一次，不让任务挂掉）。
- 🔴 **错峰**：若你已有别的定时任务（面试待办 / 班次 / 其它搜推），**别和它们撞同一分钟**——多个任务挤同一时刻会被调度器碰撞、只跑成一个。创建时 agent 会先 list 查已有任务、自动把本任务错开 ≥5 分钟（详见 SKILL.md §四点五）。
- 默认工作日跑；周末也想跑把 RRULE 改成 `FREQ=DAILY`。
- 强绑 `recruit-mcp`（已写进 connectorIds），创建时无需用户再配。
- ⚠️ **隐私提示**：本任务每天把对口候选人推到群里，创建时提醒用户确认该群成员都有查看权限，避免简历信息外泄。

## 通知推送（🔴 必填 · 所有任务都通过群机器人 webhook 推送结果）

> 🔴 创建本任务时，agent **必须**按 SKILL.md §三点五向用户索要群机器人 webhook（所有任务强制必填）。
> - 🔴 webhook 是创建本任务的必填前置；用户暂时给不出 → 先记参数、不创建任务（绝不降级成"只在对话窗口看"）
> - 用户提供了群机器人 Webhook → 把下面这段**追加到上面 prompt 末尾**，`{webhook}` 替换为用户提供的 URL：
>
> ```
> 【结果推送】生成上面的推荐表后，用 curl 把内容以 markdown_v2 格式（支持表格）POST 到企业微信群机器人：
>   curl -s '{webhook}' -H 'Content-Type: application/json' \
>     -d '{"msgtype":"markdown_v2","markdown_v2":{"content":"<把推荐表转 markdown，≤4096 字节，超长只推 Top 3 + 一句『完整名单见 IDE 对话』>"}}'
> 推送成功（errcode=0）后简短确认"✅ 已推送到企微群"；失败重试 1 次仍失败则把名单留在对话里并提示手动转发。
> ```
>
> 详见 `references/notify-channel.md`（含 markdown_v2 富表格格式 + 自检门说明 + 4096 字节限制）。
