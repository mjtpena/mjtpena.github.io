---
title: "Preparing for GPT-4: What We Know So Far"
description: "On March 13, 2023—the day before OpenAI announced GPT-4—the AI practitioner community was in an unusual state: highly confident that something significant…"
author: Michael John Pena
draft: false
date: 2023-03-13
tags:
  - OpenAI
  - AI
  - GPT-4
  - Azure
  - Machine Learning
---

On March 13, 2023—the day before OpenAI announced GPT-4—the AI practitioner community was in an unusual state: highly confident that something significant was coming (the rumours had been accumulating for months; the March 14 announcement date had leaked), uncertain about the exact technical specifications, and navigating a genuinely open question about how different GPT-4 would be from GPT-3.5. The preparation that made sense regardless of what GPT-4 delivered: prompt templates written as functions (parametrised, version-controlled, testable)—if a better model changes how prompts need to be written, templates should be easy to update without rearchitecting the application; application layers that abstract the model choice behind a configuration (changing from `gpt-35-turbo` to `gpt-4` as a configuration value, not a code change); retrieval-augmented architecture (a model's capability ceiling matters less if the application's quality ceiling is bounded by retrieval quality—improving the retrieval layer benefits both GPT-3.5 and GPT-4 applications). The GPT-4 speculation based on OpenAI's technical trajectory: a significantly larger context window (the 32K token window rumour proved accurate); improved reasoning on multi-step problems; better instruction following; multimodal input (image understanding alongside text). The one prediction I was confident about: GPT-4 on Azure would follow the same deployment model as GPT-3.5—Microsoft would make it available in Azure OpenAI before it was available to the general public via OpenAI's API.

## What We Expect

### Larger Context Windows

GPT-3.5 maxes out at 4K tokens (~3000 words). GPT-4 is rumored to support 32K tokens (~25,000 words). This changes everything for:

- **Document analysis**: Process entire reports, contracts, codebases
- **Long conversations**: Maintain context across extended sessions
- **Complex reasoning**: More room for chain-of-thought prompting

### Improved Reasoning

GPT-4 should score higher on standardized tests and reasoning benchmarks. Better at:
- Multi-step problems
- Mathematical reasoning
- Code generation and debugging
- Nuanced analysis

### Potential Multimodal Capabilities

There's speculation about image understanding. If true, this enables:
- Analyzing charts and diagrams
- Processing screenshots
- Understanding visual content

## Preparing Your Applications

### 1. Design for Longer Context

```python
class ContextManager:
    """Manage context for variable token limits."""

    def __init__(self, model_limits: dict):
        self.limits = model_limits

    def prepare_context(
        self,
        messages: list,
        model: str,
        max_response_tokens: int = 1000
    ) -> list:
        """Prepare context within model limits."""
        limit = self.limits.get(model, 4096)
        available = limit - max_response_tokens

        # Estimate tokens (rough: 4 chars per token)
        total_tokens = sum(len(m["content"]) // 4 for m in messages)

        if total_tokens <= available:
            return messages

        # Truncate from the middle, keeping system and recent messages
        system_messages = [m for m in messages if m["role"] == "system"]
        other_messages = [m for m in messages if m["role"] != "system"]

        # Keep recent messages
        truncated = system_messages + other_messages[-10:]
        return truncated

# Prepare for GPT-4 limits
context_manager = ContextManager({
    "gpt-35-turbo": 4096,
    "gpt-4": 8192,
    "gpt-4-32k": 32768,  # Expected
})
```

### 2. Build Model-Agnostic Interfaces

```python
from abc import ABC, abstractmethod
from dataclasses import dataclass

@dataclass
class CompletionResult:
    content: str
    model: str
    tokens_used: int
    finish_reason: str

class AIProvider(ABC):
    @abstractmethod
    async def complete(self, messages: list, **kwargs) -> CompletionResult:
        pass

class AzureOpenAIProvider(AIProvider):
    def __init__(self, deployments: dict):
        self.deployments = deployments  # {"gpt35": "deploy-name", "gpt4": "deploy-name"}

    async def complete(
        self,
        messages: list,
        model: str = "gpt35",
        **kwargs
    ) -> CompletionResult:
        deployment = self.deployments.get(model, self.deployments["gpt35"])

        response = await openai.ChatCompletion.acreate(
            engine=deployment,
            messages=messages,
            **kwargs
        )

        return CompletionResult(
            content=response.choices[0].message.content,
            model=model,
            tokens_used=response.usage.total_tokens,
            finish_reason=response.choices[0].finish_reason
        )

# Easy to switch models
provider = AzureOpenAIProvider({
    "gpt35": "gpt-35-turbo",
    "gpt4": "gpt-4",  # Add when available
})

# Application code doesn't change
result = await provider.complete(messages, model="gpt4")
```

### 3. Implement Model Selection Logic

```python
class ModelSelector:
    """Select appropriate model based on task requirements."""

    def __init__(self):
        self.model_capabilities = {
            "gpt-35-turbo": {
                "context": 4096,
                "cost_per_1k": 0.002,
                "speed": "fast",
                "reasoning": "moderate"
            },
            "gpt-4": {
                "context": 8192,
                "cost_per_1k": 0.03,
                "speed": "slow",
                "reasoning": "excellent"
            },
            "gpt-4-32k": {
                "context": 32768,
                "cost_per_1k": 0.06,
                "speed": "slow",
                "reasoning": "excellent"
            }
        }

    def select(
        self,
        task_type: str,
        context_length: int,
        budget_priority: bool = True
    ) -> str:
        """Select best model for task."""

        # Context-driven selection
        if context_length > 8000:
            return "gpt-4-32k"

        if context_length > 4000:
            return "gpt-4"

        # Task-driven selection
        complex_tasks = ["code_review", "analysis", "reasoning", "debugging"]
        if task_type in complex_tasks and not budget_priority:
            return "gpt-4"

        simple_tasks = ["classification", "extraction", "summarization"]
        if task_type in simple_tasks:
            return "gpt-35-turbo"

        # Default
        return "gpt-35-turbo" if budget_priority else "gpt-4"
```

