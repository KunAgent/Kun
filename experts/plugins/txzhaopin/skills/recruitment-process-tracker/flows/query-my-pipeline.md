# 场景 · 查招聘流程（默认 = 我负责的；有权限的可查别人）

> 默认场景。当用户说"查我的招聘进度 / 我负责的流程 / 招聘漏斗 / 查 xxx 招聘经理负责的流程"等时进入。
>
> ⚠️ **本接口仅查社招流程**。校招请到 zhaopin.woa.com。

---

## 1. 直接调脚本（不要先问过滤条件）

### ① 默认：查我负责的

```bash
python3 ~/.codebuddy/plugins/marketplaces/my-experts/plugins/txzhaopin/skills/recruitment-process-tracker/scripts/fetch_process.py
```

不传 `hrs` = 接口按当前登录人作为招聘经理查询。

### ② 查指定招聘经理（需要对应查询权限）

```bash
python3 .../fetch_process.py --hrs <招聘经理英文名>
python3 .../fetch_process.py --hrs <英文名A>,<英文名B>       # 多人用逗号分隔
```

⚠️ **关键**：即使账号有跨人查询权限，**不传 `hrs` 还是只能看到自己**。要查别人**必须显式传 `hrs`**。

### ③ 加多维过滤

```bash
# 按候选人姓名模糊
python3 .../fetch_process.py --candidate "<候选人姓名>"

# 按状态大类（statusCode）
python3 .../fetch_process.py --status-code Interviewing       # 面试阶段
python3 .../fetch_process.py --status-code Offering           # offer 阶段
python3 .../fetch_process.py --status-code Onboarding         # 入职中
python3 .../fetch_process.py --status-code Ending             # 已结束

# 按面试安排子状态（仅 statusCode=Interviewing 下有效）
python3 .../fetch_process.py --status-code Interviewing --interview-status wait_arrangement

# 按部门
python3 .../fetch_process.py --dept 10000

# 按面试官英文名
python3 .../fetch_process.py --interviewers <英文名A>,<英文名B>

# 按时间区间（应聘时间）
python3 .../fetch_process.py --apply-time "2026-05-01,2026-05-31"

# 组合：查指定招聘经理在面试阶段的流程（需要对应权限）
python3 .../fetch_process.py --hrs <英文名> --status-code Interviewing
```

---

## 2. 解析返回 + 字段名探测

接口返回字段（**v1.1.0 已按官方 schema 修正**）：

| 字段（按官方 schema）| 说明 | 渲染 |
|---|---|---|
| `candidateName` | 候选人姓名 | PII 水印（"王*明"）|
| `hr` / `creator` | 招聘 HR / 单据创建者 英文名 | 直接展示（用于"招聘经理"列）|
| `stepName` | 当前环节名称 | 直接展示 |
| `elapsedDay` | 当前环节耗时（天）| `> 5 天` 标 ⚠️ |
| `totalElapsedDay` | 总耗时（天）| 直接展示 |
| `stateName` | 流程状态名（"面试中" / "录用中" 等）| 颜色标识 |
| `deptName` | 部门 | 直接展示 |
| `postName` | 岗位 | 直接展示 |
| `url` | **处理链接** | 直接用，**不要自己拼** |
| `flowMainId` | 流程主表 ID | 内部使用 |
| `traceId` | 待办跟踪 ID | 内部使用 |

⚠️ 字段命名有时会出现 camelCase / snake_case 都有的情况，脚本按 `候选人 = candidateName/title/name`、`耗时 = elapsedDay`、`状态 = stateName/statusName` 顺序探测。

---

## 3. 输出 Markdown 表格

```markdown
## 📊 招聘流程（共 {N} 条 · 招聘经理：{hrs 或 当前登录人}）

| # | 候选人 | 招聘 HR | 当前环节 | 环节耗时 | 总耗时 | 状态 | 部门 | 岗位 | 处理链接 |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 王*明 | <hr英文名> | HR 资格面 | 5.4 天 ⚠️ | 18 天 | 🟦 面试中 | <部门名> | <岗位名> | [处理](https://zhaopin.woa.com/...) |
```

PII 水印规则（与 interview-assistant 一致）：
- 中文 2 字：第 2 字打 *（如"王明"→"王*"）
- 中文 3 字：第 2 字打 *（如"王梦琴"→"王*琴"）
- 中文 4+ 字：第 2-3 字打 *（如"欧阳明月"→"欧**月"）

---

## 4. 智能洞察（必输出，但有红线）

表格下方补一段洞察，**只挑 2-3 个最值得关注的事**，不要罗列：

```markdown
💡 **洞察**：
- 偏慢环节：3 个流程当前环节耗时 > 5 天 — {候选人A}（{环节} {耗时}天）/ {候选人B} ...
- 状态分布：面试中 N / 录用中 M / 入职中 K（如某状态长期占比偏高也提一句）
- 推进建议：可以重点关注 {top1 候选人}，建议先确认面试官档期 / 推 HR 跟进
```

洞察原则（红线）：
- ❌ 不要说"无明显问题"这种废话——没洞察就不写
- ❌ 不要凭空发挥（"建议加大投入"等空话）
- ✅ 只基于表格里的硬数据下结论（耗时 / 状态分布 / 总数）

---

## 5. 末尾给下一步建议

```markdown
下一步可以问：
- "只看面试中" / "只看 offer 阶段" → 加 status-code 过滤
- "只看 <hr英文名> 负责的" → 加 hrs 过滤（需要对应查询权限）
- "查 xxx 现在到哪一步" → 按候选人精确查（走 query-by-candidate.md）
- "导出 Excel" → 落盘成 csv（可选）
```

---

## 6. 边界处理

- **结果 0 条**：先反查上下文——
  - 如果**没传 `hrs`**：直接说"当前没有你负责的进行中社招流程"，让用户确认是否本人是招聘经理
  - 如果**传了 `hrs`**：说"未查到 {hr} 名下的进行中流程"——可能 hr 拼写错了 / 你没有跨人查询权限 / 该 hr 确实没流程在跑
- **接口 401**：太湖 Token 过期 → 走 agent prompt §0 失败引导
- **接口 403**：⚠️ **本接口要求招聘经理权限**。话术：
  > "本接口需要招聘经理权限。如果你只是面试官，请改用 `/待办` 查面试待办；如果你确实是招聘经理但 403，请联系 HR 业务运维确认权限。"
  >
  > **严禁**让用户去重申 Token——这是角色权限问题，不是 Token 问题。
- **结果 > 50 条**：表格分页输出，每屏 30 条 + 一段洞察 + "继续看下一页 / 加过滤条件"
