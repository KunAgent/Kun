---
id: daily-interview-todo
name: 面试待办·今日播报
category: 招聘类
defaultName: 面试待办播报-Workdays-{HHMM}
scheduleType: recurring
rrule: FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9;BYMINUTE=0
configurable:
  - key: time
    label: 触发时间
    type: time
    default: "09:00"
  - key: include_t2
    label: 是否含 T2 推荐待办
    type: boolean
    default: true
  - key: include_overdue
    label: 是否含逾期待填面评
    type: boolean
    default: true
  - key: webhook
    label: 企业微信群机器人 Webhook（🔴 必填 · 所有定时任务都通过它推送结果）
    type: string
    default: ""
    required: true
---

# 面试待办·今日播报

## 任务描述

每个工作日 {HH:MM} 自动跑一份当前用户的**面试待办** + **推荐待办** + **逾期待填面评**清单，给面试官 / 招聘经理一早集中扫一眼，避免漏面试 / 漏评价。

⚠️ **只查本人**：本任务永远只查"当前用户"自己的待办；要查别人名下的待办（仅社招）请用 `recruitment-process-tracker`（按 hrs / 面试官 / 当前处理人维度筛，需对应权限）单独询问。

## prompt

> 你是面试待办播报助手。本次任务是定时跑出来的"面试待办今日播报"，请严格走以下流程：
>
> 1. **进入 interview-assistant**：通过 `use_skill("interview-assistant")` 加载面试助手。
> 2. **查询的子流程**：
>    - T 流程：今日及未来 7 天的**面试待办**（必查）
>    - T2 流程：**推荐待办**（如 {include_t2}=true）
>    - 逾期待填面评：**面评填写超期**列表（如 {include_overdue}=true）
> 3. **MCP 探活**：先确认 `recruit-mcp` 接通；不通则按 §0 引导
> 4. **输出结构**：
>    - 🔴 **今日紧急**（红色置顶）：
>      - 今天 24 小时内要面的（按时间排序，含面试时间、候选人、岗位、面试方式）
>      - 逾期待填面评（已超 X 天，按超期时长降序）
>    - 🟡 **本周内**：
>      - 未来 2-7 天的面试预约（含星期、时间、候选人、岗位）
>      - T2 推荐待办（候选人简历待评估）
>    - 📋 **数字汇总**：今日 N 场 / 本周 M 场 / 待填面评 K 个 / 推荐待办 P 个
>    - 🎯 **建议**：根据数字给一条本日聚焦建议（如"今天 3 场面试连排，建议提前 30 分钟看简历"）
> 5. **空数据兜底**：
>    - 今日无面试 + 无逾期 + 无推荐待办 → 输出"✅ 今日无面试相关待办，专注其他工作"
> 6. **PII 边界**：候选人姓名可显示（自己的待办本来就有权限），但不要展示手机/邮箱
>
> 输出风格：紧急 + 本周分两段；时间精确到分钟；逾期项按超期时长降序；不寒暄。

## 适用场景

- 面试官早上喝咖啡时一眼扫掉今日所有面试 + 待评价
- 招聘经理一早确认自己的 HR 资格面试 / 用人决策面试待办
- 周末或休假回来扫"积压有没有炸"

## 注意事项

- 默认工作日跑；如果你**周末也面试**（投行 / 创业部门偶有），把 RRULE 改为 `FREQ=DAILY`
- 本任务永远只查本人；要查别人名下的待办（仅社招）请用 `recruitment-process-tracker`（按 hrs / 面试官 / 当前处理人筛，需对应权限）单独询问
- 默认**只查不主动催办**；如需结果推送到企微群，创建时配 webhook（见「通知推送」段）。其余手动操作：逾期面评催办、改面预约请由用户手动触发对应 skill

## 通知推送（🔴 必填 · 所有任务都通过群机器人 webhook 推送结果）

> 🔴 创建本任务时，agent **必须**按 SKILL.md §三点五向用户索要群机器人 webhook（所有任务强制必填）。
> - 🔴 webhook 是创建本任务的必填前置；用户暂时给不出 → 先记参数、不创建任务（绝不降级成"只在对话窗口看"）
> - 用户提供了群机器人 Webhook → 把下面这段**追加到上面 prompt 末尾**，`{webhook}` 替换为用户提供的 URL：
>
> ```
> 【结果推送】生成上面的报告后，用 curl 把核心内容以 markdown 格式 POST 到企业微信群机器人：
>   curl -s '{webhook}' -H 'Content-Type: application/json' \
>     -d '{"msgtype":"markdown","markdown":{"content":"<把报告转 markdown，≤4096 字节，超长只推聚焦摘要+一句『详情见 IDE 对话』>"}}'
> 推送成功后简短确认"✅ 已推送到企微群"；失败则把报告留在对话里并提示手动转发。
> ```
>
> 详见 `references/notify-channel.md`。
