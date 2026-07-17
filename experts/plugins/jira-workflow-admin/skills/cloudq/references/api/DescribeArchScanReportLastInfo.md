# DescribeArchScanReportLastInfo — 巡检插件-查询整张架构图巡检报告最新信息

巡检插件-查询整张架构图巡检报告最新信息，返回最新一次巡检任务的任务ID和报告ID。

## 参数

| 参数 | 必选 | 类型 | 描述 |
|------|------|------|------|
| ArchId | 是 | String | 架构图id |

## 调用示例

```bash
bash {baseDir}/scripts/tcloud_api.sh \
  advisor \
  advisor.tencentcloudapi.com \
  DescribeArchScanReportLastInfo \
  2020-07-21 \
  '{"ArchId":"arch-xxxx"}'
```

## 返回示例

```json
{
  "Response": {
    "ResultId": "mapTaskType#7ea713f4-df96-4861-b190-a11a2b263322#zh-CN#public#xxx",
    "TaskId": "7ea713f4-df96-4861-b190-a11a2b263xxx",
    "RequestId": "0f7e799e-33a8-453a-8702-56283677322e"
  }
}
```

## 返回字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `TaskId` | String | 任务ID |
| `ResultId` | String | 报告id |

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
