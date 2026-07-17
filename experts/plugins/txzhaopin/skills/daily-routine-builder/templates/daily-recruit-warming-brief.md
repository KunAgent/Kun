---
id: daily-recruit-warming-brief
name: 校招保温·今日播报
category: 招聘类
defaultName: 校招保温播报-Workdays-{HHMM}
scheduleType: recurring
rrule: FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9;BYMINUTE=0
configurable:
  - key: time
    label: 触发时间
    type: time
    default: "09:00"
  - key: scope
    label: 查询范围
    type: string
    default: "我名下"
    options:
      - "我名下"
      - "我作为导师"
      - "我作为直接上级"
      - "我管理的组织"
  - key: include_levels
    label: 输出档位
    type: string
    default: "紧急+重要+常规"
    options:
      - "紧急+重要+常规"
      - "仅紧急+重要"
      - "仅紧急"
  - key: include_v4_focus
    label: 是否带 V4 关注建议
    type: boolean
    default: true
  - key: webhook
    label: 企业微信群机器人 Webhook（🔴 必填 · 所有定时任务都通过它推送结果）
    type: string
    default: ""
    required: true
---

# 校招保温·今日播报

## 任务描述

每个工作日 {HH:MM} 自动跑一遍校招签约后保温的"今日播报"，把 {scope} 范围内待入职同学按风险三级（紧急 / 重要 / 常规）整理输出，方便招聘经理一早进入工作状态。

⚠️ **不自动发业务通知**——本任务仅产出待办清单，不会自动给候选人/导师/上级发邮件或企微 Tips（这类业务通知须招聘经理播报后手动确认）。
ℹ️ 但**播报结果本身**可以推送到你自己的企微群（配 webhook，见「通知推送」段）——这是"把今日播报发给我自己看"，跟"给候选人/导师发业务通知"是两回事，不要混淆。

## prompt

> 你是校招保温播报助手。本次任务是定时跑出来的"校招保温·今日播报"，请严格走以下流程：
>
> 1. **进入 warming 场景 C**：通过 `use_skill("warming-recruit-manager")` 加载校招签约后保温工作台，进入「今日保温播报」场景（场景 C）。
> 2. **设定查询参数**：
>    - 查询范围：{scope}
>    - 输出档位：{include_levels}
>    - V4 关注建议：{include_v4_focus}（true=带；false=不带）
> 3. **数据查询**：由 warming 内部走 hr-ai-data 查 `Report_School_Recruiti_Info_List` 等签约后保温相关数据；如有字段缺失再用 recruit-mcp 补查。
> 4. **三级播报输出**：
>    - 🔴 **紧急**：今日内必须处理（如：导师未填且预计入职 ≤ 7 天 / 已确认毁约风险信号 / 上次建联超过 30 天的同学）
>    - 🟡 **重要**：本周内建议处理（如：临近入职 14 天内 / 月度关怀到期 / 实习考核窗口）
>    - 🟢 **常规**：可以本周晚些时候做（如：欢迎包未发送 / 节日关怀候选人）
> 5. **每位同学的呈现**：
>    - 姓名 + 员工子类型（毕业生 / 应届实习生 / 日常实习生，**必填**，缺失写"暂无"）
>    - 学校 + 岗位 + 工作地 + 预计入职日期 + 入职倒计时
>    - 待跟进事项（一句话）
>    - 风险提示（如有）
>    - 真实简历链接（resume_link，缺失时写明"在招聘系统按姓名/简历ID检索"）
> 6. **末尾"今日建议"**：
>    - 给出最值得今天做的 3 件事，每件配建议动作（如"给 XX 写欢迎话术 → /保温话术"、"通知 XX 导师 → /发邮件通知导师"）
>    - 如果今日无任何待跟进事项，输出"✅ 今日无待跟进保温事项"即可，**不要硬凑**
>
> **不允许做的事**：
> - ❌ 不要自动调用 `hrclaw-messenger` 发任何邮件 / Tips（本任务不带审批）
> - ❌ 不要展示候选人手机号、邮箱、微信号（隐私收口）
> - ❌ 不要凭空造数据；hr-ai-data MCP 未接通时直接退出并提示用户
>
> 输出风格：客观、简短、可执行；先结论后明细；3 个分级用清晰的小标题分隔。

## 适用场景

- 招聘经理每天上班时想 5 秒钟掌握"今天有谁要保温 / 哪些有风险"
- 用 daily-routine-builder 配置一次后即可工作日早上 9 点自动跑
- 跟手动用 `/保温工作台` → 场景 C 的产出一致，只是 0 操作触发

## 与其他能力的关系

| 能力 | 与本任务关系 |
|---|---|
| `warming-recruit-manager · 场景 C` | 本任务的核心执行体（本模板只是定时调度它） |
| `warming-recruit-manager · 场景 F`（发通知） | 播报后**用户手动**触发；本任务不自动触发 |
| `hr-data-router` | 不参与；保温场景的数据查询封装在 warming 内部 |
| `daily-interview-todo`（面试待办播报） | 互补：面试待办关注今日面试安排，保温播报关注招聘经理人员经营 |

## 前置条件

1. **MCP**：`HRIT/hr-ai-data/hr_data_service` 必须接通（如未接通，参考 hr-data-router/SKILL.md §1.2 安装 + 连接）
2. **数据权限**：当前用户在 hr-ai-data 数仓拥有对应组织/候选人的查询权限
3. **角色契合**：本模板面向**招聘经理 / 校招 HR**——非招聘角色配置后会查出空清单

## 注意事项

- 默认工作日跑（周一至周五）；如需含周末，把 RRULE 改为 `FREQ=DAILY;BYHOUR={H};BYMINUTE={M}`
- 多个组织或多个角色都要播报时，建议**不要叠在一个任务里**——分别建多个任务，scope 各设一个值，输出更清爽
- 如果某天确实空数据，输出"✅ 今日无待跟进保温事项"是预期行为，不是 bug
- 本模板不调度发通知；如需"自动通知导师/上级"，请单独再建一个任务，prompt 走 warming 场景 F 全闭环（含二次确认环节会被自动跳过的风险，请慎用）

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
