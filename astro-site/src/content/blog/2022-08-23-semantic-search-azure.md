---
title: "Semantic Search in Azure Cognitive Search"
author: "Michael John Peña"
draft: false
date: 2022-08-23
tags: ["Azure", "Cognitive Search", "Semantic Search", "AI", "NLP"]

---

I wrote "Semantic Search in Azure Cognitive Search" to share practical, production-minded guidance on this topic.

## Enabling Semantic Search

```python
from azure.search.documents.indexes import SearchIndexClient
from azure.search.documents.indexes.models import (
    SearchIndex,
    SemanticConfiguration,
    SemanticField,
    SemanticPrioritizedFields,
    SemanticSettings
)
from azure.core.credentials import AzureKeyCredential

endpoint = "https://mysearchservice.search.windows.net"
credential = AzureKeyCredential("your-admin-key")

index_client = SearchIndexClient(endpoint=endpoint, credential=credential)

# Define semantic configuration
semantic_config = SemanticConfiguration(
    name="my-semantic-config",
    prioritized_fields=SemanticPrioritizedFields(
        title_field=SemanticField(field_name="title"),
        content_fields=[
            SemanticField(field_name="content"),
            SemanticField(field_name="summary")
        ],
        keywords_fields=[
            SemanticField(field_name="category"),
            SemanticField(field_name="tags")
        ]
    )
)

# Add semantic settings to index
index = SearchIndex(
    name="articles-index",
    fields=fields,
    semantic_settings=SemanticSettings(
        configurations=[semantic_config],
        default_configuration="my-semantic-config"
    )
)

index_client.create_or_update_index(index)
```

## Semantic Queries

```python
from azure.search.documents import SearchClient
from azure.search.documents.models import QueryType, QueryLanguage

search_client = SearchClient(
    endpoint=endpoint,
    index_name="articles-index",
    credential=credential
)

# Semantic search with natural language query
results = search_client.search(
    search_text="How do I deploy machine learning models to production?",
    query_type=QueryType.SEMANTIC,
    semantic_configuration_name="my-semantic-config",
    query_language=QueryLanguage.EN_US,
    top=10
)

for result in results:
    print(f"\nTitle: {result['title']}")
    print(f"Score: {result['@search.score']:.4f}")
    print(f"Reranker Score: {result.get('@search.reranker_score', 'N/A')}")
```

## Semantic Captions and Answers

```python
from azure.search.documents.models import QueryCaptionType, QueryAnswerType

# Search with semantic captions and answers
results = search_client.search(
    search_text="What are the benefits of using Azure ML for model deployment?",
    query_type=QueryType.SEMANTIC,
    semantic_configuration_name="my-semantic-config",
    query_language=QueryLanguage.EN_US,
    query_caption=QueryCaptionType.EXTRACTIVE,
    query_answer=QueryAnswerType.EXTRACTIVE,
    top=5
)

# Get semantic answers (direct answers to the query)
answers = results.get_answers()
if answers:
    for answer in answers:
        print(f"\nSemantic Answer:")
        print(f"  Text: {answer.text}")
        print(f"  Highlights: {answer.highlights}")
        print(f"  Score: {answer.score:.4f}")

# Get results with captions
for result in results:
    print(f"\nTitle: {result['title']}")

    # Get captions (relevant excerpts)
    captions = result.get("@search.captions", [])
    for caption in captions:
        print(f"  Caption: {caption.text}")
        if caption.highlights:
            print(f"  Highlights: {caption.highlights}")
```

## Comparing Keyword vs Semantic Search

```python
def compare_search_modes(query):
    """Compare keyword and semantic search results"""

    # Keyword search
    keyword_results = search_client.search(
        search_text=query,
        query_type=QueryType.SIMPLE,
        top=5
    )

    # Semantic search
    semantic_results = search_client.search(
        search_text=query,
        query_type=QueryType.SEMANTIC,
        semantic_configuration_name="my-semantic-config",
        query_language=QueryLanguage.EN_US,
        top=5
    )

    print(f"Query: {query}")
    print("\n=== Keyword Search Results ===")
    for i, result in enumerate(keyword_results, 1):
        print(f"{i}. {result['title']} (Score: {result['@search.score']:.4f})")

    print("\n=== Semantic Search Results ===")
    for i, result in enumerate(semantic_results, 1):
        reranker_score = result.get('@search.reranker_score', 'N/A')
        print(f"{i}. {result['title']} (Reranker Score: {reranker_score})")

# Test with different queries
compare_search_modes("How to build ML pipelines")
compare_search_modes("best practices for data science projects")
compare_search_modes("deploy AI models")
```

## Semantic Search with Filters

```python
# Combine semantic search with filters
results = search_client.search(
    search_text="machine learning deployment strategies",
    query_type=QueryType.SEMANTIC,
    semantic_configuration_name="my-semantic-config",
    query_language=QueryLanguage.EN_US,
    filter="category eq 'Technology' and rating gt 4",
    order_by=["lastUpdated desc"],
    top=10,
    query_caption=QueryCaptionType.EXTRACTIVE
)

for result in results:
    print(f"{result['title']} - {result['category']}")
    captions = result.get("@search.captions", [])
    if captions:
        print(f"  {captions[0].text}")
```

## Multilingual Semantic Search

```python
# Index with multiple languages
multilingual_semantic_config = SemanticConfiguration(
    name="multilingual-config",
    prioritized_fields=SemanticPrioritizedFields(
        title_field=SemanticField(field_name="title"),
        content_fields=[
            SemanticField(field_name="content_en"),
            SemanticField(field_name="content_de"),
            SemanticField(field_name="content_fr")
        ]
    )
)

# Search in different languages
def search_multilingual(query, language):
    lang_map = {
        "en": QueryLanguage.EN_US,
        "de": QueryLanguage.DE_DE,
        "fr": QueryLanguage.FR_FR
    }

    results = search_client.search(
        search_text=query,
        query_type=QueryType.SEMANTIC,
        semantic_configuration_name="multilingual-config",
        query_language=lang_map.get(language, QueryLanguage.EN_US),
        top=5
    )

    return list(results)

# Search in English
en_results = search_multilingual("machine learning deployment", "en")

# Search in German
de_results = search_multilingual("maschinelles Lernen Bereitstellung", "de")

# Search in French
fr_results = search_multilingual("deploiement apprentissage automatique", "fr")
```

## Performance Considerations

```python
# Optimize semantic search performance
results = search_client.search(
    search_text="How to optimize ML models",
    query_type=QueryType.SEMANTIC,
    semantic_configuration_name="my-semantic-config",
    query_language=QueryLanguage.EN_US,

    # Pre-filter with keyword search to reduce semantic ranking scope
    search_fields=["title", "content"],

    # Limit fields to reduce payload
    select=["id", "title", "summary"],

    # Limit results before semantic ranking
    top=50,  # Initial retrieval

    # Skip if not needed
    query_caption=None,  # Disable if not needed
    query_answer=None    # Disable if not needed
)
```

Semantic search dramatically improves search relevance by understanding user intent rather than just matching keywords.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
