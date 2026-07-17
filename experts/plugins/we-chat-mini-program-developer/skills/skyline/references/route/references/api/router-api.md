# wx.router API 参考

## 概述

`wx.router` 是 Skyline 自定义路由系统的核心 API 对象，提供路由动画的注册、移除和上下文获取功能。

**最低基础库版本**：2.29.2

**限制**：所有 `wx.router` 方法均不支持小程序插件。

## router.addRouteBuilder(routeType, routeBuilder)

添加自定义路由配置，将路由类型名称与路由动画定义函数绑定。

### 参数

| 参数 | 类型 | 说明 |
|------|------|------|
| routeType | string | 路由类型标识（自定义名称） |
| routeBuilder | CustomRouteBuilder | 路由动画定义函数 |

### CustomRouteBuilder 签名

```js
type CustomRouteBuilder = (
  routeContext: CustomRouteContext,
  routeOptions: Record<string, any>
) => CustomRouteConfig
```

- `routeContext`：包含 `primaryAnimation`、`secondaryAnimation` 等动画控制器
- `routeOptions`：通过 `wx.navigateTo({ routeOptions })` 传入的参数（基础库 3.4.0+）

### 代码示例

```js
// 定义自定义路由：从右侧推入
const slideRouteBuilder = (customRouteContext) => {
  const { primaryAnimation } = customRouteContext
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

// 注册
wx.router.addRouteBuilder('slide', slideRouteBuilder)

// 使用
wx.navigateTo({
  url: 'xxx',
  routeType: 'slide'
})
```

### 关键约束

- `handlePrimaryAnimation` / `handleSecondaryAnimation` / `handlePreviousPageAnimation` 必须使用 `'worklet'` 指令
- `routeBuilder` 返回的配置项可被 `wx.navigateTo({ routeConfig })` 覆盖（基础库 3.4.0+）

## router.removeRouteBuilder(routeType)

移除已注册的自定义路由配置。

### 参数

| 参数 | 类型 | 说明 |
|------|------|------|
| routeType | string | 之前注册的路由类型标识 |

### 代码示例

```js
wx.router.removeRouteBuilder('slide')
```

## router.getRouteContext(this)

获取页面对应的自定义路由上下文对象。

### 参数

| 参数 | 类型 | 说明 |
|------|------|------|
| this | Object | 页面或自定义组件实例 |

### 返回值

返回 `CustomRouteContext` 对象，包含以下属性：

| 属性 | 类型 | 说明 |
|------|------|------|
| primaryAnimation | SharedValue\<number\> | 页面进入/退出动画进度 |
| primaryAnimationStatus | SharedValue\<number\> | primaryAnimation 状态 |
| secondaryAnimation | SharedValue\<number\> | 页面被压入/恢复时的动画进度 |
| secondaryAnimationStatus | SharedValue\<number\> | secondaryAnimation 状态 |
| userGestureInProgress | SharedValue\<number\> | 手势是否正在控制路由 |
| startUserGesture | function | 开始手势接管路由 |
| stopUserGesture | function | 结束手势接管路由 |
| didPop | function | 确认返回上一页 |
| routeType | string | 当前路由类型 |

### 代码示例

```js
Page({
  onLoad() {
    this.customRouteContext = wx.router.getRouteContext(this)
    // 可在 worklet 手势处理中使用
  },

  handleGesture(e) {
    'worklet'
    const { primaryAnimation, startUserGesture } = this.customRouteContext
    // ...手势处理逻辑
  }
})
```

### 使用技巧

可在 routeBuilder 中向 `CustomRouteContext` 添加私有属性，然后在页面中通过 `getRouteContext` 读取：

```js
const myRouteBuilder = (routeContext) => {
  // 添加自定义属性
  routeContext.customData = { maxHeight: 500 }
  // ...
  return { handlePrimaryAnimation }
}

// 页面中读取
Page({
  onLoad() {
    const ctx = wx.router.getRouteContext(this)
    console.log(ctx.customData.maxHeight) // 500
  }
})
```

## 示例代码片段

- 自定义路由完整示例：`y1IbQpmA7wGZ`
