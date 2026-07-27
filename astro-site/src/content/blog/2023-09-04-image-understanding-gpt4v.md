---
title: "Azure Cognitive Services for Computer Vision: Current Capabilities"
author: Michael John Peña
draft: false
date: 2023-09-04
description: "Explore Azure Cognitive Services Computer Vision capabilities for image analysis, OCR, and object detection in your applications."
tags:
  - Azure
  - Cognitive Services
  - Computer Vision
  - Image Analysis
  - AI

---

I wrote "Azure Cognitive Services for Computer Vision: Current Capabilities" to share practical, production-minded guidance on this topic.

## Introduction

While GPT-4 excels at text processing, Azure Cognitive Services Computer Vision remains the go-to solution for image analysis tasks. This post explores the current capabilities and how to integrate them into your applications.

## Computer Vision Capabilities

Azure Computer Vision offers several key features:

1. **Image Analysis**: Describe images, detect objects, extract tags
2. **OCR (Read API)**: Extract text from images and documents
3. **Face Detection**: Detect and analyze faces
4. **Spatial Analysis**: Analyze movement and presence in video
5. **Custom Vision**: Train custom image classifiers

## Getting Started

### Installation

```bash
pip install azure-cognitiveservices-vision-computervision azure-ai-vision-imageanalysis
```

### Basic Setup

```python
import os
from azure.cognitiveservices.vision.computervision import ComputerVisionClient
from azure.cognitiveservices.vision.computervision.models import VisualFeatureTypes
from msrest.authentication import CognitiveServicesCredentials

# Initialize client
endpoint = os.getenv("AZURE_VISION_ENDPOINT")
key = os.getenv("AZURE_VISION_KEY")

client = ComputerVisionClient(
    endpoint=endpoint,
    credentials=CognitiveServicesCredentials(key)
)
```

## Image Analysis

### Analyzing an Image

```python
from azure.cognitiveservices.vision.computervision.models import VisualFeatureTypes

def analyze_image(image_url: str) -> dict:
    """Analyze an image and extract various features."""
    features = [
        VisualFeatureTypes.categories,
        VisualFeatureTypes.description,
        VisualFeatureTypes.tags,
        VisualFeatureTypes.objects,
        VisualFeatureTypes.brands,
        VisualFeatureTypes.adult,
        VisualFeatureTypes.color,
        VisualFeatureTypes.faces
    ]

    result = client.analyze_image(image_url, features)

    analysis = {
        "description": None,
        "categories": [],
        "tags": [],
        "objects": [],
        "colors": {},
        "faces": []
    }

    # Extract description
    if result.description and result.description.captions:
        analysis["description"] = {
            "text": result.description.captions[0].text,
            "confidence": result.description.captions[0].confidence
        }

    # Extract categories
    if result.categories:
        analysis["categories"] = [
            {"name": cat.name, "score": cat.score}
            for cat in result.categories
        ]

    # Extract tags
    if result.tags:
        analysis["tags"] = [
            {"name": tag.name, "confidence": tag.confidence}
            for tag in result.tags
        ]

    # Extract objects
    if result.objects:
        analysis["objects"] = [
            {
                "name": obj.object_property,
                "confidence": obj.confidence,
                "rectangle": {
                    "x": obj.rectangle.x,
                    "y": obj.rectangle.y,
                    "w": obj.rectangle.w,
                    "h": obj.rectangle.h
                }
            }
            for obj in result.objects
        ]

    # Extract colors
    if result.color:
        analysis["colors"] = {
            "dominant_foreground": result.color.dominant_color_foreground,
            "dominant_background": result.color.dominant_color_background,
            "accent_color": result.color.accent_color,
            "is_bw": result.color.is_bw_img
        }

    # Extract faces
    if result.faces:
        analysis["faces"] = [
            {
                "age": face.age,
                "gender": face.gender.value,
                "rectangle": {
                    "left": face.face_rectangle.left,
                    "top": face.face_rectangle.top,
                    "width": face.face_rectangle.width,
                    "height": face.face_rectangle.height
                }
            }
            for face in result.faces
        ]

    return analysis

# Usage
result = analyze_image("https://example.com/image.jpg")
print(f"Description: {result['description']['text']}")
print(f"Tags: {[t['name'] for t in result['tags'][:5]]}")
```

### Analyzing Local Images

