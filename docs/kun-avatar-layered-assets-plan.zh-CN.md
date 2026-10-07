# Kun 分层头像素材与换装实现

> 更新：2026-10-07。状态：素材与换装功能已实现。79个图层、30个预设、共享编辑器与真实应用保存流程已验证；检查入口和验收范围见下文。

## 1. 目标和范围

以现有30张Kun头像为角色和画风参考，生成可在本地组合的透明图层，接入用户资料、Agent、群和成员头像。保留角色特征，允许为统一换装调整比例、姿态和细节，不承诺逐像素复刻旧图。

- 身体颜色：天空蓝 `sky`、薄荷青 `teal`、蓝紫 `periwinkle`、青绿 `mint`。
- 表情：默认 `normal`、眯眼笑 `happy`。
- 全量覆盖19类头饰、5类眼镜、24个衣服变体、9件道具和30个稳定角色ID。
- 讲故事人与魔法师的披风分别制作，原计划约23类衣服因此对应24个具体部件。
- 配件保留原色；此次不提供任意身体色、配件染色和眨眼表情。
- 旧内置头像、上传照片和默认身份头像继续有效，不迁移历史数据。
- 生图仅用于开发期间制作素材；用户换装在本地完成，不调用图像服务。

## 2. 素材制作方式

采用“参考图生图 → 独立透明图层 → 对齐校准 → 合成验收”。直接使用当前会话生图工具的参考图和真实透明背景能力，不修改Kun的 `generate_image` 接口。

1. 读取现有 `src/asset/img/room-avatars/kun-avatar-atlas.png` 与角色清单，保留来源记录。
2. 先生成天空蓝身体、独立羽冠、默认表情，以及耳机、方框眼镜和围巾，组成标准样张。
3. 检查角色风格、羽冠连接、脸部定位、镜片透明度和衣服遮挡。校准后锁定身体坐标，再生产其余素材。
4. 提示词要求仅输出配件，身体只作定位参考。一次生成多个独立部件时，保存透明素材表，按记录的格子或源坐标提取。
5. 构建脚本进行提取、平移和尺寸校准，将每件部件放回1024×1024透明画布。正式交付保留整张画布，不裁掉透明留白。
6. 保存实际生成分辨率的原稿、1024 PNG、三档WebP、素材清单、生成说明和定位记录。

提示词不能保证像素位置，位置和边缘必须在合成结果中检查。代码负责提取、定位、尺寸转换与合成，不重画角色，不使用像素差分作为正式抠层方法，不要求生图工具输出原生分层PSD。

构建入口为 `scripts/build-kun-avatar-assets.mjs`，定位记录为 `scripts/kun-avatar-asset-recipes.mjs`。原稿保存在素材目录的 `sources/`，原稿与发布图层须可通过记录相互追溯。

## 3. 画布、图层和文件

正式图层为1024×1024 RGBA PNG，含真实透明像素。发布尺寸为128、256、512的RGBA WebP，应用只加载WebP。背景由应用绘制，默认 `#f7f5ef`，也允许透明或六位十六进制颜色。

初始坐标沿用原计划，最终以锁定身体和实测清单为准：

| 基准 | 1024画布初值 |
| --- | --- |
| 水平中线 | x = 512 |
| 眼睛水平线 | y ≈ 584 |
| 喙中心 | (512, 666) |
| 头顶，不含羽冠 | y ≈ 190 |
| 肩线 | y ≈ 880 |
| 小头像脸部裁切框 `faceBox` | [232, 300, 792, 860] |

从下向上的顺序由共享函数 `kunAvatarLayerKeys` 定义：衣服后片、头饰后片、羽冠、身体、表情、衣服、眼镜、头饰、道具、抓握翅膀。

