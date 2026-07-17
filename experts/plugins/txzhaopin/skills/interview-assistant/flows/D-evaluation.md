# 面试助手 · D 面评子模块（D-1 拉转写 → D-6 Handoff，含面评质量检测）

> 子模块路径：`flows/D-evaluation.md`  
> 触发：在主 SKILL.md 的 Router-0 命中本类目后，**第一件事是 Read 本文件**，再执行内部步骤。  
> 本文件由 v3.6 单文件 SKILL.md 拆分而来，原章节内容完整保留。

<!-- skill-tracker sub_flow: begin (auto-generated) -->

> 🚨 **FIRST ACTION（读到本文件第一件事 · MANDATORY · 静默执行）**：上报 `sub_flow_entered` 事件，标记本次进入了 **`D` 子流程（面评填写（写草稿，不替用户提交））**。这是 v4.6 双轨埋点的精准维度——配合 SKILL.md 主 FIRST ACTION 的 `skill_invoked`，看板能拉出"哪个 sub_flow 用得最频繁"。

```bash
bash ./scripts/track.sh "0WEB06ZI7OVDOZQW" "interview-assistant" "sub_flow_entered" '{"session_id":"'"$(date +%s)"'","sub_flow":"D","sub_flow_name":"面评填写（写草稿，不替用户提交）"}'
```

**约束**：每次读到本文件就执行一次（不要因为同会话内"刚跑过"就跳过）。静默后台，失败容忍，不询问用户。

<!-- skill-tracker sub_flow: end -->

---

### 场景 D：面评填写 — 自动生成结构化面评

**触发条件**：用户选择「面评填写」，或从场景 T 待办列表中选择"写面评"

#### D-1. 获取面试转写

**🔴 推荐路径（v3.7 起首选）：招活内嵌转写接口（recruit-mcp）**

招活直接吐转写，1 步到位，质量比 tencent-meeting-mcp 路径更高且无需额外鉴权。
**详细字段说明、错误码、踩坑记录** → `references/transcripts/recruit-trace-api.md`

**⚠️ 校招 / 社招使用不同接口（v4.2 起新增社招）**：

| 招聘类型 | 接口 apiId | fetch_transcript.py 参数 |
|---|---|---|
| 校招（campus） | `recruit.interview-arrange-campus.get_interview_trace_record` | `--recruit-type campus`（默认） |
| 社招（social） | `recruit.interview-arrange.get_interview_trace_record` | `--recruit-type social` |

**如何判断校招还是社招**：
1. **优先**从 T 待办数据读取 `recruitType` 字段（1=校招, 2=实习, 3=社招）
2. 用户口述时以用户说的为准
3. 不确定时**反问**"校招还是社招？"

**调用方式（推荐 fetch_transcript.py 封装，已处理大返回截断 / JSON 解析 / userId 对齐）**：

```bash
# 方式 A：从 T 待办按候选人姓名自动找 traceId（最常用）
# 校招（默认）
python3 ~/.workbuddy/skills/interview-assistant/scripts/fetch_transcript.py \
    --todo-file $TMP_DIR/todo_raw.json \
    --candidate <候选人姓名> \
    --out-dir $TMP_DIR \
    --prefix <候选人英文/拼音>

# 社招（加 --recruit-type social）
python3 ~/.workbuddy/skills/interview-assistant/scripts/fetch_transcript.py \
    --todo-file $TMP_DIR/todo_raw.json \
    --candidate <候选人姓名> \
    --recruit-type social \
    --out-dir $TMP_DIR \
    --prefix <候选人英文/拼音>

# 方式 B：已知 traceId（即 personList[].flowTraceId，必须 string）
# 校招
python3 ~/.workbuddy/skills/interview-assistant/scripts/fetch_transcript.py \
    --trace-id <flowTraceId> \
    --out-dir $TMP_DIR \
    --prefix <候选人英文/拼音>

# 社招
python3 ~/.workbuddy/skills/interview-assistant/scripts/fetch_transcript.py \
    --trace-id <flowTraceId> \
    --recruit-type social \
    --out-dir $TMP_DIR \
    --prefix <候选人英文/拼音>

# 输出：
#   $TMP_DIR/<prefix>_raw.json  招活原始返回
#   $TMP_DIR/<prefix>.txt       人类可读纯文本（[HH:MM:SS] user: content）
# Read $TMP_DIR/<prefix>.txt 即可
```

**触发**：从场景 T 待办联动进入 D 时，**自动**用方式 A 拉转写，**不再问用户腾讯会议号**。

**裸 mcporter 调用（仅当脚本不可用时）**：

```bash
# 校招
mcporter call recruit-mcp CallAPI \
  apiId='recruit.interview-arrange-campus.get_interview_trace_record' \
  params='{"traceId":"<flowTraceId>"}' \
  > $TMP_DIR/trace_raw.json 2>&1

# 社招
mcporter call recruit-mcp CallAPI \
  apiId='recruit.interview-arrange.get_interview_trace_record' \
  params='{"traceId":"<flowTraceId>"}' \
  > $TMP_DIR/trace_raw.json 2>&1
# 然后用 python json.loads() + data["data"]["data"] 提取 list
```

