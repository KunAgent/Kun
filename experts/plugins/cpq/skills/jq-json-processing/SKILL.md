---
created: 2025-12-16
modified: 2026-05-04
reviewed: 2026-04-25
name: jq-json-processing
description: JSON querying, filtering, and transformation with jq command-line tool. Use when working with JSON data, parsing JSON files, filtering JSON arrays/objects, or transforming JSON structures.
user-invocable: false
allowed-tools: Bash(jq *), Bash(cat *), Read, Write, Edit, Grep, Glob
model: sonnet
---

# jq JSON Processing

Expert knowledge for processing, querying, and transforming JSON data using jq, the lightweight and flexible command-line JSON processor.

## When to Use This Skill

| Use this skill when... | Use yq-yaml-processing instead when... |
|---|---|
| Extracting or filtering fields in JSON input | Working with YAML files (Kubernetes, GH Actions, Helm) |
| Parsing `gh`, `curl`, or `kubectl -o json` responses | Editing YAML in place while preserving comments |
| CI pipelines on minimal images (jq is universally installed) | Converting YAML → JSON before processing |

| Use this skill when... | Use nushell-data-processing instead when... |
|---|---|
| One-off pipeline transforms that fit in a single expression | Multi-step transforms that span JSON, YAML, CSV, and TOML |
| Stdin-piped JSON from another command | Aggregations, group-by, or visual table exploration |

## Core Expertise

**JSON Operations**
- Query and filter JSON with path expressions
- Transform JSON structure and shape
- Combine, merge, and split JSON data
- Validate JSON syntax and structure

**Data Extraction**
- Extract specific fields from JSON objects
- Filter arrays based on conditions
- Navigate nested JSON structures
- Handle null values and missing keys

## Essential Commands

### Basic Querying

```bash
# Pretty-print JSON
jq '.' file.json

# Extract specific field
jq '.fieldName' file.json

# Extract nested field
jq '.user.email' file.json

# Extract array element
jq '.[0]' file.json
jq '.items[2]' file.json
```

### Array Operations

```bash
# Get array length
jq '.items | length' file.json

# Map over array
jq '.items | map(.name)' file.json

# Filter array
jq '.items[] | select(.active == true)' file.json
jq '.users[] | select(.age > 18)' file.json

# Sort array
jq '.items | sort_by(.name)' file.json
jq '.items | sort_by(.date) | reverse' file.json

# Get first/last elements
jq '.items | first' file.json
jq '.items | last' file.json

# Unique values
jq '.tags | unique' file.json
```

### Object Operations

```bash
# Get all keys
jq 'keys' file.json
jq '.config | keys' file.json

# Get all values
jq '.[] | values' file.json

# Select specific fields
jq '{name, email}' file.json
jq '{name: .fullName, id: .userId}' file.json

# Add field
jq '. + {newField: "value"}' file.json

# Delete field
jq 'del(.password)' file.json

# Merge objects
jq '. * {updated: true}' file.json
```

### Filtering and Conditions

```bash
# Select with conditions
jq 'select(.status == "active")' file.json
jq '.[] | select(.price < 100)' file.json

# Multiple conditions (AND)
jq '.[] | select(.active and .verified)' file.json
jq '.[] | select(.age > 18 and .country == "US")' file.json

# Multiple conditions (OR)
jq '.[] | select(.type == "admin" or .type == "moderator")' file.json

# Exists / has field
jq '.[] | select(has("email"))' file.json
jq 'select(.optional != null)' file.json

# Not condition
jq '.[] | select(.status != "deleted")' file.json
```

### String Operations

```bash
# String interpolation
jq '"Hello, \(.name)"' file.json

# Convert to string
jq '.id | tostring' file.json

# String contains
jq '.[] | select(.email | contains("@gmail.com"))' file.json

# String starts/ends with
jq '.[] | select(.name | startswith("A"))' file.json
jq '.[] | select(.file | endswith(".json"))' file.json

# Split string
jq '.path | split("/")' file.json

# Join array to string
jq '.tags | join(", ")' file.json

# Lowercase/uppercase
jq '.name | ascii_downcase' file.json
jq '.name | ascii_upcase' file.json
```

