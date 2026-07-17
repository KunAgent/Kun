# 路由动画代码模式

## 模式 1：从右滑入（基础模式）

最简单的自定义路由，页面从右侧滑入。

```js
function SlideRouteBuilder({ primaryAnimation }) {
  const { windowWidth } = wx.getWindowInfo()

  const handlePrimaryAnimation = () => {
    'worklet'
    const transX = windowWidth * (1 - primaryAnimation.value)
    return {
      transform: `translateX(${transX}px)`,
    }
  }

  return { handlePrimaryAnimation }
}

wx.router.addRouteBuilder('slide', SlideRouteBuilder)
wx.navigateTo({ url: 'pageB', routeType: 'slide' })
```

## 模式 2：半屏弹窗（4 步完整实现）

### Step 1：B 页自底向上弹出

```js
const HalfScreenDialogRouteBuilder = (customRouteContext) => {
  const { primaryAnimation } = customRouteContext
  const { screenHeight } = wx.getWindowInfo()

  const handlePrimaryAnimation = () => {
    'worklet'
    let t = primaryAnimation.value
    const topDistance = 0.12
    const marginTop = topDistance * screenHeight
    const pageHeight = (1 - topDistance) * screenHeight
    const transY = pageHeight * (1 - t)
    return {
      overflow: 'hidden',
      borderRadius: '10px',
      marginTop: `${marginTop}px`,
      height: `${pageHeight}px`,
      transform: `translateY(${transY}px)`,
    }
  }

  return { handlePrimaryAnimation }
}
```

### Step 2：添加动画曲线

使用 CurveAnimation 使动画更自然，并设置 `opaque: false` 使前一页可见：

```js
const HalfScreenDialogRouteBuilder = (customRouteContext) => {
  const {
    primaryAnimation,
    primaryAnimationStatus,
  } = customRouteContext
  const { screenHeight } = wx.getWindowInfo()

  const _curvePrimaryAnimation = CurveAnimation({
    animation: primaryAnimation,
    animationStatus: primaryAnimationStatus,
    curve: Curves.linearToEaseOut,
    reverseCurve: Curves.easeInToLinear,
  })

  const handlePrimaryAnimation = () => {
    'worklet'
    let t = _curvePrimaryAnimation.value
    const topDistance = 0.12
    const marginTop = topDistance * screenHeight
    const pageHeight = (1 - topDistance) * screenHeight
    const transY = pageHeight * (1 - t)
    return {
      overflow: 'hidden',
      borderRadius: '10px',
      marginTop: `${marginTop}px`,
      height: `${pageHeight}px`,
      transform: `translateY(${transY}px)`,
    }
  }

  return {
    opaque: false,
    handlePrimaryAnimation,
  }
}
```

### Step 3：A 页下沉联动效果

在 A 页的 routeBuilder 中添加 `handleSecondaryAnimation`：

```js
function ScaleTransitionRouteBuilder(customRouteContext) {
  const {
    primaryAnimation,
    secondaryAnimation,
    secondaryAnimationStatus,
  } = customRouteContext
  const { windowWidth, screenHeight } = wx.getWindowInfo()

  const handlePrimaryAnimation = () => {
    'worklet'
    const transX = windowWidth * (1 - primaryAnimation.value)
    return {
      transform: `translateX(${transX}px)`,
    }
  }

  const _curveSecondaryAnimation = CurveAnimation({
    animation: secondaryAnimation,
    animationStatus: secondaryAnimationStatus,
    curve: Curves.fastOutSlowIn,
  })

  const handleSecondaryAnimation = () => {
    'worklet'
    let t = _curveSecondaryAnimation.value
    const scale = 0.08
    const topDistance = 0.1
    const transY = screenHeight * (topDistance - 0.5 * scale) * t
    return {
      overflow: 'hidden',
      borderRadius: `${12 * t}px`,
      transform: `translateY(${transY}px) scale(${1 - scale * t})`,
    }
  }

  return {
    handlePrimaryAnimation,
    handleSecondaryAnimation,
  }
}
```

### Step 4：手势返回

在 B 页绑定手势，控制路由动画进度：

```html
<!-- WXML: 在页面左侧放置手势区域 -->
<horizontal-drag-gesture-handler onGestureEvent="handleHorizontalDrag">
  <view class="gesture-back-area"></view>
</horizontal-drag-gesture-handler>
```