**降级处理（fetch_transcript.py 退出码）**：

| 退出码 | 含义 | 处理 |
|:---:|---|---|
| 0 | 成功 | 继续 D-2 |
| 1 | 参数错误（traceId 找不到 / 候选人姓名不匹配） | 检查 T 待办原始数据，确认 personList 结构 |
| 2 | mcporter 调用失败 | 检查 recruit-mcp 配置：`mcporter list \| grep recruit-mcp` |
| 3 | 接口成功但**转写为空**（`data:[]`） | ⚠️ **先按下方「D-1.1 转写为空排查」排查，不要直接下"拿不到"结论**；排查后仍空再走路径二/三 |
| 4 | 鉴权失败（AUTH_PERMISSION_DENIED） | 联系招活管理员授权；或走路径二/路径三 |

#### 🔴 D-1.1 转写为空 / code 1018 排查（v4.9.6 · 实测坐实根因）

> **实测案例（2026-06-30）**：从已办列表查到某候选人有 **4 条不同轮次** flowTraceId（分属 2 个 flowMainId 流程）。逐个拉转写结果：
> - 其中 3 个 traceId（同一 flowMainId，初试/复试/HR面）→ **`code:1018「面试待办不存在或已失效」`**（这组流程作废）
> - 另 1 个 traceId（另一 flowMainId，HR面试）→ **`code:200`，百余条真实转写** ✅
> 结论：**"拉不到转写"几乎都是 traceId 取错了轮次**——转写只挂在某一个具体轮次上，取了别的轮次要么 1018 要么空。

> `get_interview_trace_record` 的 `traceId`（"校招面试流程待办 ID，来源于面试邀约/待办系统"）必须对准**那一场有转写的面试**。退出码 3（含 `data:[]` 或内层 `code:1018`）**不等于"没有转写"，先排查再下结论**：

1. 🔴 **先定位"目标场次"，而不是无脑遍历所有轮次**（关键认知）：
   - **取该候选人历史场次 traceId 的来源（校招/社招不同）**：
     - **校招**：`get_campus_interview_done_list`（按姓名 keyword 查）——⚠️ 已办结构与待办不同：候选人字段直接在 `list[]` 顶层，**无 `personList` 包裹**；取每条的 `flowTraceId`。
     - **社招**：`social-todo-center.get_api_trace_get_list`（`flowId=3 + extType=interview + done=true`，已办）——取 `rows[].id`（即 nextTraceId）作为 traceId。
   - **看候选人有几条记录 + 面试时间，分情况处理（不要一上来就逐个拉）**：

   | 情况 | 处理 |
   |---|---|
   | **只有 1~2 条、且时间就在最近** | 直接对这 1~2 条 traceId 试拉，命中 `code:200` 且 data 非空即用 |
   | **多条记录（≥3 场）/ 跨多流程 / 面试过很多次** | 🔴 **先用 `AskUserQuestion` 让用户确认是哪一场**（列出"轮次 + 面试时间"给用户选），不要把每场都拉一遍——用户面过很多次时盲目遍历既慢又可能拉到无关的旧场次 |
   | **目标场次面试结束已很久**（如 > 数天/数周） | 🔴 **先问用户"你要写的是哪一场面评？"**——结束很久的转写可能不是用户当前想写的那场；不主动去翻陈年场次 |

   - 命中后：`code:1018`/空的跳过，只用 `code:200` 且有内容的那条。
   - ✅ **校招/社招转写均已实测可用**（校招、社招各实测一例正确 traceId 均拉到百余行转写）。脚本：校招默认 `fetch_transcript.py --trace-id <id>`，社招加 `--recruit-type social`。

2. **`code:1018「面试待办不存在或已失效」`**：该 traceId 轮次/流程已作废 → 换用户确认的目标场次 traceId 重拉。
3. **转写是否还在生成**（时间因素）：ASR 在面试结束后有**生成延迟**。面试刚结束不久（< 30~60 分钟）可能还没生成完 → 提示"转写可能仍在生成，可稍后重试"，**不要武断说"未开启转写"**。
4. **确认面试是否真的已结束**（见 D-1.2）。

> 🔴 **禁止行为**：
> - 退出码 3 / code 1018 时**不要**直接抛"招活转写拿不到（未开启转写）"就让用户手工粘贴——那会让"其实有转写"的 case 白白走兜底。
> - 但也**不要无脑遍历候选人的全部历史场次**——多场/久远时**先反问用户确认目标场次**，再针对性拉。**机器定位有歧义时，让用户拍板，别硬猜也别全捞。**

#### 🕐 D-1.2 面试是否已结束的判定（v4.9.6 · 防止脑补算错时间）

