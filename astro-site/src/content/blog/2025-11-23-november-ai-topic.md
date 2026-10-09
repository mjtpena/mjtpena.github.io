---
title: "Azure Container Apps: Serverless Deployment for AI Workloads"
description: "AI applications often have variable load patterns with periods of high demand followed by quiet periods. Container Apps scales to zero during idle times…"
author: Michael John Peña
draft: false
date: 2025-11-23
tags:
  - Azure Container Apps
  - Serverless
  - AI Deployment
  - Kubernetes
  - Infrastructure
---

## Why Container Apps for AI

AI applications often have variable load patterns with periods of high demand followed by quiet periods. Container Apps scales to zero during idle times while handling burst traffic efficiently.

## Deploying an AI Service

Create a containerized AI inference service:

```dockerfile
# Dockerfile for AI inference service
FROM python:3.11-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY src/ ./src/

# Set environment variables
ENV PYTHONUNBUFFERED=1
ENV MODEL_CACHE_DIR=/app/models

# Health check endpoint
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s \
  CMD curl -f http://localhost:8000/health || exit 1

# Run the service
CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

## Container Apps Configuration

Deploy with proper scaling and resource configuration:

```bicep
// main.bicep - Azure Container Apps deployment
resource containerApp 'Microsoft.App/containerApps@2023-05-01' = {
  name: 'ai-inference-service'
  location: resourceGroup().location
  properties: {
    environmentId: containerAppEnvironment.id
    configuration: {
      activeRevisionsMode: 'Multiple'
      ingress: {
        external: true
        targetPort: 8000
        traffic: [
          {
            latestRevision: true
            weight: 100
          }
        ]
        corsPolicy: {
          allowedOrigins: ['https://app.contoso.com']
          allowedMethods: ['GET', 'POST']
        }
      }
      secrets: [
        {
          name: 'azure-openai-key'
          value: openaiKey
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'inference'
          image: '${containerRegistry}.azurecr.io/ai-inference:latest'
          resources: {
            cpu: json('2.0')
            memory: '4Gi'
          }
          env: [
            {
              name: 'AZURE_OPENAI_KEY'
              secretRef: 'azure-openai-key'
            }
            {
              name: 'AZURE_OPENAI_ENDPOINT'
              value: openaiEndpoint
            }
          ]
          probes: [
            {
              type: 'Liveness'
              httpGet: {
                path: '/health'
                port: 8000
              }
              initialDelaySeconds: 30
              periodSeconds: 10
            }
            {
              type: 'Readiness'
              httpGet: {
                path: '/ready'
                port: 8000
              }
              initialDelaySeconds: 10
              periodSeconds: 5
            }
          ]
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: 10
        rules: [
          {
            name: 'http-scaling'
            http: {
              metadata: {
                concurrentRequests: '50'
              }
            }
          }
          {
            name: 'queue-scaling'
            custom: {
              type: 'azure-servicebus'
              metadata: {
                queueName: 'inference-requests'
                messageCount: '5'
              }
            }
          }
        ]
      }
    }
  }
}
```

## FastAPI Service Implementation

```python
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from openai import AzureOpenAI
import os

app = FastAPI(title="AI Inference Service")

client = AzureOpenAI(
    api_key=os.environ["AZURE_OPENAI_KEY"],
    azure_endpoint=os.environ["AZURE_OPENAI_ENDPOINT"],
    api_version="2024-02-01"
)

class InferenceRequest(BaseModel):
    prompt: str
    max_tokens: int = 500

class InferenceResponse(BaseModel):
    result: str
    usage: dict

@app.get("/health")
async def health():
    return {"status": "healthy"}

@app.get("/ready")
async def ready():
    # Check dependencies are available
    try:
        # Verify OpenAI connection
        await client.models.list()
        return {"status": "ready"}
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))

@app.post("/inference", response_model=InferenceResponse)
async def inference(request: InferenceRequest):
    response = await client.chat.completions.create(
        model="gpt-4",
        messages=[{"role": "user", "content": request.prompt}],
        max_tokens=request.max_tokens
    )

    return InferenceResponse(
        result=response.choices[0].message.content,
        usage=response.usage.model_dump()
    )
```

Azure Container Apps simplifies AI deployment by handling infrastructure concerns, letting teams focus on building great AI applications while benefiting from automatic scaling and cost optimization.
