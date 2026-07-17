# 法条法规检索 — 详细操作指南

本文档为法条法规检索的详细操作指南，由 SKILL.md 引用。执行检索流程时阅读本文档。

## 阶段 1：收集检索信息

引导用户描述需要检索的法律法规内容：「请告诉我你想查询的法律法规内容，比如：劳动合同解除的相关规定、知识产权侵权的法律依据等。」

如果用户提供的描述比较笼统，可以追问具体方向（如具体法律名称、具体条款场景等）。

## 阶段 2：构建检索条件并调用

将用户的自然语言输入转换为结构化检索条件，**不超过 3 条**，每条格式为「《xxx法/规》、xxx内容」。

转换规则：
- 如果用户提到了具体法律名称（如「劳动法」「民法典」），用 `lawName` 字段精确检索
- 如果用户描述的是场景或问题（如「加班工资怎么算」），用 `_text_` 字段全文检索
- 可组合多条 TextSearch 实现更精准的检索

```bash
python3 scripts/tencent_esign.py call DescribeRiskIdentificationLawDocuments '{
  "TextSearchList": [
    {"FieldNameList": ["_text_"], "ValueList": ["关键词1"]},
    {"FieldNameList": ["lawName"], "ValueList": ["法律名称"]}
  ],
  "Limit": 10,
  "Offset": 0
}'
```

## 阶段 3：检索结果 — 返回值解析

接口返回的 JSON 结构：

```json
{
  "Response": {
    "Total": 25,
    "DocumentList": [
      {
        "Title": "中华人民共和国劳动合同法",
        "LawName": "劳动合同法",
        "LawNo": "主席令第七十三号",
        "Href": "https://...",
        "HighlightSegmentList": [
          {"SegmentType": "第四十七条", "Text": "经济补偿按劳动者..."}
        ]
      }
    ],
    "RequestId": "xxx"
  }
}
```

**解析步骤**（严格按此路径取值）：

1. `resp = json.loads(output)` — 解析整个 JSON 字符串
2. `response = resp["Response"]` — 取 Response 对象（dict）
3. `total = response["Total"]` — 取总数（int）
4. `docs = response["DocumentList"]` — 取文档数组（list），每个元素是 dict
5. 遍历 `docs`，每个 `doc` 是 dict：`doc["Title"]`、`doc["LawNo"]`、`doc["HighlightSegmentList"]`（list of dict）

## 阶段 3：检索结果 — 展示规则

1. **概览**：「共检索到 **{Response.Total}** 条相关法律法规，为你展示最相关的 {实际展示条数} 条：」

2. **结果列表**（逐条展示，每条对应 `DocumentList` 数组中的一个 dict）：

> **📜 {doc["Title"]}**
> - 文号：{doc["LawNo"]}
> - 相关条款：
>   - **{segment["SegmentType"]}**：{segment["Text"]}
>   - **{segment["SegmentType"]}**：{segment["Text"]}

每行对应数组元素，字段映射：`doc["Title"]` → 标题、`doc["LawName"]` → 法律名称、`doc["LawNo"]` → 文号、`doc["Href"]` → 原文链接、`doc["HighlightSegmentList"]` → 相关条款数组（每项是 dict，含 `SegmentType` 和 `Text`）

展示规则：
- 默认展示前 5 条法律文档
- 每条法律最多展示 3 个最相关的条款片段（`HighlightSegmentList` 前 3 项）
- 结果超过 5 条时提示：「还有更多结果，是否继续查看？或者缩小检索范围。」
- 如果 `Href` 不为空，附上「[查看原文全文]({Href})」链接

## 翻页

用户要求查看更多结果时，使用 `Offset` 参数翻页（首次 Offset=0，第二页 Offset=10，依此类推）。
