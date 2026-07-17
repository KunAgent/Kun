# 深色模式

该特性于 1.3.0 上线，请留意版本。
## 使用之前

使用之前，请确保你已阅读 [微信小程序深色模式适配文档](https://developers.weixin.qq.com/miniprogram/dev/framework/ability/darkmode.html)。

## 实现方案

TDesign Miniprogram 基于 Design Token 变量和媒体查询 `prefers-color-scheme` 实现了深色模式。默认情况下，每个组件自带了组件级别 light 样式变量，无需手动引入。如需使用深色模式，请按照以下步骤操作。

## 使用方式

### 1.修改配置

在 `app.json` 中配置 `darkmode` 为 `true`，即表示当前小程序已适配 DarkMode。

```json
{
"darkmode": true // 开启深色模式
}
```

> ⚠️ 注意：如果你仍然在使用小程序原生导航栏，需要参考 [微信小程序文档](https://developers.weixin.qq.com/miniprogram/dev/framework/ability/darkmode.html#%E7%9B%B8%E5%85%B3%E9%85%8D%E7%BD%AE) 自行适配。

### 2.引入DesignToken样式文件

在 `app.wxss` 中引入 Design Token 文件：

```css
@import 'miniprogram_npm/tdesign-miniprogram/common/style/theme/_index.wxss'; // 引入主题变量
```

### 3.深色模式适配

现在，在页面级别的 `wxss` 文件中，所有的 CSS Variable 都已可用。请替换你的样式文件中原有的颜色值，以实现深色模式适配。

```css
/* 例如 */
.text {
font-size: 28rpx;
color: var(--td-text-color-secondary); // 使用 CSS Variable
}
```

> 💡Tips：所有的 [Design Token](https://github.com/Tencent/tdesign-miniprogram/blob/develop/packages/components/common/style/_variables.less) 可以在这里找到。

### 4.体验深色模式

在微信开发者工具的调试中打开深色模式，请参见 [微信文档](https://developers.weixin.qq.com/miniprogram/dev/framework/ability/darkmode.html#%E5%BC%80%E5%8F%91%E8%80%85%E5%B7%A5%E5%85%B7%E8%B0%83%E8%AF%95)。

## 特殊组件适配深色模式

我们的全局 `CSS Variables` 声明在 `page` 标签选择器下，对非页面内容无效。目前已知两种场景：1. 基于`TabBar`组件的`custom-tab-bar` 组件，`TabBar` 的深色模式失效；2. `root-portal` 组件包裹的组件，在 `webview` 下其深色模式失效。

为了处理这个问题，我们补充了一个同级类选择器：`.page` ，需要在对应的位置手动添加 `.page` 类名。

```html
// 开启虚拟节点
<view class="page" >
<t-tab-bar  />
</view>

// 不开启虚拟节点
<t-tab-bar class="page" />

// root-portal 场景
<root-portal>
<view class="page">
</view>
</root-portal>
```

> 💡Tips：什么是虚拟节点请参考 [微信文档](https://developers.weixin.qq.com/miniprogram/dev/framework/custom-component/wxml-wxss.html#%E8%99%9A%E6%8B%9F%E5%8C%96%E7%BB%84%E4%BB%B6%E8%8A%82%E7%82%B9)。