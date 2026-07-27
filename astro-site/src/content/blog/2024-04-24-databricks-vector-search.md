---
title: "Databricks Vector Search Deep Dive: Production Patterns"
author: "Michael John Peña"
draft: false
date: 2024-04-24
tags: ["Databricks", "Vector Search", "Production", "ML", "Search"]

---

I wrote "Databricks Vector Search Deep Dive: Production Patterns" to share practical, production-minded guidance on this topic.

Taking Vector Search to production requires careful consideration of performance, reliability, and maintenance. This guide covers production-ready patterns.

## Production Architecture

```python
PRODUCTION_PATTERNS = {
    "index_design": {
        "chunking_strategy": "Optimize chunk size for your use case",
        "metadata_filtering": "Include filterable columns",
        "embedding_model": "Match model to content type"
    },
    "scaling": {
        "endpoint_sizing": "Right-size for query volume",
        "index_partitioning": "Partition large indexes",
        "caching": "Cache frequent queries"
    },
    "reliability": {
        "monitoring": "Track latency, throughput, errors",
        "fallbacks": "Handle index unavailability",
        "sync_management": "Monitor and manage syncs"
    }
}
```

## Document Chunking Strategies

```python
from typing import List, Dict
import tiktoken

class DocumentChunker:
    """Production-grade document chunking"""

    def __init__(
        self,
        chunk_size: int = 500,
        chunk_overlap: int = 50,
        model: str = "cl100k_base"
    ):
        self.chunk_size = chunk_size
        self.overlap = chunk_overlap
        self.tokenizer = tiktoken.get_encoding(model)

    def chunk_by_tokens(self, text: str) -> List[str]:
        """Chunk text by token count"""
        tokens = self.tokenizer.encode(text)
        chunks = []

        start = 0
        while start < len(tokens):
            end = start + self.chunk_size
            chunk_tokens = tokens[start:end]
            chunk_text = self.tokenizer.decode(chunk_tokens)
            chunks.append(chunk_text)
            start = end - self.overlap

        return chunks

    def chunk_by_paragraphs(
        self,
        text: str,
        max_tokens: int = 500
    ) -> List[str]:
        """Chunk by paragraphs, respecting max tokens"""
        paragraphs = text.split('\n\n')
        chunks = []
        current_chunk = []
        current_tokens = 0

        for para in paragraphs:
            para_tokens = len(self.tokenizer.encode(para))

            if current_tokens + para_tokens <= max_tokens:
                current_chunk.append(para)
                current_tokens += para_tokens
            else:
                if current_chunk:
                    chunks.append('\n\n'.join(current_chunk))
                current_chunk = [para]
                current_tokens = para_tokens

        if current_chunk:
            chunks.append('\n\n'.join(current_chunk))

        return chunks

    def chunk_with_metadata(
        self,
        doc_id: str,
        title: str,
        text: str,
        source: str
    ) -> List[Dict]:
        """Chunk and add metadata for each chunk"""
        chunks = self.chunk_by_paragraphs(text)

        return [
            {
                "chunk_id": f"{doc_id}_chunk_{i}",
                "doc_id": doc_id,
                "title": title,
                "content": chunk,
                "chunk_index": i,
                "total_chunks": len(chunks),
                "source": source
            }
            for i, chunk in enumerate(chunks)
        ]

# Usage with PySpark
def process_documents_for_vector_search(df):
    """Process documents for vector search indexing"""
    from pyspark.sql.functions import udf, explode
    from pyspark.sql.types import ArrayType, StructType, StructField, StringType, IntegerType

    chunker = DocumentChunker(chunk_size=500, chunk_overlap=50)

    chunk_schema = ArrayType(StructType([
        StructField("chunk_id", StringType()),
        StructField("doc_id", StringType()),
        StructField("title", StringType()),
        StructField("content", StringType()),
        StructField("chunk_index", IntegerType()),
        StructField("total_chunks", IntegerType()),
        StructField("source", StringType())
    ]))

    @udf(chunk_schema)
    def chunk_document(doc_id, title, content, source):
        return chunker.chunk_with_metadata(doc_id, title, content, source)

    return df.withColumn(
        "chunks",
        chunk_document("doc_id", "title", "content", "source")
    ).select(explode("chunks").alias("chunk")).select("chunk.*")
```

## Filtered Vector Search

```python
from databricks.vector_search.client import VectorSearchClient

class FilteredVectorSearch:
    """Vector search with metadata filtering"""

    def __init__(self, endpoint_name: str, index_name: str):
        self.vsc = VectorSearchClient()
        self.index = self.vsc.get_index(endpoint_name, index_name)

    def search_with_filters(
        self,
        query: str,
        filters: Dict = None,
        num_results: int = 10
    ) -> List[Dict]:
        """Search with metadata filters"""

        # Build filter expression
        filter_expr = self._build_filter_expression(filters) if filters else None

        results = self.index.similarity_search(
            query_text=query,
            columns=["chunk_id", "doc_id", "title", "content", "source"],
            num_results=num_results,
            filters=filter_expr
        )

        return self._parse_results(results)

    def _build_filter_expression(self, filters: Dict) -> Dict:
        """Build filter expression for Vector Search"""
        # Simple equality filters
        return filters

        # For complex filters, use the filter syntax:
        # {"column_name NOT": "value"}  # NOT equal
        # {"column_name <": value}      # Less than
        # {"column_name >": value}      # Greater than

    def _parse_results(self, results: Dict) -> List[Dict]:
        """Parse raw results into structured format"""
        parsed = []
        for row in results['result']['data_array']:
            parsed.append({
                "score": row[0],
                "chunk_id": row[1],
                "doc_id": row[2],
                "title": row[3],
                "content": row[4],
                "source": row[5]
            })
        return parsed

    def search_by_source(
        self,
        query: str,
        sources: List[str],
        num_results: int = 10
    ) -> List[Dict]:
        """Search within specific sources"""
        # Note: Vector Search supports IN filters
        all_results = []

        for source in sources:
            results = self.search_with_filters(
                query=query,
                filters={"source": source},
                num_results=num_results // len(sources)
            )
            all_results.extend(results)

        # Re-sort by score
        all_results.sort(key=lambda x: x['score'], reverse=True)
        return all_results[:num_results]
```

