# 面试助手 · S 面试安排子模块（S-Index/S-0/S-A/S-B/S-C/S-D/S-E）

> 子模块路径：`flows/S.md`  
> 触发：在主 SKILL.md 的 Router-0 命中本类目后，**第一件事是 Read 本文件**，再执行内部步骤。  
> 本文件由 v3.6 单文件 SKILL.md 拆分而来，原章节内容完整保留。

<!-- skill-tracker sub_flow: begin (auto-generated) -->

> 🚨 **FIRST ACTION（读到本文件第一件事 · MANDATORY · 静默执行）**：上报 `sub_flow_entered` 事件，标记本次进入了 **`S` 子流程（面试安排（约/改/取消/查日程））**。这是 v4.6 双轨埋点的精准维度——配合 SKILL.md 主 FIRST ACTION 的 `skill_invoked`，看板能拉出"哪个 sub_flow 用得最频繁"。

```bash
bash ./scripts/track.sh "0WEB06ZI7OVDOZQW" "interview-assistant" "sub_flow_entered" '{"session_id":"'"$(date +%s)"'","sub_flow":"S","sub_flow_name":"面试安排（约/改/取消/查日程）"}'
```

**约束**：每次读到本文件就执行一次（不要因为同会话内"刚跑过"就跳过）。静默后台，失败容忍，不询问用户。

<!-- skill-tracker sub_flow: end -->

---

## 场景 S：面试安排管理

**触发条件**：用户说"调整面试时间"、"改面试时间"、"取消面试"、"面试安排"、"我什么时候有空"、"查日程"、"接受候选人改期"等

> 🔴 **核心硬规则**：凡涉及面试安排（改时间/取消/查日程）的请求，**第一件事永远是先查下面这张「需求 → 路径 → API」总表**，对号入座选路径，再去看对应小节执行。**严禁**绕过路由表直接 SearchAPI 拼接调用。

> 🔴 **与场景 T 的区别**：
> - **场景 T**（面试待办）= 查询待办列表（只读）
> - **场景 S**（面试安排）= 对**已存在的**面试单据执行**写操作**（调整时间/取消）

---

### 🚫 S-Pre. 资格判定（v4.3 新增 · 优先级最高 · 进 S-Index 前必过）

> **本节修复的认知错误**：S 模块**只支持已经在面试中的候选人**：
> - **校招**：`flowStatus` ∈ {2,3,4,5,6}（集体面试/初试/复试/GM·EVP/HR面试）
> - **社招**：`statusText == "面试中"`
>
> 其他所有状态——包括"待筛选/已锁定/已分配/已淘汰/已放弃/offer 阶段/已录用"——都必须引导用户去候选人简历详情页操作（首次发起面试需要选择是否保密、回流、面试轮次、面试官、部门、岗位）。
>
> 🔴 **"发起面试" vs "面试安排" 概念边界（严格区分）**：
>
> | 动作 | 时机 | 需要选择 | 操作方式 |
> |---|---|---|---|
> | **发起面试** | 简历进入面试流程**之前**，每个候选人只做一次 | 是否保密、回流、面试轮次、面试官、部门、岗位 | 🚫 必须页面（无 API） |
> | **面试安排** | 已发起过面试，每轮都做（一面/二面/三面…） | 面试官、时间、形式 | ✅ 可走 S 模块（校招/社招都支持下单+改时间+取消；社招 change/cancel 2026-06-30 已上线） |
>
> 关键：**"面试安排"的前提是已经发起了面试**。S-Pre 资格判定不通过 = 还没发起 → 必须先去页面**发起**，不能直接进 S 模块"安排"。
>
> 旧版本误把"约 XX 面试 / 邀约 XX / 下个面试单"也归到 S-A 自动 `post_order_add`，是错误设计。

**进入 S 模块前必跑资格判定脚本**：

```bash
# 校招（默认）
python3 ~/.workbuddy/plugins/marketplaces/my-experts/plugins/txzhaopin/skills/interview-assistant/scripts/check_interview_eligibility.py \
    --type campus --rid <候选人rid>

# 社招
python3 .../check_interview_eligibility.py --type social --rid <候选人rid>

# 用户已明确告知状态时的离线判定
python3 .../check_interview_eligibility.py --type campus --flow-status 3
python3 .../check_interview_eligibility.py --type social --status-text 面试中

# 已经在前置步骤拉过简历详情 JSON
python3 .../check_interview_eligibility.py --type campus --resume-json $TMP_DIR/resume_raw.json
```

⚠️ **必须先确认招聘类型**：
- 校招进入路径：T 待办联动 / 从 `zhaopin-operations` 跳来 → `--type campus`
- 社招进入路径：从 `zhaopin-social-operations` 跳来 → `--type social`
- 未明确时反问 1 句："这是校招还是社招的候选人？"

> 🔴 **社招 RID 获取硬规则（v4.5 必读 · v4.9.4 实测补充）**：社招 todo 接口**不返回 GUID 格式的 rid**，只有 `employeeId`。但 `post_order_add` / 资格判定脚本都要 rid。
> - 从 T 待办联动来：`fetch_todos.py` 已经**自动反查并在输出末尾附「🔑 候选人 RID 索引」表**，直接读用即可
> - 单独场景（只有邮箱/手机号/employeeId 时）：用 `scripts/resolve_social_rid.py --email <邮箱>` 反查
> - **严禁**把 `employeeId` 当 `rid` 直接传给社招写接口——会报 500 "操作失败"
>
> ✅ **v4.9.4 实测确认（2026-06-30 · employeeId→rid 反查正解）**：实测一例社招待办候选人，反查 rid 的正确姿势：
> - 社招待办 `social-todo-center.get_api_trace_get_list` 只给 `employeeId`/`traceId`/`emailAddress`，`resumeUrl` 是 `?employeeId=xxx`（**不含 rid**）；简历详情接口又强制要 rid（鸡生蛋）。
> - ✅ **正解：直接跑 `scripts/resolve_social_rid.py --email <候选人邮箱>`**（实测一把返回正确 rid）。脚本内部用 `post_api_resume_query_query` + `email` 精确字段 + `locked/from/size/diggerSearchId` 过滤参数，返回 `rid`，并带 `ext_id`(==待办 employeeId 可校验)。
>   ```bash
>   python3 scripts/resolve_social_rid.py --email <候选人邮箱>   # → {"rid":"<GUID>","ext_id":"<==employeeId>",...}
>   ```
> - ⚠️ **手动直调 `post_api_resume_query_query` 时易踩坑**：必须传 `email` 字段（不是 keyword/candidateEmail/mail——那几个返回无关默认列表），且建议带 `locked:1`。**优先用脚本，别手搓参数。**
> - 邮箱来源：社招待办 `rows[].emailAddress`。**绝不可因为拿不到 rid 就用 employeeId 顶替下单。**

**脚本退出码与下一步**：

| 退出码 | 含义 | 下一步 |
|:---:|---|---|
| 0 | `eligible=true` | ✅ 继续走 S-Index → S-0 → S-B/C |
| 1 | `eligible=false` | 🚫 **直接展示脚本 stdout 的 `message` 字段给用户**（含简历页链接 + 状态原因），不进 S-0 |
| 2 | 输入错误（RID 非法 / JSON 解析失败 / 参数不匹配） | 反问用户 |
| 3 | MCP 调用失败 / 鉴权失败 | 走主 SKILL.md 的 MCP 自检引导 |
| 4 | RID 失效或无权访问 | 告知用户"该简历无权访问，请确认 RID" |

**校招白名单 vs 黑名单（v4.3 终版）**：

| 类别 | flow_status | 处理 |
|---|---|---|
| ✅ 可走 S | 2,3,4,5,6 | 集体面试/初试/复试/GM·EVP/HR面试 |
| 🟡 引导发起 | 0,1,16,17,22,23,8,13,27,31 | 待筛选/已锁定/已分配/项目锁定/各种放弃淘汰 |
| 🚫 拒绝操作 | 12,14,15,24,25,26,28,30 | 已录用/offer 阶段 |

**社招白名单（v4.3 终版）**：

| 类别 | statusText | 处理 |
|---|---|---|
| ✅ 可走 S | `面试中` | 唯一白名单 |
| 🟡 引导去页面 | 待筛选 / 推荐中 / 已淘汰 / 已入职 / 其他所有 | 全部去简历页 |

**API 子域分发表（v4.5 · 基于 recruit-mcp SearchAPI 实测 + 用户实测确认）**：

| 操作 | 校招 apiId | 社招 apiId | 备注 |
|---|---|---|---|
| 查待办 | `recruit.campus-center-front.get_campus_interview_todo_list` | `recruit.social-todo-center.get_api_trace_get_list`（flowId=3+extType=interview+done=false）⚠️ v4.9.4 修正：旧 `interview-arrange.get_my_interview_list` 已失效 | 路径不同，各取各的 |
| 查面试官日历（忙闲） | `recruit.interview-arrange.get_calendar_getCalendarInfo` | 同左 | 校招社招共用 |
| 拉简历详情 | `recruit.campus-resume-search.get_v1_mcp_resume_getResumeByRId` | `recruit.social-resume.get_api_resume_detail_getresume_with_detail` | 各自接口 |
| 下单（首次） | `recruit.interview-arrange-campus.post_order_add` | `recruit.interview-arrange.post_order_add` | 参数差异见 S-E2 |
| 查单据详情 | `recruit.interview-arrange-campus.get_order_detail` | `recruit.interview-arrange.get_order_detail` | 各自接口 |
| 查邀约单详情 | `recruit.interview-arrange-campus.get_order_invite_detail` | `recruit.interview-arrange.get_order_invite_detail` | 各自接口 |
| **改时间** | `recruit.interview-arrange-campus.post_order_change` | `recruit.interview-arrange.post_order_change` ✅(v4.9.4 上线) | 校社参数差异大，详见 S-B |
| **取消** | `recruit.interview-arrange-campus.get_order_cancel` | `recruit.interview-arrange.get_order_cancel` ✅(v4.9.4 上线) | 校社参数相同，详见 S-C |

> ✅ **关键事实更新（v4.9.4 · 2026-06-30）**：
> - 社招 `recruit.interview-arrange.*` 子域**现已新增 `post_order_change` + `get_order_cancel` 写接口**（旧版 v4.5 写的"社招无 change/cancel、只能去页面"**已废弃**）。
> - 社招改时间/取消**直接调对应接口**，不再引导用户去简历页。
> - ⚠️ 社招 change 参数与校招差异大（见 S-B 对比表）；社招 cancel 参数与校招相同（见 S-C）。
> - 历史背景：v4.4 曾试图用校招接口跨域操作社招单据（实测失败），v4.5 因此降级为"去页面"——现在社招有了自己的写接口，正式恢复 MCP 写路径。

> 🚨 **社招话术（v4.9.4 简化）**：用户说"安排面试/下单"时只走 S-A 下单；说"改时间/取消"时走 S-B/S-C 调社招对应接口即可。**不再需要**旧版那套"预防性提示社招不支持改时间"的话术。

**二元判断辅助表（仅用于"用户话术阶段"快速分流，最终判定一律走脚本 + orderId）**：

