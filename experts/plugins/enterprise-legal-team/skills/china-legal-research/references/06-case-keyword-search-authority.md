# 权威案例关键词检索

> POST /open/rh_qwal_search
> 计费: 10 积分/次

对"权威案例"库进行多条件/关键词检索。参数同普通案例关键词检索，但无 `fxgc` 和 `yyft` 字段。

## 请求参数（Body）—— 以下字段均为可选，但请求体不能为空

| 字段名 | 类型 | 说明 |
|--------|------|------|
| qw | string | 全文关键词 |
| search_mode | string | 关键词拼接模式：and 或 or；默认 and |
| ah | string | 案号 |
| title | string | 标题 |
| ay | string[] | 案由数组 |
| jbdw | string[] | 经办法院数组 |
| xzqh_p | string[] | 省级行政区数组 |
| wszl | string[] | 文书种类数组 |
| ajlb | string | 案件类别 |
| ja_start | string | 裁判日期起 yyyy-MM-dd |
| ja_end | string | 裁判日期止 |
| top_k | number | 返回条数上限（默认10，最大50） |

## 返回结构

与普通案例关键词检索（05）结构相同：`status`/`code`/`message`/`data`，其中 `data` 为 `{total, lst}` 对象，`lst[]` 字段与 05 一致。
