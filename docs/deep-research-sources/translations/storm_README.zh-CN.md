<p align="center">
  <img src="assets/logo.svg" style="width: 25%; height: auto;">
</p>

# STORM：Synthesis of Topic Outlines through Retrieval and Multi-perspective Question Asking

> 中文翻译说明：本文译自 `stanford-oval/storm` 的 README。原文来源：https://github.com/stanford-oval/storm 。许可证：MIT License。代码块、链接、图片和 BibTeX 尽量保留原样，仅翻译说明文字。

<p align="center">
| <a href="http://storm.genie.stanford.edu"><b>Research preview</b></a> | <a href="https://arxiv.org/abs/2402.14207"><b>STORM Paper</b></a>| <a href="https://www.arxiv.org/abs/2408.15232"><b>Co-STORM Paper</b></a>  | <a href="https://storm-project.stanford.edu/"><b>Website</b></a> |
</p>

**最新消息**

- [2025/01] 我们在 `knowledge-storm` v1.1.0 中为语言模型和 embedding 模型加入了 [litellm](https://github.com/BerriAI/litellm) 集成。

- [2024/09] Co-STORM 代码库现已发布，并集成到 `knowledge-storm` python package v1.0.0 中。运行 `pip install knowledge-storm --upgrade` 即可查看。

- [2024/09] 我们推出 collaborative STORM（Co-STORM），用于支持人类-AI 协同知识整理。[Co-STORM Paper](https://www.arxiv.org/abs/2408.15232) 已被 EMNLP 2024 主会接收。

- [2024/07] 现在可以通过 `pip install knowledge-storm` 安装我们的包。
- [2024/07] 我们加入了 `VectorRM`，支持基于用户提供文档进行 grounding，补充了已有的搜索引擎支持（`YouRM`、`BingSearch`）。（见 [#58](https://github.com/stanford-oval/storm/pull/58)）
- [2024/07] 我们发布了面向开发者的 demo light：一个用 Python streamlit 框架构建的最小用户界面，便于本地开发和 demo 托管（见 [#54](https://github.com/stanford-oval/storm/pull/54)）。
- [2024/06] 我们将在 NAACL 2024 展示 STORM。可以在 6 月 17 日 Poster Session 2 找到我们，或查看我们的[演示材料](assets/storm_naacl2024_slides.pdf)。
- [2024/05] 我们在 [rm.py](knowledge_storm/rm.py) 中加入 Bing Search 支持。用 `GPT-4o` 测试 STORM：现在我们的 demo 中使用 `GPT-4o` 模型配置文章生成部分。
- [2024/04] 我们发布了重构版 STORM 代码库。我们为 STORM pipeline 定义了 [interface](knowledge_storm/interface.py)，并重新实现了 STORM-wiki（见 [`src/storm_wiki`](knowledge_storm/storm_wiki)），用于展示如何实例化 pipeline。我们提供 API 来支持不同语言模型和 retrieval/search 集成的自定义。

[![Code style: black](https://img.shields.io/badge/code%20style-black-000000.svg)](https://github.com/psf/black)

## 概览 [(现在试用 STORM)](https://storm.genie.stanford.edu/)

<p align="center">
  <img src="assets/overview.svg" style="width: 90%; height: auto;">
</p>

STORM 是一个 LLM system，可以基于互联网搜索从零开始撰写类似 Wikipedia 的文章。Co-STORM 进一步增强了功能，使人类能够与 LLM system 协作，以支持更符合需求、更偏好的信息搜寻和知识整理。

虽然系统还不能产出无需修改即可发布的文章（这类文章通常需要大量编辑），但有经验的 Wikipedia 编辑发现，它在 pre-writing 阶段很有帮助。

**已有超过 70,000 人试用我们的 [live research preview](https://storm.genie.stanford.edu/)。可以试试看 STORM 如何帮助你的知识探索旅程，也欢迎提供反馈，帮助我们改进系统。**

## STORM 和 Co-STORM 如何工作

### STORM

STORM 将带引用的长文章生成拆成两个步骤：

1. **Pre-writing stage**：系统开展基于互联网的研究，以收集参考资料并生成大纲。
2. **Writing stage**：系统使用大纲和参考资料，生成带引用的完整文章。

<p align="center">
  <img src="assets/two_stages.jpg" style="width: 60%; height: auto;">
</p>

STORM 认为，自动化研究流程的核心，是自动提出好的问题。直接提示语言模型提问效果并不好。为了提升问题的深度和广度，STORM 采用两种策略：

1. **Perspective-Guided Question Asking**：给定输入主题后，STORM 通过调研相似主题的已有文章发现不同视角，并用这些视角控制提问过程。
2. **Simulated Conversation**：STORM 模拟一位 Wikipedia 作者和一位主题专家之间基于互联网来源的对话，使语言模型能够更新对主题的理解，并提出追问问题。

### Co-STORM

Co-STORM 提出了**一种协作式话语协议**，通过实现 turn management policy，支持以下参与者之间的顺畅协作：

- **Co-STORM LLM experts**：这类 agent 会基于外部知识来源生成答案，和/或基于话语历史提出追问问题。
- **Moderator**：这个 agent 会提出发人深省的问题。这些问题受到 retriever 发现但前几轮没有直接使用的信息启发。问题生成也可以基于 grounding。
- **Human user**：人类用户会主动选择：（1）观察话语过程，以更深入理解主题；或（2）通过插入发言主动参与对话，引导讨论焦点。

<p align="center">
  <img src="assets/co-storm-workflow.jpg" style="width: 60%; height: auto;">
</p>

Co-STORM 还维护一个动态更新的 **mind map**，将收集到的信息组织成层级概念结构，目标是**在人类用户和系统之间建立共享概念空间**。事实证明，当话语过程变得很长且深入时，mind map 有助于降低认知负担。

STORM 和 Co-STORM 都使用 [dspy](https://github.com/stanfordnlp/dspy) 以高度模块化的方式实现。

## 安装

要安装 knowledge storm library，请使用 `pip install knowledge-storm`。

你也可以安装源代码，这样可以直接修改 STORM engine 的行为。

1. 克隆 git 仓库。

    ```shell
    git clone https://github.com/stanford-oval/storm.git
    cd storm
    ```

2. 安装所需 package。

   ```shell
   conda create -n storm python=3.11
   conda activate storm
   pip install -r requirements.txt
   ```

## API

当前，我们的 package 支持：

- Language model components：litellm 支持的所有语言模型，列表见[这里](https://docs.litellm.ai/docs/providers)。
- Embedding model components：litellm 支持的所有 embedding 模型，列表见[这里](https://docs.litellm.ai/docs/embedding/supported_embedding)。
- Retrieval module components：`YouRM`、`BingSearch`、`VectorRM`、`SerperRM`、`BraveRM`、`SearXNG`、`DuckDuckGoSearchRM`、`TavilySearchRM`、`GoogleSearch` 和 `AzureAISearch`。

:star2: **非常欢迎提交 PR，将更多 search engines/retrievers 集成到 [knowledge_storm/rm.py](knowledge_storm/rm.py) 中。**

STORM 和 Co-STORM 都工作在 information curation layer。你需要分别设置 information retrieval module 和 language model module，来创建它们各自的 `Runner` class。

### STORM

STORM knowledge curation engine 被定义为一个简单的 Python `STORMWikiRunner` class。下面是一个使用 You.com search engine 和 OpenAI models 的示例。

```python
import os
from knowledge_storm import STORMWikiRunnerArguments, STORMWikiRunner, STORMWikiLMConfigs
from knowledge_storm.lm import LitellmModel
from knowledge_storm.rm import YouRM

lm_configs = STORMWikiLMConfigs()
openai_kwargs = {
    'api_key': os.getenv("OPENAI_API_KEY"),
    'temperature': 1.0,
    'top_p': 0.9,
}
# STORM is a LM system so different components can be powered by different models to reach a good balance between cost and quality.
# For a good practice, choose a cheaper/faster model for `conv_simulator_lm` which is used to split queries, synthesize answers in the conversation.
# Choose a more powerful model for `article_gen_lm` to generate verifiable text with citations.
gpt_35 = LitellmModel(model='gpt-3.5-turbo', max_tokens=500, **openai_kwargs)
gpt_4 = LitellmModel(model='gpt-4o', max_tokens=3000, **openai_kwargs)
lm_configs.set_conv_simulator_lm(gpt_35)
lm_configs.set_question_asker_lm(gpt_35)
lm_configs.set_outline_gen_lm(gpt_4)
lm_configs.set_article_gen_lm(gpt_4)
lm_configs.set_article_polish_lm(gpt_4)
# Check out the STORMWikiRunnerArguments class for more configurations.
engine_args = STORMWikiRunnerArguments(...)
rm = YouRM(ydc_api_key=os.getenv('YDC_API_KEY'), k=engine_args.search_top_k)
runner = STORMWikiRunner(engine_args, lm_configs, rm)
```

`STORMWikiRunner` 实例可以通过简单的 `run` 方法调用：

```python
topic = input('Topic: ')
runner.run(
    topic=topic,
    do_research=True,
    do_generate_outline=True,
    do_generate_article=True,
    do_polish_article=True,
)
runner.post_run()
runner.summary()
```

- `do_research`：如果为 True，就用不同视角模拟对话，以收集关于主题的信息；否则加载结果。
- `do_generate_outline`：如果为 True，就为主题生成大纲；否则加载结果。
- `do_generate_article`：如果为 True，就基于大纲和收集到的信息为主题生成文章；否则加载结果。
- `do_polish_article`：如果为 True，就通过添加总结章节，并（可选）移除重复内容来润色文章；否则加载结果。

### Co-STORM

Co-STORM knowledge curation engine 被定义为一个简单的 Python `CoStormRunner` class。下面是一个使用 Bing search engine 和 OpenAI models 的示例。

```python
from knowledge_storm.collaborative_storm.engine import CollaborativeStormLMConfigs, RunnerArgument, CoStormRunner
from knowledge_storm.lm import LitellmModel
from knowledge_storm.logging_wrapper import LoggingWrapper
from knowledge_storm.rm import BingSearch

# Co-STORM adopts the same multi LM system paradigm as STORM
lm_config: CollaborativeStormLMConfigs = CollaborativeStormLMConfigs()
openai_kwargs = {
    "api_key": os.getenv("OPENAI_API_KEY"),
    "api_provider": "openai",
    "temperature": 1.0,
    "top_p": 0.9,
    "api_base": None,
}
question_answering_lm = LitellmModel(model=gpt_4o_model_name, max_tokens=1000, **openai_kwargs)
discourse_manage_lm = LitellmModel(model=gpt_4o_model_name, max_tokens=500, **openai_kwargs)
utterance_polishing_lm = LitellmModel(model=gpt_4o_model_name, max_tokens=2000, **openai_kwargs)
warmstart_outline_gen_lm = LitellmModel(model=gpt_4o_model_name, max_tokens=500, **openai_kwargs)
question_asking_lm = LitellmModel(model=gpt_4o_model_name, max_tokens=300, **openai_kwargs)
knowledge_base_lm = LitellmModel(model=gpt_4o_model_name, max_tokens=1000, **openai_kwargs)

lm_config.set_question_answering_lm(question_answering_lm)
lm_config.set_discourse_manage_lm(discourse_manage_lm)
lm_config.set_utterance_polishing_lm(utterance_polishing_lm)
lm_config.set_warmstart_outline_gen_lm(warmstart_outline_gen_lm)
lm_config.set_question_asking_lm(question_asking_lm)
lm_config.set_knowledge_base_lm(knowledge_base_lm)

# Check out the Co-STORM's RunnerArguments class for more configurations.
topic = input('Topic: ')
runner_argument = RunnerArgument(topic=topic, ...)
logging_wrapper = LoggingWrapper(lm_config)
bing_rm = BingSearch(bing_search_api_key=os.environ.get("BING_SEARCH_API_KEY"),
                     k=runner_argument.retrieve_top_k)
costorm_runner = CoStormRunner(lm_config=lm_config,
                               runner_argument=runner_argument,
                               logging_wrapper=logging_wrapper,
                               rm=bing_rm)
```

`CoStormRunner` 实例可以通过 `warmstart()` 和 `step(...)` 方法调用。

```python
# Warm start the system to build shared conceptual space between Co-STORM and users
costorm_runner.warm_start()

# Step through the collaborative discourse
# Run either of the code snippets below in any order, as many times as you'd like
# To observe the conversation:
conv_turn = costorm_runner.step()
# To inject your utterance to actively steer the conversation:
costorm_runner.step(user_utterance="YOUR UTTERANCE HERE")

# Generate report based on the collaborative discourse
costorm_runner.knowledge_base.reorganize()
article = costorm_runner.generate_report()
print(article)
```

## 使用示例脚本快速开始

我们在 [examples folder](examples) 中提供了脚本，作为使用不同配置运行 STORM 和 Co-STORM 的快速开始。

我们建议使用 `secrets.toml` 设置 API key。在根目录下创建 `secrets.toml` 文件，并添加以下内容：

```shell
# ============ language model configurations ============
# Set up OpenAI API key.
OPENAI_API_KEY="your_openai_api_key"
# If you are using the API service provided by OpenAI, include the following line:
OPENAI_API_TYPE="openai"
# If you are using the API service provided by Microsoft Azure, include the following lines:
OPENAI_API_TYPE="azure"
AZURE_API_BASE="your_azure_api_base_url"
AZURE_API_VERSION="your_azure_api_version"
# ============ retriever configurations ============
BING_SEARCH_API_KEY="your_bing_search_api_key" # if using bing search
# ============ encoder configurations ============
ENCODER_API_TYPE="openai" # if using openai encoder
```

### STORM 示例

**使用默认配置和 `gpt` 系列模型运行 STORM：**

运行以下命令。

```bash
python examples/storm_examples/run_storm_wiki_gpt.py \
    --output-dir $OUTPUT_DIR \
    --retriever bing \
    --do-research \
    --do-generate-outline \
    --do-generate-article \
    --do-polish-article
```

**使用你喜欢的语言模型运行 STORM，或基于自己的语料库进行 grounding：** 查看 [examples/storm_examples/README.md](examples/storm_examples/README.md)。

### Co-STORM 示例

要用默认配置和 `gpt` 系列模型运行 Co-STORM：

1. 将 `BING_SEARCH_API_KEY="xxx"` 和 `ENCODER_API_TYPE="xxx"` 添加到 `secrets.toml`。
2. 运行以下命令：

```bash
python examples/costorm_examples/run_costorm_gpt.py \
    --output-dir $OUTPUT_DIR \
    --retriever bing
```

## Pipeline 自定义

### STORM

如果你安装了源代码，可以基于自己的使用场景自定义 STORM。STORM engine 由 4 个模块组成：

1. Knowledge Curation Module：收集关于给定主题的广覆盖信息。
2. Outline Generation Module：通过为整理后的知识生成层级大纲，组织收集到的信息。
3. Article Generation Module：用收集到的信息填充生成的大纲。
4. Article Polishing Module：润色和增强写好的文章，使其展示效果更好。

每个模块的 interface 定义在 `knowledge_storm/interface.py` 中，实现则实例化在 `knowledge_storm/storm_wiki/modules/*` 中。可以根据你的具体需求自定义这些模块（例如，用 bullet point 格式生成章节，而不是生成完整段落）。

### Co-STORM

如果你安装了源代码，可以基于自己的使用场景自定义 Co-STORM。

1. Co-STORM 引入了多种 LLM agent 类型（即 Co-STORM experts 和 Moderator）。LLM agent interface 定义在 `knowledge_storm/interface.py` 中，实现则实例化在 `knowledge_storm/collaborative_storm/modules/co_storm_agents.py` 中。可以自定义不同的 LLM agent policies。
2. Co-STORM 引入了 collaborative discourse protocol，其核心功能集中在 turn policy management。我们通过 `knowledge_storm/collaborative_storm/engine.py` 中的 `DiscourseManager` 提供了一个 turn policy management 示例实现。它可以被自定义并进一步改进。

## 数据集

为了促进自动知识整理和复杂信息搜寻研究，我们的项目发布了以下数据集：

### FreshWiki

FreshWiki Dataset 是一个由 100 篇高质量 Wikipedia 文章组成的数据集，聚焦 2022 年 2 月到 2023 年 9 月期间编辑最多的页面。更多细节见 [STORM paper](https://arxiv.org/abs/2402.14207) 第 2.1 节。

你可以直接从 [huggingface](https://huggingface.co/datasets/EchoShao8899/FreshWiki) 下载数据集。为了缓解数据污染问题，我们归档了可在未来日期重复运行的数据构建 pipeline 的[源代码](https://github.com/stanford-oval/storm/tree/NAACL-2024-code-backup/FreshWiki)。

### WildSeek

为了研究真实环境中用户对复杂信息搜寻任务的兴趣，我们利用 web research preview 收集的数据创建了 WildSeek dataset。我们对数据进行了下采样，以确保主题多样性和数据质量。每个数据点都是一个 pair，包含主题和用户针对该主题进行 deep search 的目标。更多细节请参考 [Co-STORM paper](https://www.arxiv.org/abs/2408.15232) 第 2.2 节和附录 A。

WildSeek dataset 可在[这里](https://huggingface.co/datasets/YuchengJiang/WildSeek)获取。

## 复现 STORM 和 Co-STORM 论文结果

对于 STORM paper 实验，请切换到[这里](https://github.com/stanford-oval/storm/tree/NAACL-2024-code-backup)的 `NAACL-2024-code-backup` 分支。

对于 Co-STORM paper 实验，请切换到 `EMNLP-2024-code-backup` 分支（当前为 placeholder，将很快更新）。

## Roadmap 和贡献

我们的团队正在积极推进：

1. Human-in-the-Loop Functionalities：支持用户参与知识整理过程。
2. Information Abstraction：为整理后的信息开发 abstraction，以支持 Wikipedia-style report 之外的展示格式。

如果你有任何问题或建议，欢迎打开 issue 或 pull request。我们欢迎贡献，共同改进系统和代码库。

联系人：[Yijia Shao](mailto:shaoyj@stanford.edu) 和 [Yucheng Jiang](mailto:yuchengj@stanford.edu)

## 致谢

我们感谢 Wikipedia 提供优秀的开源内容。FreshWiki dataset 来源于 Wikipedia，并根据 Creative Commons Attribution-ShareAlike（CC BY-SA）许可证授权。

我们非常感谢 [Michelle Lam](https://michelle123lam.github.io/) 为这个项目设计 logo，也感谢 [Dekun Ma](https://dekun.me) 负责 UI 开发。

感谢 Vercel 对[开源软件](https://storm.genie.stanford.edu)的支持。

## 引用

如果你在工作中使用了这份代码或其中一部分，请引用我们的论文：

```bibtex
@inproceedings{jiang-etal-2024-unknown,
    title = "Into the Unknown Unknowns: Engaged Human Learning through Participation in Language Model Agent Conversations",
    author = "Jiang, Yucheng  and
      Shao, Yijia  and
      Ma, Dekun  and
      Semnani, Sina  and
      Lam, Monica",
    editor = "Al-Onaizan, Yaser  and
      Bansal, Mohit  and
      Chen, Yun-Nung",
    booktitle = "Proceedings of the 2024 Conference on Empirical Methods in Natural Language Processing",
    month = nov,
    year = "2024",
    address = "Miami, Florida, USA",
    publisher = "Association for Computational Linguistics",
    url = "https://aclanthology.org/2024.emnlp-main.554/",
    doi = "10.18653/v1/2024.emnlp-main.554",
    pages = "9917--9955",
}

@inproceedings{shao-etal-2024-assisting,
    title = "Assisting in Writing {W}ikipedia-like Articles From Scratch with Large Language Models",
    author = "Shao, Yijia  and
      Jiang, Yucheng  and
      Kanell, Theodore  and
      Xu, Peter  and
      Khattab, Omar  and
      Lam, Monica",
    editor = "Duh, Kevin  and
      Gomez, Helena  and
      Bethard, Steven",
    booktitle = "Proceedings of the 2024 Conference of the North American Chapter of the Association for Computational Linguistics: Human Language Technologies (Volume 1: Long Papers)",
    month = jun,
    year = "2024",
    address = "Mexico City, Mexico",
    publisher = "Association for Computational Linguistics",
    url = "https://aclanthology.org/2024.naacl-long.347/",
    doi = "10.18653/v1/2024.naacl-long.347",
    pages = "6252--6278",
}
```
