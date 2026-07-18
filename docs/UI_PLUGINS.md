# UI 插件开发指南(形象工坊)

Kun 的「形象工坊」允许任何人制作并安装自己的视觉形象包:既可以替换工作台里的
泳动小鸟、欢迎/睡觉/坐着等状态形象,也可以给应用主体、侧边栏和主舞台换上主题背景,
再配合主题 token 与进行中文案完成一套皮肤。v1.5 起可以把一张完整人物立绘放进
Kun 会话舞台;v1.6 的 `scene` 进一步提供左右导轨、卡片、背景式构图、五类专属美术槽位、
人物焦点/蒙版以及宿主内置动效,让每个人物主题拥有不同的 UI 语言而不开放任意 CSS。

**iKun 模式就是一个随应用分发的示例**:它会在首次启动时自动安装
(id 为 `ikun`,见 `src/main/ui-plugin-bundled.ts`),在形象工坊里与第三方插件同级。
它额外带有应用针对 `ikun` id 制作的专属动画;第三方插件使用通用的形象与背景框架。

**一个 UI 插件就是一个文件夹**:`manifest.json` + 被 manifest 引用的图片。
插件是纯声明式的,没有任何可执行代码;应用不会执行插件中的 JS、HTML、CSS 或 SVG。
启用主题时,Kun 主进程会重新读取并校验已安装的 manifest 和图片,根据固定槽位生成宿主 CSS,
再通过 Electron 内部的 CDP 接口注入工作台。这个实现不开放远程调试端口,也没有插件脚本入口。

```text
my-plugin/
├── manifest.json
├── img/
│   ├── swim.png
│   ├── portrait.png
│   └── stage.webp
├── scene/
│   ├── backdrop.webp
│   ├── frame.png
│   └── emblem.png
└── artwork/
    └── stage-source.svg  # 可选的创作源文件,不会安装或执行
```

安装方式:`设置 → 形象工坊 → 安装插件文件夹…`,选中插件目录即可。
应用校验 manifest 和图片后,只把 **manifest 与被 `figures` / `backgrounds` / `scene` 引用的图片**
复制进应用数据目录(`~/.kun/ui-plugins/<id>/`);未引用的创作源文件不会复制。

官方示例见 [`examples/ui-plugins/starlight/`](../examples/ui-plugins/starlight/)。它同时演示了
旧版兼容的形象槽位、背景路径简写和完整背景图层对象。

## manifest.json 参考

```json
{
  "id": "starlight",
  "name": "星夜 Kun",
  "version": "1.5.0",
  "author": "你的名字",
  "description": "一句话介绍(可选,≤240 字符)",
  "figures": {
    "portrait": "img/portrait.png",
    "swim": "img/bird.png",
    "greet": "img/greet.png",
    "toggleIcon": "img/icon.png"
  },
  "presentation": {
    "character": {
      "anchor": "right",
      "size": "hero",
      "offsetX": 4,
      "offsetY": -2,
      "opacity": 0.94,
      "frame": "hologram",
      "motion": "float",
      "contentReserve": "wide"
    },
    "readability": {
      "scrim": "opposite-character",
      "strength": "strong"
    },
    "surfaces": {
      "sidebar": "strong-glass",
      "topbar": "glass",
      "composer": "strong-glass",
      "cards": "translucent"
    }
  },
  "scene": {
    "apiVersion": "1.6",
    "layout": "card-right",
    "character": {
      "scale": "hero",
      "fit": "cover",
      "focalPoint": "top",
      "mask": "arch",
      "offsetX": 0,
      "offsetY": 0,
      "opacity": 1,
      "flipX": false,
      "motion": { "preset": "breathe", "speed": "slow", "phase": "a" }
    },
    "artwork": {
      "backdrop": {
        "path": "scene/backdrop.webp",
        "anchor": "center",
        "size": "full",
        "fit": "cover",
        "offsetX": 0,
        "offsetY": 0,
        "opacity": 0.7,
        "blend": "soft-light",
        "motion": { "preset": "drift-x", "speed": "slow", "phase": "b" }
      },
      "frame": {
        "path": "scene/frame.png",
        "anchor": "center",
        "size": "full",
        "fit": "contain",
        "offsetX": 0,
        "offsetY": 0,
        "opacity": 1,
        "blend": "normal",
        "motion": { "preset": "none", "speed": "normal", "phase": "a" }
      }
    },
    "chrome": {
      "sidebar": "starlight",
      "topbar": "starlight",
      "composer": "starlight",
      "cards": "starlight"
    }
  },
  "backgrounds": {
    "light": {
      "stage": "img/stage.webp"
    },
    "dark": {
      "stage": {
        "path": "img/stage.webp",
        "fit": "cover",
        "position": "center",
        "opacity": 0.42
      }
    }
  },
  "labels": {
    "zh": { "working": "巡航中…" },
    "en": { "working": "Cruising…" }
  },
  "tokens": {
    "light": { "--ds-accent": "#7a5fd0" },
    "dark": { "--ds-accent": "#a78ff0" }
  },
  "features": { "cameos": true }
}
```

