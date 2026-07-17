# 类目 ⑤ 复盘 · 单场自评（E-coach-self）

> **场景**：面试官**给自己**做单场面试复盘——基于一场已完成面试的转写，输出 5 维行为评估 + 改进建议 + 存档。
>
> **触发词**：复盘我最近一场 / 复盘我刚刚那场 / 评一下我面试得怎样 / 给我做面试自评 / 复盘 traceId=xxx

---

## E-0 · 进入门槛与硬规则

| 规则 ID | 内容 |
|---|---|
| E-RULE-1 | **必须有转写才能评**——拿不到转写不允许凭印象给分。无转写时降级到 E-X（仅记录意图） |
| E-RULE-2 | 评估口径用 **优 / 良 / 中 / 弱**——**不要**跟 D 面评对候选人的 1/2/3 档混用 |
| E-RULE-3 | 引用证据**只引用面试官提问/反馈原话**，不引用候选人原话（避免泄露候选人隐私） |
| E-RULE-4 | 输出必须**至少 1 条具体可操作改进建议**，禁止"建议加强 XX 能力"这种泛泛话术 |
| E-RULE-5 | 评估完毕**必须**调 `save_coach_eval.py` 存档（这是 G 成长报告的数据来源） |
| E-RULE-6 | widget 探活，**有就出卡片**（按 `references/coach/widget-spec.md` §2），**没有就 ASCII + Markdown** |

---

## E-1 · 锁定要评的那场面试（traceId）

判别用户输入：

| 用户说法 | 拿 traceId 的方式 |
|---|---|
| "复盘我最近一场" / "刚刚那场" | 跑 `scripts/fetch_completed_interviews.py --limit 5`（校招走已办接口）→ 取最近一条的 `trace_id` |
| "复盘 traceId=<TRACE_ID>" 直给 | 直接用 |
| "复盘候选人张三的那场" | 跑 `fetch_completed_interviews.py` → 按候选人姓名 fuzzy 匹配 → 命中 1 条直接用，多条问用户选 |
| 没说清 | 跑 `fetch_completed_interviews.py --limit 5` 列最近 5 场让用户挑数字（**不要**列 10 场） |

> 🆕 **v4.6**：已完成面试用 `scripts/fetch_completed_interviews.py`（校招已改走 `get_campus_interview_done_list` 已办接口，直接拿到完整 `trace_id` + 现成面评 `eval_comment`/`eval_rank`）。
> - **traceId 用完整值**（脚本已修为完整输出，不再截短）——截短会定位到错误场次。
> - 已办接口直出的 `eval_comment` 仅作**补充参考**：E 复盘核心仍是**转写**（E-RULE-1），拿不到转写时**不能**用面评 comment 代替行为评估，仍走 E-X 降级。

### E-1.5 · 转写探活

```
fetch_transcript.py --trace-id <id> --output /tmp/transcript-<id>.txt
```

| 退出码 | 处理 |
|---|---|
| 0 | ✅ 进 E-2 |
| 3（转写为空） | ❌ 该场未开转写，**禁止**评估，告知用户："这场面试当时没开转写，无法做行为复盘。下次面试前记得在腾讯会议里勾选'开启转写'。" |
| 其他失败 | 走 D-1 现有降级链（招活 → 腾讯会议 → 用户手动粘贴）|

---

## E-2 · 加载评估知识 + 模型路由

按以下顺序 Read（必读）：

```
1. references/coach/bei-framework.md     ← BEI / STAR 方法论
2. references/coach/scoring-rubric.md    ← 优/良/中/弱 行为锚点
3. references/coach/widget-spec.md       ← 输出格式
```

**模型路由**（继承 M-Auto 能力）：

```
从 T 待办或转写元数据提取 stationTxt + bg_txt + recruitType
→ 调 scripts/match_model.py 命中 references/models/<bg>-<station>-<recruitType>.md
→ 拿到该角色应该考察的"维度清单"
→ 用于 E-3 的【维度覆盖诊断】
```

命中失败 → 用 `references/models/_index.md` 兜底维度（专业匹配/项目深度/逻辑思维 等通用 5 维）。

---

## E-3 · 投喂转写 + LLM 评估

把转写 + bei-framework + scoring-rubric + 模型维度清单一并投喂，让 LLM 输出**结构化 JSON**：

```json
{
  "scores": {
    "question_effectiveness": "良",
    "question_targeting": "良",
    "follow_up_completeness": "中",
    "follow_up_depth": "弱",
    "follow_up_flexibility": "良"
  },
  "behavior_norm": {
    "opening": "达标",
    "atmosphere": "部分达标",
    "closing": "达标",
    "time_management": "部分达标"
  },
  "metrics": {
    "duration_min": 58,
    "bei_ratio": 0.62,
    "star_completeness": 0.75,
    "core_dimension_coverage": "2/2",
    "comprehensive_subdim_coverage": "1/3"
  },
  "coverage": {
    "must_covered": ["专业匹配", "项目深度"],
    "must_missing": [],
    "suggested_partial": ["系统设计能力"],
    "subdim_covered": ["学习力"]
  },
  "highlights": [
    "BEI 题占比 62%，提问设计合格",
    "项目深度的追问从架构选型追到了上线后的灰度策略"
  ],
  "improvements": [
    "追问深度：候选人 4 次说'我们做了 XX'时，仅 1 次被追到'你个人在其中具体做了什么'",
    "时间管理：专业匹配占用 65% 时间，挤压了系统设计维度的考察"
  ],
  "specific_suggestions": [
    "下次面试时，每次候选人说'我们'立即追'你个人具体做什么'——固定动作训练",
    "面试前给每个核心维度预设最长 30% 时长上限"
  ]
}
```

