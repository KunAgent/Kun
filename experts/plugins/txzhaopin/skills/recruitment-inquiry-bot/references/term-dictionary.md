# 招聘业务术语词典（远程资产 stub）

> ⚠️ **本文件是 stub 占位，不含术语词典正文。**
>
> 真正的术语词典（约 144 条，10 个一级分类）在**后端知识库**，运行时由 agent 通过 MCP 拉取，**不落盘**。

## Agent 加载方式

```
apiId  : recruit.recruit-ai-service.get_document
params : { "documentId": "<由 references/_remote-assets.yaml 中 term_dictionary.id 查得>" }
```

详见 `references/_remote-assets.yaml`。

## 为什么不落本地

1. **安全性**：术语词典含集团内部业务标准化口径，不应随 skill 包分发到所有装机
2. **时效性**：术语会随业务迭代（如新增"活水冷冻期""伯乐 IPC"等概念），远程加载无需发版
3. **一致性**：所有 inquiry-bot 装机共享同一份权威词典，避免本地副本漂移

## 维护流程

| 角色 | 步骤 |
|---|---|
| HR / 词典维护者 | 在本地编辑私有 `术语词典.xlsx` |
| | 跑 `python3 scripts/build_term_dict.py <xlsx_path>` 生成 markdown |
| | 把生成的 markdown 上传到知识库 `documentId=50` 覆盖旧版本 |
| | 通过 inquiry-bot 跑一轮问询验证生效 |

> 本 stub 文件仅作占位，被打开时让维护者知道"正文在哪"。Agent 运行时不会读取本文件正文。
