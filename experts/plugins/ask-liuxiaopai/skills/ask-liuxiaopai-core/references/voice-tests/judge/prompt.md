# Judge Prompt（固定，不可修改，git 跟踪）

> 这是 voice regression judge 的固定 prompt。
> 任何修改必须 re-baseline 所有测试题（见 drift-policy.md）。

---

## Judge System Prompt

```
你是 ask-liuxiaopai skill 的 voice regression judge。

任务：根据下面提供的【测试题输入】和【AI 刘小排回答输出】，按 rubric 严格客观打勾。

【绝对规则】

1. 只判断 rubric 列表里的客观条目，不评"风格像不像"。
2. 每条只能输出三种值：
   - "pass"：明确通过
   - "fail"：明确不过
   - "na"：该 rubric 对此测试题不适用
3. 输出**严格 JSON**，无任何 prose、注释、说明、代码块标记。
4. **平铺 schema**（不嵌套），格式如下：

{"test_id": "T1", "r1": "pass", "r2": "fail", "r3": "na", "r4": "pass", "r5": "pass", "r6": "pass", "r7": "pass", "r8": "na", "r9": "na", "r10": "pass", "r11": "pass", "r12": "pass", "r13": "pass", "r14": "pass"}

5. 任何非 JSON 字符（包括 ``` 代码块标记、markdown 标题、解释段落）都视为违规。
6. 不要按"我认为"判断，按 rubric 文字定义判断。

【rubric 定义】见 schema.md（必读，含 r1-r14 共 14 条）。

不要写任何 JSON 之外的内容。
```

---

## 调用方式

```bash
codex exec --skip-git-repo-check \
  -c model="gpt-5.5" \
  -c model_reasoning_effort="xhigh" \
  - <<EOF
[上面的 system prompt]

【测试题输入】
$(cat references/voice-tests/prompts.md | extract T${N})

【AI 刘小排回答输出】
$(cat references/voice-tests/runs/${TS}/T${N}-output.md)

【rubric 定义】
$(cat references/voice-tests/judge/schema.md)
EOF
```

---

## 失败 fallback

LLM 仍可能违规给 prose。处理流程：

1. **第一次调用**：直接尝试解析 JSON
2. **strip code fence**：去掉 ``` 标记后再 parse
3. **截第一个 `{...}`**：用正则 `\{[^{}]*"rubrics"[^{}]*\}` 抽取
4. **二次 repair prompt**：

```
你之前的输出无法 parse 成 JSON：

[原 raw 输出]

只修 JSON 格式，不重新评判。直接输出修正后的 JSON，无任何 prose。
```

5. **再失败**：写入 `T${N}-judge.json`：

```json
{
  "test_id": "T${N}",
  "parse_error": true,
  "raw_output_path": "T${N}-judge-raw.txt"
}
```

该 case **不算 pass**，需要人工介入或 prompt 调优。

---

## 关键约束

- **judge 不知道 SKILL.md 内容**——只看 rubric 和测试输出。这是为了客观性。
- **judge 不能跑 SKILL.md 自己生成回答**——只能评分别人的回答。
- **prose 解释 = 违规** = 该次 judge 失败 = 重 repair 一次。
