---
title: Building Live Video Analytics Pipelines on Azure
author: Michael John Pena
draft: false
date: 2021-09-23
tags:
  - Azure
  - Video Analytics
  - Live Streaming
  - Edge Computing
  - Computer Vision

---

I wrote "2021-09-23-azure-live-video-analytics" to share practical, production-minded guidance on this topic.

## Live Video Analytics Architecture

```
+----------+     +----------------+     +------------------+
|  Camera  | --> |   IoT Edge     | --> |   Azure Cloud    |
|  (RTSP)  |     |   Device       |     |                  |
+----------+     +----------------+     +------------------+
                 |  LVA Module    |     |  - Media Services|
                 |  AI Module     |     |  - Storage       |
                 |  Custom Module |     |  - Event Hub     |
                 +----------------+     +------------------+
```

## Setting Up LVA on IoT Edge

```json
{
  "modulesContent": {
    "$edgeAgent": {
      "properties.desired": {
        "modules": {
          "lvaEdge": {
            "type": "docker",
            "status": "running",
            "restartPolicy": "always",
            "settings": {
              "image": "mcr.microsoft.com/media/live-video-analytics:2",
              "createOptions": {
                "HostConfig": {
                  "LogConfig": {
                    "Type": "json-file",
                    "Config": {
                      "max-size": "10m",
                      "max-file": "10"
                    }
                  },
                  "Binds": [
                    "/var/media/:/var/media/",
                    "/var/lib/azuremediaservices/:/var/lib/azuremediaservices/"
                  ]
                }
              }
            }
          }
        }
      }
    }
  }
}
```

## Graph Topology for Live Analysis

```python
import json

def create_live_inference_topology():
    """Create topology for real-time video inference."""

    topology = {
        "@apiVersion": "1.0",
        "name": "LiveInference",
        "properties": {
            "description": "Real-time object detection on live video",
            "parameters": [
                {"name": "rtspUrl", "type": "String"},
                {"name": "rtspUserName", "type": "String"},
                {"name": "rtspPassword", "type": "String"},
                {"name": "inferenceUrl", "type": "String"},
                {"name": "hubSinkOutputName", "type": "String", "default": "inferenceOutput"}
            ],
            "sources": [
                {
                    "@type": "#Microsoft.Media.MediaGraphRtspSource",
                    "name": "rtspSource",
                    "transport": "tcp",
                    "endpoint": {
                        "@type": "#Microsoft.Media.MediaGraphUnsecuredEndpoint",
                        "url": "${rtspUrl}",
                        "credentials": {
                            "@type": "#Microsoft.Media.MediaGraphUsernamePasswordCredentials",
                            "username": "${rtspUserName}",
                            "password": "${rtspPassword}"
                        }
                    }
                }
            ],
            "processors": [
                {
                    "@type": "#Microsoft.Media.MediaGraphFrameRateFilterProcessor",
                    "name": "frameRateFilter",
                    "inputs": [{"nodeName": "rtspSource"}],
                    "maximumFps": 2
                },
                {
                    "@type": "#Microsoft.Media.MediaGraphHttpExtension",
                    "name": "httpExtension",
                    "inputs": [{"nodeName": "frameRateFilter", "outputSelectors": []}],
                    "endpoint": {
                        "@type": "#Microsoft.Media.MediaGraphUnsecuredEndpoint",
                        "url": "${inferenceUrl}"
                    },
                    "image": {
                        "scale": {
                            "mode": "pad",
                            "width": "640",
                            "height": "480"
                        },
                        "format": {
                            "@type": "#Microsoft.Media.MediaGraphImageFormatBmp"
                        }
                    }
                }
            ],
            "sinks": [
                {
                    "@type": "#Microsoft.Media.MediaGraphIoTHubMessageSink",
                    "name": "hubSink",
                    "inputs": [{"nodeName": "httpExtension"}],
                    "hubOutputName": "${hubSinkOutputName}"
                }
            ]
        }
    }

    return topology
```

