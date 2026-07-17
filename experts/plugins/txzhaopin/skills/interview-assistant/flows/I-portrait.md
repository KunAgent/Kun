# 类目 ⑧ 面试官画像（I-portrait）

> **场景**：基于最近 N 场（默认 10 场）已完成面试的**转写 + 面评**，提炼面试官的**综合画像**——面试风格、提问偏好、维度覆盖度、候选人评价分布等静态侧写。与 G（成长报告）互补：G 看趋势变化，I 看静态特征。
>
> **触发词**：我的面试画像 / 面试官画像 / 提炼我的画像 / 我是什么样的面试官 / 我的面试风格 / 分析我最近 10 场面试 / 看我面试特征 / interviewer portrait / 画像分析
>
> **与 G 的区别**：
> - **G（成长报告）**：读本地 coach-archive 存档 → 看趋势（进步项 / 持续短板）→ **依赖先跑过 E**
> - **I（画像）**：实时从招活拉原始数据（已完成面试 → 转写 → 面评）→ 看静态特征 → **不依赖存档，首次可用**

---

## I-0 · 进入门槛与硬规则

| 规则 ID | 内容 |
|---|---|
| I-RULE-1 | **实时拉取，不依赖存档**——从招活 API 实时拉已完成面试列表 + 转写 + 面评，不读 coach-archive |
| I-RULE-2 | **必须有转写才能提炼画像**——转写覆盖率 < 50% 时降级到「有限画像」并在输出头部标注 ⚠️ |
| I-RULE-3 | **画像 ≠ 评估**——输出用描述性语言（"偏好 XX"/"常做 XX"/"较少覆盖 XX"），不用优/良/中/弱评级（那是 E/G 的口径） |
| I-RULE-4 | **默认 10 场**——和 G 默认 5 场不同，画像需要更多样本才有统计意义；但上限 20 场（token 治理） |
| I-RULE-5 | **候选人不脱敏时仅在输出中展示姓+**——如"张\*\*"；引用证据只引用面试官行为，不引用候选人隐私信息 |
| I-RULE-6 | **耗时提醒**——10 场逐场拉转写可能耗时 1-2 分钟，**进入时必须告知用户**并展示进度 |
| I-RULE-7 | **跨场面评提取**——从简历 API 的 `interviewRecords[].flows[].result_txt` 提取面评文本，需按 rid 逐份拉取 |

---

## I-1 · 列出已完成面试

### 调用脚本（强制使用，禁止手拼 mcporter）

```bash
# 默认：校招+社招合并，最近 10 场
python3 ~/.workbuddy/plugins/marketplaces/my-experts/plugins/txzhaopin/skills/interview-assistant/scripts/fetch_completed_interviews.py

# 指定场数
python3 .../scripts/fetch_completed_interviews.py --limit 10

# 只看校招 / 只看社招
python3 .../scripts/fetch_completed_interviews.py --type campus
python3 .../scripts/fetch_completed_interviews.py --type social

# 拿 JSON（用于后续程序处理）
python3 .../scripts/fetch_completed_interviews.py --format json --limit 10
```

### 脚本背后的接口（仅供排查）

| 招聘类型 | 接口 | 关键参数 |
|---|---|---|
| 社招已完成 | `recruit.social-todo-center.get_api_trace_get_list` | `done="true"` + `flowId="3"` + `extType="interview"` |
| 校招已完成 | `recruit.campus-center-front.get_campus_interview_todo_list` | `orderStateId=[10,11]`（10=待填面评, 11=已完成） |

### 输出结构（JSON --format json）

```json
{
  "interviews": [
    {
      "type": "campus|social",
      "trace_id": "<TRACE_ID>",
      "candidate_name": "张**",
      "station_txt": "后台开发",
      "bg_txt": "WXG",
      "step_txt": "初试",
      "interview_date": "2026-06-08",
      "rid": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
      "recruit_type": 1,
      "employee_id": ""
    }
  ],
  "total_campus": 5,
  "total_social": 8
}
```

### 用户参数确认

