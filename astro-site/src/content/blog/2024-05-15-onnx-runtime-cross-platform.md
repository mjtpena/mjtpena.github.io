---
title: "ONNX Runtime: Cross-Platform AI Deployment"
description: "ONNX Runtime is the unsung hero of AI deployment. Today I'm exploring how to use it for consistent AI inference across platforms."
author: Michael John Peña
draft: false
date: 2024-05-15
tags:
  - AI
  - ONNX
  - Cross-Platform
  - Deployment
  - Performance
---

ONNX Runtime is the unsung hero of AI deployment. Today I'm exploring how to use it for consistent AI inference across platforms.

## What is ONNX Runtime?

ONNX Runtime is a high-performance inference engine for ONNX (Open Neural Network Exchange) models. It provides:

- **Cross-platform support**: Windows, Linux, macOS, iOS, Android, Web
- **Hardware acceleration**: CPU, GPU (CUDA, DirectML), NPU, TPU
- **Language bindings**: Python, C++, C#, Java, JavaScript, Rust

## Converting Models to ONNX

### From PyTorch

```python
import torch
import torch.onnx

# Your trained model
model = MyModel()
model.load_state_dict(torch.load("model.pth"))
model.eval()

# Dummy input for tracing
dummy_input = torch.randn(1, 3, 224, 224)

# Export to ONNX
torch.onnx.export(
    model,
    dummy_input,
    "model.onnx",
    export_params=True,
    opset_version=17,
    do_constant_folding=True,
    input_names=['input'],
    output_names=['output'],
    dynamic_axes={
        'input': {0: 'batch_size'},
        'output': {0: 'batch_size'}
    }
)

print("Model exported to ONNX format")
```

### From TensorFlow

```python
import tensorflow as tf
import tf2onnx

# Load TensorFlow model
model = tf.keras.models.load_model("model.h5")

# Convert to ONNX
input_signature = [tf.TensorSpec([None, 224, 224, 3], tf.float32, name="input")]

onnx_model, _ = tf2onnx.convert.from_keras(
    model,
    input_signature=input_signature,
    opset=17,
    output_path="model.onnx"
)
```

### From Hugging Face Transformers

```python
from transformers import AutoModelForSequenceClassification, AutoTokenizer
from optimum.onnxruntime import ORTModelForSequenceClassification

model_name = "bert-base-uncased"

# Export using Optimum
ort_model = ORTModelForSequenceClassification.from_pretrained(
    model_name,
    export=True
)
ort_model.save_pretrained("./bert_onnx")
```

## Running Inference

### Python

```python
import onnxruntime as ort
import numpy as np

class ONNXInference:
    def __init__(self, model_path: str, providers: list = None):
        if providers is None:
            providers = ['CUDAExecutionProvider', 'CPUExecutionProvider']

        self.session = ort.InferenceSession(model_path, providers=providers)
        self.input_name = self.session.get_inputs()[0].name
        self.output_names = [o.name for o in self.session.get_outputs()]

    def predict(self, input_data: np.ndarray) -> np.ndarray:
        return self.session.run(
            self.output_names,
            {self.input_name: input_data}
        )

# Usage
model = ONNXInference("model.onnx")
input_data = np.random.randn(1, 3, 224, 224).astype(np.float32)
outputs = model.predict(input_data)
```

### C#

```csharp
using Microsoft.ML.OnnxRuntime;
using Microsoft.ML.OnnxRuntime.Tensors;

public class OnnxInference
{
    private readonly InferenceSession _session;

    public OnnxInference(string modelPath)
    {
        var options = new SessionOptions();
        options.AppendExecutionProvider_CUDA();
        options.AppendExecutionProvider_CPU();

        _session = new InferenceSession(modelPath, options);
    }

    public float[] Predict(float[] inputData, int[] shape)
    {
        var tensor = new DenseTensor<float>(inputData, shape);
        var inputs = new List<NamedOnnxValue>
        {
            NamedOnnxValue.CreateFromTensor("input", tensor)
        };

        using var results = _session.Run(inputs);
        return results.First().AsTensor<float>().ToArray();
    }

    public void Dispose()
    {
        _session?.Dispose();
    }
}
```

### JavaScript (Web)

```javascript
import * as ort from 'onnxruntime-web';

async function runInference(modelPath, inputData) {
    // Load model
    const session = await ort.InferenceSession.create(modelPath);

    // Create tensor
    const tensor = new ort.Tensor('float32', inputData, [1, 3, 224, 224]);

    // Run inference
    const feeds = { input: tensor };
    const results = await session.run(feeds);

    return results.output.data;
}

// Usage
const inputData = new Float32Array(1 * 3 * 224 * 224);
const output = await runInference('./model.onnx', inputData);
console.log('Prediction:', output);
```

### Rust

```rust
use ort::{Environment, Session, Value};
use ndarray::Array4;

fn main() -> ort::Result<()> {
    let environment = Environment::builder()
        .with_name("inference")
        .build()?
        .into_arc();

    let session = Session::builder()?
        .with_optimization_level(ort::GraphOptimizationLevel::Level3)?
        .commit_from_file("model.onnx")?;

    // Create input tensor
    let input = Array4::<f32>::zeros((1, 3, 224, 224));

    let outputs = session.run(ort::inputs![input]?)?;

    let output = outputs[0].extract_tensor::<f32>()?;
    println!("Output shape: {:?}", output.view().shape());

    Ok(())
}
```

## Execution Providers

