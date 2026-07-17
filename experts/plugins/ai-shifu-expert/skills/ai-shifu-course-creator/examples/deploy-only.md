# Deploy Only Example

> Note: Outputs in this example are illustrated in English for clarity. Actual output language follows `references/data-contracts.md#language-resolution` (e.g., Chinese invocation → Chinese output).

Deploy pre-existing Teaching Prompts (and a Course Prompt) without running the authoring pipeline.

## Prerequisites

A course directory with Teaching Prompts (one MarkdownFlow file per lesson) already prepared:

```
my-course/
  README.md
  course-description.md
  course-prompt.md
  lessons/
    lesson-01.md
    lesson-02.md
```

## Deployment

```bash
# Build the import file
python3 {skillDir}/scripts/shifu-cli.py build --course-dir ./my-course/

# Import as a new course
python3 {skillDir}/scripts/shifu-cli.py import --new --json-file ./my-course/shifu-import.json
# Returns: shifu_bid = xyz789

# Publish
python3 {skillDir}/scripts/shifu-cli.py publish xyz789
```

## Management Operations

```bash
# List all courses
python3 {skillDir}/scripts/shifu-cli.py list

# Show course structure
python3 {skillDir}/scripts/shifu-cli.py show xyz789

# Update a lesson
python3 {skillDir}/scripts/shifu-cli.py update-lesson xyz789 <outline_bid> --teaching-prompt-file ./updated-lesson.md

# Rename a lesson
python3 {skillDir}/scripts/shifu-cli.py rename-lesson xyz789 <outline_bid> --name "New Lesson Name"

# Archive when done
python3 {skillDir}/scripts/shifu-cli.py archive xyz789
```

## Acceptance Notes

- Deployment executed independently (Path C).
- Course deployed from pre-existing Teaching Prompts.
- Management commands used for ongoing operations (Path D).
