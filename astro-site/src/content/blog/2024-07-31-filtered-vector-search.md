---
title: "Filtered Vector Search in Azure AI Search: Best Practices"
description: "Pre-filtering: Filter before vector search Post-filtering: Filter after vector search Azure AI Search uses pre-filtering with automatic optimization."
author: Michael John Peña
draft: false
date: 2024-07-31
tags:
  - Azure
  - Vector Search
  - Filtering
  - Performance
  - RAG
---

## The Filtering Challenge

Vector search finds semantically similar content. But in real applications, you also need:
- **Access control**: Users only see authorized documents
- **Temporal relevance**: Recent documents may be preferred
- **Categorical filtering**: Specific document types or sources
- **Multi-tenancy**: Isolation between customers

## Pre-Filter vs Post-Filter

**Pre-filtering**: Filter before vector search
- More efficient for selective filters
- May miss relevant vectors outside filter

**Post-filtering**: Filter after vector search
- Better recall for broad filters
- May return fewer results than requested

Azure AI Search uses pre-filtering with automatic optimization.

## Basic Filtered Search

```python
from azure.search.documents import SearchClient
from azure.search.documents.models import VectorizedQuery

def filtered_vector_search(
    client: SearchClient,
    query_embedding: list[float],
    filters: dict,
    k: int = 10
) -> list[dict]:
    """Search with filters."""

    # Build OData filter expression
    filter_parts = []

    if filters.get("category"):
        filter_parts.append(f"category eq '{filters['category']}'")

    if filters.get("date_from"):
        filter_parts.append(f"date ge {filters['date_from']}")

    if filters.get("date_to"):
        filter_parts.append(f"date le {filters['date_to']}")

    if filters.get("departments"):
        dept_filters = " or ".join(f"department eq '{d}'" for d in filters['departments'])
        filter_parts.append(f"({dept_filters})")

    if filters.get("min_score"):
        filter_parts.append(f"quality_score ge {filters['min_score']}")

    filter_expr = " and ".join(filter_parts) if filter_parts else None

    # Execute search
    vector_query = VectorizedQuery(
        vector=query_embedding,
        k_nearest_neighbors=k * 3,  # Over-retrieve when filtering
        fields="embedding"
    )

    results = client.search(
        search_text=None,
        vector_queries=[vector_query],
        filter=filter_expr,
        top=k
    )

    return list(results)

# Usage
results = filtered_vector_search(
    client,
    query_embedding,
    filters={
        "category": "technical",
        "date_from": "2024-01-01T00:00:00Z",
        "departments": ["engineering", "product"]
    },
    k=10
)
```

## Access Control Patterns

### Simple ACL

```python
# Index schema
fields = [
    SearchField(name="id", type=SearchFieldDataType.String, key=True),
    SearchField(name="content", type=SearchFieldDataType.String),
    SearchField(name="embedding", ...),
    # Access control fields
    SearchField(name="owner", type=SearchFieldDataType.String, filterable=True),
    SearchField(name="allowed_users", type=SearchFieldDataType.Collection(SearchFieldDataType.String), filterable=True),
    SearchField(name="allowed_groups", type=SearchFieldDataType.Collection(SearchFieldDataType.String), filterable=True),
    SearchField(name="is_public", type=SearchFieldDataType.Boolean, filterable=True)
]

def search_with_access_control(
    client: SearchClient,
    query_embedding: list[float],
    user_id: str,
    user_groups: list[str],
    k: int = 10
) -> list[dict]:
    """Search respecting access controls."""

    # Build access filter
    access_conditions = [
        "is_public eq true",
        f"owner eq '{user_id}'",
        f"allowed_users/any(u: u eq '{user_id}')"
    ]

    # Add group conditions
    for group in user_groups:
        access_conditions.append(f"allowed_groups/any(g: g eq '{group}')")

    access_filter = " or ".join(f"({c})" for c in access_conditions)

    vector_query = VectorizedQuery(
        vector=query_embedding,
        k_nearest_neighbors=k * 5,  # Higher over-retrieval for ACL
        fields="embedding"
    )

    results = client.search(
        search_text=None,
        vector_queries=[vector_query],
        filter=access_filter,
        top=k
    )

    return list(results)
```