| 用户话术 | 是否进 S 模块 | 处理 |
|---|---|---|
| "发起面试" / "新建面试" / "推到面试" / "首面" / "进入面试环节" / "把 XX 推进到面试" | ❌ 不进 S | 这是"发起面试"（候选人首次进流程，要选保密/回流/轮次/面试官/部门/岗位），**直接给简历页链接**，不调任何 API |
| "约 XX 面试" / "安排面试" / "下个面试单" / "邀约 XX" / "安排今晚8点" / "约下周二" | ✅ 进 S | 这是"面试安排"（候选人已在面试流程中，给本轮选时间/形式/面试官）→ 跑资格判定脚本 → 通过后**走 S-A 下单**（orderId 通常=0 是正常的，不是异常）|
| "改 XX 面试时间" / "调整面试" / "取消面试" / "接受候选人改期" / "面试挪到 XX" | ⚠️ 跑脚本判定 | 退出码 0 才能进 S；通过后**走 S-B/S-C**（前提是 orderId>0 已有单据）；校招社招都走对应 change/cancel 接口（社招 v4.9.4 起已支持，参数见 S-B/S-C）|
| "我今天有空" / "下周二上午" / "查日程" / "帮我找空档" | ✅ 直接 S-0.5 | 纯查日程不涉及候选人，跳过资格判定 |

🔴 **常见误判修复（v4.5）**：

- ❌ **错**：用户说"安排今晚 8 点的吧" → agent 调待办找 orderId → 拿不到 → 误判走 S-B（改时间）→ 其实本轮还没下单，应走 S-A 首次下单
- ✅ **对**：用户说"安排今晚 8 点的吧" → 跑资格判定 → 通过后看 orderId
  - `orderId=0`（**最常见**）= 该候选人本轮还没下面试单 → 走 **S-A 下单**（首次为这一轮选时间/面试官/形式）
  - `orderId>0` 且 `stateId∈{2,3,4,7,8,9}` = 已有单据 → 走 **S-B 改时间**
- 关键区分：「**发起面试**」（候选人进流程，整辈子一次）≠「**首次安排面试时间**」（本轮第一次给时间，每轮都有一次）。这两个都可能让用户说"约一下"，但前者必须去页面、后者可走 S-A。S-Pre 资格判定通过 = 候选人已在流程中 = 可以走 S-A。

🚨 **执行硬约束**：
- 在 `check_interview_eligibility.py` 未跑、或返回 `eligible=false` 后，**禁止**任何 `post_order_add` / `post_order_change` / 任何 `interview-arrange*` 写接口调用
- **rid 严禁编造**：用户没给只能反问或先查 T 待办/搜简历定位
- 脚本返回的 `message` 字段已经按状态分类给出精准提示，**直接展示**，禁止改写

---

### 📑 S-Index. 全场景路由速查表（**必看**，每次进入 S 模块的第一站）

> ⚠️ 进入本表前**必须先过 S-Pre 资格判定**。下表只处理"已通过资格判定（校招 flowStatus ∈ {2,3,4,5,6} / 社招 statusText == 面试中）的场景"。
>
> 🔴 **重要：S-Pre 通过后，orderId=0 是【正常】状态**——意味着本轮还没下面试单（每轮都从 0 开始），应走 **S-A 首次下单**，不是异常。不要把 orderId=0 当成"没在面试流程"导致路由错。
>
> 🚨 **stateId=1 改时间（v4.9.15 修正 · 旧 v4.6"严禁 change"结论已纠正）**：
> - **change 在 stateId=1 下是可用的**——之前以为"stateId=1 严禁 change/会报 500"，实测坐实那其实是**漏传 `interviewType` 导致的兜底 500**（见 S-B 的 v4.9.15 根因），不是 stateId 限制。带全参数（尤其 `interviewType`）后 change 在 stateId=1 同样即时改成功。
> - 因此 stateId=1 改时间**两条路都行**：① `post_order_change`（带全 interviewType 等参数，推荐，即时改+可选通知候选人）；② `post_order_add` + `traceId` 覆盖时段（也可，但若之前误用过漏参 change 留了草稿，add 可能被判"已安排请勿重复"，需先 cancel 清）。
> - 进 S-B 前仍建议先 `get_order_detail` 读出原单 interviewType/interviewForm/placeType 照抄，避免漏参数。

**Step 1：根据用户的话术，定位需求类型**

| 用户说什么（典型话术） | 需求类型 | 跳到哪一节 |
|---|---|---|
| "我今天有空"、"明天下午随便"、"下周哪天有空"、"帮我找空档"、"查我日程" | **查日程** | → **S-0.5** |
| "约 XX 面试"、"安排面试"、"安排今晚 8 点"、"约下周二上午"、"下个面试单"、"邀约 XX" | **本轮首次安排时间** | → **S-0** 取 `orderId` → **多数 orderId=0 → S-A 首次下单**；少数 orderId>0 → 见 S-0 路由表 |
| "安排多对一"、"找几个人一起面 XX"、"几位面试官同时面"、"多个面试官一起约" | **多对一安排**（多面试官对 1 候选人）| → **S-MultiPanel**（手动收面试官名单 → 各查日历求共同空档 → interviewType=2 下单）；前提同样要先过 S-Pre + S-0 |
| "集体面试"、"群面"、"一场面几个学生"、"把这几个人一起面"、"安排个无领导小组" | **集体面试**（面试官对**多个**候选人，🔴 仅校招）| → **S-GroupPanel**（收多个候选人各过 S-Pre → 同一时段 interviewType=4 下单）；社招不支持，提示改单面/多对一 |
| "改 XX 的面试时间"、"调整 XX 面试到下周"、"把 XX 面试挪到 14:00"、"张三的面试改到周四" | **改已有单时间** | → **S-0** 取 `orderId/stateId` → **S-B**（注意 stateId=1 时的兜底，见 S-B 内部说明） |
| "取消 XX 的面试"、"撤销 XX 邀约" | **取消单据** | → **S-C** |
| "候选人改了时间，我要确认"、"接受候选人提出的新时间" | **接受候选人改期** | → **S-B**（`stateId=3`→`stateId=4`） |
| "候选人是海外的"、"美国时间"、"英国候选人"、**或简历显示在国外读书/工作** | **时差对照** | → **S-D**（下单/改期前必查；不只看 oversea 字段，简历地点信号也算，疑似海外先按 S-D.2 问面试官要不要考虑时差） |

**Step 2：所有写操作路径都强制先做 S-0 路由判断（除了纯查日程的 S-0.5）**

→ 直接进入下面的 S-0。

> 🔴 **如果到了这里你看到的是 orderId=0**：说明 S-Pre 资格判定该用户没通过却没拦住（异常情况），立即回退到 S-Pre 重跑脚本，**不要**走 S-A 自动下单。

---

### 🎯 S-0. 路由决策（每次进入场景 S 必须先做）

进入场景 S 时，**第一件事是确定走哪条路径**——通过 `keyword=候选人名` 调 `get_campus_interview_todo_list`，看 `list[].orderId` + `personList[0].orderStateId`（或单据详情的 `stateId`）：

| `orderId` 值 | `stateId` | 含义 | 走哪条路径 |
|:---:|:---:|---|---|
| **`0`** | — | 候选人**还没有面试安排单据** | 🚫 **回退到 S-Pre 出回复模板**（给简历页链接让用户自己发起，不调 API） |
| `>0` | `1` 待安排面试时间 | 单据已建但时段未落 | ⚠️ **S-B 的 stateId=1 兜底分支**（详见 S-B 内部说明） |
| `>0` | `{2,3,4,7,8,9}` | 已有时段，需调整或接受候选人改期 | **S-B 调整时间**（`post_order_change`） |
| `>0` | `{10,11}` | 面试已完成或已关单 | 🚫 不能再改，告知用户 |

**🔴 关键认知（v4.3 更正）**：
1. **"首次发起面试"不是 S 模块的能力**——orderId=0 意味着系统里还没有单据可以"改"，应该回退给页面链接，由用户在招聘平台手工发起。**不要再走"S-A 一步下单"**（旧版本设计有误）。
2. **`stateId=1`（待安排）是隐藏陷阱**：它有 orderId 但还没有有效时段，按字面应走 S-B，但 `post_order_change` 在此状态下会**误报"面试官时段冲突"**。具体兜底方法见 S-B 内部分支。

---

---

### 🗓️ S-0.5. 查面试官日程（用户说"我今天有空"/"帮我找空档"时必调）

> **触发条件**：用户给出的不是精确时间，而是模糊时段——"我今天有空的时间即可"、"下周二上午"、"明天下午随便"、"我不知道我啥时候有空"。
>
> **🔴 硬规则**：**不要查电脑本地 Outlook/Calendar.app/iCal**（即使有 skill 声称能读），必须走 MCP 接口，这是腾讯内部统一忙闲视图。

**接口**：`recruit.interview-arrange.get_calendar_getCalendarInfo`（GET，**校招面试官也可用**，实测 2026-05-09 验证过）

```bash
mcporter call recruit-mcp CallAPI \
  apiId='recruit.interview-arrange.get_calendar_getCalendarInfo' \
  params='{"staffName":"<当前操作人英文名>","date":"<yyyy-MM-dd>"}' \
  > $TMP_DIR/cal.json 2>&1
```

**返回结构**（关键字段）：
```json
{
  "data": {
    "data": {
      "Busy": [
        {"Owner": "<英文名>", "StartTime": "2026-05-11 10:30:00", "EndTime": "2026-05-11 11:15:00"}
      ],
      "Suggestion": []   // 系统推荐空档（通常为空，靠你自己算）
    }
  }
}
```

**Busy 列表的来源**（联合视图）：
- Outlook 日历事件（会议、锁定时间等）
- 腾讯面试系统已排面试（会按"面试开始 ~ 开始+时长"写入，校招/社招都进）

**空档计算建议**：
- 工作时间按 09:00-19:00 分段，挖掉 `Busy` 里的所有区间
- 下单最小颗粒度推荐 45/60 分钟，留 15 分钟缓冲
- 给用户**2-3 个候选时段**让他挑，不要直接塞进 S-A.2

**实战示例**（查本人今日日历）：
```bash
# 请求
params='{"staffName":"zhangsan","date":"2026-05-09"}'
# 响应 Busy=[09:00-09:05]
# 推荐给用户：今天 10:00-10:45 / 14:00-14:45 / 15:00-15:45 可选
```

**踩坑提示**：
- `staffName` 必须是**英文名 (RTX 账号)**，不是中文姓名
- `date` 格式严格 `yyyy-MM-dd`
- `Busy` 可能包含跨整天的锁定事件（如请假），不要自动切片
- 刚下的面试单**最多延迟 1-2 分钟**才会进 Busy（异步同步）
- 接口 schema 描述标注"社招场景"，但**校招也能用**（返回系统所有面试，不区分）

---

### 👥 S-MultiPanel. 多对一面试安排（多个面试官面同一候选人）

> **触发**：S-A.1 弹窗 Q3 选「多对一」，或用户直接说"安排个多对一 / 找几个人一起面 / 几位面试官同时面 XX"。
>
> **本质**：`interviewType=2`（多对一），一个 `post_order_add` 里塞**多个 `interviewers`**，候选人同一时段同时面对多位面试官。难点不在下单，在**怎么找到这几个面试官都有空的共同时段**。

#### S-MultiPanel.1 收集面试官名单（🔴 手动填写）

> 🔴 **面试官名单来源 = 用户手动填写**（本次确定的方案）。用 `AskUserQuestion` 或直接让用户列出，要到**每位面试官的英文名（RTX 账号）**。
>
> - 默认把**当前操作人本人**作为面试官之一（除非用户说自己不参加）。
> - 名单里**至少 2 人**才算多对一；只报 1 人 → 回退单面（S-A）。
> - 只收英文名，**禁止编造**；用户给中文名时要让用户确认对应的英文名（RTX），拿不到就反问，不能猜。

#### S-MultiPanel.2 求共同空档（对每位面试官各查一次日历，本地求交集）

> 🔴 `get_calendar_getCalendarInfo` **一次只能查一个人**（入参 `{staffName, date}`）。多对一要**对每位面试官各调一次**，再在本地把各自的 `Busy` 区间合并、求**共同空档**。

