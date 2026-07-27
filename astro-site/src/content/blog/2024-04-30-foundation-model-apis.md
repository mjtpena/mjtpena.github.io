---
title: "Foundation Model APIs in Databricks: Enterprise LLM Access"
author: "Michael John Peña"
draft: false
date: 2024-04-30
tags: ["Databricks", "Foundation Models", "LLM", "AI", "APIs"]

---

I wrote "Foundation Model APIs in Databricks: Enterprise LLM Access" to share practical, production-minded guidance on this topic.

Databricks Foundation Model APIs provide enterprise-ready access to state-of-the-art LLMs. This guide covers using these APIs for building AI applications.

## Available Foundation Models

```python
DATABRICKS_FOUNDATION_MODELS = {
    "llm_models": {
        "databricks-meta-llama-3-70b-instruct": {
            "description": "Meta's Llama 3 70B for instruction following",
            "context_window": 8192,
            "best_for": ["General tasks", "Code generation", "Analysis"]
        },
        "databricks-meta-llama-3-8b-instruct": {
            "description": "Smaller, faster Llama 3 model",
            "context_window": 8192,
            "best_for": ["Simple tasks", "High throughput", "Cost-sensitive"]
        },
        "databricks-dbrx-instruct": {
            "description": "Databricks' own MoE model",
            "context_window": 32768,
            "best_for": ["Long context", "Complex reasoning"]
        },
        "databricks-mixtral-8x7b-instruct": {
            "description": "Mistral's MoE model",
            "context_window": 32768,
            "best_for": ["Multilingual", "Balanced performance"]
        }
    },
    "embedding_models": {
        "databricks-bge-large-en": {
            "description": "BGE embeddings for English",
            "dimensions": 1024,
            "best_for": ["Semantic search", "RAG", "Similarity"]
        },
        "databricks-gte-large-en": {
            "description": "GTE embeddings",
            "dimensions": 1024,
            "best_for": ["Text classification", "Clustering"]
        }
    }
}
```

## Using Foundation Model APIs

```python
import requests
from typing import List, Dict, Optional

class FoundationModelClient:
    """Client for Databricks Foundation Model APIs"""

    def __init__(self, workspace_url: str, token: str):
        self.workspace_url = workspace_url
        self.headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        }

    def chat_completion(
        self,
        model: str,
        messages: List[Dict],
        max_tokens: int = 1000,
        temperature: float = 0.7,
        top_p: float = 0.9
    ) -> Dict:
        """Generate chat completion"""

        url = f"{self.workspace_url}/serving-endpoints/{model}/invocations"

        payload = {
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "top_p": top_p
        }

        response = requests.post(url, headers=self.headers, json=payload)
        response.raise_for_status()

        return response.json()

    def generate_embeddings(
        self,
        model: str,
        texts: List[str]
    ) -> List[List[float]]:
        """Generate embeddings for texts"""

        url = f"{self.workspace_url}/serving-endpoints/{model}/invocations"

        payload = {
            "input": texts
        }

        response = requests.post(url, headers=self.headers, json=payload)
        response.raise_for_status()

        result = response.json()
        return [item["embedding"] for item in result["data"]]

    def stream_completion(
        self,
        model: str,
        messages: List[Dict],
        max_tokens: int = 1000
    ):
        """Stream chat completion responses"""

        url = f"{self.workspace_url}/serving-endpoints/{model}/invocations"

        payload = {
            "messages": messages,
            "max_tokens": max_tokens,
            "stream": True
        }

        with requests.post(
            url,
            headers=self.headers,
            json=payload,
            stream=True
        ) as response:
            for line in response.iter_lines():
                if line:
                    yield line.decode('utf-8')

# Usage
client = FoundationModelClient(
    workspace_url="https://adb-xxx.azuredatabricks.net",
    token="your-token"
)

# Chat completion
response = client.chat_completion(
    model="databricks-meta-llama-3-70b-instruct",
    messages=[
        {"role": "system", "content": "You are a helpful data analyst."},
        {"role": "user", "content": "Explain what a lakehouse is."}
    ]
)
print(response["choices"][0]["message"]["content"])

# Embeddings
embeddings = client.generate_embeddings(
    model="databricks-bge-large-en",
    texts=["What is Databricks?", "Explain data engineering."]
)
print(f"Embedding dimensions: {len(embeddings[0])}")
```

