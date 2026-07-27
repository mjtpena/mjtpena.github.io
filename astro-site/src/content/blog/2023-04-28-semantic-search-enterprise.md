---
title: "Semantic Search for Enterprise: Beyond Keyword Matching"
author: Michael John Pena
draft: false
date: 2023-04-28
tags:
  - AI
  - Semantic Search
  - Embeddings
  - Enterprise
  - Azure

---

I wrote "Semantic Search for Enterprise: Beyond Keyword Matching" to share practical, production-minded guidance on this topic.

## Enterprise Semantic Search Architecture

```python
from dataclasses import dataclass
from typing import List, Dict, Optional
import numpy as np
from datetime import datetime

@dataclass
class SearchResult:
    document_id: str
    title: str
    content: str
    score: float
    metadata: Dict
    highlights: List[str]

class EnterpriseSemanticSearch:
    """Enterprise-grade semantic search system."""

    def __init__(self, config: dict):
        self.config = config
        self._init_services()

    def _init_services(self):
        """Initialize search services."""
        from azure.search.documents import SearchClient
        from azure.core.credentials import AzureKeyCredential

        self.search_client = SearchClient(
            endpoint=self.config["search_endpoint"],
            index_name=self.config["index_name"],
            credential=AzureKeyCredential(self.config["search_key"])
        )

        self.embedding_client = self.config["embedding_client"]
        self.llm_client = self.config["llm_client"]

    async def search(
        self,
        query: str,
        filters: Dict = None,
        top_k: int = 10,
        search_type: str = "hybrid"
    ) -> List[SearchResult]:
        """Execute semantic search."""

        if search_type == "semantic":
            results = await self._semantic_search(query, top_k, filters)
        elif search_type == "keyword":
            results = await self._keyword_search(query, top_k, filters)
        else:  # hybrid
            results = await self._hybrid_search(query, top_k, filters)

        return results

    async def _semantic_search(
        self,
        query: str,
        top_k: int,
        filters: Dict
    ) -> List[SearchResult]:
        """Pure semantic search using embeddings."""

        # Generate query embedding
        query_embedding = await self._get_embedding(query)

        # Search with vector
        results = self.search_client.search(
            search_text="",
            vector_queries=[{
                "vector": query_embedding,
                "k_nearest_neighbors": top_k,
                "fields": "content_vector"
            }],
            filter=self._build_filter(filters) if filters else None,
            select=["id", "title", "content", "metadata"]
        )

        return self._parse_results(results)

    async def _keyword_search(
        self,
        query: str,
        top_k: int,
        filters: Dict
    ) -> List[SearchResult]:
        """Traditional keyword search."""

        results = self.search_client.search(
            search_text=query,
            filter=self._build_filter(filters) if filters else None,
            select=["id", "title", "content", "metadata"],
            highlight_fields="content",
            top=top_k
        )

        return self._parse_results(results)

    async def _hybrid_search(
        self,
        query: str,
        top_k: int,
        filters: Dict
    ) -> List[SearchResult]:
        """Hybrid search combining semantic and keyword."""

        # Get embedding
        query_embedding = await self._get_embedding(query)

        # Hybrid query
        results = self.search_client.search(
            search_text=query,
            vector_queries=[{
                "vector": query_embedding,
                "k_nearest_neighbors": top_k * 2,
                "fields": "content_vector"
            }],
            filter=self._build_filter(filters) if filters else None,
            select=["id", "title", "content", "metadata"],
            highlight_fields="content",
            top=top_k
        )

        return self._parse_results(results)

    async def _get_embedding(self, text: str) -> List[float]:
        """Get embedding for text."""
        response = await self.embedding_client.create_embeddings(
            input=text,
            model="text-embedding-ada-002"
        )
        return response.data[0].embedding

    def _build_filter(self, filters: Dict) -> str:
        """Build OData filter string."""
        conditions = []
        for field, value in filters.items():
            if isinstance(value, list):
                # IN clause
                values_str = ", ".join([f"'{v}'" for v in value])
                conditions.append(f"{field} in ({values_str})")
            elif isinstance(value, dict):
                # Range
                if "gte" in value:
                    conditions.append(f"{field} ge {value['gte']}")
                if "lte" in value:
                    conditions.append(f"{field} le {value['lte']}")
            else:
                conditions.append(f"{field} eq '{value}'")

        return " and ".join(conditions)

    def _parse_results(self, results) -> List[SearchResult]:
        """Parse search results."""
        parsed = []
        for result in results:
            parsed.append(SearchResult(
                document_id=result["id"],
                title=result.get("title", ""),
                content=result.get("content", ""),
                score=result["@search.score"],
                metadata=result.get("metadata", {}),
                highlights=result.get("@search.highlights", {}).get("content", [])
            ))
        return parsed
```

## Query Understanding and Expansion

