# 面谈 / 会议能力

用于搜索历史面谈记录、读取会话文档预览，以及在用户明确要求时发起新的 AI 面谈/会议会话。执行前以当前本机 help 为准：

```bash
ihr-cli conference --help
ihr-cli conference +search --help
ihr-cli conference +documents --help
```

## 当前已知 shortcut

```bash
ihr-cli conference +search --queryText "关键词"
ihr-cli conference +search --queryText "绩效面谈" --previewLimit 5
ihr-cli conference +documents --conferenceSessionIds "会话ID1,会话ID2"
```

## 查询工作流

1. 根据用户关键词搜索会话。
2. 从结果中提取 `conferenceSessionId` 或当前 CLI 输出中的等价字段。
3. 用户要求读取文档预览时，再调用 `+documents`。
4. 输出时摘要化会议内容，不要默认回显完整原文。

## 发起 AI 面谈 / 会话

当用户要求“发起 AI 面谈”“创建面谈会话”“启动候选人面谈”时，先检查当前 `ihr-cli conference --help` 是否已有专用发起命令。若当前 CLI 未暴露专用 shortcut，可使用 `ihr-cli interface +post` 调用已确认的网关接口。

### 正确接口

- Path: `/gateway/ai/conference/v1/analysis/conference/launchConference`
- Method: `POST`
- 必要请求头：`IHR-Request-Origin: hrclaw`
- 固定必填字段：`sourceType` 必须传 `"IHR360"`

最小调用形态：

```bash
ihr-cli interface +post /gateway/ai/conference/v1/analysis/conference/launchConference \
  -H "IHR-Request-Origin: hrclaw" \
  --json '{"sourceType":"IHR360"}'
```

真实执行前还必须补齐候选人或业务对象标识、面谈目的、模板或题纲等业务字段。这些字段必须来自用户明确提供、已验证的业务上下文、当前 CLI 输出或 live 接口证据，不要猜测字段名或枚举值。

### 发起前确认

发起会话是写操作。调用前必须向用户展示摘要并获得明确确认：

- 将创建新的 AI 面谈/会议会话
- 目标候选人或业务对象
- 面谈目的
- 使用的模板、题纲或来源

用户未确认前，不得调用发起接口。

### 已知弯路

不要重复以下探索路径：

- 不要使用 `/gateway/ai/conference/v1/launchConference`。该旧路径可能返回 HTTP 200 但响应体为空，实际没有创建可用会话。
- 不要在缺少 `sourceType` 时调用正确路径；接口会报 `sourceType 不能为空`。
- 不要枚举尝试 `STAFF`、`IHR`、`INTERNAL` 等 `sourceType` 值；当前已确认固定值是 `"IHR360"`。
- 不要把 HTTP 200 当成创建成功。必须检查响应体中是否存在会话 ID、状态、访问链接或其他可追踪业务字段。

后续如果 live 调用确认了新增必填字段、目的与模板映射、响应结构或错误码，必须把脱敏后的字段口径回写到本文件，不要只留在对话里。

## 注意事项

- 不要编造 session ID。
- 搜索结果较多时先列出候选项，让用户确认目标。
- 如果用户请求“最新”“最近”，必须使用明确时间范围；当前日期来自运行环境。
- 如果命令参数和本文不一致，以 `ihr-cli conference +<verb> --help` 为准。
- 不要把 token、Cookie、候选人隐私详情、完整敏感响应或测试租户专属材料写入本 reference。
