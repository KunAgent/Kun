# HrAreaSelector 工作地选择器

## 组件说明

用于选择工作地。提供2种方式选择工作地，用 Tag 展示已选工作地：

1. 展开级联面板选择
2. 输入关键字搜索，使用下拉菜单展示筛选后的工作地

## 基础用法

默认单选，`v-model` 的值为当前被选中的工作地选项的 **value** 属性值。可通过 `map.multiple` 属性设置多选，`v-model` 的值为当前被选中的工作地选项的 **value** 属性值集合。

```vue
<template>
  <div class="example_flex_box">
    <div class="block">
      <span class="demonstration">基础单选</span>
      <hr-area-selector v-model="value1" placeholder="基础单选" />
    </div>
    <div class="block">
      <span class="demonstration">基础多选</span>
      <hr-area-selector v-model="value2" @change="selectorChange" :map="map" ref="selector" placeholder="基础多选" />
    </div>
  </div>
</template>
<script setup>
import { ref } from 'vue';
const value1 = ref(37);
const value2 = ref([]);
const selector = ref(null);
const map = { multiple: true, emitPath: true };
const selectorChange = (selected) => {
  console.log(selected);
  console.log(selector.value.getCheckedNodes(true));
};
</script>
```

## Tag展示

可以仅在输入框中显示选中项最后一级的工作地，而不是选中工作地所在的完整路径。可以折叠展示Tag。

属性 `show-all-levels` 定义了是否显示完整的路径，将其赋值为 `false` 则仅显示最后一级；你也可以设置 `collapseTags` 属性将它们合并为一段文字；还可以设置 `tagsLength` 属性限制展示的Tag文字数量。

```vue
<template>
  <div class="example_flex_box">
    <div class="block">
      <span class="demonstration">仅展示最后一级</span>
      <hr-area-selector v-model="value" :show-all-levels="false" />
    </div>
    <div class="block">
      <span class="demonstration">折叠展示Tag</span>
      <hr-area-selector
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

## 多语言

属性 `lang` 定义了展示语言，默认中文，可选值 `en`。

```vue
<template>
  <hr-area-selector v-model="value" lang="en" />
</template>
<script setup>
import { ref } from 'vue';
const value = ref([]);
</script>
```

## 限制展示的大区或国家

属性 `includeRegionList` 定义了展示大区的集合，默认全展示。100——中国大陆、200——亚太、300——美洲、400——欧洲、500——中东及非洲。

属性 `includeCountryList` 定义了展示国家的集合，默认全展示。

```vue
<template>
  <div class="example_flex_box">
    <div class="block">
      <span class="demonstration">限制展示大区</span>
      <hr-area-selector v-model="value1" :includeRegionList="includeRegionList" />
    </div>
    <div class="block">
      <span class="demonstration">限制展示国家</span>
      <hr-area-selector v-model="value2" :includeCountryList="includeCountryList" />
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

## 完整value值

绑定完整的value值数组。

属性 `map.emitPath` 定义了value是否是完整的路径，默认只返回最后一级，将其赋值为 `true` 则返回完整value，单选为 `[地区id, 国家id, 城市id]`，多选为 `[[地区id, 国家id, 城市id]]`。

```vue
<template>
  <hr-area-selector v-model="value" :map="map" />
</template>
<script setup>
import { ref } from 'vue';
const value = ref([[200, 22, 87]]);
const map = {
  emitPath: true,
  multiple: true,
};
</script>
```

## 展示层级

设置显示的级联层级数。可通过 `level` 来设置显示层级数，默认三级。

```vue
<template>
  <div class="example_flex_box">
    <div class="block">
      <span class="demonstration">仅展示一级</span>
      <hr-area-selector v-model="value1" :level="1" />
    </div>
    <div class="block">
      <span class="demonstration">仅展示二级</span>
      <hr-area-selector v-model="value2" :level="2" />
    </div>
  </div>
</template>
<script setup>
import { ref } from 'vue';
const value1 = ref('');
const value2 = ref(11);
</script>
```

## 尺寸

可通过 `size` 属性指定输入框的尺寸，除了默认的大小外，提供了 **medium**、**small** 尺寸。

```vue
<template>
  <div class="example_flex_box">
    <div class="block">
      <span class="demonstration">默认尺寸</span>
      <hr-area-selector v-model="value1" placeholder="默认尺寸" :map="map" />
    </div>
    <div class="block">
      <span class="demonstration">中等尺寸</span>
      <hr-area-selector v-model="value2" size="medium" :map="map" />
    </div>
    <div class="block">
      <span class="demonstration">较小尺寸</span>
      <hr-area-selector v-model="value3" size="small" :map="map"/>
    </div>
  </div>
</template>
<script setup>
import { ref } from 'vue';
const value1 = ref('');
const value2 = ref('');
const value3 = ref('');
const map = { multiple: true };
</script>
```

## 回显过滤

可通过 `clearUnmatchedOptions` 属性指定回显清除不存在选项中的值。

```vue
<template>
  <hr-area-selector v-model="value" clearUnmatchedOptions :map="map" />
</template>
<script setup>
import { ref } from 'vue';
const map = { multiple: true };
const value = ref(['这个会被过滤', 18, '不展示']);
</script>
```

