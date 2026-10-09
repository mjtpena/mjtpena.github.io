---
title: "Implementing Retrieval-Augmented Generation with Microsoft Fabric"
description: "Use Fabric notebooks to create interactive RAG applications that combine data exploration with AI-powered question answering over enterprise datasets."
author: Michael John Peña
draft: false
date: 2025-10-23
tags:
  - Microsoft Fabric
  - RAG
  - Data Engineering
  - AI Integration
  - Lakehouse
---

## Setting Up the Data Foundation

Create a lakehouse structure for RAG:

```python
from pyspark.sql import SparkSession
from pyspark.sql.functions import col, udf
from pyspark.sql.types import ArrayType, FloatType
import json

# Initialize Spark session in Fabric
spark = SparkSession.builder.getOrCreate()

class FabricRAGPipeline:
    def __init__(self, lakehouse_path: str, embedding_endpoint: str, embedding_key: str):
        self.lakehouse_path = lakehouse_path
        self.embedding_endpoint = embedding_endpoint
        self.embedding_key = embedding_key

    def prepare_documents(self, source_table: str) -> None:
        """Prepare documents for RAG by chunking and embedding."""

        # Read source documents
        df = spark.read.table(source_table)

        # Chunk documents
        chunked_df = self._chunk_documents(df)

        # Generate embeddings
        embedded_df = self._generate_embeddings(chunked_df)

        # Save to lakehouse
        embedded_df.write.mode("overwrite").saveAsTable("rag_documents")

    def _chunk_documents(self, df):
        """Split documents into chunks for embedding."""

        @udf(returnType=ArrayType(StringType()))
        def chunk_text(text, chunk_size=1000, overlap=200):
            if not text:
                return []

            chunks = []
            start = 0
            while start < len(text):
                end = start + chunk_size
                chunks.append(text[start:end])
                start = end - overlap

            return chunks

        return df.withColumn("chunks", chunk_text(col("content"))) \
                 .select("id", "title", "metadata", explode("chunks").alias("chunk"))

    def _generate_embeddings(self, df):
        """Generate embeddings for each chunk using Azure OpenAI."""

        import requests

        def get_embedding(text):
            response = requests.post(
                f"{self.embedding_endpoint}/embeddings",
                headers={"api-key": self.embedding_key},
                json={"input": text, "model": "text-embedding-3-small"}
            )
            return response.json()["data"][0]["embedding"]

        embedding_udf = udf(get_embedding, ArrayType(FloatType()))

        return df.withColumn("embedding", embedding_udf(col("chunk")))
```

## Building the Query Pipeline

Implement semantic search over Fabric data:

```python
from pyspark.ml.linalg import Vectors
from pyspark.sql.functions import udf
import numpy as np

class FabricSemanticSearch:
    def __init__(self, embedding_client):
        self.embedding_client = embedding_client

    def search(self, query: str, top_k: int = 5) -> list:
        """Search for relevant documents."""

        # Generate query embedding
        query_embedding = self.embedding_client.get_embedding(query)

        # Load document embeddings
        docs_df = spark.read.table("rag_documents")

        # Calculate cosine similarity
        @udf(returnType=FloatType())
        def cosine_similarity(embedding):
            if not embedding:
                return 0.0
            query_vec = np.array(query_embedding)
            doc_vec = np.array(embedding)
            return float(np.dot(query_vec, doc_vec) / (np.linalg.norm(query_vec) * np.linalg.norm(doc_vec)))

        results = docs_df.withColumn("similarity", cosine_similarity(col("embedding"))) \
                        .orderBy(col("similarity").desc()) \
                        .limit(top_k) \
                        .select("id", "title", "chunk", "similarity") \
                        .collect()

        return [row.asDict() for row in results]
```

## Integrating with Fabric Notebooks

Use Fabric notebooks to create interactive RAG applications that combine data exploration with AI-powered question answering over enterprise datasets.
