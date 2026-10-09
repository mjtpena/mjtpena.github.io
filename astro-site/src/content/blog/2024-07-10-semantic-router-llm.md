---
title: "Semantic Router: Intent-Based LLM Routing"
description: "Semantic routing compares the meaning of a user's query against a set of example utterances. When the query is semantically similar to examples for a…"
author: Michael John Peña
draft: false
date: 2024-07-10
tags:
  - AI
  - LLM
  - NLP
  - Semantic
  - Azure
---

## What is Semantic Routing?

Semantic routing compares the meaning of a user's query against a set of example utterances. When the query is semantically similar to examples for a particular route, we trigger that route.

```python
from dataclasses import dataclass
import numpy as np
from typing import Optional

@dataclass
class Route:
    name: str
    utterances: list[str]
    model: str
    system_prompt: str
    threshold: float = 0.75

class SemanticRouter:
    def __init__(self, embedding_model: str = "text-embedding-3-small"):
        self.embedding_model = embedding_model
        self.routes: list[Route] = []
        self.route_embeddings: dict[str, np.ndarray] = {}

    def add_route(self, route: Route):
        """Add a route with its example utterances."""
        self.routes.append(route)

        # Compute embeddings for all utterances
        embeddings = [
            self._get_embedding(utterance)
            for utterance in route.utterances
        ]

        # Store average embedding as route centroid
        self.route_embeddings[route.name] = np.mean(embeddings, axis=0)

    def route(self, query: str) -> Optional[tuple[Route, float]]:
        """Route query to most similar route."""
        query_embedding = self._get_embedding(query)

        best_route = None
        best_similarity = 0.0

        for route in self.routes:
            route_embedding = self.route_embeddings[route.name]
            similarity = self._cosine_similarity(query_embedding, route_embedding)

            if similarity > best_similarity and similarity >= route.threshold:
                best_similarity = similarity
                best_route = route

        if best_route:
            return best_route, best_similarity
        return None

    def _get_embedding(self, text: str) -> np.ndarray:
        """Get embedding for text using Azure OpenAI."""
        from openai import AzureOpenAI

        client = AzureOpenAI()
        response = client.embeddings.create(
            model=self.embedding_model,
            input=text
        )
        return np.array(response.data[0].embedding)

    def _cosine_similarity(self, a: np.ndarray, b: np.ndarray) -> float:
        return np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))

# Define routes
code_route = Route(
    name="code_assistance",
    utterances=[
        "Help me write a function",
        "Debug this code",
        "Review my implementation",
        "How do I implement this algorithm",
        "Fix this error in my code",
        "Optimize this function",
    ],
    model="claude-3.5-sonnet",
    system_prompt="You are a senior software engineer. Provide clean, efficient code with explanations."
)

data_route = Route(
    name="data_analysis",
    utterances=[
        "Analyze this dataset",
        "Create a visualization",
        "What insights can you find",
        "Run some statistics on this data",
        "Build a dashboard query",
        "Write SQL for this report",
    ],
    model="gpt-4o",
    system_prompt="You are a data analyst. Focus on actionable insights and clear visualizations."
)

general_route = Route(
    name="general_chat",
    utterances=[
        "Hello",
        "How are you",
        "Tell me about yourself",
        "What can you do",
        "Thanks for your help",
    ],
    model="gpt-4o-mini",
    system_prompt="You are a helpful assistant. Be concise and friendly.",
    threshold=0.6  # Lower threshold for general chat
)

# Usage
router = SemanticRouter()
router.add_route(code_route)
router.add_route(data_route)
router.add_route(general_route)

# Route queries
queries = [
    "I need help fixing a bug in my Python script",
    "Can you create a chart showing sales trends",
    "Hey there!",
]

for query in queries:
    result = router.route(query)
    if result:
        route, similarity = result
        print(f"'{query}' -> {route.name} ({similarity:.2f})")
    else:
        print(f"'{query}' -> No matching route")
```

## Advanced Semantic Router

Add support for multi-route matching and dynamic thresholds:

