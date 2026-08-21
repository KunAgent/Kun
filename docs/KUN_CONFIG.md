# Kun Agent 与模型配置说明

本文说明 Kun（桌面应用与运行时）的本地配置文件在哪里、哪些字段由 UI 管理、哪些字段适合手工扩展，以及模型上下文压缩阈值应该如何配置。

## 配置文件分层

Kun 有两层配置。

1. GUI settings

   这是桌面应用自己的设置文件，保存设置页里的 Agent 运行时选项。

   - macOS: `~/Library/Application Support/Kun/kun-settings.json`
   - Windows: `%APPDATA%/Kun/kun-settings.json`
   - Linux: `~/.config/Kun/kun-settings.json`

   Agent 运行时设置在 `agents.kun` 下，例如端口、data dir、默认模型、审批策略、sandbox、token economy 等。多数用户通过设置页修改这些字段。

   Service Manager 以该文件的内容 SHA-256 作为磁盘指纹，并在每次读取和 compare-and-swap 写入前重新核对。外部工具写入有效 JSON 后，GUI 会热加载新 revision；若 GUI 同时保存 patch，revision 冲突会基于最新有效 snapshot 重新合并一次。外部写入暂时无效的 JSON 时，GUI 不会用默认值覆盖文件，而是继续使用最后一份有效 snapshot，等待后续有效修改。Manager 自己提交的相同内容不会触发重复 revision 或热加载循环。

2. Kun runtime config

   这是 Kun 本地运行时读取的高级配置文件。默认路径是：

   ```text
   ~/.kun/data/config.json
   ```

   如果 `agents.kun.dataDir` 改成了别的目录，实际路径就是：

   ```text
   <dataDir>/config.json
   ```

   `kun serve --config <path>` 可以显式指定配置文件；如果没有指定，Kun 会尝试读取 `{dataDir}/config.json`。

## 启动时的读取顺序

GUI 启动 Kun 时会按下面的顺序合并配置。

1. GUI 读取 `kun-settings.json`（旧版 `deepseek-gui-settings.json` 会自动迁移），得到 `agents.kun` 和通用 provider 配置。
2. GUI 在启动 Kun 前同步 `<dataDir>/config.json`，写入 UI 管理的 token economy、默认压缩摘要参数、默认模型 profiles、runtime tuning、MCP search 和附件能力。
3. Kun serve 读取 `<dataDir>/config.json` 或 `--config` 指定的文件。
4. CLI 参数和环境变量会覆盖 `serve` 里的基础启动字段，例如 `--model`、`--port`、`KUN_MODEL`、`KUN_PORT`。
5. AgentLoop、review loop 和子 Agent 都从同一份模型配置加载模型能力与上下文压缩阈值。

## 从旧目录升级

旧版本可能把 GUI 管理的 Runtime 数据放在 `~/.deepseekgui/kun`。新版 GUI
取得单实例锁后、加载设置和启动 Runtime 前，会执行可恢复迁移：

- 如果设置仍选择旧目录，整份旧 Runtime 存储会以同卷原子改名迁到
  `~/.kun/data`，包括线程、事件、附件、凭据、索引和 `config.json`。
- 如果新目录已经有数据，它会先被改名为相邻的
  `data.pre-deepseekgui-migration-<timestamp>.bak`。其中不冲突的线程和身份
  数据会补入迁移后的存储；发生冲突的版本继续完整保留在备份中。
- 旧路径随后成为指向新目录的符号链接（macOS/Linux）或目录联接
  （Windows），仅用于旧版本兼容。当前 GUI 只使用新路径。
- 设置文件会先生成
  `kun-settings.json.pre-runtime-data-migration-<timestamp>.bak`，再把
  `agents.kun.dataDir` 改为 `~/.kun/data`。
- 迁移器与 GUI 使用完全相同的 settings 查找顺序；如果当前设置仍位于
  旧 Electron userData 目录，或 settings 文件是符号链接，会备份并改写
  实际生效的那一份，不会让旁边的过期设置抢占配置权威。
- 迁移前会检查是否仍有 Kun Runtime 进程使用旧目录。发现活跃写入者时
  会在任何目录改名前停止迁移；如果写入者恰好在切换窗口重新创建旧
  目录，该目录会完整保留为冲突备份，并回滚两个标准目录的名称。

迁移日志 `kun-runtime-data-migration-v2.json` 和报告
`kun-runtime-data-migration-v2-report.json` 位于上方列出的 GUI settings
目录。迁移可在下次启动续跑；如果遇到文件占用、权限、跨卷或链接创建
失败，GUI 会保留所有原目录和备份，并阻止 Runtime、配置同步、凭据迁移
及清理任务继续写旧目录。

