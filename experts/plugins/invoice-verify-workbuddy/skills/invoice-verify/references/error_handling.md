# 异常处理规范

## 错误码体系

> **批量场景**：agent 逐张播报每张发票的验真状态，最终汇总报告自动包含"已验真/未验真/失败"的完整清单。同类失败（如额度耗尽）时，已完成的结果保留，未完成的发票单独列出原因，无需单独定义兜底流程。

| error_code                    | 场景                               | 报告 error_type | 处理策略                    |
| ----------------------------- | -------------------------------- | ------------- | ----------------------- |
| `MISSING_REQUIRED_FIELD`      | 四要素不全                            | —             | 多轮补问，3轮后中止              |
| `FILE_FORMAT_UNSUPPORTED`     | 不支持的文件格式                         | —             | 提示用户转成 PDF/图片           |
| `OCR_RECOGNITION_FAILED`      | 识别失败 | —             | 提示重新上传，部分失败的可单独重传       |
| `VERIFICATION_API_ERROR`      | 验真接口异常                           | `"接口异常"`      | 重试3次（脚本内置），仍失败提示用户      |
| `VERIFICATION_LIMIT_EXCEEDED` | 查验次数超限（服务端限流）                    | `"查验超限"`      | 不重试，提示"明日再试"            |
| `RISK_CHECK_FAILED`           | 风险校验接口失败                         | —             | 单项失败不影响其余两项             |
| `RISK_CHECK_SKIPPED`          | 无法提取 `sellerName`                | —             | 跳过风险校验，报告标注             |
| `MCP_SERVICE_UNAVAILABLE`     | MCP 服务不可用                        | —             | 立即提示，不进入后续流程            |
| `MCP_TOOL_NAME_MISMATCH`      | MCP 工具名与预期不符                     | —             | 输出实际工具名，提示用户更新 SKILL.md |
| `FOLDER_NOT_FOUND`            | 文件夹路径不存在或非有效目录                 | —             | 提示用户确认路径，回退场景 D      |
| `FOLDER_EMPTY`                | 文件夹内无支持格式文件                      | —             | 提示用户检查文件夹内容          |
| `FILE_OVER_SIZE`              | 单文件 > 8MB                         | —             | 跳过并记录，汇总报告中列出        |
| `BATCH_LIMIT_EXCEEDED`        | 去重后唯一发票 > 100 张                   | —             | 截断前 100 张，提示用户分批处理   |

## MCP 接口错误码映射

百望 MCP 接口返回错误时结构如下：

```json
{
  "success": false,
  "errorResponse": {
    "code": 100002,
    "message": "开放平台错误信息",
    "subCode": "业务错误码",
    "subMessage": "业务错误描述"
  }
}
```

映射规则：以 `subCode` + `subMessage` 组合判断，优先以 `subMessage` 具体内容定位场景，映射到上方 skill 错误码后执行对应处理策略。

> **注意**：同一 `subCode` 可能对应多条不同 `subMessage`（如 `00001`、`005`），需按 `subMessage` 细分。

### 发票识别

| MCP subCode | MCP subMessage 关键词 | Skill 错误码                 | 处理策略                |
| ----------- | ------------------ | ------------------------- | ------------------- |
| 101         | 入参为空               | `MISSING_REQUIRED_FIELD`  | 检查请求参数是否完整          |
| 102         | 文件集合为空             | `MISSING_REQUIRED_FIELD`  | 检查 `filesMap` 是否正确传入；OFD/XML 转 LLM 识别 |
| 00001       | 文件名称或fileUrl为空     | `MISSING_REQUIRED_FIELD`  | 标准 OCR 检查 `fileUrl`；影像识别采集检查 `filesMap[].fileName` |
| 00001       | 文件名称或base64为空      | `MISSING_REQUIRED_FIELD`  | 检查 `filesMap[].fileBase64` 是否为裸 base64 |
| 00001       | 文件格式错误，请检查文件是否正确   | `FILE_FORMAT_UNSUPPORTED` | 提示用户转成支持的格式（PDF/图片） |
| 00001       | 参数列表有误、图片或文件无效     | `FILE_FORMAT_UNSUPPORTED` | 提示用户检查文件完整性         |
| 9999        | 用户标识无效             | `MISSING_REQUIRED_FIELD`  | 检查 `userAccount` 是否来自 WorkBuddy 注入配置；本次文件转 LLM 识别 |
| 10002       | 图片XXX识别失败          | `OCR_RECOGNITION_FAILED`  | 提示重新上传，检查图片质量       |
| 10002       | 图片XXX未识别出的发票类型     | `OCR_RECOGNITION_FAILED`  | 提示用户确认票种或换清晰图片      |

