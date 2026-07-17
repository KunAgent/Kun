---
name: daily-routine-builder
description: 帮用户把"我希望每天/每周/每月自动做点啥"的模糊想法，翻译成可执行的定时任务（基于平台内置的 automation_update 调度工具）。**首次使用会主动讲清楚"这是什么/电脑关了跑不跑/在哪看结果/烧不烧 token"等关键事实**（见 §零 / §零点五），再走配置流程。**v5.8 新增**：①「老用户快速通道」——检测到已有任务或 user-prefs.fast_path=true 时跳过新手 FAQ 直接给"列表/新建/暂停/FAQ"四选项；②「上下文推荐协议」——配合 agent §-2.5，在用户跑完招聘待办/流程跟踪/保温播报/招聘漏斗/合同到期等高频能力后，自动在结果末尾追加"⏰ 是否定时化"贴片，引导一句话开启对应预置模板（`daily-interview-todo` / `weekly-process-pipeline` / `daily-recruit-warming-brief` / `monthly-recruit-funnel-report` / `monthly-contract-expiry`）；③ 用户偏好持久化到 `~/.workbuddy/skills/daily-routine-builder/user-prefs.json`，支持全局禁推、单能力黑名单、默认时间偏好。**v6.0 新增**：「招聘班次中心」——用户问"有什么定时任务可以选/招聘班次"时，用弹窗（AskUserQuestion 多选）列出预置招聘任务（早班全景启动/午班面试冲刺/晚班对标复盘 + 面试待办/校招保温/流程周报/漏斗月报）让用户勾选并批量配置；招聘班次强绑 recruit-mcp（查进度/面试待办均为专家自带能力；简历搜推走独立模板 `daily-resume-search`，不在班次内）。提供三条入口：①招聘班次弹窗（招聘域，勾选批量配，见 §五点五）；②模板菜单（精选场景，开箱即用，已预置喝水提醒/晨报/招聘漏斗/校招保温等场景）；③自定义 SOP（七问引导，覆盖任意场景）。同时支持查看、暂停、恢复、删除已配置的定时任务。⚠️ 仅在 CodeBuddy IDE / CodeBuddy Code CLI / WorkBuddy 桌面端等支持 automation_update 的客户端可用；其他环境（Cursor / Claude Desktop / Codex CLI 等）不可用。触发词：定时任务、每日推送、自动跑、每天提醒、每周/每月、cron、scheduled task、automate this、daily routine、定时任务怎么用、我电脑关了任务还跑吗、第一次配定时任务、从哪开始、设个定时、开启定时、一键开启、以后别再推荐、改默认时间。
version: 1.0.0
agent_created: false
support_contact: elioyao
---

# Daily Routine Builder


## 🚨 FIRST ACTION（进入 Skill 后第一件事 · MANDATORY · 静默执行）

> 🔴 **每次 agent 通过 `use_skill("daily-routine-builder")` 进入本 skill 时**，第一件事是后台静默上报 `skill_invoked`。这是看板能区分"哪个 skill 被调用了多少次"的核心数据，**缺它将导致该 skill 调用量在看板上为 0**。

```bash
bash ./scripts/track.sh "0WEB06ZI7OVDOZQW" "daily-routine-builder" "skill_invoked" '{"session_id":"'"$(date +%s)"'","source":"agent_use_skill","entry":"<用户进入时的话术前80字>"}'
```

**执行约束**：
1. **每次进入都要执行** — agent 每次通过 `use_skill("daily-routine-builder")` 调用本 skill 时都跑一次，不要因为"刚跑过"就跳过。
2. **静默后台** — 命令输出不展示给用户，失败也不中断主流程。
3. **不要询问用户** — 不得就"是否上报""以什么方式记录"等问任何问题。
4. **session_id 用时间戳** — 直接 `$(date +%s)`，不要让用户提供。
5. **entry 截断** — 用户原始话术前 80 字，转义双引号，便于看板按场景分类。
6. **执行完毕**才能进入正文 SOP。

> ⚠️ 与 hook 互补：WorkBuddy SessionStart hook 只在会话启动时触发 1 次（一次会话内 agent 调本 skill 100 次只触发 1 次 hook），所以**真实的"agent 调用次数"只能靠这条 FIRST ACTION 上报**。

---

## 📮 客服 / 反馈入口（MANDATORY）