> **背景**：实战中 agent 曾脑补"面试还没开始"且把时间算反（面试 15:30、当前 16:09，却说"还没开始"）。**禁止凭感觉判断面试时段，必须用数据 + 正确的时间比较**：

- **取面试时间**：从待办/单据的 `interviewTime`/`startTime`（北京时间）取，**不要自己回忆或猜**。
- **取当前时间**：用 `date '+%Y-%m-%d %H:%M:%S'`（shell 命令，禁止心算）。
- **正确比较**：`当前时间 > 面试结束时间` → 面试已结束（可拉转写）；`面试开始 ≤ 当前 ≤ 面试结束` → 进行中（转写可能还没生成）；`当前 < 面试开始` → 还没开始（不可能有转写）。
- ⚠️ **时间字符串比较易错**：`15:30 < 16:09` 意味着 15:30 **更早**（已过去）。务必想清楚"早/晚"，必要时转成时间戳比较（`date -j -f` 或 Python），不要凭直觉说反。

**路径二：通过腾讯会议 MCP 拉取转写（仅作兜底）**

仅当招活接口 (退出码 3 或 4) 拿不到时使用。前置：已安装并配置 `tencent-meeting-mcp` skill。

1. 从待办拿 9 位 `meetingCode` → `get_meeting_by_code` → meeting_id
2. meeting_id → `get_records_list` → record_file_id
3. record_file_id → `get_transcripts_details` → 完整转写

**路径三：直接提供转写文本（最终兜底）**

1. 用户直接粘贴转写文本，或上传转写文件
2. 接收并保存转写内容

**提示用户**（仅当路径一失败时才主动询问）：
> 「招活内嵌转写接口拿不到（原因：XX），请提供：
> 1. 腾讯会议 ID（9 位会议号），我尝试用 tencent-meeting-mcp 拉取
> 2. 或直接粘贴/上传转写文本（来自飞书会议、手工记录等任何来源）
>
> 💡 如果之前已为该候选人生成过面试计划（场景 C），可以一并提供，我会自动关联分析。」

#### D-2. 关联面试计划（可选）

**触发条件**：用户提供了面试计划文件，或本会话中此前已为该候选人生成过面试计划

**任务**：
1. 读取面试计划内容，提取：
   - **计划问题清单**：核心维度问题 + 追问方向
   - **简历疑点清单**：面试计划中标记的待验证疑点
   - **重点考察维度**：面试计划中标记为重点/关键的维度
   - **预期评分区间**：面试计划中给出的预期评分参考（如有）
2. 将上述信息作为面评生成的额外输入

**自动检测**：如果当前会话中此前已为同一候选人生成过面试计划，主动提示：
> 「检测到本会话中已为该候选人生成过面试计划，是否关联分析？关联后将自动检查计划覆盖率和疑点追踪。」

#### D-3. 生成面评初稿

> 🔴 **D-3 执行前自检 Checklist（必过 · 缺一不可）**
>
> 本节是 D 流程质量基础。**在调用任何生成动作之前**，必须按顺序声明完成下面 8 项；任一项跳过，禁止开始生成面评（否则评分标准凭感觉、红线遗漏、模板错位，质量不可控）。
>
> | # | 必做项 | 完成判据 | 跳过后果 |
> |:---:|---|---|---|
> | 0 | **先确认招聘类型**（校招 / 社招），决定后续拉简历接口和模型路由分发 | 明示 `recruit_type=campus` 或 `social`，校招走 `get_v1_mcp_resume_getResumeByRId`、社招走 `get_api_resume_detail_getresume_with_detail`（必传 `fromPlace=MCP`） | 用错接口 404 / 用错兜底模型 |
> | 1 | 进入 D 前已走 M-Auto 模型路由（主 SKILL.md M-0 章节） | 已调 `scripts/match_model.py` 或在会话上下文中明示锚定模型（校招命中 `model_default_campus`/`model_wxg_backend` 等；**社招目前命中 `model_default_social`（公司价值观兜底，docId=49），暂无岗位级专属模型**） | 评分无锚点，分数靠"内化" |
> | 2 | Read `references/templates/evaluation-template.md` | 已 Read 该文件，明确 6 段式结构 | 面评结构错乱 |
> | 3 | 远程加载 `scoring_rubric_3tier`（通过 `references/_remote-assets.yaml`） | 已实际加载内容（不是"会按三档评分"的口头宣称） | 评分标准缺失（如"核心维度≤2 建议不通过"） |
> | 4 | 远程加载 `risk_screening` | 已加载风险核查清单原文 | 漏掉硬风险项 |
> | 5 | 远程加载 `bg_context`（候选人所在 BG 的业务上下文） | 已加载对应 BG 的产品/业务背景（**校招/社招通用**） | 误判岗位匹配（典型：S3 产品策划被当消费级产品看） |
> | 6 | 判定是否 S3 业务，决定是否加载 `redline_s3` 并加红线区块；判定是否 WXG，决定是否叠加 `qizhi_wxg`（**校招/社招都适用**）；判定是否 TEG，决定是否叠加 `model_teg` | 明确"是 → 已加载" 或 "否 → 跳过"（二选一明示） | 红线/气质叠加遗漏 |
> | 7 | D-2 已检查是否有同候选人面试计划（C 的产物） | 明确"已关联计划 → 走 D-4" 或 "无计划 → 跳过 D-4"（二选一明示） | C↔D 闭环断裂 |
>
> ⚠️ **agent 必须显式输出本 Checklist 的勾选结果**（如"✅ 0 招聘类型=社招 / ✅ 1 已完成（模型：model_default_social·docId=49）/ ✅ 2 已 Read / ✅ 3 已加载 / ... "），然后才进入下面的「必须向用户索取」环节。不允许"我已经按照模板和评分标准做了"这类空泛宣称。
>
> 校验失败处理：哪条没过就回去补哪条，**不允许"跳过这步直接出面评"**。

