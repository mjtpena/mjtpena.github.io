---
title: "MLflow Tracing for LLM Applications: Open Source Observability"
author: "Michael John Peña"
draft: false
date: 2024-10-17
tags: ["MLflow", "LLM", "Tracing", "Open Source", "MLOps"]

---

I wrote "MLflow Tracing for LLM Applications: Open Source Observability" to share practical, production-minded guidance on this topic.

## Setting Up MLflow for LLMs

```python
# pip install mlflow>=2.9.0

import mlflow
from mlflow.tracking import MlflowClient

# Start MLflow tracking server (or use managed service)
# mlflow server --host 127.0.0.1 --port 5000

# Set tracking URI
mlflow.set_tracking_uri("http://127.0.0.1:5000")

# Create or set experiment
mlflow.set_experiment("llm-application")
```

## Automatic LLM Tracing

```python
import mlflow
from openai import OpenAI

# Enable autologging for OpenAI
mlflow.openai.autolog()

client = OpenAI()

# All OpenAI calls are automatically traced
with mlflow.start_run(run_name="chat-session"):
    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[{"role": "user", "content": "Hello!"}]
    )

    # Metrics are automatically logged:
    # - Input/output tokens
    # - Latency
    # - Model used
    # - Full request/response

# View in MLflow UI at http://127.0.0.1:5000
```

## Manual Tracing with Spans

```python
import mlflow
from mlflow import trace

@trace
def process_request(user_input: str) -> str:
    """Traced request processing"""

    # Nested traces
    intent = classify_intent(user_input)
    response = generate_response(user_input, intent)

    return response

@trace
def classify_intent(text: str) -> str:
    """Classify user intent"""
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": "Classify as: question, command, or chat"},
            {"role": "user", "content": text}
        ]
    )
    return response.choices[0].message.content.strip()

@trace
def generate_response(text: str, intent: str) -> str:
    """Generate response based on intent"""
    system_prompts = {
        "question": "Answer the question accurately.",
        "command": "Execute the command and report results.",
        "chat": "Engage in friendly conversation."
    }

    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": system_prompts.get(intent, "Be helpful.")},
            {"role": "user", "content": text}
        ]
    )
    return response.choices[0].message.content

# Run with automatic trace collection
with mlflow.start_run():
    result = process_request("What is machine learning?")
```

## Custom Metrics and Artifacts

```python
import mlflow

def log_llm_metrics(response, latency_ms: float, cost_usd: float):
    """Log custom LLM metrics"""

    mlflow.log_metrics({
        "latency_ms": latency_ms,
        "cost_usd": cost_usd,
        "input_tokens": response.usage.prompt_tokens,
        "output_tokens": response.usage.completion_tokens,
        "total_tokens": response.usage.total_tokens
    })

def log_conversation(messages: list, response: str):
    """Log conversation as artifact"""

    conversation = {
        "messages": messages,
        "response": response,
        "timestamp": datetime.utcnow().isoformat()
    }

    # Save as JSON artifact
    with open("conversation.json", "w") as f:
        json.dump(conversation, f, indent=2)

    mlflow.log_artifact("conversation.json", "conversations")

# Usage
with mlflow.start_run():
    start = time.time()

    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[{"role": "user", "content": "Hello!"}]
    )

    latency = (time.time() - start) * 1000
    cost = calculate_cost("gpt-4o", response.usage)

    log_llm_metrics(response, latency, cost)
    log_conversation(
        [{"role": "user", "content": "Hello!"}],
        response.choices[0].message.content
    )
```

## LLM Evaluation with MLflow

```python
import mlflow
from mlflow.metrics.genai import answer_correctness, answer_relevance

# Define evaluation dataset
eval_data = pd.DataFrame({
    "inputs": [
        "What is the capital of France?",
        "Who wrote Hamlet?",
        "What is 2+2?"
    ],
    "ground_truth": [
        "Paris",
        "William Shakespeare",
        "4"
    ]
})

# Define model function
def model(inputs):
    responses = []
    for input_text in inputs["inputs"]:
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": input_text}]
        )
        responses.append(response.choices[0].message.content)
    return responses

# Run evaluation
with mlflow.start_run():
    results = mlflow.evaluate(
        model=model,
        data=eval_data,
        targets="ground_truth",
        model_type="text",
        evaluators=["default"],
        extra_metrics=[
            answer_correctness(model_judge="openai:/gpt-4o"),
            answer_relevance()
        ]
    )

    print(f"Metrics: {results.metrics}")
    print(f"Results table: {results.tables}")
```

