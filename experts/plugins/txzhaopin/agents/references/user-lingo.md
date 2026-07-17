# 用户常用词 / 黑话词典 · user-lingo

> **用途**：腾讯招聘 HR / 面试官 / 招聘经理日常说的"黑话、简称、口语"往往不等于 skill 触发词。本词典把**用户怎么说**映射到**该走哪个 skill**，加强路由识别。
> **加载时机**：与 capability-catalog 一样，路由命中失败时按需 Read；高频映射也可由 agent 内化。
> **维护**：发现新的用户说法导致误路由时，往这里补一行。这是一份"活"词典。

---

## 一、口语 / 黑话 → 标准能力映射

| 用户可能这么说 | 真实意图 | 路由到 | 备注 |
|---|---|---|---|
| "看板"、"大盘"、"数据看板"、"XX部门数据" | 数据统计可视化 | hr-data-router | ⚠️ 曾误判到搜简历/问询 |
| "完成率"、"达成率"、"完成情况"、"招得怎么样了" | 招聘漏斗统计指标 | hr-data-router | "招得怎么样"要结合上下文，可能问进度→反问 |
| "招了多少人"、"录了几个"、"进了几个" | 录用数据统计 | hr-data-router | |
| "卡在哪了"、"流程到哪步"、"走到哪了"、"还差啥" | 社招流程进度 | recruitment-process-tracker | 社招专用 |
| "我今天面谁"、"今天有啥面试"、"我的面试" | 面试待办 | interview-assistant · T | |
| "约一下"、"排个面"、"安排面试"、"挪个时间" | 面试安排 | interview-assistant · S | |
| "写个面评"、"录面评"、"填面评"、"面评草稿" | 面评 | interview-assistant · D | 🚫 "提交"不在能力内 |
| "复盘下我刚那场"、"我面得咋样"、"给我评评" | 复盘单场 | interview-assistant · E | |
| "我最近面得有进步吗"、"看我成长" | 复盘成长 | interview-assistant · G | 默认5场 |
| "我是什么样的面试官"、"我的面试风格"、"我的画像" | 面试官画像 | interview-assistant · I | 默认10场、不依赖存档 |
| "找几个人"、"搜简历"、"捞点候选人"、"扒点人" | 简历搜索 | 校招→zhaopin-operations / 社招→zhaopin-social-operations | 分不清校招社招要反问 |
| "招人"、"要招一个"、"缺个人" | 可能=搜简历 或 =需求沟通 | 反问：已有画像直接搜 / 还没想清楚走需求沟通 | 高频歧义 |
| "新开了个HC"、"有个新需求"、"要起个岗位" | 需求识别+画像+JD | requirement-communication-assistant | |
| "写个JD"、"岗位描述"、"招聘启事" | JD生成 | requirement-communication-assistant 或 assessment-quality-expert | |
| "用什么标准考"、"搭个模型"、"考察维度" | 胜任力建模/面试设计 | assessment-quality-expert | |
| "出题"、"面试题"、"考点"、"题库" | 出题 | interview-assistant · C 或 assessment-quality-expert | |
| "保温"、"待入职"、"签了的同学"、"别让人跑了" | 校招签约后保温 | warming-recruit-manager | 校招专用 |
| "毁约"、"会不会跑"、"稳不稳" | 毁约风险识别 | warming-recruit-manager | |
| "这份Excel"、"这堆面评数据"、"清洗下" | 面评数据清洗 | interview-data-processor | |
| "建个能力模型"、"提炼人才标准" | 面评数据建模 | interview-talent-modeler | |
| "活水冷冻期"、"伯乐奖金"、"三方协议"、"咋操作" | 规则制度问答 | recruitment-inquiry-bot | |
| "每天提醒我"、"自动跑"、"定时发我"、"每周来一份" | 定时任务 | daily-routine-builder | 横切最高优先级 |

---

## 二、腾讯招聘内部专有名词 / 简称

| 简称/黑话 | 全称/含义 | 相关 skill |
|---|---|---|
| 活水 | 内部转岗/活水机制 | inquiry-bot（规则）/ hr-data-router（活水数据） |
| 伯乐 | 内推/伯乐推荐 | inquiry-bot（奖金规则）/ hr-data-router（伯乐ROI） |
| HC | Head Count，编制/招聘名额 | hr-data-router（HC达成率）/ requirement(新开HC) |
| RID | 简历ID（Resume ID） | interview-assistant(拉详情) / zhaopin(搜索产出) |
| traceId / flowTraceId | 面试转写ID | interview-assistant · D/E/I |
| 待办 / T | 面试待办 | interview-assistant · T |
| 面评 | 面试评价 | interview-assistant · D |
| 产培 | 产品培训生（校招项目） | assessment-quality-expert |
| BEI | 行为事件访谈法 | assessment-quality-expert / interview-assistant · E |
| LGD | 无领导小组讨论 | assessment-quality-expert |
| 保温 | 签约后到入职前的候选人经营 | warming-recruit-manager |
| 三方 | 三方协议 | inquiry-bot |
| HRClaw | 内部通知系统（邮件/企微Tips） | hrclaw-messenger（工具skill） |

---

## 三、高频歧义词（必须结合上下文或反问）

> 这些词单独出现时无法判定，**触发 §-0 反问**。

| 歧义词 | 可能的几种意图 | 反问选项 |
|---|---|---|
| "招人" | 搜简历 / 起需求画像 / 看招聘数据 | ① 搜候选人 ② 梳理需求出画像JD ③ 看招聘数据 |
| "情况" / "怎么样" | 进度 / 数据 / 制度 | ① 实时进度 ② 数据统计 ③ 规则制度 |
| "校招/社招 + 部门名" | 数据 / 搜简历 / 流程进度 | ① 看数据 ② 搜候选人 ③ 查流程进度 |
| "跟进" | 搜简历推进 / 查进度 / 保温 | ① 推进候选人 ② 查流程进度 ③ 保温待入职 |
| "分析" | 数据分析 / 面评建模 / 简历评估 | ① 数据统计分析 ② 面评数据建模 ③ 评估某份简历 |

---

## 四、用户偏好沉淀（可选 · 个性化加强）

> 若同一用户反复确认某种歧义走向，可记录在此，下次同样表述直接路由不再反问。
> 格式：`用户login | 表述 | 确认走向 | 记录日期`

（暂无 — 由 agent 在多轮交互中逐步积累，或由用户显式要求"记住我说XX就是要YY"）
