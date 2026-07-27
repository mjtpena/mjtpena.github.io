---
title: "Building LLM Applications with Azure OpenAI: Patterns and Practices"
author: Michael John Peña
draft: false
date: 2022-11-13
tags:
  - Azure
  - OpenAI
  - LLM
  - AI
  - Patterns

---

I wrote "Building LLM Applications with Azure OpenAI: Patterns and Practices" to share practical, production-minded guidance on this topic.

## Building Blocks for LLM Applications

When building applications with GPT-3 and other LLMs, you need to think about:

- Prompt design and management
- Chaining multiple LLM calls
- Testing and evaluation
- Error handling and fallbacks
- Cost optimization

## Designing LLM Workflows

### Intent Classification

```python
import openai

def classify_intent(user_message: str) -> str:
    """Classify the intent of a user message."""

    prompt = f"""Classify the intent of this message into one of these categories:
    - question: User is asking a question
    - complaint: User is expressing dissatisfaction
    - request: User wants something done
    - feedback: User is providing feedback
    - other: None of the above

    Message: {user_message}

    Intent:"""

    response = openai.Completion.create(
        engine="text-davinci-002",
        prompt=prompt,
        max_tokens=20,
        temperature=0
    )

    return response.choices[0].text.strip().lower()
```

### Context Retrieval with Azure Cognitive Search

```python
from azure.search.documents import SearchClient
from azure.core.credentials import AzureKeyCredential

def retrieve_context(intent: str, query: str) -> str:
    """Retrieve relevant context from Azure Cognitive Search."""

    search_client = SearchClient(
        endpoint="https://your-search.search.windows.net",
        index_name="knowledge-base",
        credential=AzureKeyCredential("your-key")
    )

    # Search based on intent and query
    filter_expression = f"category eq '{intent}'" if intent != "other" else None

    results = search_client.search(
        search_text=query,
        filter=filter_expression,
        top=3,
        select=["content", "title"]
    )

    context_parts = []
    for result in results:
        context_parts.append(f"## {result['title']}\n{result['content']}")

    return "\n\n".join(context_parts) if context_parts else "No relevant information found."
```

### Response Generation

```python
def generate_response(query: str, context: str, intent: str) -> str:
    """Generate a response using retrieved context."""

    prompt = f"""You are a helpful customer service assistant. Use the provided context to answer the user's query.
If the context doesn't contain relevant information, say so politely.

Intent detected: {intent}

Context:
{context}

User query: {query}

Response:"""

    response = openai.Completion.create(
        engine="text-davinci-002",
        prompt=prompt,
        max_tokens=500,
        temperature=0.7
    )

    return response.choices[0].text.strip()
```

## Building a Complete Pipeline

```python
from dataclasses import dataclass
from typing import List, Optional

@dataclass
class QueryResult:
    query: str
    intent: str
    context: str
    response: str
    sources: List[str]

class CustomerServicePipeline:
    """End-to-end pipeline for customer service queries."""

    def __init__(self, search_endpoint: str, search_key: str, openai_key: str):
        self.search_client = SearchClient(
            endpoint=search_endpoint,
            index_name="knowledge-base",
            credential=AzureKeyCredential(search_key)
        )
        openai.api_key = openai_key

    def process_query(self, user_query: str) -> QueryResult:
        """Process a user query through the full pipeline."""

        # Step 1: Classify intent
        intent = classify_intent(user_query)

        # Step 2: Retrieve context
        context = retrieve_context(intent, user_query)

        # Step 3: Generate response
        response = generate_response(user_query, context, intent)

        return QueryResult(
            query=user_query,
            intent=intent,
            context=context,
            response=response,
            sources=[]  # Could extract from search results
        )
```

## Testing and Evaluation

```python
from typing import List, Dict
import json

class LLMEvaluator:
    """Evaluate LLM responses for quality."""

    def __init__(self, test_cases: List[Dict]):
        self.test_cases = test_cases
        self.results = []

    def evaluate_response(self, expected: str, actual: str) -> Dict:
        """Evaluate a single response."""

        # Simple metrics
        exact_match = expected.lower() == actual.lower()
        contains_key_info = all(
            keyword in actual.lower()
            for keyword in self._extract_keywords(expected)
        )

        # Use LLM to evaluate relevance
        relevance_score = self._llm_evaluate(expected, actual)

        return {
            "exact_match": exact_match,
            "contains_key_info": contains_key_info,
            "relevance_score": relevance_score
        }

    def _extract_keywords(self, text: str) -> List[str]:
        """Extract important keywords from text."""
        # Simple implementation - could use NLP
        common_words = {"the", "a", "an", "is", "are", "was", "were", "to", "for"}
        words = text.lower().split()
        return [w for w in words if w not in common_words and len(w) > 3][:5]

    def _llm_evaluate(self, expected: str, actual: str) -> float:
        """Use GPT to evaluate response quality."""

        prompt = f"""Rate how well the actual response addresses the expected response.
        Score from 0 to 1, where 1 is perfect.

        Expected: {expected}
        Actual: {actual}

        Score (0-1):"""

        response = openai.Completion.create(
            engine="text-davinci-002",
            prompt=prompt,
            max_tokens=10,
            temperature=0
        )

        try:
            return float(response.choices[0].text.strip())
        except:
            return 0.5

    def run_evaluation(self, pipeline: CustomerServicePipeline) -> Dict:
        """Run evaluation on all test cases."""

        for test_case in self.test_cases:
            result = pipeline.process_query(test_case["query"])
            evaluation = self.evaluate_response(
                test_case["expected_response"],
                result.response
            )
            self.results.append({
                "query": test_case["query"],
                "expected": test_case["expected_response"],
                "actual": result.response,
                **evaluation
            })

        return self._aggregate_results()

    def _aggregate_results(self) -> Dict:
        """Aggregate evaluation results."""
        n = len(self.results)
        return {
            "total_tests": n,
            "exact_match_rate": sum(r["exact_match"] for r in self.results) / n,
            "key_info_rate": sum(r["contains_key_info"] for r in self.results) / n,
            "avg_relevance": sum(r["relevance_score"] for r in self.results) / n
        }
```

