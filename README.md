<p align="center">
  <img src="src/asset/img/kun.png" width="88" alt="Kun 蓝色 K 标识">
</p>

<h1 align="center">Kun — 本地优先的 AI Agent 工作台</h1>

<p align="center">
  让 AI 在真实项目中规划、执行、验证并交付。<br>
  桌面 GUI 与终端 TUI 共用同一个本地运行时，任务、审批、计划和证据始终连续。
</p>

<p align="center">
  <a href="https://github.com/KunAgent/Kun/releases">下载桌面版</a>
  &nbsp;·&nbsp;
  <a href="https://www.kun-agent.com/docs">阅读文档</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/KunAgent/Kun">GitHub</a>
  &nbsp;·&nbsp;
  <a href="./README.en.md">English</a>
</p>

<p align="center">
  <a href="https://github.com/KunAgent/Kun/releases"><img src="https://img.shields.io/github/v/release/KunAgent/Kun?label=release" alt="Kun 最新 GitHub Release"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-PolyForm%20Noncommercial%201.0.0-blue" alt="Kun 使用 PolyForm Noncommercial 1.0.0 许可证"></a>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey" alt="支持 macOS、Windows 和 Linux">
  <img src="https://img.shields.io/badge/GUI%20%2B%20TUI-one%20shared%20runtime-6366f1" alt="桌面 GUI 与终端 TUI 共用一个 Kun 运行时">
</p>

<p align="center">
  <img src="./docs/assets/readme/kun-hero-gui-tui-character-demo.jpg" alt="Kun GUI 与 TUI 海报：虚构演示数据中的吉祥物、桌面 Code 界面与终端 TUI" width="100%">
</p>

## Kun 是什么

Kun 是把 AI 从“回答问题”推进到“完成工作”的本地优先工作台。它以两个主模式组织真实工作：Code 面向软件交付，并在同一任务中提供 Design 画布；Work 面向写作、资料整理、文档分析和演示产出。Agent 可以读取工作区上下文、制定计划、调用工具、修改文件、运行验证，并把证据留在任务旁。

桌面 GUI 适合观察、审阅和控制过程；终端 TUI 适合专注于键盘工作。两者通过同一个本地 `kun serve` 运行时共享线程、目标、计划、审批和后台任务，而不是两套彼此割裂的会话。

## 一眼了解

| 你需要 | Kun 提供 |
| --- | --- |
| 构建、调试与发布软件 | Code 模式提供项目上下文、文件编辑、终端、Git / Worktree、Diff、测试和审查。 |
| 从需求走到可实现的设计 | 在同一 Code 任务中切换 Design 画布，沉淀原型、设计系统和 Design → Code 上下文。 |
| 写作、整理与处理日常任务 | Work 模式可编辑 Markdown，预览、引用和分析 PDF / Office 文档，分析电子表格，并从大纲创建演示文稿；Office 文件保持只读。 |
| 自动化重复流程 | Scheduled tasks、Loops、Hooks、MCP、Skills 与可安装扩展。 |
| 选择模型和接入方式 | 订阅、计划、API、OpenAI / Anthropic 兼容服务与自托管模型均可通过 Provider 配置接入。 |

## 当前界面

以下截图均通过浏览器自动化在一次性隔离的应用配置和演示工作区中重新采集。截图内没有真实项目、账户信息、个人设置或会话记录。

### Code：构建、调试与发布

Code 模式把项目、分支、Code / Design 任务入口和任务输入区放在同一工作台中。它适合阅读和修改代码、运行终端与测试、检查 Diff，以及在需要时进入 Design 画布继续完成方案。

<p align="center">
  <img src="./docs/assets/readme/code-mode-overview.webp" alt="Code 模式概览：演示项目、Code 和 Design 任务入口、分支与任务输入区">
</p>

### Work：写作、整理与日常任务

Work 模式用工作区文件树、任务启动器和 Work assistant 组织文档工作。可以起草 Markdown、总结或询问文档、分析电子表格、创建演示文稿，也可以用白板梳理想法。

<p align="center">
  <img src="./docs/assets/readme/work-mode-overview.webp" alt="Work 模式概览：演示文件树、文档任务启动器和 Work assistant">
</p>

## 从目标到验收

```text
澄清目标 → 形成计划 → 执行与协作 → 检查证据 → 交付或继续
```

