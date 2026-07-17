# 全文翻译

## 1. pdf.translate_full_file

#### 功能说明

提交 PDF 全文翻译请求，并以同步语义返回结果。

**适用于**：将 PDF（或 doc 内核文件）按指定语言做整文翻译并导出结果文件。

- 工具内部会将 `async_mode` 映射为下游 `_m`
- 若下游返回任务态，工具会自动轮询进度直到完成或失败
- 默认按全文翻译；如需局部翻译可传 `pages` 指定页码区间（1-based）



> 鉴权依赖 Cookie `wps_sid`
> 若返回任务态，建议直接信任工具的同步结果，无需额外轮询

#### 调用示例

发起中英全文翻译导出：

```json
{
  "async_mode": 0,
  "file_id": "file_pdf_001",
  "file_source": {
    "origin": "kdocs.cn"
  },
  "header": {
    "trace_id": "trace_demo_001"
  },
  "body": {
    "biz": "translation_export"
  },
  "from_lang": "zh",
  "to_lang": "en",
  "engine_type": "ciba",
  "output_file_mode": 2,
  "output_file_two_lang": true,
  "pages": [
    {
      "begin": 1,
      "end": 5
    }
  ]
}
```


#### 参数说明

- `async_mode` (integer, 可选): 映射下游 `_m` 参数；默认 0；默认值：`0`
- `file_type` (string, 可选): 文件类型，传 `doc` 走文字内核；默认 PDF 内核
- `file_id` (string, 必填): 待导出文件 ID，可传空字符串（表示当前文件）
- `file_source` (object, 必填): 文档来源信息，包含 `origin`、`s3_params`、`s3_file_info` 等，必须包含 origin: kdocs.cn
- `password` (string, 可选): 文件密码。**注意：暂不支持加密文件。**
- `header` (object, 必填): 下游透传 header 参数
- `body` (object, 必填): 下游透传 body 参数
- `from_lang` (string, 必填): 源语言。必须先调用 read_file 读取文档内容，根据文档实际内容判断语言：
1. 分析文档中的文字内容，识别其主要语言
2. 如果文档主要是中文，则传 "zh"
3. 如果文档主要是其他语言（如英文、日文等），则传对应的语言代码
4. 严禁假设或猜测语言，必须基于实际读取的文件内容来判断

支持的语言代码：
| 代号 | 语言 |
|------|------|
| zh | 简体中文 |
| cht | 繁体中文 |
| en | 英语 |
| jp | 日语 |
| th | 泰语 |
| fra | 法语 |
| spa | 西班牙语 |
| kor | 韩语 |
| tr | 土耳其语 |
| vie | 越南语 |
| ms | 马来语 |
| de | 德语 |
| ru | 俄语 |
| ara | 阿拉伯语 |
| est | 爱沙尼亚语 |
| be | 白俄罗斯语 |
| bul | 保加利亚语 |
| hi | 印地语 |
| is | 冰岛语 |
| tl | 他加禄语（菲律宾） |
| fin | 芬兰语 |
| af | 南非荷兰语 |
| ca | 加泰罗尼亚语 |
| cs | 捷克语 |
| hr | 克罗地亚语 |
| lv | 拉脱维亚语 |
| lt | 立陶宛语 |
| rom | 罗马尼亚语 |
| no | 挪威语 |
| pt | 葡萄牙语 |
| swe | 瑞典语 |
| sr | 塞尔维亚语 |
| eo | 世界语 |
| sk | 斯洛伐克语 |
| slo | 斯洛文尼亚语 |
| sw | 斯瓦希里语 |
| uk | 乌克兰语 |
| iw | 希伯来语 |
| el | 希腊语 |
| hu | 匈牙利语 |
| hy | 亚美尼亚语 |
| it | 意大利语 |
| id | 印尼语 |
| sq | 阿尔巴尼亚语 |
| am | 阿姆哈拉语 |
| az | 阿塞拜疆语 |
| eu | 巴斯克语 |
| bn | 孟加拉语 |
| bs | 波斯尼亚语 |
| gl | 加利西亚语 |
| jy | 爪哇语 |
| gu | 古吉拉特语 |
| ig | 伊博语 |
| ga | 爱尔兰语 |
| zu | 祖鲁语 |
| kn | 卡纳达语 |
| ka | 格鲁吉亚语 |
| ky | 吉尔吉斯语 |
| lb | 卢森堡语 |
| mk | 马其顿语 |
| mt | 马耳他语 |
| mi | 毛利语 |
| mr | 马拉地语 |
| ne | 尼泊尔语 |
| pa | 旁遮普语 |
| si | 僧伽罗语 |
| ta | 泰米尔语 |
| te | 泰卢固语 |
| ur | 乌尔都语 |
| uz | 乌兹别克语 |
| cy | 威尔士语 |
| yo | 约鲁巴语 |
| pl | 波兰语 |
| my | 缅甸语 |
| ti | 提格雷尼亚语 |

