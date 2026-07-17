# Drift Policy（baseline 漂移策略）

> 何时重建 baseline / 何时报警 / 怎么处理 model 升级。

---

## 触发 re-baseline 的事件

### 1. SKILL.md 主体改版

**定义**：SKILL.md 改动 ≥ 30 行（不算 reference 加载规则的 minor 调整）

**处理**：
1. 先跑当前 baseline（看哪些题挂了）
2. 修改 SKILL.md
3. 再跑测试，对比新 / 旧输出
4. 如果新输出**符合预期改进方向** → 替换 baseline + 记录 commit
5. 如果新输出**意外回退** → 调整 SKILL.md，再测

### 2. Reference 文件大改

**定义**：methodology/ 下任一文件改动 ≥ 50 行

**处理**：仅重跑使用该 reference 的测试题（按 SKILL.md 加载规则映射）。

### 3. Judge model 升级

**定义**：model-pin.md 里 model 或 reasoning_effort 改变

**处理**：
- 用新 model 重跑所有 baseline
- 对比新 / 旧分数：
  - 单题分数差异 < 1 → 接受，更新 model-pin
  - 单题分数差异 ≥ 2 → 建立新 baseline，标记旧 baseline 为 deprecated
- 在 model-pin.md 记录升级日期 + 影响

### 4. Rubric 增删

**定义**：schema.md 中 rubric 条目变化（新增 / 删除 / 重新定义）

**处理**：所有 baseline 重新打分（不需要重跑回答，只需重 judge）。

---

## 报警条件（说明 SKILL.md 真有问题）

跑测试后出现以下任一情况，**人工介入**：

### 1. 总 pass rate < 75%

8 题中 < 6 题 pass。说明整体风格漂移。

### 2. 同一条 rubric 连续 3 次跑都 fail

across 多道测试题，同一 rubric（如 r4 助理腔、r10 公式化标题）持续 fail。

→ **改 SKILL.md 加强该规则**，不是改 rubric。

### 3. 新 baseline 在新 model 上分数显著下降

更新 judge model 后，原 baseline 在新 model 上分数全降 >10%。

→ 可能是 SKILL.md 写得太"投合"旧 model，需要泛化优化。

### 4. 某测试题 parse_error 连续 ≥ 3 次

judge 持续无法给 valid JSON。

→ 改 judge prompt，让 schema 更明确。

---

## 不算漂移的小变化（不需要 re-baseline）

- README.md 改动
- Reference 文件中 < 20 行的措辞优化
- 注释 / 排版调整
- 关键词同义词补 1-2 个

---

## Baseline 文件结构

```
voice-tests/baselines/
├── T1-2026-04-29.md       # 第一次 baseline
├── T1-2026-05-15.md       # 重 baseline 后的版本
├── T2-2026-04-29.md
├── ...
└── _baseline-log.md        # 每次 baseline 变更的记录
```

`_baseline-log.md` 内容示例：

```markdown
## 2026-04-29

- 初次建立全部 baseline
- SKILL.md commit: <hash>
- judge model: gpt-5.5 / xhigh

## 2026-05-15

- 触发：SKILL.md 改 67 行（新增 P8 pattern）
- T1, T3 输出有改进，更新 baseline
- T2, T4-T8 不变
- 新 commit: <hash>
```

---

## 不要做的事

- ❌ 频繁 re-baseline（每次小改动都 re）→ 失去回归测试意义
- ❌ 看到 fail 就改 rubric 而不是改 SKILL.md → 自欺欺人
- ❌ 不记录 baseline 变更原因 → 半年后没人知道为什么变
- ❌ 跨 model 比较旧 baseline 和新 baseline → 不可比

---

## 健康节奏

- **每次 SKILL.md 大改**（≥ 30 行）：必跑测试 + 必看是否需要 re-baseline
- **每月**：跑一次全套测试看是否有 silent drift
- **每季度**：审视 rubric 是否需要更新（题型有没有变化）
- **每年**：审视 judge model 是否需要升级
