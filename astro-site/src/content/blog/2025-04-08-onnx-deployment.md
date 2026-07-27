---
title: "ONNX Deployment: Cross-Platform AI Model Deployment"
author: Michael John Peña
draft: false
date: 2025-04-08
tags:
  - ONNX
  - Deployment
  - Cross-Platform
  - AI
  - Models

---

I wrote "ONNX Deployment: Cross-Platform AI Model Deployment" to share practical, production-minded guidance on this topic.

## ONNX Deployment Pipeline

```python
# onnx_deployment.py - ONNX model deployment patterns

import onnx
import onnxruntime as ort
from onnxruntime.transformers import optimizer
from pathlib import Path
import numpy as np

class ONNXDeployer:
    """Deploy and optimize ONNX models."""

    def convert_from_pytorch(self, model, sample_input, output_path: str):
        """Convert PyTorch model to ONNX."""
        import torch

        torch.onnx.export(
            model,
            sample_input,
            output_path,
            export_params=True,
            opset_version=17,
            do_constant_folding=True,
            input_names=['input'],
            output_names=['output'],
            dynamic_axes={
                'input': {0: 'batch_size', 1: 'sequence'},
                'output': {0: 'batch_size'}
            }
        )

        # Verify the model
        onnx_model = onnx.load(output_path)
        onnx.checker.check_model(onnx_model)

        return output_path

    def optimize_for_inference(self, model_path: str, output_path: str):
        """Optimize ONNX model for inference."""
        optimized_model = optimizer.optimize_model(
            model_path,
            model_type='bert',  # or 'gpt2', 't5', etc.
            num_heads=12,
            hidden_size=768,
            optimization_options=optimizer.FusionOptions('bert')
        )

        optimized_model.save_model_to_file(output_path)
        return output_path

    def quantize_model(self, model_path: str, output_path: str, quant_type: str = 'int8'):
        """Quantize model for efficient inference."""
        from onnxruntime.quantization import quantize_dynamic, QuantType

        weight_type = QuantType.QInt8 if quant_type == 'int8' else QuantType.QUInt8

        quantize_dynamic(
            model_path,
            output_path,
            weight_type=weight_type,
            optimize_model=True
        )

        return output_path


class ONNXInference:
    """Run inference with ONNX models."""

    def __init__(self, model_path: str, device: str = 'auto'):
        self.model_path = model_path
        self.session = self._create_session(device)

    def _create_session(self, device: str) -> ort.InferenceSession:
        """Create inference session with optimal provider."""
        providers = self._get_providers(device)

        session_options = ort.SessionOptions()
        session_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        session_options.intra_op_num_threads = 4

        return ort.InferenceSession(
            self.model_path,
            session_options,
            providers=providers
        )

    def _get_providers(self, device: str) -> list:
        """Get execution providers based on device."""
        available = ort.get_available_providers()

        if device == 'auto':
            priority = ['CUDAExecutionProvider', 'DmlExecutionProvider',
                       'CoreMLExecutionProvider', 'CPUExecutionProvider']
            return [p for p in priority if p in available][:1] + ['CPUExecutionProvider']

        provider_map = {
            'cpu': ['CPUExecutionProvider'],
            'cuda': ['CUDAExecutionProvider', 'CPUExecutionProvider'],
            'directml': ['DmlExecutionProvider', 'CPUExecutionProvider'],
            'coreml': ['CoreMLExecutionProvider', 'CPUExecutionProvider']
        }
        return provider_map.get(device, ['CPUExecutionProvider'])

    def run(self, inputs: dict) -> dict:
        """Run inference."""
        outputs = self.session.run(None, inputs)
        output_names = [o.name for o in self.session.get_outputs()]
        return dict(zip(output_names, outputs))
```

ONNX enables train-once-deploy-anywhere for AI models across diverse hardware.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
