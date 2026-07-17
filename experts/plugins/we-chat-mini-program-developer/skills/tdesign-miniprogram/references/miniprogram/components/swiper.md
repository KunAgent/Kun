# Swiper 轮播图

## 示例

## 引入

全局引入，在 miniprogram 根目录下的`app.json`中配置，局部引入，在需要引入的页面或组件的`index.json`中配置。

```json
"usingComponents": {
"t-swiper": "tdesign-miniprogram/swiper/swiper",
"t-swiper-nav": "tdesign-miniprogram/swiper-nav/swiper-nav",
}
```

### 组件说明

从 `0.32.0` 版本开始，依赖原生 `swiper` 组件实现，移除了 `swiper-item` 组件，新增了 `list` 属性；

## 代码演示

多种轮播样式，通过 `navigation` 设置导航样式，没有值则不显示，也可以自定义 `nav` 组件

[在开发者工具中预览效果](https://developers.weixin.qq.com/s/QwElpNmY825g)

> Tips: 请确保开发者工具为打开状态。导入开发者工具后，依次执行：npm i > 构建npm包 > 勾选 "将JS编译成ES5"

### 组件类型

#### 点状（dots）轮播图

**WXML** (`html`):
```html
<t-swiper
current="{{current}}"
autoplay="{{autoplay}}"
duration="{{duration}}"
interval="{{interval}}"
navigation="{{ { type: 'dots' } }}"
list="{{swiperList}}"
bind:click="onTap"
bind:change="onChange"
bind:image-load="onImageLoad"
>
</t-swiper>

```

**JS** (`javascript`):
```javascript
const imageCdn = 'https://tdesign.gtimg.com/mobile/demos';
const swiperList = [
`${imageCdn}/swiper1.png`,
`${imageCdn}/swiper2.png`,
`${imageCdn}/swiper1.png`,
`${imageCdn}/swiper2.png`,
`${imageCdn}/swiper1.png`,
];

Component({
data: {
current: 0,
autoplay: false,
duration: 500,
interval: 5000,
swiperList,
},

methods: {
onTap(e) {
const { index } = e.detail;

console.log(index);
},
onChange(e) {
const { current, source } = e.detail;

console.log(current, source);
},
onImageLoad(e) {
console.log(e.detail.index);
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
"t-swiper": "tdesign-miniprogram/swiper/swiper"
}
}

```

#### 点条状（dots-bar）轮播图

**WXML** (`html`):
```html
<t-swiper
current="{{current}}"
autoplay="{{autoplay}}"
duration="{{duration}}"
interval="{{interval}}"
list="{{swiperList}}"
navigation="{{ { type: 'dots-bar' } }}"
/>

```

**JS** (`javascript`):
```javascript
const imageCdn = 'https://tdesign.gtimg.com/mobile/demos';
const swiperList = [
{
value: `${imageCdn}/swiper1.png`,
ariaLabel: '图片1',
},
{
value: `${imageCdn}/swiper2.png`,
ariaLabel: '图片2',
},
{
value: `${imageCdn}/swiper1.png`,
ariaLabel: '图片1',
},
{
value: `${imageCdn}/swiper2.png`,
ariaLabel: '图片2',
},
];

Component({
data: {
current: 1,
autoplay: true,
duration: 500,
interval: 5000,
swiperList,
},
});

```

**CSS** (`css`):
```css
.img {
width: 100%;
height: 100%;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-swiper": "tdesign-miniprogram/swiper/swiper"
}
}

```

#### 分式（fraction）导航器轮播图

**WXML** (`html`):
```html
<t-swiper
current="{{current}}"
autoplay="{{autoplay}}"
duration="{{duration}}"
interval="{{interval}}"
navigation="{{navigation}}"
paginationPosition="{{paginationPosition}}"
list="{{swiperList}}"
>
</t-swiper>

```

**JS** (`javascript`):
```javascript
const imageCdn = 'https://tdesign.gtimg.com/mobile/demos';
const swiperList = [
`${imageCdn}/swiper1.png`,
`${imageCdn}/swiper2.png`,
`${imageCdn}/swiper1.png`,
`${imageCdn}/swiper2.png`,
`${imageCdn}/swiper1.png`,
];

Component({
data: {
current: 2,
autoplay: true,
duration: 500,
interval: 5000,
paginationPosition: 'bottom-right',
swiperList,
navigation: { type: 'fraction' },
},
});

```

**CSS** (`css`):
```css
.img {
width: 100%;
height: 100%;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-swiper": "tdesign-miniprogram/swiper/swiper"
}
}

```

#### 切换按钮（controls）轮播图

**WXML** (`html`):
```html
<t-swiper
current="{{current}}"
autoplay="{{autoplay}}"
duration="{{duration}}"
interval="{{interval}}"
navigation="{{navigation}}"
list="{{swiperList}}"
loop="{{false}}"
>
</t-swiper>

```

**JS** (`javascript`):
```javascript
const imageCdn = 'https://tdesign.gtimg.com/mobile/demos';
const swiperList = [
{
value: `${imageCdn}/swiper1.png`,
ariaLabel: '图片1',
},
{
value: `${imageCdn}/swiper2.png`,
ariaLabel: '图片2',
},
{
value: `${imageCdn}/swiper1.png`,
ariaLabel: '图片1',
},
{
value: `${imageCdn}/swiper2.png`,
ariaLabel: '图片2',
},
];

Component({
data: {
current: 3,
autoplay: true,
duration: 500,
interval: 5000,
swiperList,
navigation: { type: '', showControls: true },
},
});

```

**CSS** (`css`):
```css
.img {
width: 100%;
height: 100%;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-swiper": "tdesign-miniprogram/swiper/swiper"
}
}

```

#### 卡片式（cards）轮播图

**WXML** (`html`):
```html
<view class="card-theme">
<t-swiper
current="{{current}}"
autoplay="{{autoplay}}"
duration="{{duration}}"
interval="{{interval}}"
bindchange="onChange"
navigation="{{ { type: 'dots' } }}"
list="{{swiperList}}"
image-props="{{ { shape: 'round' } }}"
previousMargin="34px"
nextMargin="34px"
t-class-nav="card-theme-nav"
/>

<view class="box" style="height: 42px" />

<t-swiper
class="scale-card-theme"
current="{{current}}"
autoplay="{{autoplay}}"
duration="{{duration}}"
interval="{{interval}}"
bindchange="onChange"
navigation="{{ { type: 'dots' } }}"
list="{{swiperList}}"
image-props="{{ { shape: 'round' } }}"
previousMargin="34px"
nextMargin="34px"
t-class-nav="card-theme-nav"
t-class-prev-image="scale-candidate"
t-class-next-image="scale-candidate"
/>
</view>

```

**JS** (`javascript`):
```javascript
const imageCdn = 'https://tdesign.gtimg.com/mobile/demos';
const swiperList = [
`${imageCdn}/swiper1.png`,
`${imageCdn}/swiper2.png`,
`${imageCdn}/swiper1.png`,
`${imageCdn}/swiper2.png`,
`${imageCdn}/swiper1.png`,
];

Component({
data: {
current: 0,
autoplay: false,
duration: 500,
interval: 5000,
swiperList,
},

methods: {
onChange(e) {
const {
detail: { current, source },
} = e;
console.log(current, source);
},
},
});

```

**CSS** (`css`):
```css
.card-theme {
--td-swiper-radius: 0;
--td-swiper-item-padding: 0 12rpx;
--td-swiper-nav-dot-color: var(--td-bg-color-component, #e7e7e7);
--td-swiper-nav-dot-active-color: var(--td-brand-color, #0052d9);

padding-bottom: 18px;
}

.card-theme .card-theme-nav {
bottom: -18px;
}

.scale-candidate {
height: 126px !important;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-swiper": "tdesign-miniprogram/swiper/swiper"
}
}

```

### 组件样式

#### 垂直模式

**WXML** (`html`):
```html
<view class="swiper-box">
<t-swiper
current="{{1}}"
autoplay="{{autoplay}}"
duration="{{duration}}"
interval="{{interval}}"
navigation="{{navigation}}"
direction="vertical"
paginationPosition="{{paginationPosition}}"
list="{{swiperList}}"
>
</t-swiper>
</view>

<view class="swiper-box swiper-box-option">
<view class="cell">
<view class="label">自动播放</view>
<view class="option">
<t-switch t-class="swiper-switch" bindchange="onAutoplayChange" value="{{autoplay}}"></t-switch>
<view class="option-desc">{{autoplay?'开':'关'}}</view>
</view>
</view>
<view class="cell">
<view class="label">自动播放间隔时间(单位毫秒)</view>
<view class="option">
<t-slider
t-class="swiper-slider"
t-class-bar="external-class-bar"
value="{{interval}}"
min="{{1000}}"
max="{{5000}}"
label="{{true}}"
step="{{500}}"
bindchange="onIntervalChange"
></t-slider>
</view>
</view>
<view class="cell">
<view class="label">动画持续时间(单位毫秒)</view>
<view class="option">
<t-slider
t-class="swiper-slider"
t-class-bar="external-class-bar"
value="{{duration}}"
min="{{200}}"
max="{{2000}}"
label="{{true}}"
step="{{100}}"
bindchange="onDurationChange"
></t-slider>
</view>
</view>
</view>

```

**JS** (`javascript`):
```javascript
const imageCdn = 'https://tdesign.gtimg.com/mobile/demos';
const swiperList = [
{
value: `${imageCdn}/swiper1.png`,
ariaLabel: '图片1',
},
{
value: `${imageCdn}/swiper2.png`,
ariaLabel: '图片2',
},
{
value: `${imageCdn}/swiper1.png`,
ariaLabel: '图片1',
},
{
value: `${imageCdn}/swiper2.png`,
ariaLabel: '图片2',
},
];
Component({
data: {
current: 1,
autoplay: true,
duration: 500,
interval: 5000,
swiperList,
navigation: { type: 'dots-bar' },
paginationPosition: 'right',
},

methods: {
onChange(e) {
const {
detail: { current, source },
} = e;
console.log(current, source);
},
onAutoplayChange(e) {
this.setData({
autoplay: e.detail.value,
});
},
onIntervalChange(e) {
this.setData({
interval: e.detail.value,
});
},
onDurationChange(e) {
this.setData({
duration: e.detail.value,
});
},
},
});

```

**CSS** (`css`):
```css
.swiper-box {
margin: 0 32rpx 32rpx;
border-radius: 16rpx;
overflow: hidden;
transform: translateY(0);
}

.swiper-box .img {
width: 100%;
height: 100%;
}

.swiper-switch {
margin: 22rpx 0;
}

.swiper-switch .t-switch__label {
display: none;
}

.cell {
padding: 10rpx 0;
font-size: 28rpx;
color: #999;
}
.cell.row {
display: flex;
flex-direction: row;
}

.cell .label {
color: #999;
margin-right: 20rpx;
}

.cell .option-desc {
width: 68rpx;
}

.cell .swiper-slider {
margin: 32rpx 0;
}

.swiper-box-vertical .item {
line-height: 400rpx;
}

.swiper-box-option {
overflow: visible;
border-radius: 0;
}

.external-class-bar {
margin: 0 !important;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-swiper": "tdesign-miniprogram/swiper/swiper",
"t-switch": "tdesign-miniprogram/switch/switch",
"t-slider": "tdesign-miniprogram/slider/slider"
}
}

```

## API

### SwiperProps

| 名称 | 类型 | 默认值 | 描述 | 必传 |
| --- | --- | --- | --- | --- |
| style | Object | - | 样式 | N |
| custom-style | Object | - | 样式，一般用于开启虚拟化组件节点场景 | N |
| autoplay | Boolean | true | 是否自动播放 | N |
| current | Number | 0 | 当前轮播在哪一项（下标） | N |
| direction | String | horizontal | 轮播滑动方向，包括横向滑动和纵向滑动两个方向。可选项：horizontal/vertical | N |
| display-multiple-items | Number | 1 | `0.32.0`。同时显示的滑块数量 | N |
| duration | Number | 300 | 滑动动画时长 | N |
| easing-function | String | default | `0.32.0`。指定 swiper 切换缓动动画类型。可选项：default/linear/easeInCubic/easeOutCubic/easeInOutCubic | N |
| height | String / Number | 192 | 轮播的高度；默认单位`px` | N |
| image-props | Object | - | `0.34.0`。透传至 Image 组件 | N |
| interval | Number | 5000 | 轮播间隔时间 | N |
| list | Array | - | `0.32.0`。图片列表。TS 类型：`string[] \| SwiperList[]``interface SwiperList { value: string, ariaLabel: string }`。详细类型定义 | N |
| loop | Boolean | true | 是否循环播放 | N |
| navigation | Boolean / Object | true | 导航器全部配置，true 的话使用默认配置。TS 类型：`SwiperNavProps \| boolean`，SwiperNav API Documents。详细类型定义 | N |
| next-margin | String / Number | 0 | `0.32.0`。后边距，可用于露出后一项的一小部分。默认单位`px` | N |
| pagination-position | String | bottom | 页码信息展示位置。可选项：top-left/top/top-right/bottom-left/bottom/bottom-right | N |
| previous-margin | String / Number | 0 | `0.32.0`。前边距，可用于露出前一项的一小部分。默认单位`px` | N |
| snap-to-edge | Boolean | false | `0.32.0`。当 swiper-item 的个数大于等于 2，关闭 circular 并且开启 previous-margin 或 next-margin 的时候，可以指定这个边距是否应用到第一个、最后一个元素 | N |

### SwiperEvents

| 名称 | 参数 | 描述 |
| --- | --- | --- |
| animationfinish | `(current: number, source: SwiperChangeSource)` | `1.11.0`。轮播切换时触发 |
| change | `(current: number, source: SwiperChangeSource)` | 轮播切换时触发。详细类型定义。<br>`type SwiperChangeSource = 'autoplay' \| 'touch' \| 'nav'`<br> |
| click | `(index: number)` | `0.34.0`。点击轮播项时触发 |
| image-load | `(index: number)` | `1.1.4`。图片加载时触发 |

### SwiperSlots

| 名称 | 描述 |
| --- | --- |
| navigation | 导航器全部配置 |

### SwiperExternalClasses

| 类名 | 描述 |
| --- | --- |
| t-class | 根节点样式类 |
| t-class-image | 当前图片样式类 |
| t-class-nav | 导航样式类 |
| t-class-next-image | 下一图片样式类 |
| t-class-prev-image | 上一图片样式类 |

### SwiperNavProps

| 名称 | 类型 | 默认值 | 描述 | 必传 |
| --- | --- | --- | --- | --- |
| style | Object | - | 样式 | N |
| custom-style | Object | - | 样式，一般用于开启虚拟化组件节点场景 | N |
| current | Number | 0 | `0.34.0`。当前轮播在哪一项（下标） | N |
| direction | String | horizontal | `0.34.0`。轮播滑动方向，包括横向滑动和纵向滑动两个方向。可选项：horizontal/vertical | N |
| min-show-num | Number | 2 | 小于这个数字不会显示导航器 | N |
| pagination-position | String | bottom | `0.34.0`。页码信息展示位置。可选项：top-left/top/top-right/bottom-left/bottom/bottom-right | N |
| show-controls | Boolean | false | `0.32.0`。是否显示两侧的控制按钮 | N |
| total | Number | 0 | `0.34.0`。总共的项数 | N |
| type | String | dots | 导航器类型，点状(dots)、点条状(dots-bar)、分式(fraction)等。TS 类型：`SwiperNavigationType``type SwiperNavigationType = 'dots' \| 'dots-bar' \| 'fraction'`。详细类型定义 | N |

### SwiperNavExternalClasses

| 类名 | 描述 |
| --- | --- |
| t-class | 根节点样式类 |

### CSSVariables

组件提供了下列 CSS 变量，可用于自定义样式。

| 名称 | 默认值 | 描述 |
| --- | --- | --- |
| --td-swiper-item-padding | 0 | - |
| --td-swiper-radius | @radius-large | - |
| --td-swiper-nav-btn-bg-color | @font-gray-3 | - |
| --td-swiper-nav-btn-color | @text-color-anti | - |
| --td-swiper-nav-btn-size | 48rpx | - |
| --td-swiper-nav-dot-active-color | @text-color-anti | - |
| --td-swiper-nav-dot-color | @font-white-2 | - |
| --td-swiper-nav-dot-size | 12rpx | - |
| --td-swiper-nav-dots-bar-active-width | 40rpx | - |
| --td-swiper-nav-fraction-bg-color | @font-gray-3 | - |
| --td-swiper-nav-fraction-color | @text-color-anti | - |
| --td-swiper-nav-fraction-font | @font-body-small | - |
| --td-swiper-nav-fraction-height | 48rpx | - |