## Custom AI Module for Inference

```python
# inference_server.py
from flask import Flask, request, jsonify
import cv2
import numpy as np
import onnxruntime as ort

app = Flask(__name__)

# Load ONNX model
session = ort.InferenceSession("model.onnx")
input_name = session.get_inputs()[0].name

CLASSES = ["person", "car", "truck", "bicycle", "motorcycle"]

def preprocess_image(image_bytes):
    """Preprocess image for inference."""
    nparr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    img = cv2.resize(img, (640, 480))
    img = img.astype(np.float32) / 255.0
    img = np.transpose(img, (2, 0, 1))
    img = np.expand_dims(img, axis=0)
    return img

def postprocess_results(outputs, threshold=0.5):
    """Convert model outputs to detections."""
    detections = []

    # Assuming YOLO-style output
    for detection in outputs[0]:
        confidence = detection[4]
        if confidence > threshold:
            class_id = int(np.argmax(detection[5:]))
            class_conf = detection[5 + class_id]

            if class_conf > threshold:
                x, y, w, h = detection[0:4]
                detections.append({
                    "type": "entity",
                    "entity": {
                        "tag": {
                            "value": CLASSES[class_id],
                            "confidence": float(class_conf)
                        },
                        "box": {
                            "l": float(x - w/2),
                            "t": float(y - h/2),
                            "w": float(w),
                            "h": float(h)
                        }
                    }
                })

    return detections

@app.route('/score', methods=['POST'])
def score():
    """Process image and return detections."""
    try:
        image_bytes = request.get_data()
        input_tensor = preprocess_image(image_bytes)

        outputs = session.run(None, {input_name: input_tensor})
        detections = postprocess_results(outputs)

        return jsonify({"inferences": detections})

    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/health', methods=['GET'])
def health():
    return jsonify({"status": "healthy"})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5001)
```

## Managing Graph Instances

```python
import asyncio
from azure.iot.hub import IoTHubRegistryManager
from azure.iot.hub.models import CloudToDeviceMethod

class LVAController:
    def __init__(self, connection_string: str, device_id: str, module_id: str = "lvaEdge"):
        self.registry = IoTHubRegistryManager(connection_string)
        self.device_id = device_id
        self.module_id = module_id

    def invoke_method(self, method_name: str, payload: dict) -> dict:
        """Invoke a direct method on the LVA module."""

        method = CloudToDeviceMethod(
            method_name=method_name,
            payload=payload
        )

        response = self.registry.invoke_device_module_method(
            self.device_id,
            self.module_id,
            method
        )

        return response.payload

    def set_topology(self, topology: dict) -> dict:
        """Set a graph topology."""

        return self.invoke_method(
            "GraphTopologySet",
            topology
        )

    def create_instance(self, instance_name: str, topology_name: str,
                       parameters: dict) -> dict:
        """Create a graph instance."""

        instance = {
            "@apiVersion": "1.0",
            "name": instance_name,
            "properties": {
                "topologyName": topology_name,
                "description": f"Instance of {topology_name}",
                "parameters": [
                    {"name": k, "value": v}
                    for k, v in parameters.items()
                ]
            }
        }

        return self.invoke_method("GraphInstanceSet", instance)

    def activate_instance(self, instance_name: str) -> dict:
        """Activate a graph instance to start processing."""

        return self.invoke_method(
            "GraphInstanceActivate",
            {"@apiVersion": "1.0", "name": instance_name}
        )

    def deactivate_instance(self, instance_name: str) -> dict:
        """Deactivate a graph instance."""

        return self.invoke_method(
            "GraphInstanceDeactivate",
            {"@apiVersion": "1.0", "name": instance_name}
        )

    def delete_instance(self, instance_name: str) -> dict:
        """Delete a graph instance."""

        return self.invoke_method(
            "GraphInstanceDelete",
            {"@apiVersion": "1.0", "name": instance_name}
        )

    def list_instances(self) -> dict:
        """List all graph instances."""

        return self.invoke_method(
            "GraphInstanceList",
            {"@apiVersion": "1.0"}
        )

# Use the controller
controller = LVAController(
    "your-iot-hub-connection-string",
    "your-edge-device-id"
)

# Set up topology
topology = create_live_inference_topology()
controller.set_topology(topology)

# Create and start instance
controller.create_instance(
    "camera1-inference",
    "LiveInference",
    {
        "rtspUrl": "rtsp://camera1.local/stream",
        "rtspUserName": "admin",
        "rtspPassword": "password",
        "inferenceUrl": "http://inference:5001/score"
    }
)

controller.activate_instance("camera1-inference")
```

