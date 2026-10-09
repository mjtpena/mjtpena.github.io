---
title: "Data Analysis with AI: Practical Patterns and Techniques"
description: "The Code Interpreter release this month changed how I approach quick data analysis tasks. Not the deep, production-grade EDA that belongs in a Fabric…"
author: Michael John Peña
draft: false
date: 2023-07-29
tags:
  - AI
  - Data Analysis
  - ChatGPT
  - Azure OpenAI
---

The Code Interpreter release this month changed how I approach quick data analysis tasks. Not the deep, production-grade EDA that belongs in a Fabric notebook with proper version control and reproducibility — but the initial "what does this dataset actually look like?" question that previously required spinning up an environment, writing boilerplate, and wrangling dependencies. Now that question gets answered in a chat session. The patterns that work well: uploading a sample of a larger dataset (Code Interpreter has a file size limit) to validate a transformation logic before implementing it in PySpark; asking for anomaly detection on a KPI time series to quickly identify whether an outlier is real or a data quality issue; and using it as a hypothesis generator — "what correlations might be worth investigating?" — before committing to a full statistical analysis in a notebook.

## AI-Assisted Analysis Workflow

```python
# Modern data analysis workflow with AI
analysis_workflow = {
    "1_exploration": {
        "traditional": "Write pandas code manually",
        "ai_assisted": "Ask AI to explore and summarize data",
        "benefit": "Faster initial understanding"
    },
    "2_cleaning": {
        "traditional": "Manual data quality scripts",
        "ai_assisted": "AI identifies and fixes issues",
        "benefit": "More comprehensive cleaning"
    },
    "3_analysis": {
        "traditional": "Write analysis code",
        "ai_assisted": "Describe analysis needs in plain language",
        "benefit": "Focus on questions, not syntax"
    },
    "4_visualization": {
        "traditional": "Configure matplotlib/seaborn",
        "ai_assisted": "Describe desired visualization",
        "benefit": "Professional charts without design expertise"
    },
    "5_interpretation": {
        "traditional": "Manual interpretation",
        "ai_assisted": "AI suggests insights and implications",
        "benefit": "Discover patterns you might miss"
    }
}
```

## Pattern 1: Exploratory Data Analysis

```python
# EDA Prompt Template
eda_prompt = """
I have a dataset with the following structure:
{describe columns and their meanings}

Context: {business context}

Please perform exploratory data analysis:

1. Data Overview
   - Shape, data types, memory usage
   - Sample of first/last rows

2. Statistical Summary
   - Numerical: mean, median, std, quartiles
   - Categorical: unique counts, top values

3. Missing Data Analysis
   - Missing counts and percentages
   - Patterns in missing data

4. Distribution Analysis
   - Histograms for numerical columns
   - Value counts for categoricals

5. Initial Insights
   - Key observations
   - Potential data quality issues
   - Interesting patterns noticed

Please explain findings in plain language suitable for business stakeholders.
"""
```

### Example Usage

```python
# What you provide to AI:
"""
Dataset: E-commerce transactions
Columns:
- order_id: Unique identifier
- customer_id: Customer reference
- order_date: Transaction date
- product_category: Electronics, Clothing, Home
- quantity: Items purchased
- unit_price: Price per item
- discount_percent: Applied discount
- total_amount: Final amount

Context: We want to understand Q1 2023 sales patterns
to inform inventory planning for Q2.

Please perform EDA focusing on:
- Sales trends over time
- Category performance
- Discount impact on sales
- Customer purchase patterns
"""
```

## Pattern 2: Hypothesis Testing

```python
# Hypothesis testing prompt template
hypothesis_prompt = """
I want to test the following hypothesis:

Hypothesis: {state your hypothesis}
Data available: {describe relevant data}
Significance level: 0.05

Please:
1. Formulate null and alternative hypotheses
2. Choose appropriate statistical test
3. Check test assumptions
4. Perform the test
5. Interpret results in business terms
6. Visualize the comparison
7. State conclusion with confidence level
"""

# Example
"""
Hypothesis: Customers who received email campaigns have higher
average order values than those who didn't.

Data available:
- customer_group: 'email_campaign' or 'control'
- order_value: Amount spent

Please test this hypothesis and tell me if the email campaign
is worth continuing based on statistical evidence.
"""
```

## Pattern 3: Segmentation Analysis

