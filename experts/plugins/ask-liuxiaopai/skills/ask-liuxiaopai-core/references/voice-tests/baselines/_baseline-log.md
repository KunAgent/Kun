# Baseline 变更日志

> 每次 baseline 更新都要在此记录。

---

## 2026-04-29 (v1.0 初次跑) — DEPRECATED

第一次跑 T1：6 pass / 6 fail / 2 N/A。

**根因诊断错误**：以为是 judge 偏严，实际是 **runner 输出污染**——
codex exec 的 stdout 把 SKILL.md 内容（含禁忌词清单）和 transcript 元信息一起写入 T1-output.md，judge 评分对象本身已经脏了。

详见 commit `<v3.1 commit hash>` 修复。

---

## 2026-04-29 v1.1（runner 修复后）

- **触发**：Stop hook 指出 3 个 bug：
  1. runner 输出污染（codex transcript + SKILL.md 片段都写进了 output）
  2. model pin 没真正生效（runner 没带 `-c model="gpt-5.5"` / `-c model_reasoning_effort="xhigh"`）
  3. SKILL.md 引用 `walkthroughs/b2b-saas.md`，实际是 `b2b-saas-full.md`，路径断了
- **修复**：
  - runner.sh 加 `extract_clean_answer` 函数：取最后一个"tokens used"行之后第 2 行起，得到干净 final answer
  - runner.sh 显式带 `-c model="gpt-5.5"` 和 `-c model_reasoning_effort="xhigh"`
  - SKILL.md 路径修正为 `b2b-saas-full.md`
  - 同时保留 `T<N>-output-raw.txt` 调试用
- **重跑 T1 结果**：12 pass / 0 fail / 2 N/A → ✅ pass

### 学到什么

**Hook 完全说对**：T1 失败主因不是 judge 偏严，是 input 污染。
v1.0 的 known issue 解决了——**不需要做"程序化 + LLM 混合 judge"**。
output 干净后，单纯的 LLM judge 已经足够准确。

### 暂未跑的题

T2-T8 建议另开 session 跑全套（30+ 分钟，避免阻塞主线）。
预期跑出来后大部分应该 ≥ 10/12 pass。如果某题低于 10，那才是 SKILL.md 真问题。

---

## 模板（后续记录）

```markdown
## YYYY-MM-DD（v?.?）

- 触发：[SKILL.md/reference/judge model 改了什么]
- 跑了：T?-T?
- SKILL.md commit：<hash>
- judge model：<model + version>
- 结果：[简要 pass/fail 数据]
- 重大变化：[相比上次 baseline 哪些题输出改变]
```
