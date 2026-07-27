---
title: "Enterprise AI: Building Secure API Gateways for LLM Access"
author: Michael John Peña
draft: false
date: 2025-09-19
tags:
  - Enterprise AI
  - API Gateway
  - Security
  - Rate Limiting
  - Azure API Management

---

I wrote "Enterprise AI: Building Secure API Gateways for LLM Access" to share practical, production-minded guidance on this topic.

## Gateway Architecture

```python
from dataclasses import dataclass
from typing import Dict, Optional, List
from datetime import datetime, timedelta
import hashlib
import asyncio

@dataclass
class APIPolicy:
    rate_limit_per_minute: int
    daily_token_budget: int
    allowed_models: List[str]
    content_filtering_enabled: bool
    pii_detection_enabled: bool

@dataclass
class ClientContext:
    client_id: str
    department: str
    policy: APIPolicy
    tokens_used_today: int = 0
    requests_this_minute: int = 0

class LLMGateway:
    def __init__(self, backend_client, content_filter):
        self.backend_client = backend_client
        self.content_filter = content_filter
        self.clients: Dict[str, ClientContext] = {}
        self.request_log: List[Dict] = []

    async def process_request(self, api_key: str, request: Dict) -> Dict:
        """Process LLM request through gateway policies."""

        # Authenticate and get client context
        client = self._authenticate(api_key)
        if not client:
            return {"error": "Invalid API key", "status": 401}

        # Rate limiting
        if not self._check_rate_limit(client):
            return {"error": "Rate limit exceeded", "status": 429}

        # Token budget check
        estimated_tokens = self._estimate_tokens(request)
        if client.tokens_used_today + estimated_tokens > client.policy.daily_token_budget:
            return {"error": "Daily token budget exceeded", "status": 429}

        # Model authorization
        model = request.get("model", "gpt-4o")
        if model not in client.policy.allowed_models:
            return {"error": f"Model {model} not authorized", "status": 403}

        # Content filtering
        if client.policy.content_filtering_enabled:
            filter_result = await self.content_filter.check(request.get("messages", []))
            if not filter_result["safe"]:
                self._log_blocked_request(client, request, filter_result)
                return {"error": "Content policy violation", "status": 400}

        # PII detection
        if client.policy.pii_detection_enabled:
            pii_result = await self._detect_pii(request)
            if pii_result["pii_detected"]:
                return {"error": "PII detected in request", "status": 400,
                        "details": pii_result["types"]}

        # Forward to backend
        response = await self.backend_client.chat.completions.create(**request)

        # Update usage tracking
        actual_tokens = response.usage.total_tokens
        client.tokens_used_today += actual_tokens

        # Log for billing
        self._log_request(client, request, response, actual_tokens)

        return {
            "response": response,
            "usage": {
                "tokens_used": actual_tokens,
                "daily_remaining": client.policy.daily_token_budget - client.tokens_used_today
            }
        }

    def _check_rate_limit(self, client: ClientContext) -> bool:
        """Check if client is within rate limits."""
        client.requests_this_minute += 1
        return client.requests_this_minute <= client.policy.rate_limit_per_minute

    def _estimate_tokens(self, request: Dict) -> int:
        """Estimate token count for budget checking."""
        messages = request.get("messages", [])
        text = " ".join(m.get("content", "") for m in messages)
        return len(text) // 4  # Rough estimate

    def _log_request(self, client: ClientContext, request: Dict,
                     response: any, tokens: int):
        """Log request for billing and audit."""
        self.request_log.append({
            "timestamp": datetime.now().isoformat(),
            "client_id": client.client_id,
            "department": client.department,
            "model": request.get("model"),
            "tokens": tokens,
            "latency_ms": getattr(response, "_response_ms", 0)
        })
```

## Cost Allocation by Department

```python
def generate_billing_report(gateway: LLMGateway, period_start: datetime) -> Dict:
    """Generate department-level billing report."""
    costs_by_dept = {}

    for log in gateway.request_log:
        if datetime.fromisoformat(log["timestamp"]) >= period_start:
            dept = log["department"]
            if dept not in costs_by_dept:
                costs_by_dept[dept] = {"tokens": 0, "requests": 0}

            costs_by_dept[dept]["tokens"] += log["tokens"]
            costs_by_dept[dept]["requests"] += 1

    return costs_by_dept
```

A well-designed gateway enables enterprise-wide AI adoption while maintaining security, compliance, and cost control.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