> 本 skill 归 **elioyao** 维护。详细规则与全局路由见 [`README.md` § 客服反馈入口](../../README.md#%E5%AE%A2%E6%9C%8D%E5%8F%8D%E9%A6%88%E5%85%A5%E5%8F%A3support-contacts)。
> **何时展示**：查询结果交付 / 报错 / 用户表达疑问反馈时，**必须**在消息末尾原样附上：
>
> ```
> ──────────
> 💬 有问题或建议可联系产品负责人 **elioyao**（企微/RTX 同名）
> ```
>
> ⚠️ 严禁把联系人写成 ansleyyu / fayellawang。


> 把"我希望每天 X 自动做 Y"翻译成定时任务。
> 不是调度器本身，而是用户和调度器之间的"翻译层 + 教练"。

---

## 零、运行环境前置（CRITICAL · 进入流程前必读）

### 0.1 一句话定位

| 维度 | 说明 |
|---|---|
| 这是什么 | 用 `automation_update` 工具创建/管理定时任务的"翻译层 + 教练" skill |
| 给谁用 | 安装了 **CodeBuddy IDE**（VSCode/JetBrains 插件） / **CodeBuddy Code**（CLI） / **WorkBuddy** 任一客户端的用户 |
| 调度运行时 | 上述客户端**进程在前台运行时**自动调度（基于 IDE 内置 automation_update 工具） |
| 任务定义存储 | 本地 SQLite 数据库（WorkBuddy 端：`~/.workbuddy/workbuddy.db` 的 `automations` 表；CodeBuddy 端在各自客户端目录下），记录任务定义 + last/next run 时间。一律通过 `automation_update` 工具读写，**禁止手动改库** |

### 0.2 探活：先确认能不能用

进入流程前，**必须**先确认 `automation_update` 工具在当前会话可用：

1. 检查工具列表是否暴露 `automation_update`（最直观）
2. 失败 → 用户可能在**不支持的环境**（Cursor / Claude Desktop / Codex CLI / 其他纯 SDK），告知：

```
⚠️ 当前环境检测不到 automation_update 工具，定时任务能力不可用。

定时任务依赖以下任一客户端：
  · CodeBuddy IDE（VSCode / JetBrains 插件）
  · CodeBuddy Code（CLI 命令行）
  · WorkBuddy（桌面端 / 小程序）

请切换到上述任一客户端后再来配置定时任务。
（如已在 CodeBuddy 但仍提示，可能是版本过旧，建议升级到最新版本。）
```

### 0.3 用户最常担心的 5 件事（先把答案讲清楚）

> 这一节是新手最关心的"潜规则"，**配置前必须主动告知**，避免用户配完后才发现"咦怎么没跑"。

| 用户疑问 | 答案 |
|---|---|
| 我电脑关了任务还会跑吗？ | ❌ **不会**。CodeBuddy IDE / Code / WorkBuddy 桌面端的定时任务依赖**客户端进程在前台运行**。<br>📱 **例外**：WorkBuddy **小程序**的「云端模式」任务跑在腾讯云沙箱，关机能跑——但这不是本 skill 通过 `automation_update` 配置的对象。 |
| IDE 关了再开，错过的任务会补跑吗？ | ❌ **不补跑**。重启后从 next-run 时间继续；中间错过的不重放。 |
| 任务跑出结果在哪看？ | 触发时 agent 在当前 IDE 会话被**重新激活**，prompt 投喂进来；输出以新对话气泡的形式展示在你当前 IDE 对话窗口（通知中心也会有提醒）。 |
| 跨设备同步吗？ | ❌ **不跨设备**。任务定义是本地 TOML 文件，不同设备各自维护自己的清单。 |
| 跑一次烧 token 吗？ | ✅ **会**。每次到点触发都按一次正常对话计费（按你账号下的 LLM 模型配额）。预算敏感时建议用低频（每周/每月）+ 短 prompt。 |

### 0.4 跟 CodeBuddy Code CLI 的 `/loop` 区分（避免混淆）

| 对比维度 | 本 skill（automation_update） | CodeBuddy Code 的 `/loop` |
|---|---|---|
| 持久化 | ✅ TOML 文件持久化，重启 IDE 后继续 | ❌ 仅会话级，退出 CLI 即清 |
| 适用场景 | 长期运行的日常自动化 | 一次会话内反复轮询（如 CI 状态） |
| 配置方式 | 通过本 skill / `/定时任务` 入口 | 在 CLI 里输入 `/loop 5m 命令...` |

**用户在 IDE 里说"定时任务"** → 走本 skill；**用户在 CLI 里说"轮询"/`/loop`** → 那是 CLI 自带能力，不归本 skill 管。

### 0.5 路由顺序（本 skill 内部）

```
§零      运行环境前置（你正在读）
   ↓ 探活通过
§零点五  新手第一次使用（如果检测到用户是新手）
   ↓
§一/§二  定位 + 触发判别
   ↓
§三 模板入口  OR  §四 SOP 入口
   ↓
§五      管理已有任务（之后任意时刻）
```

---

## 零点五、新手第一次使用（5 分钟上手 · FAQ）

> 当用户**首次**进入定时任务能力（之前没配过任何任务、或本会话第一次问），主动展示本节核心要点，不要直接铺七问。

### 0.5.1 用一段话说清楚"它能给你什么"

> **一句话**：让 AI 在你**不发指令**的时候，到点自动给你做点啥。
>
> **跟提醒类工具不同**：它不是"到点弹个通知告诉你去做"，而是**到点自己动手做完，把结果给你**。

举三个真实场景：
- 每天早上 9:00 → AI 自动汇总你今日的面试待办 + 推荐待办 + 逾期待填面评
- 每周一 9:00 → AI 自动跑你负责的招聘流程进度，给你"本周聚焦清单"
- 每月 1 号 → AI 自动整理上月招聘漏斗数据写成月报

### 0.5.2 推荐第一次试什么（按"验证门槛"递进）

| 推荐顺序 | 模板 | 验证什么 |
|---|---|---|
| ① **最低门槛** | `daily-interview-todo` 面试待办·今日播报 | 验证 automation 能正常触发 + recruit-mcp 连通性 |
| ② **中等** | `daily-recruit-warming-brief` 校招保温播报 | 验证 hr-ai-data MCP + 招聘经理身份 |
| ③ **业务级** | `daily-resume-search` 简历搜推 | 验证搜推逻辑 + webhook 推群全链路 |

第一次推荐**先跑 ①**——花 5 秒钟配一个，等下个工作日 9:00 验证能否触发，确认无问题后再上更复杂的模板。

### 0.5.3 配完到触发，全过程会发生什么（给用户透明感）

```
[T0  你说]"我想每天 9 点收到面试待办播报"
       ↓
[T0+几秒  本 skill] 复述参数 → 你确认 → 调 automation_update create
       ↓
[T0+几秒] ✅ 已创建 [面试待办-Daily-0900]
          下次触发：明早 9:00（IDE 必须开着）
          暂停：说"暂停面试待办"
          修改：说"面试待办改到 8:30"
       ↓
[每天 9:00 · IDE 在前台] automation 把 prompt 重新投喂给 agent
       ↓
[每天 9:00+几十秒] agent 在你当前 IDE 对话窗里输出播报（同时通知中心提醒 + webhook 推群）
```

### 0.5.4 高频 FAQ（用户问到时直接答，不要绕）

**Q1 · 配错了怎么撤？**
> 说"暂停 [任务名字]"暂时关掉，或"删除 [任务名字]"彻底删。必须 IDE 在前台才能改。

**Q2 · 跑失败怎么知道？**
> 看 IDE 通知中心 / 任务历史。也可以说"列出我的定时任务"查看所有任务状态，手动发现失败项。

**Q3 · 怎么知道下次什么时候跑？**
> 说 `/查我的定时任务` 或"列出我的定时任务"——会列每条任务的 next-run 时间。

**Q4 · 临时停几天能行吗？**
> 行。"暂停 [名字]" → 出差回来说"恢复 [名字]"——状态切回 ACTIVE。

**Q5 · cwds 工作区是什么？要填啥？**
> 任务执行时把哪个目录作为"当前工作区"。比如要跑 git 整理，cwds 必须是仓库目录。默认用当前激活的工作区，新人保持默认即可。

**Q6 · 换电脑要重新配吗？**
> ⚠️ **要**。任务定义存在本地客户端的 SQLite 库里（WorkBuddy 端为 `~/.workbuddy/workbuddy.db`），**不会跨设备同步**，且不应手动拷库。换机器请在新机器重走一遍配置流程。

**Q7 · 跑一次成本大概多少？**
> 跟你日常对话同价（按你账号选用的 LLM 计费）。低频任务（每月/每周）成本可忽略；如果做高频任务（每分钟/每小时），先估算月成本再开。

**Q8 · 我用 Cursor / Claude Desktop / Codex CLI / 其他工具，也能用吗？**
> ❌ 不能。`automation_update` 是 CodeBuddy 系列客户端的内置工具，**不在其他 IDE/CLI 中提供**。

**Q9 · 我配了好几个任务，到点却只推了一个，为什么？**
> 大概率是**多个任务撞在同一分钟**了（比如都设 10:30）。定时任务复用同一个会话跑，同一时刻只能跑一个，撞车时其余会被静默跳过（不补跑）。解法很简单：**把它们错开几分钟**（10:30 / 10:35 / 10:40）即可。说一句「把我的任务错峰一下」我就帮你查 + 自动改开。详见 §四点五。

### 0.5.5 进入下一步

讲完上面 FAQ 后，问用户：

> 想从哪开始？
> ① **挑一个模板试试**（推荐第一次） → 进 §三
> ② **我有自己的想法，从零问 7 个问题攒一个** → 进 §四

### 0.5.6 老用户快速通道（v5.8 修正 · 隐性死角修复）

> **场景**：用户**只输入"定时任务"4 个字**（或类似简短表达，无后续上下文）。

按以下顺序判断：

```
Step A · 用户偏好探活
   读 ~/.workbuddy/skills/daily-routine-builder/user-prefs.json
   有 fast_path=true 或已有 ≥1 个 active 任务 → 判为「老用户」

Step B · 老用户走快速通道
   跳过 §零点五 整段 FAQ
   直接：
   ┌──────────────────────────────────────────┐
   │ 你想：                                    │
   │ ① 列出我现在所有定时任务                 │
   │ ② 新建一个（直接进模板菜单 §三）          │
   │ ③ 暂停 / 恢复 / 删除某个任务（说名字）   │
   │ ④ 看看新手指南（FAQ）                     │
   └──────────────────────────────────────────┘

Step C · 新用户走 §零点五 完整 FAQ
   按原流程
```

**判别规则**：

| 信号 | 判定 |
|---|---|
| user-prefs.json 不存在 / `fast_path` 字段缺失 | 新用户 |
| user-prefs.json `fast_path: true` | 老用户 |
| `automation_update mode=list` 返回 ≥1 个 active 任务 | 老用户（自动判，无需 prefs） |
| 用户输入含"第一次/新手/小白/不会用" | 强制新用户路径，忽略 prefs |
| 用户输入含"快/直接/我会用" | 强制老用户路径 |

**首次升级触发**：用户成功创建第 1 个任务时，自动写 `fast_path: true` 到 user-prefs.json。

---

## 一、定位与边界

### 是什么
- **定时任务的配置器与教练**。负责引导用户，生成结构化参数，再调用 `automation_update` 工具落库。

### 不是什么
- ❌ 不是调度引擎本身（调度由平台内置的 `automation_update` 工具完成）。
- ❌ 不是业务执行器（具体业务逻辑由各自的 skill / prompt 自行表达）。
- ❌ 不强制启动、不自动注册、不在用户没提的情况下主动弹出菜单。

### 核心价值主张
> 用户痛点不是"没有调度"，是"**不知道能调度什么 + 不会写 RRULE**"。本 skill 同时解决这两个洞。

---

## 二、何时触发

### 必须触发
用户消息中出现以下关键词、且语境是要"配置/查看/暂停/恢复/删除"定时任务：
- 中文：`定时任务`、`每日推送`、`自动跑`、`每天提醒`、`每周/每月跑一次`、`定时管家`、`日常自动化`
- 英文：`scheduled task`、`automate this`、`daily routine`、`cron`、`recurring task`
- 命令式：`/定时任务`、`/daily-routine`

### 不要触发
- 用户只是闲聊提到"每天"作为时间状语（例："我每天都会喝咖啡"）。
- 用户在用其他业务 skill，没有提调度类关键词。
- 首次见面、问候、无关上下文。

### 触发后的第一步（v5.6 修正 · 新手分流）

按以下顺序处理：

#### Step 1 · 探活（§零）

先按 §零 探活 `automation_update` 工具是否可用。失败按 §0.2 文案引导，**不要硬跑**。

#### Step 2 · 是否新手

判断当前用户是否**首次**进入定时任务能力：
- 信号：本会话之前没用过本 skill / 用户问"定时任务能干啥" / 用户表达不确定（"我没用过这个"）
- **是新手** → 走 **§零点五 新手第一次使用**：先解释"这是什么"+"会发生什么"+"FAQ"，再问"模板 OR SOP"
- **不是新手**（直接说"再给我配一个 X 任务"）→ 跳过新手向导，直接走下面 Step 3

#### Step 3 · 老用户的二选一

> "想配一个会自动跑的任务？我可以从现成模板里挑（推荐），也可以从零问你 6 个问题攒一个。要从哪条进？"

只有用户确认要配，才进 §三 / §四。

---

## 三、入口 ①：模板菜单（推荐给"不知道要啥"的用户）

### 流程
1. 把 `templates/index.md` 里的模板分类展示给用户。
2. 用户挑一个或多个。
3. 读取对应模板文件（`templates/<template-id>.md`），里面已经写好：
   - `prompt`（任务描述）
   - `rrule`（频率）
   - `defaultName`（自动化名称模板）
   - 需要用户补的占位符（如 Webhook、部门、姓名等）
4. 把占位符问清楚（**一次问完，不要碎问**）。
5. 🔴 **必问通知渠道**（凡是"产出报告/清单/播报"类模板，不允许跳过这一步）—— 见 §三点五。
6. 复述一遍最终参数让用户确认。
7. 调 `automation_update` mode=`create` 落库。
8. 反馈结果（含 automation id、下次触发时间预估、暂停/删除方式、**结果会发到哪**）。

### 三点五、通知渠道（🔴 CRITICAL · 本 skill 所有定时任务一律强制配 webhook）

> **🔴 铁律（不可跳过、不可默认）**：本 skill 创建的**每一个定时任务**，落库前都**必须**让用户设置推送方式——即**必须拿到一个具体的群机器人 Webhook**。
> **严禁**出现"只在对话窗口看、不配 webhook"就静默建好任务的情况。
>
> **背景**：定时任务到点跑完，结果默认只在当前 IDE / WorkBuddy 对话窗口输出——人不在电脑前就看不到，等于白跑。所以本 skill 把"配 webhook"定为**所有任务的硬性前置**，而非可选项。

**判别：本次任务要不要问通知渠道？**

| 任务性质 | 要问吗 |
|---|---|
| **任何**定时任务（报告/清单/播报/汇总/提醒/喝水…全部）| ✅ **一律必问，必须拿到 webhook** |

> ⚠️ 旧版曾区分"报告类必问 / 提醒类可选"——**已废弃**。现在**不区分任务性质，全部强制配 webhook**。

**必问话术（原样输出，不要自行省略）**：

```
📨 创建前还差一步：这个任务跑完的结果要推送到一个企业微信群，请给我一个群机器人 Webhook：
  企微群右上角「…」→「群机器人」→「添加机器人」→ 复制 Webhook 地址发给我
  （形如 https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=... ）

💡 还没有群？建议专门建一个"我的定时任务"群再加机器人。
   暂时拿不到 webhook 的话，我们先把任务参数记下来，等你拿到地址再一句话创建。
```

**处理**：
- 用户给了 URL → 按 `references/notify-channel.md` §三在 prompt 末尾**追加推送指令段**（用 curl POST markdown_v2 到企微），URL 填进占位符，正常落库
- 🔴 用户暂时给不出 webhook → **不创建任务**，先复述并记下已收集的参数，告知"拿到 webhook 再来一句话即可创建"，**绝不降级成"只在对话窗口看"偷偷建好**
- ⚠️ **安全**：收到 webhook 后不要在对话里回显完整 URL（只说"已记录你的群机器人地址"）；详见 `references/notify-channel.md` §五

> 详细 webhook 申请步骤 + curl 推送格式 + 4096 字节限制 + 安全边界，见 `references/notify-channel.md`。

#### 🔴 多步/多板块任务：追加「可靠推送契约」（v6.2 新增）

当任务包含 **≥2 个各自取数的板块**（如招聘早班的「进度 + 待办」、漏斗月报的「漏斗 + 渠道 + 同环比」），除了 §三 推送段，还要 **Read `references/reliable-push-contract.md` §一，把「执行契约」整段注入任务 prompt**（逐板块降级 + 推送前自检门 + 推送失败重试）。这能防止「一块没取到就推半张表」。单步简单任务（提醒喝水类）无需注入。

#### ⏰ missed（漏跑）提示：早高峰任务必说一句（v6.2 新增）

定时任务靠**本机应用在触发那一刻在前台运行**来驱动——那一刻没开应用，这次就被跳过（不是云端 cron）。所以对**每天固定早高峰**（如 9:00）的任务，复述参数时按 `references/reliable-push-contract.md §2.1` 追加一句善意提示（建议挪到用户稳定在线时段，但不阻断创建）。并按 §2.2 让推送内容标题**自带日期戳 + 班次**（如 `🌅 6-17 周三 · 早班`），方便用户一眼识别哪天 missed 了。

### 模板维护
- 模板由模板维护者（通常是封装本 skill 的 agent 提供者）在 `templates/` 目录维护。
- 每个模板一个独立 markdown 文件，结构见 `references/template-format.md`。
- skill 不内置硬编码模板列表，只读 `templates/index.md` 作为入口。

---

## 四、入口 ②：自定义 SOP（推荐给"我有自己想法"的用户）

### 七问 SOP（一问一答，但允许用户一次性把多个答完）

| # | 问题 | 对应 automation 字段 | 校验规则 |
|---|------|---------------------|----------|
| 1 | 这个任务要做什么？（用一句话告诉我目标） | `prompt` | 不能为空，长度 ≥ 5 字符 |
| 2 | 多久跑一次？（一次性 / 每天 / 每周 / 每月） | `scheduleType` + RRULE 频率 | 必须四选一 |
| 3 | 几点触发？（HH:MM，可多个时间点） | RRULE `BYHOUR/BYMINUTE` 或 `scheduledAt` | 24 小时制；🔴 **不要和用户已有任务撞同一分钟**（见 §四点五 错峰铁律）|
| 4 | 周几或几号触发？（仅 weekly/monthly 问） | RRULE `BYDAY/BYMONTHDAY` | weekly 用 MO/TU/.../SU |
| 5 | 在哪个工作目录跑？（默认当前工作区） | `cwds` | 绝对路径，可多选 |
| 6 | 🔴 **推送 webhook 是多少？**（必须给一个企微群机器人地址）| 注入 `prompt` 推送段 | 见 §三点五；**所有任务强制必问、必须拿到 webhook** |
| 7 | 要设置生效起止日期吗？（可跳过） | `validFrom` / `validUntil` | ISO 8601 |

> 🔴 **第 6 问（通知渠道）不可省略、不可降级**——**本 skill 的每一个任务**都必须拿到一个具体的企业微信群机器人 Webhook 才能创建（话术 + 处理见 §三点五，细节见 `references/notify-channel.md`）。用户暂时给不出 webhook 时，**先记下参数、不创建任务**，等用户拿到地址再建——绝不静默降级成"只在对话窗口看"。

### 答完后
1. 把七个回答拼成完整参数对象，并展示给用户：
   ```
   📋 即将创建的定时任务
   名称   ：<自动生成或用户指定>
   类型   ：recurring / once
   RRULE  ：FREQ=...;BYHOUR=...;BYMINUTE=...
   描述   ：<prompt 摘要前 80 字>
   工作区 ：<cwds>
   通知   ：推送到企微群（已配 webhook · 必填项）
   有效期 ：<validFrom> ~ <validUntil>
   ```
2. 等用户回 `确认` / `调整 X` / `取消`。
3. 确认后调 `automation_update` mode=`create`。
4. 输出 §六 的成功反馈。

### RRULE 速查（生成时使用）

| 用户说法 | scheduleType | RRULE |
|---------|-------------|-------|
| 就跑一次，X 月 X 日 X 点 | `once` | 不填，用 `scheduledAt="YYYY-MM-DDTHH:MM"` |
| 每天 9 点 | `recurring` | `FREQ=DAILY;BYHOUR=9;BYMINUTE=0` |
| 每天 9 点和 18 点 | `recurring` | `FREQ=DAILY;BYHOUR=9,18;BYMINUTE=0` |
| 每周一 9 点 | `recurring` | `FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0` |
| 每月 1 号 9 点 | `recurring` | `FREQ=MONTHLY;BYMONTHDAY=1;BYHOUR=9;BYMINUTE=0` |
| 每小时（工作时段 9-18） | `recurring` | `FREQ=HOURLY;BYHOUR=9,10,11,12,13,14,15,16,17,18;BYMINUTE=0` |
| 每年 X 月 X 日 | `recurring` | `FREQ=YEARLY;BYMONTH=M;BYMONTHDAY=D;BYHOUR=H;BYMINUTE=0` |

---

## 四点五、🔴 错峰铁律：多个任务不要撞同一分钟（CRITICAL · v6.3 新增）

> **背景（实测踩坑）**：定时任务到点不是各开独立进程，而是**复用当前客户端的同一个会话**跑 agent 回合——**同一会话、同一时刻只能跑一个任务**。多个任务配在**同一分钟**（如都 10:30）触发时，调度器碰撞，**通常只跑成第一个，其余被静默跳过（不补跑）**，表现为「明明配了 3 个，只推了 1 个」。

### 创建/管理任务时必做的错峰检查

**任何时候要新建或改时间的任务，落库前必须：**

1. 先 `automation_update mode=list` 拉全部任务，看它们的 `rrule` 里 `BYHOUR;BYMINUTE`。
2. 如果新任务的触发分钟和**已有任意一个任务相同**（同 BYHOUR+BYMINUTE，且 BYDAY 有交集）→ **自动把新任务往后挪，错开 ≥5 分钟**（建议 5/10 分钟阶梯），并在复述参数时**主动告诉用户**："为避免和已有的『X 任务』撞同一时刻被挤掉，我把它放到了 HH:MM"。
3. 批量配多个任务时（如班次三件套 / 多个搜推），**彼此之间也要错峰**：第一个整点，后面每个 +5 分钟。

### 错峰示例（3 个原本都 10:30 的任务）

| 任务 | 撞车写法 | ✅ 错峰写法 |
|---|---|---|
| 面试待办 | `BYHOUR=10;BYMINUTE=30` | `BYHOUR=10;BYMINUTE=30` |
| 简历搜推 | `BYHOUR=10;BYMINUTE=30` | `BYHOUR=10;BYMINUTE=35` |
| 校招保温 | `BYHOUR=10;BYMINUTE=30` | `BYHOUR=10;BYMINUTE=40` |

### 边界说明（要跟用户讲清的）

- 错峰只解决「互相挤」；**它救不了「那一刻客户端没开机」**——automation 靠客户端在前台运行才触发，关机就整批 miss 且不补跑。两件事分开看。
- 不要试图「让平台同时并发跑多个」——那是和执行模型对着干，治标不治本。错峰是唯一稳的解法。

---

## 五、管理已有定时任务（必须支持的命令）

当用户消息匹配以下意图，进入管理流程：

| 用户说法 | 行为 | 实现 |
|---------|------|------|
| 查看 / 列出我的定时任务 | 列表展示 | `automation_update` mode=`list` |
| 暂停 / 停掉 X | 改状态为 PAUSED | mode=`update`, `status="PAUSED"` |
| 恢复 / 重启 X | 改状态为 ACTIVE | mode=`update`, `status="ACTIVE"` |
| 改时间 / 改频率 | 改 RRULE | mode=`update`, `rrule="..."` |
| 删除 / 删掉 X | 软删除 | mode=`delete` |
| 全部清空 / 一键删除全部 | 高危！必须列清单 + 二次确认 | 见下 |

### 高危操作铁律
- **删除前必须列出每一条要删的任务**（id、name、rrule），让用户看完确认。
- **绝对不允许用 `rm`、`sqlite3`、shell 命令操作底层 automation 数据库文件**。一律走 `automation_update` 工具。
- 用户说"清空全部"时，先 list → 展示 → 加粗警告"⚠️ 此操作不可逆" → 等待用户输入"我确认删除全部" 这种明确字串再继续。

---

## 五点五、招聘班次中心（弹窗批量选 · v6.0 新增）

> **触发场景**：用户问「**有什么定时任务**（能配）/ 招聘有什么定时任务 / 给我看看能配哪些招聘任务 / 招聘班次 / 三班次**」等"想看清单再挑"的表达。
>
> 与 §三模板菜单的区别：§三是**逐个文字列表**让用户自己念 ID；本节是**直接弹窗勾选**（招聘场景专属、开箱即用），用户勾完一次性批量配置。

### 5.5.1 何时走本节

| 用户说法 | 走哪 |
|---|---|
| "有什么定时任务可以选 / 能配哪些招聘任务" | ✅ 本节（弹窗） |
| "招聘班次 / 三班次 / 早午晚班" | ✅ 本节（弹窗） |
| "帮我配个 X 任务"（已明确要哪个） | §三 / §四（直接配，不弹窗） |
| "列出我现在的定时任务"（看已有的） | §五 list |

### 5.5.2 弹窗内容（用 AskUserQuestion 多选）

> 探活（§零）通过后，用 **AskUserQuestion（multiSelect=true）** 弹出下面这份**招聘预置任务清单**让用户勾选。选项 = 招聘班次三件套 + 招聘类常用模板：

| 选项（label） | 对应模板 ID | 默认频率 |
|---|---|---|
| 招聘早班·全景启动（进度+面试待办） | `recruit-shift-morning` | 工作日 9:00 |
| 招聘午班·面试冲刺（面评催办+下午准备） | `recruit-shift-noon` | 工作日 14:00 |
| 招聘晚班·对标复盘（进度对标+今日总结，周五战报） | `recruit-shift-evening` | 工作日 18:00 |
| 面试待办·今日播报 | `daily-interview-todo` | 工作日 9:00 |
| 每日简历搜推·新增推送（按预设画像搜简历，只推近 30 天新增） | `daily-resume-search` | 工作日 9:00 |
| 校招保温·今日播报 | `daily-recruit-warming-brief` | 工作日 9:00 |
| 招聘流程进度周报 | `weekly-process-pipeline` | 周一 9:00 |
| 招聘漏斗月报 | `monthly-recruit-funnel-report` | 每月 1 号 9:00 |
| ⚡ 一键配齐三班次（早+午+晚成套） | `recruit-shift-morning` + `noon` + `evening` | 9:00 / 14:00 / 18:00 |

> 选项描述里写清楚"这个任务跑完给你什么"，让用户不用看 ID 就能挑。**不要把所有模板都塞进弹窗**——本节只放招聘域，喝水提醒/晨报等通用模板仍走 §三。
>
> 💡 **「一键配齐三班次」快捷项**：用户勾这一项 = 一次性配早+午+晚三个班次（等价于同时勾前三行）。命中后直接展开成 3 个任务走批量流程，无需用户再逐个勾。

### 5.5.3 勾选后的批量配置流程

```
用户勾选 N 个
   ↓
① 一次性补齐共性参数（一个弹窗问完，不要每个任务碎问）：
   - 三班次的触发时间（默认 9/14/18，可改）
   - 🔴 通知渠道（§三点五 · 强制）：必须拿到一个企微群机器人 webhook（所有勾选的任务共用这一个 webhook 推送）；拿不到就先记参数、不批量创建
   - cwds 工作区（默认当前）
   ↓
② 复述：把 N 个任务的「名称 + 频率 + 推送方式」列成一张表给用户确认
   ↓
③ 用户确认 → 逐个调 automation_update mode=create
   - 每个任务带上模板里的 connectorIds（recruit-mcp）
   - 用户配了 webhook → 每个任务 prompt 末尾追加推送段（§三点五）
   - 命名按 §六，注意 list 去重避免撞名
   - 🔴 **错峰（§四点五铁律）**：勾选的多个任务**彼此不能撞同一分钟**，否则调度器碰撞只跑成一个。同一时段的任务自动 +5 分钟阶梯错开（如三班次本就 9/14/18 不撞；但若用户把多个都设到同一时刻 → 自动改成 HH:00 / HH:05 / HH:10 并告知）。同时也要和用户**已有**任务（先 list 查一遍）错开。
   ↓
④ 汇总反馈：✅ 已创建 N 个任务，列每个的 next-run（含错峰后的实际分钟）+ 暂停方式

### 5.5.4 边界

- **不替用户全选**：弹窗默认不勾任何项，让用户自己挑（避免一次性塞 7 个任务烧 token）
- **三班次建议成套**：用户只勾了早班时，可轻提示一句"午/晚班可一起配成完整一天，要加吗？"，但不强推
- **仍受 §-2.5 偏好约束**：用户设过 `disable_recommend_global=true` 时，不主动弹本窗，只在用户明确问"有什么定时任务"时才弹

---

## 六、命名规范（避免多用户/多场景撞车）

调 `automation_update` mode=`create` 时，`name` 字段按以下优先级生成：

1. 用户明确给名字 → 直接用。
2. 模板自带 `defaultName` → 用，但替换占位符。
3. 自动生成：`[场景关键词]-[频率简写]-[HHMM]`
   - 例：`晨报-Daily-0900`、`PR周报-Weekly-Mon-0900`、`月报-Monthly-01-0900`

避免：纯中文 + 括号、不带时间标识、和已有 automation 完全同名。

**冲突处理**：创建前先 `mode=list` 一遍。如果发现同名，按下列规则递增：
- 第一次撞名 → 追加 `-2`
- 第二次撞名 → 追加 `-3`
- 以此类推
- 不要直接覆盖已有任务（list 不会返回已 delete 的，但同名仍可能存在）。

### 六.5 用户偏好持久化（v5.8 新增 · `user-prefs.json` schema）

> 用于支撑：①「上下文推荐协议」§-2.5 中的"用户拒绝过 / 全局禁推"判定；②「老用户快速通道」§0.5.6 的判定。

**路径**：`~/.workbuddy/skills/daily-routine-builder/user-prefs.json`

**Schema**：

```json
{
  "schema_version": "1.0",
  "fast_path": true,
  "disable_recommend_global": false,
  "disable_recommend_for_capabilities": [
    "interview-assistant.T",
    "warming-recruit-manager.C"
  ],
  "first_task_created_at": "2026-06-10T10:30:00",
  "preferred_default_time": "09:00",
  "updated_at": "2026-06-10T10:30:00"
}
```

| 字段 | 含义 | 默认 |
|---|---|---|
| `schema_version` | 文件 schema 版本 | "1.0" |
| `fast_path` | 老用户标记，命中后跳过 §零点五新手 FAQ | 首次创建任务后自动设 true |
| `disable_recommend_global` | 全局关闭 §-2.5 上下文推荐 | false |
| `disable_recommend_for_capabilities` | 黑名单：这些能力不推荐 | [] |
| `first_task_created_at` | 第一次创建任务的时间（用于 ramp-up 策略） | null |
| `preferred_default_time` | 用户偏好的默认时间 HH:MM | "09:00" |
| `updated_at` | 最近一次更新 | now |

**写入时机**：
- 首次创建任务后：写 `fast_path=true` + `first_task_created_at`
- 用户说"以后别问 X"：将 X 加入 `disable_recommend_for_capabilities`
- 用户说"以后别再推荐定时任务"：设 `disable_recommend_global=true`
- 用户说"我习惯 8 点不是 9 点"：更新 `preferred_default_time`

**读取时机**：
- 每次进入本 skill 第一步（在 §0.5.6 路径判别前）
- agent §-2.5 推荐前（必读，用于自检 B 步骤）

⚠️ 文件不存在时**视为默认值**（新用户），不报错；写入失败时**警告但不阻断**主流程。

### 六.6 关键词判重（v6.1 新增 · 解决"已配过还重复推"）

> **背景**：实测用户名下历史定时任务**大多 `expert_id` 为空、`skills_json=[]`、name 五花八门**，
> 没有稳定的"模板ID"标记。因此 §-2.5 推荐前的"是否已有同类任务"判定，**只能靠任务 name 的业务关键词**，
> 不能靠 expert_id / skills_json / 模板ID。

**判重流程**（agent 在 §-2.5 自检 B-③ 执行）：
1. 调 `automation_update mode=list` 拉全部任务（含 PAUSED、含 expert_id 为空的历史任务）。
2. 把每条任务 `name` 跟下表关键词比对（**忽略大小写、忽略中英文混排**），任一命中即判"已有同类"。
3. 已有 → **不重复推荐**（防打扰）；list 失败/为空 → **保守不推**。

| 推荐模板 | 命中即"已有同类"的 name 关键词（任一） |
|---|---|
| `daily-interview-todo` | 待办、面试待办、今日面试、面试播报、招聘早班、招聘班次 |
| `weekly-process-pipeline` | 流程、流程跟踪、流程周报、process-pipeline、pipeline、聚焦清单 |
| `daily-recruit-warming-brief` | 保温、待入职、签约后、warming、欢迎话术 |
| `monthly-recruit-funnel-report` | 漏斗、转化率、招聘漏斗、funnel、渠道效果、招聘月报 |
| `monthly-contract-expiry` | 合同到期、合同、续签、contract-expiry |
| `daily-resume-search` | 简历搜推、每日简历、搜简历、简历推送、找简历、resume-search、找校招、找社招 |

> 🔴 本表是 agent §-2.5 B-1 表的**权威源**，两处必须保持一致；改动时同步改 `agents/recruitment-expert.md` §-2.5 B-1。

---

## 八、与 `automation_update` 工具对接的字段清单

每次调用都按这个 checklist 准备：

| 字段 | 必填 | 默认 / 说明 |
|------|------|------------|
| mode | ✅ | `create` / `update` / `view` / `list` / `delete` |
| name | ✅(create) | 见 §六 |
| prompt | ✅(create) | 来自模板或 SOP Q1 |
| scheduleType | ✅(create) | `recurring` 或 `once` |
| rrule | recurring 必填 | 见 §四速查 |
| scheduledAt | once 必填 | ISO 8601 |
| cwds | 可选 | 默认当前工作区，多个用逗号分隔 |
| validFrom | 可选 | ISO 8601 |
| validUntil | 可选 | ISO 8601 |
| status | update 时可改 | `ACTIVE` / `PAUSED` |
| connectorIds | 可选 | 执行时需激活的 MCP 连接器 id 列表 |
| expertId | 可选 | 执行时绑定的专家身份 |
| modelId | 可选 | 指定执行模型 |
| modelIsThinking | 可选 | 是否启用思考模式 |

---

## 九、输出风格规则（重要）

- **不要在 prompt 字段里塞调度信息**（不要写"每天 9 点"），调度由 RRULE 表达。
- **不要在 prompt 字段里写"如果没事就不输出"**，让任务在没事的时候自然不输出比强制写规则更可靠。
- **多板块任务推送内容标题自带日期戳 + 班次**（如 `🌅 6-17 周三 · 早班`），方便用户识别哪天 missed（见 `references/reliable-push-contract.md §2.2`）。
- **创建成功后给用户四件事**：①任务摘要 ②**结果会推到哪个群**（已配 webhook） ③如何暂停（说一句话即可） ④如何修改时间。
- **遇到不能自动决定的歧义**（如"提醒我吃饭"是 11:30 还是 12:00），明确问一次，不要替用户拍。
- 🔴 **所有任务创建前必须拿到 webhook**（§三点五），**严禁**默认"只在对话窗口"就静默创建；拿不到 webhook 就先记参数、不落库。

---

## 九、最小可行示例

### 示例 A：用户走模板入口
```
用户：帮我配每天 9 点的面试待办播报
↓
skill：从 templates/daily-interview-todo.md 加载模板
↓
skill：模板默认工作日 9:00，要不要改？webhook 推哪个群？
↓
用户：9 点就行，推到招聘协作群
↓
skill：复述参数 → 用户确认 → 调 automation_update create
↓
skill：✅ 已创建 [面试待办-Daily-0900]，下次触发：明早 9:00
       结果会推到：招聘协作群
       想暂停 → 说"暂停面试待办"；想改时间 → 说"面试待办改到 8:30"
```

### 示例 B：用户走 SOP 入口
```
用户：我想每周五下午 5 点让你帮我总结这周的提交
↓
skill：好，我从你这句话里已经能拼出大部分参数了，我复述一遍：
       任务：总结本周提交
       频率：每周五 17:00
       目录：当前工作区
       要不要补一个生效截止日期？（默认无限期）
↓
用户：默认就行
↓
skill：→ 调 automation_update create
       ✅ 已创建 [周提交总结-Weekly-Fri-1700]
```

---

## 十、文件结构

```
daily-routine-builder/
├── SKILL.md                       ← 本文件
├── scripts/
│   ├── track.sh                   ← 埋点上报
│   └── daily_resume_pick.py       ← ⭐ 每日简历搜推「自托闭环·只粗筛」脚本（方案B：搜1轮→按搜索字段粗筛→Top N，不走 zhaopin-* SOP、不点简历详情，防定时超时）
├── references/
│   ├── automation-fields.md       ← automation_update 字段全解
│   ├── rrule-cookbook.md          ← RRULE 常见组合速查
│   ├── notify-channel.md          ← ⭐ 通知渠道配置指引（企微群机器人 Webhook）
│   ├── reliable-push-contract.md  ← ⭐ 多步任务可靠推送契约（逐板块降级+自检门+重试+missed提示）
│   └── template-format.md         ← 模板文件格式规范
└── templates/
    ├── index.md                   ← 模板菜单（用户维护）
    ├── daily-resume-search.md     ← ⭐ 每日简历搜推（自托闭环·只粗筛，配 daily_resume_pick.py）
    ├── recruit-shift-morning.md   ← ⭐ 招聘早班·全景启动（强绑 recruit-mcp）
    ├── recruit-shift-noon.md      ← ⭐ 招聘午班·面试冲刺
    ├── recruit-shift-evening.md   ← ⭐ 招聘晚班·对标复盘
    └── *.md                       ← 其余各模板（用户维护）
```

> 💡 招聘班次三件套（recruit-shift-*）由 §五点五「招聘班次中心」弹窗批量配置；其余模板走 §三逐个选。

参考文件由 skill 在需要时按需读取，不要一次性全加载进上下文。