- 羽冠状态为正常、压低或隐藏；正常和压低羽冠各提供4色。
- 宇航头盔、兜帽、故事家披风、魔法师披风有独立后片。
- 宇航头盔与所有眼镜互斥。头饰只有一个槽位，帽子、耳机和兜帽不会同时被选中。
- 眼镜不得夹带眼睛、肤色或背景；镜片须可透出表情。
- 道具和抓握翅膀分开存储，抓握翅膀提供4色，随身体颜色切换。

```text
src/asset/img/kun-avatar/
  manifest.json
  sources/                         实际生成的原稿和生成记录
  base/{color}.png
  crest/{color}.png
  crest/tucked-{color}.png
  face/{normal,happy}.png
  headwear/{id}.png                 按需包含 {id}.back.png
  glasses/{id}.png
  outfit/{id}.png                   按需包含 {id}.back.png
  prop/{id}.png
  wing/{color}.png
  {128,256,512}/{layer}/{id}.webp
```

共有79个发布图层：4个身体、4个正常羽冠、4个压低羽冠、4个抓握翅膀、2个表情、57个配件和4个后片。每层有一个PNG和三个WebP，共316个交付图层文件；原稿不计入此数。

`manifest.json` 记录 `schemaVersion`、素材 `version`、画布、锚点与 `assets`。每个逻辑图层键映射到 `png` 相对路径和 `webp` 的128/256/512路径。素材版本参与缓存键。清单部件元数据须与共享目录一致，构建检查阻止缺图、未知图层和尺寸/透明通道不匹配。

## 4. 共享契约和角色预设

运行时与renderer共用不依赖图片文件的 `kun/src/contracts/kun-avatar-catalog.ts`。它定义ID、分类、双语名称、羽冠状态、后片标记、互斥规则和图层顺序。`kun-avatar-presets.ts` 保存30个旧角色ID对应的完整组合。renderer通过 `src/shared/rooms-api.ts` 使用这些纯数据与辅助函数。

`RoomAvatarReference` 在现有 `builtin`、`uploaded` 之外增加：

```ts
{
  kind: 'composed',
  version: 1,
  parts: {
    color, face,
    headwear?, glasses?, outfit?, prop?,
    bg
  }
}
```

Zod严格校验版本、ID和分类、互斥关系、背景格式及未知字段。省略 `bg` 时补默认背景，十六进制颜色规范化为小写。API拒绝不合法组合。

编辑器通过 `updateKunAvatarPart` 使用同一套规则，新选择替换冲突配件并提示；`randomKunAvatarParts` 只产生合法组合。保存沿用用户资料、Agent、群、成员现有接口、版本冲突处理、回执和更新事件，不新增上传接口或数据库迁移。

旧内置头像可从对应组合预设开始编辑，用户未保存前仍保留原引用。正式预设缩略图使用实际合成结果，原图集用于旧头像展示和对照验收。

## 5. 渲染与统一编辑器

`RoomAvatar` 根据组合引用合成头像，通过Vite资源URL兼容Electron打包和手机静态资源服务。所有WebP均使用外部资源URL，避免小图被全部内联进首屏脚本。缓存键包含素材版本、规范化组合、输出像素大小和裁切模式。重复请求共享合成工作，LRU限制保留数量并释放废弃图像资源；已无消费者的排队任务跳过解码。

优先使用OffscreenCanvas，不支持时回退普通Canvas。尺寸不超过48px时按 `faceBox` 裁切，输出考虑设备像素比；大头像显示完整构图。沿用身份描边与标记，透明背景不会被容器身份色填充。加载失败显示现有身份头像，用户头像仍回退Kun；快速换装时过期结果不能覆盖新预览。

桌面、Agent/成员/群设置与手机复用头像组件，提供预设、身体颜色、表情、头饰、眼镜、衣服、道具、背景、随机、默认头像和上传照片。配件分类有“无”。编辑只改草稿，保存后提交；取消不改变已保存头像。提供中英文、键盘操作和适合触摸的控件尺寸。

## 6. 验收入口

