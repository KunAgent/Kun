# Drawer 抽屉

## 示例

该组件于 0.7.2 版本上线，请留意版本。
## 引入

全局引入，在 miniprogram 根目录下的`app.json`中配置，局部引入，在需要引入的页面或组件的`index.json`中配置。

```json
"usingComponents": {
"t-drawer": "tdesign-miniprogram/drawer/drawer"
}
```

## 代码演示

[在开发者工具中预览效果](https://developers.weixin.qq.com/s/UMv9BMmK885L)

> Tips: 请确保开发者工具为打开状态。导入开发者工具后，依次执行：npm i > 构建npm包 > 勾选 "将JS编译成ES5"

### 基础抽屉

**WXML** (`html`):
```html
<t-button variant="outline" bind:tap="openDrawerBase" block size="large" theme="primary">基础抽屉</t-button>

<t-drawer
visible="{{visible}}"
placement="{{placement}}"
items="{{sidebar}}"
usingCustomNavbar
bind:overlay-click="overlayClick"
bind:item-click="itemClick"
></t-drawer>

```

**JS** (`javascript`):
```javascript
import SkylineBehavior from '@behaviors/skyline.js';

Component({
behaviors: [SkylineBehavior],
data: {
placement: 'left',
sidebar: [],
baseSidebar: [
{
title: '菜单一',
},
{
title: '菜单二',
},
{
title: '菜单三',
},
{
title: '菜单四',
},
{
title: '菜单五',
},
{
title: '菜单六',
},
{
title: '菜单七',
},
{
title: '菜单八',
},
],
},

/**
* 组件的方法列表
*/
methods: {
openDrawerBase() {
this.setData({
visible: true,
sidebar: this.data.baseSidebar,
});
},

itemClick(e) {
console.log(e.detail);
},

overlayClick(e) {
console.log(e.detail);
},
},
});

```

**CSS** (`css`):
```css

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-button": "tdesign-miniprogram/button/button",
"t-drawer": "tdesign-miniprogram/drawer/drawer"
}
}

```

### 带图标的抽屉

**WXML** (`html`):
```html
<t-button variant="outline" block bind:tap="openDrawerIcon" size="large" theme="primary">带图标抽屉</t-button>

<t-drawer
visible="{{visible}}"
placement="{{placement}}"
items="{{sidebar}}"
usingCustomNavbar
bind:overlay-click="overlayClick"
bind:item-click="itemClick"
></t-drawer>

```

**JS** (`javascript`):
```javascript
Component({
data: {
placement: 'left',
sidebar: [],
iconSidebar: [
{
title: '菜单一',
icon: 'app',
},
{
title: '菜单二',
icon: 'app',
},
{
title: '菜单三',
icon: 'app',
},
{
title: '菜单四',
icon: 'app',
},
{
title: '菜单五',
icon: 'app',
},
{
title: '菜单六',
icon: 'app',
},
{
title: '菜单七',
icon: 'app',
},
{
title: '菜单八',
icon: 'app',
},
],
},

/**
* 组件的方法列表
*/
methods: {
openDrawerIcon() {
this.setData({
visible: true,
sidebar: this.data.iconSidebar,
});
},

itemClick(e) {
console.log(e.detail);
},

overlayClick(e) {
console.log(e.detail);
},
},
});

```

**CSS** (`css`):
```css

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-button": "tdesign-miniprogram/button/button",
"t-drawer": "tdesign-miniprogram/drawer/drawer"
}
}

```

> Drawer的 `visible` 是受控的，需要手动设置 `visible` 为 `true` 才会开启抽屉

## API

### DrawerProps

| 名称 | 类型 | 默认值 | 描述 | 必传 |
| --- | --- | --- | --- | --- |
| style | Object | - | 样式 | N |
| custom-style | Object | - | 样式，一般用于开启虚拟化组件节点场景 | N |
| close-on-overlay-click | Boolean | true | 点击蒙层时是否触发抽屉关闭事件 | N |
| destroy-on-close | Boolean | false | 抽屉关闭时是否销毁节点 | N |
| items | Array | - | 抽屉里的列表项。TS 类型：`DrawerItem[]``interface DrawerItem { title: string; icon: string; }`。详细类型定义 | N |
| overlay-props | Object | {} | 遮罩层的属性，透传至 overlay。TS 类型：`OverlayProps`，Overlay API Documents。详细类型定义 | N |
| placement | String | right | 抽屉方向。可选项：left/right | N |
| show-overlay | Boolean | true | 是否显示遮罩层 | N |
| title | String | - | `0.29.0`。抽屉的标题 | N |
| using-custom-navbar | Boolean | false | 是否使用了自定义导航栏 | N |
| visible | Boolean | false | 组件是否可见 | N |
| z-index | Number | 11500 | 抽屉层级，样式默认为 11500 | N |

### DrawerSlots

| 名称 | 描述 |
| --- | --- |
| footer | `0.29.0`。抽屉的底部 |
| title | `0.29.0`。抽屉的标题 |

### DrawerEvents

| 名称 | 参数 | 描述 |
| --- | --- | --- |
| close | `(trigger: DrawerTriggerSource)` | 关闭时触发。。详细类型定义。<br>`type DrawerTriggerSource = 'overlay'`<br> |
| item-click | `(index: number; item: DrawerItem)` | 点击抽屉里的列表项 |
| overlay-click | - | 如果蒙层存在，点击蒙层时触发 |

### DrawerSlots

| 名称 | 描述 |
| --- | --- |
| - | 自定义抽屉的底部 |
| footer | `0.29.0`。抽屉的底部 |
| title | `0.29.0`。自定义`title`显示内容 |

### CSSVariables

组件提供了下列 CSS 变量，可用于自定义样式。

| 名称 | 默认值 | 描述 |
| --- | --- | --- |
| --td-drawer-bg-color | @bg-color-container | - |
| --td-drawer-border-color | @border-level-1-color | - |
| --td-drawer-footer-padding-bottom | 40rpx | - |
| --td-drawer-hover-color | @bg-color-secondarycontainer | - |
| --td-drawer-item-icon-color | @drawer-title-color | - |
| --td-drawer-item-icon-size | 48rpx | - |
| --td-drawer-item-padding | 32rpx | - |
| --td-drawer-sidebar-height | 70vh | - |
| --td-drawer-title-color | @text-color-primary | - |
| --td-drawer-title-font | @font-title-large | - |
| --td-drawer-title-padding | 48rpx 32rpx 16rpx | - |
| --td-drawer-width | 560rpx | - |