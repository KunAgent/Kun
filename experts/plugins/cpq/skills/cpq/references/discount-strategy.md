# 报价折扣策略

报价行优惠配置完成后，需要根据业务目标设置折扣。折扣策略决定最终报价的折扣力度和预期通过率。

## 策略定义

| 策略 | 目标 | 折扣力度 | 适用场景 |
|------|------|----------|----------|
| 产品毛利优先 | 保障产品利润空间 | 较高（折扣较少） | 标准项目、利润敏感型客户、内部预算充足 |
| 价格竞争力优先 | 提升价格竞争力 | 较低（折扣更多） | 竞标项目、价格敏感型客户、抢单场景 |

## 策略说明

### 产品毛利优先

折扣力度相对保守，在保证合理竞争力的前提下最大化产品毛利。

- 适用于大多数常规报价场景
- 审批流程通常更顺畅
- 折扣区间由产品线、客户等级、合同规模等因素综合决定

### 价格竞争力优先

折扣力度更大，以更低的价格提升价格竞争力。

- 适用于竞标或客户对价格极度敏感的场景
- 可能需要额外审批或特批流程
- 需权衡：更低的价格换取更高的成单概率

## 必要输入

设置折扣前必须收集以下四个字段，全部就绪后才能进行折扣计算。

| 字段 | 来源 | 说明 | 示例 |
|------|------|------|------|
| 总消耗预算 | 用户提供 | 客户项目的预估总消耗金额（折前） | "500 万/年" |
| 期望综合折扣 | 用户提供 | 用户期望的整体折扣水平 | "7 折""75 折" |
| 折扣策略 | 用户提供 | 产品毛利优先 or 价格竞争力优先 | "毛利优先" |
| 客户等级 | `customer info` | 通过工具获取，不需要用户提供 | `5` |

### 收集规则

1. **总消耗预算、期望综合折扣、折后总价**三个金额值，脚本至少需要其中**两个**才能运算（三选二，自动推导第三个）。只拿到一个（如只有期望折扣）就调用脚本会直接校验失败，**必须通过 `askUser` 追问缺失的值**
2. **折扣策略**必须从用户处获取，缺失时通过 `askUser` 补全
3. **客户等级**通过 `customer info` 获取，无需用户提供
4. 以上字段全部就绪后，才能进行折扣计算

### 折扣策略识别

根据用户表达的业务意图判断策略偏好：

| 策略 | 意图方向 | 典型表达 |
|------|----------|----------|
| 产品毛利优先 | 强调利润、稳妥、标准流程 | 保利润、常规报价、标准方案、稳一些… |
| 价格竞争力优先 | 强调低价、竞争、成单 | 价格压低、帮客户省钱、竞标、尽量便宜… |

上述仅为示例，实际识别应关注用户的**业务意图**而非逐词匹配。无法判断时，通过 `askUser` 列出两种策略及其含义供用户选择。

## 折扣计算

通过 `scripts/dist/calc-discount.mjs` 脚本为报价单中各产品项分配折后总价和折扣率。

### 策略到参数映射

| 用户策略 | targetPassRate | 含义 |
|----------|---------------|------|
| 产品毛利优先 | 0.7 | 保守折扣，审批顺畅 |
| 价格竞争力优先 | 0.5 | 激进折扣，可能需特批 |

### 分配算法

脚本内置五种底层分配算法，默认使用 `max_joint_prob`（联合概率最大）：

| 算法 | 代码名 | 目标 |
|------|--------|------|
| 审批优先 | `approval_first` | 最大化最差产品通过率 |
| 折扣拉齐 | `even_discount` | 所有产品折扣率尽量接近 |
| 联合概率最大 | `max_joint_prob` | 最大化所有产品同时通过的概率 |
| 金额均摊 | `even_price` | 各产品折后价尽量相等 |
| 最小调整 | `min_adjust` | 基于已有分配最小改动 |

### 调用方式

将输入 JSON 写入临时文件，然后通过以下命令调用：

```bash
cpq calc-discount --file-path <filePath>
```

其中 `<filePath>` 为写入 JSON 数据的临时文件路径。

### 输入 JSON

```json
{
  "totalBudget": 1000000,
  "totalDiscountRate": 0.375,
  "tcLevel": 5,
  "targetPassRate": 0.7,
  "strategy": "max_joint_prob",
  "items": [
    {
      "id": "row-id",
      "fallbackDiscountLevel": 50,
      "productCode": "p_cvm",
      "subProductCode": "sp_cvm_std",
      "billingItemCode": "v_cvm_instance",
      "subBillingItemCode": "sv_cvm_s5",
      "saleMode": "postpay"
    }
  ]
}
```

