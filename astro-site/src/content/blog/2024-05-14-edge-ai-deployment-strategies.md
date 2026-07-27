---
title: "Edge AI Deployment: Taking Models to the Data"
author: Michael John Peña
draft: false
date: 2024-05-14
tags:
  - AI
  - Edge Computing
  - IoT
  - Azure IoT
  - ONNX
---

Sometimes the data can't come to the cloud. Today I'm exploring strategies for deploying AI models at the edge.

## Why Edge AI?

**Latency**: Real-time decisions can't wait for cloud round-trips
**Bandwidth**: Sending all data to cloud is expensive/impractical
**Privacy**: Some data should never leave the premises
**Reliability**: Edge works when connectivity doesn't

## Edge AI Architecture Patterns

### Pattern 1: Inference at Edge, Training in Cloud

```
[Sensors] → [Edge Device] → [Inference] → [Action]
                ↓
           [Telemetry]
                ↓
           [Cloud] → [Retrain] → [Push Model Update]
```

### Pattern 2: Hierarchical Edge

```
[Sensors] → [Edge Tier 1] → [Local Inference]
                   ↓
            [Edge Tier 2] → [Complex Inference]
                   ↓
               [Cloud] → [Analytics & Training]
```

## Azure IoT Edge for AI

```python
# IoT Edge Module - inference.py
import asyncio
import json
from azure.iot.device.aio import IoTHubModuleClient
import onnxruntime as ort
import numpy as np

class InferenceModule:
    def __init__(self):
        self.client = None
        self.session = None

    async def initialize(self):
        self.client = IoTHubModuleClient.create_from_edge_environment()
        await self.client.connect()

        # Load ONNX model
        self.session = ort.InferenceSession(
            "/app/models/model.onnx",
            providers=['CPUExecutionProvider']
        )

        # Set up message handler
        self.client.on_message_received = self.handle_message

    async def handle_message(self, message):
        data = json.loads(message.data.decode())

        # Preprocess input
        input_array = np.array(data["features"]).astype(np.float32)
        input_array = input_array.reshape(1, -1)

        # Run inference
        outputs = self.session.run(
            None,
            {"input": input_array}
        )

        prediction = outputs[0][0]

        # Send result
        result = {
            "device_id": data["device_id"],
            "timestamp": data["timestamp"],
            "prediction": float(prediction),
            "model_version": "1.0.0"
        }

        await self.client.send_message_to_output(
            json.dumps(result),
            "output1"
        )

async def main():
    module = InferenceModule()
    await module.initialize()

    # Keep running
    while True:
        await asyncio.sleep(1)

if __name__ == "__main__":
    asyncio.run(main())
```

## Deployment Manifest

```json
{
  "modulesContent": {
    "$edgeAgent": {
      "properties.desired": {
        "modules": {
          "inference": {
            "type": "docker",
            "status": "running",
            "restartPolicy": "always",
            "settings": {
              "image": "myregistry.azurecr.io/inference:1.0",
              "createOptions": {
                "HostConfig": {
                  "Binds": ["/models:/app/models"]
                }
              }
            }
          }
        }
      }
    },
    "$edgeHub": {
      "properties.desired": {
        "routes": {
          "sensorToInference": "FROM /messages/modules/sensor/outputs/* INTO BrokeredEndpoint(\"/modules/inference/inputs/input1\")",
          "inferenceToCloud": "FROM /messages/modules/inference/outputs/* INTO $upstream"
        }
      }
    }
  }
}
```

## Model Optimization for Edge

### Quantization

```python
from onnxruntime.quantization import quantize_dynamic, QuantType

# Convert FP32 to INT8
quantize_dynamic(
    model_input="model_fp32.onnx",
    model_output="model_int8.onnx",
    weight_type=QuantType.QUInt8
)

# Size reduction: ~75%
# Speed improvement: 2-4x on CPU
# Accuracy loss: < 1% typically
```

### Pruning

```python
import torch
import torch.nn.utils.prune as prune

def prune_model(model, amount=0.3):
    """Remove 30% of weights with smallest magnitude."""
    for name, module in model.named_modules():
        if isinstance(module, torch.nn.Linear):
            prune.l1_unstructured(module, name='weight', amount=amount)
            prune.remove(module, 'weight')
        elif isinstance(module, torch.nn.Conv2d):
            prune.l1_unstructured(module, name='weight', amount=amount)
            prune.remove(module, 'weight')

    return model
```

### Knowledge Distillation

```python
import torch
import torch.nn.functional as F

def distillation_loss(
    student_logits,
    teacher_logits,
    labels,
    temperature=3.0,
    alpha=0.5
):
    """Combine soft targets from teacher with hard labels."""
    # Soft targets
    soft_loss = F.kl_div(
        F.log_softmax(student_logits / temperature, dim=1),
        F.softmax(teacher_logits / temperature, dim=1),
        reduction='batchmean'
    ) * (temperature ** 2)

    # Hard targets
    hard_loss = F.cross_entropy(student_logits, labels)

    return alpha * soft_loss + (1 - alpha) * hard_loss
```

## Containerizing Edge Models