## Error Handling and Fallbacks

```python
from tenacity import retry, stop_after_attempt, wait_exponential
import logging

class RobustLLMClient:
    """LLM client with error handling and fallbacks."""

    def __init__(self):
        self.fallback_responses = {
            "question": "I apologize, but I'm unable to answer your question at the moment. Please try again later or contact our support team.",
            "complaint": "I apologize for the inconvenience. Your feedback has been noted. Please contact our support team for immediate assistance.",
            "default": "I apologize, but I'm experiencing technical difficulties. Please try again later."
        }

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=4, max=60)
    )
    def call_with_retry(self, prompt: str, **kwargs) -> str:
        """Call OpenAI API with retry logic."""

        try:
            response = openai.Completion.create(
                engine="text-davinci-002",
                prompt=prompt,
                **kwargs
            )
            return response.choices[0].text.strip()

        except openai.error.RateLimitError:
            logging.warning("Rate limited, retrying...")
            raise

        except openai.error.APIError as e:
            logging.error(f"API error: {e}")
            raise

    def generate_with_fallback(self, prompt: str, intent: str = "default", **kwargs) -> str:
        """Generate response with fallback on failure."""

        try:
            return self.call_with_retry(prompt, **kwargs)
        except Exception as e:
            logging.error(f"All retries failed: {e}")
            return self.fallback_responses.get(intent, self.fallback_responses["default"])
```

## Cost Optimization

```python
import tiktoken
from functools import lru_cache

class CostOptimizedClient:
    """LLM client optimized for cost."""

    def __init__(self, model: str = "text-davinci-002"):
        self.model = model
        self.encoding = tiktoken.encoding_for_model(model)
        self.token_count = 0
        self.cost_per_1k = 0.02  # Davinci pricing

    def count_tokens(self, text: str) -> int:
        """Count tokens in text."""
        return len(self.encoding.encode(text))

    @lru_cache(maxsize=1000)
    def cached_completion(self, prompt: str, max_tokens: int = 200) -> str:
        """Cache completions to avoid redundant API calls."""

        response = openai.Completion.create(
            engine=self.model,
            prompt=prompt,
            max_tokens=max_tokens,
            temperature=0  # Use temperature=0 for cache consistency
        )

        tokens_used = response["usage"]["total_tokens"]
        self.token_count += tokens_used

        return response.choices[0].text.strip()

    def choose_model(self, task_complexity: str) -> str:
        """Choose appropriate model based on task."""

        model_map = {
            "simple": "text-ada-001",      # $0.0004/1K
            "medium": "text-curie-001",     # $0.002/1K
            "complex": "text-davinci-002"   # $0.02/1K
        }

        return model_map.get(task_complexity, "text-curie-001")

    def get_estimated_cost(self) -> float:
        """Get estimated cost so far."""
        return (self.token_count / 1000) * self.cost_per_1k

    def truncate_prompt(self, prompt: str, max_tokens: int = 3000) -> str:
        """Truncate prompt to fit within token limits."""

        tokens = self.encoding.encode(prompt)
        if len(tokens) <= max_tokens:
            return prompt

        return self.encoding.decode(tokens[:max_tokens])
```

## Production Deployment

```python
from flask import Flask, request, jsonify
from azure.monitor.opentelemetry import configure_azure_monitor

app = Flask(__name__)

# Configure monitoring
configure_azure_monitor(
    connection_string="InstrumentationKey=your-key"
)

# Initialize pipeline
pipeline = CustomerServicePipeline(
    search_endpoint="https://your-search.search.windows.net",
    search_key="your-search-key",
    openai_key="your-openai-key"
)

@app.route("/api/query", methods=["POST"])
def handle_query():
    """Handle customer service queries."""

    data = request.json
    query = data.get("query", "")

    if not query:
        return jsonify({"error": "Query is required"}), 400

    try:
        result = pipeline.process_query(query)
        return jsonify({
            "response": result.response,
            "intent": result.intent,
            "sources": result.sources
        })
    except Exception as e:
        logging.error(f"Error processing query: {e}")
        return jsonify({
            "error": "Unable to process query",
            "fallback": "Please contact our support team for assistance."
        }), 500

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8080)
```

## Best Practices

1. **Prompt versioning**: Track changes to prompts like code
2. **Test extensively**: Use diverse test cases and edge cases
3. **Monitor in production**: Track latency, costs, and quality metrics
4. **Implement fallbacks**: Handle LLM failures gracefully
5. **Cache when possible**: Reduce costs and latency for repeated queries
6. **Use appropriate models**: Match model capability to task complexity

## Conclusion

Building production LLM applications requires more than just calling the API. You need structured pipelines, robust error handling, evaluation frameworks, and cost optimization. As Azure OpenAI Service matures, expect to see more tooling emerge to support these patterns.

## Resources

- [Azure OpenAI Service Documentation](https://learn.microsoft.com/en-us/azure/cognitive-services/openai/)
- [Prompt Engineering Best Practices](https://platform.openai.com/docs/guides/completion/prompt-design)
- [Azure Cognitive Search](https://learn.microsoft.com/en-us/azure/search/)

