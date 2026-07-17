# 合同起草 — 详细操作指南

本文档为合同起草的详细操作指南，由 SKILL.md 引用。执行起草流程时阅读本文档。

## 阶段 1：收集信息

引导用户提供以下信息（缺失项主动追问）：

- **合同类型**（如：买卖、服务、租赁、劳动、保密协议等）
- **双方信息**（甲方/乙方名称）
- **核心条款**（金额、期限、支付方式等）
- **参考文件**（可选，如有模板或规定文件先上传）

将收集到的信息整理成 5-1000 字的需求描述。

## 阶段 2：信息确认

向用户确认整理后的需求摘要：「我整理了以下合同需求，请确认是否准确，如有补充请告诉我：...」

**Requirement 长度限制**：`Requirement` 字段必须为 5-1000 字。如果整理后的需求描述超过 1000 字，先自行压缩精简（保留核心条款和关键约束，去除冗余描述），压缩后仍超限时告知用户并请求协助裁剪。将参考文件、模板等较长的辅助内容放入 `RequirementFileIds`（先上传获取 ResourceId），而非写入 `Requirement`。

确认后调用：

```bash
python3 scripts/tencent_esign.py call CreateDraftContractByPromptsTask '{"Requirement":"需求描述","ContractLanguage":"zh"}'
```

可选参数：`ReferenceTemplateId`（参考模板ID）、`RequirementFileIds`（规定文件ID列表，最多3个）

## 阶段 3：等待并展示结果

```bash
python3 scripts/tencent_esign.py wait-draft <TaskId>
```

返回 JSON 结构：

```json
{
  "Response": {
    "Status": 2,
    "ContractName": "软件开发服务合同",
    "ResourceId": "yD3a5UUs1ixxx",
    "ContractUrl": "https://file.test.ess.tencent.cn/...",
    "RequestId": "xxx"
  }
}
```

**解析**：`resp["Response"]["ContractName"]` 取合同名称、`resp["Response"]["ContractUrl"]` 取下载链接。

- 成功（Status=2）→ 展示合同名称、下载链接、后续选项
- 失败（Status=3）→ 展示 `Message` 并建议调整需求后重试

## 阶段 4：修改处理

如果用户选择修改，将修改意见融入原需求重新起草（重新调用阶段 2-3）。
