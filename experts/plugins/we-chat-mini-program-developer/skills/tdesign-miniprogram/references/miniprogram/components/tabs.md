# Tabs 选项卡

## 示例

## 引入

全局引入，在 miniprogram 根目录下的`app.json`中配置，局部引入，在需要引入的页面或组件的`index.json`中配置。

```json
"usingComponents": {
"t-tabs": "tdesign-miniprogram/tabs/tabs",
"t-tab-panel": "tdesign-miniprogram/tab-panel/tab-panel"
}
```

## 代码演示

[在开发者工具中预览效果](https://developers.weixin.qq.com/s/3cEe7Nmu8d5T)

> Tips: 请确保开发者工具为打开状态。导入开发者工具后，依次执行：npm i > 构建npm包 > 勾选 "将JS编译成ES5"

### 基础选项卡

**WXML** (`html`):
```html
<t-tabs defaultValue="{{0}}" bind:change="onTabsChange" bind:click="onTabsClick" t-class="custom-tabs">
<t-tab-panel label="选项" value="0" />
<t-tab-panel label="选项" value="1" />
</t-tabs>

<t-tabs defaultValue="{{0}}" bind:change="onTabsChange" bind:click="onTabsClick" t-class="custom-tabs">
<t-tab-panel label="选项" value="0" />
<t-tab-panel label="选项" value="1" />
<t-tab-panel label="上限六个文字" value="2" />
</t-tabs>

<t-tabs defaultValue="{{0}}" bind:change="onTabsChange" bind:click="onTabsClick" t-class="custom-tabs">
<t-tab-panel label="选项" value="0" />
<t-tab-panel label="选项" value="1" />
<t-tab-panel label="选项" value="2" />
<t-tab-panel label="上限四字" value="3" />
</t-tabs>

<t-tabs
defaultValue="{{0}}"
sticky
stickyProps="{{stickyProps}}"
bind:change="onTabsChange"
bind:click="onTabsClick"
bind:scroll="onStickyScroll"
t-class="custom-tabs"
>
<t-tab-panel label="选项" value="0" />
<t-tab-panel label="选项" value="1" />
<t-tab-panel label="选项" value="2" />
<t-tab-panel label="选项" value="3" />
<t-tab-panel label="上限四字" value="4" />
</t-tabs>

```

**JS** (`javascript`):
```javascript
Component({
data: {
stickyProps: {
zIndex: 100,
},
},
methods: {
onTabsChange(event) {
console.log(`Change tab, tab-panel value is ${event.detail.value}.`);
},

onTabsClick(event) {
console.log(`Click tab, tab-panel value is ${event.detail.value}.`);
},

onStickyScroll(event) {
console.log(event.detail);
},
},
});

```

**CSS** (`css`):
```css
.custom-tabs {
margin-bottom: 32rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-tabs": "tdesign-miniprogram/tabs/tabs",
"t-tab-panel": "tdesign-miniprogram/tab-panel/tab-panel"
}
}

```

### 等距选项卡

**WXML** (`html`):
```html
<t-tabs defaultValue="{{0}}" space-evenly="{{false}}" bind:change="onTabsChange" bind:click="onTabsClick">
<t-tab-panel wx:for="{{8}}" wx:key="index" label="选项" value="{{index}}" />
</t-tabs>

```

**JS** (`javascript`):
```javascript
Component({
methods: {
onTabsChange(event) {
console.log(`Change tab, tab-panel value is ${event.detail.value}.`);
},

onTabsClick(event) {
console.log(`Click tab, tab-panel value is ${event.detail.value}.`);
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
"t-tabs": "tdesign-miniprogram/tabs/tabs",
"t-tab-panel": "tdesign-miniprogram/tab-panel/tab-panel"
}
}

```

### 带图标选项卡

**WXML** (`html`):
```html
<t-tabs defaultValue="{{0}}">
<t-tab-panel wx:for="{{3}}" wx:key="index" icon="app" label="选项" value="{{index}}" />
</t-tabs>

```

**JS** (`javascript`):
```javascript
Component({});

```

**CSS** (`css`):
```css

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-tabs": "tdesign-miniprogram/tabs/tabs",
"t-tab-panel": "tdesign-miniprogram/tab-panel/tab-panel"
}
}

```

### 带徽章选项卡

**WXML** (`html`):
```html
<t-tabs defaultValue="{{0}}">
<t-tab-panel label="选项" value="0" badge-props="{{ { dot: true, offset: [0, 1] } }}" />
<t-tab-panel label="选项" value="1" badge-props="{{ { count: 8, offset: [0, 1] } }}" />
<t-tab-panel label="选项" value="2" />
</t-tabs>

```

**JS** (`javascript`):
```javascript
Component({});

```

**CSS** (`css`):
```css

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-tabs": "tdesign-miniprogram/tabs/tabs",
"t-tab-panel": "tdesign-miniprogram/tab-panel/tab-panel"
}
}

```

### 带内容区选项卡

**WXML** (`html`):
```html
<t-tabs
animation="{{ { duration: 0.6 } }}"
defaultValue="{{0}}"
bind:change="onTabsChange"
bind:click="onTabsClick"
t-class="custom-tabs"
t-class-content="custom-panel"
>
<t-tab-panel label="选项一" value="0">
<view class="custom-panel__content">选项一内容</view>
</t-tab-panel>
<t-tab-panel label="选项二" value="1">
<view class="custom-panel__content">选项二内容</view>
</t-tab-panel>
<t-tab-panel label="选项三" value="2">
<view class="custom-panel__content">选项三内容</view>
</t-tab-panel>
<t-tab-panel label="选项四" value="3">
<view class="custom-panel__content">选项四内容</view>
</t-tab-panel>
</t-tabs>

```

**JS** (`javascript`):
```javascript
Component({
methods: {
onTabsChange(event) {
console.log(`Change tab, tab-panel value is ${event.detail.value}.`);
},

onTabsClick(event) {
console.log(`Click tab, tab-panel value is ${event.detail.value}.`);
},
},
});

```

**CSS** (`css`):
```css
.custom-tabs {
margin-bottom: 32rpx;
}

.custom-panel {
color: var(--td-text-color-primary);
}

.custom-panel__content {
height: 240rpx;
font-size: 28rpx;
color: var(--td-text-color-placeholder);
padding: 40rpx;
display: flex;
justify-content: center;
align-items: center;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-tabs": "tdesign-miniprogram/tabs/tabs",
"t-tab-panel": "tdesign-miniprogram/tab-panel/tab-panel"
}
}

```

### 选项卡状态

**WXML** (`html`):
```html
<t-tabs value="{{value}}" bind:change="onTabsChange" bind:click="onTabsClick">
<t-tab-panel label="{{value == '0' ? '选中' : '默认'}}" value="0" />
<t-tab-panel label="{{value == '1' ? '选中' : '默认'}}" value="1" />
<t-tab-panel label="禁用" value="2" disabled />
</t-tabs>

```

**JS** (`javascript`):
```javascript
Component({
data: {
value: '0',
},
methods: {
onTabsChange(event) {
this.setData({
value: event.detail.value,
});
console.log(`Change tab, tab-panel value is ${event.detail.value}.`);
},

onTabsClick(event) {
console.log(`Click tab, tab-panel value is ${event.detail.value}.`);
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
"t-tabs": "tdesign-miniprogram/tabs/tabs",
"t-tab-panel": "tdesign-miniprogram/tab-panel/tab-panel"
}
}

```

### 选项卡尺寸

**WXML** (`html`):
```html
<t-tabs defaultValue="{{0}}">
<t-tab-panel label="小尺寸" value="0" />
<t-tab-panel label="选项" value="1" />
<t-tab-panel label="选项" value="2" />
<t-tab-panel label="选项" value="3" />
</t-tabs>

<view style="height: 16px" />

<t-tabs class="bigger" defaultValue="{{0}}">
<t-tab-panel label="大尺寸" value="0" />
<t-tab-panel label="选项" value="1" />
<t-tab-panel label="选项" value="2" />
<t-tab-panel label="选项" value="3" />
</t-tabs>

```

**JS** (`javascript`):
```javascript
Component({
methods: {
onTabsChange(event) {
console.log(`Change tab, tab-panel value is ${event.detail.value}.`);
},

onTabsClick(event) {
console.log(`Click tab, tab-panel value is ${event.detail.value}.`);
},
},
});

```

**CSS** (`css`):
```css
.bigger {
--td-tab-font: var(--td-font-body-large);
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-tabs": "tdesign-miniprogram/tabs/tabs",
"t-tab-panel": "tdesign-miniprogram/tab-panel/tab-panel"
}
}

```

### 选项卡样式

使用 theme 属性可以变换风格，支持 line = 线条（默认）；tag = 标签；card = 卡片

**WXML** (`html`):
```html
<t-tabs defaultValue="{{0}}" theme="tag">
<t-tab-panel wx:for="{{4}}" wx:key="index" label="选项" value="{{index}}" />
</t-tabs>

<view style="height: 16px" />

<t-tabs defaultValue="{{0}}" theme="card">
<t-tab-panel wx:for="{{4}}" wx:key="index" label="选项" value="{{index}}" />
</t-tabs>

```

**JS** (`javascript`):
```javascript
Component({});

```

**CSS** (`css`):
```css

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-tabs": "tdesign-miniprogram/tabs/tabs",
"t-tab-panel": "tdesign-miniprogram/tab-panel/tab-panel"
}
}

```

### 受控用法

```html
<t-tabs value="{{value}}" bind:change="onTabsChange">
<t-tab-panel label="标签页一" value="0">标签一内容</t-tab-panel>
<t-tab-panel label="标签页二" value="1">标签二内容</t-tab-panel>
</t-tabs>
```

```js
Page({
data: {
value: '0',
},
onTabsChange(e) {
this.setData({ value: e.detail.value })
},
});
```

### 与Popup使用

```html
<t-popup visible="{{visible}}" bind:visible-change="onVisibleChange">
<t-tabs id="tabs" defaultValue="{{0}}" bind:change="onTabsChange" bind:click="onTabsClick" t-class="custom-tabs">
<t-tab-panel label="标签页一" value="0">标签一内容</t-tab-panel>
<t-tab-panel label="标签页二" value="1">标签二内容</t-tab-panel>
<t-tab-panel label="标签页三" value="2">标签三内容</t-tab-panel>
</t-tabs>
</t-popup>
```

```js
Page({
data: {
visible: false
},
showPopup() {
this.setData({
visible: true
}, () => {
const tabs = this.selectComponent('tabs');

tabs.setTrack(); // 这一步很重要，因为小程序的无法正确执行生命周期，所以需要手动设置下 tabs 的滑块
})
}
})
```

## API

### TabsProps

| 名称 | 类型 | 默认值 | 描述 | 必传 |
| --- | --- | --- | --- | --- |
| style | Object | - | 样式 | N |
| custom-style | Object | - | 样式，一般用于开启虚拟化组件节点场景 | N |
| animation | Object | - | 动画效果设置。其中 duration 表示动画时长。（单位：秒）。TS 类型：`TabAnimation``type TabAnimation = { duration: number } & Record<string, any>`。详细类型定义 | N |
| bottom-line-mode | String | fixed | 激活下划线的模式。可选项：fixed/auto/full | N |
| show-bottom-line | Boolean | true | 是否展示底部激活线条 | N |
| space-evenly | Boolean | true | 选项卡头部空间是否均分 | N |
| split | Boolean | true | `1.1.10`。是否展示分割线 | N |
| sticky | Boolean | false | 是否开启粘性布局 | N |
| sticky-props | Object | - | 透传至 Sticky 组件。TS 类型：`StickyProps`，Sticky API Documents。详细类型定义 | N |
| swipeable | Boolean | true | 是否可以滑动切换 | N |
| theme | String | line | 标签的样式。可选项：line/tag/card | N |
| value | String / Number | - | 激活的选项卡值。TS 类型：`TabValue``type TabValue = string \| number`。详细类型定义 | N |
| default-value | String / Number | undefined | 激活的选项卡值。非受控属性。TS 类型：`TabValue``type TabValue = string \| number`。详细类型定义 | N |

### TabsEvents

| 名称 | 参数 | 描述 |
| --- | --- | --- |
| change | `(value: TabValue, label: string)` | 激活的选项卡发生变化时触发 |
| click | `(value: TabValue, label: string)` | 点击选项卡时触发 |
| scroll | `(scrollTop: number, isFixed: boolean)` | 页面滚动时触发 |

### TabsSlots

| 名称 | 描述 |
| --- | --- |
| - | 默认插槽，自定义选项卡内容 |
| middle | 中间内容，介于头部和内容之间 |

### TabsExternalClasses

| 类名 | 描述 |
| --- | --- |
| t-class | 根节点样式类 |
| t-class-active | 激活态样式类 |
| t-class-content | 内容样式类 |
| t-class-item | 选项样式类 |
| t-class-track | 滚动条样式类 |

### TabPanelProps

| 名称 | 类型 | 默认值 | 描述 | 必传 |
| --- | --- | --- | --- | --- |
| style | Object | - | 样式 | N |
| custom-style | Object | - | 样式，一般用于开启虚拟化组件节点场景 | N |
| badge-props | Object | - | 透传至 Badge 组件 | N |
| disabled | Boolean | false | 是否禁用当前选项卡 | N |
| icon | String / Object | - | `1.0.0-rc.1`。图标，传对象则透传至 Icon | N |
| label | String | - | 选项卡名称 | N |
| lazy | Boolean | false | 是否启用选项卡懒加载 | N |
| panel | String | - | 用于自定义选项卡面板内容 | N |
| value | String / Number | - | 选项卡的值，唯一标识。TS 类型：`TabValue`，Tabs API Documents。详细类型定义 | N |

### TabPanelSlots

| 名称 | 描述 |
| --- | --- |
| - | 默认插槽，自定义选项卡面板内容 |
| panel | 自定义`panel`显示内容 |

### CSSVariables

组件提供了下列 CSS 变量，可用于自定义样式。

| 名称 | 默认值 | 描述 |
| --- | --- | --- |
| --td-tab-border-color | @component-stroke | - |
| --td-tab-font | @font-body-medium | - |
| --td-tab-icon-size | 36rpx | - |
| --td-tab-item-active-color | @brand-color | - |
| --td-tab-item-color | @text-color-primary | - |
| --td-tab-item-disabled-color | @text-color-disabled | - |
| --td-tab-item-height | 96rpx | - |
| --td-tab-item-tag-active-bg | @brand-color-light | - |
| --td-tab-item-tag-bg | @bg-color-secondarycontainer | - |
| --td-tab-item-tag-height | 64rpx | - |
| --td-tab-item-vertical-height | 108rpx | - |
| --td-tab-item-vertical-width | 208rpx | - |
| --td-tab-nav-bg-color | @bg-color-container | - |
| --td-tab-track-color | @brand-color | - |
| --td-tab-track-radius | 8rpx | - |
| --td-tab-track-thickness | 6rpx | - |
| --td-tab-track-width | 32rpx | - |