```dockerfile
# Dockerfile for edge inference
FROM mcr.microsoft.com/azureml/onnxruntime:latest

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy model and code
COPY models/ /app/models/
COPY src/ /app/src/

# Set environment
ENV MODEL_PATH=/app/models/model_optimized.onnx
ENV LOG_LEVEL=INFO

# Run inference server
CMD ["python", "src/inference_server.py"]
```

## Edge Inference Server

```python
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import onnxruntime as ort
import numpy as np
import os
import logging

app = FastAPI()
logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))
logger = logging.getLogger(__name__)

class InferenceRequest(BaseModel):
    features: list[float]
    request_id: str = None

class InferenceResponse(BaseModel):
    prediction: float
    confidence: float
    request_id: str
    model_version: str

# Load model at startup
session = None

@app.on_event("startup")
async def load_model():
    global session
    model_path = os.environ.get("MODEL_PATH", "/app/models/model.onnx")
    session = ort.InferenceSession(
        model_path,
        providers=['CPUExecutionProvider']
    )
    logger.info(f"Model loaded from {model_path}")

@app.post("/predict", response_model=InferenceResponse)
async def predict(request: InferenceRequest):
    if session is None:
        raise HTTPException(status_code=503, detail="Model not loaded")

    try:
        input_array = np.array(request.features).astype(np.float32)
        input_array = input_array.reshape(1, -1)

        outputs = session.run(None, {"input": input_array})

        prediction = float(outputs[0][0])
        confidence = float(np.max(outputs[1][0])) if len(outputs) > 1 else 1.0

        return InferenceResponse(
            prediction=prediction,
            confidence=confidence,
            request_id=request.request_id or "unknown",
            model_version="1.0.0"
        )
    except Exception as e:
        logger.error(f"Inference error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/health")
async def health():
    return {"status": "healthy", "model_loaded": session is not None}
```

## Model Updates Over-the-Air

```python
import asyncio
from azure.iot.device.aio import IoTHubModuleClient
from azure.storage.blob import BlobClient
import hashlib
import os

class ModelUpdater:
    def __init__(self, model_dir: str = "/app/models"):
        self.model_dir = model_dir
        self.client = None

    async def initialize(self):
        self.client = IoTHubModuleClient.create_from_edge_environment()
        await self.client.connect()

        # Listen for twin updates
        self.client.on_twin_desired_properties_patch_received = self.handle_twin_update

    async def handle_twin_update(self, patch):
        if "model_update" in patch:
            model_info = patch["model_update"]
            await self.download_model(
                model_info["url"],
                model_info["version"],
                model_info["checksum"]
            )

    async def download_model(self, url: str, version: str, expected_checksum: str):
        """Download and verify new model."""
        local_path = os.path.join(self.model_dir, f"model_{version}.onnx")

        # Download from blob
        blob_client = BlobClient.from_blob_url(url)
        with open(local_path, "wb") as f:
            download_stream = blob_client.download_blob()
            f.write(download_stream.readall())

        # Verify checksum
        with open(local_path, "rb") as f:
            actual_checksum = hashlib.sha256(f.read()).hexdigest()

        if actual_checksum != expected_checksum:
            os.remove(local_path)
            raise ValueError("Checksum mismatch")

        # Update symlink to new model
        symlink_path = os.path.join(self.model_dir, "model.onnx")
        if os.path.exists(symlink_path):
            os.remove(symlink_path)
        os.symlink(local_path, symlink_path)

        # Report success
        await self.client.patch_twin_reported_properties({
            "model_version": version,
            "update_status": "success"
        })
```

## Monitoring Edge AI

```python
from prometheus_client import Counter, Histogram, start_http_server
import time

# Metrics
INFERENCE_COUNT = Counter(
    'edge_inference_total',
    'Total inference requests',
    ['model_version', 'status']
)

INFERENCE_LATENCY = Histogram(
    'edge_inference_latency_seconds',
    'Inference latency',
    buckets=[0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0]
)

def inference_with_metrics(model, input_data):
    start_time = time.time()

    try:
        result = model.run(input_data)
        INFERENCE_COUNT.labels(
            model_version=model.version,
            status='success'
        ).inc()
        return result
    except Exception as e:
        INFERENCE_COUNT.labels(
            model_version=model.version,
            status='error'
        ).inc()
        raise
    finally:
        INFERENCE_LATENCY.observe(time.time() - start_time)

# Start metrics server
start_http_server(8080)
```

## Best Practices

1. **Optimize aggressively** - Every MB and ms matters at edge
2. **Test on target hardware** - Performance varies significantly
3. **Plan for updates** - Models need refreshing
4. **Monitor continuously** - Edge failures are harder to detect
5. **Graceful degradation** - Have fallback behaviors

## What's Next

Tomorrow I'll dive into ONNX Runtime for cross-platform AI deployment.

## Resources

- [Azure IoT Edge](https://learn.microsoft.com/azure/iot-edge/)
- [ONNX Runtime](https://onnxruntime.ai/)
- [Edge AI Best Practices](https://learn.microsoft.com/azure/architecture/ai-ml/)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