```bash
# 对名单里每一位面试官，按目标日期各查一次（示例 3 人）
for name in <英文名A> <英文名B> <英文名C>; do
  mcporter call recruit-mcp CallAPI \
    apiId='recruit.interview-arrange.get_calendar_getCalendarInfo' \
    params="{\"staffName\":\"$name\",\"date\":\"<yyyy-MM-dd>\"}" \
    > "$TMP_DIR/cal_$name.json" 2>&1
done
```

**共同空档算法**（agent 本地算，禁止编造时段）：

1. 工作时间窗口按 `09:00-19:00`。
2. 把**所有面试官**的 `Busy` 区间**并集**挖掉（任意一人忙 = 该时段不可用）。
3. 剩下的连续区间里，取 ≥ 面试时长（默认 45/60min）的段，留 15min 缓冲。
4. 给用户 **2-3 个所有人都空的共同时段**让他挑；**没有共同空档**就如实说"这几位在 X 日没有共同空档"，并建议换日期或减少面试官，**不要硬凑**。

> ⚠️ 边界：
> - 某位面试官当天**全天忙/请假**（跨整天 Busy）→ 共同空档必然为空，直接提示用户该面试官当天不可约。
> - 人越多共同空档越少，3 人以上常常约不到；可建议用户改"多轮一对一"(`interviewType=3`)分别约。
> - 🔴 **候选人若疑似海外**（见 S-D.1）：共同空档要落在**候选人当地的合理时间**，不能只顾面试官都有空却把候选人约到当地凌晨。先按 S-D.2 问面试官是否考虑时差，再在面试官共同空档里挑候选人当地也合理的段。

#### S-MultiPanel.3 下单（interviewType=2 + 多个 interviewers）

确定共同时段后，走 S-A.2 的 `post_order_add`，差异只有两处：

```bash
mcporter call recruit-mcp CallAPI \
  apiId='recruit.interview-arrange-campus.post_order_add' \
  params='{
    "interviewType": 2,
    "interviewForm": 4,
    "placeType": 3,
    "interviewPlace": "腾讯会议",
    "timeConfirmed": "false",
    "interviewers": [
      {"staffId": <A的staffId>, "staffName": "<英文名A>"},
      {"staffId": <B的staffId>, "staffName": "<英文名B>"},
      {"staffId": <C的staffId>, "staffName": "<英文名C>"}
    ],
    "candidates": [{"traceId": <flowTraceId>}],
    "interviewTimeList": [{"startTime": "<共同空档 start>", "endTime": "<共同空档 end>"}],
    "noticeType": {"wechatMp": true, "smsToCandidate": false, "emailToCandidate": true}
  }' > $TMP_DIR/order_add_result.json 2>&1
```

- 与单面唯一区别：`interviewType: 2` + `interviewers` 数组里**放全部面试官**。
- `staffId` 各面试官自己的；本人若也参加，把本人也列进去。
- 其余 500 处理、验证（S-A.5）、字段类型陷阱**与单面完全一致**，照 S-A 走。

> 🔴 **社招多对一**：社招 `post_order_add` 同样支持 `interviewType:2`，但 `interviewers`/`candidates`/`noticeType` 字段名按 S-E2 社招规则（candidates 用 `rid`、noticeType 用 outlook/weworkRobot 等、contacts 三件套必传）。日历查询接口社招校招共用，求交集逻辑相同。

---

### 👨‍👩‍👧‍👦 S-GroupPanel. 集体面试（interviewType=4 · 🔴 仅校招）

> **触发**：S-A.1 弹窗 Q3 选「集体面试」，或用户说"集体面试 / 一场面几个学生 / 把这几个人安排一起面 / 群面"。
>
> 🔴 **仅校招支持**（`recruit.interview-arrange-campus.post_order_add`，`interviewType=4`）。**社招没有集体面试**——社招用户提此需求时，告知"社招不支持集体面试，请改单面/多对一，或逐个安排"。
>
> **本质**：一个或多个面试官，在**同一时段**面**多个候选人**（群面/无领导小组等）。与「多对一(2)」的根本区别——
> - 多对一(2)：候选人 **1 个**、面试官多个 → `candidates` 长度 1
> - 集体面试(4)：候选人 **多个** → `candidates` 长度 ≥2

#### S-GroupPanel.1 收集候选人名单

> 🔴 每个候选人都要先各自过 **S-Pre 资格判定**（flowStatus ∈ {2,3,4,5,6}）。只把通过的纳入这一场集体面试；未通过的单独提示去页面发起。
> - 候选人 `traceId` 各取各的（每人待办里的 `personList[0].flowTraceId`）。
> - 至少 2 个候选人才算集体面试；只 1 人 → 回退单面 S-A。
> - 名单建议由用户确认（可用 `AskUserQuestion` 或让用户列出姓名，agent 从待办反查各自 traceId，**traceId 禁止编造**）。

#### S-GroupPanel.2 下单（interviewType=4 + 多个 candidates）

确定共同时段后（多候选人同一时段，时段确定方式同 S-0.5），走 S-A.2 的 `post_order_add`，差异在 `interviewType=4` + `candidates` 放**全部候选人**：

```bash
mcporter call recruit-mcp CallAPI \
  apiId='recruit.interview-arrange-campus.post_order_add' \
  params='{
    "interviewType": 4,
    "interviewForm": 4,
    "placeType": 3,
    "interviewPlace": "腾讯会议",
    "timeConfirmed": "false",
    "interviewers": [{"staffId": <面试官staffId>, "staffName": "<英文名>"}],
    "candidates": [
      {"traceId": <候选人A的flowTraceId>},
      {"traceId": <候选人B的flowTraceId>},
      {"traceId": <候选人C的flowTraceId>}
    ],
    "interviewTimeList": [{"startTime": "<yyyy-MM-dd HH:mm:ss>", "endTime": "<yyyy-MM-dd HH:mm:ss>"}],
    "noticeType": {"wechatMp": true, "smsToCandidate": false, "emailToCandidate": true}
  }' > $TMP_DIR/group_order_result.json 2>&1
```

- 与单面唯一区别：`interviewType: 4` + `candidates` 数组里**放全部候选人的 traceId**。
- 面试官可一个或多个（多面试官时 `interviewers` 也放多个，同 S-MultiPanel）。
- 其余字段类型陷阱（`timeConfirmed` 字符串、校招**不需要 contacts 三件套**）、500 处理、验证（S-A.5）**与单面完全一致**。
- ⚠️ 集体面试下单结构为按官方 `interviewType=4` 语义推导；**首次实跑后请把成功样例补回本节**（截至 2026-06-30 单面已实测、集体面试待实测确认 candidates 多人结构）。

#### S-GroupPanel.3 验证

逐个候选人刷待办（`get_campus_interview_todo_list` 按各自姓名 keyword），确认每人 orderId 都从 0 变为有效值、时段写入。

> 🔴 **海外/时差**：集体面试里若有海外候选人（见 S-D.1），同一时段很难同时照顾国内+海外候选人的当地作息——命中时按 S-D.2 提示用户"这一场里有海外候选人，统一时段可能对 ta 不友好，是否拆开单独约"。

### 🔥 S-A. 首次下单（orderId=0 时走这个，最常见路径）

> **2026-05-09 修正**：`post_order_add` 一次调用**可以同时落时段+发通知**，不需要再走 change。关键是 `interviewTimeList` 直接带进 add 参数即可。旧版 add+change 两步流程保留在 S-A-fallback 作为兜底（仅在一步下单返回 startTime 为空时使用）。

> 🔴 **校招 ≠ 社招参数（最易混淆，遇 500 前先认清自己在哪条线）**：本 S-A 用的是**校招** `recruit.interview-arrange-campus.post_order_add`：candidates 用 `traceId`、`timeConfirmed` 用**字符串**、有 `placeType`、**不需要 contacts 三件套**。社招（`recruit.interview-arrange.post_order_add`）才需要 contacts 三件套 + rid + 布尔 timeConfirmed，那套在 S-E2。**校招遇到 500 千万别去抄社招的 contacts 诊断。**

#### S-A.1 收集下单参数（🔴 用一个结构化弹窗一次问齐，禁止逐条追问）

> 🔴 **交互硬规则（v4.8 · 结构化收集）**：下单前需要用户拍板的参数，**必须用 `AskUserQuestion` 弹窗一次性问齐**，不要一条一条地用纯文字反复追问（散问体验差、容易漏项、还会拖长链路）。
>
> **能从数据自动带出的（不进弹窗）**：`flowTraceId`（待办 `personList[0].flowTraceId`）、候选人姓名（待办 `name`）。这些 agent 自己取，**不要问用户**。
>
> 🔴 **海外/时差识别（进弹窗前先跑 S-D.1）**：在弹出本收集弹窗**之前**，先按 **S-D.1** 判定候选人是否"疑似海外"（不只看 `oversea` 字段，还看简历的在读/在职地点）。命中则按 S-D.2 先问面试官"要不要考虑时差"，确认要考虑后，时段建议就以候选人当地合理时间为准。**不要等下完单才发现约在候选人当地凌晨。**
>
> **需要用户拍板的（进同一个弹窗，一次问完）**：

```
AskUserQuestion（把下列问题放在同一次调用里）：
  Q1 面试方式：腾讯会议(4，默认) / 现场(1) / 电话(2) / web版面呗(5)
       🔴 第4项是「web版面呗」(呗=口字旁+贝，bei)，⚠️ 切勿打成形近错字「web版面呕」(呕=口字旁+区，ou，呕吐的呕)——实战出现过该错字
  Q2 面试时长：45分钟(默认) / 30分钟 / 60分钟
  Q3 面试类型：单面(1，默认) / 多对一(2，多个面试官面同一候选人) / 多轮一对一(3) / 集体面试(4，仅校招，一/多面试官面多个候选人)
       → 选「多对一」立即转 S-MultiPanel（收集多个面试官 + 求共同空档）
       → 选「集体面试」立即转 S-GroupPanel（仅校招；收集多个候选人 + 同一时段一场面）
  Q4 时间确认 & 通知渠道：
       · 未确定时间，候选人可反馈调整(timeConfirmed=false，默认) / 时间已和候选人谈好(true)
       · 通知渠道：微信公众号(默认开) / 候选人邮件(默认开) / 候选人短信(默认关)
```

> 🔴 **面试类型概念区分（勿混淆 2 与 4）**：
> - **多对一 (2)**：多个面试官 → **1 个**候选人。校招社招都支持。见 S-MultiPanel。
> - **集体面试 (4)**：一个或多个面试官 → **多个**候选人（一场同时面多人）。**仅校招支持，社招不支持**。见 S-GroupPanel。
> - 关键差异：2 是"候选人 1 个、面试官多个"；4 是"候选人多个"。candidates 数组长度不同。

> 🔴 **弹窗选项文案口径（v4.9.1 · 必须照此显示，勿写回旧文案）**：
> - `interviewForm=5` 的显示名是 **「web版面呗」**（不要再写「腾讯会议面呗」）。🔴 **是「呗」(bei，口+贝) 不是「呕」(ou，口+区，呕吐的呕)**——实战弹窗出现过"web版面呕"错字，生成弹窗时务必写对这个字。
> - `timeConfirmed=false` 的显示名是 **「未确定时间，候选人可反馈调整」**（不要再写「让候选人确认时间」）。
> - `timeConfirmed=true` 的显示名是 **「时间已和候选人谈好」**。

> **面试时段为什么不进弹窗**：时段要么用户已给精确时间，要么用户说"我今天有空/明天随便"——后者必须先跑 **S-0.5** 查面试官日历给 2-3 个**真实**空档让用户挑（🔴 **禁止查本机 Outlook/Calendar.app**）。所以时段单独走 S-0.5，不塞进这个弹窗。
>
> **弹窗默认值**：方式=腾讯会议 / 时长=45 / 类型=单面 / 确认方式=未确定时间(候选人可反馈调整) / 通知=微信+邮件开、短信关。用户没改就用默认，改了就覆盖。
>
> ⚠️ 弹窗**只负责收集**，收集完仍要走 S-A.2 的实际下单（弹窗不替代 API 调用）；下单成功/失败结果照常反馈用户。

