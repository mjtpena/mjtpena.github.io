---
title: "Quantization Techniques: Shrinking Models Without Losing Quality"
author: Michael John Peña
draft: false
date: 2025-04-13
tags:
  - AI
  - Quantization
  - Optimization
  - Models
  - Efficiency

---

I wrote "Quantization Techniques: Shrinking Models Without Losing Quality" to share practical, production-minded guidance on this topic.

## Quantization Methods

```python
# quantization.py - Model quantization techniques

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
import onnxruntime as ort
from onnxruntime.quantization import quantize_dynamic, quantize_static, QuantType

class ModelQuantizer:
    """Quantize models for efficient deployment."""

    @staticmethod
    def load_4bit(model_name: str):
        """Load model with 4-bit quantization using bitsandbytes."""
        bnb_config = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_compute_dtype=torch.float16,
            bnb_4bit_use_double_quant=True
        )

        model = AutoModelForCausalLM.from_pretrained(
            model_name,
            quantization_config=bnb_config,
            device_map="auto"
        )
        tokenizer = AutoTokenizer.from_pretrained(model_name)

        return model, tokenizer

    @staticmethod
    def load_8bit(model_name: str):
        """Load model with 8-bit quantization."""
        model = AutoModelForCausalLM.from_pretrained(
            model_name,
            load_in_8bit=True,
            device_map="auto"
        )
        tokenizer = AutoTokenizer.from_pretrained(model_name)

        return model, tokenizer

    @staticmethod
    def quantize_onnx_dynamic(model_path: str, output_path: str):
        """Apply dynamic quantization to ONNX model."""
        quantize_dynamic(
            model_input=model_path,
            model_output=output_path,
            weight_type=QuantType.QInt8,
            optimize_model=True
        )

    @staticmethod
    def quantize_onnx_static(model_path: str, output_path: str, calibration_data):
        """Apply static quantization with calibration."""
        from onnxruntime.quantization import CalibrationDataReader

        class DataReader(CalibrationDataReader):
            def __init__(self, data):
                self.data = data
                self.index = 0

            def get_next(self):
                if self.index >= len(self.data):
                    return None
                item = self.data[self.index]
                self.index += 1
                return item

        quantize_static(
            model_input=model_path,
            model_output=output_path,
            calibration_data_reader=DataReader(calibration_data),
            quant_format=QuantFormat.QDQ,
            per_channel=True,
            weight_type=QuantType.QInt8
        )


class QuantizationBenchmark:
    """Benchmark quantized models."""

    def __init__(self):
        self.results = {}

    def benchmark(self, model_path: str, test_inputs: list, num_runs: int = 100):
        """Benchmark model performance."""
        session = ort.InferenceSession(model_path)

        # Warmup
        for _ in range(10):
            session.run(None, test_inputs[0])

        # Benchmark
        import time
        latencies = []
        for _ in range(num_runs):
            start = time.perf_counter()
            for inp in test_inputs:
                session.run(None, inp)
            latencies.append(time.perf_counter() - start)

        return {
            "avg_latency_ms": np.mean(latencies) * 1000,
            "p99_latency_ms": np.percentile(latencies, 99) * 1000,
            "throughput": len(test_inputs) / np.mean(latencies)
        }

    def compare_quality(self, original_model, quantized_model, test_cases: list):
        """Compare output quality between original and quantized."""
        differences = []

        for case in test_cases:
            original_output = original_model.generate(case)
            quantized_output = quantized_model.generate(case)

            similarity = self.compute_similarity(original_output, quantized_output)
            differences.append(similarity)

        return {
            "avg_similarity": np.mean(differences),
            "min_similarity": np.min(differences)
        }

# Quantization comparison
# | Method | Size Reduction | Speed Improvement | Quality Loss |
# |--------|----------------|-------------------|--------------|
# | FP16   | 2x             | 1.5-2x            | <1%          |
# | INT8   | 4x             | 2-4x              | 1-3%         |
# | INT4   | 8x             | 3-5x              | 2-5%         |
```

Strategic quantization enables deploying large models on resource-constrained devices.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
