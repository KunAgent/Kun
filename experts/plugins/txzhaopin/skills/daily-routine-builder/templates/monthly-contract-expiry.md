---
id: monthly-contract-expiry
name: 合同到期清单
category: 招聘类
defaultName: 合同到期清单-Monthly-{HHMM}
scheduleType: recurring
rrule: FREQ=MONTHLY;BYMONTHDAY=1;BYHOUR=9;BYMINUTE=0
configurable:
  - key: time
    label: 触发时间
    type: time
    default: "09:00"
  - key: lookahead_months
    label: 提前预警期（月）
    type: number
    default: 3
    options: [1, 3, 6]
  - key: scope
    label: 统计范围
    type: string
    default: "我管理的组织"
    options:
      - "我管理的组织"
      - "我所在 BG"
      - "指定部门（在 cwds 里写组织全路径）"
  - key: include_no_fixed
    label: 是否含无固定期限合同
    type: boolean
    default: false
  - key: webhook
    label: 企业微信群机器人 Webhook（🔴 必填 · 所有定时任务都通过它推送结果）
    type: string
    default: ""
    required: true
---

# 合同到期清单

## 任务描述

每月 1 号 {HH:MM} 自动跑出未来 {lookahead_months} 个月内合同到期的员工清单，给 HR / BP / 部门 leader 当**续签提前量**。

⚠️ **数据时效**：hr-ai-data 是 T-1 数仓数据；本任务跑出的是 T-1 时点的合同到期视图，不含本月新签的最新变化。

## prompt

> 你是合同到期提醒助手。本次任务是定时跑出来的"合同到期清单"，请严格走以下流程：
>
> 1. **进入 hr-data-router**：通过 `use_skill("hr-data-router")` 加载数据查询路由，进入 Q 流程。
> 2. **查询参数**：
>    - 时间窗：未来 {lookahead_months} 个月内（从今天起算）
>    - 统计范围：{scope}
>    - 是否含无固定期限合同：{include_no_fixed}
> 3. **关键宽表**：`Report_Wide_Public_Staff_Contract_Info`（合同明细表，含 contract_end_date / contract_type / contract_subject 等字段；状态筛选"有效"或"有效（改签）"）
> 4. **输出结构**：
>    - 📊 **TL;DR**：本期共 N 人合同到期；其中 ≤30 天 X 人 / 30-60 天 Y 人 / 60-90 天 Z 人
>    - 🔴 **本月内到期**（≤30 天，紧急置顶）：表格列出
>      - 员工姓名 + loginName + 部门
>      - 合同到期日 + 倒计时天数
>      - 合同类型（聘用 / 实习 / 三方等）
>      - 合同主体（哪个签约公司）
>      - 入职日期 + 司龄
>      - 是否有过续签 / 改签历史
>    - 🟡 **30-60 天内**：同上格式
>    - 🟢 **60-90 天内**：同上格式（提前注意，方便提前安排沟通）
>    - 📈 **结构分析**：按部门 / 合同类型分布的统计
>    - 🎯 **建议**：3 条本月最值得 HR/BP 推进的（如"红组的张三入职 10 年，建议尽早确认续签意向"）
>    - 💼 **无固定期限合同**（如 {include_no_fixed}=true）：单独列出，含无固定期限的员工数量
> 5. **PII 边界**：员工姓名 + loginName + 部门 + 合同字段可显示（HR 视角的合规需求）；不要展示身份证 / 手机 / 银行卡
> 6. **空数据兜底**：未来 {lookahead_months} 个月内无合同到期 → "✅ 未来 {lookahead_months} 个月内无合同到期，可专注其他工作"
>
> 输出风格：先 TL;DR 后明细；按"到期紧迫度"分段；建议要可执行不空话。

## 适用场景

- HR / BP 月度合规检查（避免"忘了续签"翻车）
- 部门 leader 提前知道哪几位即将合同到期，安排沟通
- 老板查"我团队有多少人合同要续"

## 注意事项

- {lookahead_months} 建议 3 个月（≤1 太晚来不及；≥6 噪音多）
- "我管理的组织"会受限于 hr-data 行权限——普通员工跑会得到 0 条
- 跨子公司的员工合同主体不同，结构分析按"合同主体"也很有用，可在 prompt 加一段
- 默认**只查不主动催办**；如需结果推送到企微群，创建时配 webhook（见「通知推送」段）。其余手动操作：要给员工发续签沟通邮件请用 hrclaw-messenger 单独发

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
