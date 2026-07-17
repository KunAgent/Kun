# DescribeScanPluginRiskTrendListInfo — 巡检插件-查询风险趋势列表信息

巡检插件-查询风险趋势列表信息，支持按产品、解决状态、分组、风险等级等条件筛选，返回最新的风险趋势实例列表。

## 参数

| 参数 | 必选 | 类型 | 描述 |
|------|------|------|------|
| ArchId | 是 | String | 架构图id |
| Filters | 否 | Array of [Filter](#filter) | 查询过滤条件，见下方 Filters 说明 |
| Limit | 否 | Integer | 分页大小，默认值10，最大200 |
| Offset | 否 | Integer | 分页偏移量，默认0 |
| SessionId | 否 | String | 会话id，传空字符串查询最新的 |

### Filters 说明

| Name | Values 说明 |
|------|-------------|
| Product | 产品标识，如 `cvm,cdb`，多个值用 `,` 分割，不传默认查全部 |
| IsSolved | `0` 表示未解决，`1` 表示已解决，不传默认查全部 |
| GroupId | 分组ID，不传默认查全部 |
| RiskLevel | `2` 表示中风险，`3` 表示高风险，不传默认查全部 |

## 调用示例

```bash
# 查询全部风险趋势列表
bash {baseDir}/scripts/tcloud_api.py \
  advisor \
  advisor.tencentcloudapi.com \
  DescribeScanPluginRiskTrendListInfo \
  2020-07-21 \
  '{"ArchId":"arch-0ccs5932"}'

# 带筛选条件查询
bash {baseDir}/scripts/tcloud_api.py \
  advisor \
  advisor.tencentcloudapi.com \
  DescribeScanPluginRiskTrendListInfo \
  2020-07-21 \
  '{"ArchId":"arch-0ccs5932","Filters":[{"Name":"RiskLevel","Values":["3"]}],"Limit":200,"Offset":0}'
```

## 返回示例

```json
{
  "Response": {
    "RiskTrendInsInfoList": [
      {
        "ClaimPerson": "",
        "GroupType": "可靠",
        "InstanceId": "disk-rlak86lo",
        "InstanceStatus": "未解决",
        "RiskLevel": "高风险",
        "StrategyId": 140,
        "StrategyName": "云硬盘（CBS）未创建快照"
      }
    ],
    "TotalCount": 16,
    "RequestId": "f4d0a3f7-2e4e-4c8c-af8f-55173d7d670f"
  }
}
```

## 返回字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `RiskTrendInsInfoList` | Array of [RiskTrendInsInfo](#risktrendinsinfo) | 风险趋势实例列表 |
| `TotalCount` | Integer | 总数 |

### RiskTrendInsInfo

巡检插件-风险趋势实例信息。

| 字段 | 类型 | 说明 |
|------|------|------|
| `InstanceId` | String | 实例id |
| `StrategyId` | Integer | 策略id |
| `StrategyName` | String | 策略名称 |
| `RiskLevel` | String | 风险等级：中风险、高风险 |
| `GroupType` | String | 风险类型：安全、性能、成本等 |
| `InstanceStatus` | String | 实例状态：已解决、未解决、已忽略 |
| `ClaimPerson` | String | 跟进人 |

### Filter

查询条件。

| 字段 | 类型 | 说明 |
|------|------|------|
| `Name` | String | 查询key |
| `Values` | Array of String | 查询values |

## 错误码

| 错误码 | 说明 |
|--------|------|
| InvalidParameter.ParamError | 参数错误 |
| InternalError.System | 系统内部错误 |
| InternalError.DependsDb | 数据库依赖错误 |
| InvalidParameter | 参数错误 |
| InternalError | 内部错误 |
| ResourceNotFound | 资源不存在 |
| InvalidParameterValue | 参数值错误 |
