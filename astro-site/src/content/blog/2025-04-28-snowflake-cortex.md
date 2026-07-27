---
title: "Snowflake Cortex: AI Functions in the Data Cloud"
author: Michael John Peña
draft: false
date: 2025-04-28
tags:
  - Snowflake
  - Cortex
  - AI
  - SQL
  - Data Cloud

---

I wrote "Snowflake Cortex: AI Functions in the Data Cloud" to share practical, production-minded guidance on this topic.

## Snowflake Cortex AI

```sql
-- Snowflake Cortex AI functions

-- Sentiment analysis
SELECT
    review_text,
    SNOWFLAKE.CORTEX.SENTIMENT(review_text) as sentiment_score
FROM product_reviews
WHERE review_date >= '2025-01-01';

-- Text summarization
SELECT
    article_id,
    SNOWFLAKE.CORTEX.SUMMARIZE(article_content) as summary
FROM articles
WHERE length(article_content) > 5000;

-- Translation
SELECT
    original_text,
    SNOWFLAKE.CORTEX.TRANSLATE(original_text, 'es', 'en') as english_text
FROM spanish_comments;

-- Text completion with LLM
SELECT
    product_name,
    SNOWFLAKE.CORTEX.COMPLETE(
        'mistral-large',
        'Write a marketing description for this product: ' || product_name
    ) as description
FROM products
WHERE description IS NULL;

-- Embeddings for semantic search
CREATE OR REPLACE TABLE document_embeddings AS
SELECT
    doc_id,
    content,
    SNOWFLAKE.CORTEX.EMBED_TEXT_768('e5-base-v2', content) as embedding
FROM documents;

-- Vector similarity search
WITH query_embedding AS (
    SELECT SNOWFLAKE.CORTEX.EMBED_TEXT_768(
        'e5-base-v2',
        'How do I reset my password?'
    ) as embedding
)
SELECT
    d.doc_id,
    d.content,
    VECTOR_COSINE_SIMILARITY(d.embedding, q.embedding) as similarity
FROM document_embeddings d, query_embedding q
ORDER BY similarity DESC
LIMIT 10;

-- Classification
SELECT
    ticket_id,
    description,
    SNOWFLAKE.CORTEX.CLASSIFY_TEXT(
        description,
        ['billing', 'technical', 'general', 'complaint']
    ):label as category
FROM support_tickets;

-- Extract entities
SELECT
    email_id,
    SNOWFLAKE.CORTEX.EXTRACT_ANSWER(
        email_body,
        'What is the customer name?'
    ) as customer_name,
    SNOWFLAKE.CORTEX.EXTRACT_ANSWER(
        email_body,
        'What is the order number?'
    ) as order_number
FROM customer_emails;
```

```python
# Python integration with Snowflake Cortex
import snowflake.connector
from snowflake.snowpark import Session

class SnowflakeCortexAI:
    def __init__(self, connection_params: dict):
        self.session = Session.builder.configs(connection_params).create()

    def semantic_search(self, query: str, table: str, top_k: int = 10):
        """Perform semantic search using Cortex embeddings."""
        sql = f"""
        WITH query_emb AS (
            SELECT SNOWFLAKE.CORTEX.EMBED_TEXT_768('e5-base-v2', '{query}') as emb
        )
        SELECT
            content,
            VECTOR_COSINE_SIMILARITY(embedding, q.emb) as score
        FROM {table}, query_emb q
        ORDER BY score DESC
        LIMIT {top_k}
        """
        return self.session.sql(sql).collect()

    def batch_summarize(self, table: str, text_col: str, output_table: str):
        """Batch summarize text column."""
        sql = f"""
        CREATE OR REPLACE TABLE {output_table} AS
        SELECT
            *,
            SNOWFLAKE.CORTEX.SUMMARIZE({text_col}) as summary
        FROM {table}
        """
        self.session.sql(sql).collect()

    def rag_query(self, question: str, context_table: str) -> str:
        """RAG with Cortex."""
        # Get relevant context
        context = self.semantic_search(question, context_table, top_k=5)
        context_text = "\n".join([r["CONTENT"] for r in context])

        # Generate answer
        sql = f"""
        SELECT SNOWFLAKE.CORTEX.COMPLETE(
            'mistral-large',
            'Context: {context_text}\\n\\nQuestion: {question}\\n\\nAnswer:'
        ) as answer
        """
        result = self.session.sql(sql).collect()
        return result[0]["ANSWER"]
```

Snowflake Cortex makes AI accessible through familiar SQL without data movement.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
