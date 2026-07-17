# 法律法规语义检索

> POST /open/law_vector_search
> 计费: 10 积分/次

## 请求参数（Body）

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| query | string | 是 | 待检索问题 / 查询文本 |
| rewrite_flag | boolean | 否 | 是否对查询做改写，默认为 true |
| fatiao_filter | object | 否 | 法律法规检索过滤条件 |
| return_num | int | 否 | 返回法律法规数量（默认45，最大不超过检索回总数） |

### fatiao_filter 字段说明（以下均为可选）

| 字段名 | 类型 | 说明 |
|--------|------|------|
| sxx | string[] | 时效性：现行有效、失效、已被修改、部分失效、尚未生效 |
| effect1 | string[] | 一级效力级别（见下表） |
| law_start | string | 法条生效起始日期 YYYY-MM-DD |
| law_end | string | 法条生效结束日期 YYYY-MM-DD |

### 一级效力级别（effect1）

宪法、法律、司法解释、行政法规、监察法规、部门规章、党内法规、军事法规规章、立法机关工作文件、行政机关工作文件、行业/团体规范、地方性法规、自治条例和单行条例、地方司法文件、地方政府规章、地方规范性文件、地方律协规定

## 返回结构

```json
{
  "msg": "成功(返回结构化数据)",
  "code": 201,
  "answer": "",
  "extra": {
    "fatiao": [
      {
        "ftid": "法条id",
        "fgid": "法规id",
        "fgtitle": ["法规名称"],
        "num": "法条条目",
        "content": "内容",
        "sxx": "时效性",
        "effect1": "一级效力级别",
        "effect2": "二级效力级别",
        "dy": "地域",
        "location": "地域含市",
        "start": 20180311,
        "end": 99999999,
        "score": 0.306,
        "type": 1
      }
    ]
  }
}
```

### 通用返回字段

| 字段名 | 类型 | 说明 |
|--------|------|------|
| msg | string | 返回状态说明 |
| code | int | 非 201 均为异常；HTTP 401 为鉴权失败 |
| extra | object | 取 `fatiao` 字段值，其他为空 list |

### extra.fatiao[] 字段

| 字段名 | 类型 | 说明 |
|--------|------|------|
| ftid | string | 法条 ID |
| fgid | string | 法规 ID |
| fgtitle | string[] | 法规名称 |
| num | string | 法条条目 |
| content | string | 法条内容 |
| sxx | string | 时效性 |
| effect1 | string | 一级效力级别 |
| effect2 | string | 二级效力级别 |
| dy | string | 地域 |
| location | string | 地域含市 |
| start | int | 实施日期 |
| end | int | 失效日期 |
| score | float | 相似度评分 |
| type | int | 类型标识 |
