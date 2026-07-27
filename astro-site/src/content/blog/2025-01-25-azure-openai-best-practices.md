---
title: "Azure OpenAI Best Practices: Production-Ready AI Applications"
author: Michael John Peña
draft: false
date: 2025-01-25
tags:
  - Azure
  - OpenAI
  - AI
  - Best Practices
  - Enterprise

---

I wrote "Azure OpenAI Best Practices: Production-Ready AI Applications" to share practical, production-minded guidance on this topic.

## Deployment Architecture

### Multi-Region Setup

```python
from openai import AzureOpenAI
from tenacity import retry, stop_after_attempt, wait_exponential

class AzureOpenAIRouter:
    """Route requests across multiple Azure OpenAI deployments."""

    def __init__(self, deployments: list[dict]):
        self.clients = []
        for deployment in deployments:
            client = AzureOpenAI(
                api_key=deployment["api_key"],
                api_version="2024-06-01",
                azure_endpoint=deployment["endpoint"]
            )
            self.clients.append({
                "client": client,
                "deployment": deployment["deployment_name"],
                "region": deployment["region"],
                "priority": deployment.get("priority", 1)
            })
        # Sort by priority
        self.clients.sort(key=lambda x: x["priority"])

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=1, max=10))
    async def complete(self, messages: list, **kwargs) -> dict:
        """Route completion request with automatic failover."""

        last_error = None
        for client_info in self.clients:
            try:
                response = await client_info["client"].chat.completions.create(
                    model=client_info["deployment"],
                    messages=messages,
                    **kwargs
                )
                return {
                    "response": response,
                    "region": client_info["region"]
                }
            except Exception as e:
                last_error = e
                print(f"Failed on {client_info['region']}: {e}")
                continue

        raise last_error

# Configure multi-region
router = AzureOpenAIRouter([
    {
        "endpoint": "https://aoai-eastus.openai.azure.com/",
        "api_key": os.environ["AZURE_OPENAI_KEY_EASTUS"],
        "deployment_name": "gpt-4o",
        "region": "eastus",
        "priority": 1
    },
    {
        "endpoint": "https://aoai-westus.openai.azure.com/",
        "api_key": os.environ["AZURE_OPENAI_KEY_WESTUS"],
        "deployment_name": "gpt-4o",
        "region": "westus",
        "priority": 2
    }
])
```

### Managed Identity Authentication

```python
from azure.identity import DefaultAzureCredential, get_bearer_token_provider

# Use managed identity instead of API keys
credential = DefaultAzureCredential()
token_provider = get_bearer_token_provider(
    credential,
    "https://cognitiveservices.azure.com/.default"
)

client = AzureOpenAI(
    api_version="2024-06-01",
    azure_endpoint="https://my-aoai.openai.azure.com/",
    azure_ad_token_provider=token_provider
)
```

## Rate Limiting and Throttling

```python
from asyncio import Semaphore
from datetime import datetime, timedelta
import asyncio

class RateLimiter:
    """Manage Azure OpenAI rate limits."""

    def __init__(self, tpm_limit: int, rpm_limit: int):
        self.tpm_limit = tpm_limit  # Tokens per minute
        self.rpm_limit = rpm_limit  # Requests per minute
        self.request_semaphore = Semaphore(rpm_limit)
        self.token_count = 0
        self.request_count = 0
        self.window_start = datetime.utcnow()

    async def acquire(self, estimated_tokens: int):
        """Acquire permission to make a request."""
        async with self.request_semaphore:
            # Check if we need to reset the window
            now = datetime.utcnow()
            if (now - self.window_start) > timedelta(minutes=1):
                self.token_count = 0
                self.request_count = 0
                self.window_start = now

            # Check token limit
            if self.token_count + estimated_tokens > self.tpm_limit:
                wait_time = 60 - (now - self.window_start).seconds
                print(f"Token limit reached, waiting {wait_time}s")
                await asyncio.sleep(wait_time)
                self.token_count = 0
                self.request_count = 0
                self.window_start = datetime.utcnow()

            # Check request limit
            if self.request_count >= self.rpm_limit:
                wait_time = 60 - (now - self.window_start).seconds
                print(f"Request limit reached, waiting {wait_time}s")
                await asyncio.sleep(wait_time)
                self.token_count = 0
                self.request_count = 0
                self.window_start = datetime.utcnow()

            self.request_count += 1

    def record_usage(self, tokens_used: int):
        """Record actual token usage."""
        self.token_count += tokens_used

# Usage
rate_limiter = RateLimiter(tpm_limit=80000, rpm_limit=480)

async def make_request(messages, **kwargs):
    estimated_tokens = estimate_tokens(messages)
    await rate_limiter.acquire(estimated_tokens)

    response = await client.chat.completions.create(
        model="gpt-4o",
        messages=messages,
        **kwargs
    )

    rate_limiter.record_usage(response.usage.total_tokens)
    return response
```

