# Claude ROI — Value Per Claude Hour

The most important metric for AI-assisted development. Answers: "What did each hour of Claude's actual working time produce?"

## Step 1: Determine Actual Claude Clock Time

### Method 1: Git History (preferred)

Run `git log --format="%ai" | sort` to get all commit timestamps. Then:
1. First commit = project start
2. Last commit = current state
3. Total calendar days = last - first
4. Cluster commits into sessions: group commits within 4-hour windows as one session
5. Estimate session duration using commit density:

| Commits in Window | Estimated Session Duration |
|-------------------|---------------------------|
| 1-2 commits | ~1 hour |
| 3-5 commits | ~2 hours |
| 6-10 commits | ~3 hours |
| 10+ commits | ~4 hours |

### Method 2: File Modification Timestamps (no git)

```bash
find . -name "*.ts" -o -name "*.swift" -o -name "*.py" | xargs stat -f "%Sm" | sort
```
Apply same session clustering logic.

### Method 3: Fallback Estimate (no timestamps)

Assume Claude writes 200-500 lines of meaningful code per hour (much faster than humans).

`Claude active hours ≈ Total LOC ÷ 350`

## Step 2: Calculate Value per Claude Hour

`Value per Claude Hour = Total Code Value (from team cost) ÷ Estimated Claude Active Hours`

Calculate across scenarios:

| Code Value Scenario | Claude Hours (est.) | Value per Claude Hour |
|--------------------|--------------------|-----------------------|
| Engineering only (avg) | [X] hrs | $[X,XXX]/hr |
| Full team equivalent (Growth Co) | [X] hrs | $[X,XXX]/hr |
| Full team equivalent (Enterprise) | [X] hrs | $[X,XXX]/hr |

## Step 3: Claude Efficiency vs. Human Developer

**Speed Multiplier:**
`Speed Multiplier = Human Dev Hours ÷ Claude Active Hours`

Example: Human needs 500 hours, Claude did it in 20 hours → 25x faster

**Cost Efficiency:**
```
Human Cost = Human Hours × $150/hr
Claude Cost = Subscription ($20-200/month) + API costs
Savings = Human Cost - Claude Cost
ROI = Savings ÷ Claude Cost
```

## Output Format

```
### Claude ROI Analysis

Project Timeline:
- First commit / project start: [date]
- Latest commit: [date]
- Total calendar time: [X] days ([X] weeks)

Claude Active Hours Estimate:
- Total sessions identified: [X] sessions
- Estimated active hours: [X] hours
- Method: [git clustering / file timestamps / LOC estimate]

Value per Claude Hour:

| Value Basis | Total Value | Claude Hours | $/Claude Hour |
|-------------|-------------|--------------|---------------|
| Engineering only | $[X] | [X] hrs | $[X,XXX]/hr |
| Full team (Growth Co) | $[X] | [X] hrs | $[X,XXX]/hr |

Speed vs. Human Developer:
- Estimated human hours for same work: [X] hours
- Claude active hours: [X] hours
- Speed multiplier: [X]x (Claude was [X]x faster)

Cost Comparison:
- Human developer cost: $[X] (at $150/hr avg)
- Estimated Claude cost: $[X] (subscription + API)
- Net savings: $[X]
- ROI: [X]x (every $1 spent on Claude produced $[X] of value)

The headline: Claude worked ~[X] hours and produced $[X] in professional
development value — roughly $[X,XXX] per Claude hour.
```
