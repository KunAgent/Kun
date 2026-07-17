# wx.navigateTo 路由参数

## 概述

`wx.navigateTo` 保留当前页面，跳转到应用内的某个页面。基础库 2.29.2 起支持自定义路由相关参数。

## 路由相关参数

| 属性 | 类型 | 必填 | 说明 | 最低基础库 |
|------|------|------|------|-----------|
| url | string | 是 | 跳转页面路径（非 tabBar），路径后可带参数 | 1.0.0 |
| routeType | string | 否 | 自定义路由类型（通过 `addRouteBuilder` 注册的名称或 `wx://` 预设类型） | 2.29.2 |
| routeConfig | Object | 否 | 自定义路由配置，覆盖 routeBuilder 返回的配置 | 3.4.0 |
| routeOptions | Object | 否 | 自定义路由参数，作为 routeBuilder 的第二个参数 | 3.4.0 |
| withOpenContainer | Object | 否 | Skyline 下指定路由动画所用 OpenContainer 实例 | 3.12.2 |
| events | Object | 否 | 页面间通信接口 | 2.7.3 |
| success | function | 否 | 成功回调，参数含 `eventChannel` | - |
| fail | function | 否 | 失败回调 | - |
| complete | function | 否 | 完成回调 | - |

## 使用自定义路由

```js
// 1. 使用已注册的自定义路由
wx.navigateTo({
  url: 'pageB',
  routeType: 'myCustomRoute'
})

// 2. 使用预设路由
wx.navigateTo({
  url: 'pageB',
  routeType: 'wx://bottom-sheet'
})
```

## routeConfig 覆盖配置

`routeConfig` 接受 `CustomRouteConfig` 的所有字段，传入的值会**覆盖** routeBuilder 返回的配置：

```js
wx.navigateTo({
  url: 'pageB',
  routeType: 'wx://bottom-sheet',
  routeConfig: {
    popGestureDirection: 'vertical',
    fullscreenDrag: true,
    transitionDuration: 500,
    barrierDismissible: true,
    barrierColor: 'rgba(0,0,0,0.5)',
  }
})
```

## routeOptions 动态参数

`routeOptions` 作为 routeBuilder 函数的**第二个参数**传入：

```js
// 跳转时传入参数
wx.navigateTo({
  url: 'pageB',
  routeType: 'wx://bottom-sheet',
  routeOptions: {
    height: 80,
    round: false,
  }
})

// routeBuilder 中接收
const myRouteBuilder = (routeContext, routeOptions) => {
  const height = routeOptions.height || 60
  // ...使用 height 控制动画
}
```

## withOpenContainer 容器转场

Skyline 渲染引擎下，通过 `withOpenContainer` 指定容器转场动画的 OpenContainer 实例：

```js
Page({
  goDetail() {
    this.createSelectorQuery()
      .select('.my-container')
      .node()
      .exec(res => {
        wx.navigateTo({
          url: 'detailPage',
          withOpenContainer: res[0].node,
        })
      })
  }
})
```

## 页面间通信（EventChannel）

```js
// 发起页
wx.navigateTo({
  url: 'test?id=1',
  events: {
    acceptDataFromOpenedPage(data) {
      console.log(data)
    },
  },
  success(res) {
    res.eventChannel.emit('acceptDataFromOpenerPage', { data: 'test' })
  }
})

// 被打开页面（test.js）
Page({
  onLoad(option) {
    const eventChannel = this.getOpenerEventChannel()
    eventChannel.emit('acceptDataFromOpenedPage', { data: 'test' })
    eventChannel.on('acceptDataFromOpenerPage', function(data) {
      console.log(data)
    })
  }
})
```

## 重要约束

- **不能跳转到 tabBar 页面**
- **页面栈最多十层**（连续 Skyline 页面不受此限制）
- 低版本基础库会降级到默认路由动画，不会报错
- 插件页面与宿主页面之间不能互相调用