### Tenant Isolation

```python
def search_for_tenant(
    client: SearchClient,
    query_embedding: list[float],
    tenant_id: str,
    additional_filters: str = None,
    k: int = 10
) -> list[dict]:
    """Search within a tenant's documents."""

    # Tenant filter is always applied
    base_filter = f"tenant_id eq '{tenant_id}'"

    if additional_filters:
        filter_expr = f"({base_filter}) and ({additional_filters})"
    else:
        filter_expr = base_filter

    vector_query = VectorizedQuery(
        vector=query_embedding,
        k_nearest_neighbors=k * 3,
        fields="embedding"
    )

    results = client.search(
        search_text=None,
        vector_queries=[vector_query],
        filter=filter_expr,
        top=k
    )

    return list(results)
```

## Temporal Filtering

### Date Range with Recency Boost

```python
from datetime import datetime, timedelta

def search_with_recency(
    client: SearchClient,
    query_embedding: list[float],
    days_back: int = 30,
    recency_weight: float = 0.2,
    k: int = 10
) -> list[dict]:
    """Search with date filter and recency scoring."""

    cutoff_date = (datetime.utcnow() - timedelta(days=days_back)).isoformat() + "Z"
    filter_expr = f"date ge {cutoff_date}"

    vector_query = VectorizedQuery(
        vector=query_embedding,
        k_nearest_neighbors=k * 3,
        fields="embedding"
    )

    results = list(client.search(
        search_text=None,
        vector_queries=[vector_query],
        filter=filter_expr,
        select=["id", "content", "date"],
        top=k * 2  # Get extra for re-ranking
    ))

    # Re-rank with recency boost
    now = datetime.utcnow()
    for result in results:
        doc_date = datetime.fromisoformat(result["date"].replace("Z", ""))
        age_days = (now - doc_date).days
        recency_score = 1 / (1 + age_days / 30)  # Decay over 30 days

        original_score = result["@search.score"]
        result["combined_score"] = (
            original_score * (1 - recency_weight) +
            recency_score * recency_weight
        )

    # Sort by combined score
    results.sort(key=lambda x: x["combined_score"], reverse=True)

    return results[:k]
```

### Sliding Window

```python
def search_sliding_window(
    client: SearchClient,
    query_embedding: list[float],
    window_start: datetime,
    window_end: datetime,
    k: int = 10
) -> list[dict]:
    """Search within a specific time window."""

    filter_expr = f"date ge {window_start.isoformat()}Z and date le {window_end.isoformat()}Z"

    vector_query = VectorizedQuery(
        vector=query_embedding,
        k_nearest_neighbors=k * 3,
        fields="embedding"
    )

    results = client.search(
        search_text=None,
        vector_queries=[vector_query],
        filter=filter_expr,
        top=k
    )

    return list(results)
```

## Faceted Filtering

Build filters dynamically from facet values:

```python
def get_available_filters(
    client: SearchClient,
    tenant_id: str
) -> dict:
    """Get available filter values."""

    results = client.search(
        search_text="*",
        filter=f"tenant_id eq '{tenant_id}'",
        facets=["category", "department", "document_type"],
        top=0  # We only want facets
    )

    facets = {}
    for facet_name, facet_values in results.get_facets().items():
        facets[facet_name] = [
            {"value": fv["value"], "count": fv["count"]}
            for fv in facet_values
        ]

    return facets

def search_with_faceted_filter(
    client: SearchClient,
    query_embedding: list[float],
    selected_facets: dict,
    k: int = 10
) -> dict:
    """Search with user-selected facet filters."""

    filter_parts = []
    for facet_name, values in selected_facets.items():
        if values:
            conditions = " or ".join(f"{facet_name} eq '{v}'" for v in values)
            filter_parts.append(f"({conditions})")

    filter_expr = " and ".join(filter_parts) if filter_parts else None

    vector_query = VectorizedQuery(
        vector=query_embedding,
        k_nearest_neighbors=k * 3,
        fields="embedding"
    )

    results = client.search(
        search_text=None,
        vector_queries=[vector_query],
        filter=filter_expr,
        facets=["category", "department", "document_type"],  # Get updated facets
        top=k
    )

    return {
        "results": list(results),
        "facets": results.get_facets()
    }
```