```python
from typing import Callable
import json

@dataclass
class AdvancedRoute:
    name: str
    utterances: list[str]
    model: str
    system_prompt: str
    threshold: float = 0.75
    preprocessor: Callable[[str], str] = None
    postprocessor: Callable[[str], any] = None
    metadata: dict = None

class AdvancedSemanticRouter:
    def __init__(self):
        self.routes: list[AdvancedRoute] = []
        self.route_embeddings: dict[str, list[np.ndarray]] = {}
        self.embedding_cache: dict[str, np.ndarray] = {}

    def add_route(self, route: AdvancedRoute):
        """Add route and compute embeddings."""
        self.routes.append(route)

        # Store all embeddings (not just centroid) for better matching
        embeddings = []
        for utterance in route.utterances:
            if utterance in self.embedding_cache:
                emb = self.embedding_cache[utterance]
            else:
                emb = self._get_embedding(utterance)
                self.embedding_cache[utterance] = emb
            embeddings.append(emb)

        self.route_embeddings[route.name] = embeddings

    def route(
        self,
        query: str,
        return_scores: bool = False
    ) -> tuple[AdvancedRoute, float] | dict:
        """Route using max similarity to any utterance."""
        query_embedding = self._get_embedding(query)

        scores = {}

        for route in self.routes:
            # Find max similarity to any utterance
            similarities = [
                self._cosine_similarity(query_embedding, emb)
                for emb in self.route_embeddings[route.name]
            ]
            max_similarity = max(similarities)

            if max_similarity >= route.threshold:
                scores[route.name] = {
                    "route": route,
                    "similarity": max_similarity,
                    "all_similarities": similarities
                }

        if return_scores:
            return scores

        if not scores:
            return None

        # Return best match
        best = max(scores.values(), key=lambda x: x["similarity"])
        return best["route"], best["similarity"]

    def route_multi(
        self,
        query: str,
        top_k: int = 3
    ) -> list[tuple[AdvancedRoute, float]]:
        """Return top-k matching routes."""
        query_embedding = self._get_embedding(query)

        all_scores = []

        for route in self.routes:
            similarities = [
                self._cosine_similarity(query_embedding, emb)
                for emb in self.route_embeddings[route.name]
            ]
            max_similarity = max(similarities)
            all_scores.append((route, max_similarity))

        # Sort by similarity and return top-k
        all_scores.sort(key=lambda x: x[1], reverse=True)
        return all_scores[:top_k]

    def _get_embedding(self, text: str) -> np.ndarray:
        if text in self.embedding_cache:
            return self.embedding_cache[text]

        from openai import AzureOpenAI
        client = AzureOpenAI()
        response = client.embeddings.create(
            model="text-embedding-3-small",
            input=text
        )
        embedding = np.array(response.data[0].embedding)
        self.embedding_cache[text] = embedding
        return embedding

    def _cosine_similarity(self, a: np.ndarray, b: np.ndarray) -> float:
        return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b)))

    def save_embeddings(self, path: str):
        """Save computed embeddings to file."""
        data = {
            route_name: [emb.tolist() for emb in embeddings]
            for route_name, embeddings in self.route_embeddings.items()
        }
        with open(path, 'w') as f:
            json.dump(data, f)

    def load_embeddings(self, path: str):
        """Load pre-computed embeddings."""
        with open(path, 'r') as f:
            data = json.load(f)

        for route_name, embeddings in data.items():
            self.route_embeddings[route_name] = [
                np.array(emb) for emb in embeddings
            ]
```

## Hybrid Router

Combine semantic routing with other routing strategies:

```python
class HybridSemanticRouter:
    def __init__(self):
        self.semantic_router = AdvancedSemanticRouter()
        self.keyword_overrides: dict[str, AdvancedRoute] = {}
        self.fallback_route: AdvancedRoute = None

    def add_keyword_override(self, keyword: str, route: AdvancedRoute):
        """Add keyword that bypasses semantic matching."""
        self.keyword_overrides[keyword.lower()] = route

    def set_fallback(self, route: AdvancedRoute):
        """Set default route when nothing matches."""
        self.fallback_route = route

    def route(
        self,
        query: str,
        context: dict = None
    ) -> tuple[AdvancedRoute, str, float]:
        """
        Route using hybrid approach.
        Returns (route, routing_method, confidence)
        """
        query_lower = query.lower()

        # 1. Check keyword overrides first
        for keyword, route in self.keyword_overrides.items():
            if keyword in query_lower:
                return route, "keyword", 1.0

        # 2. Try semantic routing
        result = self.semantic_router.route(query)
        if result:
            route, similarity = result
            return route, "semantic", similarity

        # 3. Context-based routing
        if context:
            context_route = self._route_by_context(context)
            if context_route:
                return context_route, "context", 0.7

        # 4. Fallback
        if self.fallback_route:
            return self.fallback_route, "fallback", 0.5

        raise ValueError("No route found and no fallback configured")

    def _route_by_context(self, context: dict) -> AdvancedRoute:
        """Route based on conversation context."""
        # If previous messages were about code, continue with code route
        if context.get("last_route") == "code_assistance":
            for route in self.semantic_router.routes:
                if route.name == "code_assistance":
                    return route

        return None

# Usage
hybrid = HybridSemanticRouter()

# Add routes
hybrid.semantic_router.add_route(code_route)
hybrid.semantic_router.add_route(data_route)
hybrid.semantic_router.add_route(general_route)

# Add keyword overrides for urgent routing
urgent_route = AdvancedRoute(
    name="urgent_support",
    utterances=["This is urgent", "Emergency", "Critical issue"],
    model="gpt-4o",
    system_prompt="You are handling an urgent support request. Be swift and thorough."
)
hybrid.add_keyword_override("urgent", urgent_route)
hybrid.add_keyword_override("emergency", urgent_route)

# Set fallback
hybrid.set_fallback(general_route)

# Route queries
route, method, confidence = hybrid.route("URGENT: my production database is down")
print(f"Routed via {method} to {route.name} (confidence: {confidence})")
```

## Route Training and Optimization

Improve routes based on feedback:

```python
from datetime import datetime
from collections import defaultdict

class TrainableSemanticRouter:
    def __init__(self):
        self.router = AdvancedSemanticRouter()
        self.feedback_log: list[dict] = []
        self.route_performance: dict[str, dict] = defaultdict(
            lambda: {"correct": 0, "incorrect": 0, "missed": 0}
        )

    def route_and_log(
        self,
        query: str,
        session_id: str
    ) -> tuple[AdvancedRoute, float]:
        """Route and prepare for feedback."""
        result = self.router.route(query)

        log_entry = {
            "session_id": session_id,
            "query": query,
            "timestamp": datetime.utcnow().isoformat(),
            "routed_to": result[0].name if result else None,
            "confidence": result[1] if result else 0,
            "feedback": None
        }
        self.feedback_log.append(log_entry)

        return result

    def record_feedback(
        self,
        session_id: str,
        was_correct: bool,
        correct_route: str = None
    ):
        """Record user feedback on routing decision."""
        # Find the log entry
        for entry in reversed(self.feedback_log):
            if entry["session_id"] == session_id and entry["feedback"] is None:
                entry["feedback"] = {
                    "correct": was_correct,
                    "intended_route": correct_route
                }

                # Update performance metrics
                routed = entry["routed_to"]
                if was_correct:
                    self.route_performance[routed]["correct"] += 1
                else:
                    self.route_performance[routed]["incorrect"] += 1
                    if correct_route:
                        self.route_performance[correct_route]["missed"] += 1

                break

    def get_optimization_suggestions(self) -> list[str]:
        """Analyze feedback and suggest improvements."""
        suggestions = []

        for route_name, stats in self.route_performance.items():
            total = stats["correct"] + stats["incorrect"]
            if total < 10:
                continue

            accuracy = stats["correct"] / total

            if accuracy < 0.8:
                suggestions.append(
                    f"Route '{route_name}' has {accuracy:.0%} accuracy. "
                    f"Consider adding more example utterances."
                )

            if stats["missed"] > 5:
                suggestions.append(
                    f"Route '{route_name}' was intended {stats['missed']} times "
                    f"but not matched. Review threshold or add examples."
                )

        return suggestions

    def auto_adjust_thresholds(self):
        """Automatically adjust route thresholds based on feedback."""
        for route in self.router.routes:
            stats = self.route_performance[route.name]
            total = stats["correct"] + stats["incorrect"]

            if total < 20:
                continue

            accuracy = stats["correct"] / total

            # If accuracy is low, raise threshold (be more selective)
            if accuracy < 0.7:
                route.threshold = min(0.9, route.threshold + 0.05)
                print(f"Raised threshold for {route.name} to {route.threshold}")

            # If many misses, lower threshold (be more inclusive)
            elif stats["missed"] / max(total, 1) > 0.2:
                route.threshold = max(0.5, route.threshold - 0.05)
                print(f"Lowered threshold for {route.name} to {route.threshold}")

    def export_misrouted_queries(self) -> list[dict]:
        """Export queries that were routed incorrectly for manual review."""
        misrouted = [
            entry for entry in self.feedback_log
            if entry["feedback"] and not entry["feedback"]["correct"]
        ]
        return misrouted
```

