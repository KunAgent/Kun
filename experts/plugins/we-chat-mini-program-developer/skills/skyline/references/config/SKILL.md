---
name: skyline-config
description: Skyline 小程序 JSON 配置规范技能。涵盖 app.json 全局配置（renderer、rendererOptions、componentFramework）、页面 json 配置（navigationStyle、disableScroll）、project.config.json 项目配置。适用于创建新 Skyline 项目、迁移 WebView 项目、配置混合渲染。触发关键词：app.json、页面配置、renderer、rendererOptions、skyline配置、navigationStyle、disableScroll、componentFramework、glass-easel、project.config.json。
---

# Skyline JSON 配置规范

## 适用场景

- 创建新的 Skyline 小程序项目
- 从 WebView 迁移到 Skyline 渲染引擎
- 配置混合渲染（部分页面 Skyline、部分 WebView）
- 配置 rendererOptions 优化样式兼容性
- 排查 Skyline 配置相关的编译错误

## 核心概念

### 三级配置层次

| 层级 | 文件 | 作用 | 关键配置 |
|------|------|------|----------|
| 全局 | `app.json` | 全局启用 Skyline | renderer, componentFramework, rendererOptions |
| 页面 | `页面.json` | 页面级配置/覆盖 | navigationStyle, disableScroll, renderer |
| 工具 | `project.config.json` | 开发者工具调试 | setting.skylineRenderEnable |

### 最小必需配置

```json
// app.json
{
  "renderer": "skyline",
  "componentFramework": "glass-easel",
  "lazyCodeLoading": "requiredComponents"
}
```

```json
// 每个页面的 .json
{
  "navigationStyle": "custom"
}
```

## 文档索引

根据需求快速定位（路径相对于 `references/`）：

| 我想要... | 查阅文档 |
|-----------|----------|
| 了解 app.json 中所有 Skyline 相关配置 | `app-config.md` |
| 了解页面级配置和混合渲染 | `page-config.md` |
| 配置开发者工具 | `project-config.md` |
| 查看完整配置模板 | `patterns.md` |

## 强制规则

### MUST（必须遵守）

1. **app.json 必须包含三项必需配置**：

   ```json
   // ❌ 错误：缺少 componentFramework 和 lazyCodeLoading
   {
     "pages": ["pages/index/index"],
     "renderer": "skyline"
   }

   // ✅ 正确：三项缺一不可
   {
     "renderer": "skyline",
     "componentFramework": "glass-easel",
     "lazyCodeLoading": "requiredComponents"
   }
   ```

2. **每个页面的 json 必须配置 `"navigationStyle": "custom"`**：

   ```json
   // ❌ 错误：缺少 navigationStyle，编译报错
   // getAppConfig error: the "navigationStyle" configuration
   // for the page should be set to "custom"
   {
     "usingComponents": {}
   }

   // ✅ 正确
   {
     "navigationStyle": "custom"
   }
   ```

   Skyline 不支持原生导航栏，必须使用自定义导航栏。

3. **使用 scroll-view 替代页面级滚动时配置 `"disableScroll": true`**：

   ```json
   // ❌ 错误：未禁用页面滚动，可能与 scroll-view 冲突
   {
     "navigationStyle": "custom"
   }

   // ✅ 正确：禁用页面滚动，使用 scroll-view 管理滚动
   {
     "navigationStyle": "custom",
     "disableScroll": true
   }
   ```

4. **rendererOptions 应配置 defaultDisplayBlock 和 defaultContentBox 以对齐 WebView 行为**：

   ```json
   // ❌ 错误：未配置 rendererOptions，Skyline 默认 display:flex + border-box
   {
     "renderer": "skyline"
   }

   // ✅ 正确：对齐 WebView 的 block + content-box 默认行为
   {
     "renderer": "skyline",
     "rendererOptions": {
       "skyline": {
         "defaultDisplayBlock": true,
         "defaultContentBox": true
       }
     }
   }
   ```

### NEVER（禁止行为）

1. **NEVER** 遗漏任何页面的 `navigationStyle: "custom"` 配置——即使页面不需要导航栏，Skyline 下也必须声明
2. **NEVER** 在 Skyline 页面中依赖页面级全局滚动——Skyline 不支持页面级滚动，必须使用 `scroll-view` 组件

## Quick Reference

### 必需配置速查

| 配置项 | 位置 | 值 | 级别 |
|--------|------|-----|------|
| `renderer` | app.json | `"skyline"` | 必需 |
| `componentFramework` | app.json | `"glass-easel"` | 必需 |
| `lazyCodeLoading` | app.json | `"requiredComponents"` | 必需 |
| `navigationStyle` | 页面 json | `"custom"` | 必需 |
| `disableScroll` | 页面 json | `true` | 推荐 |

### rendererOptions 配置速查

| 配置项 | 类型 | 默认值 | 推荐值 | 说明 |
|--------|------|--------|--------|------|
| `defaultDisplayBlock` | boolean | false | true | 默认 display:block（对齐 WebView） |
| `defaultContentBox` | boolean | false | true | 默认 box-sizing:content-box（对齐 WebView） |
| `tagNameStyleIsolation` | string | "isolated" | "legacy" | 标签选择器全局匹配（对齐 WebView） |
| `enableScrollViewAutoSize` | boolean | false | true | scroll-view 自动撑开高度 |
| `disableABTest` | boolean | false | true | 关闭 Skyline AB 实验，确保稳定性 |

### 场景决策表

| 场景 | 推荐配置 |
|------|----------|
| 新建 Skyline 项目 | 三项必需 + rendererOptions 全部推荐值 |
| WebView 迁移 | 三项必需 + rendererOptions 兼容配置 + disableABTest |
| 混合渲染 | app.json 不设 renderer，页面级单独设 `"renderer": "skyline"` |
| 仅部分页面用 Skyline | 页面 json 中设 `"renderer": "skyline"` 覆盖全局 |

## 相关技能

| 场景 | 推荐技能 | 说明 |
|------|----------|------|
| WXSS 样式兼容 | `skyline-wxss` | rendererOptions 影响的默认值详解（display/flex-direction/align-items/box-sizing） |
| glass-easel 框架 | `skyline-glass-easel` | componentFramework 详细迁移指南 |
| Skyline 概览与迁移 | `skyline-overview` | 渲染引擎概览、迁移步骤 |
| 组件使用 | `skyline-components` | scroll-view 等组件配置 |
| 路由配置 | `skyline-route` | 自定义路由与页面转场 |


## References 目录结构

```
references/
├── app-config.md       # app.json Skyline 配置详解（renderer/rendererOptions/componentFramework）
├── page-config.md      # 页面级配置详解（navigationStyle/disableScroll/混合渲染）
├── project-config.md   # project.config.json 配置
└── patterns.md         # 配置模板（新项目/迁移/混合渲染）
```
