---
name: skyline-route
description: Skyline 自定义路由与页面转场技能。涵盖自定义路由动画（routeBuilder）、预设路由（7 种 wx:// 类型）、页面返回手势、容器转场动画（open-container）、Router API。适用于实现半屏弹窗、页面缩放、底部弹出、卡片展开等转场效果。触发关键词：自定义路由、custom-route、routeBuilder、navigateTo、页面转场、半屏、预设路由、返回手势、open-container。
---

# Skyline 自定义路由与页面转场

## 适用场景

- 实现自定义页面转场动画（半屏、缩放、渐显等）
- 使用预设路由快速实现常见转场效果
- 配置页面返回手势（横向/纵向/多方向）
- 实现卡片展开到详情页的容器转场动画
- 通过 Router API 管理自定义路由

## 核心概念

### 路由能力层级

| 层级 | 能力 | 适用场景 |
|------|------|----------|
| 预设路由 | 一行代码使用 7 种内置效果 | 快速实现常见转场 |
| 自定义路由 | 通过 routeBuilder 完全控制动画 | 高度定制化转场 |
| 容器转场 | `<open-container>` 元素级过渡 | 卡片展开到详情页 |

### 动画控制器

| 属性 | 说明 |
|------|------|
| primaryAnimation | 页面进入/退出动画进度（0→1 进入，1→0 退出） |
| secondaryAnimation | 下一页进入时当前页动画进度（与下一页 primaryAnimation 同步） |
| userGestureInProgress | 当前路由进度是否由手势控制 |
| startUserGesture / stopUserGesture | 手势接管/释放路由控制 |
| didPop | 确认返回上一页 |

## 文档索引

根据需求快速定位（路径相对于 `references/`）：

| 我想要... | 查阅文档 |
|-----------|----------|
| 了解自定义路由原理和接口 | `custom-route/custom-route-guide.md` |
| 查看半屏/手势返回代码模式 | `custom-route/route-patterns.md` |
| 快速使用预设路由 | `preset-route/preset-route.md` |
| 配置页面返回手势 | `pop-gesture/pop-gesture.md` |
| 实现卡片展开转场 | `open-container/open-container.md` |
| 查看 Router API | `api/router-api.md` |
| 了解 navigateTo 路由参数 | `api/navigate-to.md` |
| 监听路由事件 | `api/route-events.md` |

## 强制规则

### MUST（必须遵守）

1. **自定义路由仅在连续 Skyline 页面间生效**：WebView 页面不支持自定义路由
   ```js
   // ✅ A 页(Skyline) → B 页(Skyline)：自定义路由生效
   // ❌ A 页(WebView) → B 页(Skyline)：降级为默认路由
   ```

2. **动画处理函数必须声明 'worklet' 指令**：
   ```js
   // ✅ 正确
   const handlePrimaryAnimation = () => {
     'worklet'
     return { transform: `translateX(${...}px)` }
   }
   
   // ❌ 错误：缺少 worklet 指令，无法在 UI 线程执行
   const handlePrimaryAnimation = () => {
     return { transform: `translateX(${...}px)` }
   }
   ```

3. **手势接管必须成对调用 startUserGesture / stopUserGesture**：
   ```js
   // ✅ 正确
   handleDragStart() {
     'worklet'
     this.customRouteContext.startUserGesture()
   }
   handleDragEnd() {
     'worklet'
     // ... 动画完成回调中：
     stopUserGesture()
   }
   ```

4. **确认返回时必须调用 didPop**：引擎无法自动判断开发者是否要退出页面
   ```js
   // ✅ 正确：动画完成后调用 didPop
   primaryAnimation.value = timing(0.0, { duration }, () => {
     'worklet'
     didPop()
     stopUserGesture()
   })
   ```

5. **navigator 组件在 Skyline 下只能嵌套文本节点**：
   ```html
   <!-- ✅ 正确 -->
   <navigator url="/page">点击跳转</navigator>
   
   <!-- ❌ 错误：不能嵌套 view 等普通节点 -->
   <navigator url="/page"><view>跳转</view></navigator>
   ```

### NEVER（禁止行为）

1. **NEVER** 在手势处理中忘记调用 `startUserGesture` 就直接修改 `primaryAnimation.value`
2. **NEVER** 假设自定义路由在 WebView 页面生效（低版本基础库会降级）
3. **NEVER** 在非 worklet 函数中访问 `primaryAnimation.value`

