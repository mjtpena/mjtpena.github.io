---
title: "SQL AI Functions in Databricks: LLMs Meet SQL"
author: "Michael John Peña"
draft: false
date: 2024-04-21
tags: ["Databricks", "SQL", "AI", "LLM", "Data Engineering"]

---

I wrote "SQL AI Functions in Databricks: LLMs Meet SQL" to share practical, production-minded guidance on this topic.

Databricks SQL AI functions bring large language model capabilities directly into SQL queries. Process text, generate insights, and enrich data without leaving SQL.

## Available AI Functions

```sql
-- Overview of Databricks SQL AI Functions

-- 1. ai_analyze_sentiment() - Sentiment analysis
SELECT
    review_id,
    review_text,
    ai_analyze_sentiment(review_text) as sentiment
FROM product_reviews;

-- 2. ai_classify() - Text classification
SELECT
    ticket_id,
    description,
    ai_classify(description, ARRAY('bug', 'feature', 'question', 'other')) as category
FROM support_tickets;

-- 3. ai_extract() - Entity extraction
SELECT
    email_id,
    ai_extract(email_body, ARRAY('person_name', 'company', 'date')) as entities
FROM emails;

-- 4. ai_fix_grammar() - Grammar correction
SELECT
    document_id,
    ai_fix_grammar(content) as corrected_content
FROM documents;

-- 5. ai_gen() - Text generation
SELECT
    product_id,
    product_name,
    ai_gen(CONCAT('Write a short marketing description for: ', product_name)) as description
FROM products;

-- 6. ai_mask() - PII masking
SELECT
    customer_id,
    ai_mask(notes, ARRAY('email', 'phone', 'ssn')) as masked_notes
FROM customer_notes;

-- 7. ai_query() - Custom LLM queries
SELECT
    data_id,
    ai_query('databricks-meta-llama-3-70b-instruct', custom_prompt) as result
FROM data_for_analysis;

-- 8. ai_similarity() - Semantic similarity
SELECT
    doc1_id,
    doc2_id,
    ai_similarity(doc1_text, doc2_text) as similarity_score
FROM document_pairs;

-- 9. ai_summarize() - Text summarization
SELECT
    article_id,
    ai_summarize(article_content, 100) as summary
FROM articles;

-- 10. ai_translate() - Translation
SELECT
    message_id,
    original_text,
    ai_translate(original_text, 'es', 'en') as english_translation
FROM messages;
```

## Practical Use Cases

```sql
-- Use Case 1: Customer Feedback Analysis Pipeline

-- Create a view that enriches feedback with AI analysis
CREATE OR REPLACE VIEW enriched_feedback AS
SELECT
    feedback_id,
    customer_id,
    feedback_text,
    feedback_date,

    -- Sentiment analysis
    ai_analyze_sentiment(feedback_text) as sentiment,

    -- Categorization
    ai_classify(
        feedback_text,
        ARRAY('product_quality', 'shipping', 'customer_service', 'pricing', 'other')
    ) as category,

    -- Extract mentioned products
    ai_extract(feedback_text, ARRAY('product_name')) as mentioned_products,

    -- Generate response suggestion
    ai_gen(
        CONCAT(
            'As a customer service agent, write a brief, professional response to this feedback: ',
            feedback_text
        )
    ) as suggested_response

FROM customer_feedback
WHERE feedback_date >= DATE_SUB(CURRENT_DATE, 30);

-- Query the enriched view
SELECT
    sentiment,
    category,
    COUNT(*) as count,
    AVG(CASE WHEN sentiment = 'positive' THEN 1 ELSE 0 END) as positive_rate
FROM enriched_feedback
GROUP BY sentiment, category
ORDER BY count DESC;
```

```sql
-- Use Case 2: Document Processing Pipeline

-- Process legal documents
WITH document_analysis AS (
    SELECT
        document_id,
        document_type,
        content,

        -- Summarize document
        ai_summarize(content, 200) as summary,

        -- Extract key entities
        ai_extract(
            content,
            ARRAY('party_names', 'dates', 'monetary_values', 'legal_terms')
        ) as entities,

        -- Classify document type
        ai_classify(
            content,
            ARRAY('contract', 'amendment', 'nda', 'agreement', 'notice')
        ) as classified_type,

        -- Check for specific clauses
        ai_query(
            'databricks-meta-llama-3-70b-instruct',
            CONCAT(
                'Does this document contain a non-compete clause? Answer YES or NO only. Document: ',
                SUBSTRING(content, 1, 3000)
            )
        ) as has_noncompete

    FROM legal_documents
    WHERE ingestion_date >= DATE_SUB(CURRENT_DATE, 7)
)
SELECT
    document_id,
    document_type,
    classified_type,
    summary,
    entities,
    CASE WHEN UPPER(has_noncompete) LIKE '%YES%' THEN TRUE ELSE FALSE END as has_noncompete_clause
FROM document_analysis;
```

