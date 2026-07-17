# 证据锚定与溯源映射（evidence-matching-spec）

脚本 `match-evidence.mjs` 把每个核验点**锚定**到已持久化来源的真实段落，让用户点击即可跳到原文自行核验。输出 `verification/evidence_matches.json` 与 `citations.json`。

## 核心定位：溯源助手，不是对错裁判（务必先读）

本工作台的核心定位如下：

- **它帮用户「溯源」，不替用户「判对错」。** 不能用文字精确匹配去判断 AI 这句话写得"对不对"，也不能用「已验证」这类价值判断标签，原因有二：
  1. 核验本身也是 AI/脚本在做。一个绿色「已验证」会让用户放心地不再核验；一旦核验也错了，用户反而受损。核验功能绝不能给用户"已经替你确认无误"的错觉。
  2. 一份好的法律意见是**对法条的归纳转述**，不会照抄条文原文（否则可读性极差）。用文字精确匹配，结果就是几乎全部「未匹配」，报告会失去参考价值。
- **关联性由 AI 的语义判断决定，不由文字是否雷同决定。** **意见定稿后**，复盘的 AI 重新通读成稿，对每句话判断"它依据的是哪部法、哪一条"（语义关联），写进 claims.json。脚本不重新判断这句话写得对不对，**只确认声明的那个来源/条文是否真实存在**于本次资料里（防 AI 编造幻觉），然后把它锚到真实段落，用户点开看原文，自己判断。
- **核验是事后外挂，不影响输出。** 声明发生在定稿之后、`claimText` 逐字摘自成稿，所以核验既不改变也不约束正文的写法与风格——正文该怎么写就怎么写，溯源只是在其上叠加的可点击线索。

## 三个客观标签

标签是**倾向性的溯源辅助提示**，是客观呈现而非确定性结论：

| 标签 | 含义（给用户看的） | 触发条件 | 颜色 |
|---|---|---|---|
| `associated`（已关联） | AI 声明了依据，且该来源/条文在本次资料中**真实存在**，已锚到原文，点击可查 | 声明来源存在 +（若声明了条号）条号也存在 | 蓝青中性 `#2563b0` |
| `weak`（弱关联） | 来源在、但声明的条号查无；或在没有 AI 声明可用时，系统按语义相关度**推荐**的可能相关段落（非 AI 明确声明的直接依据），请自行判断 | `article_not_found` / `similarity_suggestion` | 黄提示 `#c98a00` |
| `unverified`（待核验） | 没有可溯源的依据线索，需你自行核验——**这不等于"错"**，只是本次资料没给出可点击的来源 | 声明来源不存在 / 无声明且无相似候选 | 灰中性 `#6b7787` |

> 三个标签都是**客观陈述「能不能溯源、语义上关不关联」**，绝不含"已核验/正确/无误"这类价值判断与确定性结论。

## 锚定流程（两步）

### 第一步：按「声明/抽取出的目标」锚定（确认存在，不判对错）

核验点的 `normalizedTarget` 来自两个渠道（见 `@references/verification-point-spec.md`）：AI 声明的 `claims.json`（`declared:true`，优先）或规则兜底抽取（`declared:false`）。锚定逻辑：

- **案号（case_ref）** → `anchorByCaseNo`：归一化括号/空格后比对 `source_index.caseNo` 精确相等；不中再在段落正文找案号子串。命中→`associated`；查无→`unverified`。
- **法条 / 监管文件 / 任何声明了来源的论断** → `anchorByDeclaredTarget`：
  1. `resolveSource`：先按 `sourceId` 直接命中；否则按 `lawTitleSimilarity(目标法名, 来源标题)` 找最佳来源（阈值 ≥0.6，含别名/简称/子序列匹配，如"个保法"⊇"个人信息保护法"）。
  2. **来源都找不到** → `unverified`，提示"声明的依据未在本次已检索资料中找到，请自行核验来源"。
  3. 来源找到，且**声明了条号** → 在该来源 `article_index` 用 `lookupArticle` 查 `第X条`：
     - 条号存在 → `associated`（method `declared_article_exists`），锚到该条段落，reason 写"该条文在本次资料中存在，点击查看原文自行核验"。
     - **条号查无 → `weak`（method `article_not_found`）**，note 提示"来源已找到，但声明的条文号在本次资料中不存在，请核对条号后自行查证"，**绝不近似绑定相邻条文**。
  4. 来源找到，**未声明条号** → `associated`（method `declared_source_exists`），用 `sharedPhraseBonus + bigramJaccard` 选该来源内话题最贴近的段落锚定。
  5. 来源 `status:"不完整"` 时，即使锚到也降为 `weak` 并标"来源内容不完整，命中后仍需人工复核"。

### 第二步：相似度仅做「候选推荐」（永不判对错）

