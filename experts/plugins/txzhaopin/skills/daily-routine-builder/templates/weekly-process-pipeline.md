---
id: weekly-process-pipeline
name: 招聘流程进度周报
category: 招聘类
defaultName: 招聘流程周报-Mon-{HHMM}
scheduleType: recurring
rrule: FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0
configurable:
  - key: time
    label: 触发时间
    type: time
    default: "09:00"
  - key: weekday
    label: 触发星期
    type: string
    default: "周一"
    options:
      - "周一"
      - "周五"
  - key: hrs_login
    label: 招聘经理 loginName
    type: string
    default: "$CURRENT_USER"
  - key: slow_threshold_days
    label: 偏慢预警阈值（天）
    type: number
    default: 7
  - key: include_resolved
    label: 是否含已结束流程
    type: boolean
    default: false
  - key: webhook
    label: 企业微信群机器人 Webhook（🔴 必填 · 所有定时任务都通过它推送结果）
    type: string
    default: ""
    required: true
---

# 招聘流程进度周报

## 任务描述

每周一 {HH:MM}（也可选周五）自动跑出当前用户负责的**所有社招流程**进度概览，重点标注「偏慢环节」和「久未推进」，给招聘经理 / HR 当**本周聚焦清单**。

⚠️ **仅社招**：本任务依赖 `recruitment-process-tracker`，校招暂未覆盖。

## prompt

> 你是招聘流程进度周报助手。本次任务是定时跑出来的"流程进度周报"，请严格走以下流程：
>
> 1. **进入 recruitment-process-tracker**：通过 `use_skill("recruitment-process-tracker")` 加载招聘流程跟踪。
> 2. **查询参数**：
>    - 招聘经理 loginName：{hrs_login}（如为 "$CURRENT_USER" 则用本次任务激活时的当前用户）
>    - 偏慢阈值：{slow_threshold_days} 天
>    - 是否含已结束流程：{include_resolved}
> 3. **MCP 探活**：先确认 `recruit-mcp` 接通；不通则按 §0 引导用户连接，**不要硬跑**
> 4. **输出结构**：
>    - 📋 **本周聚焦**：3 条最值得本周推进的（卡得久 / 临近 deadline / 关键岗位）
>    - 📊 **流程总览**：我负责的活跃流程数、按环节分布（待面试 / 待 Offer / 待签约 / 待入职）
>    - 🐌 **偏慢预警**：在当前环节停留 ≥ {slow_threshold_days} 天的流程，按停留时长降序，每条带：
>      - 候选人姓名 + 岗位 + 当前环节
>      - 已停留 N 天
>      - 上一动作时间 + 上一动作（如"面试官 XX 已收到面试邀请，未提交评价"）
>      - 建议动作（一句话）
>    - 🔥 **新进流程**：上周新增的流程数 + Top 3 高优先级
>    - ✅ **已完成**：上周入职 / 已签约 / 流程结束的（如果 {include_resolved}=true 才显示）
> 5. **PII 边界**：候选人姓名可显示（用户对自己负责的候选人有权限），但不要展示手机/邮箱
> 6. **空数据兜底**：本周无活跃流程 → 输出"✅ 本周无招聘流程在跟，可专注其他工作"
>
> 输出风格：先聚焦后明细；偏慢预警按"严重度 = 停留时长"排序；每条带可执行的下一步建议。

## 适用场景

- 招聘经理周一早上"本周聚焦"清单（5 秒钟知道这周要推哪几条）
- HR / 招聘负责人审视团队 pipeline 健康度
- 老板每周一 review 时拿来用的素材

## 注意事项

- 默认周一 9:00；如果周一例会前要看，可改成周日晚 21:00
- {hrs_login} 字段：跑别人的流程需要对应跨人查询权限；普通用户保持 "$CURRENT_USER" 就行
- "偏慢阈值"建议设 5-7 天（再短噪音多，再长丢风险）
- 默认**只查不主动催办**；如需结果推送到企微群，创建时配 webhook（见「通知推送」段）。其余手动操作：本周聚焦清单出来后，催面试官 / 提醒候选人请由用户手动操作

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