⚠️ **必须遵守**：
- `improvements` 和 `specific_suggestions` 都要有**具体面试中的转写片段**作为证据（**用面试官提问原文**，不引用候选人话术）
- `metrics.duration_min` / `bei_ratio` / `star_completeness` 全部基于转写真实计算，**不允许**估算

---

## E-4 · 输出可视化（widget 优先 / ASCII 降级）

### 4.1 widget 模式

按 `references/coach/widget-spec.md §2` 输出 5 区块卡片：
- 基本信息条
- 5 格指标卡（时长 / BEI% / 核心覆盖 / STAR / 子维度）
- 行为规范 4 项
- 甄选能力雷达图
- 维度覆盖诊断 + 核心发现

### 4.2 ASCII 降级模式

```markdown
📊 **单场复盘** · 候选人 张** · WXG 后端 · 2026-06-08 · 时长 58 min

🅰️ 行为规范
  · 高效开场      ✅ 达标
  · 面试氛围      ⚠️ 部分达标（正向反馈仅 2 次）
  · 礼貌结尾      ✅ 达标
  · 时间管理      ⚠️ 部分达标（专业匹配占 65%）

🅱️ 甄选能力（优=5 / 良=4 / 中=3 / 弱=2）
  提问有效性     ████░  良    BEI 占比 62%
  提问针对性     ████░  良    主问对齐维度 6/8
  追问完整度     ███░░  中    STAR 追到 A 层 2/3
  追问深度       ██░░░  弱    "我们"叙事 4 次仅追 1 次  ⚠️ 关注
  追问灵活性     ████░  良

🅲 维度覆盖
  🔴 专业匹配 ✅ 已覆盖
  🔴 项目深度 ✅ 已覆盖
  🟡 系统设计 ⚠️ 部分（仅提及未深入）

🎯 核心发现
  1. ✅ 优势：BEI 提问质量好，项目深度追问完整
  2. ⚠️ 短板：候选人用"我们"叙事时 4 次中仅 1 次追个人贡献
  3. ⚠️ 风险：时间分配失衡，系统设计维度被挤压

💡 下次专项练习
  · 训练动作：候选人说"我们"时立即追"你个人具体做什么"
  · 时间纪律：每个核心维度最长 30%
```

---

## E-5 · 存档（必跑）

调 `scripts/save_coach_eval.py`：

```bash
python3 scripts/save_coach_eval.py \
  --trace-id <traceId> \
  --interviewer-login <当前用户 SSO loginName> \
  --candidate-name "张**" \
  --station-txt "<stationTxt>" \
  --bg-txt "<bg_txt>" \
  --interview-date "2026-06-08" \
  --eval-json '<E-3 输出的 JSON 字符串>'
```

存档成功后向用户**简短**确认（不要刷屏）：

```
✅ 已存档至 ~/.workbuddy/skills/interview-assistant/coach-archive/<login>/202606/<traceId>.json
   累计已复盘 N 场（再 X 场可生成成长报告 → /复盘成长）
```

> 📌 N 场计算：调 `aggregate_coach.py --interviewer-login <login> --limit 99` 查总数（不展示明细，只取 `n_evaluations`）。

---

## E-6 · 上报（hooks）

写完后必上报：

```bash
bash scripts/track.sh \
  --event coach_self_eval_completed \
  --trace-id <traceId> \
  --bg "<bg_txt>" \
  --station "<stationTxt>"
```

---

## E-X · 转写不可用的降级路径

E-1.5 探活失败时：

1. 明确告知用户："这场面试无转写，无法做行为复盘评估"
2. 询问"要不要记录一条**意向**复盘（仅记录'今天做了 XX 场面试，主观感受'），但**不计入**成长报告趋势分析？" → 用户 yes 才记录到 `coach-archive/<login>/_intentions/<date>.txt`，**不进 JSON 池**
3. 引导用户："下次开会议前在腾讯会议设置里把转写打开"

---

## E 类目交互速查

| 触发表达 | 行为 |
|---|---|
| "复盘我最近一场" | 自动取 T 最近一场已完成面试 |
| "复盘 traceId=xxx" | 直接用 |
| "复盘张三那场" | 按候选人名 fuzzy 匹配 |
| "复盘失败 / 没转写" | 走 E-X 降级 |
| 评完用户问"我累计多少场了" | 读 aggregate 的 n_evaluations 直接答 |