迁移完成后，`~/.kun/data/config.json` 是唯一自动生效的 Runtime 配置。
当前 GUI 不会再发现、复制或回退读取独立的
`~/.deepseekgui/kun/config.json`。兼容链接下看到的同名文件只是新配置的
同一个文件。若真实旧目录在后续升级中再次出现，它会被隔离为
`kun.post-migration-<timestamp>.bak`，其中的配置不会覆盖新配置。用户
显式选择的自定义 `dataDir` 不参与这次标准目录迁移。
这也适用于迁移完成后的后续版本：用户后来改成自定义目录时，完成态
迁移日志不会再把它强制改回 `~/.kun/data`。若旧设置仍在但新旧目录都
不存在，则执行空存储切换并在新目录开始，不会永久阻止 Runtime 启动。

## 推荐的 config.json 结构

```json
{
  "serve": {
    "host": "127.0.0.1",
    "port": 18899,
    "dataDir": "~/.kun/data",
    "runtimeToken": "<local-access-token>",
    "apiKey": "",
    "baseUrl": "https://api.deepseek.com/beta",
    "model": "deepseek-v4-pro",
    "approvalPolicy": "auto",
    "sandboxMode": "workspace-write"
  },
  "models": {
    "profiles": {
      "deepseek-v4-pro": {
        "contextWindowTokens": 1000000,
        "contextCompaction": {
          "softThreshold": 980000,
          "hardThreshold": 990000
        },
        "inputModalities": ["text"],
        "outputModalities": ["text"],
        "supportsToolCalling": true,
        "messageParts": ["text"]
      }
    }
  },
  "contextCompaction": {
    "defaultSoftThreshold": 96000,
    "defaultHardThreshold": 108800,
    "summaryMode": "model",
    "summaryTimeoutMs": 15000,
    "summaryMaxTokens": 2048,
    "summaryInputMaxBytes": 98304
  },
  "runtime": {
    "streamIdleTimeoutMs": 450000,
    "toolStorm": { "enabled": true },
    "toolArgumentRepair": { "maxStringBytes": 524288 }
  }
}
```

GUI 管理的运行时会在 `runtimeToken` 为空时自动生成并保存本地访问令牌。

## 模型配置写在哪里

模型相关配置写在顶层 `models.profiles`。

每个 key 是模型 ID。模型 ID 会按小写匹配，也支持 provider 前缀，例如请求模型是 `vendor/deepseek-v4-pro` 时，也可以匹配 `deepseek-v4-pro`。

```json
{
  "models": {
    "profiles": {
      "my-128k-model": {
        "aliases": ["vendor/my-128k-model"],
        "contextWindowTokens": 128000,
        "contextCompaction": {
          "softRatio": 0.85,
          "hardRatio": 0.93
        },
        "inputModalities": ["text"],
        "outputModalities": ["text"],
        "supportsToolCalling": true,
        "messageParts": ["text"]
      }
    }
  }
}
```

可用字段：

- `aliases`: 这个 profile 还要匹配的模型别名。
- `contextWindowTokens`: 模型上下文窗口大小。
- `contextCompaction.softThreshold`: 达到多少 input tokens 后开始压缩。
- `contextCompaction.hardThreshold`: 达到多少 input tokens 后强制更激进压缩。
- `contextCompaction.softRatio`: 按 `contextWindowTokens` 比例计算 soft threshold。
- `contextCompaction.hardRatio`: 按 `contextWindowTokens` 比例计算 hard threshold。
- `inputModalities`: 输入模态，目前常用 `["text"]` 或 `["text", "image"]`。
- `outputModalities`: 输出模态，通常是 `["text"]`。
- `supportsToolCalling`: 模型是否支持 tool calling。
- `messageParts`: 模型消息 part 能力，例如 `["text"]` 或 `["text", "image_url"]`。

如果同时写了 `softThreshold` 和 `softRatio`，显式 token 阈值优先。`hardThreshold` 必须大于或等于 `softThreshold`。

## 默认模型 profile

Kun 内置 DeepSeek V4 默认模型画像：

```json
{
  "models": {
    "profiles": {
      "deepseek-v4-pro": {
        "contextWindowTokens": 1000000,
        "contextCompaction": {
          "softThreshold": 980000,
          "hardThreshold": 990000
        },
        "inputModalities": ["text"],
        "outputModalities": ["text"],
        "supportsToolCalling": true,
        "messageParts": ["text"]
      },
      "deepseek-v4-flash": {
        "aliases": ["deepseek-chat", "deepseek-reasoner"],
        "contextWindowTokens": 1000000,
        "contextCompaction": {
          "softThreshold": 980000,
          "hardThreshold": 990000
        },
        "inputModalities": ["text"],
        "outputModalities": ["text"],
        "supportsToolCalling": true,
        "messageParts": ["text"]
      }
    }
  }
}
```

也就是说，V4 是 1M 上下文，正常情况下接近 `980k` input tokens 才触发上下文压缩；接近 `990k` 时进入更强的压缩策略。

## 全局压缩配置写在哪里

全局压缩配置写在顶层 `contextCompaction`。它只负责“不知道具体模型 profile 时的兜底阈值”和“摘要行为”，不要再把模型窗口大小写在这里。

```json
{
  "contextCompaction": {
    "defaultSoftThreshold": 96000,
    "defaultHardThreshold": 108800,
    "summaryMode": "model",
    "summaryTimeoutMs": 15000,
    "summaryMaxTokens": 2048,
    "summaryInputMaxBytes": 98304
  }
}
```