## Prompt Registry

```python
import mlflow
from mlflow.models import Model

class PromptTemplate:
    """MLflow-compatible prompt template"""

    def __init__(self, system_prompt: str, user_template: str):
        self.system_prompt = system_prompt
        self.user_template = user_template

    def format(self, **kwargs) -> list:
        return [
            {"role": "system", "content": self.system_prompt},
            {"role": "user", "content": self.user_template.format(**kwargs)}
        ]

    def save(self, path: str):
        """Save prompt to file"""
        config = {
            "system_prompt": self.system_prompt,
            "user_template": self.user_template
        }
        with open(f"{path}/prompt_config.json", "w") as f:
            json.dump(config, f)

    @classmethod
    def load(cls, path: str):
        """Load prompt from file"""
        with open(f"{path}/prompt_config.json", "r") as f:
            config = json.load(f)
        return cls(**config)

# Register prompt as MLflow model
def log_prompt(prompt: PromptTemplate, name: str):
    """Log prompt to MLflow"""
    with mlflow.start_run():
        # Log prompt parameters
        mlflow.log_params({
            "system_prompt_length": len(prompt.system_prompt),
            "user_template_length": len(prompt.user_template)
        })

        # Log prompt as artifact
        mlflow.pyfunc.log_model(
            artifact_path="prompt",
            python_model=PromptWrapper(prompt),
            registered_model_name=name
        )

class PromptWrapper(mlflow.pyfunc.PythonModel):
    def __init__(self, prompt: PromptTemplate):
        self.prompt = prompt

    def predict(self, context, model_input):
        # Format prompt with input
        messages = self.prompt.format(**model_input.to_dict('records')[0])
        return messages

# Usage
qa_prompt = PromptTemplate(
    system_prompt="Answer questions accurately.",
    user_template="Question: {question}"
)

log_prompt(qa_prompt, "qa-prompt")

# Load and use registered prompt
loaded_prompt = mlflow.pyfunc.load_model("models:/qa-prompt/latest")
```

## Model Comparison

```python
import mlflow

def compare_models(models: list, eval_data: pd.DataFrame):
    """Compare multiple model configurations"""

    results = {}

    for model_config in models:
        with mlflow.start_run(run_name=model_config["name"]):
            mlflow.log_params(model_config)

            # Run evaluation
            metrics = evaluate_model(model_config, eval_data)

            mlflow.log_metrics(metrics)
            results[model_config["name"]] = metrics

    return results

def evaluate_model(config: dict, data: pd.DataFrame) -> dict:
    """Evaluate a single model configuration"""

    correct = 0
    total_latency = 0

    for _, row in data.iterrows():
        start = time.time()

        response = client.chat.completions.create(
            model=config["model"],
            messages=[{"role": "user", "content": row["input"]}],
            temperature=config.get("temperature", 0.7)
        )

        latency = time.time() - start
        total_latency += latency

        if row["expected"].lower() in response.choices[0].message.content.lower():
            correct += 1

    return {
        "accuracy": correct / len(data),
        "avg_latency_ms": (total_latency / len(data)) * 1000
    }

# Compare configurations
models = [
    {"name": "gpt-4o-default", "model": "gpt-4o", "temperature": 0.7},
    {"name": "gpt-4o-precise", "model": "gpt-4o", "temperature": 0.1},
    {"name": "gpt-4o-mini", "model": "gpt-4o-mini", "temperature": 0.7}
]

results = compare_models(models, eval_data)
```

MLflow provides a solid open-source foundation for LLM observability. Its strength lies in the familiar MLOps workflow and integration with the broader ML ecosystem.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