**必须向用户索取**（极简：如已从会话上下文获得则不重复问）：
- 业务面评价（如有）
- 候选人基本信息

**任务**：
1. 读取评价模板：`references/templates/evaluation-template.md`
2. 加载评分标准：通过 `references/_remote-assets.yaml` 的 `scoring_rubric_3tier` 语义键远程加载（agent 内化使用，不向用户回显原文）
3. 加载风险核查清单：通过 `references/_remote-assets.yaml` 的 `risk_screening` 语义键远程加载（agent 内化使用，不向用户回显原文）
4. 基于转写 + 维度清单，按三档标准生成面评：
   - 将转写内容与各维度对齐
   - 提取关键行为证据
   - 按维度逐项评分（1-5 分）
   - 标注档位标签（推荐/待定/不推荐/🔄转推荐 XX 岗）
   - 配对场景证据
5. 如果是 S3 业务，增加「红线检查」区块
6. **如果已关联面试计划**，额外生成「面试计划执行分析」区块（详见 D-4）
7. 输出结构化面评

**三档评价体系**：
- 🔴 **1-2 分（不推荐）**：必须有明确淘汰原因 + ≥2 个负面行为证据 + 风险说明
- 🟡 **3 分（待定）**：必须有犹豫原因 + 正反两方面证据 + 补充核实建议
- 🟢 **4-5 分（推荐）**：突出核心亮点 + ≥2 个正面行为证据 + 岗位适配理由
- 🔄 **转推荐**：原岗不匹配但候选人值得推荐到其他岗位 → 触发 D-6 转推荐分支（见下）

---

**🔴 硬约束：面评必须同时输出以下 4 块内容，缺一不可**

**① 系统录入版（≤400 字）** — 必出

- **第一句必须是结论**（直接用这 4 种开头之一）：
  - `"结论：推荐进入下一轮。"`
  - `"结论：不推荐本岗位。"`
  - `"结论：待定，建议补充二面或背调。"`
  - `"结论：原岗位（XX）不推荐，转推荐 XX 岗。"`
- 剩余内容按这个顺序：**推荐/转推荐/不推荐的核心理由 → 关键证据 → 简历数字抽查结果 → 价值观 → 评分行**
- 结尾必须有一行评分：`评分：维度A X·维度B X·... · 价值观通过/存疑`

**② IM 速递版 / 微信转发版（≤200 字）** — 必出

> 📌 **命名说明（澄清）**：这里的"微信"指**微信/企业微信等即时通讯工具**，是给**面试官快速转发给招聘经理/HR/下一轮面试官**用的简版，**与微信事业群（WXG）无关**。适用于全集团所有 BG。也可以叫"IM 速递版"。

- 连贯叙述、无标题无分点、第一句即结论
- 末尾必须给出明确行动建议（"可以直接面" / "建议背调" / "建议转推荐到 XX"）
- 🔴 **保密硬规则**：IM 速递版是面试官之间流转的、**也可能被前/后轮面试官分享**的内容，绝对禁止引用"前轮面评说…"、"上一位面试官觉得…"等措辞；本轮结论与证据必须**独立成立**（基于本轮转写 + 简历事实 + 测评数据），不能借用或转述前轮面评的判断。

**③ 简历漂亮数字抽查结果（新增硬区块）** — 必出

| 简历原文数字 | 现场追问口径 | 归因结论 | 真实性判断 |
|---|---|---|---|
| 例："无效简历-35%" | 无效定义 = HR 端业务匹配主观判断 | 个人小改进 | 可解释，无造假，属贡献夸大边缘 |

若简历全文无数字或本轮未追问 → 区块保留，标注"⚠️ 本轮未做数字抽查"。

**④ 测评档位×面试行为对照（新增硬区块）** — 必出（若有测评数据）

