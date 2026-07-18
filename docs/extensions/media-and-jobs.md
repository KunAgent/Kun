# 扩展媒体与后台任务

> English: [Extension media and background jobs](./media-and-jobs.en.md)

Extension API v1.1 建立了 Host 代理的本地媒体与持久后台 Job 基线。Extension API
v1.2.0 继续加入有界文本/OTIO、调度提示、真实本地音视频分析和原子 ZIP
归档。扩展必须先协商到对应 API 与能力，不能因为类型已存在就假设旧 Host 会执行它们。

这些 API 面向视频、音频、图像序列、分析与渲染类扩展，避免通过 JSON IPC 搬运大文件，
也不向扩展暴露本地路径、原生进程或通用后台 worker。

## 权限模型

只声明实际需要的权限：

| 权限 | 能力 |
| --- | --- |
| `media.read` | 读取 Host 已授权的不透明媒体 handle，包括 `stat`、`readText` 与 View lease |
| `media.process` | 查询媒体能力、分配 disposable cache target、使用有界 FFmpeg/音频/视觉分析 broker |
| `media.export` | 选择并写入 Host 已授权的导出目标，包括归档输出 |
| `jobs.manage` | 观察和取消本扩展拥有的 Job |
| `workspace.read` / `workspace.write` | 还必须与对应读取、处理、导出能力配套授予 |

FFmpeg Job 需要 `media.read`、`media.process`、`media.export`、`jobs.manage`、
`workspace.read` 与 `workspace.write`。音频分析不写输出，只需要前四项中的读取、处理、
Job 管理以及 `workspace.read`。归档读取输入并写输出，需要 `media.read`、`media.export`、
`jobs.manage`、`workspace.read` 与 `workspace.write`。调用时仍会按具体方法重新鉴权。

每次调用都会检查当前扩展、必要时的精确版本、workspace、信任、权限、owner 和文件身份。
Handle 不是环境文件系统权限。可信 Node 扩展仍属于可信原生代码；这些 broker 不会把任意
扩展代码变成操作系统沙箱。

## 受保护选择

`context.media.pickFiles()` 和 `pickSaveTarget()` 只打开 Main 拥有的对话框。扩展提供的是
有界显示过滤器和建议名称，不是路径或授权。取消不会创建 handle、目标文件或半成品。
成功响应只含带不透明 `handleId` 的 `MediaMetadata`，不含绝对路径。

Picker 需要交互式桌面 View。Headless 工具应返回 interaction-required 检查点，提示用户
打开编辑器；不能自行弹窗、选择默认路径或伪造授权。

## 元数据、有界文本与播放

`media.stat()` 返回有界元数据。`media.probe()` 使用固定 ffprobe JSON profile，返回归一化
container/stream 字段，不返回可执行文件路径、源路径、环境或原始日志。

`media.readText()` 通过可读 handle 读取严格 UTF-8。v1.2 待发布上限和默认值均为 2 MiB，
调用者可以用更小的 `maxBytes` 收紧读取；文件声明大小或实际字节超过上限、或不是合法
UTF-8 时会显式失败。它适用于 SRT/VTT、JSON 与 OTIO 等有界文档，不会返回路径，也不会
自动解析或信任文档中的媒体引用。

沙箱 View 通过 `media.openViewResource()` 把可读 handle 换成短期 `kun-media://` URL。
该 URL 绑定扩展、精确 View Session、contribution、sender 主 frame、workspace 和文件身份。
不得持久化 URL；应持久化 handle 或 artifact 引用，重开后重新申请 lease。

Chromium 播放支持 `HEAD`、完整 `GET` 和单个有界 byte Range。Host 以背压方式流式读取。
复制的 URL、多 Range、过期 session/lease、替换后的文件和其他 sender 都会被拒绝。View
CSP 只为媒体允许 `kun-media:`，仍保持 `connect-src 'none'`、context isolation、sandbox、
导航限制和 Node integration 关闭。

不再使用时调用 `media.release()`。Disable、update、rollback、uninstall、权限或 workspace
变化、View 关闭/崩溃、到期和文件替换也会撤销相关资源。

## 能力协商与缓存目标

先调用 `media.getCapabilities()`，再展示 codec、filter、muxer 或分析操作。能力快照只包含
FFmpeg/ffprobe 是否可用、脱敏版本和 allowlist feature，例如 H.264/H.265、ProRes/FFV1、
AAC/FLAC/PCM、字幕/色彩 filter 与常用 muxer；它不返回 executable path。缺少某项能力时，
应给出可执行 fallback 或禁用状态，不能静默换 codec、忽略 effect，或把技术成功称为视觉验证。

