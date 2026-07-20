# Deep Research From Scratch

> 中文翻译说明：本文译自 `langchain-ai/deep_research_from_scratch` 的 README。原文来源：https://github.com/langchain-ai/deep_research_from_scratch 。许可证：MIT License。代码块、链接和图片尽量保留原样，仅翻译说明文字。

Deep research 已经成为最受欢迎的 agent 应用之一。[OpenAI](https://openai.com/index/introducing-deep-research/)、[Anthropic](https://www.anthropic.com/engineering/built-multi-agent-research-system)、[Perplexity](https://www.perplexity.ai/hub/blog/introducing-perplexity-deep-research) 和 [Google](https://gemini.google/overview/deep-research/?hl=en) 都有 deep research 产品，可以使用[各种来源](https://www.anthropic.com/news/research)的上下文生成完整报告。也有许多[开](https://huggingface.co/blog/open-deep-research)[源](https://github.com/google-gemini/gemini-fullstack-langgraph-quickstart)实现。我们构建了一个[open deep researcher](https://github.com/langchain-ai/open_deep_research)，它简单且可配置，允许用户使用自己的模型、搜索工具和 MCP server。在这个仓库中，我们将从零开始构建一个 deep researcher。下面是我们将要构建的主要部分示意图：

![overview](https://github.com/user-attachments/assets/b71727bd-0094-40c4-af5e-87cdb02123b4)

## 快速开始

### 前置要求

- **Node.js 和 npx**（notebook 3 中的 MCP server 需要）：

```bash
# Install Node.js (includes npx)
# On macOS with Homebrew:
brew install node

# On Ubuntu/Debian:
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify installation:
node --version
npx --version
```

- 确保你使用的是 Python 3.11 或更高版本。
- 这个版本是与 LangGraph 获得最佳兼容性所必需的。

```bash
python3 --version
```

- [uv](https://docs.astral.sh/uv/) 包管理器：

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
# Update PATH to use the new uv version
export PATH="/Users/$USER/.local/bin:$PATH"
```

### 安装

1. 克隆仓库：

```bash
git clone https://github.com/langchain-ai/deep_research_from_scratch
cd deep_research_from_scratch
```

2. 安装包和依赖（这会自动创建并管理虚拟环境）：

```bash
uv sync
```

3. 在项目根目录创建包含 API key 的 `.env` 文件：

```bash
# Create .env file
touch .env
```

将你的 API key 添加到 `.env` 文件中：

```env
# Required for research agents with external search
TAVILY_API_KEY=your_tavily_api_key_here

# Required for model usage
OPENAI_API_KEY=your_openai_api_key_here
ANTHROPIC_API_KEY=your_anthropic_api_key_here

# Optional: For evaluation and tracing
LANGSMITH_API_KEY=your_langsmith_api_key_here
LANGSMITH_TRACING=true
LANGSMITH_PROJECT=deep_research_from_scratch
```

4. 使用 uv 运行 notebook 或代码：

```bash
# Run Jupyter notebooks directly
uv run jupyter notebook

# Or activate the virtual environment if preferred
source .venv/bin/activate  # On Windows: .venv\Scripts\activate
jupyter notebook
```

## 背景

Research 是一个开放式任务；回答用户请求的最佳策略无法轻易提前知道。不同请求可能需要不同的研究策略和不同深度的搜索。请考虑这样的请求。

[Agents](https://langchain-ai.github.io/langgraph/tutorials/workflows/#agent) 非常适合 research，因为它们可以灵活应用不同策略，并利用中间结果引导后续探索。Open deep research 使用一个 agent 作为三步流程的一部分来开展研究：

1. **Scope** - 澄清研究范围
2. **Research** - 执行研究
3. **Write** - 生成最终报告

## 组织结构

这个仓库包含 5 个教程 notebook，用来从零开始构建一个 deep research system：

### 教程 Notebook

#### 1. 用户澄清和 Brief 生成（`notebooks/1_scoping.ipynb`）

**目的**：澄清研究范围，并将用户输入转换成结构化的 research brief。

**关键概念**：

- **User Clarification**：使用结构化输出判断是否需要用户提供更多上下文。
- **Brief Generation**：将对话转换成详细的研究问题。
- **LangGraph Commands**：使用 Command system 进行流程控制和状态更新。
- **Structured Output**：使用 Pydantic schema 做可靠决策。

**实现亮点**：

- 两步 workflow：澄清 -> brief 生成。
- 使用结构化输出模型（`ClarifyWithUser`、`ResearchQuestion`）防止幻觉。
- 基于澄清需求进行条件路由。
- 使用日期感知 prompt，支持上下文敏感型研究。

**你将学到什么**：状态管理、结构化输出模式、条件路由。

---

#### 2. 带自定义工具的 Research Agent（`notebooks/2_research_agent.ipynb`）

**目的**：使用外部搜索工具构建一个迭代式 research agent。

**关键概念**：

- **Agent Architecture**：LLM 决策节点 + 工具执行节点模式。
- **Sequential Tool Execution**：可靠的同步工具执行。
- **Search Integration**：使用 Tavily 搜索并进行内容总结。
- **Tool Execution**：带 tool calling 的 ReAct 风格 agent loop。

**实现亮点**：

- 为了可靠性和简单性，使用同步工具执行。
- 通过内容总结压缩搜索结果。
- 带条件路由的迭代式 research loop。
- 为完整研究设计丰富的 prompt engineering。

**你将学到什么**：Agent 模式、工具集成、搜索优化、research workflow 设计。

---

#### 3. 带 MCP 的 Research Agent（`notebooks/3_research_agent_mcp.ipynb`）

**目的**：将 Model Context Protocol（MCP）server 作为研究工具集成进来。

**关键概念**：

- **Model Context Protocol**：用于 AI 工具访问的标准化协议。
- **MCP Architecture**：通过 stdio/HTTP 进行 client-server 通信。
- **LangChain MCP Adapters**：把 MCP server 无缝集成为 LangChain tools。
- **Local vs Remote MCP**：理解传输机制。

**实现亮点**：

- 使用 `MultiServerMCPClient` 管理 MCP server。
- 基于配置的 server 设置（以 filesystem 为例）。
- 对工具输出展示进行丰富格式化。
- MCP 协议要求异步工具执行（不需要嵌套 event loop）。

**你将学到什么**：MCP 集成、client-server 架构、基于协议的工具访问。

---

#### 4. Research Supervisor（`notebooks/4_research_supervisor.ipynb`）

**目的**：为复杂研究任务进行 multi-agent 协调。

**关键概念**：

- **Supervisor Pattern**：协调 agent + worker agents。
- **Parallel Research**：使用并行 tool calls，让多个 research agent 并发研究独立主题。
- **Research Delegation**：用于任务分配的结构化工具。
- **Context Isolation**：为不同研究主题使用分离的上下文窗口。

**实现亮点**：

- 两节点 supervisor 模式（`supervisor` + `supervisor_tools`）。
- 使用 `asyncio.gather()` 实现真正并发的并行研究执行。
- 使用结构化工具（`ConductResearch`、`ResearchComplete`）进行委派。
- 用包含并行研究指令的增强 prompt。
- 对研究聚合模式做完整文档说明。

**你将学到什么**：Multi-agent 模式、并行处理、研究协调、异步编排。

---

#### 5. 完整 Multi-Agent Research System（`notebooks/5_full_agent.ipynb`）

**目的**：整合所有组件，形成完整的端到端研究系统。

**关键概念**：

- **Three-Phase Architecture**：Scope -> Research -> Write。
- **System Integration**：结合 scoping、multi-agent research 和 report generation。
- **State Management**：跨 subgraph 的复杂状态流。
- **End-to-End Workflow**：从用户输入到最终研究报告。

**实现亮点**：

- 通过正确的状态转换完成 workflow 集成。
- 带输出 schema 的 supervisor 和 researcher subgraph。
- 通过研究综合生成最终报告。
- 用基于 thread 的对话管理处理澄清过程。

**你将学到什么**：系统架构、subgraph 组合、端到端 workflow。

---

### 关键学习成果

- **Structured Output**：使用 Pydantic schema 做可靠的 AI 决策。
- **Async Orchestration**：在并行协调和同步简单性之间，策略性地使用异步模式。
- **Agent Patterns**：ReAct loops、supervisor patterns、multi-agent coordination。
- **Search Integration**：外部 API、MCP server、内容处理。
- **Workflow Design**：用于复杂多步骤流程的 LangGraph 模式。
- **State Management**：跨 subgraph 和节点的复杂状态流。
- **Protocol Integration**：MCP server 和工具生态。

每个 notebook 都建立在前一个概念之上，最终形成一个可用于生产的 deep research system。它可以通过智能 scoping 和协调执行，处理复杂、多面的 research queries。
