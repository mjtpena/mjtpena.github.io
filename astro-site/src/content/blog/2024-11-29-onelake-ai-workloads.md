---
title: "OneLake AI Workloads: Running AI Directly on Your Data Lake"
author: Michael John Peña
draft: false
date: 2024-11-29
tags:
  - Azure
  - Microsoft Fabric
  - OneLake
  - AI
  - Vector Search

---

I wrote "OneLake AI Workloads: Running AI Directly on Your Data Lake" to share practical, production-minded guidance on this topic.

## OneLake AI Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    OneLake AI Workloads                      │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │  Documents  │  │  Structured │  │    Images   │         │
│  │    Files    │  │    Data     │  │   & Media   │         │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘         │
│         │                │                │                  │
│         └────────────────┼────────────────┘                  │
│                          ↓                                   │
│              ┌───────────────────────┐                      │
│              │   AI Workload Engine  │                      │
│              │  • Embedding          │                      │
│              │  • Vector Index       │                      │
│              │  • Semantic Search    │                      │
│              │  • AI Enrichment      │                      │
│              └───────────────────────┘                      │
│                          ↓                                   │
│              ┌───────────────────────┐                      │
│              │    Output to OneLake  │                      │
│              │  (Delta Tables, Files)│                      │
│              └───────────────────────┘                      │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Creating Embeddings at Scale

```python
# Create embeddings using Azure OpenAI and PySpark in Fabric notebooks
from pyspark.sql import SparkSession
from pyspark.sql import functions as F
from pyspark.sql.types import ArrayType, FloatType
from openai import AzureOpenAI
from azure.identity import DefaultAzureCredential
import os

spark = SparkSession.builder.getOrCreate()

# Initialize Azure OpenAI client
credential = DefaultAzureCredential()
token = credential.get_token("https://cognitiveservices.azure.com/.default").token

client = AzureOpenAI(
    azure_endpoint=os.environ["AZURE_OPENAI_ENDPOINT"],
    api_version="2024-02-01",
    azure_ad_token=token
)

# Create UDF for generating embeddings
def get_embedding(text):
    if not text or len(text.strip()) == 0:
        return None
    try:
        response = client.embeddings.create(
            model="text-embedding-3-large",
            input=text[:8000]  # Truncate to model limit
        )
        return response.data[0].embedding
    except Exception as e:
        print(f"Error: {e}")
        return None

embedding_udf = F.udf(get_embedding, ArrayType(FloatType()))

# Read documents from OneLake Files
documents_df = spark.read.text("Files/documents/**/*.txt")

# Chunk documents (simple approach - split by paragraphs)
chunked_df = documents_df \
    .withColumn("chunks", F.split(F.col("value"), "\n\n")) \
    .select(F.explode("chunks").alias("chunk_text")) \
    .filter(F.length("chunk_text") > 50)

# Generate embeddings (process in batches for large datasets)
embeddings_df = chunked_df \
    .withColumn("embedding", embedding_udf(F.col("chunk_text"))) \
    .withColumn("created_at", F.current_timestamp())

# Save to Delta table
embeddings_df.write \
    .format("delta") \
    .mode("overwrite") \
    .saveAsTable("document_embeddings")

print(f"Processed {embeddings_df.count()} chunks")
```

## Creating Vector Indexes

```python
# For vector search, integrate with Azure AI Search or use in-memory search
# Option 1: Azure AI Search for production vector indexing

from azure.identity import DefaultAzureCredential
from azure.search.documents import SearchClient
from azure.search.documents.indexes import SearchIndexClient
from azure.search.documents.indexes.models import (
    SearchIndex, SearchField, SearchFieldDataType,
    VectorSearch, HnswAlgorithmConfiguration, VectorSearchProfile
)

credential = DefaultAzureCredential()

# Create search index with vector field
index_client = SearchIndexClient(
    endpoint="https://<search-service>.search.windows.net",
    credential=credential
)

# Define index schema
fields = [
    SearchField(name="id", type=SearchFieldDataType.String, key=True),
    SearchField(name="chunk_text", type=SearchFieldDataType.String, searchable=True),
    SearchField(name="source_path", type=SearchFieldDataType.String, filterable=True),
    SearchField(
        name="embedding",
        type=SearchFieldDataType.Collection(SearchFieldDataType.Single),
        searchable=True,
        vector_search_dimensions=3072,
        vector_search_profile_name="vector-profile"
    )
]

vector_search = VectorSearch(
    algorithms=[HnswAlgorithmConfiguration(name="hnsw-config", parameters={"m": 16, "efConstruction": 200})],
    profiles=[VectorSearchProfile(name="vector-profile", algorithm_configuration_name="hnsw-config")]
)

index = SearchIndex(name="document-search-index", fields=fields, vector_search=vector_search)
index_client.create_or_update_index(index)

# Upload embeddings from Fabric to Azure AI Search
search_client = SearchClient(
    endpoint="https://<search-service>.search.windows.net",
    index_name="document-search-index",
    credential=credential
)

# Read embeddings from Delta table and upload
embeddings_df = spark.read.table("document_embeddings")
documents = [row.asDict() for row in embeddings_df.collect()]
search_client.upload_documents(documents)
```