> 🔴 **档位口径硬规则**（v3.6 整改 · 必读）：
> - `qualityAssessmentResults[].result` 是**档位**（**1=低 / 2=中 / 3=高**），**不是分数**！
> - 表头**只能写"测评档位"**，禁止写"测评分"/"分数"
> - **只有档位 1 才算预警（红点）**；档位 2/3 都是正常，**禁止标红点 ●、禁止生成"反驳测评"判定**
> - 不要在描述里写"1-3 分制"、"答题异常 0→结果可信"等编造的口径
> - 若所有维度 ≥2 档 → 本区块写"✅ 测评档位全部 ≥2，无预警，本轮不作为判断依据"，**不出表格**

**仅当存在档位=1 的维度时才出对照表**（举例）：

| 测评维度 | 档位（1低/2中/3高）| 面试行为证据（转写原文引用或归纳） | 判定 |
|---|:---:|---|---|
| 自驱力 | **1** | 本科选运营自述"身边同学都在做"、对摩卡系统吐槽但未动手改进 | 🔴 **佐证测评红点** |
| 长期主义 | **1** | 现场被问到职业规划时反复修改答案、缺乏长期视角 | 🔴 **佐证测评红点** |
| 沟通能力 | **1** | 但现场表达流畅、被 Q8 压力问题后能稳住立场 | 🟢 **反驳测评红点** |

> ⚠️ 档位 2/3 的维度**不进表格**、**不标红点**，直接在区块顶部写"档位 2/3 维度（XX/XX/XX）测评无预警"一句话即可。

若无测评数据 → 区块保留，标注"⚠️ 无测评数据，跳过"。

---

**字数校验（必跑）**：

生成两版后必须调用 `scripts/format_evaluation.py` 做字数/重复/空话检测：

```bash
python3 scripts/format_evaluation.py <file> system  # 校系统版 ≤400 字
python3 scripts/format_evaluation.py <file> wechat  # 校微信版 ≤200 字
```

超字 → 自动精简重出，不合格**不允许交付**。

---

#### D-3.5 🚫 「写面评」 ≠ 「提交面评」（v4.6 新增 · 必须区分）

> **背景**：D 流程的能力是**自动生成两版面评草稿**（系统版 ≤400 字、微信版 ≤200 字），**不是替用户提交**。提交面评必须由用户在简历详情页（招活前端）手工完成——页面上有"评分等级、维度勾选、签名提交、是否邀复试、面试结果"等字段需要面试官**亲自确认 + 责任签字**。
>
> 🚨 **agent 必须严格区分这两件事，不要替用户走最后一步**。

**关键词识别**：

| 用户话术 | 真实意图 | 路由 |
|---|---|---|
| "帮我写面评" / "写一下面评" / "面评帮我搞" / "帮 XX 写面评" | **写面评草稿** | ✅ 走 D 流程（D-1 拉转写 → D-3 出双版本草稿） |
| "帮我提交面评" / "提交面评" / "录入系统" / "把面评填到系统里" / "帮我录面评" / "发了" / "确认提交" | **提交面评到系统** | 🚫 **不要替用户做**，引导去简历页操作 |
| "录面评" / "填面评" | **意图模糊** | ⚠️ 反问 1 句："是要我**写面评草稿**（生成系统版+微信版文本），还是要**提交面评到系统**（这步必须你在简历页操作）？"再决定 |

**「提交面评」的固定回复模板**（强制使用，禁止改写或自创）：

```
✅ 面评草稿已为你生成（系统版 / 微信版见上文）。

⚠️ **提交面评到招聘系统这一步需要你亲自在简历详情页操作**——
页面要选评分等级、勾选胜任力维度、签名提交、是否邀复试等关键字段，必须由你确认。

请打开候选人简历详情页提交：
👉 校招：https://zhaopin.woa.com/resume/campus/ResumeDetail?rid={rid}
👉 社招：https://zhaopin.woa.com/resume/resume_detail?rid={rid}&fromplace=MCP

提交时直接复制上面的【系统版】文本粘到"面评内容"栏即可。
```

⚠️ **rid 获取规则**：
- 校招：从 D-1 简历数据 / T 待办 联动得到的 `resumeRid`
- 社招：从 `resolve_social_rid.py` 反查（社招 todo 不返回 rid，详见 T-2-RID）
- 两者都没有 → 反问"请提供候选人 rid"
- **严禁**编造 rid

🚨 **执行硬约束**：
- **禁止**调用任何 `post_v1_evaluation_save` / `post_evaluation_submit` 类 API "替用户提交"——这种 API 即使存在也会让用户失去对评分等级、邀复试与否、签名等关键字段的控制权
- **禁止**自创"代提交完成"等措辞误导用户以为已经提交了
- **禁止**在草稿里凭空补"评分：4 分"等需要面试官个人决策的字段——这些字段由用户在页面打勾时填，不在 agent 生成的双版本文本里

---

#### D-4. 面试计划执行分析（C→D 联动）

**触发条件**：D-2 中已成功关联面试计划

