---
title: Video Intelligence with Azure Video Analyzer
author: Michael John Pena
draft: false
date: 2021-09-22
tags:
  - Azure
  - Video Analytics
  - Computer Vision
  - AI
  - IoT

---

I wrote "2021-09-22-azure-video-analyzer" to share practical, production-minded guidance on this topic.

## Video Analyzer Capabilities

- **Object Detection**: Detect and track objects in video
- **Motion Detection**: Identify movement and activity
- **Line Crossing**: Count objects crossing virtual lines
- **Zone Intrusion**: Alert when objects enter defined areas
- **Face Detection**: Detect faces (not recognition)
- **Custom Models**: Deploy your own ML models

## Architecture Overview

```
+-------------+      +------------------+      +---------------+
|   Camera    | ---> |  IoT Edge        | ---> |   Azure       |
|   Stream    |      |  Video Analyzer  |      |   Cloud       |
+-------------+      +------------------+      +---------------+
                     |  - AI Processing  |      |  - Storage    |
                     |  - Local Insights |      |  - Analytics  |
                     |  - Edge Inference |      |  - Portal     |
                     +------------------+      +---------------+
```

## Setting Up Video Analyzer

```python
from azure.media.videoanalyzer.edge import (
    MediaGraphTopology,
    MediaGraphInstance,
    MediaGraphRtspSource,
    MediaGraphMotionDetectionProcessor,
    MediaGraphSignalGateProcessor,
    MediaGraphIoTHubMessageSink
)

def create_motion_detection_topology():
    """Create a topology for motion detection."""

    topology = MediaGraphTopology(
        name="MotionDetection",
        description="Detect motion in RTSP stream",
        parameters=[
            {"name": "rtspUrl", "type": "String"},
            {"name": "rtspUserName", "type": "String"},
            {"name": "rtspPassword", "type": "String", "default": ""}
        ],
        sources=[
            MediaGraphRtspSource(
                name="rtspSource",
                endpoint={
                    "@type": "#Microsoft.Media.MediaGraphUnsecuredEndpoint",
                    "url": "${rtspUrl}",
                    "credentials": {
                        "@type": "#Microsoft.Media.MediaGraphUsernamePasswordCredentials",
                        "username": "${rtspUserName}",
                        "password": "${rtspPassword}"
                    }
                }
            )
        ],
        processors=[
            MediaGraphMotionDetectionProcessor(
                name="motionDetection",
                inputs=[{"nodeName": "rtspSource"}],
                sensitivity="medium",
                outputMotionRegion=True
            )
        ],
        sinks=[
            MediaGraphIoTHubMessageSink(
                name="iotHubSink",
                inputs=[{"nodeName": "motionDetection"}],
                hubOutputName="inferenceOutput"
            )
        ]
    )

    return topology
```

## Object Detection Pipeline

```python
def create_object_detection_topology():
    """Create topology with YOLO object detection."""

    topology = MediaGraphTopology(
        name="ObjectDetection",
        description="Detect objects using YOLO",
        parameters=[
            {"name": "rtspUrl", "type": "String"},
            {"name": "rtspUserName", "type": "String"},
            {"name": "rtspPassword", "type": "String"},
            {"name": "inferenceUrl", "type": "String"}
        ],
        sources=[
            {
                "@type": "#Microsoft.Media.MediaGraphRtspSource",
                "name": "rtspSource",
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
        processors=[
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
                    "scale": {"mode": "preserveAspectRatio", "width": "416", "height": "416"},
                    "format": {"@type": "#Microsoft.Media.MediaGraphImageFormatJpeg"}
                }
            }
        ],
        sinks=[
            {
                "@type": "#Microsoft.Media.MediaGraphIoTHubMessageSink",
                "name": "iotHubSink",
                "inputs": [{"nodeName": "httpExtension"}],
                "hubOutputName": "inferenceOutput"
            }
        ]
    )

    return topology
```

## Processing Video Events

```python
import json
from azure.iot.hub import IoTHubRegistryManager
from azure.eventhub import EventHubConsumerClient

class VideoEventProcessor:
    def __init__(self, event_hub_connection: str, event_hub_name: str):
        self.consumer = EventHubConsumerClient.from_connection_string(
            event_hub_connection,
            consumer_group="$Default",
            eventhub_name=event_hub_name
        )

    def process_events(self, callback):
        """Process incoming video analytics events."""

        def on_event(partition_context, event):
            body = json.loads(event.body_as_str())

            # Parse inference results
            if "inferences" in body:
                for inference in body["inferences"]:
                    event_data = {
                        "type": inference.get("type"),
                        "subtype": inference.get("subtype"),
                        "entity": inference.get("entity"),
                        "event": inference.get("event"),
                        "timestamp": event.enqueued_time
                    }

                    if inference["type"] == "entity":
                        entity = inference["entity"]
                        event_data["detection"] = {
                            "tag": entity.get("tag", {}).get("value"),
                            "confidence": entity.get("tag", {}).get("confidence"),
                            "box": entity.get("box")
                        }

                    callback(event_data)

            partition_context.update_checkpoint(event)

        with self.consumer:
            self.consumer.receive(
                on_event=on_event,
                starting_position="-1"
            )

# Process video analytics events
def handle_detection(event):
    if event.get("detection"):
        det = event["detection"]
        print(f"Detected: {det['tag']} (confidence: {det['confidence']:.2f})")
        print(f"  Location: {det['box']}")

processor = VideoEventProcessor(
    "your-event-hub-connection",
    "your-event-hub-name"
)
# processor.process_events(handle_detection)
```

