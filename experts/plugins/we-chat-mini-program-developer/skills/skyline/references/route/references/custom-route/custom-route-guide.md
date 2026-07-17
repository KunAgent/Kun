# 自定义路由完整指南

## 概述

Skyline 渲染引擎支持在**连续的 Skyline 页面**间跳转时实现自定义路由效果。通过 `wx.router.addRouteBuilder` 注册路由动画定义函数，在 `wx.navigateTo` 时指定 `routeType` 触发。

## 核心接口定义

### CustomRouteBuilder

```js
type CustomRouteBuilder = (
  routeContext: CustomRouteContext,
  routeOptions: Record<string, any>
) => CustomRouteConfig
```

`routeBuilder` 函数接收两个参数：
- `routeContext`：路由上下文，包含动画控制器和手势控制方法
- `routeOptions`：通过 `wx.navigateTo({ routeOptions })` 传入的自定义参数（基础库 3.4.0+）

### CustomRouteContext

```js
interface CustomRouteContext {
  // 动画控制器，影响推入页面的进入和退出过渡效果
  primaryAnimation: SharedValue<number>
  // 动画控制器状态
  primaryAnimationStatus: SharedValue<number>
  // 动画控制器，影响栈顶页面的推出过渡效果
  secondaryAnimation: SharedValue<number>
  // 动画控制器状态
  secondaryAnimationStatus: SharedValue<number>
  // 当前路由进度由手势控制
  userGestureInProgress: SharedValue<number>
  // 手势开始控制路由
  startUserGesture: () => void
  // 手势不再控制路由
  stopUserGesture: () => void
  // 返回上一级，效果同 wx.navigateBack
  didPop: () => void
}
```

### CustomRouteConfig

```js
interface CustomRouteConfig {
  // 下一个页面推入后，不显示前一个页面（默认 true）
  opaque?: boolean
  // 是否保持前一个页面状态（默认 true）
  maintainState?: boolean
  // 页面推入动画时长，单位 ms（默认 300）
  transitionDuration?: number
  // 页面推出动画时长，单位 ms（默认 300）
  reverseTransitionDuration?: number
  // 遮罩层背景色，支持 rgba() 和 #RRGGBBAA（默认空）
  barrierColor?: string
  // 点击遮罩层返回上一页（默认 false）
  barrierDismissible?: boolean
  // 无障碍语义（默认空）
  barrierLabel?: string
  // 是否与下一个页面联动（默认 true）
  canTransitionTo?: boolean
  // 是否与前一个页面联动（默认 true）
  canTransitionFrom?: boolean
  // 处理当前页的进入/退出动画，返回 StyleObject
  handlePrimaryAnimation?: RouteAnimationHandler
  // 处理当前页的压入/压出动画，返回 StyleObject
  handleSecondaryAnimation?: RouteAnimationHandler
  // 处理上一级页面的压入/压出动画（基础库 3.0.0+）
  handlePreviousPageAnimation?: RouteAnimationHandler
  // 页面进入时是否采用 snapshot 模式优化（基础库 3.2.0+）
  allowEnterRouteSnapshotting?: boolean
  // 页面退出时是否采用 snapshot 模式优化（基础库 3.2.0+）
  allowExitRouteSnapshotting?: boolean
  // 右滑返回时拖动范围是否撑满屏幕（基础库 3.2.0+，默认 false）
  fullscreenDrag?: boolean
  // 返回手势方向（基础库 3.4.0+，默认 'horizontal'）
  popGestureDirection?: 'horizontal' | 'vertical' | 'multi'
}

type RouteAnimationHandler = () => { [key: string]: any }
```

### AnimationStatus 枚举

```js
enum AnimationStatus {
  dismissed = 0,  // 动画停在起点
  forward = 1,    // 动画从起点向终点进行
  reverse = 2,    // 动画从终点向起点进行
  completed = 3,  // 动画停在终点
}
```

## 工作原理

### 路由生命周期

路由分为 3 个阶段：

1. **push 阶段**：调用 `wx.navigateTo`
   - B 页 `primaryAnimation`：`0 → 1`（进入）
   - A 页 `secondaryAnimation`：`0 → 1`（压入）

2. **手势拖动**：用户在 B 页上滑动
   - B 页 `primaryAnimation` 随手势变化
   - A 页 `secondaryAnimation` 同步变化

