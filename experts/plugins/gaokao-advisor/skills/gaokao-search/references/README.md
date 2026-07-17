# References

- `imasearch-api.md`: 原始接口协议，包含 AgentTool 模式和 kinfra 高考上游说明。

本技能实际实现只调用 AgentTool 正式接口 `https://copilot.tencent.com/agenttool/v1/imasearch`。kinfra 只作为 AgentTool 服务端内部上游说明保留，专家包脚本不直连、不自行签名。
