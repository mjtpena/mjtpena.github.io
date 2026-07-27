---
title: "LLM Observability Tools: Comparing the Landscape"
author: "Michael John Peña"
draft: false
date: 2024-10-14
tags: ["LLM Observability", "Monitoring", "AI Tools", "Comparison", "Production"]

---

I wrote "LLM Observability Tools: Comparing the Landscape" to share practical, production-minded guidance on this topic.

## Tool Categories

```python
from dataclasses import dataclass
from typing import List, Dict
from enum import Enum

class ObservabilityCategory(Enum):
    TRACING = "tracing"
    EVALUATION = "evaluation"
    MONITORING = "monitoring"
    DEBUGGING = "debugging"
    ANALYTICS = "analytics"

@dataclass
class ObservabilityTool:
    name: str
    categories: List[ObservabilityCategory]
    pricing: str  # "free", "freemium", "paid"
    self_hosted: bool
    cloud_hosted: bool
    key_features: List[str]
    integrations: List[str]
    best_for: str

TOOLS = [
    ObservabilityTool(
        name="LangSmith",
        categories=[ObservabilityCategory.TRACING, ObservabilityCategory.DEBUGGING, ObservabilityCategory.EVALUATION],
        pricing="freemium",
        self_hosted=False,
        cloud_hosted=True,
        key_features=[
            "LangChain native integration",
            "Prompt playground",
            "Dataset management",
            "Automated testing"
        ],
        integrations=["LangChain", "LangGraph", "OpenAI", "Anthropic"],
        best_for="LangChain-based applications"
    ),
    ObservabilityTool(
        name="Weights & Biases",
        categories=[ObservabilityCategory.MONITORING, ObservabilityCategory.ANALYTICS, ObservabilityCategory.EVALUATION],
        pricing="freemium",
        self_hosted=True,
        cloud_hosted=True,
        key_features=[
            "Experiment tracking",
            "Model versioning",
            "Prompt management",
            "Team collaboration"
        ],
        integrations=["OpenAI", "Anthropic", "HuggingFace", "LangChain"],
        best_for="ML teams with existing W&B usage"
    ),
    ObservabilityTool(
        name="Phoenix (Arize)",
        categories=[ObservabilityCategory.TRACING, ObservabilityCategory.DEBUGGING],
        pricing="free",
        self_hosted=True,
        cloud_hosted=False,
        key_features=[
            "Local-first development",
            "OpenTelemetry compatible",
            "Embedding visualization",
            "No data leaves your system"
        ],
        integrations=["OpenAI", "LangChain", "LlamaIndex", "OpenTelemetry"],
        best_for="Privacy-conscious teams"
    ),
    ObservabilityTool(
        name="Arize AI",
        categories=[ObservabilityCategory.MONITORING, ObservabilityCategory.EVALUATION, ObservabilityCategory.ANALYTICS],
        pricing="paid",
        self_hosted=False,
        cloud_hosted=True,
        key_features=[
            "Production monitoring",
            "Drift detection",
            "Performance analytics",
            "Alerting"
        ],
        integrations=["OpenAI", "Anthropic", "AWS Bedrock", "Azure OpenAI"],
        best_for="Production ML monitoring"
    ),
    ObservabilityTool(
        name="Helicone",
        categories=[ObservabilityCategory.MONITORING, ObservabilityCategory.ANALYTICS],
        pricing="freemium",
        self_hosted=True,
        cloud_hosted=True,
        key_features=[
            "Proxy-based (no code changes)",
            "Cost tracking",
            "Rate limiting",
            "Caching"
        ],
        integrations=["OpenAI", "Anthropic", "Azure OpenAI", "Any LLM API"],
        best_for="Quick setup, cost management"
    )
]

def recommend_tool(requirements: Dict) -> List[ObservabilityTool]:
    """Recommend tools based on requirements"""
    recommendations = []

    for tool in TOOLS:
        score = 0

        # Check categories
        if requirements.get("categories"):
            matching = set(tool.categories) & set(requirements["categories"])
            score += len(matching) * 2

        # Check pricing
        if requirements.get("free_only") and tool.pricing == "free":
            score += 3
        elif requirements.get("budget_friendly") and tool.pricing in ["free", "freemium"]:
            score += 2

        # Check hosting
        if requirements.get("self_hosted") and tool.self_hosted:
            score += 2
        if requirements.get("cloud_hosted") and tool.cloud_hosted:
            score += 1

        # Check integrations
        if requirements.get("integrations"):
            matching = set(tool.integrations) & set(requirements["integrations"])
            score += len(matching)

        if score > 0:
            recommendations.append((tool, score))

    return [t[0] for t in sorted(recommendations, key=lambda x: x[1], reverse=True)]
```

## Integration Examples

### LangSmith Integration

