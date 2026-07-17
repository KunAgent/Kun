# HrOfficeBuildingSelector 办公大厦选择器

## 组件概述

`HrOfficeBuildingSelector` 是一个办公大厦选择器组件，用于选择员工的办公大厦，支持单选、多选、层级展示、自定义数据源等功能。

## 引入方式

```javascript
import { HrOfficeBuildingSelector } from '@tencent/hr-vue-next';
```

## 代码示例

### 基础用法

提供2种方式选择办公大厦，用 Tag 展示已选办公大厦。办公大厦选择器目前默认使用单选模式。
1. 展开级联面板选择
2. 输入关键字搜索，使用下拉菜单展示筛选后的办公大厦

默认单选，`v-model` 的值为当前被选中的办公大厦选项的 **value** 属性值。可通过 `map.multiple` 属性设置多选，`v-model` 的值为当前被选中的办公大厦选项的 **value** 属性值集合。

```vue
<template>
  <div class="example_flex_box">
    <div class="block">
      <span class="demonstration">基础单选</span>
      <hr-office-building-selector v-model="value1" placeholder="基础单选" />
    </div>
    <div class="block">
      <span class="demonstration">基础多选</span>
      <hr-office-building-selector v-model="value2" @change="selectorChange" :map="map" placeholder="基础多选" />
    </div>
  </div>
</template>
<script setup>
import { ref } from 'vue';
const value1 = ref(37);
const value2 = ref([]);
const map = { multiple: true, emitPath: true };
const selectorChange = (val) => {
  console.log(val);
};
</script>
```

### Tag展示

可以仅在输入框中显示选中项最后一级的办公大厦，而不是选中办公大厦所在的完整路径。可以折叠展示Tag。

属性 `show-all-levels` 定义了是否显示完整的路径，将其赋值为`false`则仅显示最后一级；你也可以设置`collapseTags`属性将它们合并为一段文字；还可以设置`tagsLength`属性限制展示的Tag文字数量。

```vue
<template>
  <div class="example_flex_box">
    <div class="block">
      <span class="demonstration">仅展示最后一级</span>
      <hr-office-building-selector v-model="value" :show-all-levels="false" />
    </div>
    <div class="block">
      <span class="demonstration">折叠展示Tag</span>
      <hr-office-building-selector
        disabled
        ref="selector"
        v-model="value2"
        collapseTags
        :tagsLength="5"
        :show-all-levels="false"
        :map="map"
      />
    </div>
  </div>
</template>
<script setup>
import { ref } from 'vue';
const value = ref(37);
const value2 = ref([37, 87]);
const map = { multiple: true };
</script>
```

### 多语言

属性 `lang` 定义了展示语言，默认中文，可选值`en`。

```vue
<template>
  <hr-office-building-selector v-model="value" lang="en" />
</template>
<script setup>
import { ref } from 'vue';
const value = ref([]);
</script>
```

### 限制展示的大区或国家

属性 `includeRegionList` 定义了展示大区的集合，默认全展示。 100——中国大陆、200——亚太、300——美洲、400——欧洲、500——中东及非洲。属性 `includeCountryList` 定义了展示国家的集合，默认全展示。

```vue
<template>
  <div class="example_flex_box">
    <div class="block">
      <span class="demonstration">限制展示大区</span>
      <hr-office-building-selector v-model="value1" :includeRegionList="includeRegionList" />
    </div>
    <div class="block">
      <span class="demonstration">限制展示国家</span>
      <hr-office-building-selector v-model="value2" :includeCountryList="includeCountryList" />
    </div>
  </div>
</template>
<script setup>
import { ref } from 'vue';
const value1 = ref([]);
const value2 = ref([]);
const includeRegionList = [100, 200];
const includeCountryList = [1];
</script>
```

### 完整value值

绑定完整的value值数组。

属性 `map.emitPath` 定义了value是否是完整的路径，默认只返回最后一级，将其赋值为`true`则返回完整value,单选为`[地区id, 国家id, 城市id, 办公大厦id]`,多选为`[[地区id, 国家id, 城市id, 办公大厦id]]`。

```vue
<template>
  <hr-office-building-selector v-model="value" :map="map" @change="change" />
</template>
<script setup>
import { ref } from 'vue';
const value = ref([[100, 1, 1, 20]]);
const map = {
  emitPath: true,
  multiple: true,
};
function change(e) {
  console.log(e);
}
</script>
```

### 展示层级

设置显示的级联层级数。可通过 `level` 来设置显示层级数，默认四级。

```vue
<template>
  <div class="example_flex_box">
    <div class="block">
      <span class="demonstration">仅展示一级</span>
      <hr-office-building-selector v-model="value1" :level="1" />
    </div>
    <div class="block">
      <span class="demonstration">仅展示二级</span>
      <hr-office-building-selector v-model="value2" :level="2" />
    </div>
    <div class="block">
      <span class="demonstration">仅展示三级</span>
      <hr-office-building-selector v-model="value3" :level="3" />
    </div>
  </div>
</template>
<script setup>
import { ref } from 'vue';
const value1 = ref('');
const value2 = ref(20);
const value3 = ref('');
</script>
```

### 回显过滤

可通过 `clearUnmatchedOptions` 属性指定回显清除不存在选项中的值。

```vue
<template>
  <hr-office-building-selector v-model="value" clearUnmatchedOptions :map="{ multiple: true }" />
</template>
<script setup>
import { ref } from 'vue';
const value = ref(['这个会被过滤', 20, '不展示']);
</script>
```

### 尺寸

可通过 `size` 属性指定输入框的尺寸，除了默认的大小外，提供了**medium**、**small**尺寸。

