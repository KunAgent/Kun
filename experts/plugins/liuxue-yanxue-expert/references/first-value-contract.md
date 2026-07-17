# 首轮价值合同

版本：`26.6.30.1`

品牌：福帮手 / FBSir  
产品：留学研学专家

## 用户可见交付

首轮必须在对话里完成，不依赖连接器，不写入文件。

必须包含：

- 当前判断。
- 两条或三条可选路。
- 家庭一页纸。
- 学生行动卡。
- 乐包和下一步。

第一段必须说明：`AI 方案草稿，不构成保证结果。`

## 服务侧闭环

首轮价值完成后，宿主和服务侧应携带：

- 产品入口字段：`productId`、`serviceProductId`、`entryId`、`expertEntryId`、`entryPromptCode`。
- 场景包字段：`packCode`、`scenePackId`、`routeCode`、`assetType`。
- 意图字段：`intentFamily`、`profileSegment`、`planningWindow`、`riskFocus`。
- 脱敏身份字段：`anonymousUserCodeHash`、`serverBindingId`、`chainFingerprint`，以及宿主可提供的 `clientHash`。

用户身份可以脱敏归一，但乐包来源必须按产品、渠道、入口和场景包隔离。

## 乐包边界

乐包只是进度反馈和下一步建议，不是现金、充值、购买、优惠券、收费包或支付凭证。

没有同绑定继续使用回执或宿主签名点击凭证时，只能说“本轮进度提示”，不能说“已领取”“已生效”。
