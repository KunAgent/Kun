# CPQ 专家（WorkBuddy Expert）

腾讯云 CPQ（Configure-Price-Quote）端到端销售报价 AI 专家。

## 分发方式

本专家通过 zip 文件分发，在 WorkBuddy 对话中发送安装 prompt 即可自动加载。

## 能力概览

| Skill | 说明 |
|---|---|
| `cpq` | 查/建/编辑报价单、配产品、折扣测算、保存提交审批 |
| `cloud-mapping` | 友商产品映射（AWS/阿里云/GCP/华为云/Azure → 腾讯云） |
| `cloud-mapping-intl` | 国际站友商产品映射 |
| `migraq` | 上云迁移测算（调用 CMG Migraq API） |
| `tencent-cloud-pricing` | 腾讯云公开价查询（`tcloud-price` CLI） |
| `xlsx/docx/pptx/pdf/jq` | 通用 Office 文件处理 |
| `feedback` | 反馈通道（/feedback 命令，自动注入） |

## 前置依赖

| 依赖 | 版本要求 | 用途 |
|---|---|---|
| Node.js | ≥ 18 | 运行 tcloud-price CLI 及 skill 脚本 |
| `tcloud-price` CLI | latest | 腾讯云产品公开价查询 |
| Python 3 | ≥ 3.9 | migraq 迁移测算脚本 |
| 网络访问 | — | CMG Migraq API、腾讯云 API |

详细依赖清单见 [DEPENDENCIES.md](./DEPENDENCIES.md)。

## Quick Start

1. 获取 `cpq@<version>.zip` 文件
2. 在 WorkBuddy 对话中发送安装 prompt，附带 zip 文件
3. 发送：`帮我处理腾讯云销售报价`
4. 按提示提供客户需求，专家将引导完成选品 → 配置 → 折扣 → 提交全流程

## 反馈

使用过程中遇到问题或有改进建议，直接对专家说 `/feedback` 即可提交。
