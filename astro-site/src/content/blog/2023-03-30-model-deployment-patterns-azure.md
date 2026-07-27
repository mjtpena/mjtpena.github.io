---
title: "Model Deployment Patterns for Azure OpenAI"
author: Michael John Pena
draft: false
date: 2023-03-30
tags:
  - Azure
  - OpenAI
  - AI
  - Deployment
  - Architecture

---

I wrote "Model Deployment Patterns for Azure OpenAI" to share practical, production-minded guidance on this topic.

## Pattern 1: Gateway Pattern

Centralize LLM access through an API gateway:

```python
from fastapi import FastAPI, HTTPException, Depends
from fastapi.security import HTTPBearer
from pydantic import BaseModel
import asyncio

app = FastAPI()
security = HTTPBearer()

class ChatRequest(BaseModel):
    messages: list[dict]
    model: str = "gpt-35-turbo"
    temperature: float = 0.7
    max_tokens: int = 1000

class LLMGateway:
    """Centralized LLM gateway with routing and management."""

    def __init__(self):
        self.endpoints = {}
        self.rate_limiters = {}
        self.circuit_breakers = {}

    def register_endpoint(
        self,
        name: str,
        endpoint: str,
        key: str,
        priority: int = 1
    ):
        """Register an LLM endpoint."""
        self.endpoints[name] = {
            "endpoint": endpoint,
            "key": key,
            "priority": priority,
            "healthy": True
        }

    async def route_request(
        self,
        request: ChatRequest,
        user_id: str
    ) -> dict:
        """Route request to appropriate endpoint."""

        # Check rate limit
        if not await self._check_rate_limit(user_id):
            raise HTTPException(429, "Rate limit exceeded")

        # Select endpoint
        endpoint = self._select_endpoint(request.model)
        if not endpoint:
            raise HTTPException(503, "No healthy endpoints available")

        # Check circuit breaker
        if not self._check_circuit(endpoint["name"]):
            raise HTTPException(503, f"Endpoint {endpoint['name']} is unavailable")

        # Make request
        try:
            response = await self._call_endpoint(endpoint, request)
            self._record_success(endpoint["name"])
            return response
        except Exception as e:
            self._record_failure(endpoint["name"])
            # Try failover
            return await self._failover(request, endpoint["name"])

    def _select_endpoint(self, model: str) -> dict:
        """Select best available endpoint."""
        available = [
            e for e in self.endpoints.values()
            if e["healthy"]
        ]

        if not available:
            return None

        # Sort by priority
        available.sort(key=lambda x: x["priority"])
        return available[0]

    async def _failover(
        self,
        request: ChatRequest,
        failed_endpoint: str
    ) -> dict:
        """Attempt failover to another endpoint."""
        for name, endpoint in self.endpoints.items():
            if name != failed_endpoint and endpoint["healthy"]:
                try:
                    return await self._call_endpoint(endpoint, request)
                except:
                    continue

        raise HTTPException(503, "All endpoints failed")

gateway = LLMGateway()

@app.post("/api/chat")
async def chat(
    request: ChatRequest,
    token: str = Depends(security)
):
    user_id = validate_token(token)
    return await gateway.route_request(request, user_id)
```

## Pattern 2: Blue-Green Deployment

Deploy new versions alongside existing:

```python
class BlueGreenDeployer:
    """Blue-green deployment for LLM configurations."""

    def __init__(self, gateway: LLMGateway):
        self.gateway = gateway
        self.active_slot = "blue"
        self.slots = {
            "blue": {"config": None, "healthy": False},
            "green": {"config": None, "healthy": False}
        }

    async def deploy_to_inactive(self, config: dict) -> str:
        """Deploy to inactive slot."""
        inactive = "green" if self.active_slot == "blue" else "blue"

        # Configure inactive slot
        self.slots[inactive]["config"] = config
        await self._configure_slot(inactive, config)

        # Health check
        healthy = await self._health_check(inactive)
        self.slots[inactive]["healthy"] = healthy

        if not healthy:
            raise Exception(f"Deployment to {inactive} failed health check")

        return inactive

    async def switch_traffic(self) -> str:
        """Switch traffic to inactive slot."""
        inactive = "green" if self.active_slot == "blue" else "blue"

        if not self.slots[inactive]["healthy"]:
            raise Exception(f"Cannot switch to unhealthy {inactive} slot")

        # Update routing
        await self.gateway.update_routing(inactive)
        self.active_slot = inactive

        return self.active_slot

    async def rollback(self) -> str:
        """Rollback to previous slot."""
        previous = "green" if self.active_slot == "blue" else "blue"

        if not self.slots[previous]["healthy"]:
            raise Exception("Previous slot not healthy, cannot rollback")

        await self.gateway.update_routing(previous)
        self.active_slot = previous

        return self.active_slot

    async def _health_check(self, slot: str) -> bool:
        """Health check a slot."""
        config = self.slots[slot]["config"]

        try:
            # Send test request
            response = await self._test_request(config)
            return response.status == "success"
        except:
            return False
```