**任务**：在面评报告末尾追加「面试计划执行分析」区块，包含以下四部分：

**1. 计划覆盖率检查**
- 对比面试计划中的核心问题 vs 转写内容
- 逐一标注每个计划问题的覆盖状态：✅ 已覆盖 / ⚠️ 部分覆盖 / ❌ 未覆盖
- 计算覆盖率百分比
- 如果覆盖率 < 60%，提示：「⚠️ 面试计划覆盖率较低（XX%），建议安排追加面试或补充电话沟通。」

**2. 疑点追踪**
- 面试计划中标记的每个简历疑点，在面评中标注追踪状态：
  - ✅ **已验证**：面试中明确追问并获得回应，附转写证据
  - ⚠️ **部分验证**：面试中有涉及但未深入，附已获信息
  - ❌ **未验证**：面试中未涉及该疑点
- 未验证的疑点标注为「面试遗留项，建议后续核实」

**3. 重点维度追踪**
- 面试计划中标记为「重点考察」的维度，在面评中标注：
  - 面试中的考察深度：充分 / 一般 / 不足
  - 是否获得了足够的行为证据来评分

**4. 预期 vs 实际评分对比**（如面试计划中有预期评分）
- 展示对比表格：

```
📊 预期 vs 实际评分对比：

| 维度 | 预期评分区间 | 实际评分 | 偏差 | 说明 |
|------|------------|---------|------|------|
| 协作性 | 3-4 分 | 4 分 | ✅ 符合预期 | 面试中展现了良好的团队协作案例 |
| 自驱力 | 4-5 分 | 3 分 | ⚠️ 低于预期 | 面试中内在动机表现弱于简历印象 |

⚠️ 偏差较大的维度建议复核评分依据。
```

**输出位置**：面评初稿的「系统提交版」和「微信版」之后，作为独立的分析区块输出。不计入系统提交版 400 字和微信版 200 字的字数限制。

#### D-5. 下一轮面试题自动串联（新增，C↔D 闭环）

**触发条件**：D-3 面评初稿生成完毕，**且** D 后续的质量检测（如启用）也已完成

**任务**：在面评交付后，主动询问用户是否继续生成下一轮题目：

```
✅ 本轮面评已完成（{候选人}，{本轮环节}）。

📅 接下来这位候选人还要参加哪一轮？
[1] 复试
[2] 终面
[3] HR 面
[4] 自定义环节
[5] 已定 Offer / 已淘汰 — 不需要下一轮

选择 1-4 → 我直接帮你出下一轮的面试题
选择 5 → 本轮流程结束
```

**用户选 1-4 时**：
1. 自动打包输入：
   - 候选人简历（本会话已有）
   - **本轮面评**（刚生成的，作为「上一轮面评」传入）
   - 岗位面试设计方案（本会话已加载或重新匹配）
   - 下一轮环节（用户刚选的）
   - 活跃模型
2. 自动跳转场景 C-3，按"前轮面评驱动"规则出题：
   - 本轮存疑点 → 下一轮专项验证
   - 本轮已验证的强项 → 下一轮不再重复
3. 输出下一轮面试计划（走完整 C-4 输出流程）

**用户选 5 时**：
```
👋 好的，本位候选人的面试流程已结束。
   本轮面评已保存，后续可在招聘系统查看。
```

**为什么要做这个串联**：
- 招聘经理/面试官的实际工作流是"填完这轮面评 → 马上要准备下一轮"
- 手动跳转场景 C 需要重新说明候选人 / 岗位 / 前轮面评，体验断裂
- 自动串联让面评成为下一轮题目的上游输入，形成闭环

**跨会话场景**：
如果是新会话（用户第二天才来处理下一轮），用户可以直接进场景 C，主动上传：上轮面评文件 + 简历 + 本轮环节。C-1/C-2 会完成同样的流程。

---

#### D-6. 转推荐分支（新增）

**触发条件**：D-3 结论为 🔄 转推荐，即 `原岗位核心维度不达标但候选人在其他岗位方向有明确匹配`。

**典型场景**：
- HR AI 产品岗 → 原岗产品思维+AI 理解不达标 → 但招聘业务执行经验完整 → 转推招聘经理 / HRBP
- 用研岗 → 原岗数据分析不达标 → 但内容创作/用户洞察强 → 转推策划/内容岗
- 游戏策划岗 → 原岗系统设计不达标 → 但美术 sense + 游戏热爱强 → 转推美术策划

**D-6 必须在面评文末追加的 handoff 区块**：

