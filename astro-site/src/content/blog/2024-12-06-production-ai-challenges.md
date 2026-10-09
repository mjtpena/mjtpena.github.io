---
title: "Production AI Challenges: What They Don't Tell You in Tutorials"
description: "Production AI is hard. These challenges require dedicated engineering effort, not just model selection. Plan for them from the start."
author: Michael John Peña
draft: false
date: 2024-12-06
tags:
  - AI
  - Production
  - Challenges
  - MLOps
  - Enterprise
---

## Challenge 1: Non-Deterministic Behavior

```python
# The problem: Same input, different outputs
results = []
for i in range(10):
    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[{"role": "user", "content": "Summarize this document..."}],
        temperature=0  # Even with temperature=0!
    )
    results.append(response.choices[0].message.content)

# Results vary slightly each time
# This breaks: caching, testing, reproducibility

# Solutions we implemented:
class DeterministicAI:
    def __init__(self):
        self.cache = SemanticCache()
        self.seed = 42

    async def get_response(self, prompt: str, strict: bool = False):
        # Check cache first
        cached = await self.cache.get(prompt)
        if cached:
            return cached

        response = await self.client.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": prompt}],
            temperature=0,
            seed=self.seed if strict else None
        )

        result = response.choices[0].message.content

        # For strict mode, validate against schema
        if strict:
            result = self.normalize_response(result)

        await self.cache.set(prompt, result)
        return result
```

## Challenge 2: Rate Limits and Quotas

```python
# Production reality: You WILL hit rate limits

class RateLimitManager:
    """Manage rate limits across multiple deployments."""

    def __init__(self):
        self.deployments = {
            "primary": {"tpm": 80000, "rpm": 500, "current_tpm": 0, "current_rpm": 0},
            "secondary": {"tpm": 80000, "rpm": 500, "current_tpm": 0, "current_rpm": 0},
            "fallback": {"tpm": 40000, "rpm": 200, "current_tpm": 0, "current_rpm": 0}
        }
        self.reset_interval = 60  # seconds

    async def get_available_deployment(self, estimated_tokens: int) -> str:
        """Get deployment with available capacity."""
        for name, limits in self.deployments.items():
            if (limits["current_tpm"] + estimated_tokens < limits["tpm"] * 0.9 and
                limits["current_rpm"] < limits["rpm"] * 0.9):
                return name

        # All deployments near limit - queue or reject
        raise RateLimitException("All deployments at capacity")

    async def execute_with_retry(self, request, max_retries: int = 3):
        """Execute with automatic failover."""
        for attempt in range(max_retries):
            try:
                deployment = await self.get_available_deployment(request.estimated_tokens)
                response = await self.clients[deployment].create(request)
                self.update_usage(deployment, response.usage)
                return response
            except RateLimitError:
                if attempt < max_retries - 1:
                    await asyncio.sleep(2 ** attempt)
                    continue
                raise

# Lesson: Plan for 3x your expected capacity
```

## Challenge 3: Cost Explosion

```python
# Real scenario: Costs grew 10x when feature went viral

class CostController:
    """Prevent runaway AI costs."""

    def __init__(self, daily_budget: float):
        self.daily_budget = daily_budget
        self.daily_spend = 0
        self.alert_threshold = 0.8

    async def check_budget(self, estimated_cost: float) -> bool:
        if self.daily_spend + estimated_cost > self.daily_budget:
            await self.alert_budget_exceeded()
            return False

        if self.daily_spend > self.daily_budget * self.alert_threshold:
            await self.alert_approaching_limit()

        return True

    async def execute_with_budget(self, request) -> dict:
        estimated_cost = self.estimate_cost(request)

        if not await self.check_budget(estimated_cost):
            # Degrade gracefully
            return await self.fallback_response(request)

        response = await self.execute(request)
        actual_cost = self.calculate_actual_cost(response)
        self.daily_spend += actual_cost

        return response

    def estimate_cost(self, request) -> float:
        # Estimate based on input tokens + expected output
        input_tokens = len(request.content) / 4  # rough estimate
        expected_output = 500  # average
        return (input_tokens * 0.000005) + (expected_output * 0.000015)

# Implement: Daily budgets, alerts, graceful degradation
```

## Challenge 4: Latency Variability

```python
# Production observation: Latency varies 3x throughout the day

latency_patterns = {
    "morning_us": {"p50": 800, "p95": 1500, "p99": 3000},
    "business_hours_us": {"p50": 1200, "p95": 2500, "p99": 5000},
    "peak_global": {"p50": 1500, "p95": 4000, "p99": 8000},
    "off_peak": {"p50": 600, "p95": 1000, "p99": 1500}
}

class LatencyAwareRouter:
    """Route requests based on latency requirements."""

    async def route_request(self, request, max_latency_ms: int):
        # Check current latency estimates
        latencies = await self.get_current_latencies()

        for deployment, latency in sorted(latencies.items(), key=lambda x: x[1]):
            if latency["p95"] < max_latency_ms:
                return deployment

        # No deployment meets latency requirement
        if request.can_degrade:
            # Use faster, smaller model
            return "gpt-4o-mini"

        raise LatencyRequirementException(
            f"No deployment can meet {max_latency_ms}ms requirement"
        )

    async def get_current_latencies(self) -> dict:
        # Real-time latency monitoring
        return {
            "eastus": {"p50": 900, "p95": 1800},
            "westus": {"p50": 1100, "p95": 2200},
            "westeurope": {"p50": 1000, "p95": 2000}
        }
```

## Challenge 5: Context Window Management

