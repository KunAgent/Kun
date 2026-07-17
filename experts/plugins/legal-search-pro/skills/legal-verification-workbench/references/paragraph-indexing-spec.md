# 段落化与索引规则（paragraph-indexing-spec）

段落索引是整个核验体验的基础。核心原则（迁移自 LawBuddy）：**所有阅读模式共用同一套全文段落编号，同一文件的 `[P42]` 永远指向同一段内容；证据原文由脚本从源 Markdown 精确提取，绝不让模型摘抄当证据。**

实现脚本：`paragraphize-source.mjs`（供 `persist-legal-sources.mjs` 调用；`capture-retrieval-batch.mjs` 捕获到带全文的检索批次后也会间接调用；也可独立运行 `--in source.md`）。

## 段落切分策略

1. **归一化**：统一换行 `\r\n?→\n`、去不可见字符、tab/换页转空格。
2. **主切分**：按空行 `\n{2,}` 切块，trim 后去空。
3. **超长再切**：单块 > 2000 字且含 `\n` 时，按单换行重组——遇到结构边界或累计超 1500 字则断开：
   - markdown 标题 `^#{1,6}\s`
   - 法律条款 `^第[一二三四五六七八九十百千万零〇\d]+条|章|节|部分|编`
   - 编号 `^\d+(?:\.\d+)*\s*[、.．]`、`^[（(][\d一二三四五六七八九十][）)]`、`^[①-⑮]`
   - 英文 `Article/Section/Chapter \d+`

## 每段记录字段

```json
{
  "paragraphIndex": 4,
  "paragraphId": "ab12cd34ef56:P4",
  "sourceId": "ab12cd34ef56",
  "text": "第十三条 符合下列情形之一的……",
  "startOffset": 30, "endOffset": 88,
  "hash": "9f1c…",
  "headingPath": ["第一章 总则"],
  "articleNo": "第13条",
  "caseSection": null
}
```

## 条文识别（法律法规）

行首匹配 `^第\s*([一二三四五六七八九十百千万零〇\d]+)\s*条(?:\s*之\s*([一二三四五六七八九十\d]+))?`。

识别后写入 `article_index.json`，**条号统一归一化为阿拉伯数字 key**（`第十三条`→`第13条`，`第十三条之一`→`第13条之一`）。这样"第十三条"和"第13条"两种写法都能命中同一段：

```json
{
  "ab12cd34ef56": {
    "个人信息保护法": {
      "第1条": ["P2"],
      "第13条": ["P4"],
      "第69条": ["P5"]
    }
  }
}
```

> 中文数字↔阿拉伯数字转换由 `lib.mjs` 的 `cnNumToInt` / `normalizeArticleKey` 完成，支持到"万"级。

## 案例识别

识别并标注 `caseSection`：案号 `（YYYY）…号`、`裁判要旨`、`本院认为/法院认为`、`裁判结果/判决如下`。案号同时抽取进 `source_index.caseNo` 与 manifest，供案号精确匹配。

## 索引文件

- **paragraphs.jsonl**：每行一段（便于流式追加/快速扫描）：
  ```json
  {"sourceId":"ab12cd34ef56","paragraphIndex":4,"paragraphId":"ab12cd34ef56:P4","title":"个人信息保护法","sourceType":"law","articleNo":"第13条","headingPath":["第一章 总则"],"text":"第十三条……","startOffset":30,"endOffset":88,"hash":"…"}
  ```
- **source_index.json**：`{sourceId:{title,normalizedTitle,sourceType,status,provider,paragraphCount,caseNo,url}}`。`normalizedTitle` 去掉《》和"中华人民共和国"前缀，用于法名别名匹配。
- **article_index.json**：见上。
- **inverted_index.json**：关键词（2-4 字 CJK / 3+ 字母 / 2+ 数字）倒排到 `sourceId:Pn`，每词上限 200 条，用于相似度召回加速。

## 重要约束

- 索引在每次 `persist` 时**全量重建**（遍历所有已存来源的 `{id}.json`），保证确定性、可重复。
- 段落 offset 为 best-effort 单调定位，主要用于范围回溯；匹配主要依赖 articleNo / 文本相似度，不强依赖 offset。