当核验点没有任何可锚定的声明目标（如纯观点/结论，`normalizedTarget` 为空）时，`similarityCandidates` 按语义相关度打分挑出候选段落：

```
score = bigramJaccard(claim, para)*0.55
      + keywordOverlap(claim, para)*0.25
      + sharedPhraseBonus(claim, para)        # 共享法律术语长串，如"安全保障义务"
      + 标题对齐(>0.7) +0.15
      + 类型对齐(case↔case +0.08 / law +0.05)
      + 时效加权(现行有效 +0.03 / 已废止 -0.1 / 不完整 -0.05)
```

- 取 top6，过滤掉 `score ≤ RELATED_FLOOR(0.18)` 的弱噪声。
- 有候选时，把分最高的锚为 `weak`（method `similarity_suggestion`），note 明确写"此为系统推荐的语义相关段落，并非回答明确声明的依据，请自行判断关联性"。
- **相似度永远只能产出 `weak`（推荐去看看），绝不会产出 `associated`，更不会有"已验证"。** 相似度只是给用户的阅读建议，不是判定对错的依据。
- 当已有 `claims.json` 提供 AI 语义声明时，抽取阶段会抑制无具体目标的软触发结论句，因此相似度弱关联主要只作为无声明/声明缺失场景下的兜底，不应在高质量最终报告中大量出现。若仍出现，必须进入二次补检：确认依据后升级已关联、发现错误则修正正文、确认只是前文依据后的结论则忽略。
- 其余候选（最多 5 条）放进 `match.candidates`，供用户/可选 AI 复核时挑选，不构成结论。

## evidence_matches.json

```json
{
  "taskId": "...",
  "stats": { "points": 112, "associated": 55, "weak": 51, "unverified": 6, "statuteHits": 60, "caseHits": 0 },
  "matches": [
    {
      "pointId": "vp-001", "type": "statute_article",
      "text": "处理个人信息应当取得个人的单独同意。",
      "snippet": "《个人信息保护法》第二十九条",
      "answerParagraphIndex": 12,
      "label": "associated",
      "method": "declared_article_exists",
      "riskLevel": "high",
      "note": "",
      "citations": [{
        "citationId": "cite-001", "pointId": "vp-001",
        "sourceId": "ab12cd34ef56", "sourceTitle": "中华人民共和国个人信息保护法",
        "paragraphIds": ["ab12cd34ef56:P29"], "paragraphRange": "P29",
        "quotedText": "[P29] 第二十九条 处理敏感个人信息应当取得个人的单独同意……",
        "reason": "回答声明依据《个人信息保护法》第29条，该条文在本次资料中存在，点击查看原文自行核验",
        "method": "declared_article_exists"
      }],
      "candidates": []
    }
  ]
}
```

字段说明：
- **`label`** 取值 `associated|weak|unverified`，是客观溯源标签而非对错判定。
- **`candidates`** 是"建议去看的相关段落"，每条带 `paragraphId/sourceTitle/score/preview`。
- **移除了 `score`（点级总分）与 `needsAiRerank`**——不再有"分数决定对错"的概念。
- `method` 取值：`declared_article_exists` / `declared_source_exists` / `article_not_found` / `case_no_exists` / `case_no_in_text` / `similarity_suggestion` / `none`。
- 当来源找到但无具体段落（如 `article_not_found`）时，`citations[]` 仍放一条 `citationId:null`、`paragraphIds:[]` 的占位记录，用于在证据面板展示上下文说明。

`citations.json` 是所有**真正锚到段落**的引用（`paragraphIds` 非空）的扁平汇总，供 HTML 与外部消费。

## 关键测试用例

1. 个保法全文 + 声明"《个人信息保护法》第二十九条" → `associated`，锚到 P(第29条) 原文。
2. 声明"个保法第十三条"，来源标题"中华人民共和国个人信息保护法" → 简称别名命中来源，条号存在 → `associated`。
3. 声明"《个人信息保护法》第九十九条"，来源无此条 → `weak`（`article_not_found`），提示核对条号，**绝不跳到第9/69条**。（故意植入"第999条"测试已验证此防编造逻辑生效。）
4. 来源含案号"（2023）京0105民初12345号"，回答引用 → `anchorByCaseNo` 命中案例来源 → `associated`。
5. 纯观点"法院通常认为平台未尽安全保障义务应担责"，无声明目标 → 走相似度推荐，锚到"本院认为/安全保障义务"段落，标 `weak`（`similarity_suggestion`），note 提示"系统推荐、非声明依据"。
6. 声明的来源根本没入库 → `unverified`，提示"未在本次资料中找到，请自行核验来源"——明确告诉用户这不是"错"，是无法溯源。
7. 来源仅网页摘要 `status:"不完整"` → 命中也降 `weak`，提示需人工复核。
