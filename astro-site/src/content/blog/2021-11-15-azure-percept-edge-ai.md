---
title: "Azure Percept: Edge AI Development Made Simple"
description: "Azure Percept makes edge AI accessible to developers without deep expertise in hardware or ML. Combined with Azure's cloud services, it enables…"
author: Michael John Pena
draft: false
date: 2021-11-15
tags:
  - Azure
  - Edge Computing
  - AI
  - IoT
  - Computer Vision
---

## What is Azure Percept?

Azure Percept combines hardware and software for edge AI:

- **Azure Percept DK**: Development kit with vision and audio modules
- **Azure Percept Studio**: Low-code AI model development
- **Azure Integration**: Seamless connection to Azure AI services

## Setting Up Azure Percept

### Initial Configuration

```bash
# Install Azure CLI IoT extension
az extension add --name azure-iot

# Create IoT Hub
az iot hub create \
    --name myPerceptHub \
    --resource-group rg-percept \
    --sku S1

# Register Percept device
az iot hub device-identity create \
    --hub-name myPerceptHub \
    --device-id percept-dk-001 \
    --edge-enabled
```

### Device Configuration

```json
{
  "deviceId": "percept-dk-001",
  "properties": {
    "desired": {
      "azureEyeModule": {
        "modelUri": "https://models.blob.core.windows.net/vision/object-detection.zip",
        "confidence_threshold": 0.5,
        "frame_rate": 15
      },
      "azureEarModule": {
        "keyword": "Hey Computer",
        "sensitivity": 0.6
      }
    }
  }
}
```

## Building Vision AI Models

### Custom Object Detection

Use Azure Percept Studio or Custom Vision:

```python
from azure.cognitiveservices.vision.customvision.training import CustomVisionTrainingClient
from azure.cognitiveservices.vision.customvision.prediction import CustomVisionPredictionClient
from msrest.authentication import ApiKeyCredentials
import os

# Training client
training_credentials = ApiKeyCredentials(
    in_headers={"Training-key": os.environ["CUSTOM_VISION_TRAINING_KEY"]}
)
trainer = CustomVisionTrainingClient(
    os.environ["CUSTOM_VISION_ENDPOINT"],
    training_credentials
)

# Create object detection project
project = trainer.create_project(
    "ProductDetection",
    domain_id="da2e3a8a-40a5-4171-82f4-58522f70fbc1",  # Object Detection domain
    classification_type="Multilabel"
)

# Create tags for objects
product_tag = trainer.create_tag(project.id, "product")
defect_tag = trainer.create_tag(project.id, "defect")

# Upload training images
def upload_images(image_folder, tag_id, regions):
    """Upload images with bounding box annotations."""
    for filename in os.listdir(image_folder):
        if filename.endswith(('.jpg', '.png')):
            image_path = os.path.join(image_folder, filename)

            with open(image_path, "rb") as image_data:
                trainer.create_images_from_data(
                    project.id,
                    image_data.read(),
                    tag_ids=[tag_id],
                    regions=regions.get(filename, [])
                )

# Train the model
iteration = trainer.train_project(project.id)

# Wait for training to complete
while iteration.status != "Completed":
    iteration = trainer.get_iteration(project.id, iteration.id)
    print(f"Training status: {iteration.status}")
    time.sleep(10)

# Export for edge deployment
export = trainer.export_iteration(
    project.id,
    iteration.id,
    platform="ONNX",
    flavor="ONNXFloat16"
)

print(f"Export URL: {export.download_uri}")
```

### Deploy Model to Percept