## Pattern 3: Canary Releases

Gradual traffic migration:

```python
import random
from dataclasses import dataclass

@dataclass
class CanaryConfig:
    stable_version: str
    canary_version: str
    canary_percent: float
    metrics_window_minutes: int = 10
    error_threshold: float = 0.05

class CanaryDeployer:
    """Canary deployment with automatic rollback."""

    def __init__(self, gateway, metrics_client):
        self.gateway = gateway
        self.metrics = metrics_client
        self.active_canary: CanaryConfig = None

    async def start_canary(
        self,
        stable: str,
        canary: str,
        initial_percent: float = 5
    ) -> CanaryConfig:
        """Start canary deployment."""
        config = CanaryConfig(
            stable_version=stable,
            canary_version=canary,
            canary_percent=initial_percent
        )

        self.active_canary = config
        await self._configure_routing(config)

        # Start monitoring
        asyncio.create_task(self._monitor_canary())

        return config

    async def increase_canary(self, new_percent: float):
        """Increase canary traffic."""
        if not self.active_canary:
            raise Exception("No active canary")

        self.active_canary.canary_percent = new_percent
        await self._configure_routing(self.active_canary)

    async def promote_canary(self):
        """Promote canary to stable."""
        if not self.active_canary:
            raise Exception("No active canary")

        self.active_canary.canary_percent = 100
        await self._configure_routing(self.active_canary)
        self.active_canary = None

    async def rollback_canary(self):
        """Rollback canary deployment."""
        if not self.active_canary:
            return

        self.active_canary.canary_percent = 0
        await self._configure_routing(self.active_canary)
        self.active_canary = None

    async def _monitor_canary(self):
        """Monitor canary health and auto-rollback if needed."""
        while self.active_canary:
            await asyncio.sleep(60)  # Check every minute

            # Get error rates
            canary_errors = await self.metrics.get_error_rate(
                self.active_canary.canary_version,
                self.active_canary.metrics_window_minutes
            )

            stable_errors = await self.metrics.get_error_rate(
                self.active_canary.stable_version,
                self.active_canary.metrics_window_minutes
            )

            # Check if canary is significantly worse
            if canary_errors > stable_errors + self.active_canary.error_threshold:
                print(f"Canary error rate {canary_errors:.2%} exceeds threshold, rolling back")
                await self.rollback_canary()
                break

    def route_request(self) -> str:
        """Route request to appropriate version."""
        if not self.active_canary:
            return "stable"

        if random.random() * 100 < self.active_canary.canary_percent:
            return self.active_canary.canary_version
        return self.active_canary.stable_version
```

## Pattern 4: A/B Testing

Compare model versions:

```python
import hashlib
from dataclasses import dataclass
from typing import Optional

@dataclass
class ABTest:
    name: str
    variant_a: dict  # Model/prompt config
    variant_b: dict
    traffic_split: float = 0.5  # Percent to variant B
    metrics: list[str] = None  # Metrics to track

class ABTestManager:
    """Manage A/B tests for LLM configurations."""

    def __init__(self, metrics_client):
        self.metrics = metrics_client
        self.active_tests: dict[str, ABTest] = {}

    def create_test(self, test: ABTest) -> str:
        """Create a new A/B test."""
        test_id = f"ab_{test.name}_{datetime.now().strftime('%Y%m%d')}"
        self.active_tests[test_id] = test
        return test_id

    def assign_variant(
        self,
        test_id: str,
        user_id: str
    ) -> str:
        """Deterministically assign user to variant."""
        test = self.active_tests.get(test_id)
        if not test:
            return "control"

        # Hash user_id for consistent assignment
        hash_val = int(hashlib.md5(f"{test_id}:{user_id}".encode()).hexdigest(), 16)
        bucket = hash_val % 100

        if bucket < test.traffic_split * 100:
            return "B"
        return "A"

    async def record_outcome(
        self,
        test_id: str,
        user_id: str,
        variant: str,
        metrics: dict
    ):
        """Record test outcome."""
        await self.metrics.record(
            test_id,
            {
                "user_id": user_id,
                "variant": variant,
                **metrics
            }
        )

    async def get_results(self, test_id: str) -> dict:
        """Get test results with statistical analysis."""
        test = self.active_tests.get(test_id)
        if not test:
            return None

        # Get metrics for each variant
        variant_a_metrics = await self.metrics.query(test_id, filter={"variant": "A"})
        variant_b_metrics = await self.metrics.query(test_id, filter={"variant": "B"})

        # Calculate statistics
        results = {
            "test_id": test_id,
            "variant_a": self._calculate_stats(variant_a_metrics),
            "variant_b": self._calculate_stats(variant_b_metrics),
            "statistical_significance": self._calculate_significance(
                variant_a_metrics,
                variant_b_metrics
            )
        }

        return results

    def _calculate_stats(self, metrics: list) -> dict:
        """Calculate statistics for a variant."""
        if not metrics:
            return {}

        # Example metrics
        return {
            "sample_size": len(metrics),
            "mean_latency": sum(m.get("latency", 0) for m in metrics) / len(metrics),
            "satisfaction_rate": sum(1 for m in metrics if m.get("satisfied")) / len(metrics)
        }
```

## Pattern 5: Shadow Deployment

Test new versions without affecting production:

```python
class ShadowDeployer:
    """Shadow deployment for safe testing."""

    def __init__(self, production_client, shadow_client):
        self.production = production_client
        self.shadow = shadow_client
        self.comparison_results = []

    async def process_with_shadow(
        self,
        request: ChatRequest
    ) -> dict:
        """Process request in production and shadow."""

        # Production request (blocking)
        prod_start = time.time()
        prod_response = await self.production.chat_completion(
            messages=request.messages,
            model=request.model
        )
        prod_latency = time.time() - prod_start

        # Shadow request (non-blocking, fire and forget)
        asyncio.create_task(
            self._shadow_request(request, prod_response, prod_latency)
        )

        return prod_response

    async def _shadow_request(
        self,
        request: ChatRequest,
        prod_response: dict,
        prod_latency: float
    ):
        """Make shadow request and compare."""
        try:
            shadow_start = time.time()
            shadow_response = await self.shadow.chat_completion(
                messages=request.messages,
                model=request.model
            )
            shadow_latency = time.time() - shadow_start

            # Compare responses
            comparison = await self._compare_responses(
                prod_response,
                shadow_response,
                prod_latency,
                shadow_latency
            )

            self.comparison_results.append(comparison)

        except Exception as e:
            # Shadow failures don't affect production
            logging.warning(f"Shadow request failed: {e}")

    async def _compare_responses(
        self,
        prod: dict,
        shadow: dict,
        prod_latency: float,
        shadow_latency: float
    ) -> dict:
        """Compare production and shadow responses."""
        return {
            "timestamp": datetime.utcnow().isoformat(),
            "prod_latency": prod_latency,
            "shadow_latency": shadow_latency,
            "latency_diff": shadow_latency - prod_latency,
            "response_match": prod.get("content") == shadow.get("content"),
            "prod_tokens": prod.get("usage", {}).get("total_tokens"),
            "shadow_tokens": shadow.get("usage", {}).get("total_tokens")
        }

    def get_comparison_report(self) -> dict:
        """Get shadow comparison report."""
        if not self.comparison_results:
            return {"message": "No comparisons yet"}

        return {
            "total_comparisons": len(self.comparison_results),
            "match_rate": sum(1 for c in self.comparison_results if c["response_match"]) / len(self.comparison_results),
            "avg_latency_diff": sum(c["latency_diff"] for c in self.comparison_results) / len(self.comparison_results),
            "shadow_faster_rate": sum(1 for c in self.comparison_results if c["latency_diff"] < 0) / len(self.comparison_results)
        }
```

These deployment patterns enable safe, controlled rollouts of LLM application changes. Start with gateway and blue-green patterns, then add canary and A/B testing as your operations mature.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
