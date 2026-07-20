<div align="center" id="top">

<img src="https://github.com/assafelovic/gpt-researcher/assets/13554167/20af8286-b386-44a5-9a83-3be1365139c3" alt="Logo" width="80">

####

[![Website](https://img.shields.io/badge/Official%20Website-gptr.dev-teal?style=for-the-badge&logo=world&logoColor=white&color=0891b2)](https://gptr.dev)
[![Documentation](https://img.shields.io/badge/Documentation-DOCS-f472b6?logo=googledocs&logoColor=white&style=for-the-badge)](https://docs.gptr.dev)
[![Discord](https://img.shields.io/discord/1127851779011391548?logo=discord&logoColor=white&label=Discord&color=34b76a&style=for-the-badge)](https://discord.gg/QgZXvJAccX)

[![PyPI version](https://img.shields.io/pypi/v/gpt-researcher?logo=pypi&logoColor=white&style=flat)](https://badge.fury.io/py/gpt-researcher)
![GitHub Release](https://img.shields.io/github/v/release/assafelovic/gpt-researcher?style=flat&logo=github)
[![Open In Colab](https://img.shields.io/static/v1?message=Open%20in%20Colab&logo=googlecolab&labelColor=grey&color=yellow&label=%20&style=flat&logoSize=40)](https://colab.research.google.com/github/assafelovic/gpt-researcher/blob/master/docs/docs/examples/pip-run.ipynb)
[![Docker Image Version](https://img.shields.io/docker/v/elestio/gpt-researcher/latest?arch=amd64&style=flat&logo=docker&logoColor=white&color=1D63ED)](https://hub.docker.com/r/gptresearcher/gpt-researcher)
[![Skill](https://img.shields.io/badge/Claude%20Skill-skills.sh-blueviolet?style=flat&logo=anthropic&logoColor=white)](https://skills.sh/assafelovic/gpt-researcher/gpt-researcher)
[![Twitter Follow](https://img.shields.io/twitter/follow/assaf_elovic?style=social)](https://twitter.com/assaf_elovic)

[English](README.md) | [中文](README-zh_CN.md) | [日本語](README-ja_JP.md) | [한국어](README-ko_KR.md)

</div>

# GPT Researcher

> 中文翻译说明：本文译自 `assafelovic/gpt-researcher` 的 README。原文来源：https://github.com/assafelovic/gpt-researcher 。许可证：Apache License 2.0。代码块、链接、图片和徽章尽量保留原样，仅翻译说明文字。

**GPT Researcher 是第一个为任意任务的网页研究和本地研究而设计的开放 deep research agent。**

这个 agent 会生成详细、事实性、无偏的研究报告，并附带引用。GPT Researcher 提供完整的自定义选项，用于创建量身定制、面向特定领域的 research agent。受近期 [Plan-and-Solve](https://arxiv.org/abs/2305.04091) 和 [RAG](https://arxiv.org/abs/2005.11401) 论文启发，GPT Researcher 通过稳定表现和并行化 agent 工作带来的速度提升，处理错误信息、速度、确定性和可靠性问题。

**我们的使命是：通过 AI，为个人和组织提供准确、无偏、事实性的信息。**

## 为什么选择 GPT Researcher？

- 人工研究要得出客观结论，可能需要数周时间，并消耗大量资源。
- LLM 训练数据可能过时，容易产生幻觉，无法适配当前研究任务。
- 当前 LLM 有 token 限制，不足以生成长篇研究报告。
- 现有服务中的网页来源有限，容易导致错误信息和浅层结果。
- 选择性网页来源可能给研究任务引入偏见。

## 演示

<a href="https://www.youtube.com/watch?v=f60rlc_QCxE" target="_blank" rel="noopener">
  <img src="https://github.com/user-attachments/assets/ac2ec55f-b487-4b3f-ae6f-b8743ad296e4" alt="Demo video" width="800" target="_blank" />
</a>

## 作为 Claude Skill 安装

通过将 GPT Researcher 安装为 [Claude Skill](https://skills.sh/assafelovic/gpt-researcher/gpt-researcher)，扩展 Claude 的 deep research 能力：

```bash
npx skills add assafelovic/gpt-researcher
```

安装后，Claude 可以在你的对话中直接使用 GPT Researcher 的 deep research 能力。

## 架构

核心思想是使用“planner”和“execution”agents。planner 生成研究问题，execution agents 收集相关信息。publisher 随后将所有发现聚合成一份完整报告。

<div align="center">
<img align="center" height="600" src="https://github.com/assafelovic/gpt-researcher/assets/13554167/4ac896fd-63ab-4b77-9688-ff62aafcc527">
</div>

步骤：

* 基于研究 query 创建一个任务专属 agent。
* 生成一组问题，这些问题合在一起可以对任务形成客观观点。
* 使用 crawler agent 为每个问题收集信息。
* 对每个资源进行总结和来源追踪。
* 将摘要过滤并聚合为最终研究报告。

## 教程

- [How it Works](https://docs.gptr.dev/blog/building-gpt-researcher)
- [How to Install](https://www.loom.com/share/04ebffb6ed2a4520a27c3e3addcdde20?sid=da1848e8-b1f1-42d1-93c3-5b0b9c3b24ea)
- [Live Demo](https://www.loom.com/share/6a3385db4e8747a1913dd85a7834846f?sid=a740fd5b-2aa3-457e-8fb7-86976f59f9b8)

## 功能

- 生成使用网页和本地文档的详细研究报告。
- 为报告进行智能图片抓取和过滤。
- 使用 Google Gemini（Nano Banana）生成 **AI inline images**，用于视觉插图。
- 生成超过 2,000 字的详细报告。
- 聚合超过 20 个来源，以得到客观结论。
- 提供轻量版（HTML/CSS/JS）和生产就绪版（NextJS + Tailwind）前端。
- 支持启用 JavaScript 的网页抓取。
- 在整个研究过程中维护 memory 和 context。
- 将报告导出为 PDF、Word 和其他格式。

## 文档

查看[文档](https://docs.gptr.dev/docs/gpt-researcher/getting-started)获取：

- 安装和设置指南
- 配置和自定义选项
- How-To 示例
- 完整 API 参考

## 开始使用

### 安装

1. 安装 Python 3.11 或更高版本。[指南](https://www.tutorialsteacher.com/python/install-python)。
2. 克隆项目并进入目录：

    ```bash
    git clone https://github.com/assafelovic/gpt-researcher.git
    cd gpt-researcher
    ```

3. 通过导出环境变量或把它们存入 `.env` 文件来设置 API key。

    ```bash
    export OPENAI_API_KEY={Your OpenAI API Key here}
    export TAVILY_API_KEY={Your Tavily API Key here}
    ```

    （可选）为了增强 tracing 和 observability，你也可以设置：

    ```bash
    # export LANGCHAIN_TRACING_V2=true
    # export LANGCHAIN_API_KEY={Your LangChain API Key here}
    ```

    对于自定义 OpenAI 兼容 API（例如本地模型或其他 provider），你也可以设置：

    ```bash
    export OPENAI_BASE_URL={Your custom API base URL here}
    ```

4. 安装依赖并启动 server：

    ```bash
    pip install -r requirements.txt
    python -m uvicorn main:app --reload
    ```

访问 [http://localhost:8000](http://localhost:8000) 开始使用。

对于其他设置方式（例如 Poetry 或虚拟环境），请查看 [Getting Started page](https://docs.gptr.dev/docs/gpt-researcher/getting-started)。

## 作为 PIP 包运行

```bash
pip install gpt-researcher
```

### 使用示例：

```python
...
from gpt_researcher import GPTResearcher

query = "why is Nvidia stock going up?"
researcher = GPTResearcher(query=query)
# Conduct research on the given query
research_result = await researcher.conduct_research()
# Write the report
report = await researcher.write_report()
...
```

**更多示例和配置，请参考 [PIP documentation](https://docs.gptr.dev/docs/gpt-researcher/gptr/pip-package) 页面。**

### MCP Client

GPT Researcher 支持 MCP 集成，可以连接 GitHub repositories、databases 和 custom APIs 等专业数据源。这使它可以在网页搜索之外，从这些数据源开展研究。

```bash
export RETRIEVER=tavily,mcp  # Enable hybrid web + MCP research
```

```python
from gpt_researcher import GPTResearcher
import asyncio
import os

async def mcp_research_example():
    # Enable MCP with web search
    os.environ["RETRIEVER"] = "tavily,mcp"

    researcher = GPTResearcher(
        query="What are the top open source web research agents?",
        mcp_configs=[
            {
                "name": "github",
                "command": "npx",
                "args": ["-y", "@modelcontextprotocol/server-github"],
                "env": {"GITHUB_TOKEN": os.getenv("GITHUB_TOKEN")}
            }
        ]
    )

    research_result = await researcher.conduct_research()
    report = await researcher.write_report()
    return report
```

> 完整 MCP 文档和高级示例，请访问 [MCP Integration Guide](https://docs.gptr.dev/docs/gpt-researcher/retrievers/mcp-configs)。

## Inline Image Generation

GPT Researcher 可以使用 Google Gemini models（Nano Banana）在你的研究报告中自动生成并嵌入由 AI 创建的插图。

```bash
# Enable in your .env file
IMAGE_GENERATION_ENABLED=true
GOOGLE_API_KEY=your_google_api_key
IMAGE_GENERATION_MODEL=models/gemini-2.5-flash-image
```

启用后，系统会：

1. 分析你的研究上下文，识别可视化机会。
2. 在研究阶段预先生成 2-3 张相关图片。
3. 在撰写报告时将图片内嵌进去。

图片会以深色模式风格生成，与 GPT Researcher UI 匹配，并具有带 teal accents 的专业信息图审美。

在我们的文档中[了解更多 Image Generation](https://docs.gptr.dev/docs/gpt-researcher/gptr/image_generation)。

## Deep Research

GPT Researcher 现在包含 Deep Research：一个高级递归研究 workflow，可以用 agentic depth 和 breadth 探索主题。这个功能采用类似树的探索模式，在深入子主题的同时，保持对研究主题的完整视图。

- 类似树的探索，depth 和 breadth 可配置。
- 并发处理，更快得到结果。
- 跨研究分支的智能上下文管理。
- 每次 deep research 大约需要 5 分钟。
- 每次研究成本约 0.4 美元（在 "high" reasoning effort 上使用 `o3-mini`）。

在我们的文档中[了解更多 Deep Research](https://docs.gptr.dev/docs/gpt-researcher/gptr/deep_research)。

## 使用 Docker 运行

> **Step 1** - [安装 Docker](https://docs.gptr.dev/docs/gpt-researcher/getting-started/getting-started-with-docker)

> **Step 2** - 克隆 `.env.example` 文件，将你的 API key 添加到克隆出的文件中，并将文件保存为 `.env`。

> **Step 3** - 在 docker-compose 文件中，注释掉你不想用 Docker 运行的服务。

```bash
docker-compose up --build
```

如果这不起作用，可以尝试不带横杠的命令：

```bash
docker compose up --build
```

> **Step 4** - 默认情况下，如果你没有在 docker-compose 文件中取消注释任何内容，这个流程会启动 2 个进程：

- 运行在 localhost:8000 上的 Python server<br>
- 运行在 localhost:3000 上的 React app<br>

在任意浏览器中访问 localhost:3000，开始研究。

## 本地文档研究

你可以指示 GPT Researcher 基于本地文档运行研究任务。目前支持的文件格式包括：PDF、纯文本、CSV、Excel、Markdown、PowerPoint 和 Word 文档。

Step 1：添加环境变量 `DOC_PATH`，指向你的文档所在文件夹。

```bash
export DOC_PATH="./my-docs"
```

Step 2：

- 如果你在 localhost:8000 上运行前端 app，只需在 "Report Source" 下拉选项中选择 "My Documents"。
- 如果你通过 [PIP package](https://docs.tavily.com/guides/gpt-researcher/gpt-researcher#pip-package) 运行 GPT Researcher，请在实例化 `GPTResearcher` 类时，将 `report_source` 参数传入为 "local"。代码示例见[这里](https://docs.gptr.dev/docs/gpt-researcher/context/tailored-research)。

## MCP Server

我们已经将 MCP server 移动到了专用仓库：[gptr-mcp](https://github.com/assafelovic/gptr-mcp)。

GPT Researcher MCP Server 让 Claude 等 AI 应用可以开展 deep research。虽然 LLM app 可以通过 MCP 访问网页搜索工具，但 GPT Researcher MCP 能提供更深入、更可靠的研究结果。

功能：

- 为 AI assistants 提供 deep research 能力。
- 通过优化上下文使用，提供更高质量的信息。
- 为 LLM 提供带有更好 reasoning 的完整结果。
- 集成 Claude Desktop。

详细安装和使用说明，请访问[官方仓库](https://github.com/assafelovic/gptr-mcp)。

## Multi-Agent Assistant

随着 AI 从 prompt engineering 和 RAG 发展到 multi-agent systems，我们很高兴推出使用 [LangGraph](https://python.langchain.com/v0.1/docs/langgraph/) 和 [AG2](https://github.com/ag2ai/ag2) 构建的 multi-agent assistants。

通过使用 multi-agent frameworks，可以利用具备专业技能的多个 agents，大幅提升研究过程的深度和质量。受近期 [STORM](https://arxiv.org/abs/2402.14207) 论文启发，这个项目展示了一组 AI agents 如何协作完成某个主题的研究，从规划到发布。

一次平均运行会生成一份 5-6 页的研究报告，并输出为 PDF、Docx、Markdown 等多种格式。

可以在[这里](https://github.com/assafelovic/gpt-researcher/tree/master/multi_agents)查看，或前往我们的文档了解更多关于 [LangGraph](https://docs.gptr.dev/docs/gpt-researcher/multi_agents/langgraph) 和 [AG2](https://docs.gptr.dev/docs/gpt-researcher/multi_agents/ag2) 的信息。

## Observability

GPT Researcher 支持 **LangSmith** 以增强 tracing 和 observability，使调试和优化复杂 multi-agent workflows 更容易。

要启用 tracing：

1. 设置以下环境变量：

   ```bash
   export LANGCHAIN_TRACING_V2=true
   export LANGCHAIN_API_KEY=your_api_key
   export LANGCHAIN_PROJECT="gpt-researcher"
   ```

2. 像平时一样运行你的研究任务。所有基于 LangGraph 的 agent 交互都会自动 trace，并在你的 LangSmith dashboard 中可视化。

## 前端应用

GPT-Researcher 现在包含增强版前端，用来改善用户体验并简化研究流程。前端提供：

- 用于输入研究 query 的直观界面。
- 研究任务的实时进度追踪。
- 研究发现的交互式展示。
- 可自定义设置，以获得量身定制的研究体验。

有两种部署选项：

1. 由 FastAPI 提供服务的轻量级静态前端。
2. 用于高级功能的功能丰富 NextJS 应用。

关于前端功能的详细设置说明和更多信息，请访问我们的[文档页面](https://docs.gptr.dev/docs/gpt-researcher/frontend/introduction)。

## 贡献

我们非常欢迎贡献。如果你感兴趣，请查看 [contributing](https://github.com/assafelovic/gpt-researcher/blob/master/CONTRIBUTING.md)。

如果你有兴趣加入我们的使命，请查看我们的 [roadmap](https://trello.com/b/3O7KBePw/gpt-researcher-roadmap) 页面，并通过 [Discord community](https://discord.gg/QgZXvJAccX) 联系我们。

<a href="https://github.com/assafelovic/gpt-researcher/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=assafelovic/gpt-researcher&max=1000" />
</a>

## Support / Contact us

- [Community Discord](https://discord.gg/spBgZmm3Xe)
- Author Email: assaf.elovic@gmail.com

## 免责声明

GPT Researcher 这个项目是一个实验性应用，按“as-is”提供，不附带任何明示或暗示的担保。我们根据 Apache 2 license 为学术目的分享代码。本文内容不构成学术建议，也**不是**在学术或研究论文中使用的推荐。

我们对“无偏研究”主张的看法：

1. GPT Researcher 的主要目标是减少错误和有偏事实。怎么做？我们假设抓取的网站越多，错误数据出现的概率就越低。通过每次研究抓取多个网站，并选择出现频率最高的信息，它们全部错误的概率极低。
2. 我们的目标不是消除偏见；我们的目标是尽可能减少偏见。**我们作为一个社区，是为了找出最有效的人类/LLM 交互方式。**
3. 在研究中，人也倾向于带有偏见，因为多数人对自己研究的主题已经有观点。这个工具会抓取许多观点，并均衡解释多样化观点，而这些观点可能是有偏见的人永远不会读到的。

---

<p align="center">
<a href="https://star-history.com/#assafelovic/gpt-researcher">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=assafelovic/gpt-researcher&type=Date&theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=assafelovic/gpt-researcher&type=Date" />
    <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=assafelovic/gpt-researcher&type=Date" />
  </picture>
</a>
</p>

<p align="right">
  <a href="#top">Back to Top</a>
</p>
