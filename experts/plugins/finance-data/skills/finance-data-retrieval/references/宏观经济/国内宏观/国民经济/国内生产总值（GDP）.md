# 国内生产总值（GDP）

> 接口：`cn_gdp` | 获取国民经济GDP数据

## 请求参数

| 参数 | 类型 | 必选 | 说明 |
|------|------|------|------|
| q | str | N | 季度（如2024Q3） |
| start_q | str | N | 开始季度 |
| end_q | str | N | 结束季度 |
| fields | str | N | 指定输出字段 |

**限量：** 单次最大10000条。**权限：** 用户需至少600积分。

## 返回字段

| 字段 | 类型 | 说明 |
|------|------|------|
| quarter | str | 季度 |
| gdp | float | GDP累计值（亿元） |
| gdp_yoy | float | 当季同比增速（%） |
| pi | float | 第一产业累计值（亿元） |
| pi_yoy | float | 第一产业同比增速（%） |
| si | float | 第二产业累计值（亿元） |
| si_yoy | float | 第二产业同比增速（%） |
| ti | float | 第三产业累计值（亿元） |
| ti_yoy | float | 第三产业同比增速（%） |

## 调用示例

```bash
curl -X POST https://www.codebuddy.cn/v2/tool/financedata \
  -H "Content-Type: application/json" \
  -d '{
    "api_name": "cn_gdp",
    "params": {"q": "2024Q3"},
    "fields": ""
  }'
```

## 返回示例

```json
{
  "code": 0,
  "msg": "",
  "data": {
    "fields": ["quarter", "gdp", "gdp_yoy", "pi", "pi_yoy", "si", "si_yoy", "ti", "ti_yoy"],
    "items": [
      ["2024Q3", 974553.8, 4.8, 57497.5, 3.4, 355237.3, 5.4, 561819.0, 4.7]
    ]
  }
}
```
