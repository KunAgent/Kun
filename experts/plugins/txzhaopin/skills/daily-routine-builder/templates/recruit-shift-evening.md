---
id: recruit-shift-evening
name: 招聘晚班·对标复盘
category: 招聘班次
defaultName: 招聘晚班-Workdays-{HHMM}
scheduleType: recurring
rrule: FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=18;BYMINUTE=0
connectorIds:
  - recruit-mcp
configurable:
  - key: time
    label: 触发时间
    type: time
    default: "18:00"
  - key: include_benchmark
    label: 是否含进度对标（板块一）
    type: boolean
    default: true
  - key: include_summary
    label: 是否含今日面试总结（板块二）
    type: boolean
    default: true
  - key: friday_review
    label: 周五是否切换为本周战报版
    type: boolean
    default: true
  - key: webhook
    label: 企业微信群机器人 Webhook（🔴 必填 · 所有定时任务都通过它推送结果）
    type: string
    default: ""
    required: true
---

# 招聘晚班·对标复盘

## 任务描述

每个工作日 {HH:MM}（下班前）自动跑一份**对标复盘**：我的进度 vs 团队/BG 对标 + 今日面试人选总结，下班心里有数；周五自动切到「本周战报」。

> 强绑定 recruit-mcp + HR 数仓。是三班次的收口班次，做总结与对标。

## prompt

> 你是招聘晚班复盘助手。本次是定时触发的「招聘晚班·对标复盘」，请严格按下面执行，**已启用板块全部跑完才推送**：
>
> **【Step 0 · 思考前置】** 今天周几？**若周五且 {friday_review}=true → 切到 §周五战报版**（见末尾），不走标准结构。否则：今日完成率较昨日升还是降？今日 S/A+ 比例？
>
> **【板块一 · 进度 vs BG 对标】**（若 {include_benchmark}=true）
>  - 通过 `use_skill("recruitment-process-tracker")` + `hr-data-router` 查我的部门进度并与团队/BG 均值对标
>  - 输出对标表：部门 / 我的完成率 / BG 均值 / 差距 / 状态灯 / AI 明日聚焦
>  - 顶部一句 AI 归因（瓶颈在哪个部门、原因猜想：画像窄/候选池竞争/转化率低）
>  - 查不到 → "⚠️ 板块一暂不可用，下一班次重试"，**继续**
>
> **【板块二 · 今日面试人选总结】**（若 {include_summary}=true）
>  - 通过 `use_skill("interview-assistant")` 汇总今日已面候选人，按 S/A+/A/A-/B 分类
>  - "✅ 推进下一轮"段附 AI 决策建议（如"A+ 优先安排终面，本月可锁定"）
>  - **只查本人**；不展示手机/邮箱
>  - 无面试 → "✅ 今日无面试记录"
>
> **【自检门 · 推送前必走】** 已启用板块都产出了？是 → 推送；否 → 只留对话、不推群。
>
> **【输出风格】** 一段完整 Markdown；**标题自带日期戳 + 班次**（如 `🌙 6-17 周三 · 晚班复盘`，方便识别哪天漏跑）；其下一句 `💡 复盘洞察：{偏总结型一句话}`；状态灯仅 🟢🟡🔴 + 排名 🥇🥈🥉；不寒暄、不暴露内部 SOP 词汇。
>
> ---
> **【§周五战报版】**（仅周五且 {friday_review}=true 时走，替代上面标准结构）：
>  - 标题"🌙 周五战报 · 本周招聘复盘"
>  - 【本周达成】锁定简历 N 份 / 进入面试 N 人 / 已签约 N 人 / 完成率 x%→y%
>  - 【本周问题】🔴 问题1（含原因+建议）🟡 问题2
>  - 【下周 Top 3 聚焦】🥇🥈🥉 各一条具体行动
>  - 数据同样来自 process-tracker + hr-data-router，同样走自检门后再推送

## 适用场景

- 下班前 5 分钟掌握"今天推进到哪、落后 BG 多少、明天该聚焦谁"
- 周五自动出一份本周战报，免得周末还惦记

## 注意事项

- 默认 18:00 跑；可按下班时间改
- 周五战报开关默认开；不想要战报、只想要日常复盘就关掉
- 强绑 `recruit-mcp`，进度对标会用到 HR 数仓
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
