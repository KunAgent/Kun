# 案例详情

> GET /open/rh_case_details
> 计费: 10 积分/次

按类型获取普通案例或权威案例的详情信息。

## 请求参数（Query）

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| id | string | 否 | 案例标识 |
| ah | string | 否 | 案号；当未传 id 时用于查询 |
| type | string | 是 | 类型：ptal（普通案例）或 qwal（权威案例） |

## 校验规则

- id 与 ah 同时为空 → 返回失败 "参数异常！"
- type 非 ptal/qwal → 返回失败 "不支持的type类型"

## 返回结构

成功时 `data` 为单个对象（非列表），包含案例完整文书内容。主要字段：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| id | string | 案例文档 ID |
| title | string | 案例标题 |
| ah | string | 案号 |
| ay | string[] | 案由 |
| jbdw | string | 经办法院 |
| cj | string | 法院层级 |
| content | string | 完整裁判文书正文 |
| jaDate | string | 裁判日期 |
| wszl | string | 文书种类 |
| ajlb | string | 案件类别 |
| xzqh_p | string | 省份 |
| type | string | 案例类型（ptal/qwal） |
