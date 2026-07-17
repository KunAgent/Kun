# 企业详情

> GET /open/rh_company_detail
> 计费: 10 积分/次

## 请求参数（Query）

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| id | string | 否 | 企业 ID（ES 文档 _id） |
| tyshxydm | string | 否 | 统一社会信用代码 |

## 校验与查询优先级

- id、tyshxydm 两者不能同时为空 → 否则返回失败 "参数异常！"
- 若 id 非空 → 按文档 ID 查询
- 否则若 tyshxydm 非空 → 按统一社会信用代码查询
- 结果条数：每次检索 size = 1

## 返回结构

返回 `data` 对象，包含企业完整详情。