```python
def analyze_local_image(image_path: str) -> dict:
    """Analyze a local image file."""
    with open(image_path, "rb") as image_stream:
        features = [
            VisualFeatureTypes.description,
            VisualFeatureTypes.tags,
            VisualFeatureTypes.objects
        ]

        result = client.analyze_image_in_stream(image_stream, features)

        return {
            "description": result.description.captions[0].text if result.description.captions else None,
            "tags": [tag.name for tag in result.tags] if result.tags else [],
            "objects": [obj.object_property for obj in result.objects] if result.objects else []
        }

# Usage
local_result = analyze_local_image("./my_image.jpg")
print(local_result)
```

## OCR with Read API

### Extracting Text from Images

```python
import time

def extract_text(image_url: str) -> str:
    """Extract text from an image using the Read API."""

    # Start the read operation
    read_response = client.read(image_url, raw=True)

    # Get operation ID from response headers
    operation_location = read_response.headers["Operation-Location"]
    operation_id = operation_location.split("/")[-1]

    # Wait for the operation to complete
    while True:
        result = client.get_read_result(operation_id)
        if result.status.lower() not in ['notstarted', 'running']:
            break
        time.sleep(1)

    # Extract text
    if result.status.lower() == 'succeeded':
        text_lines = []
        for read_result in result.analyze_result.read_results:
            for line in read_result.lines:
                text_lines.append(line.text)
        return "\n".join(text_lines)
    else:
        return f"OCR failed with status: {result.status}"

# Usage
text = extract_text("https://example.com/document.jpg")
print(text)
```

### Structured Text Extraction

```python
from dataclasses import dataclass
from typing import List, Optional

@dataclass
class TextLine:
    text: str
    confidence: float
    bounding_box: List[float]

@dataclass
class TextBlock:
    lines: List[TextLine]
    page: int

class StructuredOCR:
    def __init__(self, client):
        self.client = client

    def extract_structured(self, image_url: str) -> List[TextBlock]:
        """Extract text with position and confidence information."""

        # Start read operation
        read_response = self.client.read(image_url, raw=True)
        operation_id = read_response.headers["Operation-Location"].split("/")[-1]

        # Wait for completion
        while True:
            result = self.client.get_read_result(operation_id)
            if result.status.lower() not in ['notstarted', 'running']:
                break
            time.sleep(1)

        if result.status.lower() != 'succeeded':
            raise Exception(f"OCR failed: {result.status}")

        # Parse results
        blocks = []
        for page_num, read_result in enumerate(result.analyze_result.read_results):
            lines = []
            for line in read_result.lines:
                text_line = TextLine(
                    text=line.text,
                    confidence=getattr(line, 'confidence', 1.0),
                    bounding_box=line.bounding_box
                )
                lines.append(text_line)

            blocks.append(TextBlock(lines=lines, page=page_num))

        return blocks

    def extract_tables(self, image_url: str) -> List[dict]:
        """Attempt to extract tabular data from image."""
        blocks = self.extract_structured(image_url)

        # Group lines by vertical position (rough table detection)
        tables = []
        for block in blocks:
            rows = {}
            for line in block.lines:
                # Use top Y coordinate to group lines into rows
                y_pos = line.bounding_box[1]  # Top-left Y
                row_key = round(y_pos / 20) * 20  # Group by ~20 pixel bands

                if row_key not in rows:
                    rows[row_key] = []
                rows[row_key].append(line.text)

            if rows:
                tables.append({
                    "page": block.page,
                    "rows": [rows[k] for k in sorted(rows.keys())]
                })

        return tables

# Usage
ocr = StructuredOCR(client)
blocks = ocr.extract_structured("https://example.com/document.png")

for block in blocks:
    print(f"Page {block.page}:")
    for line in block.lines:
        print(f"  {line.text}")
```

## Object Detection

### Detecting and Locating Objects

