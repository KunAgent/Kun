---
id: recruit-shift-noon
name: 招聘午班·面试冲刺
category: 招聘班次
defaultName: 招聘午班-Workdays-{HHMM}
scheduleType: recurring
rrule: FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=14;BYMINUTE=0
connectorIds:
  - recruit-mcp
configurable:
  - key: time
    label: 触发时间
    type: time
    default: "14:00"
  - key: include_eval
    label: 是否含面评催办（板块一）
    type: boolean
    default: true
  - key: include_afternoon
    label: 是否含下午面试准备（板块二）
    type: boolean
    default: true
  - key: webhook
    label: 企业微信群机器人 Webhook（🔴 必填 · 所有定时任务都通过它推送结果）
    type: string
    default: ""
    required: true
---

# 招聘午班·面试冲刺

## 任务描述

每个工作日 {HH:MM}（上午结束、下午启动时）自动跑一份**面试冲刺播报**：上午已面待写面评催办 + 下午面试准备要点，下半天不掉链子。

> 强绑定 recruit-mcp。聚焦"面评 + 下午面试"，是早班的承接班次。
>
> 🔴 **本班次不含简历搜推**：搜简历职责只属于 `zhaopin-operations` / `zhaopin-social-operations`，且定时搜推要跨天去重。要每天自动搜新候选请单独配 **`daily-resume-search`**。

## prompt

> 你是招聘午班冲刺助手。本次是定时触发的「招聘午班·面试冲刺」，请严格按下面顺序执行，**已启用的板块全部跑完才推送**（任一块没跑完只输出已完成部分到对话，不推群）：
>
> **【Step 0 · 思考前置】** 上午面试是否有亮点（S/A+）？是否有面评积压？下午有几场面试、是否有终面？据此决定置顶内容。
>
> **【板块一 · 面评催办】**（若 {include_eval}=true）
>  - 通过 `use_skill("interview-assistant")` 查上午已面试 → 待写面评列表 + 逾期面评
>  - 每条附"面评写作提示"（看评级 + 简历亮点给一句该突出/聚焦什么）
>  - 积压 ≥3 份 → 顶部加红条"🔴 面评催办：N 份待写，建议立即处理"
>  - 查不到 → "⚠️ 板块一暂不可用，下一班次重试"，**继续下一板块**
>
> **【板块二 · 下午面试准备】**（若 {include_afternoon}=true）
>  - 通过 `use_skill("interview-assistant")` 查今天下午的面试场次
>  - 每场附"个性化追问建议"（读上轮面评找待考察项 → 转成具体追问角度）
>  - 有终面 → 单独突出"🎯 终面就绪卡"（候选人画像摘要 + 上轮评价 + 建议追问点）
>  - **只查本人**；不展示手机/邮箱
>  - 无下午面试 → "✅ 下午无面试安排"
>
> **【自检门 · 推送前必走】** 已启用板块都产出了？是 → 推送；否 → 只留对话、不推群、不推半成品。
>
> **【输出风格】** 一段完整 Markdown；**标题自带日期戳 + 班次**（如 `🌞 6-17 周三 · 午班冲刺`，方便识别哪天漏跑）；其下一句 `💡 午间洞察：{一句话}`；状态灯仅 🟢🟡🔴；不寒暄、不暴露内部 SOP 词汇。
>
> **【🔴 边界 · 不做简历搜推】** 本班次**不搜简历**。要每天自动搜新候选，提示用户单独配 `daily-resume-search`，不要在本任务里硬调任何 skill 搜简历。

## 适用场景

- 上午面完一批，午休时一眼看到"哪些面评要补、下午面谁、怎么问"
- 面评易拖延的面试官，靠午班催一次把当天面评清完

## 注意事项

- 默认 14:00 跑；可按自己午休节奏改
- 两块可单独开关；只想要面评催办就关掉下午准备块
- 🔴 **想要每日简历搜推** → 单独配 `daily-resume-search`（含跨天去重、只推新增），本班次不承担搜简历
- 强绑 `recruit-mcp`，无需额外配置
- 产出报告类任务，创建时**必问通知渠道**（见 SKILL.md §三点五）

## 通知推送（🔴 必填 · 所有任务都通过群机器人 webhook 推送结果）

> 🔴 创建本任务时按 SKILL.md §三点五向用户索要群机器人 webhook（强制必填）。拿到 URL → 把下面这段追加到 prompt 末尾，`{webhook}` 替换为 URL；拿不到 → 先记参数、不创建：
>
> ```
> 【结果推送】通过自检门后，用 curl 把内容以 markdown_v2 格式 POST 到企业微信群机器人：
>   curl -s '{webhook}' -H 'Content-Type: application/json' \
>     -d '{"msgtype":"markdown_v2","markdown_v2":{"content":"<把报告转 markdown，≤4096 字节>"}}'
> 推送成功（errcode=0）后确认"✅ 已推送到企微群"；失败重试 1 次仍失败则留对话提示手动转发。
> ```
>
> 详见 `references/notify-channel.md`。
