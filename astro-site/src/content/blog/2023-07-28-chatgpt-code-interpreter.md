---
title: "ChatGPT Code Interpreter: Data Analysis for Everyone"
description: "OpenAI released Code Interpreter for ChatGPT Plus subscribers on July 6, 2023 — and within a week it had become my default tool for quick data exploration…"
author: Michael John Peña
draft: false
date: 2023-07-28
tags:
  - ChatGPT
  - Code Interpreter
  - AI
  - Data Analysis
---

OpenAI released Code Interpreter for ChatGPT Plus subscribers on July 6, 2023 — and within a week it had become my default tool for quick data exploration tasks. The capability is: upload a file (CSV, Excel, JSON, image, PDF), ask a question about it in natural language, and Code Interpreter writes Python, executes it in a sandboxed environment, and returns the result alongside the code it used. For exploratory data analysis — distribution plots, summary statistics, outlier detection, quick correlation matrices — this cuts what used to be a 20-minute notebook session to under two minutes. The session is ephemeral (files and results don't persist between conversations, and the sandbox resets), but for quick analysis tasks that's fine. Microsoft later renamed this feature "Advanced Data Analysis" — the underlying capability is the same.

## Understanding Code Interpreter

```python
# What Code Interpreter can do
capabilities = {
    "data_analysis": [
        "Load and explore datasets",
        "Statistical analysis",
        "Data cleaning and transformation",
        "Aggregations and grouping"
    ],
    "visualization": [
        "Line charts, bar charts, scatter plots",
        "Histograms and distributions",
        "Heatmaps and correlation matrices",
        "Custom multi-panel figures"
    ],
    "file_operations": [
        "Read CSV, Excel, JSON, Parquet",
        "Convert between formats",
        "Generate downloadable files",
        "Process images and PDFs"
    ],
    "computation": [
        "Mathematical calculations",
        "Statistical tests",
        "Machine learning models",
        "Optimization problems"
    ]
}
```

## Effective Prompting Strategies

### Data Exploration

```markdown
**Prompt Example:**
"I've uploaded a sales dataset. Please:
1. Show me the first 10 rows
2. Describe the data types and missing values
3. Provide summary statistics for all numerical columns
4. Identify the unique values in categorical columns"

**Why it works:**
- Specific requests
- Clear numbered steps
- Covers essential exploration tasks
```

### Analysis Requests

```markdown
**Good Prompt:**
"Analyze the relationship between customer age and purchase amount:
1. Create a scatter plot with trend line
2. Calculate correlation coefficient
3. Segment by age groups (18-25, 26-35, 36-50, 50+)
4. Show average purchase by segment
5. Test if differences are statistically significant"

**Better Prompt:**
"I want to understand if customer age affects purchase behavior.
Context: This is e-commerce data from Q1 2023.
Goal: Determine if we should create age-targeted marketing.

Please analyze age vs purchase amount with appropriate statistics
and visualizations. Recommend whether age-based segmentation would
be valuable based on the data."
```

### Visualization Requests

```markdown
**Basic Request:**
"Create a chart showing sales by month"

**Enhanced Request:**
"Create a professional sales trend visualization:
- Line chart with monthly sales for 2022-2023
- Include year-over-year comparison (dual lines)
- Add a 3-month moving average trend line
- Mark the highest and lowest months
- Use a blue color scheme
- Title: 'Monthly Sales Performance'
- Include legend and axis labels
- Make it presentation-ready"
```

## Common Analysis Workflows

### Data Quality Assessment

```markdown
**Prompt:**
"Perform a comprehensive data quality check:

1. Missing Values Analysis
   - Count and percentage of nulls per column
   - Visualize missing data patterns

2. Duplicate Detection
   - Find exact duplicates
   - Find potential duplicates (same key fields)

3. Data Type Validation
   - Check if numerical columns contain non-numeric values
   - Validate date formats

4. Range/Value Validation
   - Identify outliers using IQR
   - Check for impossible values (negative quantities, future dates)

5. Create a data quality report I can share with my team"
```

### Comparative Analysis

```markdown
**Prompt:**
"Compare performance across regions:

Data: Sales data with region, product, date, amount

Analysis needed:
1. Total sales by region (table and bar chart)
2. Growth rate by region (month-over-month)
3. Top products per region
4. Statistical test to determine if regional differences are significant
5. Identify the best and worst performing region with reasoning"
```

### Predictive Analysis

```markdown
**Prompt:**
"I want to predict next month's sales:

Using the historical sales data I've uploaded:
1. Prepare the data for time series analysis
2. Identify trends and seasonality
3. Build a simple forecasting model
4. Generate predictions for the next 4 weeks
5. Show confidence intervals
6. Explain the model's assumptions and limitations
7. Create a visualization comparing historical vs predicted"
```

## Working with Different File Types

### CSV/Excel Files

```markdown
**Prompt:**
"I'm uploading a CSV file with customer data.
- File has headers in row 1
- Date format is MM/DD/YYYY
- Amount columns use commas as thousands separators
- Some cells have 'N/A' for missing values

Please load this correctly and show me the cleaned version."
```

### JSON Data

```markdown
**Prompt:**
"I'm uploading JSON data from an API response.
The structure is:
{
  'data': [
    {'id': 1, 'metrics': {'views': 100, 'clicks': 10}}
  ],
  'pagination': {...}
}

Please flatten this into a tabular format and analyze the metrics."
```

### Multiple Files

```markdown
**Prompt:**
"I'm uploading two files:
1. transactions.csv - Sales transactions
2. products.csv - Product catalog

Please:
1. Join them on product_id
2. Calculate total sales per product category
3. Identify products with no sales
4. Create a comprehensive product performance report"
```

## Advanced Techniques

### Iterative Analysis

```markdown
**Initial Prompt:**
"Load the data and show me initial insights"

**Follow-up 1:**
"That's interesting. Dig deeper into the anomaly in March"

**Follow-up 2:**
"Can you correlate that with the marketing campaigns data?"

**Follow-up 3:**
"Create a summary slide with the key findings"
```

### Custom Visualizations

```markdown
**Prompt:**
"Create a dashboard-style visualization with:
- 4 panels in a 2x2 grid
- Top-left: KPI summary (total sales, growth %)
- Top-right: Sales trend line chart
- Bottom-left: Top 10 products bar chart
- Bottom-right: Regional distribution pie chart

Use a consistent professional color scheme.
Make it suitable for executive presentation."
```

### Generating Reports

```markdown
**Prompt:**
"Generate a comprehensive analysis report as a downloadable file:

Format: Well-structured text report (Markdown)

Sections:
1. Executive Summary (key findings in 3 bullets)
2. Data Overview (size, date range, completeness)
3. Key Metrics (with calculated values)
4. Trend Analysis (with inline chart descriptions)
5. Recommendations (3-5 actionable items)
6. Technical Appendix (methodology notes)

Also create the visualizations as separate downloadable PNG files."
```

## Tips for Better Results

```python
tips = {
    "be_specific": {
        "bad": "Analyze this data",
        "good": "Calculate monthly revenue growth rate and identify the top 3 growth drivers"
    },
    "provide_context": {
        "bad": "What's wrong with this data?",
        "good": "This is e-commerce data. Look for data quality issues that would affect sales analysis"
    },
    "iterate": {
        "tip": "Start broad, then drill into specifics",
        "example": "Start with overview, then ask about specific anomalies"
    },
    "request_explanation": {
        "tip": "Ask for methodology and interpretation",
        "example": "Explain what this correlation means for our business"
    },
    "download_outputs": {
        "tip": "Request downloadable files for reports and visualizations",
        "example": "Create a PNG of this chart and provide a download link"
    }
}
```

## Limitations to Keep in Mind

```python
limitations = {
    "session_persistence": "Files and analysis reset after session ends",
    "file_size": "Large files may hit memory limits",
    "real_time_data": "Cannot fetch live data from APIs",
    "complex_models": "Deep learning may hit compute limits",
    "exact_formatting": "Visual formatting may need adjustments"
}

# Workarounds
workarounds = {
    "large_files": "Sample or aggregate before uploading",
    "session_limits": "Download important outputs before session ends",
    "complex_analysis": "Break into smaller steps"
}
```

Tomorrow we'll explore data analysis patterns with AI.

## Resources

- [ChatGPT Plus](https://openai.com/chatgpt)
- [OpenAI Usage Policies](https://openai.com/policies/usage-policies)
- [Data Analysis Best Practices](https://openai.com/blog/chatgpt-plugins#code-interpreter)