```python
from PIL import Image, ImageDraw
import requests
from io import BytesIO

class ObjectDetector:
    def __init__(self, client):
        self.client = client

    def detect_objects(self, image_url: str) -> List[dict]:
        """Detect objects in an image."""
        result = self.client.detect_objects(image_url)

        objects = []
        for obj in result.objects:
            objects.append({
                "name": obj.object_property,
                "confidence": obj.confidence,
                "parent": obj.parent.object_property if obj.parent else None,
                "bounding_box": {
                    "x": obj.rectangle.x,
                    "y": obj.rectangle.y,
                    "width": obj.rectangle.w,
                    "height": obj.rectangle.h
                }
            })

        return objects

    def visualize_detections(self, image_url: str, output_path: str):
        """Draw bounding boxes on detected objects."""
        # Get detections
        detections = self.detect_objects(image_url)

        # Download image
        response = requests.get(image_url)
        img = Image.open(BytesIO(response.content))
        draw = ImageDraw.Draw(img)

        # Draw boxes
        for det in detections:
            box = det["bounding_box"]
            x, y, w, h = box["x"], box["y"], box["width"], box["height"]

            # Draw rectangle
            draw.rectangle(
                [(x, y), (x + w, y + h)],
                outline="red",
                width=3
            )

            # Draw label
            label = f"{det['name']} ({det['confidence']:.2f})"
            draw.text((x, y - 20), label, fill="red")

        # Save
        img.save(output_path)
        return output_path

# Usage
detector = ObjectDetector(client)
objects = detector.detect_objects("https://example.com/scene.jpg")

for obj in objects:
    print(f"Found {obj['name']} with confidence {obj['confidence']:.2f}")

# Visualize
detector.visualize_detections(
    "https://example.com/scene.jpg",
    "detections.jpg"
)
```

## Custom Vision

For specialized use cases, Custom Vision allows training custom models:

```python
from azure.cognitiveservices.vision.customvision.training import CustomVisionTrainingClient
from azure.cognitiveservices.vision.customvision.prediction import CustomVisionPredictionClient

# Training client
training_client = CustomVisionTrainingClient(
    os.getenv("CUSTOM_VISION_TRAINING_ENDPOINT"),
    CognitiveServicesCredentials(os.getenv("CUSTOM_VISION_TRAINING_KEY"))
)

# Prediction client
prediction_client = CustomVisionPredictionClient(
    os.getenv("CUSTOM_VISION_PREDICTION_ENDPOINT"),
    CognitiveServicesCredentials(os.getenv("CUSTOM_VISION_PREDICTION_KEY"))
)

def predict_image(project_id: str, publish_name: str, image_url: str) -> List[dict]:
    """Predict using a custom trained model."""
    results = prediction_client.classify_image_url(
        project_id,
        publish_name,
        image_url
    )

    predictions = []
    for pred in results.predictions:
        predictions.append({
            "tag": pred.tag_name,
            "probability": pred.probability
        })

    return sorted(predictions, key=lambda x: x["probability"], reverse=True)

# Usage
predictions = predict_image(
    project_id="your-project-id",
    publish_name="your-iteration-name",
    image_url="https://example.com/test_image.jpg"
)

for pred in predictions[:3]:
    print(f"{pred['tag']}: {pred['probability']:.2%}")
```

## Combining with GPT-4

While Computer Vision handles image analysis, you can combine results with GPT-4 for richer insights:

```python
from langchain_openai import AzureChatOpenAI

def analyze_and_describe(image_url: str) -> str:
    """Combine Computer Vision analysis with GPT-4 description."""

    # Get Computer Vision analysis
    analysis = analyze_image(image_url)

    # Build context for GPT-4
    context = f"""
    Image Analysis Results:
    - Description: {analysis['description']['text'] if analysis['description'] else 'N/A'}
    - Tags: {', '.join([t['name'] for t in analysis['tags'][:10]])}
    - Objects detected: {', '.join([o['name'] for o in analysis['objects']])}
    - Dominant colors: {analysis['colors'].get('dominant_background', 'N/A')}, {analysis['colors'].get('dominant_foreground', 'N/A')}
    """

    # Use GPT-4 to generate rich description
    llm = AzureChatOpenAI(
        azure_endpoint=os.getenv("AZURE_OPENAI_ENDPOINT"),
        api_key=os.getenv("AZURE_OPENAI_KEY"),
        deployment_name="gpt-4"
    )

    prompt = f"""Based on this image analysis, write a detailed, engaging description of the image:

{context}

Write a natural description as if describing the image to someone who cannot see it."""

    response = llm.invoke(prompt)
    return response.content

# Usage
description = analyze_and_describe("https://example.com/photo.jpg")
print(description)
```

## Conclusion

Azure Cognitive Services Computer Vision provides robust, production-ready capabilities for image analysis, OCR, and object detection. While waiting for multimodal capabilities in GPT-4, these services offer proven solutions for vision AI applications. Combining Computer Vision with GPT-4 for text generation creates powerful hybrid solutions.

## Resources

- [Computer Vision Documentation](https://learn.microsoft.com/azure/cognitive-services/computer-vision/)
- [Custom Vision Documentation](https://learn.microsoft.com/azure/cognitive-services/custom-vision-service/)
- [OCR Documentation](https://learn.microsoft.com/azure/cognitive-services/computer-vision/overview-ocr)

