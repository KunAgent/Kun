# 面试助手 · A 简历详情子模块（v4.1 改造版 · 仅按 RID 拉单份详情）

> 子模块路径：`flows/A-resume-detail.md`
> 触发：在主 SKILL.md 的 Router-0 命中"按 RID 拉简历详情"后，**第一件事是 Read 本文件**，再执行内部步骤。
> v4.1 改造说明：原 `A-resume-search.md`（含 A-1 批量搜索）已**剥离**至 `zhaopin-operations` / `zhaopin-social-operations`，本文件只保留 A-2 拉详情 + A-3 联动跳转。

<!-- skill-tracker sub_flow: begin (auto-generated) -->

> 🚨 **FIRST ACTION（读到本文件第一件事 · MANDATORY · 静默执行）**：上报 `sub_flow_entered` 事件，标记本次进入了 **`A` 子流程（按 RID 拉简历详情）**。这是 v4.6 双轨埋点的精准维度——配合 SKILL.md 主 FIRST ACTION 的 `skill_invoked`，看板能拉出"哪个 sub_flow 用得最频繁"。

```bash
bash ./scripts/track.sh "0WEB06ZI7OVDOZQW" "interview-assistant" "sub_flow_entered" '{"session_id":"'"$(date +%s)"'","sub_flow":"A","sub_flow_name":"按 RID 拉简历详情"}'
```

**约束**：每次读到本文件就执行一次（不要因为同会话内"刚跑过"就跳过）。静默后台，失败容忍，不询问用户。

<!-- skill-tracker sub_flow: end -->

---

## 🚪 v4.1 治理硬规则（CRITICAL）

**本子模块不承担批量搜简历职责。** 用户提到任何以下诉求时，**立即停手**，告知用户跳转专业 skill：

| 用户诉求 | 跳转目标 |
|---|---|
| "搜简历"/"找候选人"/"找几个 985 候选人"/"校招搜索" | 🚪 `zhaopin-operations` skill |
| "社招简历"/"找有 5 年经验的人"/"社招搜索" | 🚪 `zhaopin-social-operations` skill |
| "不知道是校招还是社招" | 反问 1 句"校招还是社招？"，明确后跳转 |

🚨 **严禁**在本子模块内调用：
- ❌ `recruit.campus-resume-search.post_v1_resume_search`
- ❌ 社招的批量搜索 API
- ❌ `getStationList` / `getTagList` 等"用于搜索"的辅助接口

✅ **本子模块允许调用**：
- ✅ `recruit.campus-resume-search.get_v1_mcp_resume_getResumeByRId`（按 RID 拉单份简历详情）
- ✅ `recruit.campus-resume-search.get_v1_favorite_addResume`（收藏简历，A-3 联动）
- ✅ `recruit.campus-resume-search.post_v1_resumeRecommend_lockCampusResume`（锁定简历，A-3 联动）

**为什么这么严**（v4.1 治理背景）：
- 历史踩坑：interview-assistant 内部的简化版搜索没有 `guides/resume-filtering-manual.md`，遗漏了 `海外QS100高校` 等正确 schoolLevel 值，召回 0 条
- `zhaopin-operations` 有专业的 6 步流程（环境预检 → 解析需求 → 多轮调整 → 粗筛 → 精读 → Top10 推荐），与 interview-assistant 简化版差距大
- 拆分后职责清晰：interview-assistant 专注"已知候选人的执行链路"，搜索由专业 skill 承接

---

## 📥 触发条件

满足以下任一条件，进入本子模块：

1. **用户明确给出 RID**：如"看一下 RID `c808490b-2ba1-4efe-85bf-d8d2295dc7fe` 的简历"
2. **来自 T 待办联动**：用户从 T 待办列表选择"查看简历"操作
3. **来自 zhaopin-operations / zhaopin-social-operations 跳回**：用户在外部 skill 选定候选人后，需要在本 skill 里继续做评估/出题/面评等操作

> 💡 **判断技巧**：如果用户**没给 RID**且要求"找几个候选人"，那不是本子模块的活，**立刻**走 v4.1 治理硬规则跳转。

---

## A-1. 拉取简历详情（核心步骤）

### 调用方式

```bash
mcporter call recruit-mcp CallAPI \
  apiId='recruit.campus-resume-search.get_v1_mcp_resume_getResumeByRId' \
  params='{"rid":"${rid}"}' \
  > $TMP_DIR/resume_raw.json 2>&1
```

