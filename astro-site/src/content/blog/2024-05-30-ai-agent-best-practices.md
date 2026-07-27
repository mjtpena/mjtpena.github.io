---
title: "AI Agent Best Practices: Lessons from Production"
author: Michael John Peña
draft: false
date: 2024-05-30
tags:
  - AI Agents
  - Best Practices
  - Production
  - Azure AI
  - Architecture

---

I wrote "AI Agent Best Practices: Lessons from Production" to share practical, production-minded guidance on this topic.

## Design Principles

### 1. Start Simple, Add Complexity Gradually

```python
# Level 1: Simple function calling
def simple_agent(user_input: str) -> str:
    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[{"role": "user", "content": user_input}],
        tools=tools
    )
    return handle_response(response)

# Level 2: Add memory when needed
# Level 3: Add multiple tools
# Level 4: Add planning
# Level 5: Add multi-agent coordination
```

### 2. Explicit > Implicit

```python
# Bad: Implicit behavior
def process(task):
    # What does this do? Unclear
    return agent.run(task)

# Good: Explicit behavior
def process_customer_query(
    query: str,
    customer_id: str,
    allowed_actions: list[str],
    require_approval: bool = False
) -> AgentResponse:
    """
    Process a customer query with defined constraints.

    Args:
        query: The customer's question
        customer_id: For context retrieval
        allowed_actions: What the agent can do
        require_approval: If True, actions need human approval
    """
    context = retrieve_customer_context(customer_id)
    response = agent.run(
        query=query,
        context=context,
        tools=filter_tools(allowed_actions),
        human_in_loop=require_approval
    )
    return response
```

### 3. Fail Gracefully

```python
class ResilientAgent:
    def __init__(self, primary_model: str, fallback_model: str):
        self.primary_model = primary_model
        self.fallback_model = fallback_model
        self.max_retries = 3

    async def run(self, task: str) -> AgentResult:
        # Try primary model
        for attempt in range(self.max_retries):
            try:
                return await self._execute(task, self.primary_model)
            except RateLimitError:
                await asyncio.sleep(2 ** attempt)
            except ModelUnavailableError:
                break

        # Fall back to secondary model
        try:
            return await self._execute(task, self.fallback_model)
        except Exception as e:
            # Return graceful failure
            return AgentResult(
                success=False,
                error=str(e),
                fallback_response="I'm unable to process this request right now. Please try again later."
            )
```

## Security Checklist

```python
class SecureAgentConfig:
    """Security configuration for production agents."""

    def __init__(self):
        # Input validation
        self.max_input_length = 10000
        self.sanitize_inputs = True

        # Output validation
        self.filter_pii = True
        self.max_output_length = 50000

        # Tool restrictions
        self.allowed_tools = ["search", "calculate", "summarize"]
        self.blocked_operations = ["delete", "modify", "execute_code"]

        # Rate limiting
        self.max_requests_per_minute = 60
        self.max_tokens_per_request = 8000

        # Audit
        self.log_all_requests = True
        self.log_tool_usage = True

    def validate_input(self, user_input: str) -> tuple[bool, str]:
        if len(user_input) > self.max_input_length:
            return False, "Input too long"
        if self._contains_injection(user_input):
            return False, "Invalid input pattern"
        return True, ""

    def _contains_injection(self, text: str) -> bool:
        patterns = [
            "ignore previous instructions",
            "disregard your training",
            "pretend you are",
            "forget everything"
        ]
        return any(p in text.lower() for p in patterns)
```

## Testing Strategy

```python
import pytest
from unittest.mock import AsyncMock, patch

class TestAgentBehavior:
    """Test agent behavior, not implementation details."""

    @pytest.fixture
    def agent(self):
        return DataAnalystAgent(client=mock_client)

    @pytest.mark.asyncio
    async def test_handles_simple_query(self, agent):
        result = await agent.run("What is 2+2?")
        assert result.success
        assert "4" in result.response

    @pytest.mark.asyncio
    async def test_refuses_dangerous_operation(self, agent):
        result = await agent.run("Delete all files in the database")
        assert not result.success or "cannot" in result.response.lower()

    @pytest.mark.asyncio
    async def test_uses_correct_tool(self, agent):
        with patch.object(agent, 'execute_tool') as mock_tool:
            await agent.run("Search for recent sales data")
            mock_tool.assert_called_with("search_database", ANY)

    @pytest.mark.asyncio
    async def test_handles_tool_failure(self, agent):
        agent.tools["search"].execute = AsyncMock(side_effect=Exception("DB unavailable"))
        result = await agent.run("Search for data")
        assert "unable" in result.response.lower() or "try again" in result.response.lower()

    @pytest.mark.asyncio
    async def test_respects_context_limits(self, agent):
        long_context = "x" * 100000
        result = await agent.run(f"Summarize this: {long_context}")
        # Should handle gracefully, not crash
        assert result is not None
```