## Event-Based Recording

```python
def create_event_recording_topology():
    """Record video when AI detects specific events."""

    topology = {
        "@apiVersion": "1.0",
        "name": "EventTriggeredRecording",
        "properties": {
            "parameters": [
                {"name": "rtspUrl", "type": "String"},
                {"name": "inferenceUrl", "type": "String"},
                {"name": "assetNamePattern", "type": "String", "default": "event-${System.DateTime}"}
            ],
            "sources": [
                {
                    "@type": "#Microsoft.Media.MediaGraphRtspSource",
                    "name": "rtspSource",
                    "endpoint": {
                        "@type": "#Microsoft.Media.MediaGraphUnsecuredEndpoint",
                        "url": "${rtspUrl}"
                    }
                }
            ],
            "processors": [
                {
                    "@type": "#Microsoft.Media.MediaGraphFrameRateFilterProcessor",
                    "name": "frameRateFilter",
                    "inputs": [{"nodeName": "rtspSource"}],
                    "maximumFps": 5
                },
                {
                    "@type": "#Microsoft.Media.MediaGraphHttpExtension",
                    "name": "httpExtension",
                    "inputs": [{"nodeName": "frameRateFilter"}],
                    "endpoint": {
                        "@type": "#Microsoft.Media.MediaGraphUnsecuredEndpoint",
                        "url": "${inferenceUrl}"
                    },
                    "image": {
                        "format": {"@type": "#Microsoft.Media.MediaGraphImageFormatJpeg"}
                    }
                },
                {
                    "@type": "#Microsoft.Media.MediaGraphSignalGateProcessor",
                    "name": "signalGate",
                    "inputs": [
                        {"nodeName": "httpExtension"},
                        {"nodeName": "rtspSource"}
                    ],
                    "activationEvaluationWindow": "PT1S",
                    "activationSignalOffset": "-PT10S",
                    "minimumActivationTime": "PT30S",
                    "maximumActivationTime": "PT5M"
                }
            ],
            "sinks": [
                {
                    "@type": "#Microsoft.Media.MediaGraphAssetSink",
                    "name": "assetSink",
                    "inputs": [{"nodeName": "signalGate"}],
                    "assetNamePattern": "${assetNamePattern}",
                    "localMediaCachePath": "/var/lib/azuremediaservices/tmp/",
                    "localMediaCacheMaximumSizeMiB": "2048"
                },
                {
                    "@type": "#Microsoft.Media.MediaGraphIoTHubMessageSink",
                    "name": "hubSink",
                    "inputs": [{"nodeName": "httpExtension"}],
                    "hubOutputName": "inferenceOutput"
                }
            ]
        }
    }

    return topology
```

## Best Practices

1. **Frame Rate Control**: Limit FPS to reduce compute load
2. **Resolution Tuning**: Balance quality with processing speed
3. **Buffering**: Use signal gates for pre-event recording
4. **Error Handling**: Implement retry logic for camera disconnects
5. **Resource Management**: Monitor edge device CPU/memory
6. **Inference Optimization**: Use INT8 quantized models for edge

Live Video Analytics enables real-time video intelligence at the edge, perfect for security, retail analytics, and industrial monitoring applications.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
