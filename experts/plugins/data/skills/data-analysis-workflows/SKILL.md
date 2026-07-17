---
name: data-analysis-workflows
description: >
  Comprehensive data analysis workflows including answering data questions, exploring datasets,
  writing SQL queries, creating visualizations, building dashboards, and validating analyses.
  Use when conducting data analysis tasks, from quick lookups to comprehensive reports.
---

# Data Analysis Workflows

Complete workflows for common data analysis tasks. Covers the full process from understanding requirements to delivering validated results.

## Workflow 1: Answer Data Questions

Answer a data question, from a quick lookup to a full analysis to a formal report.

### 1. Understand the Question

Parse the user's question and determine:

- **Complexity level**:
  - **Quick answer**: Single metric, simple filter, factual lookup (e.g., "How many users signed up last week?")
  - **Full analysis**: Multi-dimensional exploration, trend analysis, comparison (e.g., "What's driving the drop in conversion rate?")
  - **Formal report**: Comprehensive investigation with methodology, caveats, and recommendations (e.g., "Prepare a quarterly business review of our subscription metrics")
- **Data requirements**: Which tables, metrics, dimensions, and time ranges are needed
- **Output format**: Number, table, chart, narrative, or combination

### 2. Gather Data

**Options for data access:**

1. Ask the user to provide data:
   - Paste query results directly
   - Upload a CSV or Excel file
   - Describe the schema so you can write queries for them to run