> 🔴 **编码硬规则**（与主 SKILL 一致）：
> 1. 必须 `> $TMP_DIR/resume_raw.json 2>&1`，禁止直接读终端 stdout
> 2. 必须用 `scripts/decode_resume.py` 解码后再读
> 3. Read 工具打开 decoded 文件，亲眼确认是中文不是乱码

### 解码与读取

```bash
python3 scripts/decode_resume.py $TMP_DIR/resume_raw.json $TMP_DIR/resume_decoded.txt
```

然后用 Read 工具打开 `$TMP_DIR/resume_decoded.txt`，确认中文正确。

### 数据结构注意事项

- ⚠️ 返回数据路径为 `response.data.data.data.resumeInfo`（**三层 `data`**）
- ⚠️ `resumeInfo.name` 可能脱敏为 `*****`：
  - 如果是从 T 待办联动来的，用待办里的 `name` 字段回填
  - 如果是从 zhaopin-operations 跳回的，用搜索接口返回的 `name` 字段（按 `rid` 关联）回填
  - 如果都没有，说明 RID 不属于当前用户权限范围，**不要猜测姓名**
- ⚠️ 批量按 RID 拉详情时（如 T 待办列表展开多条）：
  - 每条间隔 300ms
  - 每批最多 10 条
  - 超过分批并间隔 3-5 秒
  - 404 跳过（说明该 RID 已失效或无权访问）

### 提取的结构化字段

```
基本信息：name / sex / educationTxt / school / speciality / graduateTime / rankLevelTxt
教育经历：educationList[] - SchoolName / Degree / Major / GPA / SchoolLevel
实习经历：workExperienceList[] - EmployerName / Position / Content / Dration
项目经历：projectList[] - ProjectName / Content
获奖信息：resumePrizes[]
技能标签：skillTag[] / dev_language[] / techDirectionsTxt[]
游戏经历：resumeGameExp[]（策划岗位重点参考）
AI 能力：ai_skill（如有）
应聘信息：stationTxt / subDirectionName / intentBgTxt / iDeptTxt / expectWorkCityTxt
流程状态：currentStep / flowStatusTxt
面试记录：interviewRecords.list[].flows[]（含历史评价 — 注意保密红线）
测评信息：qualityAssessmentResults[]（注意"档位"口径，1=低/2=中/3=高）
```

> 🔴 **前轮面评保密**（合规红线）：从简历接口返回的 `interviewRecords[].flows[].result_txt`/`comments` 及 `assessList`，**只进面试官内部参考区**，不得复制到面向候选人的产出中（如面试题正文、微信转发版）。

---

## A-2. 展示简历详情

### 标准展示格式

```
📄 候选人简历详情 — {姓名}
🔗 详情链接：https://zhaopin.woa.com/resume/campus/ResumeDetail?rid={rid}

## 基本信息
- 学校：{最高学历学校} | 专业：{专业} | 学历：{学历}
- 毕业时间：{毕业时间} | 评级：{评级}
- 投递岗位：{岗位}（{细分方向}）
- 意向 BG：{BG} | 意向部门：{部门}
- 期望城市：{城市}
- 技术方向：{技术方向}

## 教育经历
[逐条展示]

## 实习经历
[逐条展示，含公司、岗位、工作描述]

## 项目经历
[逐条展示，含角色和介绍]

## 获奖信息
[奖学金、竞赛]

## 技能 & 特长
- 技能标签：{标签列表}
- 开发语言：{语言列表}
- AI 技能：{如有}
- 游戏经历：{品类、游戏名、时长}（仅策划/游戏相关岗位展示）

## 附件
- 简历文件：{预览链接}
- 作品附件：{如有}

## 流程状态
- 当前状态：{流程状态}
- 面试记录：{历史记录 — 仅展示环节/时间，前轮评语不公开展示}
- 测评结果：{各维度档位，注意 1 档预警 / 2-3 档正常}
```

### 展示规则

- 候选人姓名在腾讯内部 WorkBuddy 招聘会话中**正常展示**
- 系统已脱敏的字段（如 `*****`）保持脱敏，**不猜测**真实值
- 手机号、邮箱、身份证号、详细联系方式等敏感字段**默认不展示**
- 标注异常标记（cheatFlag / badFlag）
- 标注锁定状态（如已被其他 BG 锁定）

---

## A-3. 联动到其他场景

展示完简历详情后，引导用户选择下一步：

