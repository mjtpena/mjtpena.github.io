---
title: "Weights and Biases for LLM Applications: Complete Guide"
author: "Michael John Peña"
draft: false
date: 2024-10-16
tags: ["Weights and Biases", "LLM", "MLOps", "Observability", "Evaluation"]

---

I wrote "Weights and Biases for LLM Applications: Complete Guide" to share practical, production-minded guidance on this topic.

## Getting Started with W&B Weave

```python
# pip install wandb weave

import wandb
import weave

# Initialize wandb project
wandb.init(project="llm-application")

# Initialize Weave for LLM tracing
weave.init("llm-application")
```

## Tracing LLM Calls

```python
from openai import OpenAI
import weave

client = OpenAI()

@weave.op()
def chat_completion(messages: list, model: str = "gpt-4o") -> str:
    """Traced LLM call"""
    response = client.chat.completions.create(
        model=model,
        messages=messages
    )
    return response.choices[0].message.content

@weave.op()
def process_with_tools(user_input: str) -> dict:
    """Traced multi-step process"""

    # Step 1: Classify intent
    intent = classify_intent(user_input)

    # Step 2: Generate response based on intent
    if intent == "question":
        response = answer_question(user_input)
    else:
        response = chat_completion([{"role": "user", "content": user_input}])

    return {
        "intent": intent,
        "response": response
    }

@weave.op()
def classify_intent(text: str) -> str:
    """Classify user intent"""
    response = chat_completion([
        {"role": "system", "content": "Classify the intent as 'question', 'command', or 'chat'. Respond with just the classification."},
        {"role": "user", "content": text}
    ])
    return response.strip().lower()

@weave.op()
def answer_question(question: str) -> str:
    """Answer a user question"""
    return chat_completion([
        {"role": "system", "content": "Answer the question helpfully and accurately."},
        {"role": "user", "content": question}
    ])

# All nested calls are automatically traced
result = process_with_tools("What is the capital of France?")
```

## Evaluation Framework

```python
import weave
from typing import List, Dict

# Define evaluation dataset
eval_dataset = [
    {"input": "What is 2+2?", "expected": "4"},
    {"input": "What is the capital of Japan?", "expected": "Tokyo"},
    {"input": "Who wrote Romeo and Juliet?", "expected": "Shakespeare"}
]

# Define evaluation metrics
@weave.op()
def exact_match(output: str, expected: str) -> bool:
    """Check for exact match (case insensitive)"""
    return expected.lower() in output.lower()

@weave.op()
def response_length(output: str) -> int:
    """Measure response length"""
    return len(output)

@weave.op()
def contains_answer(output: str, expected: str) -> float:
    """Score based on whether output contains expected answer"""
    if expected.lower() in output.lower():
        return 1.0
    return 0.0

# Create evaluation
class QAEvaluator(weave.Evaluation):
    dataset: List[Dict]

    @weave.op()
    def predict(self, input: str) -> str:
        """Run the model"""
        return chat_completion([{"role": "user", "content": input}])

    @weave.op()
    def score(self, output: str, expected: str) -> Dict:
        """Score the output"""
        return {
            "exact_match": exact_match(output, expected),
            "contains_answer": contains_answer(output, expected),
            "length": response_length(output)
        }

# Run evaluation
evaluator = QAEvaluator(dataset=eval_dataset)
results = evaluator.evaluate()

# Results are logged to W&B automatically
print(f"Accuracy: {results['contains_answer']:.2%}")
```

## Prompt Management

