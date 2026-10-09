---
title: "The Rise of AI PCs: NPUs and Local AI Processing"
description: "NPU wins on efficiency, crucial for battery life."
author: Michael John Peña
draft: false
date: 2024-05-09
tags:
  - Microsoft
  - AI PCs
  - Windows
  - NPU
  - Edge AI
---

## What is an NPU?

NPUs (Neural Processing Units) are dedicated silicon for AI inference:

```
Workload Distribution:

CPU: General computing, complex logic
- Good at: Sequential tasks, branching logic
- AI performance: 1-5 TOPS
- Power: 15-65W (laptop)

GPU: Parallel compute, graphics
- Good at: Matrix operations, training
- AI performance: 50-200 TOPS
- Power: 30-150W (discrete)

NPU: AI inference, always-on AI
- Good at: Efficient inference, low power
- AI performance: 10-40+ TOPS
- Power: 5-15W
```

## Current NPU Landscape

Several chips now include NPUs:

| Chip | NPU Performance | Platform |
|------|-----------------|----------|
| Intel Core Ultra | 10+ TOPS | Windows |
| AMD Ryzen AI | 10+ TOPS | Windows |
| Apple M3 | 18 TOPS | macOS |
| Qualcomm Snapdragon X | 45 TOPS | Windows (coming) |

## Developing for NPU

### Windows AI APIs

```csharp
using Microsoft.AI.MachineLearning;

// Check for NPU availability
var devices = LearningModelDevice.GetAvailableDevices();
var npuDevice = devices.FirstOrDefault(d =>
    d.Kind == LearningModelDeviceKind.DirectXHighPerformance);

if (npuDevice != null)
{
    Console.WriteLine($"NPU-capable device found");
}

// Load model
var model = await LearningModel.LoadFromFilePath("model.onnx");
var session = new LearningModelSession(model, npuDevice);
```

### DirectML Integration

```csharp
using Microsoft.ML.OnnxRuntime;

// Create session with DirectML execution provider
var sessionOptions = new SessionOptions();
sessionOptions.AppendExecutionProvider_DML(0);

using var session = new InferenceSession("model.onnx", sessionOptions);

// Run inference
var inputs = new List<NamedOnnxValue>
{
    NamedOnnxValue.CreateFromTensor("input", inputTensor)
};

using var results = session.Run(inputs);
var output = results.First().AsTensor<float>();
```

### Python with ONNX Runtime

```python
import onnxruntime as ort
import numpy as np

# Check available providers
print(ort.get_available_providers())
# ['DmlExecutionProvider', 'CPUExecutionProvider']

# Create session with DirectML (uses NPU/GPU)
session = ort.InferenceSession(
    "model.onnx",
    providers=['DmlExecutionProvider', 'CPUExecutionProvider']
)

# Run inference
input_data = np.random.randn(1, 3, 224, 224).astype(np.float32)
outputs = session.run(None, {"input": input_data})
```

## Model Optimization for NPU

### Quantization

```python
from onnxruntime.quantization import quantize_dynamic, QuantType

# Quantize model for better NPU performance
quantize_dynamic(
    model_input="model_fp32.onnx",
    model_output="model_int8.onnx",
    weight_type=QuantType.QInt8
)
```

### ONNX Model Optimization

```python
import onnx
from onnxruntime.transformers import optimizer

# Optimize for inference
optimized_model = optimizer.optimize_model(
    "model.onnx",
    model_type='bert',
    num_heads=12,
    hidden_size=768
)

optimized_model.save_model_to_file("model_optimized.onnx")
```

## Performance Comparison

Running small language models on different hardware:

| Hardware | Tokens/sec | Power (W) | Efficiency |
|----------|------------|-----------|------------|
| CPU only | 8-12 | 25W | 0.4 t/s/W |
| GPU (integrated) | 25-35 | 35W | 0.9 t/s/W |
| NPU | 20-35 | 8W | 3.5 t/s/W |

NPU wins on efficiency, crucial for battery life.

## Building NPU-Aware Applications

```csharp
public class AIWorkloadManager
{
    private readonly bool _npuAvailable;
    private readonly SessionOptions _options;

    public AIWorkloadManager()
    {
        _options = new SessionOptions();

        // Try to use DirectML (NPU/GPU)
        try
        {
            _options.AppendExecutionProvider_DML(0);
            _npuAvailable = true;
        }
        catch
        {
            // Fall back to CPU
            _npuAvailable = false;
        }
    }

    public async Task<InferenceResult> RunInference(string modelPath, float[] input)
    {
        using var session = new InferenceSession(modelPath, _options);

        var inputTensor = new DenseTensor<float>(input, new[] { 1, input.Length });
        var inputs = new List<NamedOnnxValue>
        {
            NamedOnnxValue.CreateFromTensor("input", inputTensor)
        };

        using var results = session.Run(inputs);
        return new InferenceResult
        {
            Output = results.First().AsTensor<float>().ToArray(),
            UsedNPU = _npuAvailable
        };
    }
}
```

## Use Cases for Local AI

### Document Processing

```python
def process_document_locally(image_path: str) -> dict:
    """Process document using local AI model"""
    # Load optimized model
    session = ort.InferenceSession(
        "document_ai_int8.onnx",
        providers=['DmlExecutionProvider', 'CPUExecutionProvider']
    )

    # Preprocess image
    image = preprocess_image(image_path)

    # Run inference locally
    outputs = session.run(None, {"image": image})

    return parse_document_output(outputs)
```

### Real-Time Transcription

```python
def transcribe_audio_locally(audio_chunk: np.ndarray) -> str:
    """Transcribe audio using local Whisper model"""
    session = ort.InferenceSession(
        "whisper_tiny_int8.onnx",
        providers=['DmlExecutionProvider', 'CPUExecutionProvider']
    )

    # Process audio
    features = extract_audio_features(audio_chunk)
    outputs = session.run(None, {"audio": features})

    return decode_tokens(outputs[0])
```

## What Developers Should Know

1. **Not all ops are NPU-accelerated** - Complex ops may fall back to CPU
2. **Batch size matters** - NPUs often prefer larger batches
3. **Model format** - ONNX with int8 quantization works best
4. **Power awareness** - NPU saves battery, important for laptops
5. **Fallback strategy** - Always have CPU fallback for compatibility

## The Future

Microsoft and partners are expected to announce more AI PC initiatives at Build 2024 (May 21-23). We anticipate:
- New Copilot features leveraging local AI
- Enhanced Windows AI APIs
- More NPU-optimized applications
- Better developer tools for edge AI

## Conclusion

AI PCs with NPUs represent a significant shift toward local AI processing. Start experimenting with ONNX Runtime and DirectML to prepare your applications for this hardware evolution.

## Resources

- [Windows AI Documentation](https://learn.microsoft.com/windows/ai/)
- [DirectML Guide](https://learn.microsoft.com/windows/ai/directml/)
- [ONNX Runtime](https://onnxruntime.ai/)
- [Intel Core Ultra](https://www.intel.com/content/www/us/en/products/details/processors/core-ultra.html)
