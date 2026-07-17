<!-- ============================================================
  TRACKMATE:EVENT_LIST_ONLY  (MACHINE-READABLE CONTRACT — DO NOT BREAK)
  ============================================================
  本文件是 TrackMate 平台的机器可解析文档（Event List）。
  平台 AI 依据严格结构解析本文件生成埋点登记与数据看板，
  任何与该结构无关的内容都会导致解析失败或数据错误。

  【允许出现的内容 · 白名单】
    1. 本 HTML 注释块（契约声明）
    2. 唯一一个 H1 标题：`# <Skill名> 埋点事件清单 Event List`
    3. 唯一一张 Markdown 表格（表头固定为下方 10 列）
    4. 表格与 H1 之间、文件末尾的空行

  【禁止出现的内容 · 黑名单，违反即视为污染】
    - 任何散文、段落、句子、说明文字（表格单元格内的字段说明除外）
    - 其他层级标题（H2/H3/H4…）
    - 设计理由、讨论过程、决策记录、FAQ、Q&A、TODO
    - 变更历史、版本记录、作者署名、修订日志
    - 示例代码块、配置片段、引用块（>）、列表（- / 1.）
    - 链接、图片、图标、emoji 装饰（表格内字段说明除外）
    - 其他 HTML 注释（除本契约注释外）
    - 任何形式的"补充说明""备注""附录""相关阅读"

  【修改准则】
    - 仅允许对事件表做「增 / 删 / 改」行，或调整单元格内字段说明文案
    - 表头 10 列的列名、顺序、数量不可变更
    - 如对话中产生了设计讨论 / 决策 / 备注等内容，一律不得写入本文件；
      它们只应留在对话记录、CHANGELOG 或其他文档中

  【AI 写入前自检清单 · 必须全部通过】
    [ ] 文件开头是否仅有本契约注释 + 1 个 H1 + 1 张表格？
    [ ] 表格是否正好 10 列？表头是否与下方一致？
    [ ] 是否出现了任何散文、标题、列表、代码块、额外注释？
    任一不通过 → 必须在写入前删除污染内容。
============================================================ -->

# interview-assistant 埋点事件清单 Event List

| 事件名称 eventCode | 采集方式 collection | 上报时机 trigger | 设备标识 A2 | 用户标识 skill_user | Skill名称 skill_name | 运行平台 skill_platform | 操作系统 skill_os | Skill版本 skill_version | 私有参数 params |
|---------|:------------:|----------|-------|-------|-------|-------|-------|-------|-------|
| `skill_invoked` Skill调用 | Hook&track | 用户加载skill时 | 机器指纹 | whoami自动采集 | interview-assistant | 运行时自动检测 | 运行时自动检测 | 从配置自动读取 | `session_id` STRING 会话ID；`source` STRING 调用来源；`intent_category` ENUM(todo,schedule,prepare,evaluate) 意图分类 |
| `task_completed` 任务完成 | Hook&track | 核心任务流程结束时 | 机器指纹 | whoami自动采集 | interview-assistant | 运行时自动检测 | 运行时自动检测 | 从配置自动读取 | `session_id` STRING 会话ID；`status` ENUM(success,fail,partial) 完成状态；`fail_reason` ENUM(skill_bug,llm_limitation,user_cancel,dependency_error,timeout) 失败归因；`feedback` ENUM(positive,negative,retry,abandon) 用户反馈 |
| `error_occurred` 异常发生 | track | 捕获到异常或错误时 | 机器指纹 | whoami自动采集 | interview-assistant | 运行时自动检测 | 运行时自动检测 | 从配置自动读取 | `error_type` ENUM(mcp_error,decode_error,api_timeout,script_error) 错误类型；`error_message` STRING 错误摘要；`phase` ENUM(router,flow_load,mcp_call,decode,output) 发生阶段；`error_code` STRING 错误码 |
| `session_end` 会话结束 | Hook | 会话关闭时 | 机器指纹 | whoami自动采集 | interview-assistant | 运行时自动检测 | 运行时自动检测 | 从配置自动读取 | `session_id` STRING 会话ID；`duration_seconds` NUMBER 会话时长秒；`reason` STRING 结束原因；`turn_count` NUMBER 对话轮数 |
| `todo_queried` 查待办 | track | 用户查询面试待办时 | 机器指纹 | whoami自动采集 | interview-assistant | 运行时自动检测 | 运行时自动检测 | 从配置自动读取 | `session_id` STRING 会话ID；`sub_flow` ENUM(T,T2) 子模块；`status` ENUM(success,fail) 完成状态 |
| `interview_scheduled` 面试安排 | track | 用户安排或改期或取消面试时 | 机器指纹 | whoami自动采集 | interview-assistant | 运行时自动检测 | 运行时自动检测 | 从配置自动读取 | `session_id` STRING 会话ID；`action` ENUM(create,reschedule,cancel,check) 操作类型；`status` ENUM(success,fail) 完成状态 |
| `quiz_generated` 出题 | track | 面试计划或出题完成时 | 机器指纹 | whoami自动采集 | interview-assistant | 运行时自动检测 | 运行时自动检测 | 从配置自动读取 | `session_id` STRING 会话ID；`bg` STRING BG名称；`station` STRING 岗位；`recruit_type` ENUM(campus,social,intern) 招聘类型；`match_level` ENUM(auto-matched,bg-fallback,type-fallback,global-fallback) 模型匹配级别；`status` ENUM(success,fail) 完成状态 |
| `evaluation_written` 写面评 | track | 面评填写完成时 | 机器指纹 | whoami自动采集 | interview-assistant | 运行时自动检测 | 运行时自动检测 | 从配置自动读取 | `session_id` STRING 会话ID；`bg` STRING BG名称；`station` STRING 岗位；`has_transcript` ENUM(yes,no) 是否有转写；`status` ENUM(success,fail) 完成状态 |
| `resume_evaluated` 评简历 | track | 简历评估完成时 | 机器指纹 | whoami自动采集 | interview-assistant | 运行时自动检测 | 运行时自动检测 | 从配置自动读取 | `session_id` STRING 会话ID；`bg` STRING BG名称；`station` STRING 岗位；`status` ENUM(success,fail) 完成状态 |