## Building Applications with Foundation Models

```python
class DataAnalysisAssistant:
    """AI assistant for data analysis using foundation models"""

    def __init__(self, client: FoundationModelClient):
        self.client = client
        self.model = "databricks-meta-llama-3-70b-instruct"

    def analyze_data_question(self, question: str, schema: dict) -> dict:
        """Analyze a natural language question about data"""

        system_prompt = f"""You are a data analyst assistant.
        You help users understand and query their data.

        Available data schema:
        {self._format_schema(schema)}

        Provide:
        1. A SQL query to answer the question
        2. An explanation of the approach
        3. Suggestions for follow-up analysis
        """

        response = self.client.chat_completion(
            model=self.model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": question}
            ],
            temperature=0.3  # Lower for more deterministic SQL
        )

        return self._parse_response(response)

    def explain_query_results(
        self,
        query: str,
        results: list,
        question: str
    ) -> str:
        """Generate natural language explanation of query results"""

        prompt = f"""The user asked: "{question}"

        This SQL query was executed:
        ```sql
        {query}
        ```

        Results:
        {self._format_results(results)}

        Provide a clear, business-friendly explanation of these results.
        Include key insights and any notable patterns."""

        response = self.client.chat_completion(
            model=self.model,
            messages=[{"role": "user", "content": prompt}]
        )

        return response["choices"][0]["message"]["content"]

    def suggest_visualizations(self, data_summary: dict) -> list:
        """Suggest appropriate visualizations for data"""

        prompt = f"""Given this data summary:
        {data_summary}

        Suggest 3 appropriate visualizations with:
        1. Chart type
        2. What to show on each axis
        3. Why this visualization is useful

        Return as a numbered list."""

        response = self.client.chat_completion(
            model=self.model,
            messages=[{"role": "user", "content": prompt}]
        )

        return response["choices"][0]["message"]["content"]

    def _format_schema(self, schema: dict) -> str:
        return "\n".join(
            f"Table: {table}\nColumns: {', '.join(cols)}"
            for table, cols in schema.items()
        )

    def _format_results(self, results: list) -> str:
        if not results:
            return "No results"
        return str(results[:10])  # Show first 10 rows

    def _parse_response(self, response: dict) -> dict:
        content = response["choices"][0]["message"]["content"]
        return {
            "response": content,
            "usage": response.get("usage", {})
        }

# Usage
assistant = DataAnalysisAssistant(client)

schema = {
    "sales": ["order_id", "customer_id", "product_id", "amount", "order_date"],
    "customers": ["customer_id", "name", "segment", "region"],
    "products": ["product_id", "name", "category", "price"]
}

result = assistant.analyze_data_question(
    question="What are the top 5 customers by total revenue this year?",
    schema=schema
)
print(result["response"])
```

## RAG with Foundation Models

