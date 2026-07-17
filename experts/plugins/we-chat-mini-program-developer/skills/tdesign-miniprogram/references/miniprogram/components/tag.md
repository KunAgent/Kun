# Tag 标签

## 示例

## 引入

全局引入，在 miniprogram 根目录下的`app.json`中配置，局部引入，在需要引入的页面或组件的`index.json`中配置。

```json
"usingComponents": {
"t-tag": "tdesign-miniprogram/tag/tag",
"t-check-tag": "tdesign-miniprogram/check-tag/check-tag"
}
```

## 代码演示

[在开发者工具中预览效果](https://developers.weixin.qq.com/s/5GEWDNm18j5u)

> Tips: 请确保开发者工具为打开状态。导入开发者工具后，依次执行：npm i > 构建npm包 > 勾选 "将JS编译成ES5"

### 组件类型

**WXML** (`html`):
```html
<view class="demo">
<view class="demo-desc">基础标签</view>

<t-tag class="margin-16" variant="light">标签文字</t-tag>
<t-tag class="margin-16" variant="outline">标签文字</t-tag>
</view>

<view class="demo">
<view class="demo-desc">圆弧标签</view>

<t-tag class="margin-16" variant="light" shape="round">标签文字</t-tag>
<t-tag class="margin-16" variant="outline" shape="round">标签文字</t-tag>
<t-tag class="margin-16" variant="outline" shape="mark">标签文字</t-tag>
</view>

<view class="demo">
<view class="demo-desc">带图标的标签</view>

<t-tag class="margin-16" variant="light" icon="discount"> 标签文字 </t-tag>
<t-tag class="margin-16" variant="outline" icon="discount"> 标签文字 </t-tag>
</view>

<!-- skyline暂不支持设置后max-width超出省略 -->
<view class="demo" wx:if="{{!skylineRender}}">
<view class="demo-desc">超长省略文本标签</view>

<t-tag max-width="{{130}}" variant="light">超长省略文本标签超长省略文本标签</t-tag>
</view>

```

**JS** (`javascript`):
```javascript
import SkylineBehavior from '@behaviors/skyline.js';

Component({
behaviors: [SkylineBehavior],
});

```

**CSS** (`css`):
```css
.demo {
padding: 0 32rpx 48rpx;
}

.demo:last-child {
padding-bottom: 0;
}

.demo-desc {
font-size: 14px;
color: var(--td-text-color-secondary);
margin-bottom: 32rpx;
}

.demo .margin-16:not(:last-child) {
margin-right: 32rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-tag": "tdesign-miniprogram/tag/tag"
}
}

```

可关闭的标签

**WXML** (`html`):
```html
<view class="demo">
<t-tag wx:if="{{show[0]}}" class="margin-16" bind:close="handleClose0" closable variant="light">文字标签</t-tag>
<t-tag wx:if="{{show[1]}}" class="margin-16" bind:close="handleClose1" closable variant="outline">文字标签</t-tag>
</view>

```

**JS** (`javascript`):
```javascript
Component({
data: {
show: [true, true],
},

methods: {
handleClose0() {
this.setData({
[`show[0]`]: false,
});
},
handleClose1() {
this.setData({
[`show[1]`]: false,
});
},
},
});

```

**CSS** (`css`):
```css
.demo {
margin-left: 32rpx;
}

.demo .margin-16:not(:last-child) {
margin-right: 32rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-tag": "tdesign-miniprogram/tag/tag"
}
}

```

可点击的标签

**WXML** (`html`):
```html
<view class="wrapper">
<block wx:for="{{items}}" wx:key="index">
<view class="block">
<text>{{item}}</text>
<t-check-tag class="margin-16" size="large" variant="{{item}}" content="{{ ['已选中态', '未选中态'] }}" />
<t-check-tag
class="margin-16"
default-checked
size="large"
variant="{{item}}"
content="{{ ['已选中态', '未选中态'] }}"
/>
</view>
</block>
</view>

```

**JS** (`javascript`):
```javascript
Component({
data: {
items: ['light', 'dark', 'outline', 'light-outline'],
},
});

```

**CSS** (`css`):
```css
.wrapper {
flex-wrap: wrap;
margin: 0 32rpx;
}

.wrapper t-check-tag {
display: block;
}

.block {
display: flex;
font-size: 14px;
align-items: center;
line-height: 76rpx;
color: var(--td-text-color-placeholder);
}

.block text {
display: block;
width: 160rpx;
margin-right: 32rpx;
}

/* .block t-check-tag {
margin-right: 32rpx;
} */

.block + .block {
margin-top: 32rpx;
}

.block .margin-16:not(:last-child) {
margin-right: 32rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-check-tag": "tdesign-miniprogram/check-tag/check-tag"
}
}

```

### 组件状态

展示型标签

**WXML** (`html`):
```html
<view class="block">
<t-tag class="margin-16" variant="light">默认</t-tag>
<t-tag class="margin-16" variant="light" theme="primary">主要</t-tag>
<t-tag class="margin-16" variant="light" theme="warning">警告</t-tag>
<t-tag class="margin-16" variant="light" theme="danger">危险</t-tag>
<t-tag class="margin-16" variant="light" theme="success">成功</t-tag>
</view>

<view class="block">
<t-tag class="margin-16" theme="default">默认</t-tag>
<t-tag class="margin-16" theme="primary">主要</t-tag>
<t-tag class="margin-16" theme="warning">警告</t-tag>
<t-tag class="margin-16" theme="danger">危险</t-tag>
<t-tag class="margin-16" theme="success">成功</t-tag>
</view>

<view class="block">
<t-tag class="margin-16" variant="outline">默认</t-tag>
<t-tag class="margin-16" variant="outline" theme="primary">主要</t-tag>
<t-tag class="margin-16" variant="outline" theme="warning">警告</t-tag>
<t-tag class="margin-16" variant="outline" theme="danger">危险</t-tag>
<t-tag class="margin-16" variant="outline" theme="success">成功</t-tag>
</view>

<view class="block">
<t-tag class="margin-16" variant="light-outline">默认</t-tag>
<t-tag class="margin-16" variant="light-outline" theme="primary">主要</t-tag>
<t-tag class="margin-16" variant="light-outline" theme="warning">警告</t-tag>
<t-tag class="margin-16" variant="light-outline" theme="danger">危险</t-tag>
<t-tag class="margin-16" variant="light-outline" theme="success">成功</t-tag>
</view>

```

**JS** (`javascript`):
```javascript
Component({});

```

**CSS** (`css`):
```css
.block {
margin: 0 32rpx;
}

.block + .block {
margin-top: 48rpx;
}

.block .margin-16:not(:last-child) {
margin-right: 32rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-tag": "tdesign-miniprogram/tag/tag"
}
}

```

### 组件尺寸

**WXML** (`html`):
```html
<view class="block">
<t-tag class="margin-16" size="extra-large" variant="light">加大尺寸</t-tag>
<t-tag class="margin-16" size="large" variant="light">大尺寸</t-tag>
<t-tag class="margin-16" size="medium" variant="light">中尺寸</t-tag>
<t-tag class="margin-16" size="small" variant="light">小尺寸</t-tag>
</view>

<view class="block">
<t-tag class="margin-8" size="extra-large" variant="light" closable>加大尺寸</t-tag>
<t-tag class="margin-8" size="large" variant="light" closable>大尺寸</t-tag>
<t-tag class="margin-8" size="medium" variant="light" closable>中尺寸</t-tag>
<t-tag class="margin-8" size="small" variant="light" closable>小尺寸</t-tag>
</view>

```

**JS** (`javascript`):
```javascript
Component({});

```

**CSS** (`css`):
```css
.block {
margin: 0 32rpx;
}

.block + .block {
margin-top: 32rpx;
}

.block .margin-16,
.block .margin-8 {
vertical-align: top;
}

.block .margin-16:not(:last-child) {
margin-right: 32rpx;
}

.block .margin-8:not(:last-child) {
margin-right: 10rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-tag": "tdesign-miniprogram/tag/tag"
}
}

```

## API

### TagProps

| 名称 | 类型 | 默认值 | 描述 | 必传 |
| --- | --- | --- | --- | --- |
| style | Object | - | 样式 | N |
| custom-style | Object | - | 样式，一般用于开启虚拟化组件节点场景 | N |
| closable | Boolean / Object | false | 标签是否可关闭 | N |
| disabled | Boolean | false | 标签禁用态，失效标签不能触发事件。默认风格（theme=default）才有禁用态 | N |
| icon | String / Object | - | 标签中的图标，可自定义图标呈现 | N |
| max-width | String / Number | - | 标签最大宽度，宽度超出后会出现省略号。示例：'50px' / 80 | N |
| shape | String | square | 标签类型，有三种：方形、圆角方形、标记型。可选项：square/round/mark | N |
| size | String | medium | 标签尺寸。可选项：small/medium/large/extra-large | N |
| theme | String | default | 组件风格，用于描述组件不同的应用场景。可选项：default/primary/warning/danger/success | N |
| variant | String | dark | 标签风格变体。可选项：dark/light/outline/light-outline | N |

### TagEvents

| 名称 | 参数 | 描述 |
| --- | --- | --- |
| click | - | 点击时触发 |
| close | - | 如果关闭按钮存在，点击关闭按钮时触发 |

### TagSlots

| 名称 | 描述 |
| --- | --- |
| - | 默认插槽，自定义内容区域内容 |
| closable | 标签可关闭内容区域 |
| icon | 标签中的图标 |

### TagExternalClasses

| 类名 | 描述 |
| --- | --- |
| t-class | 根节点样式类 |

### CheckTagProps

| 名称 | 类型 | 默认值 | 描述 | 必传 |
| --- | --- | --- | --- | --- |
| style | Object | - | 样式 | N |
| custom-style | Object | - | 样式，一般用于开启虚拟化组件节点场景 | N |
| checked | Boolean | - | 标签选中的状态，默认风格（theme=default）才有选中态 | N |
| default-checked | Boolean | undefined | 标签选中的状态，默认风格（theme=default）才有选中态。非受控属性 | N |
| closable | Boolean | false | 标签是否可关闭 | N |
| content | String / Number / Array | - | 组件子元素；传入数组时：[选中内容，非选中内容]。TS 类型：`string \| number \| string[]` | N |
| disabled | Boolean | false | 标签禁用态，失效标签不能触发事件。默认风格（theme=default）才有禁用态 | N |
| icon | String / Object | - | 标签图标 | N |
| shape | String | square | 标签类型，有三种：方形、圆角方形、标记型。可选项：square/round/mark | N |
| size | String | medium | 标签尺寸。可选项：small/medium/large。TS 类型：`SizeEnum`。通用类型定义 | N |
| variant | String | dark | `0.26.0`。标签风格变体。可选项：dark/light/outline/light-outline | N |

### CheckTagEvents

| 名称 | 参数 | 描述 |
| --- | --- | --- |
| change | `(checked: boolean)` | 状态切换时触发 |
| click | - | 点击标签时触发 |
| close | - | 如果关闭按钮存在，点击关闭按钮时触发 |

### CheckTagSlots

| 名称 | 描述 |
| --- | --- |
| - | 默认插槽，作用同`content`插槽 |
| content | 自定义内容区域 |
| icon | 标签区域 |

### CheckTagExternalClasses

| 类名 | 描述 |
| --- | --- |
| t-class | 根节点样式类 |

### CSSVariables

组件提供了下列 CSS 变量，可用于自定义样式。

| 名称 | 默认值 | 描述 |
| --- | --- | --- |
| --td-tag-close-icon-color | @text-color-placeholder | - |
| --td-tag-danger-color | @error-color | - |
| --td-tag-danger-light-color | @error-color-1 | - |
| --td-tag-default-color | @bg-color-component | - |
| --td-tag-default-font-color | @text-color-primary | - |
| --td-tag-default-light-color | @bg-color-secondarycontainer | - |
| --td-tag-disabled-background-color | @bg-color-component-disabled | - |
| --td-tag-disabled-border-color | @component-border | - |
| --td-tag-disabled-color | @text-color-disabled | - |
| --td-tag-extra-large-font | @font-body-medium | - |
| --td-tag-extra-large-icon-size | 32rpx | - |
| --td-tag-extra-large-padding | 16rpx 30rpx | - |
| --td-tag-large-font | @font-body-medium | - |
| --td-tag-large-icon-size | 32rpx | - |
| --td-tag-large-padding | 4rpx 14rpx | - |
| --td-tag-mark-border-radius | @tag-round-border-radius | - |
| --td-tag-medium-font | @font-body-small | - |
| --td-tag-medium-icon-size | 28rpx | - |
| --td-tag-medium-padding | 2rpx 14rpx | - |
| --td-tag-outline-bg-color | @bg-color-container | - |
| --td-tag-primary-color | @brand-color | - |
| --td-tag-primary-light-color | @brand-color-light | - |
| --td-tag-round-border-radius | 999px | - |
| --td-tag-small-font | @font-body-extraSmall | - |
| --td-tag-small-icon-size | 24rpx | - |
| --td-tag-small-padding | 2rpx 10rpx | - |
| --td-tag-square-border-radius | 8rpx | - |
| --td-tag-success-color | @success-color | - |
| --td-tag-success-light-color | @success-color-1 | - |
| --td-tag-warning-color | @warning-color | - |
| --td-tag-warning-light-color | @warning-color-1 | - |