## Quick Reference

### 预设路由速查

| routeType | 效果 | 最低基础库 |
|-----------|------|-----------|
| `wx://bottom-sheet` | 底部弹出半屏 | 3.1.0 |
| `wx://upwards` | 自底向上全屏 | 3.1.0 |
| `wx://zoom` | 缩放进入 | 3.1.0 |
| `wx://cupertino-modal` | iOS 风格模态 | 3.1.0 |
| `wx://cupertino-modal-inside` | iOS 模态内嵌 | 3.1.0 |
| `wx://modal-navigation` | 模态导航 | 3.1.0 |
| `wx://modal` | 模态弹窗 | 3.1.0 |

```js
// 使用预设路由
wx.navigateTo({
  url: 'xxx',
  routeType: 'wx://bottom-sheet',
  routeOptions: { height: 60, round: true }
})
```

### API 速查

| API | 说明 | 最低基础库 |
|-----|------|-----------|
| `wx.router.addRouteBuilder(type, builder)` | 注册自定义路由 | 2.29.2 |
| `wx.router.removeRouteBuilder(type)` | 移除自定义路由 | 2.29.2 |
| `wx.router.getRouteContext(this)` | 获取路由上下文 | 2.29.2 |
| `wx.navigateTo({ routeType })` | 指定路由类型跳转 | 2.29.2 |
| `wx.navigateTo({ routeConfig })` | 覆盖路由配置 | 3.4.0 |
| `wx.navigateTo({ routeOptions })` | 传入路由参数 | 3.4.0 |
| `wx.navigateTo({ withOpenContainer })` | 容器转场跳转 | 3.12.2 |
| `wx.onBeforeAppRoute(fn)` | 路由执行前监听 | 3.5.5 |
| `wx.onAppRoute(fn)` | 路由执行后监听 | 3.5.5 |

### 自定义路由最小示例

```js
// 注册：从右滑入
wx.router.addRouteBuilder('slide', ({ primaryAnimation }) => {
  const { windowWidth } = wx.getWindowInfo()
  const handlePrimaryAnimation = () => {
    'worklet'
    const transX = windowWidth * (1 - primaryAnimation.value)
    return { transform: `translateX(${transX}px)` }
  }
  return { handlePrimaryAnimation }
})

// 跳转
wx.navigateTo({ url: 'pageB', routeType: 'slide' })
```

### 场景决策表

| 场景 | 推荐方案 |
|------|----------|
| 底部弹出半屏 | 预设路由 `wx://bottom-sheet` |
| iOS 风格模态 | 预设路由 `wx://cupertino-modal` |
| 自定义半屏 + 手势 | 自定义路由 + handlePrimaryAnimation |
| 卡片展开到详情页 | `<open-container>` 容器转场 |
| 页面渐显效果 | 自定义路由 + opacity 动画 |
| 需要纵向返回手势 | `popGestureDirection: 'vertical'` |

## 相关技能

| 场景 | 推荐技能 | 说明 |
|------|----------|------|
| 动画开发 | `skyline-worklet` | Worklet 动画系统（timing/spring/Easing） |
| 手势处理 | `skyline-components` | gesture-handler 手势组件 |
| 共享元素 | `skyline-components` | share-element 页面间动画 |
| 配置详解 | `skyline-config` | app.json/page.json 配置 |
| 概览迁移 | `skyline-overview` | Skyline 概览与迁移指南 |

## References 目录结构

```
references/
├── custom-route/
│   ├── custom-route-guide.md    # 自定义路由完整指南（接口、原理、联动）
│   └── route-patterns.md        # 路由动画代码模式（半屏、手势、渐显）
├── preset-route/
│   └── preset-route.md          # 预设路由类型与 routeOptions
├── pop-gesture/
│   └── pop-gesture.md           # 返回手势配置与 scroll-view 联动
├── open-container/
│   └── open-container.md        # 容器转场动画组件
└── api/
    ├── router-api.md            # wx.router API（add/remove/getContext）
    ├── navigate-to.md           # wx.navigateTo 路由参数
    └── route-events.md          # wx.onBeforeAppRoute/onAppRoute
```
