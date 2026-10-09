---
title: "DirectML: Hardware-Accelerated AI on Windows"
description: "DirectML is Microsoft's hardware-accelerated machine learning API that works across all DirectX 12 GPUs. Today I'm exploring how to leverage it for…"
author: Michael John Peña
draft: false
date: 2024-05-16
tags:
  - AI
  - DirectML
  - Windows
  - GPU
  - NPU
---

DirectML is Microsoft's hardware-accelerated machine learning API that works across all DirectX 12 GPUs. Today I'm exploring how to leverage it for high-performance AI inference on Windows.

## What is DirectML?

DirectML provides:
- **Vendor-agnostic GPU acceleration**: Works with NVIDIA, AMD, Intel, Qualcomm
- **NPU support**: Leverages neural processing units when available
- **Consistent API**: Same code works across hardware
- **Windows integration**: Part of the Windows AI platform

## DirectML Architecture

```
Application
    ↓
ONNX Runtime / DirectML API
    ↓
DirectML Runtime
    ↓
DirectX 12
    ↓
GPU / NPU Driver
    ↓
Hardware
```

## Using DirectML with ONNX Runtime

```python
import onnxruntime as ort
import numpy as np

# Check if DirectML is available
providers = ort.get_available_providers()
print(f"Available providers: {providers}")

if 'DmlExecutionProvider' in providers:
    print("DirectML is available!")

# Create session with DirectML
session_options = ort.SessionOptions()
session_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL

session = ort.InferenceSession(
    "model.onnx",
    sess_options=session_options,
    providers=['DmlExecutionProvider', 'CPUExecutionProvider']
)

# Run inference
input_data = np.random.randn(1, 3, 224, 224).astype(np.float32)
outputs = session.run(None, {"input": input_data})
print(f"Output shape: {outputs[0].shape}")
```

## Device Selection

```python
# List available DirectML devices
import onnxruntime as ort

def list_dml_devices():
    """List all DirectML-capable devices."""
    # Try each device ID
    devices = []
    for device_id in range(10):  # Check up to 10 devices
        try:
            session = ort.InferenceSession(
                "model.onnx",
                providers=[
                    ('DmlExecutionProvider', {'device_id': device_id}),
                    'CPUExecutionProvider'
                ]
            )
            # If we get here, device exists
            devices.append({
                'device_id': device_id,
                'provider': session.get_providers()[0]
            })
        except:
            break
    return devices

# Select specific GPU
dml_options = {
    'device_id': 0,  # First GPU
    'performance_preference': 'high_performance',
    'disable_metacommands': False
}

session = ort.InferenceSession(
    "model.onnx",
    providers=[
        ('DmlExecutionProvider', dml_options),
        'CPUExecutionProvider'
    ]
)
```

## Low-Level DirectML API

For maximum control, use DirectML directly:

