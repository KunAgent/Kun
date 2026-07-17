# 法条关键词检索

> POST /open/rh_ft_search
> 计费: 10 积分/次

## 请求参数（Body）

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| keyword | string | 是 | 法条内容关键词；按 search_mode 将空格拆分并用 AND/OR 拼接 |
| search_mode | string | 否 | 关键词拼接模式，默认 AND（转为大写） |
| fgmc | string | 否 | 法规名称过滤；按空格拆分后，法规标题需全部命中 |
| xljb_1 | string | 否 | 效力级别过滤；按空格拆分后命中任一即可 |
| sxx | string | 否 | 时效性过滤；按空格拆分后命中任一即可 |
| fbrq_start | string | 否 | 发布日期起 yyyy-MM-dd |
| fbrq_end | string | 否 | 发布日期止 |
| ssrq_start | string | 否 | 实施日期起 |
| ssrq_end | string | 否 | 实施日期止 |
| top_k | number | 否 | 返回条数上限（默认10，最大50） |

## 校验规则

- body 为空 JSON → 返回失败 `message = "请求参数不能为空"`
- keyword 为空 → 返回 501 `message = "keyword 参数不可为空！"`
- top_k: 未传或 ≤0 → 10，>50 → 50
- search_mode 未传或为空 → 默认 AND；否则转大写

## 返回结构

### 通用返回字段

| 字段名 | 类型 | 说明 |
|--------|------|------|
| status | string | success / failed |
| code | number | 成功 200；失败 500/501 |
| message | string | 提示信息 |
| data | object[] \| null | 命中时为列表；失败时 null |

### data[] 单条元素字段

| 字段名 | 类型 | 说明 |
|--------|------|------|
| id | string | 法条文档 ID |
| _score | number | ES 评分 |
| ftmc | string | 《法规名称》+ 法条名称 |
| title | string | 同 ftmc |
| fgid | string | 所属法规 ID |
| tid | string | 法条编号 |
| url | string | 详情地址 |
| content | string | 法条内容 |
| fgmc | string | 法规名称 |
| ft_num | string | 法条号/名称 |
| llm_content | string | 格式化摘要：`- 《{fgmc}》{ft_num}##{content}` |
| sxx | string | 所属法规时效性 |
| xljb_1 | string | 所属法规效力级别-一级 |
| xljb_2 | string | 所属法规效力级别-二级 |
| ssrq | string | 所属法规实施日期 |
| fbrq | string | 所属法规发布日期 |
| fbbm | string | 所属法规发布部门 |
| fwzh | string | 所属法规发文字号 |

> 备注：法规回填字段只有在法规概要查询命中且能取到值时才会写入。

### 示例

**请求：**
```json
{
  "keyword": "行政处罚",
  "search_mode": "AND",
  "fgmc": "中华人民共和国行政处罚法",
  "sxx": "现行有效",
  "top_k": 10
}
```

**成功响应（200）：**
```json
{
  "code": 200,
  "data": [
    {
      "id": "0c15f68cf89e1339125e9f41d5d31c67_59",
      "_score": 52.88,
      "ftmc": "中华人民共和国行政处罚法(2021修订)第五十九条",
      "title": "中华人民共和国行政处罚法(2021修订)第五十九条",
      "fgid": "0c15f68cf89e1339125e9f41d5d31c67",
      "tid": "59",
      "url": "/zxt/statuteDetail/detailPage/0c15f68cf89e1339125e9f41d5d31c67?text=59",
      "content": "行政机关依照本法第五十七条的规定给予行政处罚...",
      "fgmc": "中华人民共和国行政处罚法(2021修订)",
      "ft_num": "第五十九条",
      "llm_content": "- 《中华人民共和国行政处罚法(2021修订)》第五十九条##行政机关...",
      "sxx": "现行有效",
      "xljb_1": "法律",
      "xljb_2": "法律",
      "ssrq": "2021-07-15",
      "fbrq": "2021-01-22",
      "fbbm": "全国人大常委会",
      "fwzh": "中华人民共和国主席令第70号"
    }
  ],
  "message": "请求成功",
  "status": "success"
}
```

**失败响应（501）：**
```json
{"data": null, "status": "failed", "code": 501, "message": "keyword 参数不可为空！"}
```