**参数来源速查**（弹窗 + 自动带出汇总）：

| 参数 | 来源 | 示例 |
|---|---|---|
| `flowTraceId` | 待办 `personList[0].flowTraceId`（自动） | `3941370` |
| 候选人姓名 | 待办 `personList[0].name`（自动） | 张同学 |
| 面试方式 | 弹窗 Q1，默认 4=腾讯会议 | `4` |
| 面试时长 | 弹窗 Q2，默认 45 分钟 | `45` |
| 面试类型 | 弹窗 Q3，默认 1=单面（选 2 转 S-MultiPanel） | `1` |
| 时间确认 / 通知 | 弹窗 Q4，默认"未确定时间，候选人可反馈调整" + 微信/邮件开 | — |
| 面试时段 | 用户给精确时间，或走 **S-0.5** 查日历挑空档（**不进弹窗**） | 5/11 10:00-11:00 |
| 是否海外/时差 | `oversea` 字段 + 简历在读/在职地点（自动，见 S-D.1）→ 疑似海外先按 S-D.2 问面试官 | 在美读研 → 问"要按时差约吗" |

#### S-A.2 🚀 一步下单（推荐，实测 2026-05-09 验证）

**一次调用 `post_order_add` 即可：① 创建单据 ② 落时段 ③ 发通知**。关键：参数里**必须**带 `interviewTimeList` 和 `timeConfirmed`。

> 🔴 **500 错误处理硬规则（v4.9 · 校招/社招分开诊断 —— 不要混用！）**：
>
> ⚠️ **本节是校招章节（`interview-arrange-campus.post_order_add`，candidates 用 `traceId`）。校招的 500 诊断与社招完全不同，下面分开列，禁止把社招的 contacts 诊断套到校招上。**
>
> **`post_order_add` 返回 `code:500` 的通用三类（校招社招都适用）**：
>
> | 错误信息 | 含义 | 处理 |
> |---|---|---|
> | "**面试时间离现在太近啦，请预留 1h 以上的时间给候选人确认哦**" | 时间太近被风控拦截 | 改到 ≥ 当前时间 + 1h 的时段，重试 1 次 |
> | "**XX 跟该候选人 YY 已有一场面试邀约，请勿重复安排哦**" | 已有未关单的邀约（业务错误，data 字段会返回已存在的 orderId） | 直接告知用户已存在邀约 + orderId，不要重复下单 |
> | 其他具体业务文案（"账号无权限"/"流程已关单"等） | 业务校验失败 | 把 message 透传给用户 + 简历页链接，**不要继续重试** |
> | "**操作失败，请联系HR业务运维**"（兜底无具体信息） | 后端在处理阶段崩了 | **校招看 ①、社招看 ②，诊断不同** |
>
> **① 校招"操作失败"兜底（本章节场景）**：
>
> - 🔴 **校招 `post_order_add` 不需要 contacts 三件套**（`contacts`/`contactsId`/`contactType` 是**社招专属**的 de-facto 必传，校招接口没有这组字段，加了也没用）。**遇到校招兜底 500，绝对不要去"核对/增删 contacts 三件套"，那是社招的坑，套到校招上纯属浪费轮次。**
> - 校招参数面其实很简单（见 S-A.2 示例）：`interviewType / interviewForm / placeType / interviewPlace / timeConfirmed(字符串) / interviewers / candidates[].traceId / interviewTimeList / noticeType`。先快速核对：`traceId` 是否来自待办 `personList[0].flowTraceId`（非 0）、`timeConfirmed` 是否传的是**字符串** `"false"`、时段是否 ≥ 当前 +1h。
> - 上述都没问题仍返回兜底"操作失败" → **十有八九是后端 OrderService 对该候选人/流程数据组合崩了**（与参数无关，和社招 L887-905 记录的同源问题）。**立即早止损**：不要再换 timeConfirmed 类型、不要加社招字段、不要逐个候选人重试。
> - **批量场景（如本 case 5 个同类候选人连续兜底）**：第 2 个候选人还兜底 = 几乎可断定是这条线路的服务端共性 bug → **直接整批走页面手工下单兜底**（给排期表 + 简历页操作指引），不要再逐个试。
> - 保留 requestId 仅作记录；**不主动**建议用户找 HR 业务运维（费时且大概率拿不到具体原因）。
>
> **② 社招"操作失败"兜底**：见 S-E2 社招章节（L389 起的 contacts 三件套诊断**仅适用于社招**）。

```bash
mcporter call recruit-mcp CallAPI \
  apiId='recruit.interview-arrange-campus.post_order_add' \
  params='{
    "interviewType": 1,
    "interviewForm": 5,
    "placeType": 3,
    "interviewPlace": "腾讯会议",
    "timeConfirmed": "false",
    "interviewers": [{"staffId": <你的staffId>, "staffName": "<你的英文名>"}],
    "candidates": [{"traceId": <flowTraceId>}],
    "interviewTimeList": [{"startTime": "<yyyy-MM-dd HH:mm:ss>", "endTime": "<yyyy-MM-dd HH:mm:ss>"}],
    "noticeType": {"wechatMp": true, "smsToCandidate": false, "emailToCandidate": true}
  }' > $TMP_DIR/order_add_result.json 2>&1
```

**📌 默认行为（除非用户明确覆盖）**：
- `timeConfirmed: "false"` → 未确定时间，候选人可反馈调整（**默认**；弹窗显示名「未确定时间，候选人可反馈调整」）
- `noticeType.wechatMp: true` → 微信通知（**默认发送**）
- `noticeType.emailToCandidate: true` → 邮件通知（**默认发送**）
- `noticeType.smsToCandidate: false` → 短信通知（**默认不发**，避免打扰）

**用户覆盖规则**：
| 用户说 | 调整 |
|---|---|
| "时间已确认" / "候选人都说好了" | `timeConfirmed: "true"` |
| "不要通知" / "别发邮件" | 对应 `noticeType` 字段改 `false` |
| 未提及 | 保持以上默认 |

**期望返回**：`{"code":"200","message":"OK","success":true,"data":true}` · `durationMs ≈ 3000-8000ms`（后端在发通知）

**关键参数说明**（实测会踩的坑）：
- `timeConfirmed` 值必须是**字符串** `"true"` / `"false"`，传布尔值会静默失败
- `candidates` 里用 `traceId`（来自待办 `personList[0].flowTraceId`），不是 `flowId`/`resumeId`
- `interviewTimeList` 只传**1 个时段**（多时段系统不会让候选人多选，只会用第一个）
- `placeType=3`（自定义地点）+ `interviewPlace="腾讯会议"` → 系统不会自动生成会议号；若要系统自动生成会议号，用 `placeType=2`

> ✅ **校招下单成功实测样例（2026-06-30）**：上面这套参数（`interviewType:1` / `interviewForm:4` / `placeType:3` / `timeConfirmed:"false"`(字符串) / `interviewers:[{staffId,staffName}]` / `candidates:[{traceId}]` / `interviewTimeList` 单时段 / `noticeType` 校招三字段）**未带任何 contacts 三件套，`code:200 success:true` 一把过**（orderId 0→<单号>，626ms）。再次确认：**校招 `post_order_add` 不需要 contacts 三件套**（那是社招的 de-facto 必传）。校招遇兜底 500 时不要去增删 contacts。

**🟢 一步下单成功标志（必须全部满足）**：
1. `success=true` / `code=200`
2. 用 `get_order_detail`（`id` 传**字符串**）验证：`startTime`/`endTime` 非空

> ⚠️ 若 `get_order_detail` 显示 `startTime` 为空 → 走 S-A.4 兜底


#### S-A.3 拿到新 orderId

立刻刷一次待办：

```bash
mcporter call recruit-mcp CallAPI \
  apiId='recruit.campus-center-front.get_campus_interview_todo_list' \
  params='{"pageIndex":1,"pageSize":20,"keyword":"<候选人姓名>"}' \
  > $TMP_DIR/todo_after_add.json 2>&1

python3 -c "
import json, re
raw = open('$TMP_DIR/todo_after_add.json').read()
m = re.search(r'\{.*\}', raw, re.S)
data = json.loads(m.group(0))
for item in data['data']['data']['list']:
    print('orderId:', item.get('orderId'), '| stepName:', item['personList'][0].get('stepName'))
"
```

`orderId` 应从 `0` 变成 7 位数字（如 `2515125`）。

**如果一步下单（S-A.2）已成功（`startTime` 非空、`stateText="首次邀约，待候选人确认"`），直接跳到 S-A.5 验证即可，不用再走 S-A.4**。

#### S-A.4 🔧 补落时段（一步下单后 startTime 为空时使用）

> 使用时机：S-A.2 返回 `success=true` 但 `get_order_detail` 显示 `startTime` 为空时。

**✅ 优先用 `post_order_change`**：

```bash
# 注意参数类型：id=整数，isConfirmTime=布尔值（不是字符串！）
mcporter call recruit-mcp CallAPI   apiId='recruit.interview-arrange-campus.post_order_change'   params='{
    "id": <orderId_整数>,
    "isConfirmTime": false,
    "interviewTimeList": [{"startTime": "<yyyy-MM-dd HH:mm:ss>", "endTime": "<yyyy-MM-dd HH:mm:ss>"}],
    "interviewForm": 5,
    "placeType": 3,
    "noticeType": {"wechatMp": true, "smsToCandidate": false, "emailToCandidate": true}
  }' > $TMP_DIR/change_result.json 2>&1
```

**关键参数类型（`post_order_change` vs `post_order_add` 不同！）**：

| 参数 | `post_order_add` | `post_order_change` |
|---|---|---|
| 确认时间字段名 | `timeConfirmed` | `isConfirmTime` |
| 字段类型 | **字符串** `"true"`/`"false"` | **布尔值** `true`/`false` |
| `id` 类型 | 不需要 `id` | **整数**（不是字符串） |

**如果 `post_order_change` 失败**（如返回 500 且 message 表明订单状态不允许修改），再走取消重排兜底：

```python
# Step 1: 取消原单（需要 staffName 参数）
import subprocess, json
cancel_params = {
    "id": "<orderId_字符串>",
    "reason": "时间调整，重新邀约",
    "isSilence": False,
    "staffName": "<你的英文名>"
}
r = subprocess.run(
    ["mcporter", "call", "recruit-mcp", "CallAPI",
     "apiId=recruit.interview-arrange-campus.get_order_cancel",
     f"params={json.dumps(cancel_params)}"],
    capture_output=True, text=True
)
# 验证 cancel 成功: code=200, message="OK"

# Step 2: 重新发起邀约（timeConfirmed=false，未确定时间候选人可反馈调整）
add_params = {
    "interviewType": 1,
    "interviewForm": 5,
    "placeType": 3,
    "interviewPlace": "腾讯会议",
    "timeConfirmed": "false",
    "interviewers": [{"staffId": <你的staffId>, "staffName": "<你的英文名>"}],
    "candidates": [{"traceId": <flowTraceId>}],
    "interviewTimeList": [{"startTime": "<yyyy-MM-dd HH:mm:ss>", "endTime": "<yyyy-MM-dd HH:mm:ss>"}],
    "noticeType": {"wechatMp": true, "smsToCandidate": false, "emailToCandidate": true}
}
r2 = subprocess.run(
    ["mcporter", "call", "recruit-mcp", "CallAPI",
     "apiId=recruit.interview-arrange-campus.post_order_add",
     f"params={json.dumps(add_params, ensure_ascii=False)}"],
    capture_output=True, text=True
)
```

