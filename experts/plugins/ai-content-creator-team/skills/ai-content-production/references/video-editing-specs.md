# 视频编辑技术规范

## 一、坐标系统（关键警告）

⚠️ **所有 PosX/PosY 值均为左上角坐标，不是中心点坐标。**

此规则适用于所有涉及位置的滤镜：transform、crop、delogo 等。

**全屏显示公式**：
```json
{
  "Type": "transform",
  "PosX": 0,
  "PosY": 0,
  "Width": "<canvas_width>",
  "Height": "<canvas_height>"
}
```

**居中定位公式**：
```
PosX = (canvas_width - element_width) / 2
PosY = (canvas_height - element_height) / 2
```

---

## 二、EditParam 核心结构

### 2.1 整体架构

```json
{
  "Canvas": { "Width": 1920, "Height": 1080 },
  "Output": { "FPS": 30, "Codec": "h264" },
  "Track": [
    [/* 第1层元素数组 - 最底层 */],
    [/* 第2层元素数组 */],
    [/* 第3层元素数组 - 最顶层 */]
  ]
}
```

### 2.2 Canvas（画布）

| 字段 | 类型 | 说明 |
|------|------|------|
| Width | number | 画布宽度（像素） |
| Height | number | 画布高度（像素） |

**可省略**：系统自动从源视频检测尺寸

**常见画布尺寸**：
- 横屏 1080p：1920 × 1080
- 竖屏 1080p：1080 × 1920
- 正方形：1080 × 1080

### 2.3 Output（输出设置）

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| FPS | number | 30 | 帧率 |
| Codec | string | "h264" | 编码格式 |

**可省略**：使用默认值即可满足大多数场景

### 2.4 Track（轨道层）

- Track 是一个 **二维数组**
- 外层数组：不同层级（索引越大越在上层）
- 内层数组：同一层级的多个元素（按时间排列）
- **渲染规则**：自下而上渲染，上层覆盖下层

---

## 三、五种元素类型

### 3.1 video 元素

```json
{
  "Type": "video",
  "Vid": "video_resource_id",
  "Duration": 10000,
  "Extra": [/* 滤镜数组 */]
}
```

| 字段 | 说明 |
|------|------|
| Vid | 视频资源 ID（通过 uploadAndGetVid 获取） |
| Duration | 元素在时间线上的持续时间（毫秒） |
| Extra | 应用的滤镜数组 |

**注意**：video 元素已包含原始音频，简单拼接无需额外添加音频轨道。

### 3.2 audio 元素

```json
{
  "Type": "audio",
  "Vid": "audio_resource_id",
  "Duration": 15000,
  "Extra": [
    { "Type": "a_volume", "Volume": 80 },
    { "Type": "a_fade", "FadeIn": 2000, "FadeOut": 3000 }
  ]
}
```

### 3.3 image 元素

```json
{
  "Type": "image",
  "Vid": "image_resource_id",
  "Duration": 5000,
  "Extra": [
    { "Type": "transform", "PosX": 100, "PosY": 50, "Width": 200, "Height": 200 }
  ]
}
```

### 3.4 text 元素

```json
{
  "Type": "text",
  "Content": "你的水印文字",
  "FontId": "source_han_sans_black",
  "FontSize": 36,
  "FontColor": "#FFFFFF",
  "Duration": 10000,
  "Extra": [
    { "Type": "transform", "PosX": 50, "PosY": 950, "Width": 400, "Height": 60 }
  ]
}
```

### 3.5 subtitle 元素

```json
{
  "Type": "subtitle",
  "Vid": "srt_file_resource_id",
  "Duration": 60000
}
```

---

## 四、十一种滤镜详解

### 4.1 transform（变换）

```json
{
  "Type": "transform",
  "PosX": 0,
  "PosY": 0,
  "Width": 1920,
  "Height": 1080,
  "Rotation": 0,
  "Alpha": 1.0
}
```

