---
title: "Azure Cognitive Search Updates and New Features"
author: "Michael John Peña"
draft: false
date: 2022-08-22
tags: ["Azure", "Cognitive Search", "AI", "Search", "Updates"]

---

I wrote "Azure Cognitive Search Updates and New Features" to share practical, production-minded guidance on this topic.

## What's New in Cognitive Search

Recent updates include:
- Semantic search for natural language understanding
- Vector search preview for similarity matching
- Enhanced debug sessions for skillset development
- Improved knowledge store capabilities

## Creating a Search Service

```bash
# Create search service
az search service create \
    --name mysearchservice \
    --resource-group myResourceGroup \
    --location eastus \
    --sku standard \
    --partition-count 1 \
    --replica-count 1
```

## Basic Index Configuration

```python
from azure.search.documents.indexes import SearchIndexClient
from azure.search.documents.indexes.models import (
    SearchIndex,
    SimpleField,
    SearchableField,
    SearchFieldDataType,
    ComplexField,
    CorsOptions
)
from azure.core.credentials import AzureKeyCredential

# Connect to search service
endpoint = "https://mysearchservice.search.windows.net"
credential = AzureKeyCredential("your-admin-key")

index_client = SearchIndexClient(endpoint=endpoint, credential=credential)

# Define index schema
fields = [
    SimpleField(name="id", type=SearchFieldDataType.String, key=True),
    SearchableField(name="title", type=SearchFieldDataType.String,
                    analyzer_name="en.microsoft"),
    SearchableField(name="content", type=SearchFieldDataType.String,
                    analyzer_name="en.microsoft"),
    SearchableField(name="category", type=SearchFieldDataType.String,
                    filterable=True, facetable=True),
    SimpleField(name="price", type=SearchFieldDataType.Double,
                filterable=True, sortable=True, facetable=True),
    SimpleField(name="rating", type=SearchFieldDataType.Double,
                filterable=True, sortable=True),
    SimpleField(name="lastUpdated", type=SearchFieldDataType.DateTimeOffset,
                filterable=True, sortable=True),
    ComplexField(name="address", fields=[
        SearchableField(name="street", type=SearchFieldDataType.String),
        SearchableField(name="city", type=SearchFieldDataType.String,
                        filterable=True, facetable=True),
        SimpleField(name="zipCode", type=SearchFieldDataType.String, filterable=True)
    ])
]

# Create index
index = SearchIndex(
    name="products-index",
    fields=fields,
    cors_options=CorsOptions(allowed_origins=["*"])
)

result = index_client.create_or_update_index(index)
print(f"Index created: {result.name}")
```

## Indexing Documents

```python
from azure.search.documents import SearchClient
import json

search_client = SearchClient(
    endpoint=endpoint,
    index_name="products-index",
    credential=credential
)

# Prepare documents
documents = [
    {
        "id": "1",
        "title": "Azure Machine Learning Guide",
        "content": "Comprehensive guide to building ML solutions on Azure...",
        "category": "Technology",
        "price": 49.99,
        "rating": 4.5,
        "lastUpdated": "2022-08-22T00:00:00Z",
        "address": {
            "street": "123 Tech St",
            "city": "Seattle",
            "zipCode": "98101"
        }
    },
    {
        "id": "2",
        "title": "Data Science Fundamentals",
        "content": "Learn the basics of data science and analytics...",
        "category": "Technology",
        "price": 39.99,
        "rating": 4.8,
        "lastUpdated": "2022-08-21T00:00:00Z",
        "address": {
            "street": "456 Data Ave",
            "city": "San Francisco",
            "zipCode": "94102"
        }
    }
]

# Upload documents
result = search_client.upload_documents(documents=documents)
print(f"Uploaded {len(result)} documents")

# Merge or upload (upsert)
result = search_client.merge_or_upload_documents(documents=documents)
```

## Basic Search Queries

```python
# Simple search
results = search_client.search(search_text="machine learning")

for result in results:
    print(f"{result['title']} (Score: {result['@search.score']:.2f})")

# Search with options
from azure.search.documents.models import QueryType

results = search_client.search(
    search_text="azure data",
    query_type=QueryType.SIMPLE,
    select=["id", "title", "category", "price"],
    filter="price lt 50",
    order_by=["rating desc"],
    top=10,
    include_total_count=True
)

print(f"Total results: {results.get_count()}")
for result in results:
    print(f"{result['title']}: ${result['price']}")
```

## Faceted Search

```python
# Search with facets
results = search_client.search(
    search_text="*",
    facets=["category,count:10", "address/city,count:5", "price,values:0|25|50|100"]
)

# Access facets
for facet in results.get_facets()["category"]:
    print(f"{facet['value']}: {facet['count']}")

print("\nCities:")
for facet in results.get_facets()["address/city"]:
    print(f"{facet['value']}: {facet['count']}")
```

## Autocomplete and Suggestions

```python
from azure.search.documents.indexes.models import (
    SearchIndex,
    Suggester
)

# Add suggester to index
index = SearchIndex(
    name="products-index",
    fields=fields,
    suggesters=[
        Suggester(name="sg", source_fields=["title", "category"])
    ]
)

index_client.create_or_update_index(index)

# Get suggestions
suggestions = search_client.suggest(
    search_text="mach",
    suggester_name="sg",
    select=["title"],
    top=5
)

for suggestion in suggestions:
    print(suggestion["title"])

# Autocomplete
completions = search_client.autocomplete(
    search_text="mach",
    suggester_name="sg",
    mode="twoTerms"
)

for completion in completions:
    print(completion["text"])
```

## Scoring Profiles

```python
from azure.search.documents.indexes.models import (
    ScoringProfile,
    TextWeights,
    FreshnessScoringFunction,
    FreshnessScoringParameters,
    ScoringFunctionInterpolation
)

# Define scoring profile
scoring_profile = ScoringProfile(
    name="boostRecent",
    text_weights=TextWeights(weights={"title": 2.0, "content": 1.0}),
    functions=[
        FreshnessScoringFunction(
            field_name="lastUpdated",
            boost=5,
            parameters=FreshnessScoringParameters(boosting_duration="P7D"),
            interpolation=ScoringFunctionInterpolation.LINEAR
        )
    ]
)

# Add to index
index.scoring_profiles = [scoring_profile]
index.default_scoring_profile = "boostRecent"

index_client.create_or_update_index(index)

# Search with scoring profile
results = search_client.search(
    search_text="azure",
    scoring_profile="boostRecent"
)
```

Azure Cognitive Search provides enterprise-grade search capabilities with AI enrichment options.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