```python
# Customer segmentation prompt
segmentation_prompt = """
I need to segment customers based on their behavior.

Data available:
{list relevant columns}

Business goal: {why you're segmenting}

Please:
1. Prepare data for clustering (handle missing, scale features)
2. Determine optimal number of segments (elbow method, silhouette)
3. Perform clustering (K-means or appropriate algorithm)
4. Profile each segment:
   - Key characteristics
   - Size and percentage
   - Business interpretation
5. Create visualizations:
   - Segment distribution
   - Feature comparison across segments
6. Recommend how to use these segments for {business goal}
"""
```

## Pattern 4: Time Series Analysis

```python
# Time series prompt template
timeseries_prompt = """
Analyze the time series data for: {metric name}
Time range: {date range}
Granularity: {daily/weekly/monthly}

Please provide:

1. Trend Analysis
   - Overall direction
   - Rate of change
   - Trend visualization

2. Seasonality
   - Identify seasonal patterns
   - Quantify seasonal effects
   - Day-of-week / month patterns

3. Anomalies
   - Identify unusual points
   - Potential explanations
   - Impact quantification

4. Forecasting (if applicable)
   - Short-term forecast ({timeframe})
   - Confidence intervals
   - Model assumptions

5. Business Recommendations
   - Based on patterns found
   - Actionable insights
"""
```

## Pattern 5: A/B Test Analysis

```python
# A/B test analysis prompt
ab_test_prompt = """
Analyze the following A/B test:

Test: {what you tested}
Control group: {description}
Treatment group: {description}
Primary metric: {conversion rate/revenue/etc}
Test duration: {timeframe}
Sample sizes: Control={n1}, Treatment={n2}

Please:
1. Calculate key metrics for each group
2. Perform statistical significance test
3. Calculate effect size and confidence interval
4. Check for sample ratio mismatch
5. Analyze by relevant segments (device, region, etc.)
6. Provide clear recommendation: Ship, Don't Ship, or Continue Test

Include visualizations:
- Metric comparison chart
- Confidence interval visualization
- Segment breakdown
"""
```

## Pattern 6: Root Cause Analysis

```python
# Root cause analysis prompt
root_cause_prompt = """
We observed: {describe the problem/anomaly}
When: {time period}
Impact: {business impact}

Available data:
{list relevant datasets and columns}

Please investigate:

1. Confirm the Issue
   - Quantify the anomaly
   - Visualize the deviation from normal

2. Narrow Down
   - Break down by dimensions (region, product, channel)
   - Identify where the issue is concentrated

3. Timeline Analysis
   - When exactly did it start?
   - Was it gradual or sudden?
   - Any correlating events?

4. Correlation Check
   - What other metrics changed at the same time?
   - Potential causal relationships

5. Root Cause Hypothesis
   - Most likely explanation
   - Supporting evidence
   - Recommended actions

6. Monitoring Suggestions
   - How to detect this earlier next time
"""
```

## Best Practices for AI-Assisted Analysis

```python
best_practices = {
    "provide_context": {
        "do": "Explain business goals and constraints",
        "dont": "Just ask 'analyze this data'"
    },
    "be_specific": {
        "do": "List exact columns and metrics of interest",
        "dont": "Assume AI knows your domain"
    },
    "iterate": {
        "do": "Ask follow-up questions to drill deeper",
        "dont": "Expect perfect analysis in one prompt"
    },
    "validate": {
        "do": "Verify AI's calculations on samples",
        "dont": "Blindly trust all outputs"
    },
    "request_methodology": {
        "do": "Ask AI to explain its approach",
        "dont": "Treat it as a black box"
    },
    "combine_with_expertise": {
        "do": "Apply your domain knowledge to interpret",
        "dont": "Replace human judgment entirely"
    }
}
```

## Prompt Engineering Tips

```python
prompt_tips = {
    "structure": "Use numbered lists for multi-part requests",
    "examples": "Provide example outputs when format matters",
    "constraints": "Specify any limitations (time, resources)",
    "audience": "Define who will consume the output",
    "format": "Request specific output formats (table, chart, report)",
    "explanation": "Ask for methodology and assumptions",
    "alternatives": "Request multiple approaches when appropriate"
}

# Prompt template
"""
[Context]
{Background information about the data and business}

[Task]
{Specific analysis request}

[Requirements]
{Numbered list of specific deliverables}

[Constraints]
{Any limitations or considerations}

[Output Format]
{How you want results presented}
"""
```

Tomorrow we'll explore AI-powered visualization techniques.

## Resources

- [OpenAI Best Practices](https://platform.openai.com/docs/guides/gpt-best-practices)
- [Prompt Engineering Guide](https://www.promptingguide.ai/)
- [Data Analysis Patterns](https://learn.microsoft.com/en-us/azure/machine-learning/)