2. If writing queries for manual execution, use the \`sql-queries\` skill for dialect-specific best practices
3. Once data is provided, proceed with analysis

### 3. Analyze

- Calculate relevant metrics, aggregations, and comparisons
- Identify patterns, trends, outliers, and anomalies
- Compare across dimensions (time periods, segments, categories)
- For complex analyses, break the problem into sub-questions and address each

### 4. Validate Before Presenting

Before sharing results, run through validation checks:

- **Row count sanity**: Does the number of records make sense?
- **Null check**: Are there unexpected nulls that could skew results?
- **Magnitude check**: Are the numbers in a reasonable range?
- **Trend continuity**: Do time series have unexpected gaps?
- **Aggregation logic**: Do subtotals sum to totals correctly?

If any check raises concerns, investigate and note caveats.

### 5. Present Findings

**For quick answers:**
- State the answer directly with relevant context
- Include the query used (collapsed or in a code block) for reproducibility

**For full analyses:**
- Lead with the key finding or insight
- Support with data tables and/or visualizations
- Note methodology and any caveats
- Suggest follow-up questions

**For formal reports:**
- Executive summary with key findings
- Methodology section explaining approach and data sources
- Detailed findings with supporting evidence
- Caveats and limitations
- Recommendations and next steps
- Appendix with full queries and data tables

---

## Workflow 2: Explore and Profile Datasets

Generate a comprehensive data profile for a table or uploaded file. Understand its shape, quality, and patterns before diving into analysis.

### 1. Access the Data

**If a file is provided (CSV, Excel, Parquet, JSON):**
1. Read the file and load into a working dataset
2. If the file is large, sample it for profiling

**If user describes a table:**
1. Ask for sample data or schema information
2. Generate profiling queries for the user to run

### 2. Profile the Dataset

Generate a report covering:

#### Basic Statistics
- **Row count**: Total number of records
- **Column count**: Number of fields
- **Primary key**: Identify unique identifier(s)
- **Grain**: One row per what? (user, order, event, etc.)
- **Time range**: For temporal data, first and last dates

#### Column-Level Analysis

For each column, report:
- **Type**: String, integer, float, date, boolean, etc.
- **Null rate**: Percentage of missing values
- **Cardinality**: Number of unique values
- **Sample values**: Examples of what the column contains
- **Distribution**: For numeric columns, min/max/mean/median/std dev

#### Data Quality Flags

Automatically identify potential issues:
- High null rates (>10%)
- Unexpected values (e.g., negative values in a count field)
- Duplicate rows
- Inconsistent formatting (mixed case, trailing spaces)
- Time gaps in temporal data

### 3. Recommend Next Steps

Based on profiling results, suggest:
- **High-value dimensions** to explore (columns with moderate cardinality, low nulls)
- **Data quality issues** to address before analysis
- **Potential relationships** to investigate (correlated columns, hierarchies)
- **Analysis starting points** based on the data's structure

---

## Workflow 3: Write Optimized SQL

Write a SQL query from a natural language description, optimized for your specific SQL dialect and following best practices.

### 1. Understand the Request

Parse the user's description to identify:

- **Output columns**: What fields should the result include?
- **Filters**: What conditions limit the data (time ranges, segments, statuses)?
- **Aggregations**: Are there GROUP BY operations, counts, sums, averages?
- **Joins**: Does this require combining multiple tables?
- **Ordering**: How should results be sorted?
- **Limits**: Is there a top-N or sample requirement?

### 2. Determine SQL Dialect

Ask the user which database they're using if not specified:
- PostgreSQL / Aurora / Supabase
- Snowflake
- BigQuery
- Databricks / Spark SQL
- Redshift
- MySQL / MariaDB

Each dialect has syntax differences for date functions, string operations, and window functions.

### 3. Write the Query

Use CTEs (Common Table Expressions) for complex queries:

\`\`\`sql
WITH base_data AS (
  -- First CTE: Get the base dataset
  SELECT ...
),
aggregated AS (
  -- Second CTE: Perform aggregations
  SELECT ...
)
-- Final SELECT from CTEs
SELECT * FROM aggregated;
\`\`\`

**Best practices:**
- Use explicit JOIN syntax (not implicit joins in WHERE clause)
- Qualify all column names with table aliases when joining
- Use meaningful CTE and alias names
- Add comments explaining complex logic
- Format for readability (indent, line breaks)
- Consider performance (filter early, avoid SELECT *, use appropriate indexes)

### 4. Add Context

Include with the query:
- **Purpose**: One-line description of what the query does
- **Tables used**: Which tables are referenced
- **Performance notes**: Expected row counts, potential bottlenecks
- **Dialect-specific notes**: Any syntax specific to the database being used

---

## Workflow 4: Create Visualizations

Create publication-quality data visualizations using Python. Generates charts from data with best practices for clarity, accuracy, and design.

### 1. Understand the Request

Determine:

- **Data source**: Query results, pasted data, CSV/Excel file, or data to be queried
- **Chart type**: Explicitly requested or needs to be recommended
- **Purpose**: Exploration, presentation, report, dashboard component
- **Audience**: Technical team, executives, external stakeholders

### 2. Get the Data

If data is not yet provided:
- Ask the user to paste data or upload a file
- If querying is needed, use the SQL workflow to generate the query first

### 3. Choose the Right Chart Type

Select visualization based on what you're showing:

| What You're Showing | Best Chart | When to Use |
|---------------------|------------|-------------|
| **Trend over time** | Line chart | Continuous time series, shows change |
| **Comparison across categories** | Bar chart | Comparing discrete categories |
| **Part-to-whole** | Stacked bar / Pie | Composition, relative sizes |
| **Distribution** | Histogram / Box plot | Understanding spread and outliers |
| **Correlation** | Scatter plot | Relationship between two variables |
| **Ranking** | Horizontal bar | Ordered list, easy to read labels |

### 4. Generate Python Code

Use \`plotly\` for interactive charts, \`seaborn\` or \`matplotlib\` for static charts.

**Chart template pattern:**

\`\`\`python
import matplotlib.pyplot as plt
import pandas as pd

# Load data
df = pd.DataFrame({...})

# Create figure
fig, ax = plt.subplots(figsize=(10, 6))

# Plot
ax.plot(df['x'], df['y'])  # or .bar(), .scatter(), etc.

# Style
ax.set_title('Clear, Descriptive Title', fontsize=14, fontweight='bold')
ax.set_xlabel('X Axis Label')
ax.set_ylabel('Y Axis Label')
ax.grid(axis='y', alpha=0.3)

# Show
plt.tight_layout()
plt.show()
\`\`\`

### 5. Apply Design Principles

- **Clarity**: Remove chart junk, use clear labels
- **Accuracy**: Don't truncate axes to exaggerate differences
- **Accessibility**: Use colorblind-friendly palettes
- **Context**: Add reference lines, annotations for key points

---

## Workflow 5: Build Interactive Dashboards

Build a self-contained interactive HTML dashboard with charts, filters, tables, and professional styling. Opens directly in a browser -- no server or dependencies required.

### 1. Understand Dashboard Requirements

Determine:

- **Purpose**: Executive overview, operational monitoring, deep-dive analysis, team reporting
- **Audience**: Who will use this dashboard?
- **Key metrics**: What numbers matter most?
- **Dimensions**: What should users be able to filter or slice by?
- **Data source**: Live query, pasted data, CSV file, or sample data

### 2. Gather the Data

If data needs to be queried, use the SQL workflow.
If data is provided, ensure it's in a structured format (CSV or JSON).

### 3. Design Dashboard Layout

Organize into sections:

1. **Header**: Title, date range, key filters
2. **KPI cards**: 3-5 big numbers that matter most
3. **Primary charts**: 2-3 main visualizations (trends, comparisons)
4. **Details section**: Tables or secondary charts for drill-down
5. **Footer**: Methodology notes, data source, last updated

### 4. Generate HTML/JS Code

Use this template structure:

\`\`\`html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Dashboard Title</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
    <style>
        /* CSS styling */
    </style>
</head>
<body>
    <div class="container">
        <!-- Dashboard content -->
    </div>
    <script>
        // Data
        const data = { /* embed data here */ };
        
        // Charts
        // Filters
        // Interactivity
    </script>
</body>
</html>
\`\`\`

### 5. Add Interactivity

Implement:
- **Dropdown filters**: Filter by category, time range, segment
- **Chart interactions**: Hover tooltips, click to drill-down
- **Table sorting**: Click column headers to sort
- **Dynamic updates**: Filters update all charts simultaneously

---

## Workflow 6: Validate Analysis Before Sharing

Review an analysis for accuracy, methodology, and potential biases before sharing with stakeholders. Generates a confidence assessment and improvement suggestions.

### 1. Review Methodology and Assumptions

Examine:

**Data selection:**
- Which tables/sources were used? Are they the right ones?
- What time range? Is it recent enough?
- Any filters applied? Do they introduce bias?

**Aggregation logic:**
- Are groupings appropriate for the question?
- Do subtotals match totals?
- Are nulls handled correctly (excluded vs. counted as zero)?

**Statistical methods:**
- If using averages, is median more appropriate?
- If comparing percentages, are denominators consistent?
- If showing trends, is seasonality accounted for?

### 2. Check for Common Pitfalls

**Survivorship bias:**
- Example: Analyzing only current customers excludes churned users
- Check: Does the analysis need to include historical records?

**Selection bias:**
- Example: Survey responses from only power users
- Check: Is the sample representative of the population?

**Simpson's paradox:**
- Example: Overall trend contradicts subgroup trends when aggregated
- Check: Break down by segments before concluding

**Correlation vs. causation:**
- Example: Ice cream sales correlate with drowning deaths (both caused by summer)
- Check: Are confounding variables at play?

### 3. Sanity Check Results

Compare results to expectations:

- **Magnitude**: Are numbers in the right ballpark?
- **Direction**: Do trends match known business context?
- **Consistency**: Do related metrics tell the same story?

If something looks off:
- Recheck the query
- Look for data quality issues
- Consider if external factors could explain it

### 4. Assess Confidence Level

Rate confidence as:

- **High confidence**: Methodology sound, results validated, limitations documented
- **Medium confidence**: Minor concerns or caveats, but core findings are solid
- **Needs more work**: Methodological issues or data quality problems need addressing

### 5. Document Limitations

Every analysis has limits. Document:
- What's excluded from the data
- Assumptions made
- Margin of error or uncertainty
- Known data quality issues
- Alternative interpretations

**Example caveat:**
> "This analysis excludes trial users, which may overstate conversion rate by ~5pp compared to total signups."

---

## When to Use Each Workflow

- **Answer Data Questions**: User has a specific question to answer
- **Explore Datasets**: Encountering a new table or dataset
- **Write SQL**: Need to generate queries for manual execution
- **Create Visualizations**: Need charts for reports or presentations
- **Build Dashboards**: Need interactive, shareable dashboards
- **Validate Analysis**: Before sharing important findings with stakeholders

Use these workflows in combination for complex projects. For example:
1. Explore data → 2. Write SQL → 3. Create visualization → 4. Validate → 5. Share
