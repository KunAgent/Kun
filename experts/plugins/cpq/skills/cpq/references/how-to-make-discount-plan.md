# 设置整个报价单的优惠策略

根据业务目标为报价单中各产品批量计算并分配折扣。折扣策略决定最终报价的折扣力度和预期通过率。

## 折扣策略

优惠中的折扣值应根据业务目标选择对应策略，详见 [discount-strategy.md](discount-strategy.md)。

| 策略         | 含义                         |
| ------------ | ---------------------------- |
| 产品毛利优先 | 保障产品利润空间，折扣较保守 |
| 价格竞争力优先 | 提升价格竞争力，折扣更激进 |

计算折扣需要四个输入：总消耗预算、期望综合折扣、折扣策略（用户提供，缺失需 `askUser`）、客户等级（通过 `customer info` 获取）。详见 [discount-strategy.md](discount-strategy.md)。

## 折扣计算工作流

1. 收集用户输入（总消耗预算、期望综合折扣、折扣策略偏好），缺失字段通过 `askUser` 补全。**注意：`totalBudget`/`totalDiscountRate`/`totalDiscountedPrice` 三个金额值脚本至少需要两个才能运算，只拿到一个（如只有期望折扣）就调用会校验失败，必须通过 `askUser` 向用户追问缺失的值**
2. 通过 `customer info` 获取客户分层信息，如果返回的"客户在友商年消"为空，则调用 `askUser` 让 用户补充，如果用户补充了，则调用`customer complete --key customerYearExpenseCompetitor --value {newValue}` 更新客户信息。并重新执行 `customer info` 获取客户分层信息。
3. 通过 `row list --fields id,name,productCode,subProductCode,billingItemCode,subBillingItemCode,saleMode,quantityAdviceDiscount` 获取报价行产品列表
4. 将折扣策略映射为 `targetPassRate`，映射规则见 [discount-strategy.md — 策略到参数映射](discount-strategy.md)
5. 将步骤 1-3 收集的数据构造为输入 JSON，写入临时文件 `<CPQ_SESSION_DIR>/calc-discount-params.json`（`<CPQ_SESSION_DIR>` 解析见[cpq-session-dir.md](./cpq-session-dir.md)），然后通过 `cpq calc-discount --file-path <filePath>` 调用折扣计算命令。字段说明见 [discount-strategy.md — 输入 JSON](discount-strategy.md)

6. 处理脚本返回：
   - `success: true` → 进入步骤 7
   - `success: false` → 按下方「计算失败处理」引导用户调整，不直接报错
7. 批量更新报价行：
   - 从 `calc-discount` 返回的 `items[]` 中取每个报价行的折扣档位与折后价
   - 组装为单个 JSON 对象（以报价行节点 ID 为 key），使用 `--compress` 压缩传输
   - 执行：`row batch-update --compress {compressed} --cpqcode {code}`（compressed = base64(zlib.compress(json))）
   - 如果 CLI 报告某些行校验失败，根据错误信息修复对应字段后重新执行
8. 向用户汇报折扣分配结果（各产品折扣率、折后价），**注意不要透漏给用户通过率信息**

## 计算失败处理

脚本返回 `success: false` 时，根据错误信息判断原因并引导用户调整，不暴露内部术语（通过率、档位、可行性等）。

| 脚本错误信息 | 根因 | 向用户说明（参考话术） | 建议动作 |
|---|---|---|---|
| "目标通过率下部分产品无可行折扣档位" | 期望折扣低于部分产品允许的最低折扣 | "当前折扣目标下，部分产品的折扣已超出可申请范围" | 建议放宽期望折扣，或切换为产品毛利优先策略 |
| "至少需要提供两个" | totalBudget/totalDiscountRate/totalDiscountedPrice 只传了一个 | 不面客 | 则通过 `askUser` 向用户追问缺失的值，补齐后重新调用脚本 |
| "输入校验失败"（其他） | 必填字段缺失或格式错误 | 不面客，自行检查步骤 5 的 JSON 构造是否遗漏字段 | 修正 JSON 后重新调用脚本 |
| 三值不一致（totalBudget / totalDiscountRate / totalDiscountedPrice） | 用户提供了三个值且相互矛盾 | "总预算、折扣率和折后价之间存在矛盾，请确认以哪两个为准" | `askUser` 让用户指定保留哪两个值 |