## Content Filtering and Safety

```python
class SafetyWrapper:
    """Wrapper for Azure OpenAI with safety controls."""

    def __init__(self, client: AzureOpenAI):
        self.client = client

    async def safe_complete(self, messages: list, **kwargs) -> dict:
        """Make request with safety handling."""

        try:
            response = await self.client.chat.completions.create(
                model="gpt-4o",
                messages=messages,
                **kwargs
            )

            # Check content filter results
            if hasattr(response, 'choices') and response.choices:
                choice = response.choices[0]
                if hasattr(choice, 'content_filter_results'):
                    self._handle_content_filter(choice.content_filter_results)

            return {"success": True, "response": response}

        except Exception as e:
            # Handle content filter blocks
            if "content_filter" in str(e).lower():
                return {
                    "success": False,
                    "error": "content_filtered",
                    "message": "Response blocked by content filter"
                }
            raise

    def _handle_content_filter(self, filter_results):
        """Log content filter results."""
        categories = ["hate", "self_harm", "sexual", "violence"]
        for category in categories:
            if hasattr(filter_results, category):
                result = getattr(filter_results, category)
                if result.filtered:
                    print(f"Content filtered: {category} - {result.severity}")
```

## Caching for Cost Optimization

```python
import hashlib
import json
from azure.cosmos import CosmosClient

class ResponseCache:
    """Cache Azure OpenAI responses for cost savings."""

    def __init__(self, cosmos_client: CosmosClient, database: str, container: str):
        self.container = cosmos_client.get_database_client(database).get_container_client(container)
        self.ttl_hours = 24

    def _cache_key(self, messages: list, model: str, temperature: float) -> str:
        """Generate cache key from request parameters."""
        content = json.dumps({
            "messages": messages,
            "model": model,
            "temperature": temperature
        }, sort_keys=True)
        return hashlib.sha256(content.encode()).hexdigest()

    async def get(self, messages: list, model: str, temperature: float = 0) -> dict | None:
        """Get cached response if available."""
        # Only cache deterministic requests
        if temperature > 0:
            return None

        key = self._cache_key(messages, model, temperature)
        try:
            item = self.container.read_item(item=key, partition_key=key)
            return item.get("response")
        except:
            return None

    async def set(self, messages: list, model: str, temperature: float, response: dict):
        """Cache a response."""
        if temperature > 0:
            return

        key = self._cache_key(messages, model, temperature)
        self.container.upsert_item({
            "id": key,
            "partitionKey": key,
            "response": response,
            "ttl": self.ttl_hours * 3600
        })

# Usage
cache = ResponseCache(cosmos_client, "ai_cache", "responses")

async def cached_complete(messages, model="gpt-4o", temperature=0, **kwargs):
    # Check cache
    cached = await cache.get(messages, model, temperature)
    if cached:
        return cached

    # Make request
    response = await client.chat.completions.create(
        model=model,
        messages=messages,
        temperature=temperature,
        **kwargs
    )

    # Cache response
    await cache.set(messages, model, temperature, response.model_dump())

    return response
```

