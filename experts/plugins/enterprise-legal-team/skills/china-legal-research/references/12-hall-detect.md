# 法规/法条/案例幻觉检测

> POST /open/hall_detect
> 计费: 50 积分/次

检测文本中引用的法规、法条、案例是否存在幻觉（即是否真实存在、内容是否准确）。

## 请求参数（Body）

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| text | string | 是 | 待检测文本 |

## 返回结构

```json
{
  "code": 200,
  "msg": "success",
  "data": {
    "regulations": [
      {
        "name": "法规名称",
        "clause": "法条编号",
        "content": "法条内容",
        "extract_reg_id": "法规ID",
        "url": "法规链接",
        "think_tank_content": "智库内容",
        "source_no_specific_clause": false,
        "law_exists": true,
        "semantic_compare": {
          "结论": "一致/不一致/部分一致",
          "语义相似度": 0.95,
          "说明": "说明文字",
          "要点": ["要点1", "要点2"],
          "skipped": false
        }
      }
    ],
    "cases": [
      {
        "name": "案例名称",
        "case_number": "案号",
        "content": "案例内容",
        "url": "案例链接",
        "think_tank_content": "智库内容",
        "case_type": "案件类型",
        "court": "审理法院",
        "judgment_date": "裁判日期",
        "basic_facts": "基本事实",
        "judgment_key_points": "裁判要点"
      }
    ],
    "highlighted_text": "标注后的文本",
    "semantic_compare_error": null,
    "chat_model": "模型名称",
    "request_id": "请求ID"
  }
}
```

### regulations[] 字段

| 字段名 | 类型 | 说明 |
|--------|------|------|
| name | string | 法规名称 |
| clause | string | 法条编号 |
| content | string | 法条实际内容 |
| extract_reg_id | string | 提取到的法规 ID |
| url | string | 法规详情链接 |
| think_tank_content | string | 智库补充内容 |
| source_no_specific_clause | boolean | 原文是否未指明具体条款 |
| law_exists | boolean | 该法规/法条是否真实存在 |
| semantic_compare | object | 语义比对结果 |

### semantic_compare 字段

| 字段名 | 类型 | 说明 |
|--------|------|------|
| 结论 | string | 一致/不一致/部分一致 |
| 语义相似度 | float | 0-1 之间的相似度分数 |
| 说明 | string | 比对说明 |
| 要点 | string[] | 关键差异要点 |
| skipped | boolean | 是否跳过了比对 |

### cases[] 字段

| 字段名 | 类型 | 说明 |
|--------|------|------|
| name | string | 案例名称 |
| case_number | string | 案号 |
| content | string | 案例内容 |
| url | string | 案例详情链接 |
| think_tank_content | string | 智库补充内容 |
| case_type | string | 案件类型 |
| court | string | 审理法院 |
| judgment_date | string | 裁判日期 |
| basic_facts | string | 基本事实 |
| judgment_key_points | string | 裁判要点 |