```python
from databricks.vector_search.client import VectorSearchClient

class FoundationModelRAG:
    """RAG system using Databricks Foundation Models"""

    def __init__(
        self,
        fm_client: FoundationModelClient,
        vector_search_endpoint: str,
        index_name: str
    ):
        self.fm = fm_client
        self.vsc = VectorSearchClient()
        self.index = self.vsc.get_index(vector_search_endpoint, index_name)
        self.embedding_model = "databricks-bge-large-en"
        self.llm_model = "databricks-meta-llama-3-70b-instruct"

    def query(
        self,
        question: str,
        num_context: int = 5,
        filters: dict = None
    ) -> dict:
        """Complete RAG query pipeline"""

        # Retrieve relevant documents
        search_results = self.index.similarity_search(
            query_text=question,
            columns=["doc_id", "title", "content"],
            num_results=num_context,
            filters=filters
        )

        context = self._format_context(search_results)

        # Generate answer
        answer = self._generate_answer(question, context)

        return {
            "question": question,
            "answer": answer,
            "sources": [
                {"title": row[2], "score": row[0]}
                for row in search_results["result"]["data_array"]
            ]
        }

    def _format_context(self, search_results: dict) -> str:
        """Format search results as context"""
        contexts = []
        for row in search_results["result"]["data_array"]:
            title = row[2]
            content = row[3]
            contexts.append(f"### {title}\n{content}")
        return "\n\n".join(contexts)

    def _generate_answer(self, question: str, context: str) -> str:
        """Generate answer using LLM"""

        system_prompt = """You are a helpful assistant that answers questions
        based on the provided context. If the context doesn't contain
        the answer, say so. Always cite which source you're using."""

        response = self.fm.chat_completion(
            model=self.llm_model,
            messages=[
                {"role": "system", "content": system_prompt},
                {
                    "role": "user",
                    "content": f"""Context:
{context}

Question: {question}

Answer based on the context above:"""
                }
            ],
            temperature=0.3
        )

        return response["choices"][0]["message"]["content"]

# Usage
rag = FoundationModelRAG(
    fm_client=client,
    vector_search_endpoint="vector-search-endpoint",
    index_name="main.docs.knowledge_base_index"
)

result = rag.query("How do I create a Delta table in Databricks?")
print(result["answer"])
print("\nSources:")
for source in result["sources"]:
    print(f"  - {source['title']} (score: {source['score']:.3f})")
```

## Cost and Performance Optimization

```python
class OptimizedFoundationModelClient:
    """Cost and performance optimized foundation model client"""

    def __init__(self, client: FoundationModelClient):
        self.client = client
        self.cache = {}

    def select_model(
        self,
        task_complexity: str,
        latency_requirement: str
    ) -> str:
        """Select appropriate model based on requirements"""

        model_selection = {
            ("simple", "low"): "databricks-meta-llama-3-8b-instruct",
            ("simple", "normal"): "databricks-meta-llama-3-8b-instruct",
            ("moderate", "low"): "databricks-mixtral-8x7b-instruct",
            ("moderate", "normal"): "databricks-meta-llama-3-70b-instruct",
            ("complex", "low"): "databricks-dbrx-instruct",
            ("complex", "normal"): "databricks-meta-llama-3-70b-instruct"
        }

        return model_selection.get(
            (task_complexity, latency_requirement),
            "databricks-meta-llama-3-70b-instruct"
        )

    def cached_completion(
        self,
        messages: List[Dict],
        cache_key: str = None,
        **kwargs
    ) -> Dict:
        """Completion with caching"""

        if cache_key is None:
            cache_key = hash(str(messages))

        if cache_key in self.cache:
            return self.cache[cache_key]

        model = kwargs.pop("model", "databricks-meta-llama-3-70b-instruct")
        result = self.client.chat_completion(model, messages, **kwargs)

        self.cache[cache_key] = result
        return result

    def batch_embeddings(
        self,
        texts: List[str],
        batch_size: int = 100
    ) -> List[List[float]]:
        """Generate embeddings in optimized batches"""

        all_embeddings = []

        for i in range(0, len(texts), batch_size):
            batch = texts[i:i + batch_size]
            embeddings = self.client.generate_embeddings(
                "databricks-bge-large-en",
                batch
            )
            all_embeddings.extend(embeddings)

        return all_embeddings
```

## Conclusion

Databricks Foundation Model APIs provide enterprise-ready access to state-of-the-art LLMs. Use them for building intelligent applications, RAG systems, and data analysis assistants with built-in governance and scalability.