## 精简全选数据

可通过 `getTrimmedData` 方法精简获取当前选中项中全选的数据，返回值为 `{trimmedIdList:[], trimmedNameList:[]}` 格式，`trimmedIdList` 代表全选value绑定值数组，`trimmedNameList` 代表全选label绑定值数组。当前面层级全选时，后面层级会过滤掉。

可通过 `setTrimmedData` 方法将精简全选的数据回显，传参为 `trimmedIdList`。`getTrimmedData` 和 `setTrimmedData` 中使用了异步查询，同步后才能查看更新后的双向绑定值。

```vue
<template>
  <div class="example_flex_box">
    <div class="block">
      <div class="demonstration">
        <t-button @click="getTrimmedData" theme="default" variant="outline">获取数据</t-button>
      </div>
      <hr-area-selector v-model="value1" ref="selector1" :map="map" />
    </div>
    <div class="block">
      <div class="demonstration">
        <t-button @click="setTrimmedData" theme="default" variant="outline">设置回显</t-button>
      </div>
      <hr-area-selector v-model="value2" ref="selector2" :map="map" />
    </div>
  </div>
</template>
<script setup>
import { ref } from 'vue';
const value1 = ref([]);
const value2 = ref([]);
const map = { multiple: true };
const trimmedData = ref({
  trimmedIdList: [], // 全选value绑定值数组
  trimmedNameList: [], // 全选label绑定值数组
});
const selector1 = ref(null);
const selector2 = ref(null);
const getTrimmedData = async () => {
  trimmedData.value = await selector1.value.getTrimmedData();
  console.log(trimmedData.value);
};
const setTrimmedData = async () => {
  await selector2.value.setTrimmedData(trimmedData.value.trimmedIdList);
  console.log(value2.value);
};
</script>
```

## 选择任意一级选项

父子节点选中状态不再关联，可各自选中或取消。

> **注：由于各级数据存在重复id，所以value双向绑定的值是fullpath id全路径，回显也需要传全路径回显，如：`[".1.", ".1.100."]`**

```vue
<template>
  <div class="example_flex_box">
    <div class="block">
      <span class="demonstration">任意一级单选</span>
      <hr-area-selector v-model="value1" :map="map" checkStrictly />
    </div>
    <div class="block">
      <span class="demonstration">任意一级多选</span>
      <hr-area-selector v-model="value2" :map="map2" ref="selector" checkStrictly @change="change" />
    </div>
  </div>
</template>
<script setup>
import { ref } from 'vue';
const value1 = ref('');
const value2 = ref([]);
const map = { multiple: false, value: 'trimmedId' };
const map2 = { multiple: true, value: 'trimmedId' };
const selector = ref(null);
const change = async () => {
  const trimmedData = await selector.value.getTrimmedData();
  console.log('trimmedData', trimmedData);
  console.log('value2', value2.value);
};
</script>
```

## 通过setDataByIdList方法设置回显

通过 `setDataByIdList` 方法传入idList转换成fullpath id全路径回显。

```vue
<template>
  <hr-area-selector v-model="value" ref="selector" checkStrictly :map="map" />
</template>
<script setup>
import { ref, onMounted } from 'vue';
const value = ref([]);
const selector = ref(null);
const map = { multiple: true, value: 'trimmedId' };
const setDataByIdList = () => {
  selector.value.setDataByIdList([3, 182, 241, 77]);
  console.log(value.value);
};
onMounted(() => {
  setDataByIdList();
});
</script>
```

## 选中值模式

设置选中值的展示及返回值。通过 `valueMode` 属性设置选中值模式：
- `onlyLeaf`（默认）：选中值仅呈现叶子节点
- `parentFirst`：当子节点全部选中时，仅父节点在选中值里面
- `all`：父节点和子节点全部会出现在选中值里面

可通过 `setDataByIdList` 方法将选择的id数据转换成精简fullpath id全路径回显，`setDataByIdList` 中使用了异步查询，同步后才能查看更新后的双向绑定值。

```vue
<template>
  <div class="example_flex_box">
    <div class="block">
      <span class="demonstration">all模式</span>
      <hr-area-selector
        ref="selector1"
        v-model="value1"
        valueMode="all"
        :map="{ multiple: true, value: 'trimmedId' }"
      />
    </div>
    <div class="block">
      <span class="demonstration" @click="setDataByIdList">parentFirst模式</span>
      <hr-area-selector
        ref="selector2"
        v-model="value2"
        @change="selectorChange"
        :map="{ multiple: true, value: 'trimmedId' }"
        valueMode="parentFirst"
        placeholder="parentFirst模式"
      />
    </div>
  </div>
</template>
<script setup>
import { ref } from 'vue';
const value1 = ref([]);
const value2 = ref([]);
const selector1 = ref(null);
const selector2 = ref(null);
const setDataByIdList = async () => {
  await selector1.value.setDataByIdList([3, 182, 241, 77]);
  await selector2.value.setDataByIdList([3, 182, 241, 77]);
};
const selectorChange = (val) => {
  console.log(val, value2.value);
};
</script>
```

