---
title: "Edge AI Improvements: Deploying Intelligence at the Data Source"
author: Michael John Peña
draft: false
date: 2025-02-07
tags:
  - Edge AI
  - IoT
  - Azure IoT
  - ONNX
  - MLOps
---

## Edge AI Architecture

```
Data Sources           Edge Layer              Cloud Layer
    │                      │                       │
    ▼                      ▼                       ▼
┌─────────┐          ┌──────────┐           ┌──────────┐
│ Sensors │─────────►│ Edge AI  │──────────►│ Cloud AI │
│ Cameras │          │ - Filter │           │ - Train  │
│ IoT     │          │ - Enrich │           │ - Store  │
│ Devices │          │ - Detect │           │ - Analyze│
└─────────┘          └──────────┘           └──────────┘
                           │
                     ┌─────┴─────┐
                     │ Local     │
                     │ Storage   │
                     │ & Action  │
                     └───────────┘
```

## Azure IoT Edge with AI

```python
# Azure IoT Edge module with AI inference

import asyncio
import json
from azure.iot.device.aio import IoTHubModuleClient
import onnxruntime as ort
import numpy as np

class EdgeAIModule:
    def __init__(self):
        self.client = None
        self.model = None

    async def initialize(self):
        """Initialize IoT Edge module and load AI model."""
        self.client = IoTHubModuleClient.create_from_edge_environment()
        await self.client.connect()

        # Load ONNX model
        self.model = ort.InferenceSession(
            "model.onnx",
            providers=['CPUExecutionProvider']  # Or GPU if available
        )

        # Set up message handler
        self.client.on_message_received = self.handle_message

    async def handle_message(self, message):
        """Process incoming sensor data with AI."""
        data = json.loads(message.data.decode())

        # Prepare input for model
        features = np.array([
            data['temperature'],
            data['pressure'],
            data['vibration']
        ]).astype(np.float32).reshape(1, -1)

        # Run inference
        result = self.model.run(None, {"input": features})
        prediction = result[0][0]

        # Decision: send to cloud or handle locally
        if prediction > 0.8:  # Anomaly detected
            # Send alert to cloud
            alert = {
                "device_id": data['device_id'],
                "timestamp": data['timestamp'],
                "anomaly_score": float(prediction),
                "raw_data": data
            }
            await self.client.send_message_to_output(
                json.dumps(alert),
                "anomaly_output"
            )
        else:
            # Store locally, batch send later
            await self.store_locally(data, prediction)

    async def store_locally(self, data, score):
        """Store normal readings locally for batch upload."""
        # Append to local storage
        with open("/data/readings.jsonl", "a") as f:
            f.write(json.dumps({**data, "score": float(score)}) + "\n")

async def main():
    module = EdgeAIModule()
    await module.initialize()
    await asyncio.Event().wait()  # Run forever

if __name__ == "__main__":
    asyncio.run(main())
```

## Model Optimization for Edge

```python
import onnx
from onnxruntime.quantization import quantize_dynamic, QuantType
from onnxruntime.transformers import optimizer

class EdgeModelOptimizer:
    def __init__(self, model_path: str):
        self.model_path = model_path

    def quantize(self, output_path: str):
        """Quantize model for smaller size and faster inference."""
        quantize_dynamic(
            model_input=self.model_path,
            model_output=output_path,
            weight_type=QuantType.QInt8
        )
        print(f"Quantized model saved to {output_path}")

        # Size comparison
        import os
        original_size = os.path.getsize(self.model_path)
        quantized_size = os.path.getsize(output_path)
        print(f"Size reduction: {original_size/1024:.1f}KB -> {quantized_size/1024:.1f}KB")
        print(f"Compression: {quantized_size/original_size*100:.1f}%")

    def optimize_for_edge(self, output_path: str, target: str = "cpu"):
        """Optimize model graph for edge deployment."""
        model = onnx.load(self.model_path)

        # Graph optimizations
        optimized = optimizer.optimize_model(
            self.model_path,
            model_type='bert' if 'bert' in self.model_path else 'gpt2',
            num_heads=0,
            hidden_size=0,
            optimization_options=None,
            opt_level=99  # Maximum optimization
        )

        optimized.save_model_to_file(output_path)

    def benchmark(self, test_input: np.ndarray, iterations: int = 100):
        """Benchmark model inference speed."""
        import time

        session = ort.InferenceSession(self.model_path)

        # Warm up
        for _ in range(10):
            session.run(None, {"input": test_input})

        # Benchmark
        start = time.time()
        for _ in range(iterations):
            session.run(None, {"input": test_input})
        elapsed = time.time() - start

        print(f"Average inference time: {elapsed/iterations*1000:.2f}ms")
        print(f"Throughput: {iterations/elapsed:.1f} inferences/second")
```

## Edge AI with Azure Arc

```yaml
# Kubernetes manifest for Edge AI deployment

apiVersion: apps/v1
kind: Deployment
metadata:
  name: edge-ai-inference
  namespace: edge-ai
spec:
  replicas: 2
  selector:
    matchLabels:
      app: edge-ai
  template:
    metadata:
      labels:
        app: edge-ai
    spec:
      containers:
      - name: inference
        image: myacr.azurecr.io/edge-ai:latest
        resources:
          limits:
            memory: "512Mi"
            cpu: "500m"
            # Request GPU if available
            nvidia.com/gpu: 1
        volumeMounts:
        - name: model-storage
          mountPath: /models
        env:
        - name: MODEL_PATH
          value: /models/optimized_model.onnx
        - name: BATCH_SIZE
          value: "32"
      volumes:
      - name: model-storage
        persistentVolumeClaim:
          claimName: model-pvc
```