### OFD/XML 影像识别采集降级

`scripts/recogcollect_file.py` 输出 `success=false`、`errors` 非空、`items` 为空，或单张票缺少 `invoiceNumber` / `billingDate` / `totalAmount` / `checkCode_6` 时：

1. 不重复调用同一 MCP 接口。
2. 使用 LLM 多模态/Read 识别该文件四要素。
3. LLM 提取字段后仍按 SKILL.md 字段标准化规则生成 `verify_params`。
4. 最终报告标注“影像识别采集接口不可用或字段不完整，已降级为 LLM 识别”。

### 发票查验

| MCP subCode | MCP subMessage 关键词     | Skill 错误码                     | 处理策略                        |
| ----------- | ---------------------- | ----------------------------- | --------------------------- |
| 100006      | 该appKey无权操作此税号信息     | `MCP_PERMISSION_DENIED`      | **不再重试**（权限问题非临时故障）。在报告中标明原因，提供人工查验指引（https://inv-veri.chinatax.gov.cn/），不阻塞后续风险查询 |
| 100008      | 系统内部错误              | `VERIFICATION_API_ERROR`      | 重试，仍失败联系支持                  |
| -1          | 未知错误                   | `VERIFICATION_API_ERROR`      | 重试，仍失败联系支持                  |
| 1           | 校验号码不一致 / 发票金额不一致      | `VERIFICATION_API_ERROR`      | 校验数据不匹配，提示用户核实要素            |
| 005         | 请求参数不正确 — 发票号码格式不正确    | `MISSING_REQUIRED_FIELD`      | 提示用户检查发票号码格式（8位或20位）        |
| 005         | 请求参数不正确 — 发票代码格式不正确    | `MISSING_REQUIRED_FIELD`      | 提示用户检查发票代码格式（10位或12位）       |
| 005         | 请求参数不正确 — 开票日期格式不正确    | `MISSING_REQUIRED_FIELD`      | 提示用户检查日期格式（YYYY-MM-DD）      |
| 005         | 请求参数不正确 — 不含税金额为空/格式有误 | `MISSING_REQUIRED_FIELD`      | 提示用户确认金额（专票传不含税金额）          |
| 005         | 请求参数不正确 — 校验码为空        | `MISSING_REQUIRED_FIELD`      | 提示用户提供校验码后6位（普票必填）          |
| 005         | 请求参数不正确 — 车价合计为空/格式有误  | `MISSING_REQUIRED_FIELD`      | 提示用户确认车价合计（二手车必填）           |
| 005         | 请求参数不正确 — 发票类型有误       | `VERIFICATION_API_ERROR`      | 检查发票类型与代码是否匹配               |
| 402         | 超过该张票当天查验次数            | `VERIFICATION_LIMIT_EXCEEDED` | 不重试，提示"该发票今日查验次数已达上限，请明日再试" |
| 0014        | 查验次数已用完，请联系百望及时充值      | `VERIFICATION_LIMIT_EXCEEDED` | 提示联系管理员充值查验额度               |
| 406         | 查询条件不正确                | `VERIFICATION_API_ERROR`      | 检查参数组合是否完整                  |
| 409         | 所查发票不存在                | `VERIFICATION_API_ERROR`      | 税局无此票记录，提示用户核实发票信息          |
| 410         | 查验系统发生异常               | `VERIFICATION_API_ERROR`      | 重试，仍失败提示稍后再试                |
| 411         | 查验通道繁忙                 | `VERIFICATION_API_ERROR`      | 重试，仍失败提示稍后再试                |
| 416         | 查验异常                   | `VERIFICATION_API_ERROR`      | 重试，仍失败提示稍后再试                |
| 421         | 税局服务已关闭                | `MCP_SERVICE_UNAVAILABLE`     | 提示用户查看本省税局官网公告              |
| 099         | 获取锁失败                  | `VERIFICATION_API_ERROR`      | 稍后重试（并发冲突）                  |
| 907         | 未开通查验服务                | `MCP_SERVICE_UNAVAILABLE`     | 提示联系管理员开通查验服务               |
| 910         | 未开通进项发票服务              | `MCP_SERVICE_UNAVAILABLE`     | 提示联系管理员开通进项服务               |
| 1000        | 非本公司发票，不能查询            | `VERIFICATION_API_ERROR`      | 提示用户该发票不属于本企业               |
| 513         | 本税号为空或不存在              | `VERIFICATION_API_ERROR`      | 检查购方税号配置                    |
| 703         | 税号不存在                  | `VERIFICATION_API_ERROR`      | 检查购方税号是否正确                  |

