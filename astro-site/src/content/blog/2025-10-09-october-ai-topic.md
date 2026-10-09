---
title: "Edge AI Deployment: Running ML Models on Azure IoT Edge"
description: "Configure the edge deployment with appropriate resource limits and restart policies for reliable operation in edge environments with limited connectivity."
author: Michael John Peña
draft: false
date: 2025-10-09
tags:
  - Edge AI
  - Azure IoT Edge
  - Machine Learning
  - ONNX
  - IoT
---

## Preparing Models for Edge Deployment

Convert models to ONNX format for optimal edge performance:

```python
import torch
import onnx
import onnxruntime as ort
import numpy as np

class EdgeModelConverter:
    def __init__(self, model, input_shape: tuple):
        self.model = model
        self.input_shape = input_shape

    def export_to_onnx(self, output_path: str, optimize: bool = True) -> str:
        """Export PyTorch model to ONNX format."""

        self.model.eval()
        dummy_input = torch.randn(self.input_shape)

        torch.onnx.export(
            self.model,
            dummy_input,
            output_path,
            export_params=True,
            opset_version=14,
            do_constant_folding=True,
            input_names=['input'],
            output_names=['output'],
            dynamic_axes={
                'input': {0: 'batch_size'},
                'output': {0: 'batch_size'}
            }
        )

        return output_path

    def validate_onnx_model(self, model_path: str, test_input: torch.Tensor) -> bool:
        """Validate ONNX model produces same output as original."""

        self.model.eval()
        with torch.no_grad():
            torch_output = self.model(test_input).numpy()

        session = ort.InferenceSession(model_path)
        onnx_output = session.run(None, {'input': test_input.numpy()})[0]

        return np.allclose(torch_output, onnx_output, rtol=1e-3, atol=1e-5)
```

## Creating IoT Edge Module

Package the model as an IoT Edge module:

```python
import asyncio
import json
from azure.iot.device.aio import IoTHubModuleClient
import onnxruntime as ort
import numpy as np

class EdgeInferenceModule:
    def __init__(self, model_path: str):
        self.session = ort.InferenceSession(
            model_path,
            providers=['CPUExecutionProvider']
        )
        self.client = None

    async def initialize(self):
        """Initialize IoT Hub connection."""
        self.client = IoTHubModuleClient.create_from_edge_environment()
        await self.client.connect()
        self.client.on_message_received = self.message_handler

    async def message_handler(self, message):
        """Process incoming messages and run inference."""

        data = json.loads(message.data.decode('utf-8'))
        input_array = np.array(data['features'], dtype=np.float32)
        input_array = input_array.reshape(1, -1)

        outputs = self.session.run(None, {'input': input_array})
        prediction = outputs[0].tolist()

        result = {
            'device_id': data.get('device_id'),
            'prediction': prediction,
            'timestamp': data.get('timestamp')
        }

        await self.client.send_message_to_output(json.dumps(result), 'inferenceOutput')
```

## Deployment Manifest

Configure the edge deployment with appropriate resource limits and restart policies for reliable operation in edge environments with limited connectivity.