```vue
<template>
  <div class="example_flex_box">
    <div class="block">
      <span class="demonstration">默认尺寸</span>
      <hr-office-building-selector v-model="value1" placeholder="默认尺寸" />
    </div>
    <div class="block">
      <span class="demonstration">中等尺寸</span>
      <hr-office-building-selector v-model="value2" size="medium" />
    </div>
    <div class="block">
      <span class="demonstration">较小尺寸</span>
      <hr-office-building-selector v-model="value3" size="small" />
    </div>
  </div>
</template>
<script setup>
import { ref } from 'vue';
const value1 = ref('');
const value2 = ref('');
const value3 = ref('');
</script>
```

### 自定义数据源

选择器内置的办公大厦数据是在初始时从远程服务器拉取的，用户可替换自己的数据源。`promise` 属性接收一个 `Promise`，完成状态时的返回值为有清晰层级结构的办公大厦集合，如果数据源字段与选择器默认要求的 **value，label，children** 不一致，可通过 `map` 属性进行映射。

```vue
<template>
  <hr-office-building-selector
    v-model="value"
    :map="map"
    :promise="customGetRegion"
    showTotal
  ></hr-office-building-selector>
</template>
<script setup>
import { ref } from 'vue';
const value = ref(3);
const map = {
  value: 'value',
  label: 'label',
};
const customGetRegion = new Promise((resolve, reject) => {
  const remoteData = [
    {
      value: 1,
      label: '广东省',
      children: [
        {
          value: 2,
          label: '深圳市',
          children: [
            { value: 3, label: '深圳大楼' },
            { value: 4, label: '办公楼' }
          ],
        },
        {
          value: 6,
          label: '广州市',
          children: [
            { value: 7, label: '办公大楼1' },
            { value: 8, label: '测试办公大楼' }
          ],
        }
      ],
    },
    {
      value: 17,
      label: '浙江省',
      children: [
        {
          value: 18,
          label: '杭州市',
          children: [
            { value: 19, label: '西湖办公大楼' }
          ],
        }
      ],
    },
  ];
  resolve(remoteData);
});
</script>
```

## API

### 属性

| 参数               | 说明                                 | 类型    | 可选值  | 默认值                    |
| ------------------ | ------------------------------------ | ------- | ------- | ------------------------- |
| v-model / modelValue    | 绑定值                          | Array/String/Number    | —       | —           |
| size               | 输入框尺寸                           | String  | medium/small   | —                         |
| lang               | 语言                                 | String  | en      | —                         |
| level              | 层级数                               | Number  | 1、2、3、4 | 4                         |
| disabled           | 是否禁用                             | Boolean | —       | false                     |
| showTotal          | 是否显示后置的已选数量               | Boolean | —       | false                     |
| placeholder        | 占位符                               | String  | —       | —                         |
| separator          | 选项分隔符                           | String  | —       | 斜杠'/'                   |
| clearUnmatchedOptions  | 回显时清除不存在选项列表中的选项    | Boolean               | —                  | false    |
| excessTagsDisplayType| 标签超出时的呈现方式，有两种：横向滚动显示 和 换行显示  | String | scroll/break-line  | scroll    |
| collapseTags       | 多选模式下是否折叠Tag                | Boolean | —       | false                     |
| tagsLength         | Tag最大展示文字数, 最小1             | Number  | —       | 13                        |
| showAllLevels      | 输入框中是否显示选中值的完整路径     | Boolean | —       | true                      |
| includeRegionList  | 可展示的大区集合                     | Array   | —       | [100, 200, 300, 400, 500] |
| includeCountryList | 可展示的国家集合（默认全展示）       | Array   | —       | []                        |
| includeLocationList | 可展示的城市集合（默认全展示）       | Array   | —       | []                        |
| map                | 映射配置，具体见下表                 | Object  | —       | —                         |
| promise            | 获取层级办公大厦数据的方法             | Promise | —       | —                         |
| customClass     | 自定义类名                             | String                | —            | —          |

### 事件

| 事件名称 | 说明                 | 回调参数                                               |
| -------- | -------------------- | ------------------------------------------------------ |
| change   | 选中项发生变化时触发 | 目前的选中项, 包含label、value、path数组、fullName、fullOptions数组。 TS 类型： `CascaderSelectedOption[]` |

### 方法

| 方法名          | 说明           | 参数                                        | 返回值                                        |
| --------------- | -------------- | ------------------------------------------- | ------------------------------------------- |
| clearSelected   | 用于清空选中项 | —                                           | —                                           |
| getCheckedNodes | 获取选中的节点 | (leafOnly) 是否只是叶子节点，默认值为 false | 选中值节点数组。TS类型： `CascaderTreeNode[]`   |
| getCheckedData  | 获取选中的数据   | —                          |目前的选中项, 包含label、value、path数组、fullName、fullOptions数组。 TS 类型： `CascaderSelectedOption[]`|

### map 配置

| 参数     | 说明                                                                                               | 类型    | 可选值 | 默认值         |
| -------- | -------------------------------------------------------------------------------------------------- | ------- | ------ | -------------- |
| value    | 指定选项的值为选项对象的某个属性值                                                                 | String  | —      | 'value'      |
| label    | 指定选项标签为选项对象的某个属性值                                                                 | String  | —      | 'label' |
| children | 指定选项的子选项为选项对象的某个属性值                                                             | String  | —      | 'children'     |
| emitPath | 在选中节点改变时，是否返回由该节点所在的各级菜单的值所组成的数组，若设置 false，则只返回该节点的值 | Boolean | —      | false          |
| multiple | 是否多选                                                                                           | Boolean | —      | false          |
