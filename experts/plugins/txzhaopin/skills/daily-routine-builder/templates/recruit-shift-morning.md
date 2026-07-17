---
id: recruit-shift-morning
name: 招聘早班·全景启动
category: 招聘班次
defaultName: 招聘早班-Workdays-{HHMM}
scheduleType: recurring
rrule: FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9;BYMINUTE=0
connectorIds:
  - recruit-mcp
configurable:
  - key: time
    label: 触发时间
    type: time
    default: "09:00"
  - key: include_progress
    label: 是否含招聘进度监控（板块一）
    type: boolean
    default: true
  - key: include_todo
    label: 是否含面试待办（板块二）
    type: boolean
    default: true
  - key: webhook
    label: 企业微信群机器人 Webhook（🔴 必填 · 所有定时任务都通过它推送结果）
    type: string
    default: ""
    required: true
---

# 招聘早班·全景启动

## 任务描述

每个工作日 {HH:MM}（招聘经理刚到工位时）自动跑一份**全景启动播报**：招聘进度监控 + 今日重要面试待办，两块一屏看完，开工不踩空。

> 本模板把"招聘大脑早班"落到本专家的真实能力上，**强绑定 recruit-mcp**——查进度、查待办都是专家自带能力，无需额外脚本。
>
> 🔴 **本班次不含简历搜推**：批量搜简历职责只属于 `zhaopin-operations`（校招）/ `zhaopin-social-operations`（社招），且定时搜推需要跨天去重（只推新增）。要每天自动搜简历，请单独配 **`daily-resume-search`**（每日简历搜推·新增推送），两者可并存——早班看进度待办，搜推任务独立推新候选。

## prompt

> 你是招聘早班全景助手。本次是定时触发的「招聘早班·全景启动」，请严格按下面顺序执行，**已启用板块全部跑完才推送**（任一块没跑完只输出已完成部分到对话，不推群）：
>
> **【Step 0 · 思考前置】** 先扫一眼：今天周几？是否周一（加"本周聚焦"）？是否临近 offer DDL？据此决定哪块置顶。
>
> **【板块一 · 进度监控】**（若 {include_progress}=true）
>  - 通过 `use_skill("recruitment-process-tracker")` 查我负责的招聘流程进度
>  - 表格按完成率升序（最差在第一行），每行附一句 AI 行动建议（完成率<40% 建议增投 / 40-60% 建议本周锁定 / 60-80% 维持节奏 / ≥80% 可支援落后部门）
>  - 查不到 → 输出"⚠️ 板块一暂不可用，下一班次重试"，**继续下一板块**
>
> **【板块二 · 面试待办】**（若 {include_todo}=true）
>  - 通过 `use_skill("interview-assistant")` 查今日及未来 7 天面试待办 + 逾期待填面评
>  - 🔴 今日紧急（24h 内要面的 + 逾期面评）置顶；🟡 本周内其余
>  - **只查本人**；候选人姓名可显示，不展示手机/邮箱
>  - 无待办 → 输出"✅ 今日无面试相关待办"
>
> **【自检门 · 推送前必走】**
>  - 已启用板块是否都产出了内容？是 → 进入推送；否 → 只把已完成部分留在对话里，提示"部分板块未就绪，本次不推群"，**不推半成品**。
>
> **【输出风格】** 一段完整 Markdown，可直接复制到企微；**标题自带日期戳 + 班次**（如 `🌅 6-17 周三 · 早班全景`，方便识别哪天漏跑）；其下一句 `💡 早安洞察：{一句话}`；状态灯仅 🟢🟡🔴；不寒暄、不暴露内部 SOP 词汇（不写"Step/板块/use_skill"等）。
>
> **【🔴 边界 · 不做简历搜推】** 本班次**不搜简历**。若用户问"今天搜到哪些新候选"，提示其单独配置 `daily-resume-search`（每日简历搜推·新增推送），不要在本任务里硬调任何 skill 搜简历。

## 适用场景

- 招聘经理一早开工，进度 + 面试待办一屏扫完
- 校招高峰期，每天盯进度 + 面试不漏项（搜推用 `daily-resume-search` 另配一条）

## 注意事项

- 默认工作日跑；周末也招聘的把 RRULE 改成 `FREQ=DAILY`
- 两块可单独开关（configurable 里的两个 boolean），只想要面试待办就关掉进度块
- 🔴 **想要每日简历搜推** → 单独配 `daily-resume-search`（含跨天去重、只推新增），本班次不承担搜简历
- 强绑 `recruit-mcp` 连接器（已写进 connectorIds），创建时无需用户再配
- 产出报告类任务，创建时**必问通知渠道**（见 SKILL.md §三点五）

## 通知推送（🔴 必填 · 所有任务都通过群机器人 webhook 推送结果）

> 🔴 创建本任务时，agent **必须**按 SKILL.md §三点五向用户索要群机器人 webhook（所有任务强制必填）。
> - 🔴 webhook 是创建本任务的必填前置；用户暂时给不出 → 先记参数、不创建任务（绝不降级成"只在对话窗口看"）
> - 用户提供了群机器人 Webhook → 把下面这段**追加到上面 prompt 末尾**，`{webhook}` 替换为用户提供的 URL：
>
> ```
> 【结果推送】通过自检门后，用 curl 把内容以 markdown_v2 格式（支持表格）POST 到企业微信群机器人：
>   curl -s '{webhook}' -H 'Content-Type: application/json' \
>     -d '{"msgtype":"markdown_v2","markdown_v2":{"content":"<把报告转 markdown，≤4096 字节，超长只推聚焦摘要+一句『详情见 IDE 对话』>"}}'
> 推送成功（errcode=0）后简短确认"✅ 已推送到企微群"；失败重试 1 次仍失败则把报告留在对话里并提示手动转发。
> ```
>
> 详见 `references/notify-channel.md`（含 markdown_v2 富表格格式 + 自检门说明 + 4096 字节限制）。