```python
# pip install langsmith langchain

from langchain.callbacks import LangSmithCallbackHandler
from langchain_openai import ChatOpenAI

# Set environment variables
# LANGCHAIN_TRACING_V2=true
# LANGCHAIN_API_KEY=your_key
# LANGCHAIN_PROJECT=my-project

llm = ChatOpenAI(
    model="gpt-4o",
    callbacks=[LangSmithCallbackHandler()]
)

# All calls are automatically traced
response = llm.invoke("Hello, world!")
```

### Weights & Biases Integration

```python
# pip install wandb weave

import wandb
import weave

# Initialize W&B
wandb.init(project="llm-app")

# Use Weave for LLM tracing
@weave.op()
def call_llm(prompt: str) -> str:
    from openai import OpenAI
    client = OpenAI()

    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[{"role": "user", "content": prompt}]
    )

    return response.choices[0].message.content

# Calls are tracked in W&B
result = call_llm("What is machine learning?")
```

### Phoenix/Arize Integration

```python
# pip install arize-phoenix openinference-instrumentation-openai

import phoenix as px
from openinference.instrumentation.openai import OpenAIInstrumentor
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider

# Start Phoenix
session = px.launch_app()

# Set up OpenTelemetry
tracer_provider = TracerProvider()
trace.set_tracer_provider(tracer_provider)

# Instrument OpenAI
OpenAIInstrumentor().instrument(tracer_provider=tracer_provider)

# Now all OpenAI calls are traced
from openai import OpenAI
client = OpenAI()

response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Hello!"}]
)

# View traces at http://localhost:6006
```

### Helicone Integration

```python
from openai import OpenAI

# Simply change the base URL and add a header
client = OpenAI(
    base_url="https://oai.helicone.ai/v1",
    default_headers={
        "Helicone-Auth": f"Bearer {HELICONE_API_KEY}"
    }
)

# All calls are now logged through Helicone
response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Hello!"}]
)
```

## Building Your Own Observability

```python
class LightweightLLMObserver:
    """Simple observability for small teams"""

    def __init__(self, storage_path: str = "./llm_logs"):
        self.storage_path = storage_path
        os.makedirs(storage_path, exist_ok=True)

    def log_call(self, model: str, messages: List[Dict],
                response: str, usage: Dict, latency_ms: float):
        """Log an LLM call"""
        import json
        from datetime import datetime

        entry = {
            "timestamp": datetime.utcnow().isoformat(),
            "model": model,
            "messages": messages,
            "response": response,
            "usage": usage,
            "latency_ms": latency_ms,
            "cost_usd": self._calculate_cost(model, usage)
        }

        # Append to daily log file
        date_str = datetime.utcnow().strftime("%Y-%m-%d")
        log_file = f"{self.storage_path}/calls_{date_str}.jsonl"

        with open(log_file, "a") as f:
            f.write(json.dumps(entry) + "\n")

    def get_daily_summary(self, date_str: str = None) -> Dict:
        """Get summary for a day"""
        import json
        from datetime import datetime

        date_str = date_str or datetime.utcnow().strftime("%Y-%m-%d")
        log_file = f"{self.storage_path}/calls_{date_str}.jsonl"

        if not os.path.exists(log_file):
            return {"error": "No logs for this date"}

        entries = []
        with open(log_file, "r") as f:
            for line in f:
                entries.append(json.loads(line.strip()))

        return {
            "date": date_str,
            "total_calls": len(entries),
            "total_tokens": sum(e["usage"].get("total_tokens", 0) for e in entries),
            "total_cost_usd": sum(e.get("cost_usd", 0) for e in entries),
            "avg_latency_ms": sum(e["latency_ms"] for e in entries) / len(entries) if entries else 0,
            "by_model": self._group_by_model(entries)
        }

    def _calculate_cost(self, model: str, usage: Dict) -> float:
        pricing = {
            "gpt-4o": (2.50, 10.00),
            "gpt-4o-mini": (0.15, 0.60),
        }
        input_rate, output_rate = pricing.get(model, (2.50, 10.00))
        input_tokens = usage.get("prompt_tokens", 0)
        output_tokens = usage.get("completion_tokens", 0)
        return (input_tokens * input_rate + output_tokens * output_rate) / 1_000_000

    def _group_by_model(self, entries: List[Dict]) -> Dict:
        by_model = {}
        for e in entries:
            model = e["model"]
            if model not in by_model:
                by_model[model] = {"calls": 0, "tokens": 0, "cost": 0}
            by_model[model]["calls"] += 1
            by_model[model]["tokens"] += e["usage"].get("total_tokens", 0)
            by_model[model]["cost"] += e.get("cost_usd", 0)
        return by_model
```

Choose your observability tools based on your team size, budget, privacy requirements, and existing tooling. Start simple and add more sophisticated tools as your needs grow.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
