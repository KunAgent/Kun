# 法规关键词检索

> POST /open/rh_fg_search
> 计费: 10 积分/次

对法规进行关键词检索与条件过滤。允许不传 keyword，不传则主要按过滤条件返回法规列表。

## 请求参数（Body）

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| keyword | string | 否 | 法规内容关键词 |
| search_mode | string | 否 | 关键词拼接模式，默认 AND |
| fgmc | string | 否 | 法规名称过滤 |
| sxx | string | 否 | 时效性过滤；按空格拆分后命中任一 |
| xljb_1 | string | 否 | 效力级别过滤；按空格拆分后命中任一 |
| fbrq_start | string | 否 | 发布日期起 yyyy-MM-dd |
| fbrq_end | string | 否 | 发布日期止 |
| ssrq_start | string | 否 | 实施日期起 |
| ssrq_end | string | 否 | 实施日期止 |
| top_k | number | 否 | 返回条数上限（默认10，最大50） |

## 返回结构

返回 `status`/`code`/`message`/`data[]`，结构与法条关键词检索（02）类似，`data[]` 包含法规元信息。
