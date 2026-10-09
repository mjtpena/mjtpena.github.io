---
title: "NPU Development for AI PCs: A Deep Dive"
description: "Yesterday I introduced Copilot+ PCs. Today let's dive deep into developing applications that leverage the NPU effectively."
author: Michael John Peña
draft: false
date: 2024-05-10
tags:
  - NPU
  - AI PCs
  - Windows AI
  - DirectML
  - ONNX
---

Yesterday I introduced Copilot+ PCs. Today let's dive deep into developing applications that leverage the NPU effectively.

## Understanding NPU Architecture

NPUs are optimized for specific operations common in neural networks:

```
Highly Optimized:
├── Matrix multiplication (GEMM)
├── Convolution (Conv2D)
├── Activation functions (ReLU, GELU, Sigmoid)
├── Normalization (LayerNorm, BatchNorm)
└── Attention mechanisms (for transformers)

Less Optimized (may fall back to CPU):
├── Complex control flow
├── Dynamic shapes
├── Sparse operations
└── Custom kernels
```

## DirectML: The Foundation

DirectML is Microsoft's low-level API for machine learning on Windows:

```cpp
#include <DirectML.h>
#include <d3d12.h>

// Initialize DirectML
ComPtr<ID3D12Device> d3d12Device;
D3D12CreateDevice(nullptr, D3D_FEATURE_LEVEL_12_0, IID_PPV_ARGS(&d3d12Device));

DML_CREATE_DEVICE_FLAGS dmlFlags = DML_CREATE_DEVICE_FLAG_NONE;
ComPtr<IDMLDevice> dmlDevice;
DMLCreateDevice(d3d12Device.Get(), dmlFlags, IID_PPV_ARGS(&dmlDevice));

// Create an operator (e.g., GEMM)
DML_GEMM_OPERATOR_DESC gemmDesc = {};
gemmDesc.ATensor = &inputATensor;
gemmDesc.BTensor = &inputBTensor;
gemmDesc.CTensor = nullptr;
gemmDesc.OutputTensor = &outputTensor;
gemmDesc.TransA = DML_MATRIX_TRANSFORM_NONE;
gemmDesc.TransB = DML_MATRIX_TRANSFORM_NONE;
gemmDesc.Alpha = 1.0f;
gemmDesc.Beta = 0.0f;

DML_OPERATOR_DESC opDesc = { DML_OPERATOR_GEMM, &gemmDesc };
ComPtr<IDMLOperator> gemmOperator;
dmlDevice->CreateOperator(&opDesc, IID_PPV_ARGS(&gemmOperator));
```

## High-Level API: Windows ML

For most developers, Windows ML provides a simpler interface:

```csharp
using Windows.AI.MachineLearning;
using Windows.Storage;

public class NpuInference
{
    private LearningModel _model;
    private LearningModelSession _session;
    private LearningModelBinding _binding;

    public async Task InitializeAsync(string modelPath)
    {
        // Load the ONNX model
        var file = await StorageFile.GetFileFromPathAsync(modelPath);
        _model = await LearningModel.LoadFromStorageFileAsync(file);

        // Create session targeting NPU
        var device = new LearningModelDevice(LearningModelDeviceKind.DirectXHighPerformance);
        _session = new LearningModelSession(_model, device);

        _binding = new LearningModelBinding(_session);
    }

    public async Task<float[]> RunInferenceAsync(float[] inputData)
    {
        // Create input tensor
        var inputShape = new long[] { 1, 3, 224, 224 };
        var inputTensor = TensorFloat.CreateFromArray(inputShape, inputData);

        // Bind input
        _binding.Bind("input", inputTensor);

        // Run inference
        var results = await _session.EvaluateAsync(_binding, "run1");

        // Extract output
        var outputTensor = results.Outputs["output"] as TensorFloat;
        return outputTensor.GetAsVectorView().ToArray();
    }
}
```

## ONNX Runtime for NPU

```python
import onnxruntime as ort
import numpy as np

class NpuModelRunner:
    def __init__(self, model_path: str):
        # Configure for NPU via DirectML
        self.session_options = ort.SessionOptions()
        self.session_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL

        # Create session with DirectML provider
        self.session = ort.InferenceSession(
            model_path,
            sess_options=self.session_options,
            providers=['DmlExecutionProvider', 'CPUExecutionProvider']
        )

        # Get input/output info
        self.input_name = self.session.get_inputs()[0].name
        self.input_shape = self.session.get_inputs()[0].shape
        self.output_name = self.session.get_outputs()[0].name

    def run(self, input_data: np.ndarray) -> np.ndarray:
        # Ensure correct dtype and shape
        input_data = input_data.astype(np.float32)
        if input_data.shape != tuple(self.input_shape):
            raise ValueError(f"Expected shape {self.input_shape}, got {input_data.shape}")

        # Run inference
        outputs = self.session.run(
            [self.output_name],
            {self.input_name: input_data}
        )

        return outputs[0]

    def get_provider_info(self) -> dict:
        """Get information about active providers."""
        return {
            "providers": self.session.get_providers(),
            "device": self.session.get_provider_options()
        }

# Usage
runner = NpuModelRunner("phi3-mini.onnx")
print(f"Active providers: {runner.get_provider_info()}")

input_tokens = np.array([[101, 2023, 2003, 1037, 3231, 102]], dtype=np.int64)
output = runner.run(input_tokens)
```

## Model Optimization Pipeline