```python
# Problem: Users send more context than expected

class ContextManager:
    """Manage context window effectively."""

    MAX_CONTEXT = 128000  # tokens
    RESERVED_FOR_OUTPUT = 4000

    async def prepare_context(self, messages: list, max_output: int = 2000) -> list:
        available = self.MAX_CONTEXT - self.RESERVED_FOR_OUTPUT - max_output

        total_tokens = self.count_tokens(messages)

        if total_tokens <= available:
            return messages

        # Need to truncate
        return await self.smart_truncate(messages, available)

    async def smart_truncate(self, messages: list, max_tokens: int) -> list:
        # Strategy 1: Keep system message and recent messages
        system_msg = messages[0] if messages[0]["role"] == "system" else None
        user_messages = [m for m in messages if m["role"] == "user"]

        # Strategy 2: Summarize old context
        if len(user_messages) > 5:
            old_context = user_messages[:-3]
            summary = await self.summarize(old_context)
            recent = user_messages[-3:]

            return [
                system_msg,
                {"role": "system", "content": f"Previous context summary: {summary}"},
                *recent
            ]

        # Strategy 3: Truncate individual messages
        return self.truncate_messages(messages, max_tokens)

# Lesson: Always plan for context overflow
```

## Challenge 6: Output Validation

```python
# Problem: AI outputs aren't always valid

class OutputValidator:
    """Validate AI outputs before using them."""

    async def validate_and_fix(self, response: str, expected_schema: dict) -> dict:
        # Attempt 1: Parse as-is
        try:
            parsed = json.loads(response)
            if self.matches_schema(parsed, expected_schema):
                return {"success": True, "data": parsed}
        except json.JSONDecodeError:
            pass

        # Attempt 2: Fix common JSON issues
        fixed = self.fix_common_json_issues(response)
        try:
            parsed = json.loads(fixed)
            if self.matches_schema(parsed, expected_schema):
                return {"success": True, "data": parsed, "fixed": True}
        except:
            pass

        # Attempt 3: Extract JSON from markdown
        extracted = self.extract_json_from_markdown(response)
        if extracted:
            try:
                parsed = json.loads(extracted)
                if self.matches_schema(parsed, expected_schema):
                    return {"success": True, "data": parsed, "extracted": True}
            except:
                pass

        # Attempt 4: Ask AI to fix it
        fixed_response = await self.ask_ai_to_fix(response, expected_schema)
        try:
            parsed = json.loads(fixed_response)
            return {"success": True, "data": parsed, "ai_fixed": True}
        except:
            pass

        return {"success": False, "error": "Could not parse response"}

    def fix_common_json_issues(self, text: str) -> str:
        # Remove markdown code blocks
        text = re.sub(r'```json\n?', '', text)
        text = re.sub(r'```\n?', '', text)
        # Fix trailing commas
        text = re.sub(r',\s*}', '}', text)
        text = re.sub(r',\s*]', ']', text)
        return text
```

## Challenge 7: Dependency on External Services

```python
# Reality: AI services go down

class ResilientAIClient:
    """Handle AI service outages gracefully."""

    def __init__(self):
        self.circuit_breaker = CircuitBreaker(
            failure_threshold=5,
            recovery_timeout=60
        )
        self.fallback_responses = FallbackCache()

    async def execute(self, request):
        if self.circuit_breaker.is_open:
            return await self.handle_outage(request)

        try:
            response = await self._execute_with_timeout(request)
            self.circuit_breaker.record_success()
            return response

        except (TimeoutError, ServiceUnavailableError) as e:
            self.circuit_breaker.record_failure()

            if self.circuit_breaker.is_open:
                await self.alert_outage()

            return await self.handle_outage(request)

    async def handle_outage(self, request):
        # Option 1: Return cached response
        cached = await self.fallback_responses.get_similar(request)
        if cached:
            return {"response": cached, "source": "cache"}

        # Option 2: Use fallback model/service
        if self.fallback_available:
            return await self.fallback_client.execute(request)

        # Option 3: Graceful degradation message
        return {
            "response": "I'm temporarily unable to process this request. Please try again in a few minutes.",
            "source": "fallback"
        }
```

## Challenge 8: Security and Abuse

```python
# Real attacks we've seen in production

security_incidents = [
    "Prompt injection to bypass content filters",
    "Automated scraping to extract training data",
    "Denial of service via expensive queries",
    "Attempts to generate harmful content",
    "Data exfiltration attempts"
]

class SecurityLayer:
    """Security measures for production AI."""

    async def process_secure(self, request, user_context):
        # 1. Authentication & Authorization
        if not self.is_authorized(user_context):
            return self.unauthorized_response()

        # 2. Input validation
        validation = await self.validate_input(request)
        if not validation.safe:
            await self.log_security_event(request, validation)
            return self.blocked_response(validation.reason)

        # 3. Rate limiting per user
        if not self.check_user_rate_limit(user_context):
            return self.rate_limited_response()

        # 4. Execute with monitoring
        response = await self.execute_monitored(request, user_context)

        # 5. Output filtering
        filtered = await self.filter_output(response)

        # 6. Audit logging
        await self.audit_log(request, response, user_context)

        return filtered
```

Production AI is hard. These challenges require dedicated engineering effort, not just model selection. Plan for them from the start.

## Resources

- [OpenAI Production Best Practices](https://platform.openai.com/docs/guides/production-best-practices)
- [Azure AI Security](https://learn.microsoft.com/en-us/azure/ai-services/security-features)
- [AI Incident Database](https://incidentdatabase.ai/)