```js
// GestureState 枚举
const GestureState = {
  POSSIBLE: 0,
  BEGIN: 1,
  ACTIVE: 2,
  END: 3,
  CANCELLED: 4,
}

Page({
  handleDragStart() {
    'worklet'
    const { startUserGesture } = this.customRouteContext
    startUserGesture()
  },

  handleDragUpdate(delta) {
    'worklet'
    const { primaryAnimation } = this.customRouteContext
    const newVal = primaryAnimation.value - delta
    primaryAnimation.value = clamp(newVal, 0.0, 1.0)
  },

  handleDragEnd(velocity) {
    'worklet'
    const { primaryAnimation, stopUserGesture, didPop } =
      this.customRouteContext

    // 判断是否返回：速度大于阈值 → 按速度方向；否则按拖动距离
    let animateForward = false
    if (Math.abs(velocity) >= 1.0) {
      animateForward = velocity <= 0
    } else {
      animateForward = primaryAnimation.value > 0.5
    }

    const t = primaryAnimation.value
    const animationCurve = Curves.fastLinearToSlowEaseIn

    if (animateForward) {
      // 恢复到当前页
      const duration = Math.min(Math.floor(lerp(300, 0, t)), 300)
      primaryAnimation.value = timing(
        1.0,
        { duration, easing: animationCurve },
        () => {
          'worklet'
          stopUserGesture()
        }
      )
    } else {
      // 返回上一页
      const duration = Math.floor(lerp(0, 300, t))
      primaryAnimation.value = timing(
        0.0,
        { duration, easing: animationCurve },
        () => {
          'worklet'
          didPop()
          stopUserGesture()
        }
      )
    }
  },

  handleHorizontalDrag(gestureEvent) {
    'worklet'
    const { windowWidth } = wx.getWindowInfo()
    if (gestureEvent.state === GestureState.BEGIN) {
      this.handleDragStart()
    } else if (gestureEvent.state === GestureState.ACTIVE) {
      const delta = gestureEvent.deltaX / windowWidth
      this.handleDragUpdate(delta)
    } else if (gestureEvent.state === GestureState.END) {
      const velocity = gestureEvent.velocityX / windowWidth
      this.handleDragEnd(velocity)
    } else if (gestureEvent.state === GestureState.CANCELLED) {
      this.handleDragEnd(0.0)
    }
  },
})
```

## 模式 3：下滑返回（纵向手势）

适用于自底向上弹出的页面：

```html
<vertical-drag-gesture-handler onGestureEvent="handleVerticalDrag">
  <view class="page-content">
    <!-- 页面内容 -->
  </view>
</vertical-drag-gesture-handler>
```

```js
Page({
  handleVerticalDrag(gestureEvent) {
    'worklet'
    const { screenHeight } = wx.getWindowInfo()
    if (gestureEvent.state === GestureState.BEGIN) {
      this.customRouteContext.startUserGesture()
    } else if (gestureEvent.state === GestureState.ACTIVE) {
      const delta = gestureEvent.deltaY / screenHeight
      const { primaryAnimation } = this.customRouteContext
      primaryAnimation.value = clamp(primaryAnimation.value - delta, 0.0, 1.0)
    } else if (gestureEvent.state === GestureState.END) {
      const velocity = gestureEvent.velocityY / screenHeight
      // 复用 handleDragEnd 逻辑
      this.handleDragEnd(velocity)
    } else if (gestureEvent.state === GestureState.CANCELLED) {
      this.handleDragEnd(0.0)
    }
  },
})
```

## 模式 4：页面渐显效果

```js
const FadeRouteBuilder = ({ primaryAnimation }) => {
  const handlePrimaryAnimation = () => {
    'worklet'
    return {
      opacity: primaryAnimation.value,
    }
  }

  return {
    opaque: false,
    handlePrimaryAnimation,
  }
}

wx.router.addRouteBuilder('fade', FadeRouteBuilder)
```

## 模式 5：使用 handlePreviousPageAnimation

当 A 页跳 B 页和 C 页需要不同的联动效果时：

```js
// C 页的 routeBuilder 同时控制 C 页进入动画和 A 页的联动
const CRouteBuilder = (routeContext) => {
  const { primaryAnimation } = routeContext

  const handlePrimaryAnimation = () => {
    'worklet'
    let t = primaryAnimation.value
    // C 页自己的进入动画
    return { transform: `translateY(${(1 - t) * 100}%)` }
  }

  const handlePreviousPageAnimation = () => {
    'worklet'
    let t = primaryAnimation.value
    // 控制 A 页的联动效果
    return {
      transform: `scale(${1 - 0.05 * t})`,
      opacity: `${1 - 0.3 * t}`,
    }
  }

  return {
    handlePrimaryAnimation,
    handlePreviousPageAnimation,
  }
}
```

## CurveAnimation 和 Curves 工具代码

```js
const { Easing, derived } = wx.worklet

// 预定义曲线
const Curves = {
  fastLinearToSlowEaseIn: Easing.cubicBezier(0.18, 1.0, 0.04, 1.0),
  linearToEaseOut: Easing.cubicBezier(0.35, 0.91, 0.33, 0.97),
  easeInToLinear: Easing.cubicBezier(0.67, 0.03, 0.65, 0.09),
  fastOutSlowIn: Easing.cubicBezier(0.4, 0.0, 0.2, 1.0),
}

// AnimationStatus 枚举
const AnimationStatus = {
  dismissed: 0,
  forward: 1,
  reverse: 2,
  completed: 3,
}

// 曲线动画封装
function CurveAnimation({ animation, animationStatus, curve, reverseCurve }) {
  return derived(() => {
    'worklet'
    const useForwardCurve =
      !reverseCurve || animationStatus.value !== AnimationStatus.reverse
    const activeCurve = useForwardCurve ? curve : reverseCurve
    const t = animation.value
    if (!activeCurve) return t
    if (t === 0 || t === 1) return t
    return activeCurve(t)
  })
}

// 辅助函数
function clamp(value, min, max) {
  'worklet'
  return Math.min(Math.max(value, min), max)
}

function lerp(a, b, t) {
  'worklet'
  return a + (b - a) * t
}
```