`media.createCacheTarget({ format, purpose })` 分配 Host 拥有的 disposable 输出授权，适合
waveform、thumbnail、filmstrip、proxy、proof 与 preview。扩展选择有界格式和 purpose，
不选择路径，也不需要为了 cache 申请 `media.export`。项目 state 应保存不透明派生 ID、依赖和
provenance，而不是 cache path；清理、配额、pin、LRU 与失效由显式策略处理。

## FFmpeg broker、调度与文本输出

`media.startFfmpegJob()` 接收参数数组和具名 handle 绑定。资源占位符必须独占一个参数：

```ts
const { job } = await context.media.startFfmpegJob({
  arguments: [
    '-i', '{{input:source}}',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '{{output:video}}'
  ],
  inputs: { source: inputHandleId },
  outputs: { video: exportTargetHandleId },
  textOutputs: {
    captions: {
      handleId: subtitleTargetHandleId,
      mimeType: 'application/x-subrip',
      content: generatedSrt
    }
  },
  scheduling: {
    priority: 'export',
    maxAttempts: 1,
    retryBaseDelayMs: 250
  },
  idempotencyKey: `project-${projectId}-revision-${revision}`
})
```

Host 仅在最终 spawn 边界替换规范路径。Shell 语法、原始路径、URL、协议、设备、response
file、可执行文件覆盖、会加载路径的 filter 和 Host 保留选项都会被拒绝。Kun 只使用配置或
清理后 PATH 中的程序，采用 `shell: false`、最小环境、有界日志与进度、同目录 staging、
字节/时间配额、进程树取消、输出后验证和原子提升。

可选 `scheduling` 只有提示语义，Host 始终掌握并发和执行器。优先级从低到高是
`background`、`user`、`interactive`、`export`；同优先级按 FIFO 入队。`maxAttempts` 限制为
1–3，默认 1；只有 Kun 明确分类为 transient、且前一尝试已经完整回滚的失败才会按有界
backoff 重试。普通 encode/validation 失败、取消和 unknown side effect 不会自动重试。
Idempotency 会绑定完整规范请求，而不是只绑定调用者提供的友好 key；更改 handle、参数、
metadata、revision 或调度策略后不能别名到旧 Job。

`textOutputs` 是与媒体输出属于同一事务的有界 UTF-8 sidecar 映射。SRT/VTT 单项最多
192 KiB；v1.2 还接受 `application/x-otio+json`，并把全部文本输出总量限制为 2 MiB。
OTIO 必须是有界合法 JSON，root 为受支持的 `SerializableCollection.1` 或 `Timeline.1`，
其中 `target_url` 只能使用有界不透明 `kun-media://` 引用。没有 FFmpeg input/output/argument
时可以执行纯文本 Job；文本从不进入原生命令行。所有声明输出一起 staging、校验、提升、
消费或回滚，避免只发布一半。

Kun 不在每个 `.kunx` 内捆绑 FFmpeg。请安装兼容的 Host FFmpeg，或使用应用管理的
override。缺失原生工具时仍可编辑项目，但 probe、渲染和需要解码的分析会返回明确的
unavailable 状态。

## 持久 Job、取消与重启

只有 core capability 能创建 Job；扩展不能注册任意 worker。使用 `jobs.get()`、
`jobs.list()`、`jobs.subscribe()` 和 `jobs.cancel()`。Snapshot 与单调事件会跨 renderer/runtime
重启持久化。订阅先从 cursor 重放，再交付 live event；若 `replayGap` 为 true，应先用响应中的
snapshot 替换本地状态。

取消是幂等的，已完成 Job 保持原终态。排队或 retry backoff 中的 Job 可在启动原生进程前
取消；运行中的取消会等待进程树退出、staging 删除和 reservation 释放，再形成终态。终态
fence 会拒绝晚到进度或输出。

Kun 重启时，结果未知的 FFmpeg、音频分析或归档尝试会恢复为 `interrupted`，并回滚不完整
staging；已经经过 durable terminal commit 的输出保持完成。调用者应检查项目 revision、输入
identity 与目标后，使用明确的新尝试或同一规范 idempotent 请求，不能假设半成品可续跑。

## 真实本地音频分析

`media.getAudioAnalysisCapabilities()` 分别报告 `silence`、`beat-grid` 与 `sync-features`。
`media.startAudioAnalysisJob()` 只接受有界算法参数和不透明输入 handle，结果通过普通 Jobs API
观察与取消，结果中保留 source fingerprint、算法版本、`local: true` 和
`networkUsed: false`：