## Semantic Search

```python
# Semantic search using Azure AI Search
from azure.identity import DefaultAzureCredential
from azure.search.documents import SearchClient
from azure.search.documents.models import VectorizedQuery
from openai import AzureOpenAI

credential = DefaultAzureCredential()

# Initialize clients
search_client = SearchClient(
    endpoint="https://<search-service>.search.windows.net",
    index_name="document-search-index",
    credential=credential
)

openai_client = AzureOpenAI(
    azure_endpoint="https://<openai>.openai.azure.com",
    api_version="2024-02-01",
    azure_ad_token=credential.get_token("https://cognitiveservices.azure.com/.default").token
)

def semantic_search(query_text: str, top_k: int = 10, min_score: float = 0.7):
    # Generate query embedding
    response = openai_client.embeddings.create(
        model="text-embedding-3-large",
        input=query_text
    )
    query_vector = response.data[0].embedding

    # Perform vector search
    vector_query = VectorizedQuery(
        vector=query_vector,
        k_nearest_neighbors=top_k,
        fields="embedding"
    )

    results = search_client.search(
        search_text=None,
        vector_queries=[vector_query],
        select=["chunk_text", "source_path"]
    )

    for result in results:
        score = result.get("@search.score", 0)
        if score >= min_score:
            print(f"Score: {score:.3f}")
            print(f"Text: {result['chunk_text'][:200]}...")
            print()

# Hybrid search (vector + keyword)
def hybrid_search(query_text: str, keyword_query: str, top_k: int = 10):
    response = openai_client.embeddings.create(model="text-embedding-3-large", input=query_text)
    vector_query = VectorizedQuery(vector=response.data[0].embedding, k_nearest_neighbors=top_k, fields="embedding")

    results = search_client.search(
        search_text=keyword_query,  # Full-text search
        vector_queries=[vector_query],  # Vector search
        select=["chunk_text", "source_path"]
    )
    return list(results)
```

## AI Enrichment Workloads

```python
# AI enrichment using Azure OpenAI and PySpark
from pyspark.sql import SparkSession
from pyspark.sql import functions as F
from pyspark.sql.types import StringType, ArrayType, FloatType
from openai import AzureOpenAI
from azure.identity import DefaultAzureCredential
import json

spark = SparkSession.builder.getOrCreate()

credential = DefaultAzureCredential()
openai_client = AzureOpenAI(
    azure_endpoint="https://<openai>.openai.azure.com",
    api_version="2024-02-01",
    azure_ad_token=credential.get_token("https://cognitiveservices.azure.com/.default").token
)

# Classification UDF
def classify_product(product_name, description):
    prompt = f"""Classify this product into one category: Electronics, Clothing, Home, Sports, Other
Product: {product_name} - {description}
Return only the category name."""
    try:
        response = openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=20
        )
        return response.choices[0].message.content.strip()
    except:
        return "Other"

classify_udf = F.udf(classify_product, StringType())

# Feature extraction UDF
def extract_features(description):
    prompt = f"Extract key features from this product description as a JSON array: {description}"
    try:
        response = openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=200
        )
        return response.choices[0].message.content
    except:
        return "[]"

features_udf = F.udf(extract_features, StringType())

# Read source data
products_df = spark.read.table("bronze.raw_products")

# Apply AI enrichments
enriched_df = products_df \
    .withColumn("ai_category", classify_udf(F.col("product_name"), F.col("description"))) \
    .withColumn("extracted_features", features_udf(F.col("description")))

# Write to silver layer
enriched_df.write \
    .format("delta") \
    .mode("overwrite") \
    .option("mergeSchema", "true") \
    .saveAsTable("silver.enriched_products")
```

## Building RAG on OneLake

```python
# Build RAG pipeline using Azure OpenAI and Azure AI Search
from azure.identity import DefaultAzureCredential
from azure.search.documents import SearchClient
from azure.search.documents.models import VectorizedQuery
from openai import AzureOpenAI

credential = DefaultAzureCredential()

# Initialize clients
search_client = SearchClient(
    endpoint="https://<search-service>.search.windows.net",
    index_name="document-search-index",
    credential=credential
)

openai_client = AzureOpenAI(
    azure_endpoint="https://<openai>.openai.azure.com",
    api_version="2024-02-01",
    azure_ad_token=credential.get_token("https://cognitiveservices.azure.com/.default").token
)

def rag_query(question: str, top_k: int = 5):
    # Step 1: Generate query embedding
    embedding_response = openai_client.embeddings.create(
        model="text-embedding-3-large",
        input=question
    )
    query_vector = embedding_response.data[0].embedding

    # Step 2: Retrieve relevant documents
    vector_query = VectorizedQuery(vector=query_vector, k_nearest_neighbors=top_k, fields="embedding")
    search_results = search_client.search(search_text=None, vector_queries=[vector_query], select=["chunk_text", "source_path"])

    # Build context from retrieved documents
    context_parts = []
    sources = []
    for i, result in enumerate(search_results):
        context_parts.append(f"[{i+1}] {result['chunk_text']}")
        sources.append({"source": result["source_path"], "score": result.get("@search.score", 0)})

    context = "\n\n".join(context_parts)

    # Step 3: Generate answer with context
    system_prompt = """You are a helpful assistant that answers questions based on the provided context.
Always cite your sources using [1], [2], etc. If the context doesn't contain the answer, say so."""

    response = openai_client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"Context:\n{context}\n\nQuestion: {question}"}
        ],
        max_tokens=1000,
        temperature=0.7
    )

    return {
        "answer": response.choices[0].message.content,
        "sources": sources,
        "tokens_used": response.usage.total_tokens
    }

# Example usage
result = rag_query("What are the best practices for Fabric lakehouse design?")
print(f"Answer: {result['answer']}\n\nSources: {result['sources']}")
```

