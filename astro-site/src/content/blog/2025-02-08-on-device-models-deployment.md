---
title: "On-Device Models: Deploying AI Without the Cloud"
description: "On-device AI enables new categories of privacy-preserving, low-latency applications. Choose the right format and optimization strategy for your target platform."
author: Michael John Peña
draft: false
date: 2025-02-08
tags:
  - AI
  - On-Device
  - Mobile
  - ONNX
  - Privacy
---

## Why On-Device AI?

```
Cloud AI                          On-Device AI
─────────────────────────────────────────────────
Requires internet         │       Works offline
500ms+ latency           │       10-100ms latency
Data sent to servers     │       Data stays local
Recurring API costs      │       One-time compute
Always latest model      │       Fixed model version
Unlimited compute        │       Limited resources
```

## Model Formats for On-Device

```python
# Different formats for different platforms

formats = {
    "ONNX": {
        "platforms": ["Windows", "Linux", "Android", "iOS", "Web"],
        "tools": ["ONNX Runtime", "DirectML"],
        "best_for": "Cross-platform deployment"
    },
    "TensorFlow Lite": {
        "platforms": ["Android", "iOS", "Linux", "Microcontrollers"],
        "tools": ["TFLite Interpreter"],
        "best_for": "Mobile devices"
    },
    "Core ML": {
        "platforms": ["iOS", "macOS"],
        "tools": ["Core ML Framework"],
        "best_for": "Apple ecosystem"
    },
    "GGML/GGUF": {
        "platforms": ["All"],
        "tools": ["llama.cpp", "whisper.cpp"],
        "best_for": "LLMs on CPU"
    }
}
```

## Converting Models to ONNX

```python
import torch
import onnx
import onnxruntime as ort

def export_pytorch_to_onnx(model, sample_input, output_path):
    """Export PyTorch model to ONNX format."""

    model.eval()

    # Export
    torch.onnx.export(
        model,
        sample_input,
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

    # Verify
    onnx_model = onnx.load(output_path)
    onnx.checker.check_model(onnx_model)

    # Test inference
    ort_session = ort.InferenceSession(output_path)
    ort_inputs = {'input': sample_input.numpy()}
    ort_outputs = ort_session.run(None, ort_inputs)

    print(f"Model exported to {output_path}")
    print(f"Output shape: {ort_outputs[0].shape}")

    return output_path

# Example usage
model = MyModel()
sample = torch.randn(1, 3, 224, 224)
export_pytorch_to_onnx(model, sample, "model.onnx")
```

## Deploying Small Language Models

```python
# Using llama.cpp for on-device LLM inference

from llama_cpp import Llama

class OnDeviceLLM:
    def __init__(self, model_path: str):
        # Load quantized model
        self.llm = Llama(
            model_path=model_path,  # GGUF format
            n_ctx=2048,             # Context window
            n_threads=4,            # CPU threads
            n_gpu_layers=0          # GPU layers (0 = CPU only)
        )

    def generate(self, prompt: str, max_tokens: int = 256) -> str:
        """Generate text response."""
        output = self.llm(
            prompt,
            max_tokens=max_tokens,
            temperature=0.7,
            top_p=0.9,
            stop=["User:", "\n\n"]
        )
        return output['choices'][0]['text']

    def chat(self, messages: list) -> str:
        """Chat completion format."""
        prompt = self._format_messages(messages)
        return self.generate(prompt)

    def _format_messages(self, messages: list) -> str:
        """Format messages for the model."""
        formatted = ""
        for msg in messages:
            role = msg['role'].capitalize()
            content = msg['content']
            formatted += f"{role}: {content}\n"
        formatted += "Assistant: "
        return formatted

# Usage
llm = OnDeviceLLM("phi-3-mini-q4.gguf")
response = llm.generate("Explain data lakehouse architecture in simple terms:")
```

## Mobile Deployment with TensorFlow Lite

