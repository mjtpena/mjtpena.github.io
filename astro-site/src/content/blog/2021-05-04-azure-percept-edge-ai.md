---
title: "Azure Percept: Edge AI Development Made Accessible"
author: Michael John Peña
draft: false
date: 2021-05-04
tags:
  - Azure
  - AI
  - Edge Computing
  - IoT
  - Azure Percept

---

I wrote "Azure Percept: Edge AI Development Made Accessible" to share practical, production-minded guidance on this topic.

## What is Azure Percept?

Azure Percept is a platform that includes:
- **Azure Percept DK**: A development kit with vision and audio modules
- **Azure Percept Studio**: A no-code/low-code environment for building edge AI solutions
- **Integration with Azure AI services**: Pre-built models and custom training

The goal is reducing the time from idea to edge-deployed AI from months to days.

## The Hardware

The Azure Percept DK includes:
- **Carrier board**: The main compute module running Azure IoT Edge
- **Vision SOM**: Camera module with dedicated AI accelerator
- **Audio SOM**: Microphone array for voice scenarios

```bash
# Check connected modules on Percept DK
ssh azureuser@your-percept-device

# List IoT Edge modules
iotedge list

# Output:
# NAME                        STATUS           DESCRIPTION
# azureeyemodule              running          Azure Eye Module
# edgeAgent                   running          IoT Edge Agent
# edgeHub                     running          IoT Edge Hub
# WebStreamModule             running          Web Stream Module
```

## No-Code Vision AI with Percept Studio

Percept Studio lets you create vision AI solutions without writing code:

1. **Connect your device**: Register your Percept DK with IoT Hub
2. **Create a vision project**: Choose object detection or classification
3. **Capture training images**: Use the device's camera
4. **Label your data**: Tag objects in the captured images
5. **Train and deploy**: One-click training and deployment

The platform uses Azure Custom Vision under the hood but abstracts away the complexity.

## Custom Training with Code

For more control, use the SDK directly:

```python
from azure.cognitiveservices.vision.customvision.training import CustomVisionTrainingClient
from azure.cognitiveservices.vision.customvision.prediction import CustomVisionPredictionClient
from msrest.authentication import ApiKeyCredentials

# Training client
training_credentials = ApiKeyCredentials(in_headers={"Training-key": training_key})
trainer = CustomVisionTrainingClient(endpoint, training_credentials)

# Create a project for edge deployment
project = trainer.create_project(
    "Defect Detection",
    domain_id="General (compact)",  # Compact domain for edge
    export_target_platform="VAIDK"  # Vision AI Dev Kit format
)

# Add tags
defect_tag = trainer.create_tag(project.id, "defect")
ok_tag = trainer.create_tag(project.id, "ok")

# Upload training images
with open("defect_001.jpg", "rb") as image:
    trainer.create_images_from_data(
        project.id,
        image.read(),
        tag_ids=[defect_tag.id]
    )

# Train the model
iteration = trainer.train_project(project.id)
while iteration.status != "Completed":
    iteration = trainer.get_iteration(project.id, iteration.id)
    time.sleep(10)

# Export for edge deployment
export = trainer.export_iteration(
    project.id,
    iteration.id,
    platform="VAIDK",
    flavor="ARM"
)
```

## Deploying Models to Edge

Once trained, deploy models via IoT Edge:

```json
{
  "modulesContent": {
    "$edgeAgent": {
      "properties.desired": {
        "modules": {
          "CustomVisionModule": {
            "type": "docker",
            "status": "running",
            "restartPolicy": "always",
            "settings": {
              "image": "your-acr.azurecr.io/custom-vision:latest",
              "createOptions": "{\"HostConfig\":{\"Binds\":[\"/dev/bus/usb:/dev/bus/usb\"],\"Devices\":[{\"PathOnHost\":\"/dev/video0\",\"PathInContainer\":\"/dev/video0\"}]}}"
            }
          }
        }
      }
    },
    "$edgeHub": {
      "properties.desired": {
        "routes": {
          "CustomVisionToIoTHub": "FROM /messages/modules/CustomVisionModule/outputs/* INTO $upstream"
        }
      }
    }
  }
}
```

## Voice AI with Audio SOM

The Audio SOM enables voice-activated scenarios:

```python
import azure.cognitiveservices.speech as speechsdk

# Configure speech for edge processing
speech_config = speechsdk.SpeechConfig(
    subscription=speech_key,
    region=service_region
)

# Use the Percept Audio SOM microphone array
audio_config = speechsdk.audio.AudioConfig(device_name="default")

# Create speech recognizer
recognizer = speechsdk.SpeechRecognizer(
    speech_config=speech_config,
    audio_config=audio_config
)

# Add custom keywords for wake word detection
keyword_model = speechsdk.KeywordRecognitionModel("keyword.table")

def recognized_callback(evt):
    if evt.result.reason == speechsdk.ResultReason.RecognizedKeyword:
        print(f"Wake word detected: {evt.result.text}")
        # Start command processing
        process_command(recognizer)

recognizer.recognized.connect(recognized_callback)
recognizer.start_keyword_recognition(keyword_model)
```

## Integrating with Azure Services

Percept devices integrate with the broader Azure ecosystem:

```python
from azure.iot.device import IoTHubDeviceClient, Message
import json

# Connect to IoT Hub
connection_string = "HostName=your-hub.azure-devices.net;DeviceId=percept-device;SharedAccessKey=..."
client = IoTHubDeviceClient.create_from_connection_string(connection_string)

# Send inference results to cloud
def send_detection_result(detections):
    message = Message(json.dumps({
        "timestamp": datetime.utcnow().isoformat(),
        "device_id": "percept-001",
        "detections": [
            {
                "label": d.label,
                "confidence": d.confidence,
                "bounding_box": d.bounding_box
            }
            for d in detections
        ]
    }))

    message.content_type = "application/json"
    message.content_encoding = "utf-8"

    client.send_message(message)

# Stream to Azure Stream Analytics for real-time processing
# Or to Event Hubs for ingestion into other services
```

## Use Cases

**Retail**
- Shelf inventory monitoring
- Customer traffic analysis
- Self-checkout verification

**Manufacturing**
- Quality inspection
- Safety compliance monitoring
- Equipment status detection

**Healthcare**
- Patient monitoring
- Hand hygiene compliance
- Equipment tracking

## Performance Considerations

The Percept DK's AI accelerator handles inference efficiently:
- Object detection: ~30 fps
- Image classification: ~100 fps
- Small models run entirely on edge

For complex models, consider hybrid processing:
- Simple inference on edge
- Complex analysis in cloud
- Edge handles real-time, cloud handles batch

## Limitations

Current limitations to be aware of:
- Limited to specific hardware configurations
- Custom silicon requires specific model formats
- Some advanced scenarios need custom IoT Edge modules

## The Future of Edge AI

Azure Percept represents Microsoft's bet on democratizing edge AI. By combining:
- Purpose-built hardware
- No-code development tools
- Cloud integration

They're making it possible for non-specialists to deploy AI at the edge. As the platform matures, expect more hardware partners and expanded capabilities.

## Resources

- [Azure Percept Documentation](https://docs.microsoft.com/en-us/azure/azure-percept/)
- [Percept Studio](https://ms.portal.azure.com/#blade/AzureEdgeDevices/Main/overview)
- [Custom Vision Edge Deployment](https://docs.microsoft.com/en-us/azure/cognitive-services/custom-vision-service/export-your-model)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