## Line Crossing Detection

```python
def create_line_crossing_topology():
    """Create topology for counting objects crossing a line."""

    topology = {
        "@apiVersion": "1.0",
        "name": "LineCrossing",
        "properties": {
            "parameters": [
                {"name": "rtspUrl", "type": "String"},
                {"name": "lineCoordinates", "type": "String"}
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
                    "@type": "#Microsoft.Media.MediaGraphCognitiveServicesVisionExtension",
                    "name": "spatialAnalysis",
                    "inputs": [{"nodeName": "rtspSource"}],
                    "endpoint": {
                        "@type": "#Microsoft.Media.MediaGraphUnsecuredEndpoint",
                        "url": "http://spatialanalysis:5000/score"
                    },
                    "operation": {
                        "@type": "#Microsoft.Media.MediaGraphSpatialAnalysisLineCrossingOperation",
                        "lines": [
                            {
                                "line": "${lineCoordinates}",
                                "events": [
                                    {"type": "lineCrossed"}
                                ]
                            }
                        ],
                        "outputFrequency": "1"
                    }
                }
            ],
            "sinks": [
                {
                    "@type": "#Microsoft.Media.MediaGraphIoTHubMessageSink",
                    "name": "iotHubSink",
                    "inputs": [{"nodeName": "spatialAnalysis"}],
                    "hubOutputName": "lineCrossingEvents"
                }
            ]
        }
    }

    return topology

# Line coordinates format: "x1,y1,x2,y2" (normalized 0-1)
# Example: "0.5,0,0.5,1" is a vertical line in the center
```

## Zone Monitoring

```python
def create_zone_monitoring_topology():
    """Monitor when objects enter/exit defined zones."""

    topology = {
        "@apiVersion": "1.0",
        "name": "ZoneMonitoring",
        "properties": {
            "parameters": [
                {"name": "rtspUrl", "type": "String"},
                {"name": "zonePolygon", "type": "String"}
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
                    "@type": "#Microsoft.Media.MediaGraphCognitiveServicesVisionExtension",
                    "name": "spatialAnalysis",
                    "inputs": [{"nodeName": "rtspSource"}],
                    "endpoint": {
                        "@type": "#Microsoft.Media.MediaGraphUnsecuredEndpoint",
                        "url": "http://spatialanalysis:5000/score"
                    },
                    "operation": {
                        "@type": "#Microsoft.Media.MediaGraphSpatialAnalysisPersonZoneCrossingOperation",
                        "zones": [
                            {
                                "zone": "${zonePolygon}",
                                "events": [
                                    {"type": "zoneCrossed", "threshold": "16"},
                                    {"type": "zoneOccupancy", "threshold": "8"}
                                ]
                            }
                        ]
                    }
                }
            ],
            "sinks": [
                {
                    "@type": "#Microsoft.Media.MediaGraphIoTHubMessageSink",
                    "name": "iotHubSink",
                    "inputs": [{"nodeName": "spatialAnalysis"}],
                    "hubOutputName": "zoneEvents"
                }
            ]
        }
    }

    return topology
```

## Recording Video Clips

```python
def create_event_recording_topology():
    """Record video clips when events occur."""

    topology = {
        "@apiVersion": "1.0",
        "name": "EventRecording",
        "properties": {
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
                    "@type": "#Microsoft.Media.MediaGraphMotionDetectionProcessor",
                    "name": "motionDetection",
                    "inputs": [{"nodeName": "rtspSource"}],
                    "sensitivity": "medium"
                },
                {
                    "@type": "#Microsoft.Media.MediaGraphSignalGateProcessor",
                    "name": "signalGate",
                    "inputs": [
                        {"nodeName": "motionDetection"},
                        {"nodeName": "rtspSource"}
                    ],
                    "activationEvaluationWindow": "PT1S",
                    "activationSignalOffset": "-PT5S",
                    "minimumActivationTime": "PT30S",
                    "maximumActivationTime": "PT1M"
                }
            ],
            "sinks": [
                {
                    "@type": "#Microsoft.Media.MediaGraphAssetSink",
                    "name": "assetSink",
                    "inputs": [{"nodeName": "signalGate"}],
                    "assetNamePattern": "motion-${System.DateTime}",
                    "segmentLength": "PT30S"
                }
            ]
        }
    }

    return topology
```

## Best Practices

1. **Edge Processing**: Process locally to reduce bandwidth
2. **Frame Rate**: Lower frame rates reduce compute requirements
3. **Resolution**: Balance quality with processing speed
4. **Zone Design**: Define clear, non-overlapping zones
5. **Event Filtering**: Filter events to reduce noise
6. **Storage Management**: Implement retention policies

Azure Video Analyzer brings intelligent video analytics to both edge and cloud, enabling sophisticated spatial analysis and event detection for security, retail, and industrial applications.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