### 4. Prepare for Multimodal Input

```python
from dataclasses import dataclass
from typing import Union
import base64

@dataclass
class TextContent:
    text: str

@dataclass
class ImageContent:
    url: str = None
    base64_data: str = None

    @classmethod
    def from_file(cls, path: str) -> "ImageContent":
        with open(path, "rb") as f:
            data = base64.b64encode(f.read()).decode()
        return cls(base64_data=data)

Content = Union[TextContent, ImageContent]

class MultimodalMessage:
    """Message that can contain text and images."""

    def __init__(self, role: str):
        self.role = role
        self.content: list[Content] = []

    def add_text(self, text: str) -> "MultimodalMessage":
        self.content.append(TextContent(text))
        return self

    def add_image(self, image: ImageContent) -> "MultimodalMessage":
        self.content.append(image)
        return self

    def to_api_format(self, supports_vision: bool = False) -> dict:
        """Convert to API format."""
        if not supports_vision or all(isinstance(c, TextContent) for c in self.content):
            # Text-only format
            text = " ".join(c.text for c in self.content if isinstance(c, TextContent))
            return {"role": self.role, "content": text}

        # Multimodal format (expected for GPT-4V)
        content = []
        for c in self.content:
            if isinstance(c, TextContent):
                content.append({"type": "text", "text": c.text})
            elif isinstance(c, ImageContent):
                if c.url:
                    content.append({"type": "image_url", "image_url": {"url": c.url}})
                elif c.base64_data:
                    content.append({
                        "type": "image_url",
                        "image_url": {"url": f"data:image/jpeg;base64,{c.base64_data}"}
                    })

        return {"role": self.role, "content": content}

# Usage
message = (MultimodalMessage("user")
    .add_text("What's in this architecture diagram?")
    .add_image(ImageContent.from_file("architecture.png")))

# When GPT-4V is available
api_message = message.to_api_format(supports_vision=True)
```

### 5. Set Up Cost Monitoring

```python
class CostTracker:
    """Track costs across model versions."""

    PRICING = {
        "gpt-35-turbo": {"input": 0.002, "output": 0.002},
        "gpt-4": {"input": 0.03, "output": 0.06},
        "gpt-4-32k": {"input": 0.06, "output": 0.12},
    }

    def __init__(self):
        self.usage = {}

    def record(
        self,
        model: str,
        input_tokens: int,
        output_tokens: int,
        project: str = "default"
    ):
        """Record token usage."""
        if project not in self.usage:
            self.usage[project] = {}

        if model not in self.usage[project]:
            self.usage[project][model] = {"input": 0, "output": 0}

        self.usage[project][model]["input"] += input_tokens
        self.usage[project][model]["output"] += output_tokens

    def get_cost(self, project: str = None) -> dict:
        """Calculate costs."""
        costs = {}

        projects = [project] if project else self.usage.keys()

        for p in projects:
            if p not in self.usage:
                continue

            costs[p] = {"total": 0, "by_model": {}}

            for model, tokens in self.usage[p].items():
                pricing = self.PRICING.get(model, {"input": 0.002, "output": 0.002})
                input_cost = (tokens["input"] / 1000) * pricing["input"]
                output_cost = (tokens["output"] / 1000) * pricing["output"]
                model_cost = input_cost + output_cost

                costs[p]["by_model"][model] = {
                    "input_tokens": tokens["input"],
                    "output_tokens": tokens["output"],
                    "input_cost": input_cost,
                    "output_cost": output_cost,
                    "total_cost": model_cost
                }
                costs[p]["total"] += model_cost

        return costs

    def project_monthly_cost(self, project: str, days_elapsed: int) -> float:
        """Project monthly cost based on current usage."""
        costs = self.get_cost(project)
        if project not in costs:
            return 0

        daily_avg = costs[project]["total"] / max(days_elapsed, 1)
        return daily_avg * 30
```

## Infrastructure Preparation

### Azure Resource Planning

```bash
# Request GPT-4 access (when available)
# Currently requires application through Azure portal

# Plan additional quotas
# GPT-4 will likely have separate TPM limits

# Consider dedicated capacity for high-volume scenarios
az cognitiveservices account create \
    --name my-openai-dedicated \
    --resource-group rg-ai \
    --kind OpenAI \
    --sku S0 \
    --location eastus

# Set up monitoring
az monitor diagnostic-settings create \
    --name openai-diagnostics \
    --resource /subscriptions/{sub}/resourceGroups/rg-ai/providers/Microsoft.CognitiveServices/accounts/my-openai \
    --logs '[{"category": "RequestResponse", "enabled": true}]' \
    --workspace /subscriptions/{sub}/resourceGroups/rg-ai/providers/Microsoft.OperationalInsights/workspaces/my-workspace
```

## What to Do Tomorrow

When GPT-4 drops:

1. **Review the announcement** for actual capabilities
2. **Check Azure availability** timeline
3. **Test with simple prompts** to understand differences
4. **Compare quality vs cost** for your use cases
5. **Update model selection logic** based on real performance

The AI landscape is evolving rapidly. Build flexible systems that can adopt new capabilities without major rewrites.

Stay tuned for tomorrow's deep dive once GPT-4 is officially released.
