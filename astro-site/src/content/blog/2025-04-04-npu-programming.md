---
title: "NPU Programming: Leveraging Neural Processing Units"
description: "NPUs enable efficient on-device AI with 10-100x better power efficiency than CPUs."
author: Michael John Peña
draft: false
date: 2025-04-04
tags:
  - NPU
  - Hardware
  - AI
  - Performance
  - On-Device
---

## NPU Development Patterns

```python
# npu_inference.py - Optimizing for NPU execution

import onnxruntime as ort
import numpy as np
from pathlib import Path

class NPUInference:
    def __init__(self, model_path: str):
        self.model_path = model_path
        self.session = None
        self.provider = None

    def initialize(self):
        """Initialize ONNX Runtime with NPU provider."""
        available_providers = ort.get_available_providers()

        # Priority order for providers
        provider_priority = [
            'QNNExecutionProvider',      # Qualcomm NPU
            'DmlExecutionProvider',      # DirectML (AMD/Intel/Nvidia)
            'CoreMLExecutionProvider',   # Apple Neural Engine
            'CUDAExecutionProvider',     # NVIDIA GPU
            'CPUExecutionProvider'       # Fallback
        ]

        for provider in provider_priority:
            if provider in available_providers:
                self.provider = provider
                break

        print(f"Using provider: {self.provider}")

        session_options = ort.SessionOptions()
        session_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL

        if self.provider == 'DmlExecutionProvider':
            session_options.enable_mem_pattern = False  # Required for DML

        self.session = ort.InferenceSession(
            self.model_path,
            session_options,
            providers=[self.provider]
        )

    def run_inference(self, input_data: np.ndarray) -> np.ndarray:
        """Run inference on NPU."""
        input_name = self.session.get_inputs()[0].name
        output_name = self.session.get_outputs()[0].name

        result = self.session.run(
            [output_name],
            {input_name: input_data}
        )

        return result[0]


class NPUOptimizedModel:
    """Optimize models for NPU execution."""

    @staticmethod
    def quantize_for_npu(model_path: str, output_path: str):
        """Quantize model for efficient NPU execution."""
        from onnxruntime.quantization import quantize_dynamic, QuantType

        quantize_dynamic(
            model_path,
            output_path,
            weight_type=QuantType.QInt8,
            optimize_model=True
        )

    @staticmethod
    def benchmark_providers(model_path: str, input_shape: tuple, num_runs: int = 100):
        """Benchmark model across different providers."""
        import time

        results = {}
        test_input = np.random.randn(*input_shape).astype(np.float32)

        for provider in ort.get_available_providers():
            try:
                session = ort.InferenceSession(model_path, providers=[provider])
                input_name = session.get_inputs()[0].name

                # Warmup
                for _ in range(10):
                    session.run(None, {input_name: test_input})

                # Benchmark
                start = time.perf_counter()
                for _ in range(num_runs):
                    session.run(None, {input_name: test_input})
                elapsed = time.perf_counter() - start

                results[provider] = elapsed / num_runs * 1000  # ms per inference
            except Exception as e:
                results[provider] = f"Error: {e}"

        return results
```

NPUs enable efficient on-device AI with 10-100x better power efficiency than CPUs.
