---
title: "Enterprise Patterns for Azure OpenAI Applications"
author: Michael John Pena
draft: false
date: 2023-03-12
tags:
  - Azure
  - OpenAI
  - AI
  - Enterprise
  - Architecture

---

I wrote "Enterprise Patterns for Azure OpenAI Applications" to share practical, production-minded guidance on this topic.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                          API Gateway                                 │
│                    (Azure API Management)                            │
├─────────────────────────────────────────────────────────────────────┤
│  Rate Limiting │ Authentication │ Request Logging │ Circuit Breaker │
└────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
            ┌───────────┐   ┌───────────┐   ┌───────────┐
            │ AI Service │   │ AI Service │   │ AI Service │
            │ (Primary)  │   │ (Secondary)│   │ (Fallback) │
            │ East US    │   │ West US    │   │ West EU    │
            └───────────┘   └───────────┘   └───────────┘
                    │               │               │
                    └───────────────┼───────────────┘
                                    ▼
                        ┌───────────────────┐
                        │  Azure OpenAI     │
                        │  Load Balancer    │
                        └───────────────────┘
```

## Multi-Region Deployment

Deploy across regions for resilience:

```python
from dataclasses import dataclass
from typing import Optional
import openai
from tenacity import retry, stop_after_attempt, wait_exponential
import httpx

@dataclass
class OpenAIEndpoint:
    name: str
    endpoint: str
    key: str
    priority: int
    is_healthy: bool = True

class MultiRegionOpenAI:
    def __init__(self, endpoints: list[OpenAIEndpoint]):
        self.endpoints = sorted(endpoints, key=lambda x: x.priority)
        self._health_check_interval = 60

    def _get_healthy_endpoint(self) -> Optional[OpenAIEndpoint]:
        """Get the highest priority healthy endpoint."""
        for endpoint in self.endpoints:
            if endpoint.is_healthy:
                return endpoint
        return None

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10)
    )
    async def chat_completion(self, messages: list, **kwargs) -> dict:
        """Make chat completion with automatic failover."""
        endpoint = self._get_healthy_endpoint()

        if not endpoint:
            raise Exception("No healthy endpoints available")

        try:
            openai.api_type = "azure"
            openai.api_base = endpoint.endpoint
            openai.api_key = endpoint.key
            openai.api_version = "2023-03-15-preview"

            response = await openai.ChatCompletion.acreate(
                messages=messages,
                **kwargs
            )
            return response

        except Exception as e:
            # Mark endpoint as unhealthy
            endpoint.is_healthy = False
            self._schedule_health_check(endpoint)
            raise

    def _schedule_health_check(self, endpoint: OpenAIEndpoint):
        """Schedule health check for endpoint."""
        import asyncio

        async def check():
            await asyncio.sleep(self._health_check_interval)
            try:
                # Simple health check
                openai.api_base = endpoint.endpoint
                await openai.Model.alist()
                endpoint.is_healthy = True
            except:
                # Reschedule
                self._schedule_health_check(endpoint)

        asyncio.create_task(check())

