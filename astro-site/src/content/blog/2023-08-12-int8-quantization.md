---
title: "INT8 Quantization: Practical Implementation Guide"
author: Michael John Peña
draft: false
date: 2023-08-12
tags:
  - INT8
  - Quantization
  - Model Optimization
  - Inference
---

## INT8 Fundamentals

```python
import numpy as np

# INT8 range: -128 to 127
# Quantization formula: q = round(x / scale) + zero_point
# Dequantization: x = (q - zero_point) * scale

def quantize_to_int8(tensor, symmetric=True):
    """Quantize FP32 tensor to INT8."""
    if symmetric:
        # Symmetric quantization (zero_point = 0)
        scale = tensor.abs().max() / 127
        quantized = (tensor / scale).round().clamp(-128, 127).to(torch.int8)
        return quantized, scale, 0
    else:
        # Asymmetric quantization
        min_val, max_val = tensor.min(), tensor.max()
        scale = (max_val - min_val) / 255
        zero_point = (-min_val / scale).round().to(torch.int8)
        quantized = ((tensor / scale) + zero_point).round().clamp(0, 255).to(torch.uint8)
        return quantized, scale, zero_point

def dequantize_from_int8(quantized, scale, zero_point):
    """Dequantize INT8 tensor back to FP32."""
    return (quantized.float() - zero_point) * scale
```

## LLM.int8() Implementation

```python
from transformers import AutoModelForCausalLM, AutoTokenizer
import torch

# LLM.int8() automatically handles outliers
model = AutoModelForCausalLM.from_pretrained(
    "meta-llama/Llama-2-7b-hf",
    load_in_8bit=True,
    device_map="auto",
    llm_int8_threshold=6.0,  # Threshold for outlier detection
    llm_int8_skip_modules=["lm_head"],  # Skip certain modules
    llm_int8_has_fp16_weight=False
)

tokenizer = AutoTokenizer.from_pretrained("meta-llama/Llama-2-7b-hf")

# Generate text
inputs = tokenizer("Hello, my name is", return_tensors="pt").to("cuda")
outputs = model.generate(**inputs, max_new_tokens=50)
print(tokenizer.decode(outputs[0]))
```

## ONNX INT8 Quantization

```python
from onnxruntime.quantization import quantize_dynamic, quantize_static
from onnxruntime.quantization import QuantType, CalibrationMethod

# Dynamic INT8 quantization
quantize_dynamic(
    model_input="model.onnx",
    model_output="model_int8_dynamic.onnx",
    weight_type=QuantType.QInt8
)

# Static INT8 quantization (requires calibration)
from onnxruntime.quantization import CalibrationDataReader

class MyCalibrationDataReader(CalibrationDataReader):
    def __init__(self, calibration_data):
        self.data = calibration_data
        self.index = 0

    def get_next(self):
        if self.index >= len(self.data):
            return None
        data = self.data[self.index]
        self.index += 1
        return data

calibration_reader = MyCalibrationDataReader(calibration_data)

quantize_static(
    model_input="model.onnx",
    model_output="model_int8_static.onnx",
    calibration_data_reader=calibration_reader,
    quant_format=QuantFormat.QDQ,
    calibrate_method=CalibrationMethod.MinMax
)
```

## TensorRT INT8