| 参数 | 说明 | 范围 |
|------|------|------|
| PosX | 左上角 X 坐标 | 0 ~ canvas_width |
| PosY | 左上角 Y 坐标 | 0 ~ canvas_height |
| Width | 元素显示宽度 | 正整数 |
| Height | 元素显示高度 | 正整数 |
| Rotation | 旋转角度 | 0-360 |
| Alpha | 透明度 | 0.0-1.0 |

### 4.2 trim（时间裁剪）

```json
{ "Type": "trim", "StartTime": 10000, "EndTime": 30000 }
```
截取视频 10 秒到 30 秒的片段。

### 4.3 crop（区域裁剪）

```json
{ "Type": "crop", "X": 100, "Y": 100, "Width": 800, "Height": 600 }
```
从源视频中裁剪指定矩形区域。

### 4.4 speed（速度调节）

```json
{ "Type": "speed", "Speed": 2.0 }
```
- 0.5 = 半速播放（慢动作）
- 1.0 = 正常速度
- 2.0 = 二倍速

### 4.5 transition（转场）

```json
{ "Type": "transition", "Name": "CircleOpen", "Duration": 1000 }
```

**可用转场 ID**：
| ID | 效果 |
|---|---|
| CircleOpen | 圆形从中心展开 |
| RotateZoom | 旋转缩放切换 |
| DoorOpen | 门式左右开启 |
| ClockWipe | 时钟方向擦除 |

**约束**：转场 Duration 必须小于相邻片段中较短者的时长。

### 4.6 lut_filter（颜色滤镜）

```json
{ "Type": "lut_filter", "FilterId": "Vintage" }
```

**可用滤镜 ID**：
| ID | 效果 |
|---|---|
| Clear | 清晰通透 |
| Afternoon | 午后暖调 |
| Vintage | 复古胶片 |
| Friends | 友好明亮 |

### 4.7 video_animation（动画效果）

```json
{ "Type": "video_animation", "AnimationId": "FadeIn", "Duration": 1000 }
```

**可用动画 ID**：
| ID | 效果 |
|---|---|
| FadeIn | 渐入 |
| FadeOut | 渐出 |
| Shrink | 收缩 |
| ZoomIn | 放大进入 |

### 4.8 a_volume（音频音量）

```json
{ "Type": "a_volume", "Volume": 50 }
```
Volume: 0-100，0 为静音，100 为原始音量。

### 4.9 a_fade（音频淡入淡出）

```json
{ "Type": "a_fade", "FadeIn": 2000, "FadeOut": 3000 }
```
FadeIn/FadeOut 均为毫秒值。

### 4.10 delogo（去水印）

```json
{ "Type": "delogo", "X": 50, "Y": 30, "Width": 200, "Height": 80 }
```
在指定区域应用模糊处理以遮盖 Logo/水印。

### 4.11 canvas_color（画布背景色）

```json
{ "Type": "canvas_color", "Color": "#000000" }
```
设置画布背景颜色（十六进制格式）。

---

## 五、预设字体

| ID | 字体名 | 风格 |
|---|---|---|
| source_han_sans_black | 思源黑体 | 黑体、现代 |
| alibaba_puhuiti | 阿里巴巴普惠体 | 圆润、友好 |
| pangmen_zhengdao_title | 庞门正道标题体 | 粗犷、标题 |

---

## 六、八个完整编辑示例

### 示例 1：简单视频拼接

将 3 段视频首尾相接：
```json
{
  "Track": [
    [
      { "Type": "video", "Vid": "vid_001", "Duration": 5000 },
      { "Type": "video", "Vid": "vid_002", "Duration": 8000 },
      { "Type": "video", "Vid": "vid_003", "Duration": 6000 }
    ]
  ]
}
```

### 示例 2：带转场的拼接

```json
{
  "Track": [
    [
      { "Type": "video", "Vid": "vid_001", "Duration": 5000, "Extra": [
        { "Type": "transition", "Name": "CircleOpen", "Duration": 800 }
      ]},
      { "Type": "video", "Vid": "vid_002", "Duration": 8000, "Extra": [
        { "Type": "transition", "Name": "RotateZoom", "Duration": 600 }
      ]},
      { "Type": "video", "Vid": "vid_003", "Duration": 6000 }
    ]
  ]
}
```

