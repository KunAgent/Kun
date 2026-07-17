# Judge Model Pin

> 钉死 judge 的 model + version + temperature。
> 任何修改必须更新此文件 + re-baseline。

---

## 当前钉的版本

```yaml
judge:
  cli: codex
  model: gpt-5.5
  reasoning_effort: xhigh
  temperature: 0  # 注意：不是所有模型都支持显式 temp
  
runner_command: |
  codex exec --skip-git-repo-check \
    -c model="gpt-5.5" \
    -c model_reasoning_effort="xhigh"

baseline_run:
  date: 2026-04-29
  commit: <填入实际 commit hash>
```

---

## 为什么钉死

如果 judge 本身的 model 升级（比如 gpt-5.5 → gpt-5.6），它的"客观判断"会变。同一个 SKILL.md 输出，新 judge 可能给出不同分数——这就是 model drift。

**没有固定 judge = 没有真正的回归测试**。

---

## 升级流程

如果必须升级 judge model：

1. 在新 model 上对**所有现有 baseline** 重新评分
2. 对比新旧分数差异
3. 如果差异 >10% 或单题分数变化 ≥ 2 → **建立新 baseline**
4. 更新 `model-pin.md` 记录新 model + 升级日期
5. 旧 baseline 标记为 deprecated（保留作历史比较）

---

## 不准做的事

- ❌ 偷偷换 model 继续用旧 baseline 比较
- ❌ 用不同 model 跑同一组测试比较
- ❌ 在 baseline_run 之后改 reasoning_effort 但不记录

---

## Why gpt-5.5 not Claude

选 codex / gpt-5.5 当 judge 的原因：

1. AI 刘小排可能由 Claude 跑（Claude Code 环境）。**judge 不能是同一个模型**——同 model 自评有偏差。
2. codex 已经在本机配好（`~/.codex/skills/`）+ 跑得稳定
3. xhigh reasoning + temp 0 → 输出更稳定可重复

如果用户主要在 Codex CLI 跑 skill，judge 可以换成 Claude API（保持"独立 judge"原则）——但需要重新建 baseline。