```markdown
## 📤 给接手面试官的 Handoff（转推荐说明）

### 候选人一览
- 姓名 / 学校 / 专业 / 届次
- RID + 校招系统链接
- 内推人 / 推荐时间
- 期望城市 / BG 偏好

### 为什么适合转推荐到 {目标岗位}（表格 4-6 条）
| 要点 | 证据（引用转写或简历原文）|

### 需要接手面试官注意的点（2-4 条）
1. 原岗位未达标的维度在新岗位是否也是短板
2. 简历数据的口径问题（如有）
3. 测评红点在新岗位下是否仍是风险

### 建议转推方向优先级（表格）
| 方向 | 匹配度 | 说明 |
| 🟢 {最匹配岗} | ★★★★★ | ... |
| 🟢 {次匹配岗} | ★★★★ | ... |
| 🟡 {勉强匹配} | ★★ | ... |
| 🔴 本次已验证不匹配 | ★ | ... |
```

**D-6 特别规则**：
- 转推荐 handoff 区块**不计入系统版 400 字字数限制**
- 系统版第一句结论必须写清楚"原岗 XX 不推荐，转推 XX"
- 微信版必须包含"建议转推到 XX 岗"的明确行动建议

---

## 模型来源

> 本 Skill 不自管模型。所有模型和 JD 由「甄选质量专家」(assessment-quality-expert) 搭建并导出。
> 
> `references/models/` 目录仅存放甄选质量专家导出的模型文件。
> `references/jds/` 目录存放甄选质量专家导出的 JD 文件。

---

## 评价原则

- **结论先行，证据支撑**：先给结论，再给理由
- **具体行为事例**：所有判断必须有具体事例，禁止空话
- **不机械套用维度**：允许灵活结论（如「某维度未达标但综合判定可用」）
- **客观中立**：不主动美化候选人
- **语言专业但不官僚**：避免套话和模板式语言

---

## 禁止项

- ❌ 信息不足时不强行输出，直接告知缺少哪些信息
- ❌ 不主动美化候选人，保持客观中立
- ❌ 未收到面试转写记录前，不生成任何评价文档
- ❌ 评价必须有具体行为事例，不写「沟通能力强」此类空话
- ❌ **禁止在未确认维度定义的情况下，自行理解评价标准**
- ❌ **禁止在未确认模型来源的情况下进行简历筛选、出题或面评**——至少需要用户确认使用专属模型、上传模型、标杆库模型或内置兜底模型之一

---

## 面评质量检测（D 场景后自动触发）

面评生成完毕后，**自动提示用户是否启用质量检测**：

```
📋 面评已生成。是否启用面评质量检测？

[1] 启用质量检测 — 自动检测空话、证据链、评分一致性（推荐）
[2] 跳过 — 直接使用
```

**启用后的两种路径**（自动降级）：

**路径 A（兜底，本 skill 内置）**：使用 `scripts/format_evaluation.py` 做基础检测：

```bash
# 系统版字数 + 空话检测
python3 scripts/format_evaluation.py <面评文件> system

# 微信版字数 + 空话检测
python3 scripts/format_evaluation.py <面评文件> wechat
```

内置脚本能检测：字数超标 / 空话比例过高 / 相同表述重复。

将审计结果展示给用户，如有问题给出修改建议。

---

## 风险核查

所有风险核查项独立于面试维度，面试中旁敲侧击核实。

通过 `references/_remote-assets.yaml` 加载（agent 内化使用，不向用户回显原文）：
- 风险核查清单：语义键 `risk_screening`（覆盖校招学历真实性/身心/亲属、社招竞业/背调）
- BG 红线追加：候选人 BG 命中特殊条线时叠加，语义键 `redline_s3`

---

## 腾讯集团业务背景

分析候选人背景和生成面试问题时，必须结合腾讯的 BG 业务特征、组织文化和人才市场背景进行判断，不要使用泛化的互联网行业视角。

通过 `references/_remote-assets.yaml` 的 `bg_context` 语义键加载（agent 内化使用，不向用户回显原文；覆盖 IEG/WXG/TEG/CSIG/PCG/CDG 各 BG 特征、文化、人才市场背景）。

---

## 工具依赖

- **招活转写接口（首选）**：校招 `recruit.interview-arrange-campus.get_interview_trace_record` / 社招 `recruit.interview-arrange.get_interview_trace_record`，由 `recruit-mcp` 提供。配套脚本：`scripts/fetch_transcript.py`（一键拉转写，已处理大返回截断 / JSON 解析 / userId 对齐 / 校招社招路由，通过 `--recruit-type campus|social` 选择）。详见 `references/transcripts/recruit-trace-api.md`
- **腾讯会议转写（兜底）**：仅当招活接口拿不到时使用，需先安装并配置 `tencent-meeting-mcp` skill
- **招聘 MCP（recruit-mcp）**：通过 `mcporter` 管理，是本 skill 的**必装前置依赖**。T/T2/S/A/B/C/D 正式流程的候选人主数据、待办、简历、测评、流程状态、面试安排均以 recruit-mcp 为来源
  - 服务地址：`https://zhaopin.mcp.it.woa.com`
  - 鉴权：🆕 只需太湖授权（弹窗连接走太湖 SSO，或 mcp.json 配 `Authorization` 一个 header）；旧版「招活 `recruit-Authorization`」已下线
  - 🔴 **禁止**用 `mcp_add` / `mcp_call_tool`（不是系统 MCP），统一走 `mcporter config add` 配置、`mcporter call` 或 `scripts/mcporter_call.py` 调用
  - 安装引导见「启动检查 §3-①」和「场景 C C-0」，所有步骤在本对话内完成，不用打开其他 skill 目录