- `silence` 使用固定 `silencedetect` profile，输出带阈值 provenance 的有界区间。
- `beat-grid` 把授权媒体解码为有界 mono PCM，以 onset/autocorrelation 计算保守 beat/downbeat
  证据；弱或恒定信号返回空 markers，不伪造节拍。
- `sync-features` 为两个不同 handle 提取有界 PCM energy envelope；扩展可以用固定 seed、
  confidence threshold 和 preview 规划同步，但低置信度必须拒绝自动应用。

这些 Job 不上传音频，也不接受命令、filter、path 或 URL。缺少 FFmpeg/PCM primitive 时会返回
`AUDIO_ANALYSIS_EXECUTABLE_UNAVAILABLE` 或 `AUDIO_ANALYSIS_ALGORITHM_UNAVAILABLE`，并给出
remediation；不会隐式改用 cloud 服务。

## 真实本地视觉分析

v1.2 待发布的视觉 surface 是 opt-in、可验证且有意受限的：

- `media.getVisualModelStatus()` 返回 immutable adapter/model/package identity 和安装状态；
  `media.installVisualModel()` 只安装经 digest、签名与 receipt 校验的 Kun 管理包。当前实现复制
  bundled 的小型算法描述包，因此 receipt 的 `packageSource` 是 `bundled`、
  `downloadVerified` 是 `false`；它不会声称发生过下载。
- `media.analyzeVisualFrames()` 只处理最多 16 个有界时间段。Host 用固定 profile 从真实授权媒体
  解码 32×32 RGB frame，生成 24 维可解释色彩、亮度、饱和度、对比度和边缘特征，并返回
  source fingerprint 与算法 provenance；它不是随机 hash，也不伪装成神经语义 embedding。
- `media.embedVisualQuery()` 只接受受文档约束的颜色、明暗、冷暖、对比度和细节概念，并标明
  `uncalibrated-cosine`。人物、物体、动作或任意自然语言查询会返回
  `VISUAL_QUERY_UNSUPPORTED`，应改用文件名或 transcript search。

分析和 query 是支持 `AbortSignal` 的有界 Host request，不是可由扩展注册的通用 worker。
扩展若建立 moment index，必须自行持久化 immutable sample/adapter/source fingerprint、进度和
完整性，在取消、模型 identity 变化或源文件替换后丢弃不匹配记录。Inference 始终本地运行，
不接收 URL，不暴露 raw path，也不使用网络。

## OTIO 导入与导出

OTIO 导出使用 Host 授权 save target 和 `application/x-otio+json` 纯文本 durable Job，因而享受
与媒体输出相同的原子提升、取消和重启 fencing。扩展应在提交前生成 stable ID/timecode mapping
和有界 loss manifest；格式无法表达 nest、effect、caption 或 keyframe 时不得宣称无损 round trip。

导入先由用户选择文档，再用 `media.readText({ handleId, maxBytes })` 读取最多 2 MiB 严格
UTF-8。`readText` 不是任意文件系统入口，也不解析外部 media URL。扩展必须再次验证 OTIO
schema、深度、节点数、time range 与 opaque reference，展示 import preview/loss，再以显式确认
创建新项目；缺失媒体通过受保护 picker/relink 解决，不能从文档中的本地路径自动授权。

## 原子归档 Job

`media.startArchiveJob()` 创建 core-owned deterministic ZIP Job。请求包含 Host 授权的 output
handle，以及最多 512 个具唯一规范 POSIX 相对路径的 entry。Entry 可以引用可读 media handle，
也可以包含 `application/json`、OTIO JSON、Markdown 或纯文本；全部 inline UTF-8 总量最多
2 MiB。绝对路径、反斜线、`.`/`..`、重复路径、输入/输出别名和未授权 handle 会在写入前拒绝。

Host 以固定 ZIP 时间和稳定 entry 顺序写入私有 staging，校验大小、entry、SHA-256 和输出
identity 后才原子提升。成功结果返回新的可读 `generatedMedia` handle、entry/input/archive bytes
与 digest，不返回路径。取消和非终态重启会回滚 staging、backup 与 output reservation；已经
durable 完成的归档会在恢复时提交其终态。

## Provider-neutral generation 边界

Media API 不提供任意 Provider URL、credential、上传或通用远程 worker。Kun Video Editor 的
生成/放大控制面是可替换的 provider adapter，且编辑核心在没有 Provider 时完整可用：

- Catalog 只公开 provider/model identity、image/video/audio/upscale capability、reference limit、
  privacy policy 和 cost range，不含 secret 或 endpoint。
- 远程/BYOK 操作必须分别确认 provider permission、媒体上传和费用上限；UI checkbox 只是意图，
  真正 authority 是 Host 对 owner、完整 request digest、quote、permission、upload asset、金额和
  expiry 绑定的一次性 receipt。