### 示例 3：视频片段裁剪（10s到30s）

```json
{
  "Track": [
    [
      { "Type": "video", "Vid": "vid_source", "Duration": 20000, "Extra": [
        { "Type": "trim", "StartTime": 10000, "EndTime": 30000 }
      ]}
    ]
  ]
}
```

### 示例 4：添加文字水印

```json
{
  "Canvas": { "Width": 1920, "Height": 1080 },
  "Track": [
    [{ "Type": "video", "Vid": "vid_main", "Duration": 30000 }],
    [{ "Type": "text", "Content": "@MyChannel", "FontId": "source_han_sans_black", "FontSize": 24, "FontColor": "#FFFFFF80", "Duration": 30000, "Extra": [
      { "Type": "transform", "PosX": 1650, "PosY": 1020, "Width": 250, "Height": 40 }
    ]}]
  ]
}
```

### 示例 5：添加背景音乐

```json
{
  "Track": [
    [{ "Type": "video", "Vid": "vid_main", "Duration": 60000, "Extra": [
      { "Type": "a_volume", "Volume": 30 }
    ]}],
    [{ "Type": "audio", "Vid": "bgm_001", "Duration": 60000, "Extra": [
      { "Type": "a_volume", "Volume": 70 },
      { "Type": "a_fade", "FadeIn": 3000, "FadeOut": 5000 }
    ]}]
  ]
}
```

### 示例 6：应用颜色滤镜

```json
{
  "Track": [
    [{ "Type": "video", "Vid": "vid_main", "Duration": 15000, "Extra": [
      { "Type": "lut_filter", "FilterId": "Vintage" }
    ]}]
  ]
}
```

### 示例 7：Logo 模糊去水印

```json
{
  "Track": [
    [{ "Type": "video", "Vid": "vid_main", "Duration": 30000, "Extra": [
      { "Type": "delogo", "X": 1700, "Y": 50, "Width": 180, "Height": 60 }
    ]}]
  ]
}
```

### 示例 8：横屏旋转为竖屏

```json
{
  "Canvas": { "Width": 1080, "Height": 1920 },
  "Track": [
    [{ "Type": "video", "Vid": "vid_landscape", "Duration": 20000, "Extra": [
      { "Type": "transform", "PosX": 0, "PosY": 420, "Width": 1080, "Height": 1080 },
      { "Type": "crop", "X": 420, "Y": 0, "Width": 1080, "Height": 1080 }
    ]}]
  ]
}
```

---

## 七、工作流程

1. **获取视频 ID**：通过 `uploadAndGetVid` 上传或注册视频资源
2. **构建 EditParam**：按需求组合 Canvas + Output + Track
3. **提交任务**：调用 `submitDirectEditTask` 提交编辑
4. **轮询状态**：
   - 首次等待：90 秒
   - 后续间隔：30 秒
   - 超时上限：20 分钟
5. **获取结果**：任务完成后获取输出视频 URL

---

## 八、关键规则汇总

1. **时间单位**：所有时间参数使用毫秒（1秒 = 1000ms）
2. **坐标原点**：左上角为 (0, 0)，PosX/PosY 指左上角位置
3. **轨道层级**：Track 数组索引越大层级越高（后覆盖前）
4. **转场约束**：transition Duration < 相邻较短片段 Duration
5. **音频独立**：video 元素自带音频，简单拼接无需额外音频轨
6. **Canvas 可选**：省略时自动从首个视频源检测
7. **先上传**：任何编辑前，必须先获取视频 Vid
8. **滤镜叠加**：同一元素的 Extra 数组中可组合多个滤镜
9. **处理限制**：单次任务最大 20 分钟
10. **格式支持**：输入 MP4/MOV，输出默认 MP4/H.264
