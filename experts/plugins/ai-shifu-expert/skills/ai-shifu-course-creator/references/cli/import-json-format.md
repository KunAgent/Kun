# Import JSON Format

The `build` command generates a `shifu-import.json` file that can be imported to the AI-Shifu platform.

## Schema

```json
{
  "version": "1.0",
  "shifu": {
    "shifu_bid": "<UUID>",
    "title": "Course Title",
    "description": "Description",
    "keywords": "keywords",
    "llm": "",
    "llm_temperature": 0,
    "course_prompt": "<content from course-prompt.md>",
    "ask_enabled_status": 5101,
    "price": 0.0
  },
  "outline_items": [
    {
      "outline_item_bid": "<UUID>",
      "title": "Lesson Title",
      "type": 401,
      "parent_bid": "",
      "position": "0",
      "content": "<MarkdownFlow content>"
    }
  ],
  "structure": { "bid": "<shifu_bid>", "type": "shifu", "children": [] }
}
```

## Key Fields

- `course_prompt`: Course-level AI role definition (from `course-prompt.md`). The CLI maps this to the platform API field `system_prompt` when calling `/shifus/<bid>/detail`.
- `description`: Learner-facing SEO/listing description. For course-directory builds, the CLI resolves it from `--description`, then `course-description.md`, then empty string.
- `type: 401`: Regular lesson node
- `parent_bid`: Empty string = chapter (top-level container); non-empty = lesson (child node with MarkdownFlow content). Use `add-chapter` to create chapters, then pass the chapter BID as `--parent-bid` when creating lessons
- `content`: The MarkdownFlow prompt content (this is the core teaching material)
- `ask_enabled_status: 5101`: Enables learner questions
