---
title: "Azure AI Studio: Building Enterprise AI Applications"
author: "Michael John Peña"
draft: false
date: 2023-11-18
tags: ["Azure", "AI Studio", "Machine Learning", "LLM", "Enterprise AI"]

---

I wrote "Azure AI Studio: Building Enterprise AI Applications" to share practical, production-minded guidance on this topic.

Azure AI Studio arrived at Ignite 2023 as a significantly expanded platform — and "expanded" is the right word, because it builds on Azure ML Studio's foundations but is oriented specifically toward generative AI application development rather than traditional ML model training and deployment. The key additions: a model catalog spanning Azure OpenAI models, open-source models (Llama 2, Mistral), and partner models (Stability AI, Cohere) in a single browsable catalog; Prompt Flow as a first-class feature for building, evaluating, and deploying LLM pipelines; and integrated evaluation tooling for testing AI application quality with configurable metrics. The design philosophy: Azure AI Studio is for the AI application developer building on top of foundation models, while Azure ML Studio remains the platform for teams doing custom model training and MLOps. In practice, the workflows overlap and Microsoft will likely continue merging them.

## Azure AI Studio Overview

```python
from dataclasses import dataclass
from typing import List, Dict, Optional
from enum import Enum

class AIStudioCapability(Enum):
    MODEL_CATALOG = "Browse and deploy foundation models"
    PROMPT_FLOW = "Build and test prompt pipelines"
    FINE_TUNING = "Customize models with your data"
    EVALUATION = "Test and compare model performance"
    DEPLOYMENT = "Deploy models as endpoints"
    MONITORING = "Track model performance in production"

@dataclass
class AIStudioProject:
    name: str
    resource_group: str
    ai_hub: str
    connected_services: List[str]
    models_deployed: List[str]

# Example project configuration
project = AIStudioProject(
    name="customer-service-ai",
    resource_group="ai-projects-rg",
    ai_hub="company-ai-hub",
    connected_services=[
        "Azure OpenAI",
        "Azure AI Search",
        "Azure Blob Storage",
        "Azure Key Vault"
    ],
    models_deployed=[
        "gpt-4-turbo",
        "text-embedding-ada-002"
    ]
)
```

## Model Catalog Integration

```python
from azure.ai.ml import MLClient
from azure.identity import DefaultAzureCredential

class ModelCatalogClient:
    def __init__(self, subscription_id: str, resource_group: str, workspace: str):
        self.client = MLClient(
            DefaultAzureCredential(),
            subscription_id,
            resource_group,
            workspace
        )

    def list_available_models(self, category: str = None) -> List[dict]:
        """List models from the Azure AI model catalog."""
        # Categories: OpenAI, Meta, Mistral, Microsoft, etc.
        models = []

        catalog_models = [
            {
                "name": "gpt-4-turbo",
                "provider": "OpenAI",
                "category": "chat-completion",
                "context_window": 128000,
                "capabilities": ["chat", "function-calling", "vision"]
            },
            {
                "name": "gpt-4",
                "provider": "OpenAI",
                "category": "chat-completion",
                "context_window": 8192,
                "capabilities": ["chat", "function-calling"]
            },
            {
                "name": "Llama-2-70b-chat",
                "provider": "Meta",
                "category": "chat-completion",
                "context_window": 4096,
                "capabilities": ["chat"]
            },
            {
                "name": "Mistral-7B-Instruct",
                "provider": "Mistral AI",
                "category": "chat-completion",
                "context_window": 8192,
                "capabilities": ["chat", "instruct"]
            },
            {
                "name": "text-embedding-ada-002",
                "provider": "OpenAI",
                "category": "embedding",
                "dimensions": 1536,
                "capabilities": ["embedding"]
            }
        ]

        if category:
            return [m for m in catalog_models if m["category"] == category]
        return catalog_models

    def deploy_model(self, model_name: str, deployment_name: str, sku: str = "Standard") -> dict:
        """Deploy a model from the catalog."""
        # In production, use actual Azure AI SDK
        deployment = {
            "model": model_name,
            "deployment_name": deployment_name,
            "sku": sku,
            "status": "Deploying",
            "endpoint": f"https://your-resource.openai.azure.com/openai/deployments/{deployment_name}"
        }
        return deployment

# Usage
catalog = ModelCatalogClient("subscription-id", "rg", "workspace")
chat_models = catalog.list_available_models("chat-completion")
for model in chat_models:
    print(f"{model['name']} by {model['provider']} - {model['context_window']} tokens")
```

## Prompt Flow Development

