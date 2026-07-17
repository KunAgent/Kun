# DescribeArchRiskTrendInfo — 查询架构图风险趋势信息

查询架构图风险趋势信息，包括架构图基本信息、SVG 数据以及风险图表信息。

## 参数

| 参数 | 必选 | 类型 | 描述 |
|------|------|------|------|
| ArchId | 是 | String | 架构图ID |
| ResultId | 是 | String | 报告Id |

## 调用示例

```bash
bash {baseDir}/scripts/tcloud_api.py \
  advisor \
  advisor.tencentcloudapi.com \
  DescribeArchRiskTrendInfo \
  2020-07-21 \
  '{"ArchId":"arch-xxx","ResultId":"xxx"}'
```

## 返回示例

```json
{
  "Response": {
    "ArchId": "arch-xxx",
    "ArchName": "abc",
    "Svg": "abc",
    "ArchRiskChartInfos": [
      {
        "Name": "abc",
        "ChartInfoSet": [
          {
            "TitleName": "abc",
            "ChartType": "abc",
            "DisplayStatus": 0,
            "ChartDataInfoSet": [
              {
                "DataName": "abc",
                "KeyValueSet": [
                  {
                    "Key": "abc",
                    "KeyCNName": "abc",
                    "Value": 0
                  }
                ]
              }
            ]
          }
        ],
        "ExtraInfo": "abc"
      }
    ],
    "RequestId": "abc"
  }
}
```

## 返回字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `ArchId` | String | 架构图ID |
| `ArchName` | String | 架构图名称 |
| `Svg` | String | 架构图svg信息 |
| `ArchRiskChartInfos` | Array of [ArchScanChartInfo](#archscanchartinfo) | 架构图风险图表信息 |

### ArchScanChartInfo

架构图巡检结果图表信息。

| 字段 | 类型 | 说明 |
|------|------|------|
| `Name` | String | 名称 |
| `ChartInfoSet` | Array of [ChartInfo](#chartinfo) | 图表信息 |
| `ExtraInfo` | String | 图表说明信息 |

### ChartInfo

图表信息。

| 字段 | 类型 | 说明 |
|------|------|------|
| `TitleName` | String | 图表名称 |
| `ChartType` | String | 图表类型，Pie表示饼图，Pistogram表示柱形图，Line表示折线图，Bar表示长条图 |
| `DisplayStatus` | Integer | 图表展示状态 |
| `ChartDataInfoSet` | Array of [ChartDataInfo](#chartdatainfo) | 图表数据 |

### ChartDataInfo

图表数据信息。

| 字段 | 类型 | 说明 |
|------|------|------|
| `DataName` | String | 图表数据名称 |
| `KeyValueSet` | Array of [ChartKeyValue](#chartkeyvalue) | 图表数值 |

### ChartKeyValue

图表数值。

| 字段 | 类型 | 说明 |
|------|------|------|
| `Key` | String | 英文值 |
| `KeyCNName` | String | 中文值 |
| `Value` | Float | 数值 |

## 错误码

| 错误码 | 说明 |
|--------|------|
| InvalidParameter.ParamError | 参数错误 |
| InternalError.System | 系统内部错误 |
| MissingParameter | 缺少参数 |
| InvalidParameter | 参数错误 |
| InternalError | 内部错误 |
| InvalidParameterValue | 参数值错误 |
