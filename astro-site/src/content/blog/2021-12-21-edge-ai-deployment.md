---
title: "Edge AI: Deploying Machine Learning at the Edge"
author: Michael John Pena
draft: false
date: 2021-12-21
tags:
  - Edge AI
  - Machine Learning
  - IoT
  - Azure IoT Edge
  - ONNX

---

I wrote "Edge AI: Deploying Machine Learning at the Edge" to share practical, production-minded guidance on this topic.

## Why Edge AI?

- **Latency**: Real-time inference without network round-trip
- **Privacy**: Data stays on-device
- **Reliability**: Works offline
- **Bandwidth**: Reduces data transfer to cloud
- **Cost**: Lower cloud compute costs

## Model Optimization for Edge

```python
import onnx
import onnxruntime as ort
from onnxruntime.quantization import quantize_dynamic, QuantType
import torch

class EdgeModelOptimizer:
    """Optimize models for edge deployment"""

    def export_to_onnx(
        self,
        pytorch_model: torch.nn.Module,
        sample_input: torch.Tensor,
        output_path: str,
        opset_version: int = 13
    ):
        """Export PyTorch model to ONNX format"""
        pytorch_model.eval()

        torch.onnx.export(
            pytorch_model,
            sample_input,
            output_path,
            export_params=True,
            opset_version=opset_version,
            do_constant_folding=True,
            input_names=['input'],
            output_names=['output'],
            dynamic_axes={
                'input': {0: 'batch_size'},
                'output': {0: 'batch_size'}
            }
        )

        # Verify the model
        onnx_model = onnx.load(output_path)
        onnx.checker.check_model(onnx_model)

        return output_path

    def quantize_model(
        self,
        model_path: str,
        output_path: str,
        quantization_type: str = "dynamic"
    ):
        """Quantize model for smaller size and faster inference"""

        if quantization_type == "dynamic":
            quantize_dynamic(
                model_path,
                output_path,
                weight_type=QuantType.QUInt8
            )
        elif quantization_type == "static":
            # Requires calibration data
            from onnxruntime.quantization import quantize_static, CalibrationDataReader

            class DataReader(CalibrationDataReader):
                def __init__(self, calibration_data):
                    self.data = iter(calibration_data)

                def get_next(self):
                    return next(self.data, None)

            quantize_static(
                model_path,
                output_path,
                DataReader(self.calibration_data)
            )

        return output_path

    def benchmark_model(self, model_path: str, sample_input):
        """Benchmark model inference performance"""
        import time
        import numpy as np

        session = ort.InferenceSession(model_path)
        input_name = session.get_inputs()[0].name

        # Warmup
        for _ in range(10):
            session.run(None, {input_name: sample_input})

        # Benchmark
        latencies = []
        for _ in range(100):
            start = time.perf_counter()
            session.run(None, {input_name: sample_input})
            latencies.append((time.perf_counter() - start) * 1000)

        return {
            "mean_latency_ms": np.mean(latencies),
            "p50_latency_ms": np.percentile(latencies, 50),
            "p99_latency_ms": np.percentile(latencies, 99),
            "throughput_per_sec": 1000 / np.mean(latencies)
        }

# Usage
optimizer = EdgeModelOptimizer()

# Export model
optimizer.export_to_onnx(model, sample_input, "model.onnx")

# Quantize for edge
optimizer.quantize_model("model.onnx", "model_quantized.onnx")

# Benchmark
results = optimizer.benchmark_model("model_quantized.onnx", sample_input.numpy())
print(f"Inference latency: {results['mean_latency_ms']:.2f}ms")
```

## Azure IoT Edge Deployment