```python
from typing import Callable, Any
import json

class PromptFlowNode:
    def __init__(self, name: str, node_type: str, config: dict):
        self.name = name
        self.node_type = node_type
        self.config = config
        self.inputs = {}
        self.outputs = {}

class PromptFlow:
    def __init__(self, name: str):
        self.name = name
        self.nodes: Dict[str, PromptFlowNode] = {}
        self.connections: List[tuple] = []

    def add_node(self, node: PromptFlowNode):
        self.nodes[node.name] = node

    def connect(self, source_node: str, source_output: str,
                target_node: str, target_input: str):
        self.connections.append((source_node, source_output, target_node, target_input))

    def to_yaml(self) -> str:
        """Export flow as YAML for AI Studio."""
        flow_def = {
            "name": self.name,
            "nodes": [],
            "connections": []
        }

        for name, node in self.nodes.items():
            flow_def["nodes"].append({
                "name": name,
                "type": node.node_type,
                "config": node.config
            })

        for conn in self.connections:
            flow_def["connections"].append({
                "source": {"node": conn[0], "output": conn[1]},
                "target": {"node": conn[2], "input": conn[3]}
            })

        import yaml
        return yaml.dump(flow_def, default_flow_style=False)

# Build a RAG prompt flow
rag_flow = PromptFlow("customer-support-rag")

# Input node
rag_flow.add_node(PromptFlowNode(
    name="input",
    node_type="input",
    config={"schema": {"question": "string", "conversation_id": "string"}}
))

# Embedding node
rag_flow.add_node(PromptFlowNode(
    name="embed_query",
    node_type="embedding",
    config={
        "model": "text-embedding-ada-002",
        "deployment": "embeddings"
    }
))

# Vector search node
rag_flow.add_node(PromptFlowNode(
    name="search_knowledge",
    node_type="azure_ai_search",
    config={
        "index": "knowledge-base",
        "top_k": 5,
        "semantic_config": "default"
    }
))

# LLM node
rag_flow.add_node(PromptFlowNode(
    name="generate_response",
    node_type="llm",
    config={
        "model": "gpt-4-turbo",
        "deployment": "gpt4-turbo",
        "temperature": 0.7,
        "prompt_template": """
You are a helpful customer support agent. Answer the question based on the provided context.

Context:
{{context}}

Question: {{question}}

Answer:"""
    }
))

# Connect nodes
rag_flow.connect("input", "question", "embed_query", "text")
rag_flow.connect("embed_query", "embedding", "search_knowledge", "vector")
rag_flow.connect("search_knowledge", "results", "generate_response", "context")
rag_flow.connect("input", "question", "generate_response", "question")
```

## Model Evaluation

```python
from dataclasses import dataclass
from typing import List
import statistics

@dataclass
class EvaluationResult:
    model: str
    metrics: Dict[str, float]
    latency_ms: float
    cost_per_1k: float

class ModelEvaluator:
    def __init__(self):
        self.test_cases: List[dict] = []
        self.results: Dict[str, EvaluationResult] = {}

    def add_test_case(self, input_text: str, expected_output: str, category: str = "general"):
        self.test_cases.append({
            "input": input_text,
            "expected": expected_output,
            "category": category
        })

    def evaluate_model(self, model_name: str, model_fn: Callable) -> EvaluationResult:
        """Evaluate a model against test cases."""
        import time

        scores = {
            "accuracy": [],
            "relevance": [],
            "coherence": [],
            "groundedness": []
        }
        latencies = []

        for case in self.test_cases:
            start = time.time()
            output = model_fn(case["input"])
            latencies.append((time.time() - start) * 1000)

            # Simplified scoring (in production, use LLM-as-judge or human eval)
            scores["accuracy"].append(self._score_accuracy(output, case["expected"]))
            scores["relevance"].append(self._score_relevance(output, case["input"]))
            scores["coherence"].append(self._score_coherence(output))
            scores["groundedness"].append(self._score_groundedness(output, case["expected"]))

        result = EvaluationResult(
            model=model_name,
            metrics={k: statistics.mean(v) for k, v in scores.items()},
            latency_ms=statistics.mean(latencies),
            cost_per_1k=self._estimate_cost(model_name)
        )

        self.results[model_name] = result
        return result

    def _score_accuracy(self, output: str, expected: str) -> float:
        # Simplified - use embeddings similarity in production
        common_words = set(output.lower().split()) & set(expected.lower().split())
        return len(common_words) / max(len(expected.split()), 1)

    def _score_relevance(self, output: str, input_text: str) -> float:
        return 0.85  # Placeholder

    def _score_coherence(self, output: str) -> float:
        return 0.90  # Placeholder

    def _score_groundedness(self, output: str, context: str) -> float:
        return 0.88  # Placeholder

    def _estimate_cost(self, model_name: str) -> float:
        costs = {
            "gpt-4-turbo": 0.01,
            "gpt-4": 0.03,
            "gpt-35-turbo": 0.002,
            "Llama-2-70b": 0.005
        }
        return costs.get(model_name, 0.01)

    def compare_models(self) -> str:
        """Generate comparison report."""
        report = "# Model Comparison Report\n\n"
        report += "| Model | Accuracy | Relevance | Latency (ms) | Cost/1K |\n"
        report += "|-------|----------|-----------|--------------|--------|\n"

        for name, result in self.results.items():
            report += f"| {name} | {result.metrics['accuracy']:.2f} | "
            report += f"{result.metrics['relevance']:.2f} | "
            report += f"{result.latency_ms:.0f} | ${result.cost_per_1k:.3f} |\n"

        return report

# Usage
evaluator = ModelEvaluator()
evaluator.add_test_case(
    "What is the return policy?",
    "Our return policy allows returns within 30 days with receipt.",
    "policy"
)
evaluator.add_test_case(
    "How do I reset my password?",
    "Go to Settings > Security > Reset Password.",
    "technical"
)
```

## Best Practices

1. **Use the model catalog** to discover and compare models
2. **Build with Prompt Flow** for reproducible AI workflows
3. **Evaluate thoroughly** before production deployment
4. **Monitor continuously** for model drift and quality
5. **Version your prompts** and flows like code

Tomorrow, we'll explore the Model Catalog in depth and how to choose the right model for your use case!\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