```
📋 你可以对该候选人执行以下操作：

[1] 简历评估 — 基于胜任力模型评估匹配度（进入场景 B）
[2] 面试计划 — 基于简历生成个性化面试题（进入场景 C）
[3] 安排面试 — 给该候选人下面试单（进入场景 S）
[4] 写面评 — 该候选人已面过，要写面评（进入场景 D）
[5] 收藏简历 — 加入收藏夹
[6] 锁定简历 — 锁定到当前 BG（不可逆操作前需二次确认）
[7] 想找更多类似候选人 — 🚪 跳转 zhaopin-operations / zhaopin-social-operations

输入序号 + 操作（如 "1 评估" 或 "2 出题"），或直接说你想做什么。
```

### 自动联动规则

- **→ 简历评估（B）**：本子模块拉到的简历详情直接作为 B 场景输入，**无需用户重新提供简历**
  - 简历来源标注为「校招系统 — RID: {rid}」
  - 评估报告中附上简历详情链接
- **→ 面试计划（C）**：简历详情传递给 C 场景，进入 C-0 → C-1 → C-2 流程
- **→ 安排面试（S）**：用 RID 进入 S 场景，先走 S-0 路由决策
- **→ 写面评（D）**：用 RID 进入 D-1 拉转写
- **→ 收藏简历**：通过 mcporter 调用
  ```bash
  mcporter call recruit-mcp CallAPI \
    apiId='recruit.campus-resume-search.get_v1_favorite_addResume' \
    params='{"resumeId":${resumeId}}'
  ```
  ⚠️ `resumeId` 是数字字段（不是 `rid` UUID）。如果上下文里只有 RID，需要先从简历详情里拿到 `id` 字段
- **→ 锁定简历**：通过 mcporter 调用
  ```bash
  mcporter call recruit-mcp CallAPI \
    apiId='recruit.campus-resume-search.post_v1_resumeRecommend_lockCampusResume' \
    params='{"rid":"${rid}"}'
  ```
  ⚠️ **锁定前必须二次确认**：「锁定后其他 BG 将无法查看该简历，确定要锁定吗？」
- **→ 想找更多类似候选人**：🚪 **不在本子模块继续**，告知用户"批量搜简历由专业 skill 承担，我把请求转给 `zhaopin-operations`（校招）/ `zhaopin-social-operations`（社招）"

---

## 数据映射规则（A-2 → 后续场景）

| A-2 拉到的字段 | 映射到下游场景 |
|-------------|--------------|
| `educationList` | B 简历评估 / C 出题：教育背景 |
| `workExperienceList` | B / C：实习/工作经历（C-1 经历深挖优先题源） |
| `projectList` | B / C：项目经验（C-3 数字抽查重点） |
| `skillTag` + `dev_language` | B：技能匹配；C：基础能力题选型 |
| `resumePrizes` | B：加分项 |
| `resumeGameExp` | C 策划岗位：游戏品类深挖 |
| `ai_skill` | C：AI 能力题方向 |
| `qualityAssessmentResults` | C：测评档位（1 档预警 → Part 3 红点题） |
| `interviewRecords.flows` | C：本轮面试环节判断；D：前轮面评（**保密**，仅进内部参考区） |
| `gpa` / `gpaBase` | B：学业成绩 |
| `paper` / `lab` / `direction` | B / C：科研经历（研究岗位） |

---

## 不再适用的内容（已迁移到外部 skill）

以下能力**不再**由本子模块承担，需要时**跳转**到对应 skill：

| 能力 | 迁移到 |
|---|---|
| 关键词搜索（keyword + 学校 + 专业 + 毕业时间等多维筛选） | `zhaopin-operations` |
| 岗位 ID 查询（getStationList） | `zhaopin-operations` |
| 标签查询（getTagList / getPlayGameCategories） | `zhaopin-operations` |
| 多份简历批量对比（B2 批量评估前置的批量搜索） | `zhaopin-operations` 搜出来后再回 B2 |
| 社招简历搜索（按公司、年限、领域） | `zhaopin-social-operations` |
| 翻页搜索 / 调整搜索条件 | `zhaopin-operations` / `zhaopin-social-operations` |

> 💡 历史版本（v4.0 之前）的"A-1 搜索简历"流程已完整迁移至 `zhaopin-operations` skill 的 6 步流程中，包含更专业的筛选条件速查表（`guides/resume-filtering-manual.md`）和粗筛/精读两阶段处理。