### Pipes and Composition

```bash
# Chain operations
jq '.items | map(.name) | sort | unique' file.json

# Multiple filters
jq '.users[] | select(.active) | select(.age > 18) | .email' file.json

# Group by
jq 'group_by(.category)' file.json
jq 'group_by(.status) | map({status: .[0].status, count: length})' file.json
```

### Output Formatting

```bash
# Compact output (no pretty-print)
jq -c '.' file.json

# Raw output (no quotes for strings)
jq -r '.message' file.json
jq -r '.items[] | .name' file.json

# Output as tab-separated values
jq -r '.[] | [.name, .age, .email] | @tsv' file.json

# Output as CSV
jq -r '.[] | [.name, .age, .email] | @csv' file.json

# Output as JSON array on one line
jq -c '[.items[]]' file.json
```

### Input/Output Options

```bash
# Read from stdin
cat file.json | jq '.items'
curl -s https://api.example.com/data | jq '.results'

# Multiple input files
jq -s '.' file1.json file2.json  # Slurp into array

# Write to file
jq '.filtered' input.json > output.json

# In-place edit (use sponge from moreutils)
jq '.updated = true' file.json | sponge file.json
```

### Advanced Patterns

```bash
# Recursive descent
jq '.. | .email? // empty' file.json

# Reduce (sum, accumulate)
jq '[.items[].price] | add' file.json
jq 'reduce .items[] as $item (0; . + $item.price)' file.json

# Variable assignment
jq '.items[] | . as $item | $item.name + " - " + ($item.price | tostring)' file.json

# Conditional (if-then-else)
jq '.items[] | if .price > 100 then "expensive" else "affordable" end' file.json
jq 'if .error then .error else .data end' file.json

# Try-catch for error handling
jq '.items[] | try .field catch "not found"' file.json

# Flatten nested arrays
jq '.items | flatten' file.json
jq '.items | flatten(1)' file.json  # Flatten one level
```

### Real-World Examples

```bash
# Extract all emails from nested structure
jq '.. | .email? // empty' users.json

# Get unique list of all tags across items
jq '[.items[].tags[]] | unique' data.json

# Count items by status
jq 'group_by(.status) | map({status: .[0].status, count: length})' items.json

# Transform API response to simple list
jq '.results[] | {id, name: .full_name, active: .is_active}' response.json

# Filter GitHub workflow runs (recent failures)
gh run list --json status,conclusion,name,createdAt | \
  jq '.[] | select(.conclusion == "failure") | {name, createdAt}'

# Extract package.json dependencies with versions
jq '.dependencies | to_entries | map("\(.key)@\(.value)")' package.json

# Merge two JSON files
jq -s '.[0] * .[1]' base.json override.json

# Create summary from log data
jq 'group_by(.level) | map({level: .[0].level, count: length, samples: [.[].message][:3]})' logs.json
```

## Best Practices

**Query Construction**
- Start simple, build complexity incrementally
- Test filters on small datasets first
- Use `-c` flag for compact output in scripts
- Use `-r` flag for raw strings (no quotes)

**Performance**
- Use `select()` early in pipeline to reduce data
- Use targeted queries with specific paths for large files
- Stream large JSON with `--stream` flag
- Consider `jq -c` for faster processing

**Error Handling**
- Use `?` operator for optional access: `.field?`
- Use `// empty` to filter out nulls/errors
- Use `try-catch` for graceful error handling
- Check for field existence with `has("field")`

**Readability**
- Break complex queries into multiple steps
- Use variables with `as $var` for clarity
- Add comments in shell scripts
- Format multi-line jq programs for readability

## Common Patterns

