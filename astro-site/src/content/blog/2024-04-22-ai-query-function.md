---
title: "The ai_query Function: Custom LLM Calls in Databricks SQL"
description: "The aiquery() function enables custom LLM interactions directly in SQL. Unlike specialized functions, it allows you to craft any prompt and get intelligent…"
author: "Michael John Peña"
draft: false
date: 2024-04-22
tags: ["Databricks", "SQL", "AI", "LLM", "ai_query"]
---

The `ai_query()` function enables custom LLM interactions directly in SQL. Unlike specialized functions, it allows you to craft any prompt and get intelligent responses.

## Understanding ai_query

```sql
-- Basic syntax
SELECT ai_query(
    'model_name',           -- The LLM model to use
    'your_prompt_here'      -- Your custom prompt
) as result;

-- Available models (as of April 2024)
-- 'databricks-meta-llama-3-70b-instruct'  - Most capable
-- 'databricks-meta-llama-3-8b-instruct'   - Faster, cost-effective
-- 'databricks-dbrx-instruct'              - Databricks' own model
-- 'databricks-mixtral-8x7b-instruct'      - Good balance
```

## Crafting Effective Prompts

```sql
-- Pattern 1: Simple extraction
SELECT
    order_notes,
    ai_query(
        'databricks-meta-llama-3-70b-instruct',
        CONCAT(
            'Extract the delivery preference from this note. ',
            'Return only: morning, afternoon, evening, or none. ',
            'Note: ', order_notes
        )
    ) as delivery_preference
FROM orders;

-- Pattern 2: Structured output (JSON)
SELECT
    customer_feedback,
    ai_query(
        'databricks-meta-llama-3-70b-instruct',
        CONCAT(
            'Analyze this customer feedback and return JSON with these fields: ',
            '{"sentiment": "positive/negative/neutral", ',
            '"main_topic": "the primary topic", ',
            '"action_needed": true/false, ',
            '"urgency": "low/medium/high"}. ',
            'Feedback: ', customer_feedback,
            '. Return only valid JSON, no explanation.'
        )
    ) as analysis_json
FROM feedback;

-- Pattern 3: Few-shot learning
SELECT
    product_description,
    ai_query(
        'databricks-meta-llama-3-70b-instruct',
        CONCAT(
            'Categorize products based on these examples:\n',
            'Example 1: "Running shoes with cushioned sole" -> Sports & Fitness\n',
            'Example 2: "Wireless bluetooth headphones" -> Electronics\n',
            'Example 3: "Organic green tea bags" -> Food & Beverage\n',
            '\nNow categorize: "', product_description, '"\n',
            'Return only the category name.'
        )
    ) as category
FROM products;

-- Pattern 4: Chain of thought reasoning
SELECT
    financial_data,
    ai_query(
        'databricks-meta-llama-3-70b-instruct',
        CONCAT(
            'Analyze this financial data step by step:\n',
            financial_data, '\n\n',
            'Step 1: Identify the key metrics\n',
            'Step 2: Calculate growth rates\n',
            'Step 3: Identify any concerns\n',
            'Step 4: Provide a brief summary\n\n',
            'Keep each step to one sentence.'
        )
    ) as analysis
FROM quarterly_reports;
```

## Advanced Use Cases