## Incremental Processing

```python
# Incremental embedding updates using Delta Lake change data feed
from pyspark.sql import SparkSession
from pyspark.sql import functions as F
from delta.tables import DeltaTable

spark = SparkSession.builder.getOrCreate()

# Enable change data feed on source table
spark.sql("""
    ALTER TABLE documents
    SET TBLPROPERTIES (delta.enableChangeDataFeed = true)
""")

# Read changes since last processing
last_version = spark.read.table("embedding_processing_state").collect()[0]["last_version"]

changes_df = spark.read.format("delta") \
    .option("readChangeFeed", "true") \
    .option("startingVersion", last_version) \
    .table("documents") \
    .filter(F.col("_change_type").isin(["insert", "update_postimage"]))

# Process only changed documents
if changes_df.count() > 0:
    # Generate embeddings for changed docs (using UDF from earlier)
    new_embeddings = changes_df \
        .withColumn("embedding", embedding_udf(F.col("content"))) \
        .select("document_id", "chunk_id", "content", "embedding", F.current_timestamp().alias("processed_at"))

    # Upsert to embeddings table
    embeddings_table = DeltaTable.forName(spark, "document_embeddings")
    embeddings_table.alias("target").merge(
        new_embeddings.alias("source"),
        "target.document_id = source.document_id AND target.chunk_id = source.chunk_id"
    ).whenMatchedUpdateAll().whenNotMatchedInsertAll().execute()

    # Update processing state
    current_version = spark.sql("DESCRIBE HISTORY documents LIMIT 1").collect()[0]["version"]
    spark.sql(f"UPDATE embedding_processing_state SET last_version = {current_version}")

# Schedule this notebook to run every 6 hours using Fabric Data Pipelines
```

## Monitoring AI Workloads

```python
# Monitor AI workloads using Fabric monitoring and Azure Monitor
from pyspark.sql import SparkSession
from azure.identity import DefaultAzureCredential
import requests

spark = SparkSession.builder.getOrCreate()

# Monitor embedding job status via Delta table metadata
embeddings_history = spark.sql("DESCRIBE HISTORY document_embeddings LIMIT 10")
embeddings_history.show()

# Get table statistics
stats = spark.sql("""
    SELECT
        COUNT(*) as total_embeddings,
        COUNT(DISTINCT document_id) as unique_documents,
        MAX(processed_at) as last_processed,
        AVG(SIZE(embedding)) as avg_embedding_size
    FROM document_embeddings
""").collect()[0]

print(f"Total embeddings: {stats['total_embeddings']:,}")
print(f"Unique documents: {stats['unique_documents']:,}")
print(f"Last processed: {stats['last_processed']}")

# Monitor costs via Azure OpenAI usage API
credential = DefaultAzureCredential()
token = credential.get_token("https://management.azure.com/.default").token

# Get Azure OpenAI resource usage (requires appropriate permissions)
subscription_id = "your-subscription-id"
resource_group = "your-rg"
openai_resource = "your-openai"

usage_url = f"https://management.azure.com/subscriptions/{subscription_id}/resourceGroups/{resource_group}/providers/Microsoft.CognitiveServices/accounts/{openai_resource}/usages?api-version=2023-05-01"
response = requests.get(usage_url, headers={"Authorization": f"Bearer {token}"})
usage = response.json()

for metric in usage.get("value", []):
    print(f"{metric['name']['value']}: {metric['currentValue']} / {metric['limit']}")

# Set up alerts using Azure Monitor or Fabric monitoring
# Configure in Azure Portal > Monitor > Alerts
```

OneLake AI Workloads bring AI capabilities directly to your data, eliminating data movement and enabling efficient large-scale AI processing.

## Resources

- [OneLake AI Workloads](https://learn.microsoft.com/en-us/fabric/onelake/ai-workloads)
- [Vector Search in Fabric](https://learn.microsoft.com/en-us/fabric/ai/vector-search)
- [Building RAG Applications](https://learn.microsoft.com/en-us/fabric/ai/rag-patterns)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