### API Response Processing
```bash
# GitHub API: Get PR titles and authors
gh pr list --json title,author,number | \
  jq -r '.[] | "#\(.number) - \(.title) by @\(.author.login)"'

# REST API: Extract and flatten pagination
curl -s "https://api.example.com/items" | \
  jq '.data.items[] | {id, name, status}'
```

### Configuration Files
```bash
# Extract environment-specific config
jq '.environments.production' config.json

# Update configuration value
jq '.settings.timeout = 30' config.json > config.updated.json

# Merge base config with environment overrides
jq -s '.[0] * .[1]' base-config.json prod-config.json
```

### Log Analysis
```bash
# Count errors by type
jq 'select(.level == "error") | .type' logs.json | sort | uniq -c

# Extract error messages with timestamps
jq -r 'select(.level == "error") | "\(.timestamp) - \(.message)"' logs.json

# Group by hour and count
jq -r '.timestamp | split("T")[1] | split(":")[0]' logs.json | sort | uniq -c
```

### Data Transformation
```bash
# CSV to JSON (with headers)
jq -R -s 'split("\n") | .[1:] | map(split(",")) |
  map({name: .[0], age: .[1], email: .[2]})' data.csv

# JSON to CSV
jq -r '.[] | [.name, .age, .email] | @csv' data.json

# Flatten nested structure
jq '[.items[] | {id, name, category: .meta.category}]' nested.json
```

## Troubleshooting

### Invalid JSON
```bash
# Validate JSON syntax
jq empty file.json  # Returns exit code 0 if valid

# Find syntax errors
jq '.' file.json 2>&1 | grep "parse error"
```

### Empty Results
```bash
# Debug: Print entire structure
jq '.' file.json

# Debug: Check field existence
jq 'keys' file.json
jq 'type' file.json  # Check if array, object, etc.

# Debug: Show all values
jq '.. | scalars' file.json
```

### Type Errors
```bash
# Check field types
jq '.field | type' file.json

# Convert types safely
jq '.id | tonumber' file.json
jq '.count | tostring' file.json

# Handle mixed types
jq '.items[] | if type == "array" then .[] else . end' file.json
```

### Performance Issues
```bash
# Stream large files
jq --stream '.' large-file.json

# Process line by line
cat large.json | jq -c '.[]' | while read -r line; do
  echo "$line" | jq '.field'
done
```

## Integration with Other Tools

```bash
# With curl (API calls)
curl -s "https://api.github.com/users/octocat" | jq '.name, .bio'

# With gh CLI (GitHub operations)
gh api repos/owner/repo/issues | jq '.[] | {number, title, state}'

# With find (batch processing)
find . -name "package.json" -exec jq '.version' {} \;

# With xargs (parallel processing)
cat urls.txt | xargs -I {} curl -s {} | jq '.data'

# With yq (YAML to JSON conversion)
yq eval -o=json file.yaml | jq '.specific.field'
```

## Quick Reference

### Operators
- `.field` - Access field
- `.[]` - Iterate array/object
- `|` - Pipe (chain operations)
- `,` - Multiple outputs
- `?` - Optional (suppress errors)
- `//` - Alternative operator (default value)

### Functions
- `keys`, `values` - Object keys/values
- `length` - Array/object/string length
- `map()`, `select()` - Array operations
- `sort`, `sort_by()` - Sorting
- `group_by()` - Grouping
- `unique` - Remove duplicates
- `add` - Sum numbers or concatenate
- `has()` - Check field existence
- `type` - Get value type

### Type Conversions
- `tostring`, `tonumber` - Convert types
- `@csv`, `@tsv`, `@json` - Format output
- `split()`, `join()` - String/array conversion

## Resources

- **Official Manual**: https://stedolan.github.io/jq/manual/
- **jq Playground**: https://jqplay.org/
- **Tutorial**: https://stedolan.github.io/jq/tutorial/