```cpp
#include <DirectML.h>
#include <d3d12.h>

class DirectMLInference {
public:
    DirectMLInference() {
        // Create D3D12 device
        D3D12CreateDevice(
            nullptr,
            D3D_FEATURE_LEVEL_12_0,
            IID_PPV_ARGS(&d3d12Device)
        );

        // Create DirectML device
        DML_CREATE_DEVICE_FLAGS dmlFlags = DML_CREATE_DEVICE_FLAG_NONE;
        DMLCreateDevice(
            d3d12Device.Get(),
            dmlFlags,
            IID_PPV_ARGS(&dmlDevice)
        );

        // Create command queue
        D3D12_COMMAND_QUEUE_DESC queueDesc = {};
        queueDesc.Type = D3D12_COMMAND_LIST_TYPE_DIRECT;
        d3d12Device->CreateCommandQueue(
            &queueDesc,
            IID_PPV_ARGS(&commandQueue)
        );
    }

    void CreateConvolutionOperator(
        const DML_TENSOR_DESC& inputTensor,
        const DML_TENSOR_DESC& filterTensor,
        const DML_TENSOR_DESC& outputTensor
    ) {
        DML_CONVOLUTION_OPERATOR_DESC convDesc = {};
        convDesc.InputTensor = &inputTensor;
        convDesc.FilterTensor = &filterTensor;
        convDesc.OutputTensor = &outputTensor;
        convDesc.Mode = DML_CONVOLUTION_MODE_CROSS_CORRELATION;
        convDesc.Direction = DML_CONVOLUTION_DIRECTION_FORWARD;
        convDesc.DimensionCount = 2;

        UINT strides[] = { 1, 1 };
        UINT dilations[] = { 1, 1 };
        UINT paddings[] = { 0, 0, 0, 0 };

        convDesc.Strides = strides;
        convDesc.Dilations = dilations;
        convDesc.StartPadding = paddings;
        convDesc.EndPadding = paddings + 2;

        DML_OPERATOR_DESC opDesc = {
            DML_OPERATOR_CONVOLUTION,
            &convDesc
        };

        dmlDevice->CreateOperator(&opDesc, IID_PPV_ARGS(&convOperator));
    }

private:
    ComPtr<ID3D12Device> d3d12Device;
    ComPtr<IDMLDevice> dmlDevice;
    ComPtr<ID3D12CommandQueue> commandQueue;
    ComPtr<IDMLOperator> convOperator;
};
```

## Python with DirectML Extension

```python
import torch
import torch_directml

# Get DirectML device
dml_device = torch_directml.device()
print(f"Using device: {dml_device}")

# Move model to DirectML
model = MyModel()
model = model.to(dml_device)

# Inference
input_data = torch.randn(1, 3, 224, 224).to(dml_device)
with torch.no_grad():
    output = model(input_data)

print(f"Output shape: {output.shape}")
```

## Optimizing for DirectML

### Memory Management

```python
import onnxruntime as ort
import numpy as np

class DirectMLOptimizedInference:
    def __init__(self, model_path: str, device_id: int = 0):
        # Configure for optimal DirectML performance
        sess_options = ort.SessionOptions()

        # Enable memory pattern optimization
        sess_options.enable_mem_pattern = True

        # Enable memory arena (reduces allocations)
        sess_options.enable_cpu_mem_arena = False  # Disable CPU arena

        # Set graph optimization level
        sess_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL

        self.session = ort.InferenceSession(
            model_path,
            sess_options=sess_options,
            providers=[
                ('DmlExecutionProvider', {
                    'device_id': device_id,
                    'performance_preference': 'high_performance'
                })
            ]
        )

        # Pre-allocate IO binding
        self.io_binding = self.session.io_binding()

    def run_optimized(self, input_data: np.ndarray) -> np.ndarray:
        """Run inference with optimized memory handling."""
        # Bind input
        input_tensor = ort.OrtValue.ortvalue_from_numpy(input_data)
        self.io_binding.bind_input(
            name='input',
            device_type='dml',
            device_id=0,
            element_type=np.float32,
            shape=input_data.shape,
            buffer_ptr=input_tensor.data_ptr()
        )

        # Bind output
        self.io_binding.bind_output('output', 'dml')

        # Run
        self.session.run_with_iobinding(self.io_binding)

        # Get output
        return self.io_binding.copy_outputs_to_cpu()[0]
```

### Batch Processing