- 在 dispatch 前先持久化带 prompt/model/reference lineage、idempotency 与 placeholder 的记录；
  取消、失败、restart 与多个 variant 都保留明确状态，输出还要重新验证为 owned opaque handle。
- 没有受许可 Provider 或不支持约束时返回 `unavailable`，不创建假 asset、不自动上传、不偷偷
  fallback；编辑与导出继续可用。当前 bundled 示例在没有注入已批准 broker 时就是该状态。

第三方远程 adapter 仍须使用公开 Network/Account/Provider 权限和受保护授权流程；不得把 token
写入 project、Webview、Job metadata 或日志，也不得借 `media.startFfmpegJob()` 绕过网络策略。

## 生成制品

成功 FFmpeg broker Job 发布顶层 `generatedArtifacts`。Artifact 包含持久不透明身份、owner/workspace、
媒体 handle、完成身份、MIME/大小、可用性以及 Job/调用来源，不包含本地路径或 lease URL。
工具结果只能引用调用者拥有且已完成的 artifact；Kun 会在写入历史前再次验证。缺失、替换或
撤销后的文件明确投影为 `unavailable`。

Result-preview View 只收到 artifact 和 media-handle 引用，再申请新的 View lease，而不是读取
路径或 data URL。视频、音频和图片使用新 lease 预览；SRT/VTT/OTIO 等非播放器制品可由交互式
View 调用 `media.performArtifactAction({ artifactId, action: 'open' | 'reveal' })`。Main 从已认证
View Session 派生 owner、精确扩展版本和 workspace，重新校验后执行桌面动作，绝不向 View
返回路径。Headless、过期或跨扩展/跨 workspace 调用会失败关闭。

## 排错

- `MEDIA_INTERACTION_REQUIRED`：打开桌面 View 并完成受保护 picker。
- `MEDIA_PERMISSION_DENIED`：同时检查媒体权限和配套 workspace grant。
- `MEDIA_HANDLE_REVOKED` / `MEDIA_NOT_FOUND`：重新选择源或恢复缺失导出。
- `MEDIA_EXECUTABLE_UNAVAILABLE`：检查 Host FFmpeg/ffprobe 或配置的 override，以及请求的
  codec/filter/muxer feature。
- `MEDIA_INVALID_ARGUMENT` / `MEDIA_INVALID_OUTPUT`：检查具名 handle 占位符、OTIO schema、
  archive 相对路径、output MIME 与输入/输出别名。
- `MEDIA_LIMIT_EXCEEDED`：降低文本、entry、输出、frame sample 或并发规模。
- `AUDIO_ANALYSIS_*_UNAVAILABLE`：按 capability remediation 安装兼容 FFmpeg；不会自动上云。
- `VISUAL_MODEL_MISSING` / `VISUAL_MODEL_UNVERIFIED`：通过 Kun 重新安装并验证包，随后重建 index。
- `VISUAL_QUERY_UNSUPPORTED`：缩小到受支持的可解释视觉概念，或改用文件名/transcript search。
- Job `interrupted`：检查 project revision、source identity 和目标后显式发起安全的新尝试。
- 视频无法 seek：申请新 lease，并确认文件未被替换；不要复用过期 URL。

日志和诊断会刻意隐藏绝对路径、可复用 lease、provider secret、环境、完整 prompt 和完整原生
命令行。发布故障报告前仍应人工检查业务 metadata。

## 分发、隐私与清理审查

- 首方示例源码使用随包 MIT 许可证；它不复制或分发 FFmpeg、codec、模型权重、素材库或
  第三方视频。以后若捆绑 FFmpeg 或模型，必须另做目标平台、codec、模型来源和许可证审查。
- Probe、文本/转录导入、时间线编辑、音频/视觉分析、归档和渲染默认在本地完成；不会隐式
  启用 cloud ASR/生成服务，也不会在 project state 中复制 provider secret。
- 输入 handle 只读；输入/输出 alias 检查和同目录 staging 防止改写源视频。项目操作保存
  source range，而不是修改源文件字节。
- 失败、取消、超配额或中断的处理会删除 staging 并释放 reservation。已完成导出、归档和
  项目属于用户数据，卸载扩展不会删除；派生 cache 由显式清理流程管理。
- Audit 只记录不透明 handle/job/artifact identity、有界 provenance 与结果，不记录受保护路径、
  operation token、lease、Provider credential、环境、完整 prompt 或无界原生输出。
- Node 扩展仍可在现有高风险信任披露下导入 `fs` 或 `child_process`。应优先使用 broker 获得
  最小权限，但不能把它描述成任意扩展代码的操作系统沙箱。
