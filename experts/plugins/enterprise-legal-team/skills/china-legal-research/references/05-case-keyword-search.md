# 普通案例关键词检索

> POST /open/rh_ptal_search
> 计费: 10 积分/次

对"普通案例"库进行多条件/关键词检索。

## 请求参数（Body）—— 以下字段均为可选，但请求体不能为空

| 字段名 | 类型 | 说明 |
|--------|------|------|
| qw | string | 全文关键词（按 search_mode 将空格拆分并用 AND/OR 拼接） |
| fxgc | string | 分析过程关键词 |
| search_mode | string | 关键词拼接模式：and 或 or；默认 and |
| ah | string | 案号 |
| title | string | 标题（精确短语匹配） |
| ay | string[] | 案由数组；多值为或关系 |
| jbdw | string[] | 经办法院/承办单位数组；多值为或关系 |
| xzqh_p | string[] | 省级行政区数组；多值为或关系 |
| wszl | string[] | 文书种类数组：判决书、裁定书、调解书、决定书 |
| ajlb | string | 案件类别 |
| ja_start | string | 结案/裁判日期起 yyyy-MM-dd |
| ja_end | string | 结案/裁判日期止 |
| yyft | string[] | 援引法条数组 |
| ft_search_mode | string | yyft 拼接模式：and 或 or |
| top_k | number | 返回条数上限（默认10，最大50） |

> **注意：** `xzqh_p` 传中文省份名（如"广西"）时，偶发 API 端 ES 解析错误。若遇到 `syntax error`，可尝试不带省份筛选，改用 `jbdw` 限定法院。

## 校验规则

- body 为空 JSON → 返回失败 "请求参数不能为空"
- search_mode 非法 → 返回失败 "search_mode 不合法"
- top_k: ≤0 → 10，>50 → 50

## 返回结构

### 通用返回字段

| 字段名 | 类型 | 说明 |
|--------|------|------|
| status | string | success / failed |
| code | number | 成功 200；失败 500/501 |
| message | string | 提示信息 |
| data | object \| null | 命中时为 `{total, lst}`；失败时 null |

### data 对象

| 字段名 | 类型 | 说明 |
|--------|------|------|
| total | number | 总命中数 |
| lst | object[] | 结果列表 |

### lst[] 单条元素字段

| 字段名 | 类型 | 说明 |
|--------|------|------|
| id | string | 案例文档 ID |
| _score | number | ES 评分 |
| title | string | 案例标题 |
| ah | string | 案号 |
| ay | string[] | 案由 |
| jbdw | string | 经办法院 |
| cj | string | 法院层级 |
| xzqh_p | string | 省份 |
| wszl | string | 文书种类 |
| ajlb | string | 案件类别 |
| content | string | 案例正文内容 |
| jaDate | string | 裁判日期 |
| cprq | string | 裁判日期（别名，与 jaDate 含义相同） |
| type | string | 案例类型标识 |
| url | string | 原文链接 |
| llm_content | string | LLM 摘要内容（部分结果含） |