## Monitoring and Observability

```python
from dataclasses import dataclass
from datetime import datetime
from typing import Optional

@dataclass
class AgentMetrics:
    request_id: str
    timestamp: datetime
    user_id: str
    agent_name: str

    # Performance
    total_duration_ms: float
    llm_duration_ms: float
    tool_duration_ms: float
    tokens_used: int

    # Quality
    success: bool
    error_type: Optional[str]
    tools_used: list[str]
    retry_count: int

    # Cost
    estimated_cost_usd: float

class AgentMonitor:
    def __init__(self, exporter):
        self.exporter = exporter

    async def track_request(self, func):
        """Decorator to track agent requests."""
        async def wrapper(*args, **kwargs):
            start_time = datetime.utcnow()
            metrics = AgentMetrics(
                request_id=str(uuid.uuid4()),
                timestamp=start_time,
                user_id=kwargs.get("user_id", "unknown"),
                agent_name=kwargs.get("agent_name", "unknown"),
                total_duration_ms=0,
                llm_duration_ms=0,
                tool_duration_ms=0,
                tokens_used=0,
                success=False,
                error_type=None,
                tools_used=[],
                retry_count=0,
                estimated_cost_usd=0
            )

            try:
                result = await func(*args, **kwargs)
                metrics.success = True
                return result
            except Exception as e:
                metrics.error_type = type(e).__name__
                raise
            finally:
                metrics.total_duration_ms = (datetime.utcnow() - start_time).total_seconds() * 1000
                await self.exporter.export(metrics)

        return wrapper

    def create_dashboard_query(self) -> str:
        """KQL query for Azure Monitor dashboard."""
        return """
        customMetrics
        | where name startswith "agent."
        | summarize
            AvgDuration = avg(value),
            P95Duration = percentile(value, 95),
            SuccessRate = countif(customDimensions.success == "true") * 100.0 / count(),
            TotalRequests = count()
            by bin(timestamp, 1h), tostring(customDimensions.agent_name)
        | order by timestamp desc
        """
```

## Cost Management

```python
class CostAwareAgent:
    """Agent that tracks and manages costs."""

    PRICING = {
        "gpt-4o": {"input": 5.0, "output": 15.0},
        "gpt-4o-mini": {"input": 0.15, "output": 0.60},
        "gpt-3.5-turbo": {"input": 0.50, "output": 1.50}
    }

    def __init__(self, client, budget_limit_usd: float = 100.0):
        self.client = client
        self.budget_limit = budget_limit_usd
        self.spent_today = 0.0
        self.model_preference = ["gpt-4o-mini", "gpt-4o"]

    async def run(self, task: str, complexity: str = "auto") -> AgentResult:
        # Select model based on task and budget
        model = self._select_model(task, complexity)

        if self.spent_today >= self.budget_limit * 0.9:
            # Near budget, use cheapest model
            model = "gpt-3.5-turbo"

        response = await self._execute(task, model)

        # Track cost
        cost = self._calculate_cost(response, model)
        self.spent_today += cost

        return AgentResult(
            response=response.content,
            model_used=model,
            cost_usd=cost
        )

    def _select_model(self, task: str, complexity: str) -> str:
        if complexity == "simple":
            return "gpt-4o-mini"
        elif complexity == "complex":
            return "gpt-4o"
        else:
            # Auto-detect complexity
            if len(task) > 2000 or any(kw in task.lower() for kw in ["analyze", "compare", "evaluate"]):
                return "gpt-4o"
            return "gpt-4o-mini"

    def _calculate_cost(self, response, model: str) -> float:
        pricing = self.PRICING[model]
        input_cost = (response.usage.prompt_tokens / 1_000_000) * pricing["input"]
        output_cost = (response.usage.completion_tokens / 1_000_000) * pricing["output"]
        return input_cost + output_cost
```

## Deployment Patterns

```yaml
# Kubernetes deployment for agent service
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ai-agent-service
spec:
  replicas: 3
  selector:
    matchLabels:
      app: ai-agent
  template:
    spec:
      containers:
      - name: agent
        image: myregistry.azurecr.io/ai-agent:latest
        resources:
          requests:
            memory: "1Gi"
            cpu: "500m"
          limits:
            memory: "2Gi"
            cpu: "1000m"
        env:
        - name: AZURE_OPENAI_ENDPOINT
          valueFrom:
            secretKeyRef:
              name: ai-secrets
              key: openai-endpoint
        - name: MAX_CONCURRENT_REQUESTS
          value: "10"
        livenessProbe:
          httpGet:
            path: /health
            port: 8080
          initialDelaySeconds: 10
          periodSeconds: 30
        readinessProbe:
          httpGet:
            path: /ready
            port: 8080
          initialDelaySeconds: 5
          periodSeconds: 10\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
