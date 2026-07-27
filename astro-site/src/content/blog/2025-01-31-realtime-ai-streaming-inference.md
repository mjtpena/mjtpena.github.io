---
title: "Real-Time AI: Streaming Inference for Live Data Applications"
author: Michael John Peña
draft: false
date: 2025-01-31
tags:
  - AI
  - Real-Time
  - Streaming
  - Azure
  - Event-Driven

---

I wrote "Real-Time AI: Streaming Inference for Live Data Applications" to share practical, production-minded guidance on this topic.

## Real-Time AI Architecture

```
Event Source          Processing              AI Inference           Action
    │                     │                       │                    │
    ▼                     ▼                       ▼                    ▼
┌────────┐         ┌───────────┐           ┌───────────┐        ┌──────────┐
│ Event  │────────►│ Stream    │──────────►│ AI Model  │───────►│ Response │
│ Hubs   │         │ Processing│           │ Endpoint  │        │ Action   │
└────────┘         └───────────┘           └───────────┘        └──────────┘
                         │                       │
                         ▼                       ▼
                   ┌───────────┐           ┌───────────┐
                   │ Feature   │           │ Context   │
                   │ Store     │           │ (RAG)     │
                   └───────────┘           └───────────┘
```

## Streaming with Azure Functions

```python
import azure.functions as func
from azure.ai.foundry import AIFoundryClient
from azure.identity import DefaultAzureCredential
import json

app = func.FunctionApp()

# Initialize AI client outside handler for connection reuse
ai_client = AIFoundryClient(
    project="realtime-ai",
    credential=DefaultAzureCredential()
)

@app.event_hub_message_trigger(
    arg_name="events",
    event_hub_name="transactions",
    connection="EventHubConnection"
)
async def process_transactions(events: func.EventHubEvent):
    """Process transactions in real-time with AI."""

    for event in events:
        transaction = json.loads(event.get_body().decode())

        # Fast classification using smaller model
        classification = await classify_transaction(transaction)

        if classification["risk_score"] > 0.8:
            # High risk - detailed analysis
            analysis = await analyze_high_risk(transaction)
            await send_alert(analysis)

        # Store result
        await store_result(transaction["id"], classification)

async def classify_transaction(transaction: dict) -> dict:
    """Quick classification for risk scoring."""

    response = await ai_client.chat.complete_async(
        deployment="gpt-4o-mini",  # Fast model for real-time
        messages=[{
            "role": "system",
            "content": "Classify transaction risk. Return JSON: {risk_score: 0-1, reason: string}"
        }, {
            "role": "user",
            "content": json.dumps(transaction)
        }],
        max_tokens=100
    )

    return json.loads(response.choices[0].message.content)

async def analyze_high_risk(transaction: dict) -> dict:
    """Detailed analysis for high-risk transactions."""

    # Get customer history for context
    history = await get_customer_history(transaction["customer_id"])

    response = await ai_client.chat.complete_async(
        deployment="gpt-4o",  # Full model for detailed analysis
        messages=[{
            "role": "system",
            "content": """Analyze this potentially fraudulent transaction.
            Consider customer history and transaction patterns.
            Provide detailed risk assessment and recommended actions."""
        }, {
            "role": "user",
            "content": f"""
            Transaction: {json.dumps(transaction)}
            Customer History: {json.dumps(history)}
            """
        }]
    )

    return {
        "transaction_id": transaction["id"],
        "analysis": response.choices[0].message.content,
        "timestamp": datetime.utcnow().isoformat()
    }
```

## Real-Time Anomaly Detection

```python
from collections import deque
import numpy as np

class StreamingAnomalyDetector:
    def __init__(self, ai_client, window_size: int = 100):
        self.ai_client = ai_client
        self.window_size = window_size
        self.data_windows = {}  # Per-metric windows

    async def process_metric(self, metric_name: str, value: float, metadata: dict) -> dict:
        """Process incoming metric and detect anomalies."""

        # Update window
        if metric_name not in self.data_windows:
            self.data_windows[metric_name] = deque(maxlen=self.window_size)

        window = self.data_windows[metric_name]
        window.append(value)

        # Statistical anomaly detection (fast)
        if len(window) >= 10:
            mean = np.mean(window)
            std = np.std(window)
            z_score = (value - mean) / (std + 0.0001)

            if abs(z_score) > 3:  # Statistical anomaly
                # AI-powered analysis
                analysis = await self._analyze_anomaly(
                    metric_name, value, list(window), metadata
                )
                return {
                    "anomaly": True,
                    "metric": metric_name,
                    "value": value,
                    "z_score": z_score,
                    "analysis": analysis
                }

        return {"anomaly": False, "metric": metric_name, "value": value}

    async def _analyze_anomaly(
        self,
        metric_name: str,
        value: float,
        history: list,
        metadata: dict
    ) -> dict:
        """AI analysis of detected anomaly."""

        response = await self.ai_client.chat.complete_async(
            deployment="gpt-4o-mini",
            messages=[{
                "role": "user",
                "content": f"""Analyze this metric anomaly:

                Metric: {metric_name}
                Current Value: {value}
                Recent History: {history[-20:]}
                Metadata: {json.dumps(metadata)}

                Determine:
                1. Is this a real anomaly or noise?
                2. Possible causes
                3. Recommended action
                4. Severity (critical/high/medium/low)

                Return as JSON."""
            }],
            max_tokens=200
        )

        return json.loads(response.choices[0].message.content)
```

## Streaming RAG for Live Context

