# CountDown 倒计时

## 示例

> CountDown 组件用于实时展示倒计时数值。 如果需要与站点演示一致的数字字体效果，推荐您到 [数字字体章节](https://tdesign.tencent.com/design/fonts)，将 TCloudNumber 字体下载并将包含的 TCloudNumberVF.ttf 做为 TCloudNumber 字体资源引入到具体项目中使用。

## 引入

全局引入，在 miniprogram 根目录下的`app.json`中配置，局部引入，在需要引入的页面或组件的`index.json`中配置。

```json
"usingComponents": {
"t-count-down": "tdesign-miniprogram/count-down/count-down"
}
```

## 代码演示

[在开发者工具中预览效果](https://developers.weixin.qq.com/s/TAsNNMmh875W)

> Tips: 请确保开发者工具为打开状态。导入开发者工具后，依次执行：npm i > 构建npm包 > 勾选 "将JS编译成ES5"

### 基础倒计时

**WXML** (`html`):
```html
<view class="demo-count-down">
<text class="demo-count-down-desc"> 时分秒 </text>
<view class="demo-count-down-content">
<t-count-down time="{{ time }}" />
</view>
</view>

<view class="demo-count-down">
<text class="demo-count-down-desc"> 带毫秒 </text>
<view class="demo-count-down-content">
<t-count-down format="HH:mm:ss:SSS" time="{{ time }}" millisecond />
</view>
</view>

<view class="demo-count-down">
<text class="demo-count-down-desc"> 带方形底 </text>
<view class="demo-count-down-content">
<t-count-down content="default" time="{{ time }}" theme="square"> </t-count-down>
</view>
</view>

<view class="demo-count-down">
<text class="demo-count-down-desc"> 带圆形底 </text>
<view class="demo-count-down-content">
<t-count-down content="default" time="{{ time }}" theme="round"> </t-count-down>
</view>
</view>

<view class="demo-count-down">
<text class="demo-count-down-desc"> 带单位 </text>
<view class="demo-count-down-content">
<t-count-down content="default" time="{{ time }}" splitWithUnit theme="round" />
</view>
</view>

<view class="demo-count-down">
<text class="demo-count-down-desc"> 无底色带单位 </text>
<view class="demo-count-down-content">
<t-count-down
t-class-count="external-count"
t-class-split="external-split"
content="default"
time="{{ time }}"
splitWithUnit
/>
</view>
</view>

```

**JS** (`javascript`):
```javascript
Component({
data: {
time: 96 * 60 * 1000,
},
});

```

**CSS** (`css`):
```css
.demo-count-down-desc {
color: var(--td-text-color-secondary);
font-size: 28rpx;
}

.demo-count-down-content {
margin: 32rpx 0 48rpx;
}

.external-count {
color: #e34d59;
font-size: 36rpx;
line-height: 48rpx;
vertical-align: middle;
}

.external-split {
font-size: 20rpx;
margin: 0 10rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-count-down": "tdesign-miniprogram/count-down/count-down"
}
}

```

### 调整尺寸

**WXML** (`html`):
```html
<view class="demo-count-down">
<text class="demo-count-down-desc"> 时分秒 </text>
<view class="demo-count-down-content">
<t-count-down size="small" time="{{ time }}" />
</view>
<view class="demo-count-down-content">
<t-count-down time="{{ time }}" />
</view>
<view class="demo-count-down-content">
<t-count-down size="large" time="{{ time }}" />
</view>
</view>

<view class="demo-count-down">
<text class="demo-count-down-desc"> 带毫秒 </text>
<view class="demo-count-down-content">
<t-count-down size="small" format="HH:mm:ss:SSS" time="{{ time }}" millisecond />
</view>
<view class="demo-count-down-content">
<t-count-down format="HH:mm:ss:SSS" time="{{ time }}" millisecond />
</view>
<view class="demo-count-down-content">
<t-count-down size="large" format="HH:mm:ss:SSS" time="{{ time }}" millisecond />
</view>
</view>

<view class="demo-count-down">
<text class="demo-count-down-desc"> 带方形底 </text>
<view class="demo-count-down-content">
<t-count-down size="small" format="HH:mm:ss" time="{{ time }}" theme="square" />
</view>
<view class="demo-count-down-content">
<t-count-down format="HH:mm:ss" time="{{ time }}" theme="square" />
</view>
<view class="demo-count-down-content">
<t-count-down size="large" format="HH:mm:ss" time="{{ time }}" theme="square" />
</view>
</view>

<view class="demo-count-down">
<text class="demo-count-down-desc"> 带圆形底 </text>
<view class="demo-count-down-content">
<t-count-down size="small" format="HH:mm:ss" time="{{ time }}" theme="round" />
</view>
<view class="demo-count-down-content">
<t-count-down format="HH:mm:ss" time="{{ time }}" theme="round" />
</view>
<view class="demo-count-down-content">
<t-count-down size="large" format="HH:mm:ss" time="{{ time }}" theme="round" />
</view>
</view>

<view class="demo-count-down">
<text class="demo-count-down-desc"> 带单位 </text>
<view class="demo-count-down-content">
<t-count-down size="small" format="HH:mm:ss" time="{{ time }}" splitWithUnit theme="round" />
</view>
<view class="demo-count-down-content">
<t-count-down format="HH:mm:ss" time="{{ time }}" splitWithUnit theme="round" />
</view>
<view class="demo-count-down-content">
<t-count-down size="large" format="HH:mm:ss" time="{{ time }}" splitWithUnit theme="round" />
</view>
</view>

```

**JS** (`javascript`):
```javascript
Component({
data: {
time: 96 * 60 * 1000,
},
});

```

**CSS** (`css`):
```css
.demo-count-down {
padding-bottom: 32rpx;
}

.demo-count-down-desc {
color: var(--td-text-color-secondary);
font-size: 28rpx;
}

.demo-count-down-content {
margin: 24rpx 0;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-count-down": "tdesign-miniprogram/count-down/count-down"
}
}

```

## API

### CountDownProps

| 名称 | 类型 | 默认值 | 描述 | 必传 |
| --- | --- | --- | --- | --- |
| style | Object | - | 样式 | N |
| custom-style | Object | - | 样式，一般用于开启虚拟化组件节点场景 | N |
| auto-start | Boolean | true | 是否自动开始倒计时 | N |
| content | String | 'default' | 最终倒计时的展示内容，值为'default'时使用默认的格式，否则使用自定义样式插槽 | N |
| format | String | HH:mm:ss | 时间格式，DD-日，HH-时，mm-分，ss-秒，SSS-毫秒 | N |
| millisecond | Boolean | false | 是否开启毫秒级渲染 | N |
| size | String | 'medium' | `0.5.1`。倒计时尺寸。可选项：small/medium/large | N |
| split-with-unit | Boolean | false | `0.5.1`。使用时间单位分割 | N |
| theme | String | 'default' | `0.5.1`。倒计时风格。可选项：default/round/square | N |
| time | Number | 0 | 必需。倒计时时长，单位毫秒 | Y |

### CountDownEvents

| 名称 | 参数 | 描述 |
| --- | --- | --- |
| change | `(time: TimeData)` | 时间变化时触发。详细类型定义。<br>`interface TimeData {  days: number; hours: number; minutes: number; seconds: number; milliseconds: number }`<br> |
| finish | - | 倒计时结束时触发 |

### CountDownSlots

| 名称 | 描述 |
| --- | --- |
| - | 默认插槽，作用同`content`插槽 |
| content | 自定义`content`显示内容 |

### CountDownExternalClasses

| 类名 | 描述 |
| --- | --- |
| t-class | 根节点样式类 |
| t-class-count | 计数样式类 |
| t-class-split | 分隔线样式类 |

### CSSVariables

组件提供了下列 CSS 变量，可用于自定义样式。

| 名称 | 默认值 | 描述 |
| --- | --- | --- |
| --td-countdown-bg-color | @error-color | - |
| --td-countdown-default-color | @text-color-primary | - |
| --td-countdown-round-border-radius | @radius-circle | - |
| --td-countdown-round-color | @text-color-anti | - |
| --td-countdown-square-border-radius | @radius-small | - |