**关键认知**：
- `post_order_change` **能直接用**，之前 500 是因为 `isConfirmTime` 传了字符串 `"false"` 而不是布尔值 `false`
- `id` 在 `post_order_change` 里是 **integer**，在 `get_order_detail` 里是 **字符串**（两个接口不一样！）
- 只有 `post_order_change` 返回业务错误（如"单据已取消"）时才走取消重排


#### S-A.5 验证落地

```bash
# 注意：id 必须是字符串类型，数字会报 TYPE_MISMATCH
mcporter call recruit-mcp CallAPI \
  apiId='recruit.interview-arrange-campus.get_order_detail' \
  params='{"id":"<orderId>","staffName":"<英文名>"}' \
  > $TMP_DIR/verify.txt 2>&1
# 一步下单后期望：stateId=1, stateText="首次邀约，待候选人确认", startTime/endTime 非空
# 老版 add+change 两步后期望：stateId=9, startTime 非空, onlineInfo.wemeetCode 非空（仅当 placeType=2 时腾讯会议自动生成）
```

---

### S-B. 调整已有单据的面试时间（orderId>0）

> 🔴 **进入 S-B 的前置条件（v4.5 防误判）**：
> 1. **用户话术明确是"改/调整/取消/接受改期/挪到"等词** — 不能用 "约/安排/下单/邀约" 类话术进 S-B（那些应走 S-A）
> 2. **且 orderId>0**（已有单据）— orderId=0 必须回退到 S-A，不是 S-B
> 3. **不能因为找不到 orderId 就反推"用户在改时间"**——找不到 orderId 大概率是因为本轮还没下单，应走 S-A

**场景**：
- 候选人主动改时间后，你需要接受（`stateId=3 → stateId=4`）
- 你需要改自己之前下的时间（任何 `stateId∈{2,3,4,7,8,9}`）

> ✅ **社招改时间已支持（v4.9.4 · 2026-06-30 接口上线）**：社招子域现已有独立写接口 `recruit.interview-arrange.post_order_change`（POST），**不再需要引导用户去页面**。旧版"社招无 change API、只能去简历页"的约束**已废弃**。
>
> 🔴 **社招 change 参数与校招 change 差异大，务必用社招 schema，别套校招**：
>
> | 维度 | 校招 `interview-arrange-campus.post_order_change` | 社招 `interview-arrange.post_order_change` |
> |---|---|---|
> | required | id / **isConfirmTime** / interviewTimeList / interviewForm / **placeType** | id / interviewForm / interviewTimeList / **period** |
> | 确认时间字段 | `isConfirmTime`(bool, required) | `timeConfirmed`(bool, optional) ⚠️**字段名不同** |
> | 地点 | `placeType`(required) | **无 placeType**；用 `needMeetingRoom`(bool) + `interviewPlace`(自定义地点) |
> | 会议室 | cityId/buildingId/floorId/roomId | 同左，但 `needMeetingRoom=true` 时这 4 个**必填** |
> | noticeType | wechatMp / smsToCandidate / emailToCandidate | **outlook / weworkRobot / emailToCandidate / miniRobotToCandidate** |
> | staffName | de-facto 必传 | **明确必填**（请求参数区标"是"）|
> | 社招独有 | — | `changeTraceOwner`(改待办处理人) / `outlookReceiver` / `mailMessageForInterviewer` |
>
> **社招 change 下单骨架**（线上腾讯会议、单时段、不订会议室）：
> ```bash
> mcporter call recruit-mcp CallAPI   apiId='recruit.interview-arrange.post_order_change'   params='{
>     "id": <orderId_整数>,
>     "interviewForm": 4,
>     "period": 60,
>     "timeConfirmed": false,
>     "needMeetingRoom": false,
>     "interviewPlace": "腾讯会议",
>     "interviewTimeList": [{"startTime": "yyyy-MM-dd HH:mm:ss", "endTime": "yyyy-MM-dd HH:mm:ss"}],
>     "noticeType": {"outlook": true, "weworkRobot": true, "emailToCandidate": true, "miniRobotToCandidate": false}
>   }' > $TMP_DIR/social_change.json 2>&1
> ```
> - `id`=整数（同校招 change）；`staffName` **直接放进 params JSON body 即可**（实测 `"staffName":"<英文名>"` 在 body 里有效，不必走 --header），必填。
> - required 4 个：`id` / `interviewForm` / `interviewTimeList` / `period`——**注意 period 在社招 change 是必填**（校招不是）。
> - `timeConfirmed` 是 **optional 的 bool**（不像校招 isConfirmTime 是 required）。
> - 🔴 **`needMeetingRoom` 是隐性必传（实测踩坑 2026-06-30）**：线上面试（腾讯会议等）务必显式传 `needMeetingRoom:false`。**漏传会失败且报错具有误导性**：第 1 次漏传 → 兜底 `code:500「操作失败，请联系HR业务运维」`（看着像参数解析崩，会误导你去补 contacts）；补了 contacts 仍漏 needMeetingRoom → 变成 `code:500「修改面试单据信息失败」`；补上 `needMeetingRoom:false` 才 `code:200`。**遇到这两个 500 文案，先检查 needMeetingRoom 有没有传，别只盯着 contacts。**
> - ✅ **实测成功样例（v4.9.11 · 2026-06-30 端到端验证）**：单 orderId=<单号>（某候选人·社招·stateId=1 待确认）改时间 19:00→20:00，参数=上方骨架 + `contacts/contactsId/contactType=3` + `interviewType:1` + `needMeetingRoom:false`，返回 `code:200/data:true`；改后 `get_order_detail` 确认时段已更新、状态变 `stateId=4「内部调整邀约，待候选人确认」`。**stateId=1（待候选人确认）的社招单可以直接 change，无需先确认时间。**
>
> 下文 `interview-arrange-campus.post_order_change` 步骤**仅适用于校招**。

**API**：`recruit.interview-arrange-campus.post_order_change`（POST · **仅校招**）；社招用 `recruit.interview-arrange.post_order_change`（见上方骨架）

**✅ 优先直接用 `post_order_change`**（参数类型必须正确）：

```bash
mcporter call recruit-mcp CallAPI   apiId='recruit.interview-arrange-campus.post_order_change'   params='{
    "id": <orderId_整数>,
    "isConfirmTime": false,
    "interviewTimeList": [{"startTime": "<yyyy-MM-dd HH:mm:ss>", "endTime": "<yyyy-MM-dd HH:mm:ss>"}],
    "interviewForm": 5,
    "placeType": 3,
    "staffName": "<你的英文名>",
    "noticeType": {"wechatMp": true, "smsToCandidate": false, "emailToCandidate": true}
  }' > $TMP_DIR/change_result.json 2>&1
```

> ⚠️ **参数类型陷阱**（`post_order_change` 特有）：
> - `id` 必须是 **整数**（不是字符串！）
> - `isConfirmTime` 必须是 **布尔值** `false`/`true`（不是字符串 `"false"`/`"true"`！）
> - `staffName` 官方 schema 标可选，但**实测不传会返 500**（de-facto 必传）→ 必须传当前操作人英文名

> 🔴 **必传**：官方 schema required = `id` / `isConfirmTime` / `interviewTimeList` / `interviewForm` / `placeType`；外加 `staffName`（schema 可选但实测必传）。完整字段见 S-Ref `post_order_change` 参数表。

> 🔴🔴🔴 **校招 change 的根因：`interviewType` 是隐性必传！漏了就返 500「操作失败」（v4.9.15 · 2026-06-30 对照实验坐实，纠正 v4.9.13/14 的全部错误结论）**：
>
> **系统逻辑（用户权威口径）**：校招面试**无论候选人确认与否（stateId=1 或 stateId=8 等），都可以用 `post_order_change` 即时调整面试时间**。change 就是"管理员即时改期 + 通知候选人"，change 成功后待办时间**立即变成新时间**。
>
> **之前为什么一直失败**：纯粹是**漏传 `interviewType`**（不是"change 不能用"、不是"要候选人确认"、不是"stateId 限制"——那些都是我基于漏参数的错误推断，已废弃）。对照实验铁证：
>
> | 调用（同一单 <单号>） | 带 `interviewType:1`? | 结果 |
> |---|:---:|---|
> | 改 15:00 | ✅ | `code:200`，待办**立即变 15:00** |
> | 改 14:00 | ✅ | `code:200`，待办**立即变 14:00** |
> | 改 13:00 | ❌ 漏 | **`code:500「操作失败，请联系HR业务运维」`，待办不变** |
>
> - 🔴 **强制规则：校招 `post_order_change` 必须带 `interviewType`**（单面=1/多对一=2/多轮一对一=3/集体面试=4）。这是隐性必传——官方 schema 没标 required，但漏了后端崩成兜底 500（与社招 change 漏 `needMeetingRoom`、社招 add 漏 contacts 三件套是**同一类隐性必传坑**）。
> - 🔴 **完整稳妥参数集**（实测 200 即时生效）：`id`(整数) + `isConfirmTime`(bool) + `interviewType` + `interviewForm` + `placeType` + `interviewPlace` + `period` + `staffName` + `interviewers`[{staffId,staffName}] + `interviewTimeList` + `noticeType`。**建议改单前先 `get_order_detail` 把原单的 interviewType/interviewForm/placeType 读出来照抄**，避免漏。
> - ✅ **复核仍用待办**：change 200 后用 `get_campus_interview_todo_list` 看 `interviewTime` 已变新值即确认成功（detail 也会同步）。
> - ⚠️ **遇到 `code:500「操作失败，请联系HR业务运维」`**：**第一嫌疑是漏了 `interviewType`**（其次才是其它参数）。补上 interviewType 重试，不要急着判"change 不可用"或走 cancel 重下。
> - 📌 **关于 isConfirmTime**：`false`=改完发邀约让候选人确认新时间（订单态可能显示「内部调整邀约待候选人确认」，但**时间本身已即时改了**）；`true`=时间已和候选人谈好直接定。两者都即时改时间，区别只在是否再走候选人确认通知。

#### 🆘 S-B 兜底：`stateId=1`（待安排）时的特殊处理

> ⚠️ **（v4.9.15 修正）** `stateId=1` 时 `post_order_change` **其实可用**（旧说"系统限制不可用"是漏传 interviewType 的误判，已纠正）。本兜底（add+traceId 覆盖）作为**备选**仍有效，尤其适合"本轮还没真正落过时段"的场景。优先推荐带全参数的 change；本 add 覆盖法在 change 不便时使用。
> 注：用 add 覆盖前，若该单之前被漏参 change 留过草稿，add 可能被判"已安排请勿重复"→ 需先 `get_order_cancel` 清掉再 add。

**备选流程**（`stateId=1` 时，add+traceId 覆盖）：

```bash
# Step 1：用 traceId（不是 orderId）调 post_order_add 覆盖时段
mcporter call recruit-mcp CallAPI \
  apiId='recruit.interview-arrange-campus.post_order_add' \
  params='{
    "interviewType": 1,
    "interviewers": [{"staffId": <你的 staffId>, "staffName": "<你的英文名>"}],
    "candidates": [{"traceId": <flowTraceId>}],
    "timeConfirmed": "false",
    "interviewForm": 4,
    "placeType": 3,
    "interviewPlace": "腾讯会议",
    "period": 60,
    "interviewTimeList": [{"startTime": "<新时间>", "endTime": "<新时间>"}],
    "noticeType": {"wechatMp": true, "smsToCandidate": true, "emailToCandidate": true}
  }' > $TMP_DIR/add_result.json 2>&1

# Step 2：无论返回 200 还是 500，立即用 get_order_detail 验证
mcporter call recruit-mcp CallAPI \
  apiId='recruit.interview-arrange-campus.get_order_detail' \
  params='{"id":"<orderId 字符串>","staffName":"<你的英文名>"}' > $TMP_DIR/verify.json 2>&1

# 检查 stateId 是否从 1 → 4，startTime/endTime 是否变成新时段
# 如果都对，操作成功；API 的 500 是误报，可忽略
```