### 顶层字段

| 字段 | 必填 | 规则 |
|---|---|---|
| `id` | ✓ | 2–40 位小写字母/数字/连字符;保留字 `default` / `kun` / `on` / `off` / `none` 不可用(`ikun` 被预装示例占用,重装会覆盖它) |
| `name` | ✓ | ≤60 字符 |
| `version` | ✓ | 语义化版本,如 `1.0.0` |
| `author` / `description` | | ≤80 / ≤240 字符 |
| `figures` | 至少一类 | 形象槽位对象;活动小形象支持 `png/webp/jpg/jpeg/gif`;`portrait` 仅支持静态 `png/webp/jpg/jpeg` |
| `backgrounds` | 至少一类 | `light` / `dark` 主题下可放 `app` / `sidebar` / `stage`;图片仅支持静态 `png/webp/jpg/jpeg`(不支持 APNG、animated WebP) |
| `presentation` | | 人物舞台的严格声明式配置;一旦提供就必须同时提供 `figures.portrait` |
| `scene` | | v1.6 专属场景;必须同时提供完整 `presentation` 回退、`figures.portrait` 与至少一个 `artwork` 槽位 |
| `labels` | | 仅 `zh` / `en`;键限 `working` / `workingSprint` / `workingDive` / `workingSurf`;每条 ≤24 字符 |
| `tokens` | | 仅 `light` / `dark`;键限 `--ds-*`;值禁止 `url()`、分号、花括号等;总数 ≤60 |
| `features.cameos` | | `true` 时启用主会话两侧的不定时出没彩蛋 |

`figures` 和 `backgrounds` 可以分别省略,但二者合计至少要包含一个有效图片槽位;空对象等同于未提供。
所有图片路径都必须是插件目录内的相对路径,禁止绝对路径、`..` 与反斜杠。

## 背景图层(backgrounds)

`backgrounds` 按主题和区域组织。三个区域彼此独立:

| 槽位 | 作用区域 | 默认透明度 |
|---|---|---|
| `app` | 整个工作台内容区的底层背景 | `0.22` |
| `sidebar` | 左侧栏背景 | `0.18` |
| `stage` | 主内容/会话舞台背景 | `0.32` |

顶栏(`topbar`)不属于上述三个背景槽位,仍由主题 token `--ds-topbar-bg` 控制。

一个图层可以直接写成图片路径,也可以写成对象:

```json
{
  "backgrounds": {
    "light": {
      "app": "img/paper-texture.jpg",
      "sidebar": {
        "path": "img/sidebar.webp",
        "fit": "contain",
        "position": "bottom-right",
        "opacity": 0.14
      }
    }
  }
}
```

