---
title: "Databricks AI: Unified Data and AI Platform"
author: Michael John Peña
draft: false
date: 2025-04-27
tags:
  - Databricks
  - AI
  - Machine Learning
  - MLOps
  - Data Platform

---

I wrote "Databricks AI: Unified Data and AI Platform" to share practical, production-minded guidance on this topic.

## Databricks AI Patterns

```python
# Databricks AI integration patterns

from databricks import sql
from databricks.sdk import WorkspaceClient
from mlflow import MlflowClient
import mlflow

class DatabricksAI:
    def __init__(self):
        self.workspace = WorkspaceClient()
        self.mlflow_client = MlflowClient()

    def foundation_model_api(self, prompt: str, model: str = "databricks-meta-llama-3-70b-instruct"):
        """Use Databricks Foundation Model API."""
        from databricks_genai_inference import ChatSession

        chat = ChatSession(
            model=model,
            system_message="You are a helpful data analyst assistant."
        )

        response = chat.reply(prompt)
        return response

    def vector_search(self, query: str, index_name: str, num_results: int = 10):
        """Use Databricks Vector Search."""
        from databricks.vector_search.client import VectorSearchClient

        client = VectorSearchClient()
        index = client.get_index(index_name)

        results = index.similarity_search(
            query_text=query,
            num_results=num_results,
            columns=["id", "content", "metadata"]
        )

        return results

    def create_vector_index(self, table_name: str, embedding_col: str):
        """Create vector search index on Delta table."""
        from databricks.vector_search.client import VectorSearchClient

        client = VectorSearchClient()

        index = client.create_delta_sync_index(
            endpoint_name="vector-search-endpoint",
            index_name=f"{table_name}_index",
            source_table_name=table_name,
            primary_key="id",
            embedding_column=embedding_col,
            embedding_model_endpoint_name="databricks-bge-large-en"
        )

        return index

    def serve_model(self, model_name: str, model_version: str):
        """Serve model with Databricks Model Serving."""
        from mlflow.deployments import get_deploy_client

        client = get_deploy_client("databricks")

        endpoint = client.create_endpoint(
            name=f"{model_name}-endpoint",
            config={
                "served_models": [{
                    "model_name": model_name,
                    "model_version": model_version,
                    "workload_size": "Small",
                    "scale_to_zero_enabled": True
                }]
            }
        )

        return endpoint

    def feature_serving(self, feature_spec: dict):
        """Create feature serving endpoint."""
        from databricks.feature_engineering import FeatureEngineeringClient

        fe = FeatureEngineeringClient()

        endpoint = fe.create_feature_serving_endpoint(
            name="customer-features",
            config={
                "served_entities": [{
                    "entity_name": "customer",
                    "feature_spec_name": feature_spec["name"]
                }]
            }
        )

        return endpoint

    def rag_with_unity_catalog(self, question: str, table_name: str):
        """RAG using Unity Catalog managed tables."""
        # Get relevant documents from vector index
        docs = self.vector_search(question, f"{table_name}_index")

        # Generate response using Foundation Model
        context = "\n\n".join([d["content"] for d in docs])
        prompt = f"Context:\n{context}\n\nQuestion: {question}\n\nAnswer:"

        response = self.foundation_model_api(prompt)
        return response


# AutoML for quick model training
from databricks import automl

summary = automl.classify(
    dataset=train_df,
    target_col="label",
    timeout_minutes=30,
    max_trials=50
)

best_model = summary.best_trial.load_model()
```

Databricks unifies data, ML, and AI on a single lakehouse platform.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