- `to_lang` (string, 必填): 目标语言。需要根据源语言自动匹配：当 from_lang="zh"（源语言是中文）时传 "en"（英文）；当 from_lang 不是 "zh" 时传 "zh"（中文）。支持的语言代码：
| 代号 | 语言 |
|------|------|
| zh | 简体中文 |
| cht | 繁体中文 |
| en | 英语 |
| jp | 日语 |
| th | 泰语 |
| fra | 法语 |
| spa | 西班牙语 |
| kor | 韩语 |
| tr | 土耳其语 |
| vie | 越南语 |
| ms | 马来语 |
| de | 德语 |
| ru | 俄语 |
| ara | 阿拉伯语 |
| est | 爱沙尼亚语 |
| be | 白俄罗斯语 |
| bul | 保加利亚语 |
| hi | 印地语 |
| is | 冰岛语 |
| tl | 他加禄语（菲律宾） |
| fin | 芬兰语 |
| af | 南非荷兰语 |
| ca | 加泰罗尼亚语 |
| cs | 捷克语 |
| hr | 克罗地亚语 |
| lv | 拉脱维亚语 |
| lt | 立陶宛语 |
| rom | 罗马尼亚语 |
| no | 挪威语 |
| pt | 葡萄牙语 |
| swe | 瑞典语 |
| sr | 塞尔维亚语 |
| eo | 世界语 |
| sk | 斯洛伐克语 |
| slo | 斯洛文尼亚语 |
| sw | 斯瓦希里语 |
| uk | 乌克兰语 |
| iw | 希伯来语 |
| el | 希腊语 |
| hu | 匈牙利语 |
| hy | 亚美尼亚语 |
| it | 意大利语 |
| id | 印尼语 |
| sq | 阿尔巴尼亚语 |
| am | 阿姆哈拉语 |
| az | 阿塞拜疆语 |
| eu | 巴斯克语 |
| bn | 孟加拉语 |
| bs | 波斯尼亚语 |
| gl | 加利西亚语 |
| jy | 爪哇语 |
| gu | 古吉拉特语 |
| ig | 伊博语 |
| ga | 爱尔兰语 |
| zu | 祖鲁语 |
| kn | 卡纳达语 |
| ka | 格鲁吉亚语 |
| ky | 吉尔吉斯语 |
| lb | 卢森堡语 |
| mk | 马其顿语 |
| mt | 马耳他语 |
| mi | 毛利语 |
| mr | 马拉地语 |
| ne | 尼泊尔语 |
| pa | 旁遮普语 |
| si | 僧伽罗语 |
| ta | 泰米尔语 |
| te | 泰卢固语 |
| ur | 乌尔都语 |
| uz | 乌兹别克语 |
| cy | 威尔士语 |
| yo | 约鲁巴语 |
| pl | 波兰语 |
| my | 缅甸语 |
| ti | 提格雷尼亚语 |

