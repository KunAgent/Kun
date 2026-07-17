# Avatar 头像

## 示例

## 引入

全局引入，在 miniprogram 根目录下的`app.json`中配置，局部引入，在需要引入的页面或组件的`index.json`中配置。

```json
"usingComponents": {
"t-avatar": "tdesign-miniprogram/avatar/avatar",
"t-avatar-group": "tdesign-miniprogram/avatar-group/avatar-group"
}
```

## 代码演示

[在开发者工具中预览效果](https://developers.weixin.qq.com/s/BLUuQNmC8K5Y)

> Tips: 请确保开发者工具为打开状态。导入开发者工具后，依次执行：npm i > 构建npm包 > 勾选 "将JS编译成ES5"

### 头像类型

图片头像

**WXML** (`html`):
```html
<t-avatar class="avatar-example" image="{{image}}" />
<t-avatar class="avatar-example" shape="round" image="{{image}}" />

```

**JS** (`javascript`):
```javascript
Component({
data: {
image: 'https://tdesign.gtimg.com/mobile/demos/avatar1.png',
},
});

```

**CSS** (`css`):
```css
.avatar-example {
margin-right: 64rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-avatar": "tdesign-miniprogram/avatar/avatar"
}
}

```

字符头像

**WXML** (`html`):
```html
<t-avatar class="avatar-example" t-class-content="external-class-content" aria-label="字符头像">A</t-avatar>
<t-avatar class="avatar-example" t-class-content="external-class-content" shape="round">A</t-avatar>

```

**JS** (`javascript`):
```javascript
Component({
data: {
image: 'https://tdesign.gtimg.com/mobile/demos/avatar1.png',
},
});

```

**CSS** (`css`):
```css
.avatar-example:not(:last-child) {
margin-right: 64rpx;
}

.external-class-content {
color: #fff;
background-color: var(--td-brand-color, #0052d9);
font-weight: 400;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-avatar": "tdesign-miniprogram/avatar/avatar"
}
}

```

图标头像

**WXML** (`html`):
```html
<t-avatar class="avatar-example" icon="user" />
<t-avatar class="avatar-example" shape="round" icon="user" />

```

**JS** (`javascript`):
```javascript
Component({
data: {
image: 'https://tdesign.gtimg.com/mobile/demos/avatar1.png',
},
});

```

**CSS** (`css`):
```css
.avatar-example:not(:last-child) {
margin-right: 64rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-avatar": "tdesign-miniprogram/avatar/avatar"
}
}

```

徽标头像

**WXML** (`html`):
```html
<t-avatar class="avatar-example" image="{{image}}" badge-props="{{ {dot: true, offset: [0, 4] } }}" />
<t-avatar
class="avatar-example"
t-class-content="external-class-content"
badge-props="{{ {count: 8, offset: [-6, 6] } }}"
>A</t-avatar
>
<t-avatar class="avatar-example" icon="user" badge-props="{{ {count: 12,  offset: [-6, 6] } }}" />

```

**JS** (`javascript`):
```javascript
Component({
data: {
image: 'https://tdesign.gtimg.com/mobile/demos/avatar1.png',
},
});

```

**CSS** (`css`):
```css
.avatar-example:not(:last-child) {
margin-right: 64rpx;
}

.external-class-content {
color: #fff;
background-color: var(--td-brand-color, #0052d9);
font-weight: 400;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-avatar": "tdesign-miniprogram/avatar/avatar"
}
}

```

### 组合头像

纯展示

**WXML** (`html`):
```html
<t-avatar-group max="5" collapseAvatar="+5">
<t-avatar wx:for="{{pics}}" wx:for-item="pic" wx:key="index" image="{{pic}}" />
</t-avatar-group>

```

**JS** (`javascript`):
```javascript
Component({
data: {
pics: [
'https://tdesign.gtimg.com/mobile/demos/avatar1.png',
'https://tdesign.gtimg.com/mobile/demos/avatar2.png',
'https://tdesign.gtimg.com/mobile/demos/avatar3.png',
'https://tdesign.gtimg.com/mobile/demos/avatar4.png',
'https://tdesign.gtimg.com/mobile/demos/avatar5.png',
'https://tdesign.gtimg.com/mobile/demos/avatar1.png',
],
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
"t-avatar": "tdesign-miniprogram/avatar/avatar",
"t-avatar-group": "tdesign-miniprogram/avatar-group/avatar-group"
}
}

```

带操作

**WXML** (`html`):
```html
<t-avatar-group cascading="right-up" max="5" bind:collapsed-item-click="onClickCollapsedAvatar">
<t-avatar wx:for="{{pics}}" wx:for-item="pic" wx:key="index" image="{{pic}}" />
</t-avatar-group>

```

**JS** (`javascript`):
```javascript
Component({
data: {
pics: [
'https://tdesign.gtimg.com/mobile/demos/avatar1.png',
'https://tdesign.gtimg.com/mobile/demos/avatar2.png',
'https://tdesign.gtimg.com/mobile/demos/avatar3.png',
'https://tdesign.gtimg.com/mobile/demos/avatar4.png',
'https://tdesign.gtimg.com/mobile/demos/avatar5.png',
'https://tdesign.gtimg.com/mobile/demos/avatar1.png',
],
},

methods: {
onAddTap() {
wx.showToast({ title: '您按下了添加', icon: 'none', duration: 1000 });
},
onClickCollapsedAvatar() {
console.log('click collapsed avatar');
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
"t-avatar": "tdesign-miniprogram/avatar/avatar",
"t-avatar-group": "tdesign-miniprogram/avatar-group/avatar-group"
}
}

```

### 头像尺寸

头像 large/medium/small 尺寸

**WXML** (`html`):
```html
<view class="avatar-example">
<t-avatar class="avatar-example--large" image="{{image}}" size="large" />
<t-avatar class="avatar-example--large" t-class-content="external-class-content" size="large">A</t-avatar>
<t-avatar class="avatar-example--large" icon="user" size="large" />
</view>

<view class="avatar-example">
<t-avatar class="avatar-example--medium" image="{{image}}" />
<t-avatar class="avatar-example--medium" t-class-content="external-class-content" size="medium">A</t-avatar>
<t-avatar class="avatar-example--medium" icon="user" size="medium" />
</view>

<view class="avatar-example">
<t-avatar class="avatar-example--small" image="{{image}}" size="small" />
<t-avatar class="avatar-example--small" t-class-content="external-class-content" size="small">A</t-avatar>
<t-avatar class="avatar-example--small" icon="user" size="small" />
</view>

```

**JS** (`javascript`):
```javascript
Component({
data: {
image: 'https://tdesign.gtimg.com/mobile/demos/avatar1.png',
},
});

```

**CSS** (`css`):
```css
.avatar-example {
display: flex;
margin-bottom: 32rpx;
}

.external-class-content {
color: #fff;
background-color: var(--td-brand-color, #0052d9);
font-weight: 400;
}

.avatar-example--small:not(:last-child) {
margin-right: 112rpx;
}

.avatar-example--medium:not(:last-child) {
margin-right: 96rpx;
}

.avatar-example--large:not(:last-child) {
margin-right: 64rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-avatar": "tdesign-miniprogram/avatar/avatar"
}
}

```

## API

### AvatarProps

| 名称 | 类型 | 默认值 | 描述 | 必传 |
| --- | --- | --- | --- | --- |
| style | Object | - | 样式 | N |
| custom-style | Object | - | 样式，一般用于开启虚拟化组件节点场景 | N |
| alt | String | - | 头像替换文本，仅当图片加载失败时有效 | N |
| badge-props | Object | - | 头像右上角提示信息，继承 Badge 组件的全部特性。如：小红点，或者数字。TS 类型：`BadgeProps`，Badge API Documents。详细类型定义 | N |
| bordered | Boolean | false | 已废弃。是否显示外边框 | N |
| hide-on-load-failed | Boolean | false | 加载失败时隐藏图片 | N |
| icon | String / Object | - | 图标。值为字符串表示图标名称，值为`Object`类型，表示透传至`icon` | N |
| image | String | - | 图片地址 | N |
| image-props | Object | - | 透传至 Image 组件。TS 类型：`ImageProps`，Image API Documents。详细类型定义 | N |
| shape | String | - | 形状。优先级高于 AvatarGroup.shape 。Avatar 单独存在时，默认值为 circle。如果父组件 AvatarGroup 存在，默认值便由 AvatarGroup.shape 决定。可选项：circle/round。TS 类型：`ShapeEnum`。通用类型定义 | N |
| size | String | - | 尺寸，示例值：small/medium/large/24px/38px 等。优先级高于 AvatarGroup.size 。Avatar 单独存在时，默认值为 medium。如果父组件 AvatarGroup 存在，默认值便由 AvatarGroup.size 决定 | N |

### AvatarEvents

| 名称 | 参数 | 描述 |
| --- | --- | --- |
| error | - | 图片加载失败时触发 |

### AvatarSlots

| 名称 | 描述 |
| --- | --- |
| - | 默认插槽，自定义内容区域内容 |

### AvatarExternalClasses

| 类名 | 描述 |
| --- | --- |
| t-class | 根节点样式类 |
| t-class-alt | 替代文本样式类 |
| t-class-content | 内容样式类 |
| t-class-icon | 图标样式类 |
| t-class-image | 图片样式类 |

### AvatarGroupProps

| 名称 | 类型 | 默认值 | 描述 | 必传 |
| --- | --- | --- | --- | --- |
| style | Object | - | 样式 | N |
| custom-style | Object | - | 样式，一般用于开启虚拟化组件节点场景 | N |
| cascading | String | 'left-up' | 图片之间的层叠关系，可选值：左侧图片在上和右侧图片在上。可选项：left-up/right-up。TS 类型：`CascadingValue``type CascadingValue = 'left-up' \| 'right-up'`。详细类型定义 | N |
| collapse-avatar | String | - | 头像数量超出时，会出现一个头像折叠元素。该元素内容可自定义。默认为`+N`。示例：`+5`，`...`,`更多` | N |
| max | Number | - | 能够同时显示的最多头像数量 | N |
| shape | String | - | 形状。优先级低于 Avatar.shape。可选项：circle/round。TS 类型：`ShapeEnum`。通用类型定义 | N |
| size | String | - | 尺寸，示例值：small/medium/large/24px/38px 等。优先级低于 Avatar.size | N |

### AvatarGroupEvents

| 名称 | 参数 | 描述 |
| --- | --- | --- |
| collapsed-item-click | - | 点击头像折叠元素触发 |

### AvatarGroupSlots

| 名称 | 描述 |
| --- | --- |
| - | 默认插槽，自定义内容区域内容 |
| collapse-avatar | 自定义`collapse-avatar`显示内容 |

### AvatarGroupExternalClasses

| 类名 | 描述 |
| --- | --- |
| t-class | 根节点样式类 |
| t-class-content | 内容样式类 |
| t-class-image | 图片样式类 |

### CSSVariables

组件提供了下列 CSS 变量，可用于自定义样式。

| 名称 | 默认值 | 描述 |
| --- | --- | --- |
| --td-avatar-group-init-z-index | @avatar-group-init-zIndex | - |
| --td-avatar-group-line-spacing | 4rpx | - |
| --td-avatar-group-margin-left-large | -16rpx | - |
| --td-avatar-group-margin-left-medium | -16rpx | - |
| --td-avatar-group-margin-left-small | -16rpx | - |
| --td-avatar-bg-color | @brand-color-light-active | - |
| --td-avatar-border-color | #fff | - |
| --td-avatar-border-width-large | 6rpx | - |
| --td-avatar-border-width-medium | 4rpx | - |
| --td-avatar-border-width-small | 2rpx | - |
| --td-avatar-circle-border-radius | @radius-circle | - |
| --td-avatar-content-color | @brand-color | - |
| --td-avatar-icon-large-font-size | 64rpx | - |
| --td-avatar-icon-medium-font-size | 48rpx | - |
| --td-avatar-icon-small-font-size | 40rpx | - |
| --td-avatar-large-width | 128rpx | - |
| --td-avatar-margin-left | 0 | - |
| --td-avatar-medium-width | 96rpx | - |
| --td-avatar-round-border-radius | @radius-default | - |
| --td-avatar-small-width | 80rpx | - |
| --td-avatar-text-large-font-size | @font-size-xl | - |
| --td-avatar-text-medium-font-size | @font-size-m | - |
| --td-avatar-text-small-font-size | @font-size-base | - |