```python
import weave

# Define prompts as Weave objects for versioning
class PromptTemplate(weave.Object):
    """Versioned prompt template"""
    system_prompt: str
    user_template: str
    version: str

    def format(self, **kwargs) -> list:
        return [
            {"role": "system", "content": self.system_prompt},
            {"role": "user", "content": self.user_template.format(**kwargs)}
        ]

# Create versioned prompts
qa_prompt_v1 = PromptTemplate(
    system_prompt="Answer questions accurately and concisely.",
    user_template="Question: {question}",
    version="1.0"
)

qa_prompt_v2 = PromptTemplate(
    system_prompt="You are a helpful assistant. Answer questions with clear explanations.",
    user_template="Please answer the following question:\n\n{question}",
    version="2.0"
)

# Publish prompts for team use
weave.publish(qa_prompt_v1, name="qa-prompt-v1")
weave.publish(qa_prompt_v2, name="qa-prompt-v2")

# Use in application
@weave.op()
def answer_with_prompt(question: str, prompt: PromptTemplate) -> str:
    messages = prompt.format(question=question)
    return chat_completion(messages)

# Easy A/B testing
response_v1 = answer_with_prompt("What is gravity?", qa_prompt_v1)
response_v2 = answer_with_prompt("What is gravity?", qa_prompt_v2)
```

## Model Registry

```python
import weave

class LLMModel(weave.Model):
    """Registered LLM model configuration"""
    model_name: str
    temperature: float = 0.7
    max_tokens: int = 1024
    system_prompt: str = ""

    @weave.op()
    def predict(self, input: str) -> str:
        messages = []
        if self.system_prompt:
            messages.append({"role": "system", "content": self.system_prompt})
        messages.append({"role": "user", "content": input})

        response = client.chat.completions.create(
            model=self.model_name,
            messages=messages,
            temperature=self.temperature,
            max_tokens=self.max_tokens
        )
        return response.choices[0].message.content

# Register different model configurations
creative_model = LLMModel(
    model_name="gpt-4o",
    temperature=0.9,
    system_prompt="Be creative and imaginative in your responses."
)

precise_model = LLMModel(
    model_name="gpt-4o",
    temperature=0.1,
    system_prompt="Be precise and factual. Cite sources when possible."
)

# Publish to registry
weave.publish(creative_model, name="creative-assistant")
weave.publish(precise_model, name="precise-assistant")

# Load and use from registry
loaded_model = weave.ref("creative-assistant").get()
response = loaded_model.predict("Write a poem about AI")
```

## Logging Custom Metrics

```python
import wandb
import weave

@weave.op()
def process_request_with_metrics(user_input: str) -> dict:
    """Process with custom metric logging"""

    import time
    start = time.time()

    # Process
    response = chat_completion([{"role": "user", "content": user_input}])

    latency = time.time() - start

    # Log custom metrics to W&B
    wandb.log({
        "latency_seconds": latency,
        "input_length": len(user_input),
        "output_length": len(response),
        "tokens_per_second": len(response.split()) / latency
    })

    return {
        "response": response,
        "latency": latency
    }

# Create custom summary tables
def log_daily_summary(calls: list):
    """Log summary table to W&B"""
    table = wandb.Table(columns=["timestamp", "model", "tokens", "latency", "cost"])

    for call in calls:
        table.add_data(
            call["timestamp"],
            call["model"],
            call["tokens"],
            call["latency"],
            call["cost"]
        )

    wandb.log({"daily_summary": table})
```

## Dashboard and Alerts

```python
# W&B Dashboard Configuration (via UI or API)
dashboard_config = {
    "panels": [
        {
            "type": "line",
            "title": "Request Latency",
            "x": "timestamp",
            "y": "latency_seconds"
        },
        {
            "type": "bar",
            "title": "Tokens by Model",
            "x": "model",
            "y": "total_tokens"
        },
        {
            "type": "scalar",
            "title": "Total Cost",
            "metric": "cumulative_cost_usd"
        }
    ],
    "alerts": [
        {
            "name": "High Latency",
            "condition": "latency_seconds > 5",
            "severity": "warning"
        },
        {
            "name": "Error Rate",
            "condition": "error_rate > 0.05",
            "severity": "critical"
        }
    ]
}

# Create alerts programmatically
wandb.alert(
    title="High Error Rate",
    text="Error rate exceeded 5% in the last hour",
    level=wandb.AlertLevel.WARN
)
```

Weights & Biases provides a comprehensive platform for LLM observability, evaluation, and collaboration. Its strength lies in combining experiment tracking with production monitoring.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