# Usage
client = MultiRegionOpenAI([
    OpenAIEndpoint("east-us", "https://myai-eastus.openai.azure.com/", "key1", 1),
    OpenAIEndpoint("west-us", "https://myai-westus.openai.azure.com/", "key2", 2),
    OpenAIEndpoint("west-eu", "https://myai-westeu.openai.azure.com/", "key3", 3),
])
```

## API Management Integration

Configure Azure API Management for governance:

```xml
<!-- APIM Policy for Azure OpenAI -->
<policies>
    <inbound>
        <!-- Authentication -->
        <validate-jwt header-name="Authorization" failed-validation-httpcode="401">
            <openid-config url="https://login.microsoftonline.com/{tenant}/.well-known/openid-configuration" />
            <required-claims>
                <claim name="roles" match="any">
                    <value>AI.User</value>
                </claim>
            </required-claims>
        </validate-jwt>

        <!-- Rate Limiting per user -->
        <rate-limit-by-key
            calls="100"
            renewal-period="60"
            counter-key="@(context.Request.Headers.GetValueOrDefault("Authorization","").Split(' ').Last())" />

        <!-- Token budget enforcement -->
        <set-variable name="tokenBudget" value="@{
            var user = context.User?.Email ?? "anonymous";
            var budget = context.Variables.GetValueOrDefault<int>("budget_" + user, 10000);
            return budget;
        }" />

        <!-- Request logging -->
        <log-to-eventhub logger-id="ai-audit-logger">@{
            return new JObject(
                new JProperty("timestamp", DateTime.UtcNow.ToString("o")),
                new JProperty("user", context.User?.Email ?? "anonymous"),
                new JProperty("operation", context.Operation?.Name),
                new JProperty("requestId", context.RequestId),
                new JProperty("requestBody", context.Request.Body?.As<string>(preserveContent: true))
            ).ToString();
        }</log-to-eventhub>

        <!-- Add subscription key for backend -->
        <set-header name="api-key" exists-action="override">
            <value>{{azure-openai-key}}</value>
        </set-header>

        <set-backend-service base-url="https://myai.openai.azure.com/openai" />
    </inbound>

    <backend>
        <retry condition="@(context.Response.StatusCode == 429 || context.Response.StatusCode >= 500)"
               count="3"
               interval="2"
               max-interval="30"
               delta="1">
            <forward-request buffer-request-body="true" />
        </retry>
    </backend>

    <outbound>
        <!-- Response logging -->
        <log-to-eventhub logger-id="ai-audit-logger">@{
            return new JObject(
                new JProperty("timestamp", DateTime.UtcNow.ToString("o")),
                new JProperty("requestId", context.RequestId),
                new JProperty("statusCode", context.Response.StatusCode),
                new JProperty("tokens", context.Response.Headers.GetValueOrDefault("x-ms-tokens-used", "0"))
            ).ToString();
        }</log-to-eventhub>

        <!-- Remove internal headers -->
        <set-header name="x-ms-request-id" exists-action="delete" />
    </outbound>

    <on-error>
        <log-to-eventhub logger-id="ai-error-logger">@{
            return new JObject(
                new JProperty("timestamp", DateTime.UtcNow.ToString("o")),
                new JProperty("requestId", context.RequestId),
                new JProperty("error", context.LastError?.Message)
            ).ToString();
        }</log-to-eventhub>
    </on-error>
</policies>
```

## Comprehensive Logging and Observability

```python
import logging
from dataclasses import dataclass, field, asdict
from datetime import datetime
from typing import Optional, Any
import json
from azure.monitor.opentelemetry import configure_azure_monitor
from opentelemetry import trace

# Configure Azure Monitor
configure_azure_monitor(
    connection_string="InstrumentationKey=your-key;..."
)

tracer = trace.get_tracer(__name__)

@dataclass
class AIRequestLog:
    request_id: str
    timestamp: datetime
    user_id: str
    model: str
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    latency_ms: float
    status: str
    error: Optional[str] = None
    metadata: dict = field(default_factory=dict)

class AILogger:
    def __init__(self):
        self.logger = logging.getLogger("ai.requests")

    def log_request(self, log: AIRequestLog):
        """Log AI request to Application Insights."""
        self.logger.info(
            "AI Request",
            extra={
                "custom_dimensions": asdict(log)
            }
        )

    def log_with_trace(self, log: AIRequestLog):
        """Log with distributed tracing."""
        with tracer.start_as_current_span("ai_completion") as span:
            span.set_attribute("ai.model", log.model)
            span.set_attribute("ai.tokens.prompt", log.prompt_tokens)
            span.set_attribute("ai.tokens.completion", log.completion_tokens)
            span.set_attribute("ai.latency_ms", log.latency_ms)

            if log.error:
                span.set_attribute("ai.error", log.error)
                span.set_status(trace.StatusCode.ERROR)

