# app.json Skyline 配置详解

## 概述

小程序全局配置文件 `app.json` 中，以下配置项与 Skyline 渲染引擎直接相关。本文档仅列出 Skyline 相关配置，完整 app.json 配置请参阅官方文档。

## renderer

> 基础库 2.30.4+

指定小程序全局的默认渲染后端。

| 可选值 | 说明 |
|--------|------|
| `webview` | 默认值，使用 WebView 渲染 |
| `skyline` | 使用 Skyline 渲染引擎 |

```json
{
  "renderer": "skyline"
}
```

## componentFramework

> 基础库 2.30.4+

指定小程序使用的组件框架。Skyline 项目**必须**配置为 `glass-easel`。

| 可选值 | 说明 |
|--------|------|
| `exparser` | 默认值，传统组件框架 |
| `glass-easel` | 新组件框架，Skyline 必需 |

```json
{
  "componentFramework": "glass-easel"
}
```

> 📌 glass-easel 迁移详情请参阅：[skyline-glass-easel](../../skyline-glass-easel/SKILL.md)

## lazyCodeLoading

> 基础库 2.11.1+

配置自定义组件代码按需注入。目前仅支持值 `requiredComponents`。

```json
{
  "lazyCodeLoading": "requiredComponents"
}
```

开启后，小程序仅在页面实际使用到某组件时才注入该组件代码，显著优化启动性能。

## rendererOptions

> 基础库 2.31.1+

Skyline 渲染引擎的配置选项，嵌套在 `rendererOptions.skyline` 下。

### 完整配置项

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| defaultDisplayBlock | boolean | false | 开启默认 Block 布局。影响 display（flex→block）、flex-direction（column→row）、align-items（stretch→normal），对齐 WebView 行为 |
| defaultContentBox | boolean | false | 开启默认 ContentBox 盒模型。Skyline 默认 `border-box`，开启后对齐 WebView 的 `content-box` |
| tagNameStyleIsolation | string | "isolated" | 控制标签选择器的作用域。`"isolated"` 仅匹配当前组件，`"legacy"` 全局匹配（对齐 WebView） |
| enableScrollViewAutoSize | boolean | false | 开启 scroll-view 自动撑开。开启后 scroll-view 不需要显式设置高度 |
| disableABTest | boolean | false | 关闭 Skyline AB 实验。发布上线时建议开启，确保所有用户使用 Skyline |

### defaultDisplayBlock 效果对比

```css
/* 默认值 false：Skyline 默认 flex 布局 */
view {
  display: flex;
  flex-direction: column;
  align-items: stretch;
}

/* 设为 true：对齐 WebView 行为 */
view {
  display: block;
  flex-direction: row;    /* 虽然 display:block 时不生效，但默认值变化 */
  align-items: normal;    /* 虽然 display:block 时不生效，但默认值变化 */
}
```

> ⚠️ 迁移项目**强烈建议**开启此选项，否则大量使用 `display: block` 假设的样式将失效。

### defaultContentBox 效果对比

```css
/* 默认值 false：Skyline 默认 border-box */
view { box-sizing: border-box; }

/* 设为 true：对齐 WebView 行为 */
view { box-sizing: content-box; }
```

### tagNameStyleIsolation 说明

| 值 | 行为 | 适用场景 |
|----|------|----------|
| `"isolated"` | 标签选择器（如 `view {}`）仅匹配当前组件内的节点 | 新项目，推荐 |
| `"legacy"` | 标签选择器全局匹配，与 WebView 行为一致 | 迁移项目 |

### disableABTest 说明

Skyline 通过 AB 实验逐步扩大用户覆盖范围。开启 `disableABTest: true` 后：
- 所有用户均使用 Skyline 渲染
- 不再参与灰度实验
- **发布上线时建议开启**，确保行为一致性

```json
{
  "rendererOptions": {
    "skyline": {
      "disableABTest": true,
      "defaultDisplayBlock": true,
      "defaultContentBox": true,
      "tagNameStyleIsolation": "legacy",
      "enableScrollViewAutoSize": true
    }
  }
}
```

## window.navigationStyle

`app.json` 的 `window` 字段中，`navigationStyle` 控制导航栏样式。Skyline 下**必须**设为 `"custom"`。

```json
{
  "window": {
    "navigationStyle": "custom"
  }
}
```

在 `window` 中设置的 `navigationStyle` 作为全局默认值，仍需在每个页面 json 中显式声明（确保明确性）。

## convertRpxToVw

> 基础库 3.3.0+

配置是否将 rpx 单位转换为 vw 单位，开启后能修复某些 rpx 下的精度问题。

```json
{
  "convertRpxToVw": true
}
```