**三值任传两个**：`totalBudget`（总消耗预算/折前价）、`totalDiscountRate`（综合折扣率）、`totalDiscountedPrice`（折后价）满足 `折后价 = 折前价 × 折扣率`，传入任意两个，脚本自动推导第三个。三个都传时做一致性校验。

| 字段                            | 来源                                      | 说明                                                |
| ------------------------------- | ----------------------------------------- | --------------------------------------------------- |
| `totalBudget`                   | 用户提供                                  | 总消耗预算/折前价（与另外两个字段任传两个）         |
| `totalDiscountRate`             | 用户提供                                  | 总综合折扣率 0.01~1.00（与另外两个字段任传两个）；如"65折"传 0.65 |
| `totalDiscountedPrice`          | 用户提供                                  | 报价单折后总价（与另外两个字段任传两个）            |
| `tcLevel`                       | `customer info` 返回的客户等级            | 正整数，**不是** customerLevel                      |
| `targetPassRate`                | 策略映射（见上方"策略到参数映射"表）      | 目标通过率（0~1）                                   |
| `strategy`                      | 可选，默认 `max_joint_prob`               | 分配算法名，见"分配算法"表                          |
| `items[].id`                    | `row list` 返回的 `id`                    | 产品项标识                                          |
| `items[].fallbackDiscountLevel` | `row list` 的 `quantityAdviceDiscount`    | 兜底折扣档位（1~100），查不到通过率数据时使用       |
| `items[].productCode`           | `row list` 同名字段直接透传               |                                                     |
| `items[].subProductCode`        | `row list` 同名字段直接透传               |                                                     |
| `items[].billingItemCode`       | `row list` 同名字段直接透传               |                                                     |
| `items[].subBillingItemCode`    | `row list` 同名字段直接透传               |                                                     |
| `items[].saleMode`              | `row list` 同名字段直接透传               |                                                     |

### 输出 JSON

```json
{
  "success": true,
  "items": [
    {
      "id": "row-001",
      "discountLevel": 50,
      "discountedPrice": 125000,
      "priceBeforeDiscount": 250000,
      "passRate": 0.85,
      "_matchedInTable": true
    }
  ],
  "totalDiscountedPrice": 375000,
  "totalPriceBeforeDiscount": 1000000,
  "totalDiscountRate": 0.375,
  "overallPassRate": 0.72,
  "jointPassRate": 0.614
}
```

| 字段 | 说明 |
|------|------|
| `items[].id` | 产品项标识（透传输入） |
| `items[].discountLevel` | 折扣档位 1~100（如 50 = 5.0折 = 折扣率 0.50） |
| `items[].discountedPrice` | 折后总价（精确到分） |
| `items[].priceBeforeDiscount` | 折前价（= discountedPrice / discountRate，精确到分） |
| `items[].passRate` | 该档位的审批通过率 |
| `items[]._matchedInTable` | 是否命中通过率表（false 表示使用了兜底值） |
| `totalDiscountedPrice` | 验证：所有产品折后价之和 |
| `totalPriceBeforeDiscount` | 验证：所有产品折前价之和（= 总预算） |
| `totalDiscountRate` | 验证：综合折扣率 = 总折后价 / 总折前价 |
| `overallPassRate` | 所有产品中最差的通过率 |
| `jointPassRate` | 所有产品通过率的乘积（联合概率） |

### 约束保证

1. `sum(discountedPrice) = totalDiscountedPrice`（精确到分）
2. `sum(priceBeforeDiscount) = totalPriceBeforeDiscount`（= 总预算，精确到分）
3. `totalDiscountRate = totalDiscountedPrice / totalPriceBeforeDiscount`（综合折扣率 = 总实付 / 总原价）
4. 每个产品通过率 >= targetPassRate

## 与优惠配置的关系

折扣策略是"设置优惠"流程的决策依据，决定优惠中折扣值应该设多少：

- **优惠配置流程**回答"怎么设置"——查询可选优惠类型、组装 JSON、调用 `row update`
- **折扣策略**回答"设什么值"——根据业务目标选择折扣力度

两者相辅相成：先根据策略确定折扣值，再通过优惠配置流程写入报价行。
