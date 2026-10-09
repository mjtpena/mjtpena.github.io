---
title: "Real-Time AI Inference with Azure Container Apps: Dynamic Scaling Patterns"
description: "Use spot instances for non-critical workloads, implement request batching for throughput optimization, and configure appropriate scale-to-zero policies.…"
author: Michael John Peña
draft: false
date: 2025-07-07
tags:
  - Azure Container Apps
  - Real-Time Inference
  - KEDA
  - Serverless
  - Python
---

## Container Configuration for ML Workloads

Structure your inference container for fast cold starts and efficient resource utilization:

```python
# inference_server.py
from fastapi import FastAPI
from contextlib import asynccontextmanager
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

model = None
tokenizer = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Load model once at startup
    global model, tokenizer
    model = AutoModelForCausalLM.from_pretrained(
        "microsoft/Phi-3-mini-4k-instruct",
        torch_dtype=torch.float16,
        device_map="auto",
        trust_remote_code=True
    )
    tokenizer = AutoTokenizer.from_pretrained(
        "microsoft/Phi-3-mini-4k-instruct"
    )
    yield
    # Cleanup on shutdown
    del model, tokenizer
    torch.cuda.empty_cache()

app = FastAPI(lifespan=lifespan)

@app.post("/generate")
async def generate(prompt: str, max_tokens: int = 256):
    inputs = tokenizer(prompt, return_tensors="pt").to(model.device)
    outputs = model.generate(
        **inputs,
        max_new_tokens=max_tokens,
        do_sample=True,
        temperature=0.7
    )
    return {"response": tokenizer.decode(outputs[0], skip_special_tokens=True)}
```

## KEDA Scaling Configuration

Configure scaling based on HTTP requests and queue depth for batch workloads:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: inference-service
spec:
  template:
    metadata:
      annotations:
        keda.sh/scaled-object.http-scaler: |
          minReplicaCount: 0
          maxReplicaCount: 20
          cooldownPeriod: 300
          pollingInterval: 15
          triggers:
            - type: http
              metadata:
                scalingMetric: requestRate
                targetValue: "100"
```

## Cost Optimization

Use spot instances for non-critical workloads, implement request batching for throughput optimization, and configure appropriate scale-to-zero policies. Monitor cold start latency and adjust minimum replicas during peak hours.