- 字符串是 `{ "path": "…" }` 的简写。
- `fit` 可为 `cover` 或 `contain`,默认 `cover`。
- `position` 默认 `center`,可为 `top-left` / `top` / `top-right` / `left` / `center` /
  `right` / `bottom-left` / `bottom` / `bottom-right`。
- `opacity` 范围为 `0`–`1`;省略时使用上表对应区域的默认值。
- `light` 与 `dark` **不会互相回退**。例如只声明 `light.stage` 时,深色主题不会偷偷沿用它;
  如需两种主题显示同一张图,请在两边都显式声明。

背景图片本身不携带布局或样式权限。应用只读取图像像素,再在固定的安全图层中应用上述
`fit`、`position`、`opacity` 参数;插件不能提供选择器、CSS 值或脚本。

## 人物舞台(presentation,v1.5)

`figures.portrait` 是会话舞台使用的主人物图片。建议使用透明背景的原始人物立绘,不要把
Kun 的侧栏、顶栏、输入框或其它应用界面烘焙进图片。Kun 会保留人物原画,只在图片外侧
绘制宿主框景和氛围层,不会重新设计人物。portrait 必须是静态 PNG/JPEG/WebP;GIF、APNG
和 animated WebP 会在安装及每次加载时被拒绝,避免绕过“减少动态效果”或持续占用解码资源。
这个限制不影响 `swim`、`greet` 等既有活动小形象继续使用 GIF。

`presentation` 必须完整包含下面三个对象。所有键和取值都是严格白名单;未知键、缺失键、
任意 CSS、选择器、URL 或布局字符串都会让安装失败。

### `character`

| 字段 | 可选值/范围 | 作用 |
|---|---|---|
| `anchor` | `top-right` / `right` / `bottom-right` | 人物在会话舞台右侧的锚点 |
| `size` | `medium` / `large` / `hero` | 宿主预设的立绘尺寸 |
| `offsetX` / `offsetY` | `-12`–`12` 的整数 | 在锚点基础上的百分比微调 |
| `opacity` | `0`–`1` 的有限数字 | 整个人物层透明度 |
| `frame` | `soft-card` / `paper` / `crystal` / `hologram` / `backstage` / `portal` / `polaroid` / `ticket` / `seal` | 九种宿主绘制的框景语言 |
| `motion` | `none` / `breathe` / `float` | 固定的轻动效;系统开启“减少动态效果”时自动关闭 |
| `contentReserve` | `none` / `narrow` / `wide` | 给消息和输入框预留人物空间,避免遮挡 |

### `readability`

| 字段 | 可选值 | 作用 |
|---|---|---|
| `scrim` | `none` / `opposite-character` / `full` | 不加遮罩、只保护人物对侧文字区、或保护整个舞台 |
| `strength` | `soft` / `medium` / `strong` | 固定遮罩强度 |

### `surfaces`

`sidebar`、`topbar`、`composer`、`cards` 四个键都必须提供。每个键只能选择
`solid` / `translucent` / `glass` / `strong-glass`。这些名称映射到 Kun 内置材质,
插件不能覆盖模糊半径、阴影、边框或 CSS 属性。

人物层、装饰层和遮罩层均为 `pointer-events: none` 且 `aria-hidden`;不会拦截聊天、输入或
辅助技术。会话舞台窄于 980px 或开启专注模式时,人物与装饰自动隐藏并归还内容宽度。

## 专属人物场景(scene,v1.6)

`scene` 是 `presentation` 之上的渐进增强。它不允许插件传入 DOM、CSS 或动画代码,而是让
插件从 Kun 固定的场景积木中组合专属 UI。声明 `scene` 时仍必须保留完整 `presentation`,
供只认识 v1.5 的宿主安全回退。`scene.apiVersion` 当前只能是 `"1.6"`。

### 场景布局和人物