```json
// deployment.template.json
{
    "$schema-template": "4.0.0",
    "modulesContent": {
        "$edgeAgent": {
            "properties.desired": {
                "schemaVersion": "1.1",
                "runtime": {
                    "type": "docker",
                    "settings": {
                        "minDockerVersion": "v1.25"
                    }
                },
                "systemModules": {
                    "edgeAgent": {
                        "type": "docker",
                        "settings": {
                            "image": "mcr.microsoft.com/azureiotedge-agent:1.2"
                        }
                    },
                    "edgeHub": {
                        "type": "docker",
                        "status": "running",
                        "restartPolicy": "always",
                        "settings": {
                            "image": "mcr.microsoft.com/azureiotedge-hub:1.2"
                        }
                    }
                },
                "modules": {
                    "MLModule": {
                        "version": "1.0",
                        "type": "docker",
                        "status": "running",
                        "restartPolicy": "always",
                        "settings": {
                            "image": "${MODULES.MLModule}",
                            "createOptions": {
                                "HostConfig": {
                                    "Binds": [
                                        "/var/lib/azureiotedge/models:/models"
                                    ],
                                    "DeviceRequests": [
                                        {
                                            "Count": -1,
                                            "Capabilities": [["gpu"]]
                                        }
                                    ]
                                }
                            }
                        }
                    }
                }
            }
        },
        "$edgeHub": {
            "properties.desired": {
                "schemaVersion": "1.1",
                "routes": {
                    "MLModuleToIoTHub": "FROM /messages/modules/MLModule/outputs/* INTO $upstream",
                    "sensorToMLModule": "FROM /messages/modules/SimulatedSensor/outputs/temperatureOutput INTO BrokeredEndpoint(\"/modules/MLModule/inputs/sensorInput\")"
                },
                "storeAndForwardConfiguration": {
                    "timeToLiveSecs": 7200
                }
            }
        }
    }
}
```

## Edge Inference Module

```python
# modules/MLModule/main.py
import asyncio
import json
import os
import numpy as np
import onnxruntime as ort
from azure.iot.device.aio import IoTHubModuleClient

class EdgeMLModule:
    def __init__(self):
        self.model_path = os.environ.get("MODEL_PATH", "/models/model.onnx")
        self.session = None
        self.client = None

    async def initialize(self):
        """Initialize the module"""
        # Load ONNX model
        sess_options = ort.SessionOptions()
        sess_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        sess_options.intra_op_num_threads = 4

        # Use appropriate execution provider
        providers = ['CPUExecutionProvider']
        if 'CUDAExecutionProvider' in ort.get_available_providers():
            providers.insert(0, 'CUDAExecutionProvider')

        self.session = ort.InferenceSession(
            self.model_path,
            sess_options,
            providers=providers
        )

        # Initialize IoT Edge client
        self.client = IoTHubModuleClient.create_from_edge_environment()
        await self.client.connect()

        # Set up message handler
        self.client.on_message_received = self.message_handler

        print(f"ML Module initialized with model: {self.model_path}")
        print(f"Using providers: {self.session.get_providers()}")

    async def message_handler(self, message):
        """Handle incoming messages"""
        try:
            data = json.loads(message.data.decode('utf-8'))

            # Prepare input
            input_data = self.preprocess(data)

            # Run inference
            input_name = self.session.get_inputs()[0].name
            output_name = self.session.get_outputs()[0].name
            result = self.session.run([output_name], {input_name: input_data})

            # Post-process and send result
            prediction = self.postprocess(result[0])

            output_message = {
                "device_id": data.get("device_id"),
                "timestamp": data.get("timestamp"),
                "prediction": prediction,
                "confidence": float(np.max(result[0]))
            }

            await self.client.send_message_to_output(
                json.dumps(output_message),
                "output1"
            )

        except Exception as e:
            print(f"Error processing message: {e}")

    def preprocess(self, data: dict) -> np.ndarray:
        """Preprocess input data for model"""
        features = [
            data.get("temperature", 0),
            data.get("humidity", 0),
            data.get("pressure", 0),
            data.get("vibration", 0)
        ]
        return np.array([features], dtype=np.float32)

    def postprocess(self, output: np.ndarray) -> str:
        """Post-process model output"""
        classes = ["normal", "warning", "critical"]
        predicted_class = np.argmax(output)
        return classes[predicted_class]

    async def run(self):
        """Main run loop"""
        await self.initialize()

        # Keep running
        while True:
            await asyncio.sleep(1)

if __name__ == "__main__":
    module = EdgeMLModule()
    asyncio.run(module.run())
```