```python
from azure.iot.hub import IoTHubRegistryManager
import json

def deploy_model_to_percept(connection_string, device_id, model_uri):
    """Deploy an AI model to Azure Percept device."""
    registry_manager = IoTHubRegistryManager(connection_string)

    twin = registry_manager.get_twin(device_id)

    twin_patch = {
        "properties": {
            "desired": {
                "azureEyeModule": {
                    "modelUri": model_uri,
                    "modelType": "ObjectDetection",
                    "confidence_threshold": 0.6,
                    "iou_threshold": 0.5,
                    "frame_rate": 15,
                    "resolution": "1080p"
                }
            }
        }
    }

    registry_manager.update_twin(device_id, twin_patch, twin.etag)
    print(f"Model deployed to {device_id}")

# Deploy
deploy_model_to_percept(
    os.environ["IOT_HUB_CONNECTION_STRING"],
    "percept-dk-001",
    "https://models.blob.core.windows.net/vision/product-detection-v1.zip"
)
```

## Processing Video Streams

### Edge Module for Video Analytics

```python
# edge_module.py
import asyncio
import json
from azure.iot.device.aio import IoTHubModuleClient
from azure.iot.device import Message
import cv2
import numpy as np
import onnxruntime as ort

class VideoAnalyzer:
    def __init__(self, model_path, confidence_threshold=0.5):
        self.session = ort.InferenceSession(model_path)
        self.confidence_threshold = confidence_threshold
        self.input_name = self.session.get_inputs()[0].name

    def preprocess(self, frame):
        """Preprocess frame for model input."""
        resized = cv2.resize(frame, (416, 416))
        normalized = resized.astype(np.float32) / 255.0
        transposed = np.transpose(normalized, (2, 0, 1))
        return np.expand_dims(transposed, axis=0)

    def detect(self, frame):
        """Run object detection on frame."""
        input_data = self.preprocess(frame)
        outputs = self.session.run(None, {self.input_name: input_data})

        detections = []
        for detection in outputs[0][0]:
            confidence = detection[4]
            if confidence > self.confidence_threshold:
                x, y, w, h = detection[:4]
                class_id = int(detection[5])
                detections.append({
                    "class_id": class_id,
                    "confidence": float(confidence),
                    "bbox": [float(x), float(y), float(w), float(h)]
                })

        return detections

async def main():
    module_client = IoTHubModuleClient.create_from_edge_environment()
    await module_client.connect()

    analyzer = VideoAnalyzer("/models/object_detection.onnx")
    cap = cv2.VideoCapture(0)  # Camera input

    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                continue

            detections = analyzer.detect(frame)

            if detections:
                message = Message(json.dumps({
                    "timestamp": datetime.utcnow().isoformat(),
                    "detections": detections
                }))
                message.content_type = "application/json"

                await module_client.send_message_to_output(message, "detections")

            await asyncio.sleep(0.1)  # Process ~10 fps

    finally:
        cap.release()
        await module_client.disconnect()

if __name__ == "__main__":
    asyncio.run(main())
```

### Deployment Manifest

```json
{
  "modulesContent": {
    "$edgeAgent": {
      "properties.desired": {
        "modules": {
          "videoAnalyzer": {
            "type": "docker",
            "status": "running",
            "restartPolicy": "always",
            "settings": {
              "image": "myregistry.azurecr.io/video-analyzer:1.0",
              "createOptions": {
                "HostConfig": {
                  "Binds": ["/dev:/dev"],
                  "Devices": [
                    {
                      "PathOnHost": "/dev/video0",
                      "PathInContainer": "/dev/video0"
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
        "routes": {
          "videoToHub": "FROM /messages/modules/videoAnalyzer/outputs/detections INTO $upstream",
          "videoToStream": "FROM /messages/modules/videoAnalyzer/outputs/detections INTO BrokeredEndpoint(\"/modules/streamAnalytics/inputs/detections\")"
        }
      }
    }
  }
}
```

## Audio AI with Azure Percept

### Custom Keyword Spotting

