# 法条详情

> POST /open/rh_ft_detail
> 计费: 10 积分/次

## 请求参数（Body）

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| id | string | 否 | 详情目标 ID |
| fgmc | string | 否 | 法规名称（当 id 为空时必填） |
| ftnum | string | 否 | 法条号/名称（当 id 为空时必填） |
| refer_date | string | 否 | 参考日期 yyyy-MM-dd |

## 校验规则

- id 与 fgmc+ftnum 同时为空 → 返回 501 "id与法规名称不可同时为空！"

## 返回结构

成功时返回 `data` 对象（或列表），包含法条全文及所属法规元信息。结构类似关键词检索的 `data[]` 单条元素。
