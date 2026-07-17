# AI 单页生成幻灯片

> aippt.execute 单接口单页生成幻灯片：HTML 布局模式，一次调用完成，可通过 wpp.import_slides 插入到已有演示文稿

**适用场景**：用户需要快速生成一页幻灯片，插入到已有 PPT 中。

**触发词**：生成单页、单页生成、生成一页幻灯片、做一页PPT、快速生成一页、生成单页HTML、HTML幻灯片、生成HTML幻灯片

**工具链**：快速生成单页幻灯片并插入已有 PPT → `aippt.execute`(single_page) → `wpp.import_slides`

## 执行流程

> **前置阅读**：执行前必须阅读 `references/aippt.md` 了解相关工具的使用方法和参数要求。
> 该流程使用 `aippt.execute` 单接口完成单页幻灯片生成。
> 一次调用即可完成，无需 follow_up 交互。
> 每次调用超时设为 **1800000 毫秒**：--timeout 1800000。

```
步骤 1: aippt.execute(task_type="single_page", mode="html", input=[{type:"text", content:"用户主题"}], options={width:1280, height:720})
        → auth_check.start → auth_check.done
        → gen_ppt.start → gen_ppt.done 含 merged_file_url（PPTX 下载链接）
        → finish_reason: stop

步骤 2: wpp.import_slides(link_id=<目标PPT的link_id>, object_url=<步骤1返回的merged_file_url>, slide_idx=<插入位置>, source_idxs=[0])
        → 从目标PPT的金山文档链接路径末尾提取 link_id，无需先调 `get_share_info`
        → 将生成的 PPTX 导入到已有演示文稿的指定位置

步骤 3: 展示结果给用户
        → 确认幻灯片已插入到目标演示文稿
        → 将用户提供的目标 PPT 链接返回，告知用户可打开查看
```