class InstrumentedOpenAI:
    def __init__(self, client, logger: AILogger):
        self.client = client
        self.logger = logger

    async def chat_completion(
        self,
        messages: list,
        user_id: str,
        **kwargs
    ) -> dict:
        """Instrumented chat completion."""
        import uuid
        import time

        request_id = str(uuid.uuid4())
        start_time = time.time()

        try:
            response = await self.client.chat_completion(messages, **kwargs)

            latency_ms = (time.time() - start_time) * 1000

            log = AIRequestLog(
                request_id=request_id,
                timestamp=datetime.utcnow(),
                user_id=user_id,
                model=kwargs.get("engine", "unknown"),
                prompt_tokens=response.usage.prompt_tokens,
                completion_tokens=response.usage.completion_tokens,
                total_tokens=response.usage.total_tokens,
                latency_ms=latency_ms,
                status="success"
            )

            self.logger.log_with_trace(log)
            return response

        except Exception as e:
            latency_ms = (time.time() - start_time) * 1000

            log = AIRequestLog(
                request_id=request_id,
                timestamp=datetime.utcnow(),
                user_id=user_id,
                model=kwargs.get("engine", "unknown"),
                prompt_tokens=0,
                completion_tokens=0,
                total_tokens=0,
                latency_ms=latency_ms,
                status="error",
                error=str(e)
            )

            self.logger.log_with_trace(log)
            raise
```

## Secure Configuration Management

```python
from azure.identity import DefaultAzureCredential
from azure.keyvault.secrets import SecretClient
from dataclasses import dataclass
from functools import lru_cache
import os

@dataclass
class AIConfig:
    endpoint: str
    api_key: str
    deployment_name: str
    api_version: str = "2023-03-15-preview"

class ConfigManager:
    def __init__(self, key_vault_url: str):
        self.credential = DefaultAzureCredential()
        self.secret_client = SecretClient(
            vault_url=key_vault_url,
            credential=self.credential
        )
        self._cache = {}

    @lru_cache(maxsize=10)
    def get_ai_config(self, environment: str) -> AIConfig:
        """Get AI configuration from Key Vault."""
        endpoint = self._get_secret(f"openai-endpoint-{environment}")
        api_key = self._get_secret(f"openai-key-{environment}")
        deployment = self._get_secret(f"openai-deployment-{environment}")

        return AIConfig(
            endpoint=endpoint,
            api_key=api_key,
            deployment_name=deployment
        )

    def _get_secret(self, name: str) -> str:
        """Get secret with caching."""
        if name not in self._cache:
            secret = self.secret_client.get_secret(name)
            self._cache[name] = secret.value
        return self._cache[name]

    def rotate_credentials(self, environment: str):
        """Clear cache for credential rotation."""
        prefix = f"openai-"
        keys_to_remove = [k for k in self._cache if k.startswith(prefix)]
        for key in keys_to_remove:
            del self._cache[key]
        self.get_ai_config.cache_clear()

# Usage with environment-specific config
config_manager = ConfigManager("https://mykeyvault.vault.azure.net/")
config = config_manager.get_ai_config("production")
```

## Input/Output Validation

```python
from pydantic import BaseModel, validator, Field
from typing import Optional, List
from enum import Enum

class Role(str, Enum):
    SYSTEM = "system"
    USER = "user"
    ASSISTANT = "assistant"

class Message(BaseModel):
    role: Role
    content: str = Field(..., min_length=1, max_length=32000)

    @validator("content")
    def validate_content(cls, v):
        # Check for potential injection attempts
        dangerous_patterns = [
            "ignore previous",
            "disregard instructions",
            "you are now",
        ]
        v_lower = v.lower()
        for pattern in dangerous_patterns:
            if pattern in v_lower:
                raise ValueError(f"Potentially dangerous content detected")
        return v

