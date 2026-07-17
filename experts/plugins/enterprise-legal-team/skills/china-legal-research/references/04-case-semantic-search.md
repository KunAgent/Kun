# 案例语义检索

> POST /open/case_vector_search
> 计费: 10 积分/次

## 请求参数（Body）

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| query | string | 是 | 待检索问题 / 查询文本 |
| rewrite_flag | boolean | 否 | 是否对查询做改写，默认 true |
| wenshu_filter | object | 否 | 案例检索过滤条件 |
| return_num | int | 否 | 返回案例数量（默认45） |

### wenshu_filter 字段说明（以下均为可选）

| 字段名 | 类型 | 说明 |
|--------|------|------|
| wenshu_type | string | 案件类别 |
| wszl | string[] | 文书种类编码列表 |
| ja_start | string | 结案日期起 YYYY-MM-DD |
| ja_end | string | 结案日期止 |
| dianxing | boolean | 是否仅典型案例；默认 false（普通+权威）；true 仅权威 |
| fayuan | string[] | 法院名称列表 |
| cj | string | 法院层级：最高/高级/中级/基层 |
| xzqh_p | string | 省级行政区 |
| xzqh_c | string | 市级行政区 |

### 案件类别（wenshu_type）

刑事案件、民事案件、行政案件、执行案件、管辖案件、国家赔偿与司法救助案件、强制清算与破产案件、国际司法协助案件、非诉保全审查案件、其他案件

### 文书种类编码（wszl）

| 编码 | 含义 |
|------|------|
| 1 | 判决书 |
| 2 | 裁定书 |
| 3 | 调解书 |
| 4 | 决定书 |
| 5 | 通知书 |
| 6 | 支付令 |
| 7 | 申请书 |
| 8 | 起诉书 |
| 9 | 抗诉书 |
| 10 | 起诉状 |
| 11 | 上诉状 |

## 返回结构

```json
{
  "msg": "成功(返回结构化数据)",
  "code": 201,
  "extra": {
    "wenshu": [
      {
        "scid": "案件id",
        "spcx": "审判程序类型",
        "ajlb": "案件类别",
        "jbdw": "审判单位",
        "title": "案件标题",
        "jand": 2019,
        "jaDate": 20191223,
        "wszl": "文书种类",
        "ah": "案号",
        "content": "案件内容",
        "xzqh_p": "省",
        "cj": "法院层级",
        "score": 1.009,
        "anyou": ["案由"]
      }
    ]
  }
}
```
