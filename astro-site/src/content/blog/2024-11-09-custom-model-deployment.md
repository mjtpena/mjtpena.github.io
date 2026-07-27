---
title: "Custom Model Deployment on Azure: From Fine-Tuning to Production"
author: Michael John Peña
draft: false
date: 2024-11-09
tags:
  - Azure
  - AI
  - Model Deployment
  - MLOps
  - Production

---

I wrote "Custom Model Deployment on Azure: From Fine-Tuning to Production" to share practical, production-minded guidance on this topic.

## Deployment Options Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Deployment Options                        │
├─────────────────┬─────────────────┬─────────────────────────┤
│   Serverless    │    Managed      │      Container          │
├─────────────────┼─────────────────┼─────────────────────────┤
│ Pay-per-token   │ Pay-per-hour    │ Full control            │
│ Auto-scaling    │ Manual scaling  │ Custom scaling          │
│ Zero management │ Some management │ Full management         │
│ Limited config  │ More options    │ Complete flexibility    │
└─────────────────┴─────────────────┴─────────────────────────┘
```

## Serverless Deployment

Best for: Variable workloads, quick start, minimal ops overhead

```python
from azure.ai.foundry import AIFoundryClient
from azure.ai.foundry.deployments import ServerlessDeployment

client = AIFoundryClient(...)

# Deploy fine-tuned model serverless
deployment = client.deployments.create_serverless(
    ServerlessDeployment(
        name="my-custom-model-serverless",
        model=fine_tuned_model_name,
        rate_limits={
            "requests_per_minute": 100,
            "tokens_per_minute": 50000
        }
    )
)

print(f"Endpoint: {deployment.endpoint}")
print(f"API Key: {deployment.api_key}")
```

## Managed Compute Deployment

Best for: Predictable workloads, SLA requirements, cost optimization

```python
from azure.ai.foundry.deployments import ManagedDeployment, ScaleSettings

# Deploy with managed compute
deployment = client.deployments.create_managed(
    ManagedDeployment(
        name="my-custom-model-managed",
        model=fine_tuned_model_name,
        compute={
            "sku": "Standard_NC24ads_A100_v4",
            "instance_count": 2
        },
        scale_settings=ScaleSettings(
            min_instances=1,
            max_instances=5,
            scale_type="manual"  # or "target_utilization"
        ),
        request_settings={
            "max_concurrent_requests": 10,
            "request_timeout_ms": 60000
        }
    )
)

# Wait for deployment
deployment.wait_for_completion()
print(f"Status: {deployment.status}")
```

## Container Deployment with AKS

Best for: Multi-model serving, custom inference logic, hybrid scenarios

```python
# First, export the model
export_job = client.models.export(
    model_name=fine_tuned_model_name,
    format="onnx",  # or "pytorch", "safetensors"
    output_path="azureml://datastores/models/paths/my-model"
)

export_job.wait_for_completion()
```

```dockerfile
# Dockerfile for custom inference server
FROM mcr.microsoft.com/azureml/inference-base:latest

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY model/ /app/model/
COPY inference.py /app/

EXPOSE 8080

CMD ["python", "/app/inference.py"]
```

```python
# inference.py
from fastapi import FastAPI
from pydantic import BaseModel
from typing import List
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

app = FastAPI()

# Load model once at startup
model = AutoModelForCausalLM.from_pretrained("/app/model")
tokenizer = AutoTokenizer.from_pretrained("/app/model")

class ChatRequest(BaseModel):
    messages: List[dict]
    max_tokens: int = 500
    temperature: float = 0.7

class ChatResponse(BaseModel):
    content: str
    usage: dict

@app.post("/v1/chat/completions")
async def chat_completion(request: ChatRequest) -> ChatResponse:
    # Format messages
    prompt = tokenizer.apply_chat_template(
        request.messages,
        tokenize=False
    )

    # Tokenize
    inputs = tokenizer(prompt, return_tensors="pt")

    # Generate
    with torch.no_grad():
        outputs = model.generate(
            **inputs,
            max_new_tokens=request.max_tokens,
            temperature=request.temperature,
            do_sample=True
        )

    # Decode
    response_text = tokenizer.decode(
        outputs[0][inputs.input_ids.shape[1]:],
        skip_special_tokens=True
    )

    return ChatResponse(
        content=response_text,
        usage={
            "prompt_tokens": inputs.input_ids.shape[1],
            "completion_tokens": outputs.shape[1] - inputs.input_ids.shape[1],
            "total_tokens": outputs.shape[1]
        }
    )

@app.get("/health")
async def health():
    return {"status": "healthy"}
```

```yaml
# kubernetes/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: custom-model-inference
spec:
  replicas: 3
  selector:
    matchLabels:
      app: custom-model
  template:
    metadata:
      labels:
        app: custom-model
    spec:
      containers:
      - name: inference
        image: myregistry.azurecr.io/custom-model:v1
        resources:
          limits:
            nvidia.com/gpu: 1
            memory: "32Gi"
          requests:
            nvidia.com/gpu: 1
            memory: "16Gi"
        ports:
        - containerPort: 8080
        readinessProbe:
          httpGet:
            path: /health
            port: 8080
        livenessProbe:
          httpGet:
            path: /health
            port: 8080\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
