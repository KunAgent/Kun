---
id: monthly-recruit-funnel-report
name: 招聘漏斗月报
category: 招聘类
defaultName: 招聘漏斗月报-Monthly-{HHMM}
scheduleType: recurring
rrule: FREQ=MONTHLY;BYMONTHDAY=1;BYHOUR=9;BYMINUTE=0
configurable:
  - key: time
    label: 触发时间
    type: time
    default: "09:00"
  - key: scope
    label: 统计范围
    type: string
    default: "我负责的岗位"
    options:
      - "我负责的岗位"
      - "我管理的组织"
      - "我所在 BG"
      - "全公司（需对应权限）"
  - key: recruit_type
    label: 招聘类型
    type: string
    default: "全部"
    options:
      - "全部"
      - "仅社招"
      - "仅校招"
      - "仅活水"
  - key: include_channel
    label: 是否含各渠道转化率
    type: boolean
    default: true
  - key: webhook
    label: 企业微信群机器人 Webhook（🔴 必填 · 所有定时任务都通过它推送结果）
    type: string
    default: ""
    required: true
---

# 招聘漏斗月报

## 任务描述

每月 1 号 {HH:MM} 自动跑一份"上月招聘漏斗 + 各渠道转化率 + 平均周期"月报，给招聘经理 / HR / BG 招聘负责人当**月度复盘起点**。

⚠️ **数据时效**：hr-ai-data 数仓是 T-1 / 月末快照，因此"上个月"的全量数据要等 1 号当天数仓刷数完成。如果发现数据不全，把任务时间改成 **每月 2 号 9:00** 更稳妥。

## prompt

> 你是招聘漏斗月报助手。本次任务是定时跑出来的"招聘漏斗月报"，请严格走以下流程：
>
> 1. **进入 hr-data-router**：通过 `use_skill("hr-data-router")` 加载数据查询路由，进入 Q（数据查询）流程。
> 2. **查询参数**：
>    - 时间窗：上一个自然月（按本次任务的触发时间倒推）
>    - 统计范围：{scope}
>    - 招聘类型：{recruit_type}
>    - 含渠道转化率：{include_channel}
> 3. **关键宽表**（由 hr-data-sql-builder 选择）：
>    - 社招漏斗：`Report_Recruit_Flow_Detail`（主流程级转化）
>    - 社招简历评估：`Report_Recruit_Resume_Assessment`（简历→面试转化）
>    - 校招漏斗：`Report_School_Recruit_Interview_Info` + `Report_School_Recruiti_Info_List`
>    - 渠道：`Report_Recruit_Resume_Assessment`（含 channel_name / 渠道全路径）
>    - 伯乐：`Report_Bole_Recommendation_Record_Details` + `Report_School_External_Bole_Info`
> 4. **输出结构**：
>    - 📊 **TL;DR**：一句话结论 + 上月最关键的 3 个数字（投递数 / 入职数 / 整体转化率）
>    - 🔻 **漏斗**：投递 → 简历评估通过 → 面试通过 → Offer → 入职 各阶段数 + 阶段转化率（折叠为表格）
>    - 📈 **同比 / 环比**：跟去年同月、上月对比，标红环比下降 ≥ 20% 的环节
>    - 🌐 **渠道排行**（如果 {include_channel}=true）：Top 5 渠道 + 各自简历→入职转化率 + 简历来源占比
>    - ⏱️ **平均周期**：从简历投递到入职的平均天数；环比变化
>    - 🎯 **建议**：3 条最值得本月做的招聘策略调整（基于数字而不是套话）
> 5. **数据缺失处理**：
>    - 上月数据为 0 / 缺失 → 输出"⚠️ 上月数据未刷新或为空，建议改到每月 2 号触发"
>    - 字段被脱敏 → 末尾提示用户走 `hr-data-router · P` 排查权限
> 6. **PII 安全**：报表是统计量，不要展示任何候选人姓名 / 手机号 / 邮箱
>
> 输出风格：先结论后明细；数字加粗；环比异常标红；不要废话。

## 适用场景

- 招聘经理 / HR 月度复盘起点
- BG 招聘负责人给老板写报告的素材库
- 跨月看渠道效果衰减 / 转化率拐点

## 注意事项

- 默认每月 1 号跑；如发现 1 号当天数据不全，改成 2 号或 3 号
- "全公司"范围必须对应数据权限；普通用户跑会得到行权限缩小后的子集
- 默认**只查不主动催办**；如需结果推送到企微群，创建时配 webhook（见「通知推送」段）。其余手动操作：要分发给老板请用 hrclaw-messenger 单独发邮件

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