## Monitoring and Observability

```python
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from azure.monitor.opentelemetry.exporter import AzureMonitorTraceExporter
import time

# Setup tracing
trace.set_tracer_provider(TracerProvider())
tracer = trace.get_tracer(__name__)
exporter = AzureMonitorTraceExporter(connection_string=os.environ["APPINSIGHTS_CONNECTION_STRING"])
trace.get_tracer_provider().add_span_processor(BatchSpanProcessor(exporter))

class MonitoredClient:
    """Azure OpenAI client with observability."""

    def __init__(self, client: AzureOpenAI):
        self.client = client

    async def complete(self, messages: list, **kwargs) -> dict:
        with tracer.start_as_current_span("azure_openai_completion") as span:
            start_time = time.time()

            span.set_attribute("model", kwargs.get("model", "gpt-4o"))
            span.set_attribute("message_count", len(messages))

            try:
                response = await self.client.chat.completions.create(
                    messages=messages,
                    **kwargs
                )

                # Record metrics
                duration = time.time() - start_time
                span.set_attribute("duration_ms", duration * 1000)
                span.set_attribute("prompt_tokens", response.usage.prompt_tokens)
                span.set_attribute("completion_tokens", response.usage.completion_tokens)
                span.set_attribute("total_tokens", response.usage.total_tokens)

                return response

            except Exception as e:
                span.set_attribute("error", str(e))
                span.record_exception(e)
                raise
```

## Cost Management

```python
class CostTracker:
    """Track Azure OpenAI costs."""

    # Pricing per 1K tokens (example - check current pricing)
    PRICING = {
        "gpt-4o": {"input": 0.005, "output": 0.015},
        "gpt-4o-mini": {"input": 0.00015, "output": 0.0006},
        "text-embedding-3-large": {"input": 0.00013, "output": 0}
    }

    def __init__(self):
        self.usage = {}

    def record(self, model: str, prompt_tokens: int, completion_tokens: int):
        """Record usage for cost tracking."""
        if model not in self.usage:
            self.usage[model] = {"prompt_tokens": 0, "completion_tokens": 0}

        self.usage[model]["prompt_tokens"] += prompt_tokens
        self.usage[model]["completion_tokens"] += completion_tokens

    def get_cost(self) -> dict:
        """Calculate costs from usage."""
        costs = {}
        total = 0

        for model, tokens in self.usage.items():
            if model in self.PRICING:
                pricing = self.PRICING[model]
                input_cost = (tokens["prompt_tokens"] / 1000) * pricing["input"]
                output_cost = (tokens["completion_tokens"] / 1000) * pricing["output"]
                model_cost = input_cost + output_cost
                costs[model] = {
                    "input_cost": input_cost,
                    "output_cost": output_cost,
                    "total": model_cost
                }
                total += model_cost

        costs["total"] = total
        return costs

# Usage
cost_tracker = CostTracker()

response = await client.chat.completions.create(...)
cost_tracker.record(
    model="gpt-4o",
    prompt_tokens=response.usage.prompt_tokens,
    completion_tokens=response.usage.completion_tokens
)

print(f"Current costs: ${cost_tracker.get_cost()['total']:.4f}")
```

## Best Practices Summary

1. **Multi-region deployment**: Ensure availability and handle regional outages
2. **Managed identity**: Avoid API keys in production
3. **Rate limiting**: Implement client-side limits to avoid throttling
4. **Caching**: Cache deterministic requests to reduce costs
5. **Monitoring**: Track latency, tokens, and errors
6. **Content filtering**: Handle filtered responses gracefully
7. **Cost tracking**: Monitor and budget for AI costs

Azure OpenAI provides enterprise capabilities, but you need to build robust infrastructure around it for production use.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
