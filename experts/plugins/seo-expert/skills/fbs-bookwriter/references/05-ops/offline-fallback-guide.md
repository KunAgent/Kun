# 离线降级操作手册

> **版本**：2.1.1 · **层级**：平台侧（执行参考）  
> **用途**：聚合散落在多个文件中的离线降级规则，提供单一权威入口。  
> **规则来源**：`intake-and-routing.md` · `search-policy.json §offlineFallback` · `execution-contract-brief.md §3` · `promise-code-user-alignment.md`

---

## 一、核心原则

1. **禁止静默降级**：无法联网时，必须向用户**显式声明**"当前为离线降级"，不得静默改用模型知识填充。
2. **降级≠停止**：离线时仍可进行本地素材盘点、已有文档分析、目录草稿生成等不依赖网络的操作。
3. **降级须留痕**：离线降级的内容须在对应段落末尾附 `[离线降级：原因]` 标注，以便后续补查。
4. **enforce-search-policy.mjs 校验**：若宿主运行 `node scripts/enforce-search-policy.mjs`，降级须符合 `search-policy.json §offlineFallback.defaultUserFacingTemplate` 定义的模板格式。

---

## 二、触发场景与降级动作

| 触发场景 | 判断条件 | 降级动作 |
|----------|----------|----------|
| 宿主无内容搜索端点 | `effectiveEndpointStrategy` 路由无可用节点 | 告知用户"无法联网搜索"→ 进入路径 C 或本地规则补充写作 |
| 网络超时（单页拉取） | 超过 `searchAccessPolicy.singlePageTimeoutMs`（默认15000ms）| 按 Bing RSS 降级策略尝试；仍失败则声明离线降级 |
| S0 无法完成联网检索 | `search-ledger.jsonl` 中无 S0 阶段记录 | 显式声明"S0 离线降级（原因：xxx）"，并在 `.fbs/search-ledger.jsonl` 写入降级记录 |
| S2.5 素材严重不足 | `materialSufficiency.criticalBelow` 未达标（素材条数低于阈值） | 暂停推进，告知用户需补充素材；不自动用模型知识填充 |

---

## 三、降级声明格式

**口语式（对用户）**：
> 我目前无法联网搜索，但我们可以先整理您已有的内容；我会明确标注为离线降级，后续联网后可以补查。

**台账记录格式**（写入 `.fbs/search-ledger.jsonl`）：
```jsonl
{"stage":"S0","timestamp":"2026-04-10T10:00:00Z","status":"offline_fallback","reason":"宿主无搜索端点","degradedTo":"local_materials_only"}
```

**正文内联标注**：
```
[离线降级：搜索引擎不可用，数据来源为模型知识，待联网后补查]
```

---

## 四、离线时可执行的操作

即使完全离线，以下操作仍可正常执行：

- ✅ 读取/分析用户提供的本地素材（PDF、文档、笔记）
- ✅ 运行本地质检脚本（`quality-auditor-lite.mjs`、`terminology-gate.mjs`）
- ✅ 更新 `.fbs/` 工件（台账、状态、GLOSSARY）
- ✅ 生成目录草稿（基于已有素材）
- ✅ 写作已有素材支撑的章节内容
- ❌ 执行 L1–L5 联网情报收集
- ❌ 验证引用 URL 有效性
- ❌ 获取最新时间标签

---

## 五、相关配置字段

```json
// search-policy.json
{
  "offlineFallback": {
    "enabled": true,
    "defaultUserFacingTemplate": "我目前无法联网搜索，将以离线模式处理...",
    "requiredFields": ["offlineFallback"]
  }
}
```

---

## 六、参考文档

| 文档 | 相关章节 |
|------|----------|
| `intake-and-routing.md` | §特殊：AI 无法直接搜索时的降级策略 |
| `search-policy.json` | `offlineFallback`、`conditionalWebSearchStages` |
| `execution-contract-brief.md` | §3 离线降级约束 |
| `promise-code-user-alignment.md` | 第10行：失败时按 policy 降级标注 |
| `enforce-search-policy.mjs` | 运行时降级格式校验 |