```
默认参数：
  --limit 10        # 画像默认 10 场（与 G 的 5 场不同）
  --type all        # 校招+社招都看

用户可改：
  "只看校招"          → --type campus
  "只看社招"          → --type social
  "最近 5 场"         → --limit 5
  "最近 20 场"        → --limit 20（上限）
```

---

## I-2 · 逐场拉取转写 + 面评

**🔴 耗时提醒（进入 I-2 前必须告知用户）**：

```
⏳ 接下来将逐场拉取最近 10 场面试的转写和面评，预计耗时 1-2 分钟。
   进度会在下方实时更新，请稍候...
```

### I-2.1 批量拉转写

遍历 I-1 返回的 `interviews[]`，对每条有 `trace_id` 的记录调用：

```bash
# 校招（默认）
python3 scripts/fetch_transcript.py \
    --trace-id <trace_id> \
    --out-dir $TMP_DIR \
    --prefix interview_<index>

# 社招
python3 scripts/fetch_transcript.py \
    --trace-id <trace_id> \
    --recruit-type social \
    --out-dir $TMP_DIR \
    --prefix interview_<index>
```

**进度展示**（每完成一场刷新）：

```
拉取转写进度：3/10 ✅ | 2/10 ⚠️无转写 | 0/10 ❌失败
```

**转写覆盖率判定**：

```
有转写场数 / 总场数 = coverage_ratio
  coverage_ratio >= 0.8  → ✅ 充足
  coverage_ratio >= 0.5  → ⚠️ 有限画像（头部标注）
  coverage_ratio <  0.5  → ❌ 转写不足，降级到 I-X
```

### I-2.2 批量拉面评

> 🆕 **v4.6 优化：校招面评优先用「已办接口直出」，省调用**。
> I-1 的 `fetch_completed_interviews.py` 在拉**校招**已完成面试时，已改用 `get_campus_interview_done_list`，**每条直接带 `eval_comment`（本人面评原文）+ `eval_rank`（评级）+ `interview_result`（通过/放弃）**（见 `--format json` 输出）。
> - **校招**：先用这三个字段，**够用就不再按 rid 拉简历**（省 N 次调用、省 token）。仅当需要"该候选人全部轮次的跨面试官面评"（不只本人这场）时，才走下面的按 rid 拉简历详情。
> - **社招**：已办接口不带面评原文 → 仍走下面按 rid 拉简历详情。

对**社招**、或校招需要全轮次面评的记录，通过简历 API 拉取面评文本：

```bash
# 校招简历详情（含面评）
mcporter call recruit-mcp CallAPI \
  apiId='recruit.campus-resume-search.get_v1_mcp_resume_getResumeByRId' \
  params='{"rid":"<rid>"}' \
  > $TMP_DIR/resume_<index>_raw.json 2>&1

# 社招简历详情（含面评）
mcporter call recruit-mcp CallAPI \
  apiId='recruit.social-resume.get_api_resume_detail_getresume_with_detail' \
  params='{"rid":"<rid>"}' \
  > $TMP_DIR/resume_<index>_raw.json 2>&1
```

**面评提取逻辑**（Python 片段，写入 decode 脚本或内联执行）：

```python
import json
raw = open(f'{TMP_DIR}/resume_{index}_raw.json').read()
# 校招路径
payload = json.loads(raw)['data']['data']['data']
# 面评在 interviewRecords.list[].flows[].result_txt
records = (payload.get('interviewRecords') or {}).get('list', [])
evaluations = []
for rec in records:
    for flow in rec.get('flows', []):
        result_txt = flow.get('result_txt', '')
        if result_txt:
            evaluations.append({
                'step_txt': flow.get('step_txt', ''),
                'staff_txt': flow.get('staff_txt', ''),  # 面试官
                'result_txt': result_txt,
                'result_type': flow.get('result_type', ''),  # 1=推荐/2=不推荐/3=待定
            })
```

**面评归属判定**：只取 `staff_txt == 当前用户` 的面评（不混入他人评价）。

---

## I-3 · LLM 聚合画像