**判断公式**：
```
拿到 stateId 后：
  stateId == 1   → 走 S-A.2 流程（用 traceId + post_order_add）
  stateId ∈ {2,3,4,7,8,9} → 走 S-B 标准流程（用 orderId + post_order_change）
  stateId ∈ {10,11} → 拒绝操作，告知用户已关单
```

---

### S-C. 取消面试单据

> ✅ **社招取消已支持（v4.9.4 · 2026-06-30 接口上线）**：社招子域现有 `recruit.interview-arrange.get_order_cancel`（GET），**不再需要引导用户去页面**。旧版"社招无 cancel API"约束**已废弃**。
>
> 🟢 **社招 cancel 参数与校招完全一致**：`id`(string,必填,正整数) / `reason`(string,必填) / `isSilence`(string,可选默认false；true=静默不通知) / `staffName`(可选)。
>
> **社招取消骨架**：
> ```bash
> mcporter call recruit-mcp CallAPI   apiId='recruit.interview-arrange.get_order_cancel'   params='{"id":"<orderId>","reason":"<取消原因>","isSilence":"false","staffName":"<你的英文名>"}'   > $TMP_DIR/social_cancel.json 2>&1
> ```
> - ⚠️ **取消不可撤销，调用前必须向用户二次确认**。
> - 校招用 `recruit.interview-arrange-campus.get_order_cancel`（见下），社招用 `recruit.interview-arrange.get_order_cancel`，参数相同，只换 apiId。
> - ✅ **实测成功样例（v4.9.12 · 2026-06-30 端到端验证）**：单 orderId=<单号>（某候选人·社招·stateId=4 内部调整邀约待确认）取消，参数 `{"id":"<单号>","reason":"...","isSilence":"false","staffName":"<操作人>"}` → 返回 `code:200/data:true`；改后 `get_order_detail` 确认 `stateId=6「内部取消邀约」`。**社招 cancel 不需要 contacts/needMeetingRoom（不像 change），四参即可，staffName 放 body 有效。**
>
> 🔴 **社招取消/改时间如何拿 orderId（v4.9.9 · 2026-06-30 实测，含关键时间窗口）**：cancel/change 都要 **orderId**（面试安排单据 id），社招拿 orderId 的正路是 **`get_order_toInterviewList_mine`**（"我的待面试列表"，当前用户作为面试官的安排记录，`records[]` 含 orderId）：
> ```bash
> mcporter call recruit-mcp CallAPI apiId='recruit.interview-arrange.get_order_toInterviewList_mine' params='{"page":"1","pageSize":"50"}'
> # → data.data.records[] 每条含 orderId；按候选人名/时间匹配出目标单的 orderId，再喂给 cancel/change
> ```
> ⚠️ **关键时间窗口（实测坑）**：该接口**只返回"尚未到达面试时间"的有效单**！面试时间一旦过去（哪怕几分钟），该单就从列表掉出 → records 为空。所以**社招改/取消必须在面试时间之前操作**，过期单经 MCP 拿不到 orderId。
>
> **拿不到 orderId 时的兜底**（面试已过期 / 列表为空）：
> - 其它途径都不给 orderId：社招 `post_order_add` 只返 `data:true`；社招待办 `social-todo-center.*` 记录只有 traceId(rows[].id)、无 orderId，url 也只有 traceId；`get_order_detail`/`get_order_invite_detail` 入参 `id`/`interviewId` 要的就是 orderId，用 traceId 查返空。
> - → **如实告知用户**"该面试时间已过/列表查不到 orderId，社招取消改期请到简历详情页操作，或提供 orderId"，**绝不拿 traceId 冒充 orderId 去调**（会失败/风险）。
> - 校招无此时间窗口问题（orderId 从 `get_campus_interview_todo_list` 待办或下单后刷待办即可得，含已安排单）。

**API**：`recruit.interview-arrange-campus.get_order_cancel`（GET · **校招**）；社招用 `recruit.interview-arrange.get_order_cancel`（参数同上）

```bash
mcporter call recruit-mcp CallAPI \
  --args '{"apiId":"recruit.interview-arrange-campus.get_order_cancel","params":{"id":"<orderId>","reason":"<取消原因>","isSilence":false}}' \
  --output text
```

| 参数 | 说明 |
|---|---|
| `id` | orderId |
| `reason` | 取消原因（必填，会显示给候选人） |
| `isSilence` | `false`=通知候选人，`true`=静默取消 |

> ⚠️ **取消不可撤销**，调用前必须向用户二次确认。

---

### S-D. 海外候选人时差提示（必查 · v4.8 增强）

> 🔴 **v4.8 增强动机**：旧版只在 `oversea: true` 时触发，会漏掉一类人——**简历上明显在国外读书/工作、但系统 `oversea` 没标 true** 的候选人（典型：在美国读研、计划回国入职的校招生；现在人在海外，但系统按"目标工作地=国内"没打 oversea）。这种人按北京时间约面，候选人当地可能是凌晨。所以判定要从"只看 oversea 字段"升级为"oversea 字段 + 简历地点信号"双重识别。

#### S-D.1 海外识别（下单前必跑，命中任一即视为"疑似海外"）

| 信号来源 | 字段 / 位置 | 命中条件 |
|---|---|---|
| 系统海外标记 | 待办 / 简历 `oversea` | `== true` |
| 当前所在地 | 待办 `curCountry` / `curCity` | 国家≠中国，或城市是海外城市 |
| 教育经历 | 简历 `educationList[].schoolName` / 地点 | 海外院校（如 Stanford / NUS / 港校等） |
| 工作经历 | 简历 `workExperienceList[].location` / 公司 | 当前在海外公司/海外城市 |
| 意向城市 | 简历 `expectCity` / 申请地点 | 仅作参考，**不单独据此判海外**（人可能在国内投海外岗） |

> 🔴 **关键区分**：判"要不要考虑时差"看的是**候选人面试时人在哪**（curCountry/curCity + 当前在读/在职地点），**不是**目标工作地。一个在美国读研投国内岗的人，`oversea` 可能是 false，但面试时人在美国 → 仍需考虑时差。

#### S-D.2 命中"疑似海外"时，先问面试官（🔴 不要擅自按海外/不按海外处理）

> 命中 S-D.1 任一信号、但**不确定候选人面试时是否真在海外**（比如简历显示在美读书，但可能已回国）时，**用一句话问面试官**，不要自己拍板：

```
AskUserQuestion（单问）：
  问：这位候选人简历显示在 <地点/院校>（海外），面试时 ta 可能在海外。约面试时间要按当地时差来考虑吗？
  选项：
    · 要考虑时差（按 ta 当地的合理时间约，我看双时区对照）—— 默认推荐
    · 不用，ta 已回国 / 在国内（按北京时间正常约）
    · 我不确定 ta 在哪（先帮我确认 ta 的所在地）
```

- 选「要考虑」→ 进 S-D.3 出双时区对照，约在候选人当地的合理时段（如当地 09:00-21:00）。
- 选「不用/已回国」→ 跳过时差，按北京时间正常走 S-A。
- 选「不确定」→ 提示用户可在简历详情页或直接问候选人确认所在地，先不下单。

> `oversea == true`（系统已明确标海外）时**可不必问**，直接进 S-D.3 出对照表（系统标记是强信号）；只有"简历信号疑似、系统没标"时才走 S-D.2 问一句。

#### S-D.3 双时区对照（确认要考虑时差后展示）

从待办 `curCountry`/`curCity` 或简历地点推算候选人当前时区，展示对照表后再下单。

**常用时差参考（北京 UTC+8 → 当地）**：

| 城市/地区 | 时区 | 与北京时差 |
|---|---|:---:|
| 美国西部 PDT | UTC-7 | -15h |
| 美国东部 EDT | UTC-4 | -12h |
| 英国 BST | UTC+1 | -7h |
| 雅加达 WIB | UTC+7 | -1h |
| **新加坡 SGT** | UTC+8 | **0h（同时区）** |
| **香港 HKT** | UTC+8 | **0h（同时区）** |
| 日本/韩国 | UTC+9 | +1h |
| 澳洲东部 AEST | UTC+10 | +2h |
| 新西兰 NZST | UTC+12 | +4h |

> ⚠️ **易混淆**：新加坡虽偏南但用 UTC+8，和北京零时差。校验：`TZ="Asia/Singapore" date` vs `TZ="Asia/Shanghai" date`。

**输出格式**：

```
| # | 北京时间 | 候选人当地时间 |
|:---:|---|---|
| 1 | 5月11日 10:00-11:00 | 5月10日 19:00-20:00 (PDT) |
```

---

### S-E2. 社招面试安排 API（补充）

> 社招与校招接口**数据隔离**，分组名不同（`recruit.interview-arrange` vs `recruit.interview-arrange-campus`）。
> 对社招单据操作必须用社招分组接口，混用会返回空或权限错误。

#### 社招可用接口（v4.9.4 · recruit-mcp 目录确认，共 12 个）

| apiId | 名称 | 方法 | 用途 |
|---|---|---|---|
| `recruit.social-todo-center.get_api_trace_get_list` | 社招面试待办（flowId=3+extType=interview+done=false）| GET | 社招待办（v4.9.4 修正：旧 `interview-arrange.get_my_interview_list` 已失效；校招用 `recruit.campus-center-front.get_campus_interview_todo_list`） |
| `recruit.interview-arrange.get_auth_checkInterviewer` | 校验面试官权限 | GET | 检查指定员工是否拥有面试官权限 |
| `recruit.interview-arrange.get_calendar_getCalendarInfo` | 查询面试官日历 | GET | 校招社招共用 |
| `recruit.interview-arrange.get_meetingRoom_cities` | 获取会议室城市列表 | GET | 订会议室前置 |
| `recruit.interview-arrange.get_meetingRoom_buildings` | 获取办公大厦列表 | GET | 订会议室前置 |
| `recruit.interview-arrange.get_meetingRoom_floors` | 获取楼层列表 | GET | 订会议室前置 |
| `recruit.interview-arrange.get_meetingRoom_rooms` | 获取可用会议室列表 | GET | 订会议室前置（按时间段过滤） |
| `recruit.interview-arrange.get_order_detail` | 获取社招面试安排单据详情 | GET | 查单据 |
| `recruit.interview-arrange.get_order_invite_detail` | 获取社招邀约单详情 | GET | 含候选人确认状态等 |
| `recruit.interview-arrange.post_order_add` | 创建社招面试安排 | POST | 下单（首次发起） |
| `recruit.interview-arrange.post_order_change` | 调整社招面试安排 | POST | ✅ **改时间（v4.9.4 上线）**，参数见 S-B |
| `recruit.interview-arrange.get_order_cancel` | 取消社招面试安排 | GET | ✅ **取消（v4.9.4 上线）**，参数见 S-C |

> ✅ **重要事实更新（v4.9.4 · 2026-06-30）**：
> - 社招子域**已新增** `post_order_change`（POST，改时间）和 `get_order_cancel`（GET，取消）写接口——旧版"社招无 change/cancel"已废弃。
> - 社招改时间/取消**直接调对应接口**，不再引导用户去页面。
> - 社招 change required 4 字段：`id`/`interviewForm`/`interviewTimeList`/`period`；用 `timeConfirmed`(bool,optional) 不是校招的 `isConfirmTime`；无 `placeType`，用 `needMeetingRoom`+`interviewPlace`；noticeType 用 outlook/weworkRobot/emailToCandidate/miniRobotToCandidate；`staffName` 必填。详见 S-B 对比表。
> - 社招 cancel 参数与校招相同：id/reason/isSilence/staffName。
> - ⚠️ 社招 change/cancel 截至 2026-06-30 **未实测**，骨架按官方 schema 拼，首跑后补成功样例。