字段说明：

- `defaultSoftThreshold`: 未匹配到模型 profile 时，达到多少 input tokens 开始压缩。
- `defaultHardThreshold`: 未匹配到模型 profile 时，达到多少 input tokens 强制压缩。
- `summaryMode`: GUI 管理的配置默认并归一为 `model`。手工维护 `config.json`
  时仍可显式写 `heuristic` 使用本地摘要骨架；`model` 模式下模型摘要失败、
  超时或返回空文本时会自动降级为本地摘要骨架。
- `summaryTimeoutMs`: 模型摘要调用超时时间。
- `summaryMaxTokens`: 模型摘要输出 token 上限。
- `summaryInputMaxBytes`: 摘要输入文本最大字节数。

## Agent 配置写在哪里

普通 Agent 运行时配置由 GUI settings 的 `agents.kun` 管理。主要字段：

```json
{
  "agents": {
    "kun": {
      "binaryPath": "",
      "port": 18899,
      "autoStart": true,
      "dataDir": "~/.kun/data",
      "model": "deepseek-v4-pro",
      "approvalPolicy": "auto",
      "sandboxMode": "workspace-write",
      "tokenEconomyMode": false,
      "insecure": false
    }
  }
}
```

设置页会保存这些字段。GUI 模式下默认模型以 `agents.kun.model` 为准；`config.json` 里的 `serve.model` 更适合 standalone `kun serve` 使用，因为 GUI 启动时会把设置页里的模型作为启动参数传给 Kun。

## Hooks 配置写在哪里

Hooks 写在 `config.json` 顶层的 `hooks` 数组里，GUI 启动 Kun 时通过
`--data-dir` 自动加载，无需额外开关：

```json
{
  "hooks": [
    {
      "phase": "PreToolUse",
      "matcher": "bash|write_file|mcp__*",
      "command": "node ~/.kun-hooks/guard.js",
      "timeoutMs": 10000
    },
    { "phase": "UserPromptSubmit", "command": "~/.kun-hooks/prompt-context.sh" }
  ]
}
```

支持的 `phase`：`PreToolUse`、`PostToolUse`（工具调用前后，可改写参数 /
输出、拒绝或自动放行）、`UserPromptSubmit`（回合开始前，可拒绝或注入
上下文）、`TurnStart`、`TurnEnd`、`PreCompact`（只读通知）。命令通过
stdin 收到 JSON invocation，退出码 `0` + stdout JSON 返回结构化结果，
退出码 `2` 阻断动作，其余非零只产生 `hook_warning` 事件。完整参考
（各阶段载荷、失败语义、示例脚本）见 [kun-hooks.md](kun-hooks.md)。

## 用户如何自定义

常见做法：

1. 在设置页修改端口、data dir、默认模型、审批策略、sandbox 和 token economy。
2. 打开 `<dataDir>/config.json`，在 `models.profiles` 里增加或覆盖模型 profile。
3. 如果要把自定义模型作为 GUI 默认模型，把 `agents.kun.model` 改成该模型 ID。
4. 重启 Kun runtime，让新配置生效。

自定义 1M 模型并在 950k 左右开始压缩：

```json
{
  "models": {
    "profiles": {
      "vendor/my-1m-model": {
        "aliases": ["my-1m-model"],
        "contextWindowTokens": 1000000,
        "contextCompaction": {
          "softThreshold": 950000,
          "hardThreshold": 980000
        },
        "inputModalities": ["text"],
        "outputModalities": ["text"],
        "supportsToolCalling": true,
        "messageParts": ["text"]
      }
    }
  }
}
```

自定义图片输入模型：

```json
{
  "models": {
    "profiles": {
      "vision-model": {
        "contextWindowTokens": 128000,
        "contextCompaction": {
          "softRatio": 0.75,
          "hardRatio": 0.9
        },
        "inputModalities": ["text", "image"],
        "outputModalities": ["text"],
        "supportsToolCalling": true,
        "messageParts": ["text", "image_url"]
      }
    }
  }
}
```

## 兼容旧配置

旧版本曾支持把模型 profile 写在：

```json
{
  "contextCompaction": {
    "modelProfiles": {}
  }
}
```

这个位置仍然会被读取，以免已有用户配置失效。但新配置请使用：

```json
{
  "models": {
    "profiles": {}
  }
}
```

当两个位置都写了同一个模型时，`models.profiles` 的配置优先。

## 相关源码

- 默认 GUI Agent 设置：`src/shared/app-settings-kun.ts`
- GUI 同步 `<dataDir>/config.json`：`src/main/kun-process.ts`
- Kun config schema：`kun/src/config/kun-config.ts`
- 模型 profile 解析：`kun/src/loop/model-context-profile.ts`
- 上下文压缩器：`kun/src/loop/context-compactor.ts`
- serve 解析入口：`kun/src/cli/serve.ts`
- 示例配置：`kun/config.example.json`