把所有转写 + 面评投喂给 LLM，输出**结构化画像 JSON**：

### 输入投喂

```
1. 所有场次的 transcript.txt（合并，每场用 === 隔开）
2. 所有场次的 evaluations[]（仅当前用户写的面评）
3. 每场的元数据（candidate_name / station_txt / bg_txt / step_txt / date）
```

### 输出结构

```json
{
  "portrait": {
    "interview_style": {
      "overall": "结构化+深度追问型",
      "opening_pattern": "多数场次直接进入专业提问，较少寒暄",
      "question_type_distribution": {
        "behavioral_ratio": 0.6,
        "situational_ratio": 0.25,
        "technical_ratio": 0.15
      },
      "follow_up_style": "习惯追问细节但容易在候选人说'我们'时跳过个人贡献",
      "time_pattern": "前半场节奏快，后半场常超时"
    },
    "dimension_coverage": {
      "frequently_covered": ["专业匹配", "项目深度", "逻辑思维"],
      "rarely_covered": ["系统设计", "文化适配"],
      "coverage_balance_score": 0.65
    },
    "evaluation_tendency": {
      "recommend_ratio": 0.4,
      "pending_ratio": 0.35,
      "not_recommend_ratio": 0.25,
      "comment_pattern": "面评偏简短，STAR结构完整度约50%"
    },
    "question_preferences": {
      "top_question_patterns": [
        "项目经历深挖（占40%提问量）",
        "技术原理追问（占25%）",
        "行为面试BEI（占20%）"
      ],
      "rarely_asked": ["情景模拟题", "价值观/文化题", "反问环节引导"]
    },
    "interaction_style": {
      "talk_ratio": "面试官占比约30%",
      "feedback_frequency": "正向反馈较少（平均每场2次）",
      "silence_handling": "常主动填补沉默，给候选人思考时间不足",
      "closing_pattern": "多数场次有反问环节但未做总结"
    },
    "key_features": [
      "强项：项目经历深挖到位，能从架构选型追到上线灰度策略",
      "特点：BEI题占比较高（60%+），面试结构化程度好",
      "关注：追问深度在候选人使用群体代词时偏弱",
      "风格：面试节奏偏快，专业维度时间占比大，文化维度较少"
    ],
    "improvement_suggestions": [
      "维度均衡：增加文化适配/价值观维度考察（当前10场中仅2场涉及）",
      "追问深度：候选人说'我们'时固定追'你个人做了什么'",
      "面评质量：面评STAR结构完整度可提升，建议每段面评含Situation+Action+Result"
    ]
  },
  "meta": {
    "n_interviews": 10,
    "n_with_transcript": 8,
    "n_with_evaluation": 10,
    "date_range": "2026-04-15 ~ 2026-06-08",
    "recruit_type_mix": {"campus": 6, "social": 4},
    "bg_mix": {"WXG": 5, "IEG": 3, "PCG": 2}
  }
}
```

⚠️ **LLM 提示词关键约束**：
1. **只描述，不评判**——用"偏好/常做/较少"而非"优/良/中/弱"
2. **证据驱动**——每个特征必须引用至少 1 条转写原话作为证据（面试官原话，不引用候选人）
3. **统计量必须真实计算**——`behavioral_ratio` / `recommend_ratio` 等从数据算，不估算
4. **区分校招/社招**——如果混合样本，在 `meta.recruit_type_mix` 标注，画像特征中标注"主要体现在校招/社招"

---

## I-4 · 输出（widget 优先 / ASCII 降级）

### 4.1 widget 模式

按 `references/coach/widget-spec.md` §4 输出 7 区块卡片（I 专用）：

1. **画像概览条**（面试官名 / 场数 / 日期范围 / 转写覆盖率）
2. **面试风格标签云**（3-5 个核心标签，如「结构化」「深度追问」「快节奏」）
3. **提问类型分布饼图**（行为/情景/技术/其他）
4. **维度覆盖热力图**（常考 vs 少考 vs 缺失）
5. **面评倾向条**（推荐/待定/不推荐占比 + 面评完整度）
6. **互动特征卡**（话占比 / 反馈频率 / 沉默处理 / 结尾模式）
7. **核心特征 + 改进建议**

