# Calendar 日历

## 示例

该组件于 0.22.0 版本上线，请留意版本。
## 引入

全局引入，在 miniprogram 根目录下的`app.json`中配置，局部引入，在需要引入的页面或组件的`index.json`中配置。

```json
"usingComponents": {
"t-calendar": "tdesign-miniprogram/calendar/calendar"
}
```

## 代码演示

[在开发者工具中预览效果](https://developers.weixin.qq.com/s/VgWTzNmh8R5A)

> Tips: 请确保开发者工具为打开状态。导入开发者工具后，依次执行：npm i > 构建npm包 > 勾选 "将JS编译成ES5"

### 组件类型

#### 单个选择日历

**WXML** (`html`):
```html
<wxs src="../calendar.wxs" module="_this" />

<t-calendar visible="{{visible}}" value="{{value}}" bind:confirm="handleConfirm" bind:close="onClose" />
<t-cell arrow title="单个选择日历" note="{{_this.formatTimestamp(value)}}" bind:tap="handleCalendar" />

```

**JS** (`javascript`):
```javascript
Component({
data: {
visible: false,
value: null,
},
methods: {
handleCalendar() {
this.setData({ visible: true });
},

handleConfirm(e) {
const { value } = e.detail;
console.log(value);
this.setData({
value,
});
},

onClose({ detail }) {
console.log(detail.trigger);
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
"t-calendar": "tdesign-miniprogram/calendar/calendar",
"t-cell": "tdesign-miniprogram/cell/cell"
}
}

```

#### 多个选择日历

**WXML** (`html`):
```html
<wxs src="../calendar.wxs" module="_this" />

<t-calendar visible="{{visible}}" value="{{value}}" type="multiple" bind:confirm="handleConfirm" />
<t-cell arrow title="多个选择日历" bind:tap="handleCalendar">
<view slot="note" class="custom-class-note"> {{_this.formatTimestamp(value)}} </view>
</t-cell>

```

**JS** (`javascript`):
```javascript
Component({
data: {
visible: false,
value: null,
},
methods: {
handleCalendar() {
this.setData({ visible: true });
},
handleConfirm(e) {
const { value } = e.detail;
this.setData({ value });
console.log(e.detail.value);
},
},
});

```

**CSS** (`css`):
```css
.custom-class-note {
width: 360rpx;
overflow: hidden;
text-overflow: ellipsis;
white-space: nowrap;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-cell": "tdesign-miniprogram/cell/cell",
"t-calendar": "tdesign-miniprogram/calendar/calendar"
}
}

```

#### 带单行/双行描述的日历

**WXML** (`html`):
```html
<wxs src="../calendar.wxs" module="_this" />

<t-cell
arrow
title="带单行描述的日历"
note="{{_this.formatTimestamp(singleValue)}}"
data-type="single"
bind:tap="handleCalendar"
/>

<view class="demo-desc">带双行描述的日历</view>
<t-calendar
visible="{{visible}}"
value="{{type === 'single' ? singleValue : value}}"
minDate="{{minDate}}"
maxDate="{{maxDate}}"
format="{{type === 'single' ? singleFormat: format}}"
data-type="{{type}}"
bind:confirm="handleConfirm"
/>
<t-cell
arrow
title="带双行描述的日历"
note="{{_this.formatTimestamp(value)}}"
data-type="multiple"
bind:tap="handleCalendar"
/>

```

**JS** (`javascript`):
```javascript
Component({
data: {
type: 'single',
visible: false,
value: new Date(2022, 1, 18).getTime(),
singleValue: new Date(2022, 1, 18).getTime(),
minDate: new Date(2022, 1, 1).getTime(),
maxDate: new Date(2022, 2, 15).getTime(),
singleFormat(day) {
day.suffix = '¥60';
return day;
},
format(day) {
const { date } = day;
const year = date.getFullYear();
const month = date.getMonth() + 1;
const curDate = date.getDate();

day.suffix = '¥60';

if (year === 2022) {
if (month === 2) {
const map = {
1: '初一',
2: '初二',
3: '初三',
14: '情人节',
15: '元宵节',
};
if (curDate in map) {
day.prefix = map[curDate];
day.suffix = '¥100';
day.className = 'is-holiday';
}
}
}

return day;
},
},
methods: {
handleCalendar(e) {
const { type } = e.currentTarget.dataset;
this.setData({ type, visible: true });
},

handleConfirm(e) {
const { type } = e.currentTarget.dataset;
const { value } = e.detail;

if (type === 'single') {
this.setData({
singleValue: value,
});
} else {
this.setData({
value,
});
}
console.log(e.detail.value);
},
},
});

```

**CSS** (`css`):
```css
.demo-desc {
margin-top: 32rpx;
margin-bottom: 32rpx;
}

.is-holiday:not(.t-calendar__dates-item--selected) {
color: #e34d59 !important;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"styleIsolation": "apply-shared",
"usingComponents": {
"t-cell": "tdesign-miniprogram/cell/cell",
"t-calendar": "tdesign-miniprogram/calendar/calendar"
}
}

```

#### 带翻页功能的日历

**WXML** (`html`):
```html
<wxs src="../calendar.wxs" module="_this" />

<t-calendar
visible="{{visible}}"
value="{{value}}"
switch-mode="year-month"
minDate="{{minDate}}"
maxDate="{{maxDate}}"
bind:confirm="handleConfirm"
bind:panel-change="handlePanelChange"
/>
<t-cell arrow title="带翻页功能的日历" note="{{_this.formatTimestamp(value)}}" bind:tap="handleCalendar" />

```

**JS** (`javascript`):
```javascript
Component({
data: {
visible: false,
value: new Date(2022, 1, 27).getTime(),
minDate: new Date(2022, 0, 10).getTime(),
maxDate: new Date(2027, 10, 27).getTime(),
},

methods: {
handleCalendar() {
this.setData({ visible: true });
},

handleConfirm(e) {
this.setData({ value: e.detail.value });
console.log(e.detail.value);
},

handlePanelChange(e) {
const { year, month } = e.detail;
console.log('year: ', year, 'month: ', month);
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
"t-cell": "tdesign-miniprogram/cell/cell",
"t-calendar": "tdesign-miniprogram/calendar/calendar"
}
}

```

#### 可选择区间日期的日历

**WXML** (`html`):
```html
<wxs src="../calendar.wxs" module="_this" />

<t-calendar
visible="{{visible}}"
value="{{value}}"
minDate="{{minDate}}"
maxDate="{{maxDate}}"
type="range"
bind:confirm="handleConfirm"
/>

<view class="wrapper" bind:tap="handleCalendar">
<view class="wrapper__left">{{_this.formatTimestamp(value[0])}}</view>
<t-icon class="wrapper__center" name="swap-right" size="40rpx" />
<view class="wrapper__right">{{_this.formatTimestamp(value[1])}}</view>
</view>

```

**JS** (`javascript`):
```javascript
Component({
data: {
visible: false,
value: [new Date(2024, 11, 5).getTime(), new Date(2024, 11, 10).getTime()],
minDate: new Date(2024, 10, 1).getTime(),
maxDate: new Date(2024, 12, 1).getTime(),
},
methods: {
handleCalendar() {
this.setData({ visible: true });
},

handleConfirm(e) {
console.log(e.detail.value);
const { value } = e.detail;
this.setData({
value,
});
},
},
});

```

**CSS** (`css`):
```css
.wrapper {
background-color: var(--td-bg-color-container);
padding: 32rpx;
box-sizing: border-box;
display: flex;
align-items: center;
justify-content: space-between;
}

.wrapper__center {
color: var(--td-text-color-placeholder);
}

.wrapper__left,
.wrapper__right {
width: 240rpx;
color: var(--td-text-color-primary);
font-size: 32rpx;
font-weight: 600;
line-height: 48rpx;
}

.wrapper__right {
text-align: right;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-icon": "tdesign-miniprogram/icon/icon",
"t-calendar": "tdesign-miniprogram/calendar/calendar"
}
}

```

### 组件样式

#### 国际化

**WXML** (`html`):
```html
<wxs src="../calendar.wxs" module="_this" />

<t-calendar
visible="{{visible}}"
value="{{value}}"
minDate="{{minDate}}"
maxDate="{{maxDate}}"
localeText="{{localeText}}"
bind:confirm="handleConfirm"
bind:close="onClose"
/>
<t-cell arrow title="国际化" note="{{_this.formatTimestamp(value)}}" bind:tap="handleCalendar" />

```

**JS** (`javascript`):
```javascript
Component({
data: {
visible: false,
value: new Date(2022, 1, 18).getTime(),
minDate: new Date(2022, 1, 1).getTime(),
maxDate: new Date(2022, 2, 15).getTime(),
localeText: {
title: 'Select Date',
weekdays: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
monthTitle: '{month} {year}',
confirm: 'Confirm',
months: [
'January',
'February',
'March',
'April',
'May',
'June',
'July',
'August',
'September',
'October',
'November',
'December',
],
},
},
methods: {
handleCalendar() {
this.setData({ visible: true });
},

handleConfirm(e) {
const { value } = e.detail;
this.setData({
value,
});
},

onClose({ detail }) {
console.log(detail.trigger);
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
"t-calendar": "tdesign-miniprogram/calendar/calendar",
"t-cell": "tdesign-miniprogram/cell/cell"
}
}

```

#### 含不可选的日历

**WXML** (`html`):
```html
<wxs src="../calendar.wxs" module="_this" />

<t-calendar
visible="{{visible}}"
value="{{value}}"
minDate="{{minDate}}"
maxDate="{{maxDate}}"
bind:confirm="handleConfirm"
/>
<t-cell arrow title="含不可选的日历" note="{{_this.formatTimestamp(value)}}" bind:tap="handleCalendar" />

```

**JS** (`javascript`):
```javascript
Component({
data: {
visible: false,
value: new Date(2022, 1, 18).getTime(),
minDate: new Date(2022, 1, 18).getTime(),
maxDate: new Date(2022, 2, 1).getTime(),
},
methods: {
handleCalendar() {
this.setData({ visible: true });
},

handleConfirm(e) {
const { value } = e.detail;
this.setData({ value });
console.log(value);
},
},
});

```

**CSS** (`css`):
```css
.is-holiday:not(.t-calendar__dates-item--selected) {
color: #e34d59 !important;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-cell": "tdesign-miniprogram/cell/cell",
"t-calendar": "tdesign-miniprogram/calendar/calendar"
}
}

```

#### 不使用Popup

**WXML** (`html`):
```html
<t-calendar title="日历标题" use-popup="{{false}}" type="multiple" bind:select="handleSelect" />

```

**JS** (`javascript`):
```javascript
Component({
methods: {
handleSelect(e) {
const { value } = e.detail;

console.log(value);
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
"styleIsolation": "apply-shared",
"usingComponents": {
"t-calendar": "tdesign-miniprogram/calendar/calendar"
}
}

```

## API

### CalendarProps

| 名称 | 类型 | 默认值 | 描述 | 必传 |
| --- | --- | --- | --- | --- |
| style | Object | - | 样式 | N |
| custom-style | Object | - | 样式，一般用于开启虚拟化组件节点场景 | N |
| allow-same-day | Boolean | false | `1.11.2`。是否允许区间选择日历的起止时间相同，仅当`type='range'`时有效 | N |
| auto-close | Boolean | true | `0.34.0`。自动关闭；在点击关闭按钮、确认按钮、遮罩层时自动关闭，不需要手动设置 visible | N |
| confirm-btn | String / Object | '' | 确认按钮。值为 null 则不显示确认按钮。值类型为字符串，则表示自定义按钮文本，值类型为 Object 则表示透传 Button 组件属性。详细类型定义 | N |
| first-day-of-week | Number | 0 | 第一天从星期几开始，默认 0 = 周日 | N |
| format | Function | - | 用于格式化日期的函数。TS 类型：`CalendarFormatType ``type CalendarFormatType = (day: TDate) => TDate``type TDateType = 'selected' \| 'disabled' \| 'start' \| 'start-end' \|'centre' \| 'end' \| ''``interface TDate { date: Date; day: number; type: TDateType; className?: string; prefix?: string; suffix?: string;}`。详细类型定义 | N |
| locale-text | Object | - | 国际化文案。TS 类型：`CalendarLocaleText``interface CalendarLocaleText {title?: string; weekdays?: string[]; monthTitle?: string; months?: string[]; confirm?: string;}`。详细类型定义 | N |
| max-date | Number | - | 最大可选的日期，不传则默认半年后 | N |
| min-date | Number | - | 最小可选的日期，不传则默认今天 | N |
| readonly | Boolean | - | `1.9.7`。是否只读，只读状态下不能选择日期 | N |
| switch-mode | String | none | `1.8.2`。切换模式。`none`表示平铺展示所有月份；`month`表示支持按月切换，`year-month`表示既按年切换，也支持按月切换。可选项：none/month/year-month | N |
| title | String | - | 标题，不传默认为“请选择日期” | N |
| type | String | single | 日历的选择类型，single = 单选；multiple = 多选; range = 区间选择。可选项：single/multiple/range | N |
| use-popup | Boolean | true | `0.32.0`。是否使用弹出层包裹日历 | N |
| using-custom-navbar | Boolean | false | 是否使用了自定义导航栏 | N |
| value | Number / Array | - | 当前选择的日期，不传则选用 minDate 属性值或今天，优先级：minDate > today。当 type = multiple 或 range 时传入数组。TS 类型：`number \| number[]` | N |
| default-value | Number / Array | undefined | 当前选择的日期，不传则选用 minDate 属性值或今天，优先级：minDate > today。当 type = multiple 或 range 时传入数组。非受控属性。TS 类型：`number \| number[]` | N |
| visible | Boolean | false | 是否显示日历；`usePopup`为 true 时有效 | N |

### CalendarEvents

| 名称 | 参数 | 描述 |
| --- | --- | --- |
| change | `(value: timestamp)` | `0.28.0`。不显示 confirm-btn 时，完成选择时触发（暂不支持 type = multiple） |
| close | `(trigger: CalendarTrigger)` | `0.34.0`。关闭按钮时触发。详细类型定义。<br>`type CalendarTrigger = 'close-btn' \| 'confirm-btn' \| 'overlay' \| 'auto-close'`<br> |
| confirm | `(value: timestamp)` | 点击确认按钮时触发 |
| panel-change | `(detail: { year: number, month: number })` | `1.8.4`。切换月或年时触发（switch-mode 不为 none 时有效） |
| scroll | `({scrollLeft, scrollTop, scrollHeight, scrollWidth, deltaX, deltaY})` | `1.4.6`。滚动时触发 |
| select | `(value: timestamp)` | `0.28.0`。点击日期时触发 |

### CalendarSlots

| 名称 | 描述 |
| --- | --- |
| confirm-btn | 确认按钮 |
| title | 标题 |

### CSSVariables

组件提供了下列 CSS 变量，可用于自定义样式。

| 名称 | 默认值 | 描述 |
| --- | --- | --- |
| --td-calendar-active-color | @brand-color | - |
| --td-calendar-bg-color | @bg-color-container | - |
| --td-calendar-days-color | @text-color-secondary | - |
| --td-calendar-item-centre-color | @brand-color-light | - |
| --td-calendar-item-disabled-color | @text-color-disabled | - |
| --td-calendar-item-suffix-color | @text-color-placeholder | - |
| --td-calendar-radius | 24rpx | - |
| --td-calendar-selected-border-radius | @radius-default | - |
| --td-calendar-selected-color | @text-color-anti | - |
| --td-calendar-switch-mode-icon-color | @text-color-secondary | - |
| --td-calendar-switch-mode-icon-disabled-color | @text-color-disabled | - |
| --td-calendar-title-color | @text-color-primary | - |
| --td-calendar-title-font | @font-title-large | - |