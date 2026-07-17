---
name: geo-diag-report
description: "Brand GEO diagnosis with search-augmented AI pipeline. 4-stage pipeline: real web search + virtual simulation fallback. Platform selection, on-demand reference loading, HTML report output. Triggers: 'GEO诊断', '品牌诊断', '诊断报告', 'brand diagnosis', 'AI可见度', 'AI搜索排名', '品牌曝光', 'GEO优化', '品牌提及率'."
description_zh: "品牌GEO诊断专家（搜索增强）。4阶段流水线，真实搜索+虚拟推理双模式，输出HTML可视化报告"
description_en: "Brand GEO diagnosis: 4-stage pipeline, search-augmented, HTML reports"
version: 4.1.0
display_name: "GEO诊断报告"
display_name_en: "geo-diag"
visibility: "public"
allowed-tools: Read, Write, Bash, Glob, WebSearch, WebFetch, AskUserQuestion, Agent
metadata:
  clawdbot:
    emoji: "🔍"
---

# GEO诊断报告

品牌GEO可见度诊断专家。4阶段流水线，搜索增强+虚拟推理双模式，按需加载引用文件。

## 运行要求

- **Node.js ≥ 14.0** — HTML 报告生成脚本（`build-report.js` / `merge-stages.js`）依赖 Node.js 运行时，仅使用内置模块（`fs` / `path`），无需 npm install

## 核心概念

- **GEO可见度** — 品牌在AI搜索回答中被提及的程度。不同于SEO（搜索排名），GEO关注AI生成回答中的品牌曝光
- **AIVO评分** — 四维等权重：AI搜索可见性(25%) × 基建完善度(25%) × 竞争优势(25%) × 舆情健康度(25%)。≥90优秀/≥75良好/≥60一般/<60较差
- **虚拟收录查询** — AI模拟各平台回答推算品牌提及率。不同平台有偏好偏差，同品牌各平台提及率应有±8%合理波动
- **搜索增强** — 先WebSearch获取真实数据，搜索不足时降级为AI推理。真实数据标注来源，推理数据标注⚠️虚拟

## 工作流程

```
用户: "帮我诊断格力空调的GEO效果"
  │
  ├─ 📥 Step 1: 收集输入
  │   品牌名称(必填) + 产品类型(必填) + 官网地址(可选)
  │   → 已提供的直接提取，缺失项用 AskUserQuestion 补充
  │
  ├─ 🔧 Step 2: AskUserQuestion 选择AI平台（multiSelect，默认全选）
  │   □ DeepSeek  □ 豆包  □ 元宝  □ 通义千问
  │   □ 文心一言  □ 纳米搜索  □ Kimi  □ 智谱清言
  │
  ├─ ⚙️ Step 3-6: 4阶段流水线（见下方）
  │
  └─ 📤 Step 7: 合并报告 → 输出 HTML 可视化报告
```

## 输入参数

| 参数 | 必填 | 说明 | 示例 |
|------|------|------|------|
| brandName | ✅ | 品牌名称 | "格力" |
| productType | ✅ | 产品类型 | "空调" |
| website | ❌ | 官网地址 | "https://www.gree.com" |
| selectedPlatforms | ❌ | AI平台编码数组，默认[1,2,3,4,5,6,7,8] | [1,2,4] |

### 平台编码

| 编码 | 平台 | 编码 | 平台 |
|------|------|------|------|
| 1 | DeepSeek | 5 | 文心一言 |
| 2 | 豆包 | 6 | 纳米搜索 |
| 3 | 元宝 | 7 | Kimi |
| 4 | 通义千问 | 8 | 智谱清言 |

### 交互快捷规则

| 场景 | 规则 |
|------|------|
| ✅ 用户消息已含品牌名+产品类型 | 直接提取，仅补缺失项 |
| ✅ 用户已指定平台 | 直接提取，不弹选择框 |

---

## 搜索增强与执行规范