```python
import tensorflow as tf

def convert_to_tflite(saved_model_path: str, output_path: str):
    """Convert TensorFlow model to TFLite for mobile."""

    # Basic conversion
    converter = tf.lite.TFLiteConverter.from_saved_model(saved_model_path)

    # Optimizations for mobile
    converter.optimizations = [tf.lite.Optimize.DEFAULT]

    # Quantization for smaller size and faster inference
    converter.target_spec.supported_types = [tf.float16]

    # Convert
    tflite_model = converter.convert()

    # Save
    with open(output_path, 'wb') as f:
        f.write(tflite_model)

    print(f"TFLite model saved: {len(tflite_model) / 1024 / 1024:.2f} MB")

    return output_path

# For integer quantization (even smaller, requires calibration data)
def convert_with_int8_quantization(saved_model_path: str, output_path: str, calibration_data):
    """Full integer quantization for maximum efficiency."""

    converter = tf.lite.TFLiteConverter.from_saved_model(saved_model_path)
    converter.optimizations = [tf.lite.Optimize.DEFAULT]

    # Representative dataset for calibration
    def representative_dataset():
        for data in calibration_data:
            yield [data.astype(np.float32)]

    converter.representative_dataset = representative_dataset
    converter.target_spec.supported_ops = [tf.lite.OpsSet.TFLITE_BUILTINS_INT8]
    converter.inference_input_type = tf.int8
    converter.inference_output_type = tf.int8

    tflite_model = converter.convert()

    with open(output_path, 'wb') as f:
        f.write(tflite_model)

    return output_path
```

## iOS Deployment with Core ML

```python
import coremltools as ct
import torch

def convert_to_coreml(pytorch_model, sample_input, output_path: str):
    """Convert PyTorch model to Core ML for iOS/macOS."""

    pytorch_model.eval()

    # Trace the model
    traced_model = torch.jit.trace(pytorch_model, sample_input)

    # Convert to Core ML
    mlmodel = ct.convert(
        traced_model,
        inputs=[ct.TensorType(shape=sample_input.shape)],
        minimum_deployment_target=ct.target.iOS15
    )

    # Add metadata
    mlmodel.author = "My Company"
    mlmodel.short_description = "On-device inference model"
    mlmodel.version = "1.0.0"

    # Optimize for Neural Engine
    mlmodel = ct.models.neural_network.quantization_utils.quantize_weights(
        mlmodel,
        nbits=16
    )

    # Save
    mlmodel.save(output_path)

    print(f"Core ML model saved to {output_path}")
    return output_path

# Usage
model = MyModel()
sample = torch.randn(1, 3, 224, 224)
convert_to_coreml(model, sample, "model.mlpackage")
```

## On-Device Model Management

```python
import hashlib
import requests
from pathlib import Path

class OnDeviceModelManager:
    """Manage on-device model downloads and updates."""

    def __init__(self, cache_dir: str = "~/.models"):
        self.cache_dir = Path(cache_dir).expanduser()
        self.cache_dir.mkdir(exist_ok=True)

    def get_model(self, model_id: str, version: str = "latest") -> Path:
        """Get model, downloading if necessary."""

        model_path = self.cache_dir / f"{model_id}_{version}.onnx"

        if model_path.exists():
            return model_path

        # Download from model registry
        return self._download_model(model_id, version, model_path)

    def _download_model(self, model_id: str, version: str, target_path: Path) -> Path:
        """Download model from registry."""

        url = f"https://models.mycompany.com/{model_id}/{version}/model.onnx"
        checksum_url = f"{url}.sha256"

        # Download model
        response = requests.get(url, stream=True)
        with open(target_path, 'wb') as f:
            for chunk in response.iter_content(chunk_size=8192):
                f.write(chunk)

        # Verify checksum
        expected_checksum = requests.get(checksum_url).text.strip()
        actual_checksum = self._compute_checksum(target_path)

        if expected_checksum != actual_checksum:
            target_path.unlink()
            raise ValueError("Model checksum mismatch")

        return target_path

    def _compute_checksum(self, file_path: Path) -> str:
        """Compute SHA256 checksum of file."""
        sha256 = hashlib.sha256()
        with open(file_path, 'rb') as f:
            for chunk in iter(lambda: f.read(8192), b''):
                sha256.update(chunk)
        return sha256.hexdigest()

    def check_for_updates(self, model_id: str, current_version: str) -> bool:
        """Check if a newer model version is available."""
        # Query model registry for latest version
        pass

    def cleanup_old_versions(self, model_id: str, keep_versions: int = 2):
        """Remove old model versions to save space."""
        pass
```

## Best Practices

1. **Quantize models**: Reduce size by 2-4x with minimal accuracy loss
2. **Profile on target**: Test on actual devices, not just simulators
3. **Lazy loading**: Load models only when needed
4. **Background updates**: Download new models in background
5. **Fallback gracefully**: Handle cases where model can't run
6. **Monitor performance**: Track inference time and memory usage

On-device AI enables new categories of privacy-preserving, low-latency applications. Choose the right format and optimization strategy for your target platform.