1. **给出目标和约束。** Agent 结合项目内容补足范围、风险和验收标准。
2. **按计划逐步执行。** 根据任务范围推进文件修改、工具调用和验证；需求变化时及时调整计划。
3. **在可见的上下文中执行。** 计划、Todo、工具调用、文件改动、浏览器/终端结果和审批都关联到任务。
4. **以证据完成交付。** 回看 Diff、测试、审查和产物；需求变化后可以继续、分叉、归档或重新规划。

需求和计划默认可以保存在项目中，因此能进入版本控制、代码审查和后续恢复流程。

## 本地优先，不等于永不联网

会话、偏好、日志和运行时数据默认保存在本机。选择云端模型后，提示、附件和任务上下文会发送给所选 Provider；使用前请确认该服务的数据政策。工具权限、敏感操作和扩展权限会在界面中明确呈现，仍由你决定是否授权。

Kun 不绑定单一模型。预设覆盖 ChatGPT / Codex、Claude、Gemini、Cursor、Ollama、DeepSeek、Kimi、GLM、Qwen、MiniMax 和 Xiaomi MiMo 等生态；登录方式、模型、地区与额度取决于当前版本和 Provider 规则。请查看 [模型 Provider 文档](docs/model-provider-presets.md) 了解配置方式。

## 5 分钟开始

