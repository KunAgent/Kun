---
name: tencent-cloud-product-mapping
description: >-
  根据自然语言描述、产品名片段、关键词或产品缩写，定位最匹配的腾讯云产品名称或产品缩写。当用户需要把“数据安全审计 DBAudit 标准版”等模糊输入归一化为腾讯云产品，而不是查询文档说明、价格或云资源时使用。本 Skill 内置 HTTP MCP 访问脚本，无需用户安装 MCP。
---

# Tencent Cloud Product Mapping

根据输入的描述、关键词、别名或缩写，返回最匹配的腾讯云产品。只输出产品类型本身，不输出相关文档、介绍、搜索依据或推荐理由，除非用户明确要求解释。

## 默认行为

1. 使用内置脚本访问腾讯云官网文档 MCP HTTP 端点，不要求本机安装 MCP。
2. 优先输出最高置信度的一个腾讯云产品。
3. 默认极简输出：只返回产品名称；找不到或低置信时原样返回输入内容。
4. 用户要求缩写时输出产品 `ProductSlug`；用户要求名称和缩写时输出二者；找不到或低置信时仍原样返回输入内容。
5. 用户要求原因、依据、候选项、置信度或调试信息时，使用 `--explain --jsonl` 输出结构化结果，再整理为简短说明。
6. 不把文档标题、文档 URL、产品介绍当作最终答案；文档检索只作为定位产品的证据。

## 匹配判断优先级

1. 优先相信腾讯云产品目录中的精确产品名或独立缩写 token；不要把短缩写当作任意子串匹配。
2. 命中内置别名时直接返回目录产品；别名只覆盖真实报价明细中常见的产品改名、英文缩写、SKU 家族和中英文倒序写法。
3. 只有在目录直匹配和别名都未命中时，才使用 MCP 文档搜索做补充召回。
4. 文档搜索结果必须归一化到产品目录里的 `ProductName` / `ProductSlug`；不要把文档标题、API 字段、规格名或正文片段当成产品。
5. 对已知噪声输入返回 `未找到`，不要硬猜：例如 `服务网格 TCM`、`工作流 ASW`、`蓝盾流水线`、`图数据库 KonisGraph`、`车联网 TCIP`、`NLP 工具包`。

## 反模式

- 不要因为文档中出现 `DBAudit`、`VSS`、`NER` 等 API 字段或正文词，就选择文档所属产品。
- 不要把 `访问管理`、`操作审计`、`词汇表`、`政策与规范` 当作兜底产品；除非输入明确要求这些产品。
- 不要把 `TCM` 误当成 `tcmq`，也不要把 `ASW`、`NLP`、`VoIP` 这类目录中不存在的一等产品强行映射到搜索结果第一名。
- 不要在用户只要产品名时输出候选、解释、文档 URL 或 MCP 调用细节。

## 回归样例

| 输入 | 默认输出 | 缩写 |
|---|---|---|
| `数据安全审计 DBAudit 标准版` | `数据安全审计` | `CDS` |
| `对象存储 COS` | `对象存储` | `cos` |
| `MySQL 云数据库 高可用版` | `云数据库 MySQL` | `cdb` |
| `数据仓库 CDW-PG Greenplum 版` | `腾讯云数据仓库 TCHouse-P` | `tchousep` |
| `Hunyuan-Standard 输入 token、输出 token` | `腾讯混元大模型` | `hunyuan` |
| `大模型知识引擎 LKE 企业版` | `知识引擎原子能力` | `lkeap` |
| `DNS 解析 DNSPod 企业版` | `云解析 DNS` | `dns` |
| `人脸识别 FaceID 活体检测` | `人脸核身` | `faceid` |
| `服务网格 TCM 标准版` | `服务网格 TCM 标准版` | `服务网格 TCM 标准版` |
| `NLP 工具包 情感 / 分词 / NER` | `NLP 工具包 情感 / 分词 / NER` | `NLP 工具包 情感 / 分词 / NER` |