> 搜索策略、速率控制、重试容错详见 `references/search-strategy.md`，搜索阶段执行前 Read。
> 各阶段搜索查询模板详见 `references/search-templates.md`，搜索阶段执行前 Read。

---

## 4阶段流水线

```
阶段1 基础调研（搜索并行：组A+组B同时发起）
   ↓
┌─────────────────────────────────────────┐
│ 阶段2 收录+可见性  ←并行→  阶段3 舆情分析 │
│ （搜索并行）           （搜索并行）        │
└─────────────────────────────────────────┘
   ↓                        ↓
阶段4 评分建议（依赖2+3全部完成）
```

| 阶段 | 内容 | 依赖 | 搜索增强 | 搜索并行 | 预估耗时 |
|------|------|------|----------|----------|----------|
| 阶段1 | 画像+基建(3子步)+竞品 | 无 | 🔍基建+竞品 | 组A(3)并行+组B(2)并行 | 2-3min |
| 阶段2 | 虚拟收录+AI搜索+GEO效果 | 阶段1 | 🔍收录参考 | 组A(2)并行 | 2-3min |
| 阶段3 | 舆情词→收录→分析 | 阶段1 | 🔍舆情搜索 | 组A(3)并行 | 2-3min |
| 阶段4 | 总览+AIVO评分+综合建议 | 阶段1+2+3 | 无 | 无 | 2-3min |

> **v4.0优化**：阶段2和3互不依赖，必须并行执行。各阶段搜索请求分组并行发起。
> 优化后总耗时约6-8分钟（原10-14分钟）。

### 合并策略

- 阶段1：USER_PROFILE + INFRA_EVAL + COMPETITOR 合并为单次推理 → Write `stage1.json`
- 阶段2：虚拟收录查询结果 + AI搜索 + GEO效果 合并为单次推理 → Write `stage2.json`
- 阶段3：SENTIMENT step1+step2+step3合并为单次推理 → Write `stage3.json`
- 阶段4：OVERVIEW + AIVO_SCORE + SUGGESTION 合并为单次推理 → Write `stage4.json`
- **合并**：`node "geo-diag-report/scripts/merge-stages.js" <output-dir> <brand> <product>` → 生成完整JSON

> **v4.0优化**：每个阶段完成后立即Write独立JSON文件（约10-15KB），避免一次性生成56KB大JSON。
> 阶段2和3的JSON可并行写入，最后用merge-stages.js合并。

### stageCode 映射

| 阶段 | stageCode | 说明 |
|------|-----------|------|
| 阶段1 | USER_PROFILE | 用户画像+搜索场景 |
| 阶段1 | INFRA_EVAL | 基建评估（官网+自媒体+权威媒体） |
| 阶段1 | COMPETITOR | 竞品分析 |
| 阶段2 | AI_SEARCH | AI搜索提及率 |
| 阶段2 | GEO_EFFECT | GEO效果统计 |
| 阶段3 | SENTIMENT | 舆情分析 |
| 阶段4 | OVERVIEW | 总览摘要 |
| 阶段4 | AIVO_SCORE | AIVO评分 |
| 阶段4 | SUGGESTION | 综合建议 |

### 最终输出结构

```json
{
  "version": "4.1",
  "brand": "<品牌名称>",
  "category": "<产品类型>",
  "stages": {
    "OVERVIEW": { ... },
    "AIVO_SCORE": { ... },
    "USER_PROFILE": { ... },
    "AI_SEARCH": { ... },
    "INFRA_EVAL": { ... },
    "COMPETITOR": { ... },
    "GEO_EFFECT": { ... },
    "SENTIMENT": { ... },
    "SUGGESTION": { ... }
  }
}
```

`stages` key 必须使用上述 stageCode（大写）。

---

## 收录查询虚拟化

AI模拟各平台回答推算品牌提及率。搜索增强：先WebSearch获取真实提及数据，无结果时纯推理。

详细Prompt见 `references/prompts.md` 阶段2。平台偏好参数详见 `references/platform-data.md`。