从 [GitHub Releases](https://github.com/KunAgent/Kun/releases) 下载当前版本：

| 平台 | 安装包 | 架构 |
| --- | --- | --- |
| macOS | `.dmg` / `.zip` | Apple Silicon / Intel |
| Windows | `.exe` | x64 |
| Linux | `.AppImage` / `.deb` | x64 |

启动后：

1. 选择语言并配置一个模型订阅、计划、API 或自定义 Provider。
2. 打开本地项目或创建工作区。
3. 发送一个目标明确、范围有限、可以验证的任务。

桌面版和 TUI 可同时连接同一个运行时。在项目目录中运行：

```bash
kun
```

从 0.3.8 起不再单独分发 TUI 压缩包；请使用桌面应用内置的终端命令，更多配置见 [Kun TUI 文档](docs/kun-tui.md)。

## 从源码运行

要求：Node.js 22.19+、npm，以及至少一个可用的模型连接。

```bash
git clone https://github.com/KunAgent/Kun.git
cd Kun
npm ci
npm run dev
```

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 构建运行时并启动 Electron 开发环境 |
| `npm run dev:tui` | 构建运行时并启动终端 TUI |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm run lint` | 运行 ESLint 与文件大小检查 |
| `npm run test` | 运行测试 |
| `npm run build` | 生产构建 |
| `npm run dist:mac` / `dist:win` / `dist:linux` | 构建对应平台安装包 |

中国大陆网络访问较慢时可使用 npm 镜像：

```bash
npm ci --registry=https://registry.npmmirror.com
```

## 文档与贡献

| 主题 | 文档 |
| --- | --- |
| TUI、命令和运行时 | [docs/kun-tui.md](docs/kun-tui.md) / [kun/README.zh-CN.md](kun/README.zh-CN.md) |
| Design 工作流 | [docs/DESIGN_MODE.md](docs/DESIGN_MODE.md) |
| Loops、MCP 与 Skills | [docs/workflow-loop.md](docs/workflow-loop.md) / [docs/project-mcp-skills.md](docs/project-mcp-skills.md) |
| Extension 平台 | [docs/extensions/README.md](docs/extensions/README.md) |
| 本地开发 | [docs/DEVELOPMENT.zh-CN.md](docs/DEVELOPMENT.zh-CN.md) |

欢迎贡献 bug 修复、UI/UX、运行时、Provider、扩展和文档。日常集成分支为 `develop`，PR 请以 `develop` 为目标分支；开始前阅读 [贡献指南](docs/CONTRIBUTING.zh-CN.md)，外部贡献需要接受 [CLA](./CLA.md)。

## 许可证

Kun 使用 [PolyForm Noncommercial License 1.0.0](./LICENSE)，仅供学习、研究和非商业用途。商业使用、商业分发、SaaS / 托管服务、转售或集成到商业产品中，需要获得作者的单独书面授权。

## 致谢

感谢所有提交 issue、建议、代码和文档的贡献者。

Kun 的记忆架构研究参考了 [Nowledge Mem](https://mem.nowledge.co/zh/docs) 公开文档中的 Thread / Memory 分离、来源追踪与混合检索理念；Kun 的实现保持独立，并遵循自身的单运行时和本地优先架构。

<a href="https://github.com/KunAgent/Kun/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=KunAgent/Kun" alt="Kun contributors">
</a>


## 🌐 Web Resources & Interactive Index
- [KABOOM MINER](https://theskillquest.pages.dev/kaboom-miner.html)
- [KITTY COUPLE LOVELY VALENTINE](https://iskillplay.web.app/kitty-couple-lovely-valentine.html)
- [GLACIER RUSH](https://quizverses.github.io/glacier-rush.html)
- [CATEGORY MOUSE1 697](https://studyquests.pages.dev/category-mouse1-697.html)
- [PARK ME DRAW PATH](https://themindplay.pages.dev/park-me-draw-path.html)
- [MATCH MASTER](https://studyquesthub.web.app/match-master.html)
- [COSMO PET STARRY CARE](https://themindplaying.web.app/cosmo-pet-starry-care.html)
- [UNTANGLE RINGS MASTER](https://studyplaying.github.io/untangle-rings-master.html)
- [CATEGORY STRATEGY](https://themindplay.pages.dev/category-strategy.html)
- [TEARDOWN DESTRUCTION SANDBOX](https://learnquester.pages.dev/teardown-destruction-sandbox.html)
- [WAR OF GUN](https://quizverses.github.io/war-of-gun.html)
- [CHILDREN HAPPY FARM DUDU](https://studyquests.github.io/children-happy-farm-dudu.html)
- [CATEGORY SANDBOX](https://learnquester.github.io/category-sandbox.html)
- [CATEGORY 204828](https://iskillquest.pages.dev/category-204828.html)
- [CATEGORY GUN238](https://learnquester.github.io/category-gun238.html)
- [GUN BUILDER](https://quizverses.pages.dev/gun-builder.html)
- [CATEGORY COOKING46](https://themindplays.pages.dev/category-cooking46.html)
- [CAPYBARA MUKBANG ASMR](https://studyquests.github.io/capybara-mukbang-asmr.html)
- [POP PARTY SUIKA WATERMELON](https://themindplay.pages.dev/pop-party-suika-watermelon.html)
- [TOWN RUN](https://themindplays.pages.dev/town-run.html)
- [CANDY MONSTER RAFFI](https://quizverses-9d2f2.web.app/candy-monster-raffi.html)
- [HARBOR OPERATOR](https://theskillquest.pages.dev/harbor-operator.html)
- [JIGSAW M](https://learnquesters.pages.dev/jigsaw-m.html)
- [PLANET MERGE](https://studyquesthub.web.app/planet-merge.html)
- [MERGE BRAINROT](https://studyquests.github.io/merge-brainrot.html)
- [PICK BRAINROT 3D BATTLE](https://quizverses.pages.dev/pick-brainrot-3d-battle.html)
- [BUBBLE RACE PARTY](https://learnquester.pages.dev/bubble-race-party.html)
- [CHIBI DOLL AVATAR CREATOR](https://themindplay.pages.dev/chibi-doll-avatar-creator.html)
- [FLOWER BLOCK](https://learnquester.github.io/flower-block.html)
- [HAWAII MATCH 6](https://studyplaying.github.io/hawaii-match-6.html)
- [DOGGO JUMP](https://theskillquest.pages.dev/doggo-jump.html)
- [TROPICAL CUBES 2048](https://studyplaying.github.io/tropical-cubes-2048.html)
- [SPACEFLIGHT SIMULATOR](https://themindplaying.web.app/spaceflight-simulator.html)
- [WORLD CUP 2026 SOCCER GAME](https://themindplay.github.io/world-cup-2026-soccer-game.html)
- [CATEGORY TANK](https://theskillquest.pages.dev/category-tank.html)
- [GOAL IO](https://themindplay.github.io/goal-io.html)
- [CATEGORY UNBLOCKED WEBSITES](https://theskillquest.pages.dev/category-unblocked-websites.html)
- [GIN RUMMY](https://theskillquest.pages.dev/gin-rummy.html)
- [CATEGORY SPACE57](https://theskillquest.pages.dev/category-space57.html)
- [CATEGORY DEEP IMMERSIVE24](https://thelearnquesters.pages.dev/category-deep-immersive24.html)
- [FARM TILES HARVEST](https://studyquests.github.io/farm-tiles-harvest.html)
- [TINY BAKER OCEAN JELLY CAKE](https://quizverses-9d2f2.web.app/tiny-baker-ocean-jelly-cake.html)
- [CATEGORY RUNNING](https://themindplay.pages.dev/category-running.html)
- [BUS PARKING OUT](https://quizverses.github.io/bus-parking-out.html)
- [HORROR ESCAPE GRANNY ROOM](https://themindplay.github.io/horror-escape-granny-room.html)
- [MARBLE RUN ULTIMATE RACE](https://themindplays.pages.dev/marble-run-ultimate-race.html)
- [HIT BALL](https://themindplay.pages.dev/hit-ball.html)
- [REAL DRIVE 3D](https://learnquester.github.io/real-drive-3d.html)
- [HUMAN EVOLUTION RUN](https://studyplayings.pages.dev/human-evolution-run.html)
- [ARROW CUBE ESCAPE](https://learnquester.github.io/arrow-cube-escape.html)
- [MINE JUMP](https://studyquests.pages.dev/mine-jump.html)
- [CATEGORY MINECRAFT 2](https://iskillquest.pages.dev/category-minecraft-2.html)
- [PIRATE ISLAND](https://learnquester.pages.dev/pirate-island.html)
- [CATEGORY RACING DRIVING](https://themindplay.pages.dev/category-racing-driving.html)
- [MAHJONG CLASSIC](https://studyquests.github.io/mahjong-classic.html)
- [CATEGORY TRIVIA COLLECTION](https://theskillquest.pages.dev/category-trivia-collection.html)
- [WOOL SORTING](https://theskillquest.pages.dev/wool-sorting.html)
- [ADDICTION SOLITAIRE](https://theskillquest.pages.dev/addiction-solitaire.html)
- [MERGE RUN BATTLE](https://studyplayings.pages.dev/merge-run-battle.html)
- [DINO HUNTER KING](https://studyplaying.github.io/dino-hunter-king.html)
- [CATEGORY CASUAL 7](https://thelearnquesters.pages.dev/category-casual-7.html)
- [WORDMIX](https://thelearnquester.web.app/wordmix.html)
- [CATEGORY BASKETBALL 3](https://studyquests.github.io/category-basketball-3.html)
- [BUS COLLECT](https://studyquests.github.io/bus-collect.html)
- [RADIANT RUSH](https://themindplay.github.io/radiant-rush.html)
- [BOXTERIA](https://studyquests.github.io/boxteria.html)
- [KICK THE NOOBIK 3D](https://studyplayings.web.app/kick-the-noobik-3d.html)
- [IDLE FACTORY DOMINATION](https://theskillquest.pages.dev/idle-factory-domination.html)
- [CATEGORY AGILITY 3](https://studyquests.github.io/category-agility-3.html)
- [BARK BLAST](https://themindplay.github.io/bark-blast.html)
- [RED STICKMAN VS CRAFTMANS](https://studyplaying.github.io/red-stickman-vs-craftmans.html)
- [METAL BAY TOP BLADE POWER](https://quizverses.github.io/metal-bay-top-blade-power.html)
- [SERIOUS BRO](https://quizverses.github.io/serious-bro.html)
- [ITILEZEN SORT PUZZLE](https://studyplayings.web.app/itilezen-sort-puzzle.html)
- [BOMBER BATTLE ARENA](https://theskillquest.pages.dev/bomber-battle-arena.html)
- [THE LAST TIGER TANK SIMULATOR](https://theskillquest.pages.dev/the-last-tiger-tank-simulator.html)
- [INDEX24](https://iskillquest.pages.dev/index24.html)
- [CATEGORY PUZZLE 3](https://iskillquest.pages.dev/category-puzzle-3.html)
- [CATEGORY PREMIUM PERKS74](https://studyquests.pages.dev/category-premium-perks74.html)
- [CATEGORY SNAKE](https://theskillquest.pages.dev/category-snake.html)
- [WATER SORT](https://theskillquest.pages.dev/water-sort.html)
- [TATTOO MASTER](https://thelearnquester.web.app/tattoo-master.html)
- [BRAINROT CLICK TO HATCH](https://studyplaying.github.io/brainrot-click-to-hatch.html)
- [MERGE FRUIT](https://studyplaying.github.io/merge-fruit.html)
- [CATEGORY SOLITAIRE](https://theskillquest.pages.dev/category-solitaire.html)
- [PAWS OFF MY CLUES](https://learnquesters.pages.dev/paws-off-my-clues.html)
- [BLOCKPUZZLE COLOR BLAST](https://studyplayings.pages.dev/blockpuzzle-color-blast.html)
- [POPS QUEST](https://studyplaying.github.io/pops-quest.html)
- [JUST LUDO](https://studyquests.github.io/just-ludo.html)
- [SUPERMARKET SORT GROCERY GAME](https://theskillquest.pages.dev/supermarket-sort-grocery-game.html)
- [MOJO MATCH 3D](https://learnquesters.pages.dev/mojo-match-3d.html)
- [ARROW WAVE](https://theskillquest.pages.dev/arrow-wave.html)
- [CATEGORY TOP DOWN251](https://theskillquest.pages.dev/category-top-down251.html)
- [SUMMER CONNECT](https://thelearnquester.web.app/summer-connect.html)
- [KAWAII FRIENDS TILES MATCHER](https://theskillquest.pages.dev/kawaii-friends-tiles-matcher.html)
- [MAHJONG TRIPLE 3D TILE MATCH](https://studyplaying.github.io/mahjong-triple-3d-tile-match.html)
- [SNIPER VS SNIPER](https://theskillquest.pages.dev/sniper-vs-sniper.html)
- [LIMITED KABOOM](https://studyplayings.pages.dev/limited-kaboom.html)
- [KNIFE MADNESS](https://theskillquest.pages.dev/knife-madness.html)
- [HITMAN SNIPER](https://themindplay.pages.dev/hitman-sniper.html)
- [CATEGORY THINKY 2](https://theskillquest.pages.dev/category-thinky-2.html)
- [SUPERMARKET SIMULATOR DREAM STORE](https://studyquests.pages.dev/supermarket-simulator-dream-store.html)
- [STYLISH NAIL ART](https://themindplay.github.io/stylish-nail-art.html)
- [STICKMAN ZOMBIE VS STICKMAN HERO](https://studyplaying.github.io/stickman-zombie-vs-stickman-hero.html)
- [BEACH SOCCER](https://theskillquest.pages.dev/beach-soccer.html)
- [GRASS LAND](https://studyplaying.github.io/grass-land.html)
- [CATEGORY SIMULATION 5](https://iskillquest.pages.dev/category-simulation-5.html)
- [BRAIN TEST IQ CHALLENGE 2](https://thelearnquester.web.app/brain-test-iq-challenge-2.html)
- [COLOR NUTS](https://theskillquest.pages.dev/color-nuts.html)
- [ROOM SORT FLOOR PLAN](https://studyquesthub.web.app/room-sort-floor-plan.html)
- [CATEGORY HORROR 2](https://learnquesters.pages.dev/category-horror-2.html)
- [DEVIL DUCK NOT A TROLL GAME](https://quizverses.github.io/devil-duck-not-a-troll-game.html)
- [BLUE MUSHROOM CAT RUN](https://theskillquest.pages.dev/blue-mushroom-cat-run.html)
- [COIN EMPIRE](https://themindplaying.web.app/coin-empire.html)
- [ANIMAL MERGE BUBBLE SHOOTER](https://themindplay.pages.dev/animal-merge-bubble-shooter.html)
- [STRIKE FORCE ACTION PLATFORMER](https://theskillquest.pages.dev/strike-force-action-platformer.html)
- [PYRAMIDZ2](https://learnquester.pages.dev/pyramidz2.html)
- [PIRATE ISLAND](https://theskillquest.pages.dev/pirate-island.html)
- [INDEX4](https://themindplay.pages.dev/index4.html)
- [CATEGORY SIMULATION 3](https://theskillquest.pages.dev/category-simulation-3.html)
- [WORD SEARCH](https://themindplays.pages.dev/word-search.html)
- [WOODEN BOLTS AND NUTS](https://theskillquest.pages.dev/wooden-bolts-and-nuts.html)
- [FOOD TOWER DEFENSE](https://thelearnquester.web.app/food-tower-defense.html)
- [MAGIC BEAUTY MAKEUP](https://quizverses.github.io/magic-beauty-makeup.html)
- [CATEGORY TOWER DEFENSE 3](https://theskillquest.pages.dev/category-tower-defense-3.html)
- [CATEGORY HORROR](https://iskillquest.pages.dev/category-horror.html)
- [OHPEACH IT](https://themindplay.pages.dev/ohpeach-it.html)
- [CATEGORY CARE](https://thelearnquesters.pages.dev/category-care.html)
- [THE BIG HIT RUN](https://thelearnquester.web.app/the-big-hit-run.html)
- [FRUIT CANDY MERGE](https://quizverses.github.io/fruit-candy-merge.html)