- `engine_type` (string, 必填): 翻译引擎类型
- `enable_sp_tag_trans` (boolean, 可选): 是否开启 SP 标签翻译；默认值：`false`
- `pages` (array, 必填): 页码区间数组，每项包含 "begin"、"end"、"task_id"，全文翻译传[{"begin": 0, "end": 总页数-1}]
- `output_file_mode` (integer, 必填): 导出模式，`1` 左右流式、`2` 左右保持格式、`5` 上下对照
- `output_file_two_lang` (boolean, 必填): 是否导出双语
- `orig_para_bg_color` (string, 可选): 原文段落背景色，如 `0xffffffff`
- `client_chan` (string, 可选): 客户端渠道标识；默认值：`00001.00000001`
- `client_type` (string, 可选): 客户端类型；默认值：`wps-pc`
- `client_version` (string, 可选): 客户端版本；默认值：`0.0.0.0`
- `client_lang` (string, 可选): 客户端语言；默认值：`zh_CN`
- `device_id` (string, 可选): 客户端设备 ID
- `min_font_scale` (string, 可选): 最小字体缩放比例
- `is_trans_image` (boolean, 可选): 是否翻译图片；默认值：`false`

#### 返回值说明

```json
{
  "code": {
    "type": "number"
  },
  "msg": {
    "type": "string"
  },
  "data": {
    "type": "object",
    "fields": [
      {
        "name": "task_id",
        "type": "string",
        "description": "翻译任务 ID（任务态时返回）"
      },
      {
        "name": "status",
        "type": "string",
        "description": "任务状态，如 processing/success/failed"
      },
      {
        "name": "progress",
        "type": "integer",
        "description": "任务进度（百分比）"
      },
      {
        "name": "result",
        "type": "object",
        "description": "最终翻译导出结果（完成时返回）"
      }
    ]
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `data.task_id` | string | 翻译任务 ID（任务态时返回） |
| `data.status` | string | 任务状态，如 processing/success/failed |
| `data.progress` | integer | 任务进度（百分比） |
| `data.result` | object | 最终翻译导出结果（完成时返回） |


---

## 2. pdf.get_translate_progress

#### 功能说明

根据任务 ID 查询全文翻译任务当前进度或最终结果。

**适用于**：手动轮询全文翻译任务状态，或在外部流程中获取实时进度。

- `task_id` 会映射到下游 `_t`
- 推荐在 `pdf.translate_full_file` 未返回最终态时使用



> 建议轮询间隔 1-2 秒

#### 调用示例

查询全文翻译任务进度：

```json
{
  "file_id": "file_pdf_001",
  "task_id": "task_translate_123"
}
```


#### 参数说明

- `file_id` (string, 必填): 文件 ID
- `task_id` (string, 必填): 全文翻译任务 ID
- `file_type` (string, 可选): 文件类型。传 `doc` 拉起文字内核；不传默认 PDF 内核

#### 返回值说明

```json
{
  "code": {
    "type": "number"
  },
  "msg": {
    "type": "string"
  },
  "data": {
    "type": "object",
    "fields": [
      {
        "name": "status",
        "type": "string",
        "description": "任务状态，如 processing/success/failed"
      },
      {
        "name": "progress",
        "type": "integer",
        "description": "任务进度（百分比）"
      },
      {
        "name": "result",
        "type": "object",
        "description": "完成后的导出结果"
      }
    ]
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `data.status` | string | 任务状态，如 processing/success/failed |
| `data.progress` | integer | 任务进度（百分比） |
| `data.result` | object | 完成后的导出结果 |


---

## 3. pdf.cancel_translate

#### 功能说明

取消指定文件的全文翻译任务。

**适用于**：用户主动中止全文翻译，或任务长时间阻塞需要终止。



**幂等性**：是

> 若任务已完成，接口可能返回可接受的幂等结果

#### 调用示例

取消全文翻译任务：

```json
{
  "file_id": "file_pdf_001"
}
```


#### 参数说明

- `file_id` (string, 必填): 被取消全文翻译的文件 ID

#### 返回值说明

```json
{
  "code": {
    "type": "number"
  },
  "msg": {
    "type": "string"
  },
  "data": {
    "type": "object",
    "fields": [
      {
        "name": "canceled",
        "type": "boolean",
        "description": "是否取消成功"
      },
      {
        "name": "task_id",
        "type": "string",
        "description": "被取消的任务 ID（若下游返回）"
      }
    ]
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `data.canceled` | boolean | 是否取消成功 |
| `data.task_id` | string | 被取消的任务 ID（若下游返回） |


---