```python
import onnx
from onnxruntime.transformers import optimizer
from onnxruntime.quantization import quantize_dynamic, QuantType

def optimize_for_npu(input_model: str, output_model: str):
    """Optimize ONNX model for NPU inference."""

    # Step 1: Load and check model
    model = onnx.load(input_model)
    onnx.checker.check_model(model)

    # Step 2: Graph optimization
    optimized = optimizer.optimize_model(
        input_model,
        model_type='bert',  # or 'gpt2', 'vit', etc.
        num_heads=12,
        hidden_size=768,
        optimization_options=optimizer.FusionOptions(
            enable_gelu=True,
            enable_layer_norm=True,
            enable_attention=True,
            enable_skip_layer_norm=True,
            enable_embed_layer_norm=True,
            enable_bias_gelu=True,
            enable_bias_skip_layer_norm=True
        )
    )

    optimized_path = input_model.replace('.onnx', '_optimized.onnx')
    optimized.save_model_to_file(optimized_path)

    # Step 3: Quantization for NPU
    quantize_dynamic(
        model_input=optimized_path,
        model_output=output_model,
        weight_type=QuantType.QUInt8,
        per_channel=True,
        reduce_range=False
    )

    # Step 4: Verify final model
    final_model = onnx.load(output_model)
    onnx.checker.check_model(final_model)

    return output_model

# Usage
optimized_model = optimize_for_npu(
    "model_fp32.onnx",
    "model_npu_optimized.onnx"
)
```

## Benchmarking NPU Performance

```python
import time
import statistics
from typing import List, Dict

class NpuBenchmark:
    def __init__(self, model_path: str):
        self.model_path = model_path

    def run_benchmark(
        self,
        input_data: np.ndarray,
        iterations: int = 100,
        warmup: int = 10
    ) -> Dict:
        # Test both CPU and NPU
        results = {}

        for provider in [['CPUExecutionProvider'], ['DmlExecutionProvider']]:
            session = ort.InferenceSession(
                self.model_path,
                providers=provider
            )

            input_name = session.get_inputs()[0].name

            # Warmup
            for _ in range(warmup):
                session.run(None, {input_name: input_data})

            # Benchmark
            latencies = []
            for _ in range(iterations):
                start = time.perf_counter()
                session.run(None, {input_name: input_data})
                latencies.append((time.perf_counter() - start) * 1000)

            provider_name = provider[0].replace('ExecutionProvider', '')
            results[provider_name] = {
                'mean_ms': statistics.mean(latencies),
                'std_ms': statistics.stdev(latencies),
                'min_ms': min(latencies),
                'max_ms': max(latencies),
                'p50_ms': statistics.median(latencies),
                'p95_ms': sorted(latencies)[int(len(latencies) * 0.95)],
                'throughput': 1000 / statistics.mean(latencies)
            }

        # Calculate speedup
        if 'CPU' in results and 'Dml' in results:
            results['speedup'] = results['CPU']['mean_ms'] / results['Dml']['mean_ms']

        return results

# Usage
benchmark = NpuBenchmark("model_optimized.onnx")
input_data = np.random.randn(1, 3, 224, 224).astype(np.float32)

results = benchmark.run_benchmark(input_data, iterations=100)
print(f"CPU: {results['CPU']['mean_ms']:.2f}ms")
print(f"NPU: {results['Dml']['mean_ms']:.2f}ms")
print(f"Speedup: {results['speedup']:.2f}x")
```

## Handling Unsupported Operations

```python
class HybridInference:
    """Run models with some ops on NPU, fallback for others."""

    def __init__(self, model_path: str):
        self.session_options = ort.SessionOptions()

        # Enable fallback to CPU for unsupported ops
        self.session = ort.InferenceSession(
            model_path,
            sess_options=self.session_options,
            providers=[
                ('DmlExecutionProvider', {
                    'device_id': 0,
                    'performance_preference': 'high_performance'
                }),
                'CPUExecutionProvider'
            ]
        )

    def get_node_placement(self) -> Dict[str, str]:
        """See which ops run on which device."""
        # This requires profiling the session
        return self.session.get_provider_options()
```

## Power Management

```csharp
public class PowerAwareInference
{
    private readonly LearningModelSession _npuSession;
    private readonly LearningModelSession _cpuSession;

    public async Task<float[]> RunInferenceAsync(
        float[] input,
        PowerMode powerMode)
    {
        var session = powerMode switch
        {
            PowerMode.BestPerformance => _npuSession,
            PowerMode.BatterySaver => _cpuSession,  // CPU can be lower power
            PowerMode.Balanced => await SelectBestSessionAsync(),
            _ => _npuSession
        };

        return await RunOnSessionAsync(session, input);
    }

    private async Task<LearningModelSession> SelectBestSessionAsync()
    {
        // Check battery status
        var battery = Battery.AggregateBattery;
        var report = battery.GetReport();

        if (report.Status == BatteryStatus.Discharging &&
            report.RemainingCapacityInMilliwattHours < 5000)
        {
            // Low battery - use more efficient path
            return _cpuSession;  // Or throttled NPU
        }

        return _npuSession;
    }
}
```

## Best Practices

1. **Profile first** - Measure before optimizing
2. **Quantize models** - INT8 often runs faster on NPU
3. **Batch when possible** - NPUs handle batches efficiently
4. **Handle fallback** - Not all ops are NPU-accelerated
5. **Consider power** - NPU efficiency helps battery life

## What's Next

Tomorrow I'll cover local AI models and the Phi-3 family from Microsoft.

## Resources

- [DirectML Documentation](https://learn.microsoft.com/windows/ai/directml/)
- [Windows ML](https://learn.microsoft.com/windows/ai/windows-ml/)
- [ONNX Runtime DirectML](https://onnxruntime.ai/docs/execution-providers/DirectML-ExecutionProvider.html)
- [Model Optimization Guide](https://onnxruntime.ai/docs/performance/model-optimizations/)