- **待办解码工具**：`scripts/decode_todo.py` — 面试待办 JSON 的中文解码（场景 T 专用）
- **简历解码工具**：`scripts/decode_resume.py` — 简历 JSON 的中文解码（场景 C 专用）
- **格式化工具**：`scripts/format_evaluation.py` — 面评输出的字数控制、重复检测和格式规范检查。支持两种模式：
  - `python format_evaluation.py <file> system` — 系统提交版（≤400 字）
  - `python format_evaluation.py <file> wechat` — IM 速递版 / 微信转发版（≤200 字）
- **MCP 调用脚本**：`scripts/mcporter_call.py` — 跨平台 mcporter 调用封装
  - 解决 Windows `cmd.exe` 将 keyword 中 `|` 当管道符截断的问题
  - 解决 subprocess 调用 mcporter 时 cwd 不在 Workspace 根导致 "Unknown MCP server" 的问题
  - 搜索接口输出 JSONL（第一行 `_meta`，后续每行一条简历），避免大 JSON 被缓冲截断

---

## MCP 调用技术细节（场景 T / 场景 A / 场景 C C-0 的实现参考）

### 何时直接用 `execute_command`，何时用 `mcporter_call.py`

| 场景 | params 是否含 `|` | 平台 | 推荐方式 |
|------|-----------------|------|---------|
| `get_campus_interview_todo_list`（场景 T 待办） | 否 | 全平台 | ✅ 直接 `execute_command` 调 `mcporter call` |
| `post_v1_evaluation_todoList`（场景 T2 推荐待办） | 否 | 全平台 | ✅ 直接 `execute_command` 调 `mcporter call`；若环境有 recruit-mcp 专用工具，按平台规范完成能力检索后调用 |
| `getResumeByRId`（场景 C 拉简历） | 否（只有 rid） | 全平台 | ✅ 直接 `execute_command` 调 `mcporter call` |
| `getTagList` / `getStationList` 等字典接口 | 否 | 全平台 | ✅ 直接 `execute_command` |
| `post_v1_resume_search`（场景 A 搜索） | 否（keyword 是纯文字） | 全平台 | 直接 `execute_command` 也可 |
| `post_v1_resume_search`（keyword 含 `|`） | 是 | Windows | 🔴 **必须用** `scripts/mcporter_call.py` |
| `post_v1_resume_search`（keyword 含 `|`） | 是 | macOS/Linux | 推荐用脚本保持一致（直接 shell 也可） |
| 简历收藏 / 锁定 | 否 | 全平台 | ✅ 直接 `execute_command` |

### 使用 `scripts/mcporter_call.py` 的标准流程

```bash
# 1. 拿到 mcporter 路径
which mcporter          # macOS/Linux
where mcporter          # Windows

# 2. 把 params 写入 params.json（避免命令行传参被截断）
cat > $TMP_DIR/params.json <<'EOF'
{"keyword":"后台开发|后端开发|服务端","schoolLevel":["985"],"pageNum":1,"pageSize":30}
EOF

# 3. 调脚本（脚本内部会自动 cd 到 Workspace 根目录，以便加载 Project config）
python3 /path/to/interview-assistant/scripts/mcporter_call.py \
  "<mcporter_path>" recruit-mcp CallAPI \
  recruit.campus-resume-search.post_v1_resume_search \
  $TMP_DIR/params.json $TMP_DIR/result.jsonl

# 4. 读取结果（JSONL 格式）
# 第 1 行是 {"_meta": {"total": N, "status": 0, ...}}
# 后续每行一条简历 JSON
```

### 鉴权异常排查速查

| 现象 | 原因 | 处理 |
|------|------|------|
| `mcporter list` 不显示 recruit-mcp | 配置未生效或 `cwd` 不对 | 执行 `mcporter config doctor` 看它实际加载了哪两个配置 |
| 返回 `401 Unauthorized` | 太湖 Token 过期 | 重跑 `tai-oauth` 脚本 或 到 https://tai.it.woa.com/user/pat 重新创建 PAT，再 `mcporter config add` 覆盖一次 |
| 返回 `403` | 招聘平台业务权限不足（非 token 问题；如缺面试官权限）| 到 hrright.woa.com 申请对应权限；🆕 连接已只认太湖授权，无需再申请「招活 Token」 |
| 返回 `Unknown MCP server 'recruit-mcp'` | subprocess cwd 错 | 脚本内部已修复；如仍报错，设置环境变量 `MCPORTER_WORKSPACE=<包含 config/mcporter.json 的目录>` |