### 灰名单检测（baiwang.dataasset.risktag.queryTaxnogrey）

| MCP subCode | MCP subMessage 关键词 | 处理策略                |
| ----------- | ------------------ | ------------------- |
| 90008       | 暂无信息               | **视为无风险**，灰名单返回 `riskLevel` = `"无风险"`，`reason` = `"暂未发现风险"`，纳入报告 |

## 异常策略矩阵

| 异常类别          | 处理策略                                                               |
| ------------- | ------------------------------------------------------------------ |
| 识别异常（格式/损坏）   | 即时提示（`FILE_FORMAT_UNSUPPORTED`），支持重新上传                             |
| 识别失败          | 部分失败→单独重传（`OCR_RECOGNITION_FAILED`）；全部失败→检查文件                      |
| 验真异常（超时/接口错误） | 脚本内置重试3次（2s→4s→8s），仍失败→明确提示（`VERIFICATION_API_ERROR`）              |
| 查验次数超限        | 不重试（服务端限流），提示"明日再试"（`VERIFICATION_LIMIT_EXCEEDED`），使用 `--no-retry` |
| 无法提取销方税号      | 跳过风险校验，报告标注（`RISK_CHECK_SKIPPED`）                                  |
| 风险校验接口失败      | 脚本内置重试3次，单项失败不影响其余两项（`RISK_CHECK_FAILED`）                          |
| MCP 权限不足        | appKey 无权操作（沙箱/未授权税号），提示联系管理员授权或切换正式环境（`MCP_PERMISSION_DENIED`） |
| MCP 服务不可用     | 立即提示，不进入后续流程（`MCP_SERVICE_UNAVAILABLE`）                            |
| MCP 工具名不匹配    | 输出实际工具名 vs 预期工具名，提示用户更新（`MCP_TOOL_NAME_MISMATCH`）                  |
| 高风险场景         | 标记高风险，人工复核确认                                                       |

## 重试策略

> **所有重试已内置于 `call_mcp.py`**，LLM 无需手动实现。以下为脚本行为说明：

| 场景     | 最大重试 | 间隔       | 脚本参数         |
| ------ | ---- | -------- | ------------ |
| 识别失败   | 3次   | 2s→4s→8s | 默认           |
| 验真接口异常 | 3次   | 2s→4s→8s | 默认           |
| 查验次数超限 | 0次   | —        | `--no-retry` |
| 风险校验失败 | 3次   | 2s→4s→8s | 默认           |

## 批量去重规则

| 发票类别        | 去重 key                          | 说明        |
| ----------- | ------------------------------- | --------- |
| 税控发票（有发票代码） | `invoiceCode` + `invoiceNumber` | 代码+号码联合唯一 |
| 数电发票（20位号码） | `invoiceNumber`                 | 号码单独唯一    |

去重在 OCR 完成后、验真发起前执行。重复发票标注「重复，已跳过」，跨文件去重。
