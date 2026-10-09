---
title: "ONNX Runtime: Optimizing Model Inference"
description: "ONNX Runtime is the inference engine I reach for when a Python-trained model needs to be deployed somewhere other than a Python service — a .NET…"
author: Michael John Peña
draft: false
date: 2023-08-09
tags:
  - ONNX
  - Model Optimization
  - Inference
  - Performance
---

ONNX Runtime is the inference engine I reach for when a Python-trained model needs to be deployed somewhere other than a Python service — a .NET application, a mobile device, or an environment where the PyTorch runtime is too large a dependency. The workflow is: train a model in PyTorch, export it to the ONNX format with `torch.onnx.export()`, and run inference with `onnxruntime.InferenceSession`. ONNX Runtime then applies its own graph optimisations (constant folding, operator fusion, memory layout optimisation) and can target hardware-specific execution providers: CUDA EP for NVIDIA GPUs, DirectML EP for Windows GPU, TensorRT EP for NVIDIA with maximum throughput, or CPU EP for everything else. For transformer models specifically, the ONNX Runtime optimiser includes transformer-specific fusion passes (attention head fusion, layer normalisation fusion) that give meaningfully faster CPU inference than standard PyTorch for smaller models like BERT and DistilBERT.

## Understanding ONNX

```python
# ONNX (Open Neural Network Exchange)
onnx_overview = {
    "what": "Open format for ML models",
    "benefits": [
        "Framework interoperability",
        "Optimized inference runtime",
        "Hardware acceleration",
        "Cross-platform deployment"
    ],
    "supported_frameworks": [
        "PyTorch",
        "TensorFlow",
        "scikit-learn",
        "Keras"
    ]
}

# Installation
# pip install onnx onnxruntime
# pip install onnxruntime-gpu  # For GPU support
```

## Converting PyTorch to ONNX

```python
import torch
import onnx
from transformers import AutoModelForSequenceClassification, AutoTokenizer

# Load PyTorch model
model_name = "distilbert-base-uncased-finetuned-sst-2-english"
model = AutoModelForSequenceClassification.from_pretrained(model_name)
tokenizer = AutoTokenizer.from_pretrained(model_name)

# Prepare dummy input
dummy_input = tokenizer(
    "Hello, this is a test",
    return_tensors="pt",
    padding="max_length",
    max_length=128,
    truncation=True
)

# Export to ONNX
torch.onnx.export(
    model,
    (dummy_input["input_ids"], dummy_input["attention_mask"]),
    "model.onnx",
    input_names=["input_ids", "attention_mask"],
    output_names=["logits"],
    dynamic_axes={
        "input_ids": {0: "batch_size", 1: "sequence"},
        "attention_mask": {0: "batch_size", 1: "sequence"},
        "logits": {0: "batch_size"}
    },
    opset_version=14
)

# Verify the model
onnx_model = onnx.load("model.onnx")
onnx.checker.check_model(onnx_model)
print("ONNX model is valid!")
```

## Using Optimum for Transformers

```python
# pip install optimum[onnxruntime]
from optimum.onnxruntime import ORTModelForSequenceClassification
from transformers import AutoTokenizer

# Direct export and load
model = ORTModelForSequenceClassification.from_pretrained(
    model_name,
    export=True  # Automatically exports to ONNX
)
tokenizer = AutoTokenizer.from_pretrained(model_name)

# Save ONNX model
model.save_pretrained("./onnx_model")

# Load saved ONNX model
model = ORTModelForSequenceClassification.from_pretrained("./onnx_model")

# Inference (same API as Transformers)
inputs = tokenizer("This is great!", return_tensors="pt")
outputs = model(**inputs)
```

## Running Inference with ONNX Runtime

```python
import onnxruntime as ort
import numpy as np

# Create inference session
session = ort.InferenceSession(
    "model.onnx",
    providers=["CUDAExecutionProvider", "CPUExecutionProvider"]
)

# Check available providers
print(ort.get_available_providers())

# Prepare input
text = "This movie is amazing!"
inputs = tokenizer(text, return_tensors="np", padding="max_length", max_length=128)

# Run inference
outputs = session.run(
    None,  # Get all outputs
    {
        "input_ids": inputs["input_ids"],
        "attention_mask": inputs["attention_mask"]
    }
)

logits = outputs[0]
predicted_class = np.argmax(logits, axis=-1)
print(f"Predicted class: {predicted_class}")
```