#### `post_order_add` 社招 vs 校招参数差异

| 字段 | 校招 `campus.post_order_add` | 社招 `post_order_add` |
|---|---|---|
| 候选人标识 | `candidates[].traceId` | `candidates[].rid`（简历 GUID 字符串，**不是 employeeId！**详见 T-2-RID） |
| 岗位信息 | 不需要 | 推荐传 `postId`（整数）、`postName`（字符串）|
| **traceId**（顶层）| 不需要 | **必传**（整数，**只能用 todo 的 `nextTraceId` / `id` 字段**；`flowMainId` 是错的会 500）|
| **contacts 三件套**（顶层）| 不需要 | **🔴 de-facto 必传**（schema 标 optional 但实际后端必须，缺则 500 兜底）：`contacts`(string)/`contactsId`(int)/`contactType`(int 0其他/1助手/2招聘经理/3面试官) |
| `noticeType` 字段名 | `wechatMp` / `smsToCandidate` / `emailToCandidate` | `outlook` / `weworkRobot` / `emailToCandidate` / `miniRobotToCandidate` |
| `timeConfirmed` | 字符串 `"true"`/`"false"` | **布尔值** `true`/`false`（不能加引号！） |
| `needMeetingRoom` | 无此字段 | 布尔值（现场面试时是否订会议室） |
| `interviewPlace` | 当 `placeType=3` 时使用 | 按需可传（schema 里有此字段；腾讯会议场景下没意义；非失败主因） |
| `placeType` | 必传 | **不传**（社招接口没有此字段） |

#### 🚨 社招 `post_order_add` 参数硬约束（v4.5 · 实测验证 2026-05-27 · 9 轮穷举得出）

**✅ 必传字段清单**（缺一项必 500 · 含 de-facto 必传）：

| 字段 | 类型 | 取值来源 | 标注 |
|---|---|---|---|
| `interviewType` | int | 1=单面 / 2=多对一（多面试官对 1 候选人）/ 3=多轮一对一（默认 1）。**社招不支持 4 集体面试**（集体面试=面试官对多候选人，仅校招有）| schema required |
| `interviewForm` | int | 1=现场 / 2=电话 / 3=面呗 / 4=腾讯会议 / 5=web版面呗 | schema required |
| `interviewers` | `[{staffId, staffName}]` | 从 todo 的 `staffID` / `staff` 字段取 | schema required |
| `candidates` | `[{rid, name, email}]` | rid 是 **GUID 格式**，必须从 `resolve_social_rid.py` 反查（todo 不返回，**禁止用 employeeId**） | schema required |
| `interviewTimeList` | `[{startTime, endTime}]` | `yyyy-MM-dd HH:mm:ss` 北京时间，**只传 1 个时段**，必须距当前时间 **≥1 小时** | schema required |
| `timeConfirmed` | **boolean** | `false`/`true`（**不能加引号**！校招用字符串，社招用布尔） | optional 但常用 |
| `traceId` | int | **顶层字段**（不是 candidates 里）；**只能用 todo 的 `nextTraceId` 或 `id`**（两者值相同 = 202031885）；🔴 **禁止用 `flowMainId`**（会 500） | optional 但社招必传以关联待办 |
| `contacts` | string | 联系人姓名（一般 = 当前操作人英文名，从 todo 的 `staff` 字段取） | **🔴 de-facto 必传**（schema 标 optional 但缺了后端崩 500 兜底）|
| `contactsId` | int | 联系人员工 ID（= 当前操作人 staffId，从 todo 的 `staffID` 取） | **🔴 de-facto 必传** |
| `contactType` | int | `0`=其他/`1`=助手/`2`=招聘经理/`3`=面试官；本人下单就传 `3` | **🔴 de-facto 必传** |
| `postId` | int | 从 todo 的 `recruitPostID` 取 | optional 但推荐传 |
| `postName` | string | 从 todo 的 `recruitPostName` / `mainPostName` 取 | optional 但推荐传 |
| `noticeType` | object | 4 个布尔字段：`outlook` / `weworkRobot` / `emailToCandidate` / `miniRobotToCandidate`（不是校招的 wechatMp 等！） | optional 但推荐传 |

**❌ 必删字段清单**（接口定义里**没有**，乱传可能干扰）：

| 字段 | 为什么不能传 |
|---|---|
| `placeType` | 接口 schema 无此字段（校招才有）|
| `wechatMp` / `smsToCandidate`（在 noticeType 里）| 校招字段名，社招用 outlook/weworkRobot/miniRobotToCandidate |
| `flowTraceId`（在 candidates[] 里）| 这是校招写法；社招 candidates[] 只有 `rid/name/email/mobile` |

> 📝 **关于 `interviewPlace`**：schema 里有此字段（type: string，"自定义面试地址"）。**不在必删清单**，按需可传；腾讯会议（`interviewForm=4`）场景下没意义，传不传都不影响下单成败。

**🔴 调用前自检 checklist**（agent 拼参数时逐条勾选，全过才能 mcporter call）：

```
□ rid 是 GUID 格式（含 - 分隔，长度 36）—— 不是数字 employeeId
□ traceId 是从 todo 的 nextTraceId / id 取的整数（非 0），不是 flowMainId
□ contacts/contactsId/contactType 三件套全传（de-facto 必传，缺则 500 兜底）
□ contactType 当前操作人下单就传 3（面试官）
□ timeConfirmed 是布尔值（false/true，不带引号）
□ interviewTimeList[0].startTime 距当前时间 ≥ 1 小时
□ noticeType 里只有 outlook/weworkRobot/emailToCandidate/miniRobotToCandidate
□ 没有 placeType、flowTraceId、wechatMp、smsToCandidate
```

> ✅ **实测验证记录（2026-05-27）**：参数齐全后接口返回 `code:"500", message:"【<操作人>】跟该候选人【<操作人>】已有一场面试邀约，请勿重复安排哦。", data:"2544161"`——**这是接口能"正常返回业务错误"的表现**（区别于兜底 500），data 字段返回的就是已存在的 orderId。
>
> **500 错误的两种本质区别**：
> - **业务错误（含具体 message）** = 接口拿到参数后做业务校验失败 → 改业务（如换时间、换 candidate）即可
> - **兜底"操作失败，请联系HR业务运维"（无具体 message）** = **十有八九是 contacts 三件套缺了**，后端在解析参数阶段崩了 → 补齐 contacts 三件套重试

> ✅ **社招下单成功实测（2026-06-30 · v4.9.4）**：完整链路跑通——① 社招待办 `social-todo-center.get_api_trace_get_list`(flowId=3,extType=interview,done=false) 取候选人(只给 employeeId/traceId/emailAddress) → ② 按 `email` 精确反查 rid(`post_api_resume_query_query` params={"email":...}) → ③ `interview-arrange.post_order_add` 下单：`interviewType:1/interviewForm:4/interviewers:[{staffId,staffName}]/candidates:[{rid,name,email}]/单时段/timeConfirmed:false(布尔)/traceId:<待办nextTraceId>/contacts三件套(contacts+contactsId+contactType:3)/postId/postName/period/noticeType(outlook+weworkRobot+emailToCandidate+miniRobotToCandidate)` → `code:200 success:true`(741ms)。**带 contacts 三件套 + email反查的rid，一次成功。**

#### 社招下单标准示例（v4.5 骨架 · v4.9.4 已实测成功）

```bash
mcporter call recruit-mcp CallAPI   apiId='recruit.interview-arrange.post_order_add'   params='{
    "interviewType": 1,
    "interviewForm": 4,
    "interviewers": [{"staffId": <todo.staffID>, "staffName": "<todo.staff>"}],
    "candidates": [{"rid": "<resolve_social_rid 反查到的 GUID>", "name": "<todo.title>", "email": "<todo.emailAddress>"}],
    "interviewTimeList": [{"startTime": "yyyy-MM-dd HH:mm:ss", "endTime": "yyyy-MM-dd HH:mm:ss"}],
    "timeConfirmed": false,
    "traceId": <todo.nextTraceId 或 todo.id>,
    "contacts": "<todo.staff 当前操作人英文名>",
    "contactsId": <todo.staffID 当前操作人 staffId>,
    "contactType": 3,
    "postId": <todo.recruitPostID>,
    "postName": "<todo.recruitPostName>",
    "period": 60,
    "noticeType": {"outlook": true, "weworkRobot": true, "emailToCandidate": true, "miniRobotToCandidate": false}
  }' > $TMP_DIR/social_order_result.json 2>&1
```

> ✅ **预期成功返回**：`{"code":"200", "message":"OK", "data":<orderId 整数字符串>, "success":true}`
> ⚠️ **如果返回 `code:"500"` 但 `message` 是具体业务文案**（如"已有面试邀约"/"时间太近"等）：直接给用户看 message + 简历页链接，不要继续重试
> 🚫 **如果返回 `code:"500"` 且 `message:"操作失败，请联系HR业务运维"`（兜底）**：**优先检查 contacts 三件套是否齐全**（这是已知唯一会触发兜底崩溃的参数缺漏），齐全后仍兜底再给简历页链接

#### 社招下单标准示例（v4.5 · 实测可用骨架）

```bash
mcporter call recruit-mcp CallAPI   apiId='recruit.interview-arrange.post_order_add'   params='{
    "interviewType": 1,
    "interviewForm": 4,
    "interviewers": [{"staffId": <todo.staffID>, "staffName": "<todo.staff>"}],
    "candidates": [{"rid": "<resolve_social_rid 反查到的 GUID>", "name": "<todo.title>", "email": "<todo.emailAddress>"}],
    "interviewTimeList": [{"startTime": "yyyy-MM-dd HH:mm:ss", "endTime": "yyyy-MM-dd HH:mm:ss"}],
    "timeConfirmed": false,
    "traceId": <todo.nextTraceId 或 todo.id>,
    "postId": <todo.recruitPostID>,
    "postName": "<todo.recruitPostName>",
    "period": 60,
    "noticeType": {"outlook": true, "weworkRobot": true, "emailToCandidate": true, "miniRobotToCandidate": false}
  }' > $TMP_DIR/social_order_result.json 2>&1
```

> 🚨 **如果按上面参数齐全后仍返回 `code:500 message:"操作失败，请联系HR业务运维"`**：
> - **立即停止重试**（实测穷举过：去掉/添加任何参数、改时间、改 rid 来源都改不动同一个 500，是服务端业务规则但兜底文案）
> - **直接给用户简历页链接**：`https://zhaopin.woa.com/resume/resume_detail?rid={rid}&fromplace=MCP`
> - 让用户在页面手工下单（最稳）；不主动建议用户找 HR 业务运维（费时间且大概率拿不到具体原因）
> - 保留 requestId 供事后排查记录用，**不主动**让用户去找运维

#### 🔬 业务错误 vs 兜底 500 的鉴别（v4.7 · 2026-05-27 排查记录）

实测对比：同一参数模板、同一面试官账号下单 2 个候选人

| 候选人 | 简历状态 | flowList 中"面试中"流程 | 接口返回 |
|---|---|---|---|
| 候选人A | 待筛选（locked=1 但被人工放弃过） | 0 条（最近一条 stateId=3 但其实已放弃） | `code:1010 "面试流程已失效"` ✅ 业务错误 |
| 候选人B | 面试中（locked=1, secret=false） | 1 条（traceId=<TRACE_ID>, owner=<操作人>, processTime=null） | `code:500 "操作失败，请联系HR业务运维"` ❌ 兜底 |