```python
class QueryUnderstanding:
    """Understand and enhance search queries."""

    def __init__(self, llm_client):
        self.client = llm_client

    async def expand_query(
        self,
        query: str,
        domain: str = None
    ) -> dict:
        """Expand query with synonyms and related terms."""

        prompt = f"""Expand this search query with related terms.

Query: {query}
{f'Domain: {domain}' if domain else ''}

Generate:
1. Synonyms for key terms
2. Related concepts
3. Alternative phrasings
4. Broader/narrower terms

Return as JSON:
{{
    "original": "...",
    "expanded_queries": ["...", "..."],
    "synonyms": {{"term": ["syn1", "syn2"]}},
    "related_concepts": ["..."]
}}"""

        response = await self.client.chat_completion(
            model="gpt-35-turbo",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3
        )

        return json.loads(response.content)

    async def extract_intent(self, query: str) -> dict:
        """Extract search intent from query."""

        prompt = f"""Analyze this search query to understand intent.

Query: {query}

Determine:
1. Primary intent (find_info/compare/how_to/troubleshoot/lookup)
2. Key entities mentioned
3. Temporal context (historical/current/future)
4. Specificity level (broad/specific)
5. Expected result type (document/answer/list)

Return as JSON."""

        response = await self.client.chat_completion(
            model="gpt-35-turbo",
            messages=[{"role": "user", "content": prompt}],
            temperature=0
        )

        return json.loads(response.content)

    async def rewrite_query(
        self,
        query: str,
        context: str = None
    ) -> str:
        """Rewrite query for better search results."""

        prompt = f"""Rewrite this search query for better results.

Original Query: {query}
{f'Context: {context}' if context else ''}

Rules:
- Make the query more specific
- Add relevant technical terms
- Remove ambiguity
- Keep it concise

Return only the rewritten query."""

        response = await self.client.chat_completion(
            model="gpt-35-turbo",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2
        )

        return response.content.strip()

    async def generate_sub_queries(
        self,
        complex_query: str
    ) -> List[str]:
        """Break complex query into sub-queries."""

        prompt = f"""Break this complex search query into simpler sub-queries.

Query: {complex_query}

Generate 2-5 simpler queries that together address the original query.
Each sub-query should be independently searchable.

Return as JSON array of strings."""

        response = await self.client.chat_completion(
            model="gpt-35-turbo",
            messages=[{"role": "user", "content": prompt}]
        )

        return json.loads(response.content)
```

## Result Reranking and Summarization

```python
class SearchResultProcessor:
    """Process and enhance search results."""

    def __init__(self, llm_client):
        self.client = llm_client

    async def rerank_results(
        self,
        query: str,
        results: List[SearchResult],
        top_k: int = 10
    ) -> List[SearchResult]:
        """Rerank results using LLM for relevance."""

        if len(results) <= top_k:
            return results

        # Prepare results for ranking
        results_text = "\n".join([
            f"[{i}] Title: {r.title}\nContent: {r.content[:500]}..."
            for i, r in enumerate(results)
        ])

        prompt = f"""Rank these search results by relevance to the query.

Query: {query}

Results:
{results_text}

Return the indices of the top {top_k} most relevant results in order of relevance.
Return as JSON array of indices: [0, 3, 1, ...]"""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}],
            temperature=0
        )

        try:
            ranking = json.loads(response.content)
            return [results[i] for i in ranking[:top_k] if i < len(results)]
        except:
            return results[:top_k]

    async def summarize_results(
        self,
        query: str,
        results: List[SearchResult]
    ) -> str:
        """Generate summary answer from search results."""

        context = "\n\n".join([
            f"Source: {r.title}\n{r.content}"
            for r in results[:5]
        ])

        prompt = f"""Based on these search results, provide a comprehensive answer.

Query: {query}

Search Results:
{context}

Provide:
1. Direct answer to the query
2. Key points from the sources
3. Note any conflicting information
4. Indicate confidence level

Format as clear, concise response."""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}]
        )

        return response.content

    async def generate_follow_up_questions(
        self,
        query: str,
        results: List[SearchResult]
    ) -> List[str]:
        """Generate follow-up questions based on results."""

        summary = "\n".join([r.title for r in results[:5]])

        prompt = f"""Based on this search, suggest follow-up questions.

Original Query: {query}
Top Results: {summary}

Generate 3-5 relevant follow-up questions the user might want to explore.
Return as JSON array."""

        response = await self.client.chat_completion(
            model="gpt-35-turbo",
            messages=[{"role": "user", "content": prompt}]
        )

        return json.loads(response.content)

    async def extract_answer_snippets(
        self,
        query: str,
        results: List[SearchResult]
    ) -> List[dict]:
        """Extract specific answer snippets from results."""

        snippets = []

        for result in results[:5]:
            prompt = f"""Extract the most relevant snippet that answers this query.

Query: {query}
Document: {result.content}

If the document contains a relevant answer, extract it.
If not, respond with "NO_ANSWER".

Return just the relevant snippet or "NO_ANSWER"."""

            response = await self.client.chat_completion(
                model="gpt-35-turbo",
                messages=[{"role": "user", "content": prompt}],
                temperature=0
            )

            if response.content.strip() != "NO_ANSWER":
                snippets.append({
                    "document_id": result.document_id,
                    "title": result.title,
                    "snippet": response.content.strip()
                })

        return snippets
```

## Document Indexing Pipeline