```sql
-- Use Case 3: Product Catalog Enrichment

-- Enrich product data with AI-generated content
CREATE OR REPLACE TABLE enriched_products AS
SELECT
    product_id,
    product_name,
    raw_description,
    category,

    -- Generate marketing description
    ai_gen(
        CONCAT(
            'Write an engaging 2-sentence product description for an e-commerce website. ',
            'Product: ', product_name, '. ',
            'Category: ', category, '. ',
            'Features: ', raw_description
        )
    ) as marketing_description,

    -- Generate SEO keywords
    ai_query(
        'databricks-meta-llama-3-70b-instruct',
        CONCAT(
            'List 5 SEO keywords for this product, separated by commas: ',
            product_name, ' - ', raw_description
        )
    ) as seo_keywords,

    -- Translate to Spanish
    ai_translate(raw_description, 'en', 'es') as description_es,

    -- Translate to French
    ai_translate(raw_description, 'en', 'fr') as description_fr

FROM products
WHERE needs_enrichment = TRUE;
```

## Performance Optimization

```sql
-- Optimizing AI function usage

-- 1. Batch processing with windowing
WITH batched AS (
    SELECT
        id,
        text,
        ROW_NUMBER() OVER (ORDER BY id) as row_num,
        FLOOR((ROW_NUMBER() OVER (ORDER BY id) - 1) / 100) as batch_id
    FROM large_text_table
)
SELECT
    id,
    text,
    ai_analyze_sentiment(text) as sentiment
FROM batched
WHERE batch_id = 0  -- Process one batch at a time
;

-- 2. Caching results in a delta table
CREATE TABLE IF NOT EXISTS sentiment_cache (
    text_hash STRING,
    text STRING,
    sentiment STRING,
    analyzed_at TIMESTAMP
);

-- Insert only new texts
INSERT INTO sentiment_cache
SELECT
    md5(text) as text_hash,
    text,
    ai_analyze_sentiment(text) as sentiment,
    CURRENT_TIMESTAMP as analyzed_at
FROM source_table s
WHERE NOT EXISTS (
    SELECT 1 FROM sentiment_cache c
    WHERE c.text_hash = md5(s.text)
);

-- 3. Limit text length to reduce tokens
SELECT
    id,
    ai_summarize(SUBSTRING(long_text, 1, 5000), 100) as summary
FROM documents;

-- 4. Use appropriate models for task
-- For simple tasks, use faster models
SELECT
    ai_query(
        'databricks-meta-llama-3-8b-instruct',  -- Faster, smaller model
        simple_prompt
    ) as result
FROM simple_tasks;

-- For complex tasks, use larger models
SELECT
    ai_query(
        'databricks-meta-llama-3-70b-instruct',  -- More capable model
        complex_prompt
    ) as result
FROM complex_tasks;
```

## Error Handling

```sql
-- Handle potential AI function failures

SELECT
    id,
    text,
    CASE
        WHEN text IS NULL OR LENGTH(TRIM(text)) = 0 THEN 'EMPTY_INPUT'
        WHEN LENGTH(text) > 10000 THEN ai_analyze_sentiment(SUBSTRING(text, 1, 10000))
        ELSE ai_analyze_sentiment(text)
    END as sentiment
FROM texts;

-- Using TRY for graceful failure handling
SELECT
    id,
    text,
    TRY(ai_analyze_sentiment(text)) as sentiment,
    CASE WHEN TRY(ai_analyze_sentiment(text)) IS NULL THEN 'FAILED' ELSE 'SUCCESS' END as status
FROM texts;
```

## Cost Management

```python
# Monitor AI function costs

AI_FUNCTION_COSTS = {
    "ai_analyze_sentiment": "~0.001 per call",
    "ai_classify": "~0.001 per call",
    "ai_summarize": "~0.002-0.01 depending on length",
    "ai_query": "Varies by model and tokens",
    "ai_translate": "~0.002 per call"
}

# Best practices for cost management:
COST_TIPS = [
    "Cache results for repeated text",
    "Batch process during off-peak hours",
    "Use smaller models for simple tasks",
    "Limit input text length",
    "Sample data for exploration, full data for production"
]
```

## Conclusion

SQL AI functions bring LLM capabilities directly into your data workflows. Use them for text analysis, content generation, and data enrichment while following best practices for performance and cost.

