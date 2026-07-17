# 居民消费价格指数（CPI）

> 接口：`cn_cpi` | 获取居民消费价格指数数据，包括全国、城市和农村

## 请求参数

| 参数 | 类型 | 必选 | 说明 |
|------|------|------|------|
| m | str | N | 月份（YYYYMM格式，支持逗号分隔多月） |
| start_m | str | N | 开始月份 |
| end_m | str | N | 结束月份 |

**限量：** 单次最大5000条。**权限：** 用户需至少600积分。

## 返回字段

| 字段 | 类型 | 说明 |
|------|------|------|
| month | str | 月份 |
| nt_val | float | 全国当月值 |
| nt_yoy | float | 全国同比（%） |
| nt_mom | float | 全国环比（%） |
| nt_accu | float | 全国累计值 |
| town_val | float | 城市当月值 |
| town_yoy | float | 城市同比（%） |
| town_mom | float | 城市环比（%） |
| town_accu | float | 城市累计值 |
| cnt_val | float | 农村当月值 |
| cnt_yoy | float | 农村同比（%） |
| cnt_mom | float | 农村环比（%） |
| cnt_accu | float | 农村累计值 |

## 调用示例

```bash
curl -X POST https://www.codebuddy.cn/v2/tool/financedata \
  -H "Content-Type: application/json" \
  -d '{
    "api_name": "cn_cpi",
    "params": {"m": "202501"},
    "fields": ""
  }'
```

## 返回示例

```json
{
  "code": 0,
  "msg": "",
  "data": {
    "fields": ["month", "nt_val", "nt_yoy", "nt_mom", "nt_accu", "town_val", "town_yoy", "town_mom", "town_accu", "cnt_val", "cnt_yoy", "cnt_mom", "cnt_accu"],
    "items": [
      ["202501", 100.5, 0.5, 0.7, 100.5, 100.6, 0.6, 0.8, 100.6, 100.3, 0.3, 0.5, 100.3]
    ]
  }
}
```