## Optimizing ONNX Models

```python
from onnxruntime.transformers import optimizer
from onnxruntime.transformers.fusion_options import FusionOptions

# Optimize for BERT-like models
optimized_model_path = optimizer.optimize_model(
    "model.onnx",
    model_type="bert",
    num_heads=12,
    hidden_size=768,
    optimization_options=FusionOptions("bert")
)
optimized_model_path.save_model_to_file("model_optimized.onnx")

# Or use optimum
from optimum.onnxruntime import ORTOptimizer
from optimum.onnxruntime.configuration import OptimizationConfig

optimizer = ORTOptimizer.from_pretrained(model)
optimization_config = OptimizationConfig(
    optimization_level=99,
    optimize_for_gpu=True
)
optimizer.optimize(
    save_dir="./optimized_model",
    optimization_config=optimization_config
)
```

## Quantization

```python
from onnxruntime.quantization import quantize_dynamic, QuantType

# Dynamic quantization (INT8)
quantize_dynamic(
    model_input="model.onnx",
    model_output="model_quantized.onnx",
    weight_type=QuantType.QInt8
)

# Using Optimum for quantization
from optimum.onnxruntime import ORTQuantizer
from optimum.onnxruntime.configuration import AutoQuantizationConfig

quantizer = ORTQuantizer.from_pretrained(model)
quantization_config = AutoQuantizationConfig.avx512_vnni(
    is_static=False,
    per_channel=False
)
quantizer.quantize(
    save_dir="./quantized_model",
    quantization_config=quantization_config
)
```

## Performance Comparison

```python
import time
import numpy as np

def benchmark_inference(model_path, inputs, num_runs=100):
    session = ort.InferenceSession(model_path)

    # Warmup
    for _ in range(10):
        session.run(None, inputs)

    # Benchmark
    times = []
    for _ in range(num_runs):
        start = time.perf_counter()
        session.run(None, inputs)
        times.append(time.perf_counter() - start)

    return {
        "mean_ms": np.mean(times) * 1000,
        "std_ms": np.std(times) * 1000,
        "min_ms": np.min(times) * 1000,
        "max_ms": np.max(times) * 1000
    }

# Compare models
inputs = {
    "input_ids": np.random.randint(0, 30000, (1, 128)).astype(np.int64),
    "attention_mask": np.ones((1, 128), dtype=np.int64)
}

original = benchmark_inference("model.onnx", inputs)
optimized = benchmark_inference("model_optimized.onnx", inputs)
quantized = benchmark_inference("model_quantized.onnx", inputs)

print(f"Original: {original['mean_ms']:.2f}ms")
print(f"Optimized: {optimized['mean_ms']:.2f}ms")
print(f"Quantized: {quantized['mean_ms']:.2f}ms")
```

## Session Options

```python
# Configure session for performance
session_options = ort.SessionOptions()

# Enable optimizations
session_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL

# Set number of threads
session_options.intra_op_num_threads = 4
session_options.inter_op_num_threads = 4

# Enable memory pattern optimization
session_options.enable_mem_pattern = True
session_options.enable_cpu_mem_arena = True

# Create session with options
session = ort.InferenceSession(
    "model.onnx",
    sess_options=session_options,
    providers=["CUDAExecutionProvider", "CPUExecutionProvider"]
)
```

## Deployment Considerations

```python
deployment_tips = {
    "model_selection": {
        "cpu": "Use quantized INT8 models",
        "gpu": "Use FP16 models with CUDA provider"
    },
    "batching": {
        "tip": "Use dynamic batching for throughput",
        "implementation": "Configure dynamic axes during export"
    },
    "memory": {
        "tip": "Use session options to control memory",
        "arena": "Enable memory arena for faster allocation"
    },
    "providers": {
        "priority": ["TensorrtExecutionProvider", "CUDAExecutionProvider", "CPUExecutionProvider"]
    }
}
```

Tomorrow we'll explore model optimization techniques in detail.

## Resources

- [ONNX Runtime Documentation](https://onnxruntime.ai/docs/)
- [Optimum Library](https://huggingface.co/docs/optimum/onnxruntime/overview)
- [ONNX Model Zoo](https://github.com/onnx/models)