3. **pop 阶段**：调用 `wx.navigateBack` 或手势返回
   - B 页 `primaryAnimation`：`1 → 0`（退出）
   - A 页 `secondaryAnimation`：`1 → 0`（恢复）

**关键机制**：A 页的 `secondaryAnimation` 值始终与 B 页的 `primaryAnimation` 值同步变化。

### 路由联动控制

| 配置项 | 作用 |
|--------|------|
| `canTransitionTo: true` | 当前页的 `secondaryAnimation` 在下一页推入时生效 |
| `canTransitionTo: false` | 当前页推入下一页时不动 |
| `canTransitionFrom: true` | 当前页推入时，前一页的 `secondaryAnimation` 生效 |
| `canTransitionFrom: false` | 当前页推入时，前一页不动 |

### handlePreviousPageAnimation（基础库 3.0.0+）

用于控制上一级页面的压入/压出动画，简化 A 页跳 B 和 C 页使用不同路由动画的场景。

```js
const routeBuilder = (routeContext) => {
  const { primaryAnimation } = routeContext

  const handlePrimaryAnimation = () => {
    'worklet'
    // 控制当前页的进入和退出
    let t = primaryAnimation.value
    return { /* StyleObject */ }
  }
  
  const handlePreviousPageAnimation = () => {
    'worklet'
    // 控制上一级页面的压入和退出
    let t = primaryAnimation.value
    return { /* StyleObject */ }
  }

  return {
    handlePrimaryAnimation,
    handlePreviousPageAnimation
  }
}
```

## 路由上下文对象

在页面或自定义组件中，可通过 `wx.router.getRouteContext(this)` 获取路由上下文。

```js
Page({
  onLoad() {
    this.customRouteContext = wx.router.getRouteContext(this)
  }
})
```

**小技巧**：可在 `CustomRouteContext` 对象上添加私有属性，在 routeBuilder 中设置、在页面中读取。

## 页面透明背景设置

自定义路由需要前一个页面可见时（如半屏效果），需设置 `opaque: false` 并配置页面背景透明。

### Skyline 下页面背景色层级（4 层）

| 层级 | 设置方式 | 默认值 |
|------|----------|--------|
| 页面背景色 | WXSS `page { background-color: ... }` | 白色 |
| 页面容器背景色 | page.json `backgroundColorContent` | 白色 |
| 自定义路由容器背景色 | StyleObject | 透明 |
| opaque 控制 | CustomRouteConfig.opaque | true（不显示前一页） |

设置透明的方式：
```css
/* WXSS */
page { background-color: transparent; }
```
```json
// page.json
{ "backgroundColorContent": "#ffffff00" }
```

## CurveAnimation 工具函数

用于将线性动画进度映射为曲线进度：

```js
const { Easing, derived } = wx.worklet

const Curves = {
  linearToEaseOut: Easing.cubicBezier(0.35, 0.91, 0.33, 0.97),
  easeInToLinear: Easing.cubicBezier(0.67, 0.03, 0.65, 0.09),
  fastOutSlowIn: Easing.cubicBezier(0.4, 0.0, 0.2, 1.0),
  fastLinearToSlowEaseIn: Easing.cubicBezier(0.18, 1.0, 0.04, 1.0),
}

function CurveAnimation({ animation, animationStatus, curve, reverseCurve }) {
  return derived(() => {
    'worklet'
    const useForwardCurve = !reverseCurve || animationStatus.value !== AnimationStatus.reverse
    const activeCurve = useForwardCurve ? curve : reverseCurve
    const t = animation.value
    if (!activeCurve) return t
    if (t === 0 || t === 1) return t
    return activeCurve(t)
  })
}
```

## 版本要求

| 特性 | 最低基础库 |
|------|-----------|
| 自定义路由基础能力 | 2.29.2 |
| handlePreviousPageAnimation | 3.0.0 |
| 预设路由（7 种） | 3.1.0 |
| allowEnterRouteSnapshotting / allowExitRouteSnapshotting | 3.2.0 |
| fullscreenDrag | 3.2.0 |
| popGestureDirection | 3.4.0 |
| routeConfig / routeOptions | 3.4.0 |
| withOpenContainer | 3.12.2 |

## 示例代码片段

- 半屏完整示例：`https://developers.weixin.qq.com/s/lg8NoymD7AMK`
- handlePreviousPageAnimation 示例：`https://developers.weixin.qq.com/s/Dc8ksymP7jM5`
- 页面渐显示例：`https://developers.weixin.qq.com/s/rL8dGymj7pMu`
