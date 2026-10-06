# 原生 Agent 模型目录与图片能力

## 问题与原因

原生登录的模型来源是对应 Agent 的 CLI，而非 Kun 供应商配置。2026-09-30 本机只读对照发现：
PATH 中优先命中的 Codex 0.145.0 返回 4 个模型；已安装官方应用附带的 0.159.2 返回 8 个，
8 个均明确声明 `inputModalities: ["text", "image"]`。这是当时该账号和 CLI 返回的结果，
不是产品内置的固定模型数量，也不代表所有外部 Agent 都支持图片。

另有两处应用缺陷：模型探测把完整结果压成字符串 ID，菜单把缺失能力当成仅文本；
Kun 供应商目录刷新会覆盖外部 Agent 的草稿模型，因此 Codex 入口下可能仍显示 Kun 的模型名。

## Cindy / Orca 参考

| 本地项目代码 | 采用的原则 |
| --- | --- |
| Cindy `apps/desktop/src/main/maker-host/codex-model-discovery.ts` | 保留原生输入模态；未知能力不伪装为文本；缓存必须属于实际账号环境 |
| Cindy `apps/desktop/src/main/maker-host/codex-model-backfill.ts` | 登录和目录加载是异步过程，目录不能在首次空结果后永久不更新 |
| Cindy `packages/maker-core/src/agents/codex/index.ts` | 通过原生 app-server 分页读取完整模型目录 |
| Orca `src/main/codex/codex-structured-model-catalog.ts` | 分页、过滤隐藏模型、去重、保留顺序，并读取原生配置中的默认模型 |
| Orca `src/main/codex/codex-model-catalog-probe.ts` / `codex-structured-launch-resolution.ts` | 探测与会话采用一致的启动程序和账号环境 |
| Orca `src/main/codex-cli/codex-read-only-app-server-args.ts` | 模型元数据探测关闭插件，使用只读 sandbox，不启动付费推理轮次 |

Kun 本轮没有直接读取其他应用的账号缓存，也没有复制登录凭据。Cindy 更完整的账号刷新机制
不等同于本轮全部实现；当前以原生 RPC、账号目录/配置文件身份和缓存期限保证目录归属与刷新。

## 实现契约

- 兼容保留 `models: string[]`，新增可选 `modelInfo`，传递显示名、说明、默认模型、输入模态和推理档位。
- Codex `model/list` 每页 100 条，最多 20 页；重复游标报错，按原生 `model` 值去重，过滤隐藏模型和内部审核模型。
- `config/read` 只提取默认模型。显式配置但未列出的模型仍可保留，其能力保持未知，不猜测识图能力。
- 自动发现模式在 macOS 对比 PATH 原生二进制与已安装官方应用 CLI，使用可识别版本中较新的一份。
  显式路径和自定义包装脚本优先；不安装或升级用户全局 CLI。其他平台继续采用 PATH。
- 检测、模型探测和实际会话使用同一个解析器，进程池按实际可执行路径区分。
- 后端缓存区分可执行路径、启动参数、网络身份与 Codex 账号目录；auth/config 文件身份变化使旧缓存失效。
  成功目录缓存 10 分钟，失败 30 秒。前端目录缓存 60 秒，重新打开 Agent 入口可触发过期刷新。
- 模型菜单与图片附件判断使用同一份原生输入模态。只有明确声明文本且不含图片时显示“文本”；未知则不显示能力标签。
- 原生登录与 Kun 供应商目录分别维护选择，Kun 目录刷新不覆盖外部 Agent 的模型和推理档位。

## 验证方式

定向测试覆盖自动 CLI 选择、显式路径和包装脚本优先、原生分页、配置默认值、元数据传递、
菜单标签、图片附件能力和模型刷新隔离。真实本机只读探测确认新解析器拿到 8 个图片模型，
默认值为 `gpt-6.1-sol`；不把元数据探测视为实际图片推理成功。

桌面回归通过 `node scripts/smoke-development-ade.cjs --compiled-renderer --native-model-only
--locale zh --scale 2 --evidence dist/native-model-catalog-zh-smoke` 运行。该夹具使用两页模型目录，
经过真实 Electron、preload、Main、Kun 与本机 RPC 子进程，验证默认值、八条识图标签和选择保持。
它与真实账号的只读目录验证相互补充，不替代付费推理或跨平台打包验证。

## 推理档位、权限与 OpenCode 启动（2026-10-06）

- 推理档位按模型进入目录 `reasoningEfforts`，输入框只提供 Kun 有同名档位的级别（low/medium/high/max）加“自动”：
  - Codex：原样保留 `supportedReasoningEfforts`；`xhigh`/`ultra` 暂无 Kun 档位，不显示。
    `auto`/`off` 不发送 `effort`，沿用 Codex 配置或模型默认值。
  - Claude Code：`supportedModels()` 的 `supportedEffortLevels` 映射为 Kun 档位，`supportsEffort: false` 表示无档位。
    目录保留 `default` 行指向的推荐模型、显示名、说明和原生顺序，推荐模型排第一并标记为默认。
  - OpenCode：旧版把每个推理档位列成 `<model>/<variant>` 模型。目录把这些变体折叠回基础模型，
    每轮按所选档位通过 `session/set_model` 选中对应变体（`acpLegacyVariantModel`）。
    没有变体、也没有 `thought_level` 选项的模型档位为空，不显示推理控件。
- 用户没有为某个外部 Agent 模型选过档位时默认“自动”，即交给 Agent 自己的默认值，不套用 Kun 的 `max`。
- 权限：Codex 运行时不读取原生模式 id，按 Kun 权限档设置 sandbox（询问、代我审批 → workspace-write；
  完全访问 → danger-full-access），每个请求都经过 Kun 审批（`approvalPolicy: untrusted`）。
  Claude Code 由权限档映射为 default/bypassPermissions。两者的“默认权限档”设置不生效，
  Agent 中心改为说明跟随输入框权限，输入框预览显示实际运行方式。
- ACP 初始化和就绪检查上限为 60 秒，覆盖 OpenCode 首次运行约 32 秒的初始化。
  启动阶段崩溃不重试；错误文本去除终端颜色控制符。
- 续接绑定保存失败会写调试日志；Codex 跟进轮次复用原生线程有 `SessionTurnRuntime` 级回归测试。