```bash
# 目录/清单、316个文件、尺寸、RGBA、透明度和配件对检查
node scripts/kun-avatar-compose-check.mjs --check-only

# 同时生成目视验收图与实际体积报告
node scripts/kun-avatar-compose-check.mjs
```

默认输出至不提交的 `.cache/kun-avatar-qa/`：

- `presets-original-composed.png`：全部30个新旧角色并排对照。
- `headwear-all-colors.png`、`glasses-all-colors.png`、`outfit-all-colors.png`、`prop-all-colors.png`：全部配件×4色。
- `body-expression-all-colors.png`：4色×2表情。
- `sizes-light.png`、`sizes-dark.png`、`sizes-transparent.png`：24/34/48/96px的浅色、深色和透明棋盘背景预览。
- `report.json`：文件、实际体积、合法/互斥配件对数量，以及4色身体、正常/压低羽冠和抓握翅膀的alpha边界对齐记录。不沿用原计划仅针对首批的3–6MB估计。

自动检查读取1024 PNG中alpha不低于16的可见像素，对身体、正常羽冠、压低羽冠、抓握翅膀各组的4色外接边界与天空蓝逐坐标比较，最大偏移不得超过2px，并记录实测值。这量化了导出图层的外框定位，不能证明内部轮廓、眼睛、喙或固定连接点均达到2px精度。还须目视检查风格、镜片内容、白边、残渣、羽冠连接、头盔与眼镜、衣服与道具、4色抓握翅膀和小尺寸可读性。

自动化覆盖：旧引用兼容、非法ID/分类/版本/背景、互斥双向替换、随机与全部配件对、用户资料/Agent/群/成员保存后重读、回执/版本冲突/更新事件、缓存复用/释放、加载失败、快速切换竞态、编辑器保存/取消/随机/默认行为。

最终检查包括相关Vitest、`npm run typecheck`、`npm run build`（含Kun构建）、`npm run check:file-lines`、`git diff --check`。桌面 `--workbench-only` 和手机需有真实界面冒烟结果，确认资源加载、更新同步和离线换装。未完成项记录为待验收，不能因代码或文件存在就标记通过。

## 7. 验证记录与复验

- 素材检查：79层、316个文件，1098组合法配件对、5组互斥配件对。应用三档WebP合计约1.97 MiB；1024 PNG母版约20.19 MiB，原始生成图另外保存在 `sources/`，不进入renderer资源包。
- 已目视检查30个新旧角色对照、所有头饰与眼镜的4色组合，以及大小头像和深色背景。圆框眼镜的源图裁切、桂冠高度及两顶帽子的邻格残片在此过程中修正；摄影师衣服重新生成以分离相机道具。
- 前端、运行时、素材检查器与双语资源相关测试通过。完整类型检查使用 `NODE_OPTIONS=--max-old-space-size=8192`；默认4 GiB堆的一次检查曾耗尽内存。完整构建、预加载检查和文件行数门禁通过。
- 真实Electron应用验证了全部预设加载、草稿不提前保存、通过preload/main/Kun保存、资料版本递增、共享状态同步、重新打开恢复选项、取消不改变数据；全过程未调用模型。
- 导出定位通过固定整数坐标复现；1024 PNG的4组颜色变体可见alpha外框相对天空蓝实测最大偏移2px，通过2px门禁。源图由AI生成，颜色变体的局部曲线和光影可能略有差别；外框通过不等同于所有内部轮廓和连接点都达到2px精度。

```bash
# 桌面/手机真实组件、DOM Canvas回退、失败回退、DPR、构建资源及原生Electron
CHROME_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
  node scripts/smoke-kun-avatar.mjs --electron

# 隔离用户资料的完整Electron + preload + main + Kun保存链路
node scripts/smoke-development-direct-chat.cjs --workbench-only --avatar-only \
  --evidence .cache/kun-avatar-app
```

两个冒烟入口分别输出 `.cache/kun-avatar-ui/` 与 `.cache/kun-avatar-app/` 的截图和报告，不提交临时证据、构建产物或本机日志。