```sql
-- Use Case 1: Intelligent Data Quality Checks
SELECT
    record_id,
    customer_name,
    address,
    ai_query(
        'databricks-meta-llama-3-8b-instruct',
        CONCAT(
            'Is this address valid and complete? ',
            'Check for: street, city, state/province, postal code, country. ',
            'Address: ', address,
            '. Return: VALID, INCOMPLETE (list missing), or INVALID (explain why).'
        )
    ) as address_validation
FROM customer_addresses
WHERE needs_validation = TRUE;

-- Use Case 2: Anomaly Explanation
WITH anomalies AS (
    SELECT
        date,
        metric_name,
        value,
        expected_value,
        (value - expected_value) / expected_value * 100 as deviation_pct
    FROM metrics
    WHERE ABS((value - expected_value) / expected_value) > 0.2
)
SELECT
    date,
    metric_name,
    value,
    expected_value,
    deviation_pct,
    ai_query(
        'databricks-meta-llama-3-70b-instruct',
        CONCAT(
            'On ', CAST(date AS STRING), ', the metric "', metric_name,
            '" had a value of ', CAST(value AS STRING),
            ' but we expected around ', CAST(expected_value AS STRING),
            ' (', ROUND(deviation_pct, 1), '% deviation). ',
            'List 3 possible business reasons for this deviation. ',
            'Be specific and practical.'
        )
    ) as possible_explanations
FROM anomalies;

-- Use Case 3: Automated Report Narratives
WITH monthly_stats AS (
    SELECT
        product_category,
        SUM(revenue) as total_revenue,
        SUM(revenue) / COUNT(DISTINCT order_id) as avg_order_value,
        COUNT(DISTINCT customer_id) as unique_customers,
        LAG(SUM(revenue)) OVER (PARTITION BY product_category ORDER BY month) as prev_revenue
    FROM sales
    WHERE month = DATE_TRUNC('month', CURRENT_DATE - INTERVAL 1 MONTH)
    GROUP BY product_category, month
)
SELECT
    product_category,
    total_revenue,
    avg_order_value,
    unique_customers,
    ai_query(
        'databricks-meta-llama-3-70b-instruct',
        CONCAT(
            'Write a 2-sentence executive summary for the ', product_category, ' category. ',
            'Revenue: $', FORMAT_NUMBER(total_revenue, 0),
            ', Change from last month: ', ROUND((total_revenue - prev_revenue) / prev_revenue * 100, 1), '%, ',
            'Average order: $', FORMAT_NUMBER(avg_order_value, 2),
            ', Unique customers: ', FORMAT_NUMBER(unique_customers, 0), '. ',
            'Highlight the most important insight.'
        )
    ) as summary
FROM monthly_stats;

-- Use Case 4: Smart Data Matching
SELECT
    a.company_name as name_a,
    b.company_name as name_b,
    ai_query(
        'databricks-meta-llama-3-8b-instruct',
        CONCAT(
            'Are these the same company? Consider abbreviations, legal suffixes, and typos. ',
            'Company A: "', a.company_name, '". ',
            'Company B: "', b.company_name, '". ',
            'Answer: SAME, DIFFERENT, or UNCERTAIN with brief reason.'
        )
    ) as match_result
FROM company_list_a a
CROSS JOIN company_list_b b
WHERE SOUNDEX(a.company_name) = SOUNDEX(b.company_name);
```

## Building Dynamic Prompts

```sql
-- Create a prompt template table
CREATE TABLE prompt_templates (
    template_id STRING,
    template_name STRING,
    template_text STRING,
    model_recommendation STRING
);

INSERT INTO prompt_templates VALUES
    ('sentiment_detailed',
     'Detailed Sentiment Analysis',
     'Analyze the sentiment of this text in detail. Provide: overall sentiment (positive/negative/neutral), confidence (0-100), key phrases that influenced the analysis, and any sarcasm detection. Text: {text}',
     'databricks-meta-llama-3-70b-instruct'),

    ('summarize_technical',
     'Technical Document Summary',
     'Summarize this technical document for a non-technical audience. Focus on: what it does, why it matters, and key takeaways. Keep it under 100 words. Document: {text}',
     'databricks-meta-llama-3-70b-instruct');

-- Use templates dynamically
SELECT
    d.document_id,
    d.content,
    ai_query(
        t.model_recommendation,
        REPLACE(t.template_text, '{text}', d.content)
    ) as analysis
FROM documents d
CROSS JOIN prompt_templates t
WHERE t.template_id = 'summarize_technical'
  AND d.document_type = 'technical';
```

## Output Parsing

```sql
-- Parse JSON output from ai_query
WITH ai_results AS (
    SELECT
        feedback_id,
        ai_query(
            'databricks-meta-llama-3-70b-instruct',
            CONCAT(
                'Return JSON: {"sentiment": "pos/neg/neu", "score": 1-10, "topics": ["topic1"]}. ',
                'Analyze: ', feedback_text
            )
        ) as raw_json
    FROM feedback
)
SELECT
    feedback_id,
    raw_json,
    GET_JSON_OBJECT(raw_json, '$.sentiment') as sentiment,
    CAST(GET_JSON_OBJECT(raw_json, '$.score') AS INT) as score,
    GET_JSON_OBJECT(raw_json, '$.topics') as topics
FROM ai_results
WHERE raw_json IS NOT NULL
  AND raw_json LIKE '{%}';  -- Basic JSON validation
```

## Best Practices

```python
AI_QUERY_BEST_PRACTICES = {
    "prompt_engineering": [
        "Be specific about desired output format",
        "Use examples (few-shot) for complex tasks",
        "Include constraints (word limits, format)",
        "Ask for reasoning when needed"
    ],
    "performance": [
        "Use smaller models for simple tasks",
        "Cache results for repeated queries",
        "Batch process large datasets",
        "Limit input text length"
    ],
    "reliability": [
        "Validate JSON outputs before parsing",
        "Use TRY() for error handling",
        "Have fallback logic for failures",
        "Log and monitor failure rates"
    ]
}
```

## Conclusion

The `ai_query()` function is your gateway to custom LLM capabilities in SQL. Master prompt engineering and output parsing to unlock powerful data enrichment and analysis workflows.