```python
import tensorrt as trt

def build_int8_engine(onnx_path, calibrator):
    logger = trt.Logger(trt.Logger.INFO)
    builder = trt.Builder(logger)
    network = builder.create_network(1 << int(trt.NetworkDefinitionCreationFlag.EXPLICIT_BATCH))
    parser = trt.OnnxParser(network, logger)

    # Parse ONNX
    with open(onnx_path, 'rb') as f:
        parser.parse(f.read())

    # Configure INT8
    config = builder.create_builder_config()
    config.set_flag(trt.BuilderFlag.INT8)
    config.int8_calibrator = calibrator

    # Build engine
    engine = builder.build_engine(network, config)
    return engine

# INT8 Calibrator
class Int8Calibrator(trt.IInt8EntropyCalibrator2):
    def __init__(self, data_loader, cache_file):
        trt.IInt8EntropyCalibrator2.__init__(self)
        self.data_loader = data_loader
        self.cache_file = cache_file
        self.batch_size = data_loader.batch_size

    def get_batch_size(self):
        return self.batch_size

    def get_batch(self, names):
        try:
            batch = next(self.data_iter)
            return [batch.data_ptr()]
        except StopIteration:
            return None

    def read_calibration_cache(self):
        if os.path.exists(self.cache_file):
            with open(self.cache_file, "rb") as f:
                return f.read()
        return None

    def write_calibration_cache(self, cache):
        with open(self.cache_file, "wb") as f:
            f.write(cache)
```

## Quantization-Aware Training

```python
import torch
from torch.quantization import prepare_qat, convert

# Define quantization config
model.qconfig = torch.quantization.get_default_qat_qconfig('fbgemm')

# Prepare for QAT
model.train()
model_prepared = prepare_qat(model)

# Training loop (with fake quantization)
optimizer = torch.optim.Adam(model_prepared.parameters(), lr=1e-4)

for epoch in range(num_epochs):
    for batch in train_loader:
        optimizer.zero_grad()
        outputs = model_prepared(**batch)
        loss = outputs.loss
        loss.backward()
        optimizer.step()

# Convert to quantized model
model_prepared.eval()
model_quantized = convert(model_prepared)
```

## Accuracy Preservation Techniques

```python
accuracy_techniques = {
    "mixed_precision": {
        "description": "Keep sensitive layers in FP16/FP32",
        "implementation": "Skip quantization for specific modules"
    },
    "outlier_handling": {
        "description": "Handle extreme values separately",
        "implementation": "LLM.int8() mixed-precision decomposition"
    },
    "calibration_quality": {
        "description": "Use representative calibration data",
        "tips": ["Diverse samples", "Edge cases", "Sufficient quantity"]
    },
    "per_channel": {
        "description": "Different scales per output channel",
        "benefit": "Better accuracy than per-tensor"
    }
}

# Per-channel quantization
def per_channel_quantize(weight, axis=0):
    """Quantize weights with per-channel scales."""
    scales = weight.abs().amax(dim=axis, keepdim=True) / 127
    quantized = (weight / scales).round().clamp(-128, 127).to(torch.int8)
    return quantized, scales
```

## Benchmarking INT8

```python
import time
import torch

def benchmark_quantization(model_fp32, model_int8, inputs, num_runs=100):
    results = {}

    # Warmup
    for _ in range(10):
        _ = model_fp32(**inputs)
        _ = model_int8(**inputs)

    # FP32 benchmark
    torch.cuda.synchronize()
    start = time.perf_counter()
    for _ in range(num_runs):
        _ = model_fp32(**inputs)
    torch.cuda.synchronize()
    results["fp32_ms"] = (time.perf_counter() - start) / num_runs * 1000

    # INT8 benchmark
    torch.cuda.synchronize()
    start = time.perf_counter()
    for _ in range(num_runs):
        _ = model_int8(**inputs)
    torch.cuda.synchronize()
    results["int8_ms"] = (time.perf_counter() - start) / num_runs * 1000

    results["speedup"] = results["fp32_ms"] / results["int8_ms"]
    return results

# Memory comparison
def memory_usage():
    torch.cuda.reset_peak_memory_stats()
    _ = model(**inputs)
    return torch.cuda.max_memory_allocated() / 1024**2  # MB
```

Tomorrow we'll explore model distillation techniques.

## Resources

- [LLM.int8() Paper](https://arxiv.org/abs/2208.07339)
- [PyTorch Quantization](https://pytorch.org/docs/stable/quantization.html)
- [ONNX Runtime Quantization](https://onnxruntime.ai/docs/performance/quantization.html)
