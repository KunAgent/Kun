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