- `layout`: `rail-right` / `rail-left` / `card-right` / `card-left` /
  `backdrop-right` / `backdrop-center`。导轨和卡片布局会由宿主给消息列与输入框预留左右空间;
  背景布局始终放在内容层下方。
- `character.scale`: `compact` / `standard` / `hero`;`fit`: `contain` / `cover`;
  `focalPoint` 使用背景图层相同的九宫格位置。
- `character.mask`: `none` / `soft-card` / `circle` / `arch` / `diamond` /
  `hologram` / `portal` / `polaroid` / `ticket`。
- `offsetX` / `offsetY` 是 `-12`–`12` 的整数,`opacity` 为 `0`–`1`,`flipX` 为布尔值。
- 人物 `motion.preset` 为 `none` / `breathe` / `float` / `sway`;所有 motion 还必须指定
  `speed`(`slow` / `normal` / `fast`)与 `phase`(`a` / `b` / `c`)。

### 专属美术槽位

`artwork` 至少声明一个槽位:`backdrop` / `ambient` 位于整个舞台的安全底层;
`frame` / `foreground` / `emblem` 位于裁切后的人物视觉区。每层必须完整提供:

| 字段 | 可选值/范围 |
|---|---|
| `path` / `darkPath` | 插件内静态 PNG/JPEG/WebP 相对路径;`darkPath` 可选,深色模式覆盖默认图 |
| `anchor` | 九宫格位置 |
| `size` | `small` / `medium` / `large` / `full` |
| `fit` | `contain` / `cover` |
| `offsetX` / `offsetY` | `-12`–`12` 的整数 |
| `opacity` | `0`–`1` |
| `blend` | `normal`;仅 `backdrop` / `ambient` 可用 `screen` / `soft-light` |
| `motion.preset` | `none` / `float` / `drift-x` / `drift-y` / `pulse` / `orbit` / `twinkle` / `scan` |

人物和美术动效都由宿主实现,系统开启“减少动态效果”时自动停止。不要把 Kun 的输入框、
消息、侧栏等界面烘焙进这些图;宿主会负责真实 UI 的避让和层级。

### 宿主外观配方

`chrome` 必须包含 `sidebar`、`topbar`、`composer`、`cards` 四项。每项可选
`inherit` / `soft` / `editorial` / `paper` / `crystal` / `hologram` / `backstage` /
`portal` / `polaroid` / `ticket` / `seal`,也可以使用 11 套人物专属配方:
`botanical` / `fortune-ledger` / `dream-gate` / `washi` / `scrapbook` / `aurora` /
`synth` / `midnight-pass` / `nautical` / `dimension-lab` / `starlight`。

人物专属配方由 Kun 宿主实现,会以同一套视觉语言同时处理侧边栏、顶栏、输入框、用户/助手
消息、普通卡片与表格表面。例如 `botanical` 使用柔和植物感层次,`fortune-ledger` 使用账簿式
线条,`synth` 与 `dimension-lab` 使用不同的未来界面语言。插件只选择白名单名称;不能提供
选择器、属性值、DOM 或控件,所有装饰保持在真实交互层下方,不会拦截输入。

四项可以独立选择,但人物主题通常应让四项使用同一个专属配方,以保证会话卡片、输入区和
导航区与人物形象保持一致。这些名称是 Kun 固定的表面配方,不是 CSS 权限。

场景舞台、人物视觉区、装饰图和可读性遮罩均为不可交互安全层。窗口变窄、专注模式开启或
终端面板展开时,宿主会隐藏整套场景并取消消息列/输入框位移,避免任何图片或装饰遮挡输入。

## 宿主受控的 CDP 主题注入

CDP 是 Kun 应用主题的**宿主实现细节**,不是 manifest 能申请的代码执行能力。激活一次插件时:

1. 渲染层只把插件 `id` 发给主进程。
2. 主进程从 `~/.kun/ui-plugins/<id>/` 重新读取并规范化 manifest,重新校验全部引用图片。
3. Kun 自己的样式生成器把白名单 token、固定背景槽位以及已归一化的人物/场景数值变量组合成 CSS。
4. 主进程短暂附加 `mainWindow.webContents.debugger`,调用固定的 `Runtime.evaluate` 程序,
   只用 `style.textContent` 创建或更新一个宿主管理的 `<style>` 节点,随后立即分离 debugger。
5. 渲染层用固定 React 组件显示主进程验证后的 `figures.portrait` 与 `scene.artwork` data URL,
   枚举值只设置为宿主认识的受控 `data-*` 状态;不会执行插件代码或插入插件标记。
6. 工作台重新加载后,主进程用同一份宿主生成 CSS 重新注入;停用插件时删除该节点并清理状态。

Kun 不使用 `--remote-debugging-port`,不会连接外部 WebSocket,也不接受插件提供的 CSS、JS、
选择器或 CDP payload。若 DevTools 或其它调试器已经占用该 `webContents` 的 debugger,
本次启用会安全失败且不会分离对方的调试会话;关闭占用方后可重新启用主题。

## 形象槽位(figures)

动画小形象建议 **主体朝左**、透明背景、最长边 512px 左右。`portrait` 建议保留人物原始
纵向构图和透明背景,在 2 MiB 槽位预算内可使用更高分辨率。缺失动画槽位会回退到默认
Kun 美术,或按下表回退链借用插件内的其它槽位;`portrait` 不参与动画回退链。

| 槽位 | 出现在哪里 | 缺失时回退 |
|---|---|---|
| `portrait` | `presentation` / `scene` 人物舞台中的完整人物立绘 | 不显示人物舞台;声明 `presentation` 或 `scene` 时此槽位必填 |
| `swim` | 回合进行中的泳动动画主体(推进/冲刺/潜入)、各处最终兜底 | 默认 Kun 鸟 |
| `surf` | 泳动动画的冲浪姿态、庆祝「胜利巡游」 | `swim` |
| `greet` | 欢迎卡片、侧边栏轮播、出没「探头」、庆祝「跃起欢呼」 | `swim` |
| `sleep` | 运行时唤醒页、侧边栏轮播、出没「打盹」 | `sit` → `swim` |
| `sit` | 选择工作区空状态、侧边栏轮播、出没「歇脚」、庆祝「举杯」 | `greet` → `swim` |
| `run` | 出没「横穿/对穿」、庆祝「胜利巡游」 | `surf` → `swim` |
| `toggleIcon` | 形象工坊里的预览小图 | `swim` → `greet` … |

## 尺寸与体积限制

形象预算沿用既有的按槽位计数规则;背景预算、复制文件与全部资源总额按相对路径去重:

- `manifest.json` ≤64 KiB。
- 每个形象槽位引用的图片 ≤2 MiB;全部形象槽位合计 ≤24 MiB。同一路径被多个形象槽位
  引用时,仍会按槽位分别计入该项预算。
- 任一形象图片宽、高均 ≤4096 px,且单张解码尺寸 ≤12 MP;全部形象槽位合计 ≤48 MP。
  与体积预算相同,同一路径被多个形象槽位引用时会按槽位计入总像素预算。
- 单张背景图片 ≤8 MiB;去重后的全部背景图片合计 ≤32 MiB。
- 按相对路径去重后的形象、背景与场景文件合计 ≤48 MiB。
- 任一背景图片宽、高均 ≤8192 px,且单张解码尺寸 ≤24 MP(宽 × 高)。
- 去重后的全部背景图片解码尺寸合计 ≤64 MP。
- 单张 `scene.artwork` 图片 ≤4 MiB;按相对路径去重后的场景图片合计 ≤16 MiB。
- 任一场景图片宽、高均 ≤4096 px,且单张解码尺寸 ≤12 MP;去重后的场景图片合计 ≤40 MP。

