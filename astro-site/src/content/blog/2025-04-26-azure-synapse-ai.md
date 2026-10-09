---
title: "Azure Synapse Analytics AI: Machine Learning at Scale"
description: "Synapse enables AI at data warehouse scale with native ML integration."
author: Michael John Peña
draft: false
date: 2025-04-26
tags:
  - Azure
  - Synapse
  - AI
  - Machine Learning
  - Analytics
---

## Synapse AI Patterns

```python
# Azure Synapse AI integration patterns

from azure.synapse.spark import SparkClient
from azure.ai.ml import MLClient
from azure.identity import DefaultAzureCredential
import pyspark.sql.functions as F

class SynapseAI:
    def __init__(self, workspace_name: str, spark_pool: str):
        self.workspace = workspace_name
        self.spark_pool = spark_pool
        self.credential = DefaultAzureCredential()

    def cognitive_services_in_spark(self, df):
        """Use Cognitive Services directly in Spark."""
        from synapse.ml.cognitive import TextSentiment, Translate

        # Sentiment analysis at scale
        sentiment = TextSentiment() \
            .setSubscriptionKey(cognitive_key) \
            .setLocation("eastus") \
            .setTextCol("text") \
            .setOutputCol("sentiment")

        return sentiment.transform(df)

    def openai_in_spark(self, df, prompt_col: str):
        """Use Azure OpenAI in Spark pipelines."""
        from synapse.ml.cognitive import OpenAICompletion

        completion = OpenAICompletion() \
            .setSubscriptionKey(openai_key) \
            .setDeploymentName("gpt-4o") \
            .setPromptCol(prompt_col) \
            .setOutputCol("response") \
            .setMaxTokens(500)

        return completion.transform(df)

    def vector_embeddings_at_scale(self, df, text_col: str):
        """Generate embeddings at scale."""
        from synapse.ml.cognitive import OpenAIEmbedding

        embedding = OpenAIEmbedding() \
            .setSubscriptionKey(openai_key) \
            .setDeploymentName("text-embedding-3-large") \
            .setTextCol(text_col) \
            .setOutputCol("embedding")

        return embedding.transform(df)

    def train_ml_model(self, df, target_col: str, feature_cols: list):
        """Train ML model in Synapse."""
        from pyspark.ml.feature import VectorAssembler
        from pyspark.ml.classification import RandomForestClassifier
        from pyspark.ml import Pipeline

        assembler = VectorAssembler(
            inputCols=feature_cols,
            outputCol="features"
        )

        rf = RandomForestClassifier(
            labelCol=target_col,
            featuresCol="features",
            numTrees=100
        )

        pipeline = Pipeline(stages=[assembler, rf])
        model = pipeline.fit(df)

        return model

    def register_model(self, model, model_name: str):
        """Register model in Azure ML from Synapse."""
        ml_client = MLClient(
            credential=self.credential,
            subscription_id=subscription_id,
            resource_group_name=resource_group,
            workspace_name=ml_workspace
        )

        # Save model
        model_path = f"/mnt/models/{model_name}"
        model.save(model_path)

        # Register in Azure ML
        ml_client.models.create_or_update(
            Model(
                name=model_name,
                path=model_path,
                type="custom"
            )
        )

    def batch_inference(self, df, model_uri: str):
        """Run batch inference with registered model."""
        from pyspark.ml import PipelineModel

        model = PipelineModel.load(model_uri)
        predictions = model.transform(df)

        return predictions


# Example: Large-scale text processing
spark_ai = SynapseAI("my-workspace", "spark-pool")

# Read large dataset
df = spark.read.parquet("abfss://data@storage.dfs.core.windows.net/documents/")

# Add embeddings
df_with_embeddings = spark_ai.vector_embeddings_at_scale(df, "content")

# Run sentiment analysis
df_with_sentiment = spark_ai.cognitive_services_in_spark(df_with_embeddings)

# Save results
df_with_sentiment.write.parquet("abfss://data@storage.dfs.core.windows.net/enriched/")
```

Synapse enables AI at data warehouse scale with native ML integration.