## Integration with Azure AI Search

Use Azure AI Search for scalable semantic routing:

```python
from azure.search.documents import SearchClient
from azure.search.documents.indexes import SearchIndexClient
from azure.search.documents.indexes.models import (
    SearchIndex, SearchField, VectorSearch,
    HnswAlgorithmConfiguration, VectorSearchProfile
)
from azure.core.credentials import AzureKeyCredential

class AzureSemanticRouter:
    def __init__(
        self,
        endpoint: str,
        key: str,
        index_name: str = "routes"
    ):
        self.credential = AzureKeyCredential(key)
        self.index_client = SearchIndexClient(endpoint, self.credential)
        self.search_client = SearchClient(endpoint, index_name, self.credential)
        self.index_name = index_name

    def setup_index(self):
        """Create search index for routes."""
        fields = [
            SearchField(name="id", type="Edm.String", key=True),
            SearchField(name="route_name", type="Edm.String", filterable=True),
            SearchField(name="utterance", type="Edm.String", searchable=True),
            SearchField(
                name="embedding",
                type="Collection(Edm.Single)",
                vector_search_dimensions=1536,
                vector_search_profile_name="vector-profile"
            ),
            SearchField(name="model", type="Edm.String"),
            SearchField(name="system_prompt", type="Edm.String"),
            SearchField(name="threshold", type="Edm.Double"),
        ]

        vector_search = VectorSearch(
            algorithms=[
                HnswAlgorithmConfiguration(name="hnsw-config")
            ],
            profiles=[
                VectorSearchProfile(
                    name="vector-profile",
                    algorithm_configuration_name="hnsw-config"
                )
            ]
        )

        index = SearchIndex(
            name=self.index_name,
            fields=fields,
            vector_search=vector_search
        )

        self.index_client.create_or_update_index(index)

    def add_route(self, route: AdvancedRoute):
        """Index route utterances."""
        documents = []

        for i, utterance in enumerate(route.utterances):
            embedding = self._get_embedding(utterance)
            documents.append({
                "id": f"{route.name}_{i}",
                "route_name": route.name,
                "utterance": utterance,
                "embedding": embedding.tolist(),
                "model": route.model,
                "system_prompt": route.system_prompt,
                "threshold": route.threshold,
            })

        self.search_client.upload_documents(documents)

    def route(self, query: str) -> tuple[str, str, float]:
        """Route query using vector search."""
        query_embedding = self._get_embedding(query)

        results = self.search_client.search(
            search_text=None,
            vector_queries=[{
                "vector": query_embedding.tolist(),
                "k_nearest_neighbors": 5,
                "fields": "embedding"
            }],
            select=["route_name", "model", "system_prompt", "threshold"]
        )

        best_result = None
        best_score = 0

        for result in results:
            if result["@search.score"] > best_score:
                if result["@search.score"] >= result["threshold"]:
                    best_score = result["@search.score"]
                    best_result = result

        if best_result:
            return best_result["route_name"], best_result["model"], best_score

        return None

    def _get_embedding(self, text: str) -> np.ndarray:
        from openai import AzureOpenAI
        client = AzureOpenAI()
        response = client.embeddings.create(
            model="text-embedding-3-small",
            input=text
        )
        return np.array(response.data[0].embedding)
```

## Best Practices

1. **Use diverse utterances**: Cover different phrasings of the same intent
2. **Set appropriate thresholds**: Balance precision and recall
3. **Monitor and iterate**: Track routing accuracy and improve
4. **Cache embeddings**: Avoid recomputing for known utterances
5. **Have fallbacks**: Handle unmatched queries gracefully

## Conclusion

Semantic routing brings intelligence to LLM orchestration. Instead of brittle keyword rules, you match meaning. This results in more natural interactions and better routing accuracy.

Start with clear intent definitions, diverse examples, and iterate based on real usage patterns.