```python
class StreamingRAG:
    def __init__(self, ai_client, vector_store, cache):
        self.ai_client = ai_client
        self.vector_store = vector_store
        self.cache = cache  # Redis or similar

    async def process_query_stream(
        self,
        query: str,
        context_stream: AsyncIterator[dict]
    ) -> AsyncIterator[str]:
        """Process query with streaming context and response."""

        # Retrieve static context
        static_context = await self.vector_store.search(query, top_k=3)

        # Start response generation
        messages = [{
            "role": "system",
            "content": f"""Answer based on context. Context:
            {self._format_context(static_context)}"""
        }, {
            "role": "user",
            "content": query
        }]

        # Stream response
        async with self.ai_client.chat.stream_async(
            deployment="gpt-4o",
            messages=messages
        ) as stream:
            async for chunk in stream:
                if chunk.choices[0].delta.content:
                    yield chunk.choices[0].delta.content

                # Optionally incorporate streaming context
                async for context_update in context_stream:
                    # Inject new context mid-stream if needed
                    pass

    async def realtime_qa(self, query: str, live_data: dict) -> AsyncIterator[str]:
        """Q&A with real-time data context."""

        # Check cache first
        cache_key = self._cache_key(query, live_data)
        cached = await self.cache.get(cache_key)
        if cached:
            yield cached
            return

        # Generate with live context
        response_parts = []

        async for part in self._generate_response(query, live_data):
            response_parts.append(part)
            yield part

        # Cache the full response
        full_response = "".join(response_parts)
        await self.cache.set(cache_key, full_response, ttl=60)  # 1 minute cache
```

## Real-Time Dashboard AI

```python
from fastapi import FastAPI, WebSocket
import asyncio

app = FastAPI()

class DashboardAI:
    def __init__(self, ai_client, data_service):
        self.ai_client = ai_client
        self.data_service = data_service

    async def generate_insight_stream(
        self,
        dashboard_id: str
    ) -> AsyncIterator[dict]:
        """Generate real-time insights for a dashboard."""

        while True:
            # Get current dashboard data
            data = await self.data_service.get_dashboard_data(dashboard_id)

            # Generate insight
            insight = await self._generate_insight(data)

            yield {
                "type": "insight",
                "content": insight,
                "timestamp": datetime.utcnow().isoformat()
            }

            await asyncio.sleep(30)  # Generate new insight every 30 seconds

    async def _generate_insight(self, data: dict) -> str:
        """Generate a single insight from dashboard data."""

        response = await self.ai_client.chat.complete_async(
            deployment="gpt-4o-mini",
            messages=[{
                "role": "user",
                "content": f"""Based on this dashboard data, provide ONE actionable insight.
                Be specific and concise (1-2 sentences).

                Data: {json.dumps(data)}"""
            }],
            max_tokens=100
        )

        return response.choices[0].message.content

@app.websocket("/ws/dashboard/{dashboard_id}")
async def dashboard_websocket(websocket: WebSocket, dashboard_id: str):
    """WebSocket endpoint for real-time dashboard insights."""

    await websocket.accept()

    dashboard_ai = DashboardAI(ai_client, data_service)

    try:
        async for insight in dashboard_ai.generate_insight_stream(dashboard_id):
            await websocket.send_json(insight)
    except Exception as e:
        await websocket.close(code=1000)
```

## Optimizing for Latency

```python
class LatencyOptimizedAI:
    def __init__(self, ai_client):
        self.ai_client = ai_client
        self.model_router = ModelRouter()

    async def infer(self, request: dict, max_latency_ms: int = 500) -> dict:
        """Route to appropriate model based on latency requirements."""

        # Select model based on latency budget
        model = self.model_router.select_model(
            task_complexity=request.get("complexity", "medium"),
            max_latency_ms=max_latency_ms
        )

        # Set timeout
        timeout = max_latency_ms / 1000

        try:
            response = await asyncio.wait_for(
                self._call_model(model, request),
                timeout=timeout
            )
            return response
        except asyncio.TimeoutError:
            # Fallback to faster model
            fallback_model = self.model_router.get_fallback(model)
            return await self._call_model(fallback_model, request)

class ModelRouter:
    """Route requests to appropriate models based on requirements."""

    MODELS = {
        "fast": {"name": "gpt-4o-mini", "avg_latency_ms": 200},
        "balanced": {"name": "gpt-4o", "avg_latency_ms": 500},
        "powerful": {"name": "gpt-4o", "avg_latency_ms": 1000, "reasoning": True}
    }

    def select_model(self, task_complexity: str, max_latency_ms: int) -> str:
        if max_latency_ms < 300 or task_complexity == "simple":
            return "fast"
        elif max_latency_ms < 700 or task_complexity == "medium":
            return "balanced"
        else:
            return "powerful"

    def get_fallback(self, model: str) -> str:
        fallbacks = {"powerful": "balanced", "balanced": "fast", "fast": "fast"}
        return fallbacks.get(model, "fast")
```

## Best Practices

1. **Use appropriate models**: Smaller models for real-time, larger for batch
2. **Implement timeouts**: Always have fallback for slow responses
3. **Cache aggressively**: Cache frequent queries and context
4. **Pre-compute features**: Prepare data before inference
5. **Monitor latency**: Track P99 latency and optimize bottlenecks
6. **Scale horizontally**: Use multiple model endpoints for throughput

Real-time AI requires careful architecture to balance latency, cost, and quality. Start with simple use cases and optimize based on actual performance data.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