```python
# Check available providers
print(ort.get_available_providers())
# ['TensorrtExecutionProvider', 'CUDAExecutionProvider', 'CPUExecutionProvider']

# Configure specific provider
session_options = ort.SessionOptions()

# CUDA with specific options
cuda_options = {
    'device_id': 0,
    'arena_extend_strategy': 'kNextPowerOfTwo',
    'gpu_mem_limit': 2 * 1024 * 1024 * 1024,  # 2GB
    'cudnn_conv_algo_search': 'EXHAUSTIVE',
    'do_copy_in_default_stream': True,
}

session = ort.InferenceSession(
    "model.onnx",
    sess_options=session_options,
    providers=[
        ('CUDAExecutionProvider', cuda_options),
        'CPUExecutionProvider'
    ]
)
```

## Model Optimization

```python
from onnxruntime.transformers import optimizer
from onnxruntime.quantization import quantize_dynamic, QuantType

# Graph optimization
optimized_model = optimizer.optimize_model(
    "model.onnx",
    model_type='bert',
    num_heads=12,
    hidden_size=768,
    optimization_options=optimizer.FusionOptions(
        enable_gelu=True,
        enable_layer_norm=True,
        enable_attention=True
    )
)
optimized_model.save_model_to_file("model_optimized.onnx")

# Quantization
quantize_dynamic(
    model_input="model_optimized.onnx",
    model_output="model_quantized.onnx",
    weight_type=QuantType.QUInt8
)
```

## IO Binding for Maximum Performance

```python
import onnxruntime as ort
import numpy as np

# Create session with CUDA
session = ort.InferenceSession(
    "model.onnx",
    providers=['CUDAExecutionProvider']
)

# Create IO binding
io_binding = session.io_binding()

# Allocate input on GPU
input_data = np.random.randn(1, 3, 224, 224).astype(np.float32)
input_tensor = ort.OrtValue.ortvalue_from_numpy(input_data, 'cuda', 0)

# Bind input
io_binding.bind_ortvalue_input('input', input_tensor)

# Allocate output on GPU
io_binding.bind_output('output', 'cuda')

# Run inference (data stays on GPU)
session.run_with_iobinding(io_binding)

# Get output
output = io_binding.copy_outputs_to_cpu()[0]
```

## Mobile Deployment

### iOS (Swift)

```swift
import OnnxRuntimeKit

class ModelInference {
    private var session: ORTSession?

    func loadModel(path: String) throws {
        let env = try ORTEnv(loggingLevel: .warning)
        let options = try ORTSessionOptions()
        try options.setGraphOptimizationLevel(.all)

        session = try ORTSession(env: env, modelPath: path, sessionOptions: options)
    }

    func predict(input: [Float]) throws -> [Float] {
        guard let session = session else {
            throw ModelError.sessionNotInitialized
        }

        let inputTensor = try ORTValue(
            tensorData: NSMutableData(bytes: input, length: input.count * 4),
            elementType: .float,
            shape: [1, 3, 224, 224]
        )

        let outputs = try session.run(
            withInputs: ["input": inputTensor],
            outputNames: ["output"]
        )

        let outputTensor = outputs["output"]!
        return try outputTensor.tensorData().withUnsafeBytes { ptr in
            Array(ptr.bindMemory(to: Float.self))
        }
    }
}
```

### Android (Kotlin)

```kotlin
import ai.onnxruntime.*

class ModelInference(context: Context) {
    private var session: OrtSession? = null
    private val env = OrtEnvironment.getEnvironment()

    fun loadModel(assetPath: String) {
        val modelBytes = context.assets.open(assetPath).readBytes()
        val options = OrtSession.SessionOptions().apply {
            setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT)
        }
        session = env.createSession(modelBytes, options)
    }

    fun predict(input: FloatArray): FloatArray {
        val inputTensor = OnnxTensor.createTensor(
            env,
            FloatBuffer.wrap(input),
            longArrayOf(1, 3, 224, 224)
        )

        val results = session?.run(mapOf("input" to inputTensor))
        val output = results?.get(0)?.value as Array<FloatArray>

        inputTensor.close()
        results?.close()

        return output[0]
    }
}
```

## Benchmarking

```python
import time
import statistics

def benchmark_model(session, input_data, iterations=100, warmup=10):
    # Warmup
    for _ in range(warmup):
        session.run(None, {"input": input_data})

    # Benchmark
    latencies = []
    for _ in range(iterations):
        start = time.perf_counter()
        session.run(None, {"input": input_data})
        latencies.append((time.perf_counter() - start) * 1000)

    return {
        "mean_ms": statistics.mean(latencies),
        "std_ms": statistics.stdev(latencies),
        "min_ms": min(latencies),
        "max_ms": max(latencies),
        "p50_ms": statistics.median(latencies),
        "p95_ms": sorted(latencies)[int(len(latencies) * 0.95)],
        "throughput": 1000 / statistics.mean(latencies)
    }

# Usage
results = benchmark_model(session, input_data)
print(f"Mean latency: {results['mean_ms']:.2f}ms")
print(f"Throughput: {results['throughput']:.1f} inferences/sec")
```

## Best Practices

1. **Use appropriate execution provider** - Match hardware capabilities
2. **Optimize models** - Graph optimization + quantization
3. **Batch when possible** - Better throughput
4. **Use IO binding** - Avoid CPU-GPU transfers
5. **Profile before optimizing** - Measure first

## What's Next

Tomorrow I'll cover DirectML for Windows AI acceleration.

## Resources

- [ONNX Runtime Documentation](https://onnxruntime.ai/)
- [ONNX Model Zoo](https://github.com/onnx/models)
- [Optimum Library](https://huggingface.co/docs/optimum/)