## Model Update Over-the-Air

```python
from azure.iot.device import MethodResponse
import aiohttp
import hashlib

class ModelUpdater:
    """Handle over-the-air model updates"""

    def __init__(self, model_dir: str = "/models"):
        self.model_dir = model_dir
        self.current_model_version = None

    async def check_for_updates(self, client):
        """Register method handler for model updates"""

        async def model_update_handler(method_request):
            """Handle model update direct method"""
            try:
                payload = method_request.payload
                model_url = payload.get("model_url")
                model_version = payload.get("version")
                expected_hash = payload.get("sha256")

                # Download model
                model_path = await self.download_model(
                    model_url,
                    model_version,
                    expected_hash
                )

                # Verify model
                if await self.verify_model(model_path):
                    # Swap models atomically
                    await self.activate_model(model_path)

                    return MethodResponse.create_from_method_request(
                        method_request,
                        200,
                        {"status": "success", "version": model_version}
                    )
                else:
                    return MethodResponse.create_from_method_request(
                        method_request,
                        400,
                        {"status": "error", "message": "Model verification failed"}
                    )

            except Exception as e:
                return MethodResponse.create_from_method_request(
                    method_request,
                    500,
                    {"status": "error", "message": str(e)}
                )

        client.on_method_request_received = model_update_handler

    async def download_model(
        self,
        url: str,
        version: str,
        expected_hash: str
    ) -> str:
        """Download model from URL"""
        model_path = f"{self.model_dir}/model_{version}.onnx"

        async with aiohttp.ClientSession() as session:
            async with session.get(url) as response:
                content = await response.read()

                # Verify hash
                actual_hash = hashlib.sha256(content).hexdigest()
                if actual_hash != expected_hash:
                    raise ValueError("Model hash mismatch")

                with open(model_path, 'wb') as f:
                    f.write(content)

        return model_path

    async def verify_model(self, model_path: str) -> bool:
        """Verify model can be loaded and run"""
        try:
            session = ort.InferenceSession(model_path)
            input_shape = session.get_inputs()[0].shape
            # Create dummy input
            dummy_input = np.zeros(input_shape, dtype=np.float32)
            session.run(None, {session.get_inputs()[0].name: dummy_input})
            return True
        except Exception:
            return False

    async def activate_model(self, model_path: str):
        """Activate new model version"""
        import shutil
        active_path = f"{self.model_dir}/model.onnx"
        backup_path = f"{self.model_dir}/model_backup.onnx"

        # Backup current model
        if os.path.exists(active_path):
            shutil.move(active_path, backup_path)

        # Activate new model
        shutil.copy(model_path, active_path)

        # Signal module to reload
        # (implementation depends on module architecture)
```

## Edge Deployment Patterns

```yaml
# Edge deployment best practices
patterns:
  model_serving:
    - Use ONNX for portability
    - Quantize models for efficiency
    - Batch requests when possible
    - Use hardware accelerators

  data_handling:
    - Filter data at the edge
    - Aggregate before sending to cloud
    - Cache predictions locally
    - Handle offline scenarios

  updates:
    - Support OTA model updates
    - Version all artifacts
    - Implement rollback capability
    - Validate before activation

  monitoring:
    - Track inference latency
    - Monitor prediction distribution
    - Detect model drift locally
    - Report health to cloud
```

## Key Edge AI Considerations

1. **Model Size**: Smaller is better for edge
2. **Latency Requirements**: Sub-millisecond often required
3. **Power Constraints**: Battery-powered devices need efficiency
4. **Hardware Variety**: Support multiple platforms (ARM, x86, GPU)
5. **Update Mechanism**: Plan for model updates from day one

Edge AI in 2021 became accessible to mainstream developers. Azure IoT Edge, ONNX Runtime, and improved hardware made edge deployment practical for real workloads.

## Resources

- [Azure IoT Edge](https://docs.microsoft.com/en-us/azure/iot-edge/)
- [ONNX Runtime](https://onnxruntime.ai/)
- [TensorFlow Lite](https://www.tensorflow.org/lite)
- [Edge Impulse](https://www.edgeimpulse.com/)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
