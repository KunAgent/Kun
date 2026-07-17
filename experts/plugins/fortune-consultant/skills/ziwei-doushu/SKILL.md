---
name: ziwei-doushu
description: Professional Ziwei Doushu consultation skill with offline, Beijing-standard calculation rules. Use when the user wants a polished Ziwei report from birth date and time, including life palace structure, twelve palaces, four transformations, major luck cycles, yearly triggers, optional chart images, and a clear split between chart facts and traditional interpretation.
---

# Ziwei Doushu

Generate a **professional Ziwei Doushu reading** with a clear split between:
- chart facts
- traditional interpretation framework
- practical trend summary

This skill is designed to feel more like a **clean analyst-style consultation** than a mystical word dump.

## Recommended Command

```bash
python scripts/ziwei_chart.py \
  --date 1990-10-21 \
  --time 15:30 \
  --gender female \
  --year 2026 \
  --engine dual \
  --template pro \
  --format markdown
```

## Default Standard

- Timezone: `Asia/Shanghai`
- Longitude: `120.0`
- Default engine: `py`
- Optional chart export: `jpg` when supported, otherwise text-only output remains valid

## Deliverables

A strong output should include:
1. Calculation standard (timezone / longitude / unified calculation time)
2. Chart facts
   - 命宫 / 身宫
   - 十二宫
   - 主星组合
   - 三方四正
   - 四化
   - 大限 / 流年触发
3. Interpretation framework
   - what the structure suggests
   - where the reading is robust
   - where timing sensitivity matters
4. Practical summary
   - career
   - relationships
   - money
   - health / energy management
   - current-year focus and risk boundary

## Common Parameters

- `--engine py|js|dual`: primary / fallback / dual-check
- `--template lite|pro|executive`: output density
- `--chart none|svg|jpg`: chart rendering mode
- `--chart-quality 1-100`: JPG quality, default `92`
- `--chart-backend auto|cairosvg`: offline backend
- `--format markdown|json`: final output format

## Output Style Guardrails

- Separate **chart facts** from **traditional interpretation**.
- Present conclusions as trend / structure, not deterministic destiny claims.
- Make method transparency part of the deliverable.
- If dual-engine results differ, surface the discrepancy instead of hiding it.
- If chart export fails, continue with the report.

## HTML 可视化（与 agent 协同）

当上层 agent 决定主动产出紫微 HTML 命盘时，推荐做法：

1. 先用本 skill 的 `--format json` 拿到完整结构化数据（12 宫 / 四化 / 大限 / 小限 / 三方四正）
2. 由 agent 渲染独立 HTML 文件，**配色遵循 fortune-consultant agent 中"紫微斗数 — 深蓝紫银河风"约定**：
   - 主色：深蓝紫底 `#0a0e2a` + 紫色高亮 `#a890ff` + 银白文字 `#e8e4ff`
   - 命/身/大限/流年标签必须用**内联徽章紧跟宫名**（flex 布局），禁止用 `position: absolute` 浮层（曾发生覆盖文字事故）
   - 四化色：禄=金 `#ffd66e` / 权=玫 `#ff8eb8` / 科=青 `#6ee0d6` / 忌=灰 `#b8b4c8`
3. 参考样例：`../../examples/ziwei-doushu-example.html`

## Engine Dependencies

- Python 引擎首选：`pip3 install iztro-py`
- JS 引擎备援：`npm install iztro`（建议在 skill 目录下安装）
- 两个引擎都缺时，脚本会报"py/js 引擎都失败"——**安装后再跑**，不要回退到模型记忆推算（紫微定盘规则复杂，记忆推算错误率高）

## Scope Boundary

- Offline only; no network dependency.
- Produce interpretive analysis only; not medical, legal, or financial advice.
- Optional image export should enhance delivery, not gate it.

## References

- `references/mapping.md`
- `references/interpretation-framework.md`
