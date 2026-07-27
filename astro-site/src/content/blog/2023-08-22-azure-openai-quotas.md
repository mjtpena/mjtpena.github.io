---
title: "Azure OpenAI Quotas: Understanding and Managing Limits"
author: Michael John Peña
draft: false
date: 2023-08-22
tags:
  - Azure OpenAI
  - Quotas
  - Rate Limits
  - API Management

---

I wrote "Azure OpenAI Quotas: Understanding and Managing Limits" to share practical, production-minded guidance on this topic.

## Quota Types

```python
quota_types = {
    "tokens_per_minute": {
        "description": "TPM - Total tokens processed per minute",
        "includes": "Input + output tokens",
        "default": "Varies by model and region"
    },
    "requests_per_minute": {
        "description": "RPM - API calls per minute",
        "default": "Varies by deployment"
    },
    "tokens_per_day": {
        "description": "Daily token limit (some regions)",
        "resets": "Daily at midnight UTC"
    }
}

# Default quotas (as of August 2023)
default_quotas = {
    "gpt-4": {"tpm": 10000, "rpm": 60},
    "gpt-4-32k": {"tpm": 30000, "rpm": 60},
    "gpt-35-turbo": {"tpm": 120000, "rpm": 720},
    "text-embedding-ada-002": {"tpm": 350000, "rpm": 720}
}
```

## Checking Current Quotas

```python
from azure.mgmt.cognitiveservices import CognitiveServicesManagementClient
from azure.identity import DefaultAzureCredential

def get_deployment_quotas(subscription_id, resource_group, account_name):
    credential = DefaultAzureCredential()
    client = CognitiveServicesManagementClient(credential, subscription_id)

    # Get account properties
    account = client.accounts.get(resource_group, account_name)

    # List deployments
    deployments = client.deployments.list(resource_group, account_name)

    quotas = []
    for deployment in deployments:
        quotas.append({
            "name": deployment.name,
            "model": deployment.properties.model.name,
            "capacity": deployment.sku.capacity,
            "tpm": deployment.sku.capacity * 1000  # Rough estimate
        })

    return quotas
```

## Handling Rate Limits

```python
import time
from openai import AzureOpenAI, RateLimitError

class RateLimitHandler:
    def __init__(self, client, max_retries=5, base_delay=1):
        self.client = client
        self.max_retries = max_retries
        self.base_delay = base_delay

    def chat_completion(self, **kwargs):
        for attempt in range(self.max_retries):
            try:
                return self.client.chat.completions.create(**kwargs)
            except RateLimitError as e:
                if attempt == self.max_retries - 1:
                    raise

                # Exponential backoff
                delay = self.base_delay * (2 ** attempt)

                # Check for retry-after header
                retry_after = getattr(e, 'retry_after', None)
                if retry_after:
                    delay = max(delay, retry_after)

                print(f"Rate limited. Retrying in {delay}s...")
                time.sleep(delay)

# Usage
client = AzureOpenAI(
    azure_endpoint="https://your-resource.openai.azure.com/",
    api_key="your-key",
    api_version="2024-02-15-preview"
)

handler = RateLimitHandler(client)
response = handler.chat_completion(
    model="gpt-4",
    messages=[{"role": "user", "content": "Hello"}]
)
```

## Token Budgeting

```python
import tiktoken

class TokenBudget:
    def __init__(self, tpm_limit, safety_margin=0.9):
        self.tpm_limit = int(tpm_limit * safety_margin)
        self.tokens_used = 0
        self.window_start = time.time()

    def can_send(self, estimated_tokens):
        self._maybe_reset_window()
        return (self.tokens_used + estimated_tokens) <= self.tpm_limit

    def record_usage(self, tokens):
        self.tokens_used += tokens

    def wait_time(self, estimated_tokens):
        if self.can_send(estimated_tokens):
            return 0
        return 60 - (time.time() - self.window_start)

    def _maybe_reset_window(self):
        if time.time() - self.window_start >= 60:
            self.tokens_used = 0
            self.window_start = time.time()

def estimate_tokens(text, model="gpt-4"):
    encoding = tiktoken.encoding_for_model(model)
    return len(encoding.encode(text))

# Usage
budget = TokenBudget(tpm_limit=10000)

for request in requests:
    estimated = estimate_tokens(request["prompt"]) + request["max_tokens"]

    wait = budget.wait_time(estimated)
    if wait > 0:
        time.sleep(wait)

    response = client.chat.completions.create(...)
    budget.record_usage(response.usage.total_tokens)
```

## Request Queuing

```python
import asyncio
from collections import deque

class RateLimitedQueue:
    def __init__(self, tpm_limit, rpm_limit):
        self.tpm_limit = tpm_limit
        self.rpm_limit = rpm_limit
        self.queue = deque()
        self.tokens_this_minute = 0
        self.requests_this_minute = 0
        self.window_start = time.time()

    async def add_request(self, request):
        future = asyncio.Future()
        self.queue.append((request, future))
        return await future

    async def process_loop(self):
        while True:
            self._maybe_reset_window()

            if self.queue:
                request, future = self.queue[0]
                estimated_tokens = estimate_tokens(request["prompt"])

                if (self.tokens_this_minute + estimated_tokens <= self.tpm_limit
                    and self.requests_this_minute < self.rpm_limit):

                    self.queue.popleft()
                    response = await self._send_request(request)

                    self.tokens_this_minute += response.usage.total_tokens
                    self.requests_this_minute += 1

                    future.set_result(response)

            await asyncio.sleep(0.01)
```

## Requesting Quota Increases

```python
quota_increase_tips = {
    "when_to_request": [
        "Consistent quota utilization > 80%",
        "Production workload requirements",
        "Predictable usage patterns"
    ],
    "how_to_request": [
        "Azure Portal > Azure OpenAI > Quotas",
        "Submit support ticket with justification",
        "Provide usage data and projections"
    ],
    "what_to_include": [
        "Current usage patterns",
        "Expected growth",
        "Business justification",
        "SLA requirements"
    ]
}
```

Tomorrow we'll explore rate limit management strategies.

## Resources

- [Azure OpenAI Quotas](https://learn.microsoft.com/en-us/azure/ai-services/openai/quotas-limits)
- [Quota Management](https://learn.microsoft.com/en-us/azure/ai-services/openai/how-to/quota)
- [Rate Limit Best Practices](https://learn.microsoft.com/en-us/azure/ai-services/openai/how-to/quota#best-practices)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