## 数据源

选择器内置的工作地数据是在初始时从远程服务器拉取的，用户可替换自己的数据源。

`getLocationList` 属性接收一个 `Promise`，完成状态时的返回值为有清晰层级结构的工作地集合。如果数据源字段与选择器默认要求的 **value，label，children** 不一致，可通过 `map` 属性进行映射。

```vue
<template>
  <hr-area-selector v-model="value" :map="map" :getLocationList="customGetRegion" showTotal></hr-area-selector>
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
      label: '东南',
      children: [
        {
          value: 2,
          label: '上海',
          children: [
            { value: 3, label: '普陀' },
            { value: 4, label: '黄埔' },
            { value: 5, label: '徐汇' },
          ],
        },
        {
          value: 6,
          label: '江苏',
          children: [
            { value: 7, label: '南京' },
            { value: 8, label: '苏州' },
            { value: 9, label: '无锡' },
          ],
        },
        {
          value: 10,
          label: '浙江',
          children: [
            { value: 11, label: '杭州' },
            { value: 12, label: '宁波' },
            { value: 13, label: '嘉兴' },
          ],
        },
      ],
    },
    {
      value: 17,
      label: '西北',
      children: [
        {
          value: 18,
          label: '陕西',
          children: [
            { value: 19, label: '西安' },
            { value: 20, label: '延安' },
          ],
        },
        {
          value: 21,
          label: '新疆维吾尔族自治区',
          children: [
            { value: 22, label: '乌鲁木齐' },
            { value: 23, label: '克拉玛依' },
          ],
        },
      ],
    },
  ];
  resolve(remoteData);
});
</script>
```

## API

### 属性 (Props)

| 参数 | 说明 | 类型 | 可选值 | 默认值 |
| --- | --- | --- | --- | --- |
| v-model / modelValue | 绑定值 | Array / String / Number | — | — |
| size | 输入框尺寸 | String | medium / small | — |
| lang | 语言 | String | en | — |
| level | 层级数 | Number | 1、2、3 | 3 |
| disabled | 是否禁用 | Boolean | — | false |
| showTotal | 是否显示后置的已选数量 | Boolean | — | false |
| placeholder | 占位符 | String | — | — |
| separator | 选项分隔符 | String | — | 斜杠'/' |
| collapseTags | 多选模式下是否折叠Tag | Boolean | — | false |
| tagsLength | Tag最大展示文字数, 最小1 | Number | — | 13 |
| showAllLevels | 输入框中是否显示选中值的完整路径 | Boolean | — | true |
| clearUnmatchedOptions | 回显时清除不存在选项列表中的选项 | Boolean | — | false |
| checkStrictly | 父子节点选中状态不再关联，可各自选中或取消 | Boolean | — | false |
| valueMode | 选中值模式 | String | onlyLeaf / parentFirst / all | onlyLeaf |
| includeRegionList | 可展示的大区集合 | Array | — | [100, 200, 300, 400, 500] |
| includeCountryList | 可展示的国家集合（默认全展示） | Array | — | [] |
| map | 映射配置，具体见下表 | Object | — | — |
| getLocationList | 获取层级工作地数据的方法 | Promise | — | — |
| customClass | 自定义类名 | String | — | — |

### map 映射配置

| 参数 | 说明 | 类型 | 可选值 | 默认值 |
| --- | --- | --- | --- | --- |
| value | 指定选项的值为选项对象的某个属性值 | String | — | 'value' |
| label | 指定选项标签为选项对象的某个属性值 | String | — | 'label' |
| children | 指定选项的子选项为选项对象的某个属性值 | String | — | 'children' |
| emitPath | 在选中节点改变时，是否返回由该节点所在的各级菜单的值所组成的数组 | Boolean | — | false |
| multiple | 是否多选 | Boolean | — | false |

### 事件 (Events)

| 事件名称 | 说明 | 回调参数 |
| --- | --- | --- |
| change | 选中项发生变化时触发 | 目前的选中项, 包含label、value、path数组、fullName、fullOptions数组。TS 类型：`CascaderSelectedOption[]` |

### 方法 (Methods)

| 方法名 | 说明 | 参数 | 返回值 |
| --- | --- | --- | --- |
| clearSelected | 用于清空选中项 | — | — |
| getCheckedNodes | 获取选中的节点 | (leafOnly) 是否只是叶子节点，默认值为 false | 选中值节点数组。TS类型：`CascaderTreeNode[]` |
| getCheckedData | 获取选中的数据 | — | 目前的选中项, 包含label、value、path数组、fullName、fullOptions数组。TS 类型：`CascaderSelectedOption[]` |
| getTrimmedData | 精简获取全选选中的节点 | — | 返回值为 `{trimmedIdList:[], trimmedNameList:[]}` 格式。TS 类型：`AreaSelectorTrimmedData` |
| setTrimmedData | 通过精简设置选中的节点 | trimmedIdList | — |
| setDataByIdList | checkStrictly模式通过id集合转换成fullpath id全路径回显 | Array | — |
