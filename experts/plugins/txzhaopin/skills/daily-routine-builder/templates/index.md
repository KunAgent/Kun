# 模板菜单（用户维护）

> 本文件由模板维护者手工维护。skill 在用户进入"模板入口"时读取本文件作为菜单。
> 新增模板时：把文件放进 `templates/`，再在本文件对应分类下加一行。

---

## 🕐 招聘班次（v6.0 新增 · 早/午/晚三班次 · 强绑 recruit-mcp · 可弹窗批量选）

> 用户问「有什么定时任务 / 招聘定时任务能配什么」时，agent 走 **SKILL.md §十二 招聘班次中心**，用弹窗让用户勾选下面这些（含本分类三班次 + 招聘类常用模板），一次性批量配置。

| ID | 名称 | 频率 | 需要 | 说明 |
|----|------|------|------|------|
| `recruit-shift-morning` | 招聘早班·全景启动 | 工作日 9:00 | recruit-mcp · 可配 webhook 推群 | 进度监控 + 面试待办 两块一屏；可单独开关。**不含搜推**（搜推用 `daily-resume-search`）|
| `recruit-shift-noon` | 招聘午班·面试冲刺 | 工作日 14:00 | recruit-mcp · 可配 webhook 推群 | 面评催办 + 下午面试准备；面评易拖延者首选。**不含搜推**（搜推用 `daily-resume-search`）|
| `recruit-shift-evening` | 招聘晚班·对标复盘 | 工作日 18:00 | recruit-mcp + HR 数仓 · 可配 webhook 推群 | 进度 vs BG 对标 + 今日面试总结；周五自动切本周战报 |

## 🎯 招聘类（v5.5 新增 · 校招/HR 域专属）

| ID | 名称 | 频率 | 需要 | 说明 |
|----|------|------|------|------|
| `daily-recruit-warming-brief` | 校招保温·今日播报 | 工作日 9:00 | hr-ai-data MCP + 招聘经理身份 · 可配 webhook 推群 | 待入职同学按"紧急/重要/常规"三级播报 + 今日建议 3 件事；不自动发业务通知 |
| `daily-interview-todo` | 面试待办·今日播报 | 工作日 9:00 | recruit-mcp · 可配 webhook 推群 | 今日面试 + 推荐待办 + 逾期待填面评一屏播报；只查本人 |
| `daily-resume-search` | 每日简历搜推·新增推送 | 工作日 9:00 | recruit-mcp · 必填 webhook 推群 | 按预设岗位画像每天搜简历，**跨天去重只推近 30 天新增**；校招走 zhaopin-operations / 社招走 zhaopin-social-operations；创建必给搜索条件 |
| `weekly-process-pipeline` | 招聘流程进度周报 | 每周一 9:00 | recruit-mcp + 招聘经理身份 · 可配 webhook 推群 | 我负责的社招流程进度 + 偏慢预警 + 本周聚焦 3 件事 |
| `monthly-recruit-funnel-report` | 招聘漏斗月报 | 每月 1 号 9:00 | hr-ai-data MCP · 可配 webhook 推群 | 上月漏斗各阶段转化率 + 渠道排行 + 同环比 |
| `monthly-contract-expiry` | 合同到期清单 | 每月 1 号 9:00 | hr-ai-data MCP + HR/BP 身份 · 可配 webhook 推群 | 未来 N 个月内合同到期员工清单（默认 3 个月） |

---

## 维护备注

- 加新模板：在 `templates/` 下建文件 → 在本表对应分类加行 → 提交。
- 删模板：在本表标注 `deprecated`，文件可保留 30 天后移除。
- 模板 id 一旦发布，不要改名（避免历史 automation 找不到来源）。