class ChatRequest(BaseModel):
    messages: List[Message]
    temperature: float = Field(default=0.7, ge=0, le=2)
    max_tokens: int = Field(default=1000, ge=1, le=4096)
    user_id: str = Field(..., min_length=1)

    @validator("messages")
    def validate_messages(cls, v):
        if not v:
            raise ValueError("At least one message required")
        if len(v) > 50:
            raise ValueError("Too many messages")
        return v

class ChatResponse(BaseModel):
    content: str
    tokens_used: int
    finish_reason: str
    model: str

    @validator("content")
    def sanitize_content(cls, v):
        # Remove any sensitive patterns from output
        import re
        # Example: redact potential API keys
        v = re.sub(r"sk-[a-zA-Z0-9]{48}", "[REDACTED_KEY]", v)
        return v

# Usage in API endpoint
from fastapi import FastAPI, HTTPException

app = FastAPI()

@app.post("/api/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    try:
        # Request is automatically validated by Pydantic
        response = await ai_client.chat_completion(
            messages=[m.dict() for m in request.messages],
            temperature=request.temperature,
            max_tokens=request.max_tokens
        )

        # Response is validated before returning
        return ChatResponse(
            content=response.choices[0].message.content,
            tokens_used=response.usage.total_tokens,
            finish_reason=response.choices[0].finish_reason,
            model=response.model
        )

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
```

## Circuit Breaker Pattern

```python
from enum import Enum
from dataclasses import dataclass
from datetime import datetime, timedelta
import asyncio

class CircuitState(Enum):
    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half_open"

@dataclass
class CircuitBreakerConfig:
    failure_threshold: int = 5
    recovery_timeout: timedelta = timedelta(seconds=30)
    half_open_max_calls: int = 3

class CircuitBreaker:
    def __init__(self, config: CircuitBreakerConfig):
        self.config = config
        self.state = CircuitState.CLOSED
        self.failure_count = 0
        self.last_failure_time: datetime = None
        self.half_open_calls = 0
        self._lock = asyncio.Lock()

    async def call(self, func, *args, **kwargs):
        """Execute function with circuit breaker."""
        async with self._lock:
            if self.state == CircuitState.OPEN:
                if self._should_attempt_reset():
                    self.state = CircuitState.HALF_OPEN
                    self.half_open_calls = 0
                else:
                    raise CircuitBreakerError("Circuit is open")

            if self.state == CircuitState.HALF_OPEN:
                if self.half_open_calls >= self.config.half_open_max_calls:
                    raise CircuitBreakerError("Circuit is half-open, max calls reached")
                self.half_open_calls += 1

        try:
            result = await func(*args, **kwargs)

            async with self._lock:
                if self.state == CircuitState.HALF_OPEN:
                    self.state = CircuitState.CLOSED
                    self.failure_count = 0

            return result

        except Exception as e:
            async with self._lock:
                self.failure_count += 1
                self.last_failure_time = datetime.utcnow()

                if self.failure_count >= self.config.failure_threshold:
                    self.state = CircuitState.OPEN

            raise

    def _should_attempt_reset(self) -> bool:
        """Check if enough time has passed to try again."""
        if self.last_failure_time is None:
            return True
        return datetime.utcnow() - self.last_failure_time > self.config.recovery_timeout

class CircuitBreakerError(Exception):
    pass

# Usage
circuit_breaker = CircuitBreaker(CircuitBreakerConfig())

async def call_openai(messages):
    return await circuit_breaker.call(
        ai_client.chat_completion,
        messages
    )
```

## Summary

Enterprise Azure OpenAI deployments need:

1. **Multi-region failover** for reliability
2. **API Management** for governance and rate limiting
3. **Comprehensive logging** for auditing and debugging
4. **Secure configuration** with Key Vault
5. **Input/output validation** for security
6. **Circuit breakers** for resilience

These patterns transform AI experiments into production-ready systems. Start with the basics and layer on additional patterns as your deployment matures.