```python
from azure.cognitiveservices.speech import SpeechConfig, KeywordRecognitionModel
from azure.cognitiveservices.speech.audio import AudioConfig
import azure.cognitiveservices.speech as speechsdk

def setup_keyword_recognition(keyword_model_path, callback):
    """Setup custom keyword recognition."""
    speech_config = SpeechConfig(
        subscription=os.environ["SPEECH_KEY"],
        region=os.environ["SPEECH_REGION"]
    )

    audio_config = AudioConfig(use_default_microphone=True)
    keyword_model = KeywordRecognitionModel(keyword_model_path)

    recognizer = speechsdk.KeywordRecognizer(audio_config=audio_config)

    def recognized_callback(evt):
        if evt.result.reason == speechsdk.ResultReason.RecognizedKeyword:
            callback(evt.result.text)

    recognizer.recognized.connect(recognized_callback)

    return recognizer, keyword_model

def start_listening(recognizer, keyword_model):
    """Start continuous keyword recognition."""
    result_future = recognizer.recognize_once_async(keyword_model)
    return result_future

# Usage
def on_keyword_detected(keyword):
    print(f"Keyword detected: {keyword}")
    # Trigger action

recognizer, model = setup_keyword_recognition(
    "/models/custom_keyword.table",
    on_keyword_detected
)

future = start_listening(recognizer, model)
result = future.get()  # Blocks until keyword detected
```

## Integrating with Azure Services

### Stream Analytics for Real-Time Processing

```sql
-- Stream Analytics query for edge detections
SELECT
    IoTHub.ConnectionDeviceId as DeviceId,
    System.Timestamp as EventTime,
    GetArrayLength(detections) as ObjectCount,
    detections
INTO
    [powerbi-output]
FROM
    [iothub-input]
WHERE
    GetArrayLength(detections) > 0

-- Anomaly detection
SELECT
    DeviceId,
    System.Timestamp as EventTime,
    AVG(ObjectCount) as AvgObjects,
    STDEV(ObjectCount) as StdDevObjects
INTO
    [anomaly-output]
FROM
    (
        SELECT
            IoTHub.ConnectionDeviceId as DeviceId,
            GetArrayLength(detections) as ObjectCount
        FROM [iothub-input]
    )
GROUP BY
    DeviceId,
    TumblingWindow(minute, 5)
HAVING
    STDEV(ObjectCount) > 3  -- Alert on unusual variation
```

### Azure Functions for Business Logic

```python
import azure.functions as func
import json

app = func.FunctionApp()

@app.function_name("ProcessDetections")
@app.event_hub_trigger(
    arg_name="events",
    event_hub_name="percept-detections",
    connection="EVENT_HUB_CONNECTION"
)
async def process_detections(events: func.EventHubEvent):
    """Process detections from edge devices."""
    for event in events:
        body = json.loads(event.get_body().decode('utf-8'))

        device_id = body.get('device_id')
        detections = body.get('detections', [])

        # Check for critical detections
        critical = [d for d in detections if d['class_id'] == 2]  # e.g., defect class

        if critical:
            await send_alert(device_id, critical)
            await log_incident(device_id, critical)

        # Update metrics
        await update_metrics(device_id, len(detections))

async def send_alert(device_id, detections):
    """Send alert for critical detections."""
    # Implementation: Teams notification, email, etc.
    pass

async def log_incident(device_id, detections):
    """Log incident to database."""
    # Implementation: Cosmos DB, SQL, etc.
    pass

async def update_metrics(device_id, count):
    """Update detection metrics."""
    # Implementation: Application Insights, custom metrics
    pass
```

Azure Percept makes edge AI accessible to developers without deep expertise in hardware or ML. Combined with Azure's cloud services, it enables sophisticated intelligent edge solutions.

## Resources

- [Azure Percept Documentation](https://docs.microsoft.com/en-us/azure/azure-percept/)
- [Azure Percept Studio](https://ms.portal.azure.com/#blade/AzureEdgeDevices/Main)
- [Custom Vision](https://docs.microsoft.com/en-us/azure/cognitive-services/custom-vision-service/)
- [IoT Edge Modules](https://docs.microsoft.com/en-us/azure/iot-edge/module-development)
