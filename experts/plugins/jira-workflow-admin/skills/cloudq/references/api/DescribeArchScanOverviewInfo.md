# DescribeArchScanOverviewInfo — 查询架构图云巡检在线报告概览信息

查询架构图云巡检在线报告概览信息，包括用户名称、架构图信息、巡检资源概览、巡检项概览、巡检分数趋势等。

## 参数

| 参数 | 必选 | 类型 | 描述 |
|------|------|------|------|
| ArchId | 是 | String | 架构图id |
| ResultId | 是 | String | 报告id |

## 调用示例

```bash
bash {baseDir}/scripts/tcloud_api.py \
  advisor \
  advisor.tencentcloudapi.com \
  DescribeArchScanOverviewInfo \
  2020-07-21 \
  '{"ArchId":"arch-xx","ResultId":"xxx"}'
```

## 返回示例

```json
{
  "Response": {
    "CustomerName": "abc",
    "ArchId": "arch-xx",
    "ArchName": "abc",
    "AppId": 0,
    "ResultId": "abc",
    "ReportArchiveStatus": true,
    "FinishTime": "2006-01-02 15:04:05",
    "ArchScanSourceInfo": {
      "ScanStrategyCount": 0,
      "ScanResourceCount": 0,
      "ScanResourcePercent": "50",
      "UnScanResourceCount": 0,
      "UnBindResourceCount": 0,
      "ScanProductCount": 0
    },
    "CurrentStrategySummaryInfo": {
      "ScanCount": "0",
      "HighRiskCount": "0",
      "MediumRiskCount": "0",
      "NoRiskCount": "0"
    },
    "LastWeekStrategySummaryInfo": {
      "ScanCount": "0",
      "HighRiskCount": "0",
      "MediumRiskCount": "0",
      "NoRiskCount": "0"
    },
    "ArchScanScoreTrendInfo": {
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
    },
    "CurrentScanScore": 80,
    "ArchScanGroupScoreInfo": {
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
    },
    "ReportDate": "abc",
    "RequestId": "abc"
  }
}
```

## 返回字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `CustomerName` | String | 用户名称 |
| `ArchId` | String | 架构图Id |
| `ArchName` | String | 架构图名称 |
| `AppId` | Integer | appid |
| `ResultId` | String | 报告Id |
| `ReportArchiveStatus` | Boolean | 报告归档状态，false未归档，true已归档 |
| `FinishTime` | String | 评估时间 |
| `ArchScanSourceInfo` | [ArchScanSourceInfo](#archscansourceinfo) | 架构图巡检资源概览信息 |
| `CurrentStrategySummaryInfo` | [ArchStrategySummaryInfo](#archstrategysummaryinfo) | 架构图巡检项概览信息 |
| `LastWeekStrategySummaryInfo` | [ArchStrategySummaryInfo](#archstrategysummaryinfo) | 上周架构图巡检项概览信息 |
| `ArchScanScoreTrendInfo` | [ArchScanChartInfo](#archscanchartinfo) | 架构巡检分数趋势信息 |
| `CurrentScanScore` | Integer | 当前巡检得分 |
| `ArchScanGroupScoreInfo` | [ArchScanChartInfo](#archscanchartinfo) | 架构巡检类别分数信息 |
| `ReportDate` | String | 报告日期 |

### ArchScanSourceInfo

架构图风险巡检资源概览信息。

| 字段 | 类型 | 说明 |
|------|------|------|
| `ScanStrategyCount` | Integer | 已扫描的巡检项 |
| `ScanResourceCount` | Integer | 扫描的架构图资源数量 |
| `ScanResourcePercent` | String | 风险扫描的资源数占整体资源数的比例 |
| `UnScanResourceCount` | Integer | 架构图中未被巡检的资源数 |
| `UnBindResourceCount` | Integer | 未绑定的资源数 |
| `ScanProductCount` | Integer | 巡检产品数 |

### ArchStrategySummaryInfo

架构巡检概览信息。

| 字段 | 类型 | 说明 |
|------|------|------|
| `ScanCount` | String | 已扫风险项 |
| `HighRiskCount` | String | 高风险项 |
| `MediumRiskCount` | String | 中风险项 |
| `NoRiskCount` | String | 健康项 |

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
| InternalError.System | 系统内部错误 |
| InternalError.DependsDb | 数据库依赖错误 |
| MissingParameter | 缺少参数 |
| InvalidParameter | 参数错误 |
| InvalidParameterValue | 参数值错误 |