```python
class SemanticIndexingPipeline:
    """Index documents for semantic search."""

    def __init__(self, config: dict):
        self.config = config
        self.embedding_client = config["embedding_client"]
        self.search_client = config["search_client"]

    async def index_document(
        self,
        document_id: str,
        title: str,
        content: str,
        metadata: Dict
    ):
        """Index a single document."""

        # Chunk content
        chunks = self._chunk_content(content)

        # Generate embeddings
        embeddings = await self._generate_embeddings(chunks)

        # Prepare documents for indexing
        documents = []
        for i, (chunk, embedding) in enumerate(zip(chunks, embeddings)):
            doc = {
                "id": f"{document_id}_chunk_{i}",
                "parent_id": document_id,
                "title": title,
                "content": chunk,
                "content_vector": embedding,
                "chunk_index": i,
                "metadata": metadata,
                "indexed_at": datetime.utcnow().isoformat()
            }
            documents.append(doc)

        # Upload to index
        self.search_client.upload_documents(documents)

        return len(documents)

    def _chunk_content(
        self,
        content: str,
        chunk_size: int = 1000,
        overlap: int = 200
    ) -> List[str]:
        """Chunk content with overlap."""
        chunks = []
        start = 0

        while start < len(content):
            end = start + chunk_size

            # Find natural break point
            if end < len(content):
                # Try to break at paragraph
                break_point = content.rfind("\n\n", start, end)
                if break_point == -1:
                    # Try sentence break
                    break_point = content.rfind(". ", start, end)
                if break_point != -1:
                    end = break_point + 1

            chunks.append(content[start:end].strip())
            start = end - overlap

        return chunks

    async def _generate_embeddings(
        self,
        texts: List[str]
    ) -> List[List[float]]:
        """Generate embeddings for texts."""
        embeddings = []

        # Batch processing
        batch_size = 16
        for i in range(0, len(texts), batch_size):
            batch = texts[i:i + batch_size]
            response = await self.embedding_client.create_embeddings(
                input=batch,
                model="text-embedding-ada-002"
            )
            embeddings.extend([e.embedding for e in response.data])

        return embeddings

    async def reindex_collection(
        self,
        source_table: str,
        text_column: str,
        metadata_columns: List[str]
    ):
        """Reindex entire collection from source."""
        from pyspark.sql import SparkSession

        spark = SparkSession.builder.getOrCreate()
        df = spark.table(source_table)

        total_docs = df.count()
        indexed = 0

        for row in df.collect():
            await self.index_document(
                document_id=row["id"],
                title=row.get("title", ""),
                content=row[text_column],
                metadata={col: row[col] for col in metadata_columns}
            )
            indexed += 1

            if indexed % 100 == 0:
                print(f"Indexed {indexed}/{total_docs} documents")

        return indexed
```

## Conversational Search

```python
class ConversationalSearch:
    """Multi-turn conversational search."""

    def __init__(self, search_engine, llm_client):
        self.search = search_engine
        self.client = llm_client
        self.conversation_history = []

    async def chat_search(
        self,
        user_message: str
    ) -> dict:
        """Handle conversational search turn."""

        # Add to history
        self.conversation_history.append({
            "role": "user",
            "content": user_message
        })

        # Reformulate query considering history
        search_query = await self._reformulate_query(user_message)

        # Execute search
        results = await self.search.search(search_query, top_k=5)

        # Generate conversational response
        response = await self._generate_response(user_message, results)

        # Add response to history
        self.conversation_history.append({
            "role": "assistant",
            "content": response
        })

        return {
            "response": response,
            "search_query": search_query,
            "sources": [{"title": r.title, "id": r.document_id} for r in results]
        }

    async def _reformulate_query(self, user_message: str) -> str:
        """Reformulate query based on conversation history."""

        if len(self.conversation_history) <= 1:
            return user_message

        history_text = "\n".join([
            f"{m['role']}: {m['content']}"
            for m in self.conversation_history[-6:]  # Last 3 turns
        ])

        prompt = f"""Given this conversation, reformulate the latest user message into a standalone search query.

Conversation:
{history_text}

Create a search query that captures what the user is looking for, including context from previous messages.
Return only the search query."""

        response = await self.client.chat_completion(
            model="gpt-35-turbo",
            messages=[{"role": "user", "content": prompt}],
            temperature=0
        )

        return response.content.strip()

    async def _generate_response(
        self,
        user_message: str,
        results: List[SearchResult]
    ) -> str:
        """Generate conversational response."""

        context = "\n\n".join([
            f"[{r.title}]: {r.content[:500]}"
            for r in results
        ])

        history = self.conversation_history[-4:] if len(self.conversation_history) > 4 else self.conversation_history

        prompt = f"""You are a helpful search assistant. Answer based on the search results.

Previous conversation:
{json.dumps(history[:-1], indent=2)}

User's question: {user_message}

Search Results:
{context}

Provide a helpful, conversational response that:
1. Directly answers the question
2. References relevant sources
3. Suggests follow-up if appropriate"""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}]
        )

        return response.content
```

Enterprise semantic search transforms how organizations find and use knowledge. By understanding meaning rather than just matching keywords, these systems unlock insights hidden in document repositories.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