### 4.2 ASCII 降级模式

```markdown
🎭 **面试官画像** · @<login> · 最近 10 场（2026-04-15 ~ 2026-06-08）
   校招 6 / 社招 4 · 转写覆盖 8/10 (80%)

🏷️ 风格标签
  「结构化」「深度追问」「快节奏」「BEI 高占比」

📊 提问类型分布
  行为面试(BEI)  ████████████░░  60%
  情景模拟       █████░░░░░░░░░  25%
  技术原理       ███░░░░░░░░░░░  15%

🔥 维度覆盖热力图
  专业匹配    ██████████  常考（10/10 场）
  项目深度    ██████████  常考（10/10 场）
  逻辑思维    ████████░░  常考（8/10 场）
  系统设计    ███░░░░░░░  少考（3/10 场）
  文化适配    █░░░░░░░░░  缺失（2/10 场）

📋 面评倾向
  推荐 4 场 (40%) · 待定 3 场 (35%) · 不推荐 3 场 (25%)
  面评 STAR 完整度：约 50%（偏简短）

💬 互动特征
  · 话占比约 30%（偏倾听型）
  · 正向反馈偏少（平均每场 2 次）
  · 常主动填补沉默，候选人思考时间不足
  · 多数场次有反问环节但未做总结

🎯 核心特征
  1. ✅ 强项：项目经历深挖到位，能从架构追到灰度策略
  2. 📌 特点：BEI 题占比 60%+，面试结构化程度好
  3. ⚠️ 关注：候选人用"我们"叙事时追问个人贡献偏弱
  4. ⚠️ 风格：专业维度占时大，文化维度几乎不涉及

💡 改进建议
  1. 维度均衡：增加文化适配/价值观维度（10 场仅 2 场涉及）
  2. 追问深度：候选人说"我们"时固定追"你个人做了什么"
  3. 面评质量：每段面评含 S+A+R，提升 STAR 完整度
```

---

## I-5 · 存档（可选）

画像**不像 E 那样强制存档**，因为 I 是实时拉取的、每次结果可能不同（新面试加入后画像会变）。

但用户**可以主动要求存档**：

```bash
# 用户说"保存画像"时
python3 scripts/save_coach_eval.py \
  --trace-id "portrait_<login>_<date>" \
  --interviewer-login <login> \
  --eval-json '<I-3 输出的 JSON>'
```

存档路径：`coach-archive/<login>/portraits/portrait_<date>.json`

---

## I-6 · 上报

```bash
bash scripts/track.sh "0WEB06ZI7OVDOZQW" "interview-assistant" "portrait_generated" \
  '{"session_id":"'"$(date +%s)"'","n_interviews":<场数>,"n_with_transcript":<有转写>,"recruit_types":"<campus+social>","status":"<success|partial|insufficient>"}'
```

---

## I-X · 转写不足的降级路径

I-2.1 统计转写覆盖率 < 50% 时：

1. **告知用户**："最近 10 场中只有 N 场有转写记录，数据不足以提炼完整画像。"
2. **降级方案**（二选一，让用户选）：
   - **A. 有限画像**：基于已有转写 + 全部面评文本做画像，头部标注 `⚠️ 有限画像（转写覆盖 N/10）`
   - **B. 扩大范围**：增加到 20 场看能否凑够转写
3. **根本建议**："建议在腾讯会议中开启自动转写，未来面试积累后画像会越来越准确。"

---

## I 类目交互速查

| 触发表达 | 行为 |
|---|---|
| "我的面试画像" / "我是什么样的面试官" | 默认 10 场 + all |
| "最近 5 场画像" | limit=5 |
| "只看社招画像" | type=social |
| "保存画像" | 走 I-5 存档 |
| "转写不足" | 走 I-X 降级 |
| "画像和成长报告有什么区别" | 解释：画像=静态特征快照，成长=跨场趋势变化 |