| 调用点 | 输入 | 输出用途 | 搜索增强 |
|--------|------|----------|----------|
| R1完成后 | USER_PROFILE搜索问题 | AI_SEARCH、GEO_EFFECT | 搜索"{brandName} {productType} 推荐" |
| SENTIMENT step1后 | 舆情查询词 | SENTIMENT step2 | 搜索"{brandName}" 负面/投诉 |

---

## 输出规则

### HTML报告

AI 每阶段独立输出JSON，`merge-stages.js` 合并后 `build-report.js` 生成HTML：

```
1. 阶段1完成 → Write diag-output/stage1.json
2. 阶段2完成 → Write diag-output/stage2.json
3. 阶段3完成 → Write diag-output/stage3.json
4. 阶段4完成 → Write diag-output/stage4.json
5. Bash: node "geo-diag-report/scripts/merge-stages.js" diag-output <brand> <product>
6. Bash: node "geo-diag-report/scripts/build-report.js" <merged-json-path> [output-path]
7. 脚本自动：读取模板 → 验证JSON → 替换占位符 → 输出HTML
8. ✅ 输出完成 → 告知用户报告路径
```

> **v4.0优化**：分阶段写入，每个阶段JSON约10-15KB，AI生成速度提升3-5倍。

---

## 错误恢复

| 错误 | 操作 |
|------|------|
| ⚠️ JSON解析失败 | 重试1次 → 仍失败标注⚠️跳过 |
| 🔍 WebSearch不可用 | 自动降级纯虚拟模式 |
| 🌐 build-report.js失败 | 检查JSON → 降级AI直接写HTML片段 |
| 📊 虚拟收录异常(全100%/全0%) | 重试1次 → 仍异常标注⚠️ |

---

## 引用文件

### references/ — 按需加载文档

| 引用文件 | 内容 | 加载时机 |
|----------|------|----------|
| `references/skill-relations.md` | 编排模式+扩展步骤（深度分析/战略报告） | 编排诊断前Read |
| `references/prompts.md` | 4阶段Prompt模板 | 各阶段执行时Read对应section |
| `references/search-strategy.md` | 搜索增强策略+执行规范 | 搜索阶段执行前Read |
| `references/search-templates.md` | 各阶段搜索查询模板 | 搜索阶段执行前Read |
| `references/scoring-rules.md` | AIVO评分+裁剪+质量检查+反模式 | AIVO评分时Read |
| `references/platform-data.md` | 平台编码+偏好参数+知名度区间 | 收录查询时Read |
| `references/changelog.md` | 版本更新日志 | 需要时Read |
| `references/evals/evals.json` | Skill 评测用例（触发/反触发/编排） | 评测时Read |

### scripts/ — 可执行代码

| 引用文件 | 内容 | 调用方式 |
|----------|------|----------|
| `scripts/build-report.js` | HTML报告构建脚本 | 输出时Bash调用 |
| `scripts/merge-stages.js` | 阶段JSON合并脚本（v4.0新增） | 4阶段全部完成后Bash调用 |

### scripts/assets/ — 输出模板

| 引用文件 | 内容 | 使用方式 |
|----------|------|----------|
| `scripts/assets/geo-diag-renderer.html` | HTML渲染模板 | build-report.js自动读取 |

**执行规则**（Bash 路径相对于 workbuddy-skills 根目录，Read 路径相对于 skill 根目录 `geo-diag-report/`）：
- 编排诊断前：Read `references/skill-relations.md`
- 阶段1前：Read `references/prompts.md`阶段1 + `references/search-strategy.md` + `references/search-templates.md`（一次性加载，后续阶段复用）
- 阶段2+3前：Read `references/prompts.md`阶段2+3 + `references/platform-data.md`（阶段2和3并行执行，引用文件一次性加载）
- 阶段4前：Read `references/prompts.md`阶段4 + `references/scoring-rules.md`

> **v4.0优化**：减少重复Read，`search-strategy.md`和`search-templates.md`在阶段1前加载后缓存，后续阶段不再重复加载。