## 命令

```bash
node "${SKILL_BASE_DIR}/scripts/tencent_cloud_product_map.mjs" "数据安全审计 DBAudit 标准版"
```

默认输出示例：

```text
数据安全审计
```

输出缩写：

```bash
node "${SKILL_BASE_DIR}/scripts/tencent_cloud_product_map.mjs" --field slug "数据安全审计 DBAudit 标准版"
```

输出名称和缩写：

```bash
node "${SKILL_BASE_DIR}/scripts/tencent_cloud_product_map.mjs" --field both "数据安全审计 DBAudit 标准版"
```

批量调用：

```bash
node "${SKILL_BASE_DIR}/scripts/tencent_cloud_product_map.mjs" \
  "数据安全审计 DBAudit 标准版" \
  "云服务器" \
  "对象存储 COS"
```

或从标准输入逐行批量调用：

```bash
printf '%s\n' "数据安全审计 DBAudit 标准版" "云服务器" "对象存储 COS" \
  | node "${SKILL_BASE_DIR}/scripts/tencent_cloud_product_map.mjs"
```

机器可读批量结果：

```bash
node "${SKILL_BASE_DIR}/scripts/tencent_cloud_product_map.mjs" --jsonl --field json \
  "数据安全审计 DBAudit 标准版" "对象存储 COS"
```

需要依据时：

```bash
node "${SKILL_BASE_DIR}/scripts/tencent_cloud_product_map.mjs" --explain --jsonl --field json \
  "数据安全审计 DBAudit 标准版"
```

## 输出规则

| 场景 | 命令参数 | 面向用户输出 |
|---|---|---|
| 默认找产品名 | 无 | `数据安全审计` |
| 用户要缩写 | `--field slug` | `CDS` |
| 用户要名称和缩写 | `--field both` | `数据安全审计\tCDS` |
| 用户要解释 / 候选 | `--explain --jsonl --field json` | 先读 JSON，再用简短自然语言说明 |
| 未找到高置信产品 / 低置信 | 无 | 原样返回输入内容 |

## 使用约束

- 只在“产品归一化 / 产品名匹配 / 产品缩写查询”任务中使用。
- 不用本 Skill 查询价格；价格问题改用 `tencent-cloud-pricing`。
- 不用本 Skill生成选品、报价单或折扣方案；这些任务回到 `cpq` 主流程。
- 不向用户暴露 MCP 会话、搜索文档、候选文档 URL 或评分细节，除非用户明确要求。
- 不凭模型记忆补产品名。命令输出等于原始输入时，表示没有找到高置信匹配，应保留原始输入继续后续流程，或在用户询问时说明未高置信命中。
- 固定使用 `scripts/tencent_cloud_product_map.py`；不要在运行时生成临时脚本、临时 Python 片段或包装命令替代该脚本能力。

## 端点配置

脚本默认访问：

```text
http://portal-mcp-server.woa.com/mcp
```

如需切换端点，设置环境变量：

```bash
TCLOUD_PRODUCT_MCP_URL="http://portal-mcp-server.woa.com/mcp" \
node "${SKILL_BASE_DIR}/scripts/tencent_cloud_product_map.mjs" "云服务器"
```

## 网络重试

脚本对每个 MCP HTTP 请求内置网络异常检测与重试：遇到超时或连接失败时，默认间隔 5 秒重试，最多重试 2 次，重试过程打印到 stderr（不污染 stdout 结果）。仅对网络/超时类错误重试，业务错误不重试。一般无需额外参数；网络较差时可调大重试次数或间隔：

```bash
node "${SKILL_BASE_DIR}/scripts/tencent_cloud_product_map.mjs" \
  --retries 5 --retry-delay 5 "对象存储 COS"
```

- `--retries`：网络/超时失败后的重试次数（默认 `2`）。
- `--retry-delay`：每次重试前等待秒数（默认 `5`）。
- `--timeout`：单次 HTTP 请求超时秒数（默认 `20`）。