形象工坊列表优先使用 `toggleIcon`、`swim`、`greet` 等小形象作为预览,不会把全尺寸
portrait 的 base64 放进列表 IPC。只有 portrait 可用时,宿主会生成最长边 ≤256px、编码后
≤96 KiB 的单帧静态 WebP 缩略图;无法满足上限时显示占位图。

这些限制同时约束压缩文件大小和解码后的像素规模。安装、预装和重新加载时还会调用应用
已有的图片解码器验证像素数据,而不只信任文件头。形象工坊列表若只能用背景作为卡片预览,
仅会返回 ≤512 KiB 且 ≤2.1 MP 的背景;更大的背景仍可正常安装和启用,列表中显示占位图。

## 兼容旧版 Kun

旧版 Kun 不认识 `backgrounds` 时会忽略该字段,背景不会生效。`portrait` 和 `presentation`
需要支持 v1.5 的 Kun;严格校验旧版可能把 `portrait` 视为未知槽位而拒绝安装。较早的校验器还要求
`figures` 存在,因此需要兼容旧版时,建议至少保留一个形象槽位(通常是 `swim` 或
`toggleIcon`)。`scene` 需要支持 v1.6 的 Kun;兼容 v1.5 时请保留 `presentation`,旧宿主会忽略
场景而使用人物舞台回退。新版允许制作只有背景、没有自定义形象的插件。

## 安全模型(为什么这样设计)

1. **无代码执行**:manifest 只接受声明式字段;JS、HTML、CSS、SVG 不能作为运行资源。
2. **白名单安装**:只复制 manifest 与 `figures` / `backgrounds` / `scene` 引用的安全图片;路径禁止
   越界,未引用文件不会安装。
3. **主进程校验**:安装时校验扩展名、文件签名、完整像素解码、文件大小、图像尺寸与累计预算;
   不合规的图片会让安装失败。
4. **隔离渲染**:页面不会直接访问插件目录或任意文件路径;图片经主进程校验并转换为
   `data:` URL,背景只进入宿主生成的主题 CSS,人物只进入固定的无交互 React 图片层。
5. **固定背景参数**:背景只能选择固定槽位、两种缩放方式、九宫格位置和 `0`–`1` 透明度。
6. **主题 token 白名单**:键名必须是 `--ds-*`,值经过字符集校验;应用生成的样式锚定在
   `html[data-ui-plugin='<id>']` 下,由主进程通过短生命周期 CDP 会话注入,停用即移除。
7. **人物舞台白名单**:只接受固定锚点、尺寸、框景、动效、遮罩和材质枚举;数值范围由
   主进程验证,所有选择器、标记、事件和动画实现均由 Kun 固定提供。
8. **专属场景白名单**:只接受固定布局、五类美术槽位、蒙版、焦点、动效和外观配方;原始路径
   不进入 DOM 或 CSS,渲染层只接收主进程验证后的静态图片 data URL。

## 调试技巧

- 安装失败时,设置页会列出 manifest 或图片的具体校验错误。
- 修改插件后重新执行一次「安装插件文件夹…」即可覆盖更新(同 id 覆盖安装)。正在使用
  该插件时,先切到默认形象再切回来,即可确保重新载入最新资源。
- 如果提示 DevTools 或其它 debugger 已占用 CDP,关闭对应调试器后重新启用主题。Kun 不会
  抢占或主动分离不属于主题控制器的调试会话。
- 如果背景妨碍文字可读性,先降低 `opacity`;不要把重要文字烘焙进背景图。
- 可用的 `--ds-*` token 清单见 `src/renderer/src/styles/base-shell.css` 顶部的
  `:root` 与 `[data-theme='dark']` 变量块。常用 token 包括 `--ds-accent`、
  `--ds-accent-soft`、`--ds-selection` 和 `--ds-topbar-bg`。
