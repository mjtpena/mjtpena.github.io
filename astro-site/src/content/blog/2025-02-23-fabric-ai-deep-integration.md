---
title: "Fabric AI Deep Integration: Advanced Patterns"
description: "Fabric + AI creates a powerful platform for intelligent analytics. Leverage Spark's scale with AI's intelligence."
author: Michael John Peña
draft: false
date: 2025-02-23
tags:
  - Microsoft Fabric
  - AI
  - Integration
  - Data Platform
  - Azure
---

## Advanced Fabric + AI Patterns

```python
# Fabric notebook with AI integration
from synapse.ml.cognitive import OpenAICompletion
from pyspark.sql import functions as F

# Scale AI across Spark
openai = OpenAICompletion() \
    .setSubscriptionKey(key) \
    .setDeploymentName("gpt-4o") \
    .setPromptCol("prompt") \
    .setOutputCol("ai_result")

# Process millions of rows
df = spark.read.table("lakehouse.documents")
df_with_prompts = df.withColumn("prompt",
    F.concat(F.lit("Summarize: "), F.col("content")))

df_enriched = openai.transform(df_with_prompts)
df_enriched.write.mode("overwrite").saveAsTable("lakehouse.documents_enriched")

# Vector search in Fabric
def semantic_search(query_embedding, top_k=10):
    return spark.sql(f"""
        SELECT id, content, embedding,
               vector_cosine_similarity(embedding, array({','.join(map(str, query_embedding))})) as similarity
        FROM lakehouse.embeddings
        ORDER BY similarity DESC
        LIMIT {top_k}
    """)
```

Fabric + AI creates a powerful platform for intelligent analytics. Leverage Spark's scale with AI's intelligence.