## Caching and Performance

```python
from functools import lru_cache
import hashlib
import time

class CachedVectorSearch:
    """Vector search with query caching"""

    def __init__(self, index, cache_ttl: int = 300):
        self.index = index
        self.cache = {}
        self.cache_ttl = cache_ttl

    def search(
        self,
        query: str,
        filters: Dict = None,
        num_results: int = 10,
        use_cache: bool = True
    ) -> List[Dict]:
        """Search with optional caching"""

        cache_key = self._make_cache_key(query, filters, num_results)

        # Check cache
        if use_cache and cache_key in self.cache:
            cached_result, timestamp = self.cache[cache_key]
            if time.time() - timestamp < self.cache_ttl:
                return cached_result

        # Execute search
        results = self.index.similarity_search(
            query_text=query,
            columns=["chunk_id", "title", "content"],
            num_results=num_results,
            filters=filters
        )

        parsed = self._parse_results(results)

        # Update cache
        self.cache[cache_key] = (parsed, time.time())

        # Clean old cache entries
        self._cleanup_cache()

        return parsed

    def _make_cache_key(
        self,
        query: str,
        filters: Dict,
        num_results: int
    ) -> str:
        """Create cache key"""
        key_data = f"{query}|{str(filters)}|{num_results}"
        return hashlib.md5(key_data.encode()).hexdigest()

    def _cleanup_cache(self):
        """Remove expired cache entries"""
        current_time = time.time()
        expired = [
            k for k, (_, ts) in self.cache.items()
            if current_time - ts > self.cache_ttl
        ]
        for k in expired:
            del self.cache[k]

    def _parse_results(self, results: Dict) -> List[Dict]:
        return [
            {"score": row[0], "chunk_id": row[1], "title": row[2], "content": row[3]}
            for row in results['result']['data_array']
        ]

    def invalidate_cache(self):
        """Clear all cached results"""
        self.cache.clear()
```

## Monitoring and Alerting

```python
from dataclasses import dataclass
from datetime import datetime
from typing import Optional
import time

@dataclass
class SearchMetrics:
    query: str
    latency_ms: float
    num_results: int
    timestamp: datetime
    success: bool
    error: Optional[str] = None

class MonitoredVectorSearch:
    """Vector search with monitoring"""

    def __init__(self, index):
        self.index = index
        self.metrics: List[SearchMetrics] = []
        self.alert_threshold_ms = 1000  # Alert if latency > 1s

    def search(self, query: str, **kwargs) -> Dict:
        """Search with monitoring"""

        start = time.time()

        try:
            results = self.index.similarity_search(
                query_text=query,
                **kwargs
            )
            latency = (time.time() - start) * 1000

            metric = SearchMetrics(
                query=query[:100],
                latency_ms=latency,
                num_results=len(results.get('result', {}).get('data_array', [])),
                timestamp=datetime.now(),
                success=True
            )

            if latency > self.alert_threshold_ms:
                self._alert_slow_query(metric)

        except Exception as e:
            latency = (time.time() - start) * 1000
            metric = SearchMetrics(
                query=query[:100],
                latency_ms=latency,
                num_results=0,
                timestamp=datetime.now(),
                success=False,
                error=str(e)
            )
            self._alert_error(metric)
            raise

        finally:
            self.metrics.append(metric)

        return results

    def get_metrics_summary(self, last_n: int = 100) -> Dict:
        """Get metrics summary"""
        recent = self.metrics[-last_n:]

        if not recent:
            return {}

        latencies = [m.latency_ms for m in recent if m.success]
        success_count = sum(1 for m in recent if m.success)

        return {
            "total_queries": len(recent),
            "success_rate": success_count / len(recent),
            "avg_latency_ms": sum(latencies) / len(latencies) if latencies else 0,
            "p95_latency_ms": sorted(latencies)[int(len(latencies) * 0.95)] if latencies else 0,
            "errors": [m.error for m in recent if not m.success]
        }

    def _alert_slow_query(self, metric: SearchMetrics):
        """Alert on slow query"""
        print(f"ALERT: Slow query ({metric.latency_ms:.0f}ms): {metric.query}")

    def _alert_error(self, metric: SearchMetrics):
        """Alert on error"""
        print(f"ERROR: Query failed: {metric.error}")
```

## Conclusion

Production vector search requires proper chunking strategies, filtering capabilities, caching, and monitoring. Build these patterns into your application from the start for reliable semantic search at scale.