```python
def optimal_batch_size(session, input_shape, target_memory_gb=4):
    """Find optimal batch size for DirectML."""
    # Estimate memory per sample (rough approximation)
    sample_memory = np.prod(input_shape[1:]) * 4 * 3  # Input + intermediate + output

    max_batch = int((target_memory_gb * 1e9) / sample_memory)

    # Test increasing batch sizes
    best_batch = 1
    best_throughput = 0

    for batch_size in [1, 2, 4, 8, 16, 32, 64, 128]:
        if batch_size > max_batch:
            break

        try:
            input_data = np.random.randn(batch_size, *input_shape[1:]).astype(np.float32)

            # Warmup
            for _ in range(3):
                session.run(None, {'input': input_data})

            # Benchmark
            import time
            start = time.perf_counter()
            iterations = 10
            for _ in range(iterations):
                session.run(None, {'input': input_data})
            elapsed = time.perf_counter() - start

            throughput = (batch_size * iterations) / elapsed
            if throughput > best_throughput:
                best_throughput = throughput
                best_batch = batch_size

        except Exception as e:
            print(f"Batch size {batch_size} failed: {e}")
            break

    return best_batch, best_throughput
```

## DirectML vs CUDA Comparison

```python
import time

def compare_providers(model_path, input_shape, iterations=100):
    results = {}

    for provider in ['DmlExecutionProvider', 'CUDAExecutionProvider', 'CPUExecutionProvider']:
        try:
            session = ort.InferenceSession(
                model_path,
                providers=[provider]
            )

            input_data = np.random.randn(*input_shape).astype(np.float32)

            # Warmup
            for _ in range(10):
                session.run(None, {'input': input_data})

            # Benchmark
            start = time.perf_counter()
            for _ in range(iterations):
                session.run(None, {'input': input_data})
            elapsed = time.perf_counter() - start

            results[provider] = {
                'total_time': elapsed,
                'avg_latency_ms': (elapsed / iterations) * 1000,
                'throughput': iterations / elapsed
            }
        except Exception as e:
            results[provider] = {'error': str(e)}

    return results

# Run comparison
results = compare_providers("model.onnx", (1, 3, 224, 224))
for provider, metrics in results.items():
    if 'error' not in metrics:
        print(f"{provider}: {metrics['avg_latency_ms']:.2f}ms, {metrics['throughput']:.1f}/s")
```

## Supported Operations

DirectML supports most common ML operations:

| Category | Operations |
|----------|------------|
| Convolution | Conv, ConvTranspose, DepthwiseConv |
| Pooling | MaxPool, AveragePool, GlobalPool |
| Activation | ReLU, GELU, Sigmoid, Tanh, Softmax |
| Normalization | BatchNorm, LayerNorm, InstanceNorm |
| Linear | MatMul, Gemm, FullyConnected |
| Attention | MultiHeadAttention (fused) |

## Troubleshooting

```python
def diagnose_directml():
    """Diagnose DirectML setup."""
    import onnxruntime as ort

    print("ONNX Runtime version:", ort.__version__)
    print("Available providers:", ort.get_available_providers())

    if 'DmlExecutionProvider' not in ort.get_available_providers():
        print("\nDirectML not available. Check:")
        print("1. Windows 10 version 1903+ or Windows 11")
        print("2. DirectX 12 compatible GPU")
        print("3. onnxruntime-directml package installed")
        return

    # Try to create session
    try:
        session = ort.InferenceSession(
            "model.onnx",
            providers=['DmlExecutionProvider']
        )
        print("\nDirectML session created successfully!")
        print("Active provider:", session.get_providers()[0])
    except Exception as e:
        print(f"\nFailed to create session: {e}")
```

## Best Practices

1. **Use ONNX Runtime** - Easiest way to leverage DirectML
2. **Optimize models** - Graph optimization and quantization help
3. **Batch appropriately** - Find optimal batch size for your GPU
4. **Use IO binding** - Reduce CPU-GPU transfers
5. **Profile performance** - Use PIX or GPU profilers

## What's Next

Tomorrow I'll cover the Windows AI Recall feature and its implications.

## Resources

- [DirectML Documentation](https://learn.microsoft.com/windows/ai/directml/)
- [ONNX Runtime DirectML](https://onnxruntime.ai/docs/execution-providers/DirectML-ExecutionProvider.html)
- [PyTorch DirectML](https://github.com/microsoft/DirectML)