## Performance Optimization

### Filter Selectivity

```python
def estimate_filter_selectivity(
    client: SearchClient,
    filter_expr: str
) -> float:
    """Estimate what fraction of documents match filter."""

    # Count filtered documents
    filtered = client.search(
        search_text="*",
        filter=filter_expr,
        top=0,
        include_total_count=True
    )
    filtered_count = filtered.get_count()

    # Count total documents
    total = client.search(
        search_text="*",
        top=0,
        include_total_count=True
    )
    total_count = total.get_count()

    return filtered_count / total_count if total_count > 0 else 0

def optimize_search_strategy(
    client: SearchClient,
    query_embedding: list[float],
    filter_expr: str,
    k: int = 10
) -> list[dict]:
    """Choose search strategy based on filter selectivity."""

    selectivity = estimate_filter_selectivity(client, filter_expr)

    if selectivity < 0.01:
        # Very selective: over-retrieve significantly
        oversample = 50
    elif selectivity < 0.1:
        # Moderately selective
        oversample = 10
    else:
        # Broad filter
        oversample = 3

    vector_query = VectorizedQuery(
        vector=query_embedding,
        k_nearest_neighbors=k * oversample,
        fields="embedding"
    )

    results = client.search(
        search_text=None,
        vector_queries=[vector_query],
        filter=filter_expr,
        top=k
    )

    return list(results)
```

### Caching Filter Results

```python
import hashlib
from functools import lru_cache

class CachedFilteredSearch:
    def __init__(self, client: SearchClient):
        self.client = client
        self.filter_cache = {}

    def search(
        self,
        query_embedding: list[float],
        filter_expr: str,
        k: int = 10,
        cache_ttl: int = 300
    ) -> list[dict]:
        """Search with cached filter metadata."""

        # Check if we have cached selectivity
        filter_hash = hashlib.md5(filter_expr.encode()).hexdigest()

        if filter_hash in self.filter_cache:
            cached = self.filter_cache[filter_hash]
            if time.time() - cached["timestamp"] < cache_ttl:
                selectivity = cached["selectivity"]
            else:
                selectivity = self._compute_selectivity(filter_expr)
                self.filter_cache[filter_hash] = {
                    "selectivity": selectivity,
                    "timestamp": time.time()
                }
        else:
            selectivity = self._compute_selectivity(filter_expr)
            self.filter_cache[filter_hash] = {
                "selectivity": selectivity,
                "timestamp": time.time()
            }

        # Adjust over-retrieval based on selectivity
        oversample = max(3, int(1 / max(selectivity, 0.01)))
        oversample = min(oversample, 100)  # Cap at 100x

        vector_query = VectorizedQuery(
            vector=query_embedding,
            k_nearest_neighbors=k * oversample,
            fields="embedding"
        )

        results = self.client.search(
            search_text=None,
            vector_queries=[vector_query],
            filter=filter_expr,
            top=k
        )

        return list(results)

    def _compute_selectivity(self, filter_expr: str) -> float:
        # Implementation from earlier
        pass
```

## Best Practices

1. **Index filterable fields**: Always set `filterable=True` for filter fields
2. **Use appropriate over-retrieval**: More for selective filters
3. **Cache filter metadata**: Avoid repeated selectivity calculations
4. **Combine with hybrid search**: Text + Vector + Filters for best results
5. **Test filter performance**: Some filters are more expensive than others
6. **Consider security filters first**: Access control should be non-negotiable

## Conclusion

Filtered vector search is where semantic similarity meets real-world requirements. Master the interplay between filters and vector search, optimize for your filter selectivity patterns, and always ensure security filters are applied.

The combination of powerful semantic search with precise filtering makes Azure AI Search suitable for enterprise applications with complex requirements.
