---
name: skyline
description: "WeChat Mini Program Skyline rendering engine. Use when developing with Skyline renderer, including components (scroll-view, swiper, draggable-sheet), WXSS styles, worklet animations, custom routes/transitions, scroll APIs, and Skyline configuration/migration. Trigger keywords: Skyline, Skyline渲染引擎, skyline renderer, worklet, custom-route, routeBuilder, draggable-sheet, SharedValue, applyAnimatedStyle."
description_zh: "微信小程序 Skyline 渲染引擎（组件、动画、路由、样式）"
description_en: "WeChat Mini Program Skyline engine (components, animations, routes, styles)"
version: 1.0.0
homepage: https://developers.weixin.qq.com/miniprogram/dev/framework/runtime/skyline/introduction/
allowed-tools: Read,Write,Bash
---

# Skyline 渲染引擎技能

微信小程序 Skyline 渲染引擎的完整开发指南，涵盖组件、样式、动画、路由、滚动 API 和配置迁移。

## When to Use This Skill

This skill should be triggered when:

- Developing WeChat Mini Programs with the Skyline rendering engine
- Working with Skyline-specific components (scroll-view enhanced mode, draggable-sheet, share-element, etc.)
- Implementing worklet animations (SharedValue, timing, spring, decay)
- Using custom routes and page transitions (routeBuilder, open-container)
- Checking WXSS/CSS property compatibility under Skyline
- Configuring Skyline renderer in app.json / page.json
- Migrating from WebView to Skyline
- Using Skyline scroll APIs (ScrollViewContext, DraggableSheetContext)

## Module Reference Guide

This skill is organized into 7 modules. Use `Read` tool to access specific reference files when detailed information is needed.

### 1. Overview — 概览与迁移指南

**Path**: `references/overview/SKILL.md`

Skyline architecture, performance advantages, feature overview, migration guide and best practices.

- `references/overview/references/introduction/` — Architecture & features
- `references/overview/references/migration/` — Migration guide & compatibility
- `references/overview/references/performance/` — Performance comparison
- `references/overview/references/api/` — getSkylineInfo, preloadSkylineView
- `references/overview/references/changelog/` — Changelog

### 2. Config — JSON 配置规范

**Path**: `references/config/SKILL.md`

app.json, page.json, and project.config.json configuration for Skyline.

- `references/config/references/app-config.md` — App-level configuration
- `references/config/references/page-config.md` — Page-level configuration
- `references/config/references/project-config.md` — Project configuration
- `references/config/references/patterns.md` — Common patterns

### 3. Components — 组件开发指南

**Path**: `references/components/SKILL.md`

scroll-view enhanced modes, swiper, form components, media, draggable-sheet, share-element, snapshot.

- `references/components/references/scroll/` — scroll-view, nested-scroll, list-grid-view, sticky, draggable-sheet
- `references/components/references/layout/` — swiper
- `references/components/references/form/` — input
- `references/components/references/media/` — image, text
- `references/components/references/special/` — share-element, snapshot

### 4. WXSS — 样式支持

**Path**: `references/wxss/SKILL.md`

CSS property support and limitations under Skyline.

- `references/wxss/references/basics.md` — Basic properties
- `references/wxss/references/layout.md` — Layout (flex, grid)
- `references/wxss/references/flex.md` — Flexbox details
- `references/wxss/references/text.md` — Text properties
- `references/wxss/references/visual.md` — Visual effects (filter, gradient, mask)
- `references/wxss/references/animation.md` — CSS animations & transitions

### 5. Worklet — 动画系统

**Path**: `references/worklet/SKILL.md`

Worklet functions, SharedValue, timing/spring/decay animations, easing, and thread communication.

- `references/worklet/references/core/` — Worklet overview
- `references/worklet/references/base/` — SharedValue, derived values
- `references/worklet/references/animation/` — timing, spring, decay, easing, combine
- `references/worklet/references/tool/` — runOnUI, runOnJS thread communication

### 6. Route — 自定义路由与转场

**Path**: `references/route/SKILL.md`

Custom route animations, preset routes, pop gesture, open-container, and Router API.

- `references/route/references/custom-route/` — Custom route guide & patterns
- `references/route/references/preset-route/` — 7 preset route types
- `references/route/references/pop-gesture/` — Back gesture customization
- `references/route/references/open-container/` — Container transitions
- `references/route/references/api/` — navigateTo, route events, router API

### 7. Scroll API — 滚动控制 API

**Path**: `references/scroll-api/SKILL.md`

ScrollViewContext, DraggableSheetContext, worklet scroll context.

- `references/scroll-api/references/api/` — ScrollViewContext, DraggableSheetContext, worklet scroll
- `references/scroll-api/references/patterns.md` — Common scroll patterns

## Quick Start

### Enable Skyline in app.json

```json
{
  "renderer": "skyline",
  "rendererOptions": {
    "skyline": {
      "defaultDisplayBlock": true,
      "defaultContentBox": true,
      "disableABTest": true
    }
  },
  "componentFramework": "glass-easel",
  "lazyCodeLoading": "requiredComponents"
}
```

### Basic Page Structure

```html
<scroll-view type="list" scroll-y style="height: 100vh">
  <view class="container">
    <!-- Page content -->
  </view>
</scroll-view>
```

> **Note**: In Skyline, pages do not scroll by default. You must use `<scroll-view>` for scrollable content.

## Resources

- [Skyline Official Documentation](https://developers.weixin.qq.com/miniprogram/dev/framework/runtime/skyline/introduction/)
- [Component Demo Mini Program](https://developers.weixin.qq.com/s/8Yj2sjmb7MGL)
- [Migration Guide](https://developers.weixin.qq.com/miniprogram/dev/framework/runtime/skyline/migration/)
