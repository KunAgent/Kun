# ETF基本信息

> 接口：`etf_basic` | 获取国内ETF基础信息数据，包括QDII基金，数据来源于沪深交易所公开披露

## 请求参数

| 参数 | 类型 | 必选 | 说明 |
|------|------|------|------|
| ts_code | str | N | ETF代码（如510050.SH） |
| index_code | str | N | 跟踪指数代码 |
| list_date | str | N | 上市日期（YYYYMMDD） |
| list_status | str | N | 上市状态：L-上市 D-退市 P-暂停上市 |
| exchange | str | N | 交易所：SH-上交所 SZ-深交所 |
| mgr | str | N | 基金管理人简称（如华夏基金） |

## 返回字段

| 字段 | 类型 | 说明 |
|------|------|------|
| ts_code | str | 基金代码 |
| csname | str | ETF中文简称 |
| extname | str | ETF扩展简称（对应交易所） |
| cname | str | 基金中文全称 |
| index_code | str | 基准指数代码 |
| index_name | str | 基准指数中文名称 |
| setup_date | str | 成立日期 |
| list_date | str | 上市日期 |
| list_status | str | 状态：L-上市 D-退市 P-暂停上市 |
| exchange | str | 交易所 |
| mgr_name | str | 基金管理人简称 |
| custod_name | str | 基金托管人名称 |
| mgt_fee | float | 管理费率 |
| etf_type | str | 投资通道类型（纯境内/QDII） |

## 调用示例

```bash
curl -X POST https://www.codebuddy.cn/v2/tool/financedata \
  -H "Content-Type: application/json" \
  -d '{
    "api_name": "etf_basic",
    "params": {"ts_code": "510050.SH"},
    "fields": "ts_code,csname,extname,index_code,index_name,exchange,mgr_name"
  }'
```

## 返回示例

```json
{
  "code": 0,
  "msg": "",
  "data": {
    "fields": ["ts_code", "csname", "extname", "cname", "index_code", "index_name", "setup_date", "list_date", "list_status", "exchange", "mgr_name", "custod_name", "mgt_fee", "etf_type"],
    "items": [
      ["510050.SH", "华夏上证50ETF", "上证50ETF", "上证50交易型开放式指数证券投资基金", "000016.SH", "上证50指数", "20041230", "20050223", "L", "SH", "华夏基金", "中国工商银行股份有限公司", 0.15, "纯境内"]
    ]
  }
}
```