**结论**：兜底 500 与参数无关，且与候选人简历本身的状态/锁定/保密配置无关。已穷举验证以下变量均无效：
- 删除 / 添加 postId / postName / cityId / cityText / interviewPlace
- 切换 interviewForm（1/2/4/5）
- 切换 traceId 来源（id vs nextTraceId）
- 切换候选人 candidates[].mobile 是否带

**判定**：是**后端 OrderService 在处理某些特定候选人/流程数据组合时崩溃**，与 MCP / agent / 参数无关。
**唯一可靠方案**：直接给用户简历页链接让其页面操作；不再做无效重试。

**M5 效率提醒**：每次踩兜底 500 都意味着 6+ 轮无效 MCP 调用，要早识别早止损。识别信号：第 2 轮重试还是兜底文案 = 一定是服务端 bug，立刻退出走页面兜底。

---

### S-E. 状态码速查

| `stateId` | 状态 | 当前等谁 | 我能做什么 |
|:---:|---|---|---|
| 1 | 待安排面试时间 | 面试官 | S-A.4 落时段 |
| 2 | 首次邀约，待面试官确认 | 面试官 | S-B 确认/改 |
| 3 | 候选人调整，待面试官确认 | 面试官 | S-B 接受候选人提议 |
| 4 | 内部调整，待候选人确认 | 候选人 | 等 |
| 5 | 候选人取消 | — | 重新 S-A 或 S-C 关单 |
| 6 | 内部取消 | — | — |
| 7 | 助手邀约中 | 助手 | 等 |
| 8 | 邀约完成 / 待开始面试 | — | 准备面试 |
| 9 | 调整邀约完成（最新版本已发出） | 候选人 | 等候选人确认 |
| 10 | 面试已完成 | — | 写面评（场景 D） |
| 11 | 已关单 | — | — |

---

### 📚 S-Ref. 接口速查（按需查阅）

> 🔵 **接口层兜底字典（v4.9.3 · 文档没覆盖时用 SearchAPI 查权威接口目录）**：
>
> 招聘 MCP 的 `SearchAPI` 是**接口能力的权威来源**——比本文档更新、更准。**当下面这些情况发生时，应该去查它，而不是凭本文档旧描述硬猜或编参数**：
> - 用户的诉求本文档/Router 没有对应章节兜住（出现了文档没写的新场景）；
> - 本文档描述与实际调用结果对不上（如报字段不存在、枚举值变了）；
> - 不确定某接口存不存在、归校招还是社招子域、参数大概有哪些。
>
> **怎么查**：
> ```bash
> mcporter call recruit-mcp SearchAPI params='{"query":"<接口名 或 自然语言诉求>"}'
> ```
> - 用**接口名**查（如 `recruit.interview-arrange-campus.get_order_cancel`）最精准；用**自然语言**查（如"取消校招面试"）会返回校招+社招两个子域的同名接口，**靠 apiId 前缀区分子域**（`interview-arrange-campus`=校招 / `interview-arrange`=社招）。
> - 返回内容含：apiId、名称、方法(GET/POST)、说明（常带源码位置 + 参数线索 + 枚举值）。
>
> ⚠️ **SearchAPI 的能力边界（别误用）**：
> - 它返回的是**接口目录 + 简短描述 + 部分枚举**，**不返回逐字段的完整请求体 schema**。要完整字段表仍需接口文档页或用户提供。
> - 🔴 **与"禁止直接 SearchAPI 拼参数"不冲突**：被禁的是**跳过 Router-0 / S 路由表、直接拿搜索结果就去拼参数下单**（绕流程瞎试）。这里允许的是**流程已走到位、但文档没覆盖该场景/字段时，用 SearchAPI 查权威定义来佐证**。即：**SearchAPI 用来"查证接口能力"，不是用来"绕过路由直接下单"**。
> - 查到的接口若本文档已有专节，仍以专节的实测参数/类型陷阱为准（如 id 字符串/整数差异、timeConfirmed 类型、校招无 contacts 三件套等——这些是 schema 看不出的实测经验）。
>
> 📌 **校招 S 模块权威接口清单（apiId，可直接喂给 SearchAPI 核对）**：
> | 用途 | apiId | 方法 |
> |---|---|---|
> | 调整面试安排（改时间）| `recruit.interview-arrange-campus.post_order_change` | POST |
> | 获取面试安排单据详情 | `recruit.interview-arrange-campus.get_order_detail` | GET |
> | 获取邀约单据详情 | `recruit.interview-arrange-campus.get_order_invite_detail` | GET |
> | 取消面试安排 | `recruit.interview-arrange-campus.get_order_cancel` | GET |
> | 查询校招面试待办对应转写记录(ASR) | `recruit.interview-arrange-campus.get_interview_trace_record` | GET |
> | 面试下单 | `recruit.interview-arrange-campus.post_order_add` | POST |
> | 查校招面试待办 | `recruit.campus-center-front.get_campus_interview_todo_list` | POST |
> | 查面试官日历忙闲（校社共用）| `recruit.interview-arrange.get_calendar_getCalendarInfo` | GET |

#### 场景 S 用到的全部接口

| API | 用途 | 在哪个 S 章节 |
|---|---|:---:|
| `recruit.campus-center-front.get_campus_interview_todo_list` | 查待办拿 orderId / flowTraceId | S-0, S-A.3 |
| `recruit.interview-arrange.get_calendar_getCalendarInfo` | **查面试官日历忙闲**（Outlook + 腾讯面试系统联合视图，校招也能用；一次查 1 人，多对一时每位面试官各查一次再求交集） | S-0.5, S-MultiPanel.2 |
| `recruit.interview-arrange-campus.post_order_add` | 建单（**起可一步含时段+通知**） | S-A.2 |
| `recruit.interview-arrange-campus.post_order_change` | 落时段 + 发邀约 / 改时间 | S-A.4, S-B |
| `recruit.interview-arrange-campus.get_order_detail` | 查单据详情验证（id 必须传字符串） | S-A.5 |
| `recruit.interview-arrange-campus.get_order_cancel` | 取消单据 | S-C |
| `recruit.interview-arrange-campus.get_order_invite_detail` | 获取邀约单详情（含候选人确认状态） | S-A.5 验证 |

#### `post_order_change` 完整参数表（v4.9 · 对齐官方 schema /order/change）

> 🔴 **官方 schema `required` 数组**（5 个）：`id` / `isConfirmTime` / `interviewTimeList` / `interviewForm` / `placeType`。
> ⚠️ **`staffName` 在官方 schema 里标 optional（请求参数区"必填=否"，且不在请求体里，走 query/header）**，但**实测不传会返 500**——和社招 contacts 三件套同类（de-facto 必传）。所以**仍按必传处理**，下表用 🟠 标注"schema 可选 / 实测必传"。

| 参数 | 类型 | 必填 | 说明 |
|---|---|:---:|---|
| `id` | int | ✅ | 面试安排 id（orderId）。**注意：本接口是 integer，`get_order_detail` 里是字符串** |
| `isConfirmTime` | bool | ✅ | 是否和候选人确认时间。**布尔值**（非字符串）；实测多时段无效（见 S-A.4），默认 `false` + 单时段 |
| `interviewTimeList` | array | ✅ | `[{startTime, endTime, group}]`，时间格式 `yyyy-MM-dd HH:mm:ss` 北京时间，**不可为空集合** |
| `interviewForm` | int | ✅ | 1现场/2电话/3面呗/4腾讯会议/5web版面呗/6牛客网。**改单时要和原单一致** |
| `placeType` | int | ✅ | 面试地点类型 1会议室/2面试项目/3自定义（线上=3） |
| `staffName` | string | 🟠 | **schema 标可选、实测不传会返 500**（de-facto 必传）。当前操作人英文名（如 `<YOUR_ENGLISH_NAME>`，即你企业微信英文名）。走 query/header，不在请求体 |
| `interviewType` | int | 🔴**隐性必传** | 1单面 / 2多对一（多面试官对 1 候选人）/ 3多轮一对一 / **4集体面试（校招专属：一个或多个面试官对多个候选人；社招不支持）**。⚠️ **官方 schema 没标 required，但实测 change 漏传它会返 `code:500「操作失败」`（v4.9.15 对照实验坐实）——必传！** |
| `period` | int | 推荐 | 面试时长（分钟） |
| `noticeType` | obj | 推荐 | `{wechatMp, smsToCandidate, emailToCandidate}`（校招字段名）|
| `interviewers` | array | 可选 | **辅助面试官** `[{staffId, staffName}]`，本人主面试官时传 `[]` |
| `interviewPlace` | string | placeType=3 时建议 | 自定义面试地址 |
| `cityId` / `buildingId` / `floorId` / `roomId` | int | placeType=1 时 | 会议室信息（id） |
| `cityText` / `buildingText` / `floorText` / `roomText` | string | placeType=1 时 | 会议室信息（文本，与 id 配套）|
| `groupMax` | int | 可选 | 分组人数限制（多对一/分组面试用） |
| `contacts` / `contactsId` / `contactsNumber` | string/int/string | 可选 | 联系人姓名 / staffId / 联系方式（校招 change **非必传**，区别于社招 add 的 de-facto 必传）|
| `contactType` | int | 可选 | 联系人类型 0其他/1助手/2招聘经理(已弃)/3面试官 |
| `mailMessageForCandidate` | string | 可选 | 邮件留言（给候选人） |
| `againstCheatingTypeId` | int | 可选 | 反作弊类型：10 双机位 / 20 手机占用 |
| `aiCodingEnabled` | bool | 可选 | 是否开启 AI Coding 评估 |

#### `get_order_invite_detail` 说明（校招 + 社招）

> `get_order_detail` 返回基础单据信息；`get_order_invite_detail` 返回邀约单详情（候选人确认状态、候选人与面试官时间段、接单助手等）。

**校招**：`recruit.interview-arrange-campus.get_order_invite_detail`（GET）
- 参数：`interviewId`（query, string, 必填）、`staffName`（header, string, 必填）

**社招**：`recruit.interview-arrange.get_order_invite_detail`（GET）
- 参数：`interviewId`（query, 必填）、`staffName`（header, 必填）

#### `get_order_detail` 返回关键字段

| 路径 | 用途 |
|---|---|
| `data.stateId` / `data.stateText` | 当前状态（对照 S-E 表） |
| `data.startTime` / `data.endTime` | 当前面试时间（一步下单 S-A.2 成功后已有值；若走老版 add+change，add 后为空、change 后才有） |
| `data.period` | 面试时长 |
| `data.interviewFormText` | 面试方式文本 |
| `data.onlineInfo.wemeetCode` / `candidateUrl` | 腾讯会议号 + 链接（自动生成） |
| `data.candidateList[].name/email/mobile` | 候选人联系方式 |
| `data.interviewerList[].staffName` | 面试官清单 |
| `data.updateByName` | 最近一次操作人（candidate 还是面试官） |

#### 常见错误速查

> 详细踩坑经验和参数陷阱见 `references/pitfalls.md`。

| 现象 | 快速处理 |
|---|---|
| `post_order_change` 返 500 | 检查 `id` 类型（integer！）、`isConfirmTime` 类型（boolean！）、`staffName` 是否填写 |
| `get_order_detail` `TYPE_MISMATCH` | `id` 必须传**字符串**（与 `post_order_change` 相反！） |
| `post_order_add` 成功但 `startTime` 为空 | 补全 `interviewTimeList` + `timeConfirmed` |
| 多时段邀约失效 | 系统只支持单时段，线下确认后下单 |
| `Unknown MCP server` / 401 | 检查 mcporter 配置和 Token |

---


