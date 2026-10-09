---
title: Image Analysis with Azure Computer Vision
description: "Computer Vision is the Cognitive Service that covers the \"I have an image and I need to know what's in it\" scenario without training a custom model. Read…"
author: Michael John Pena
draft: false
date: 2021-03-28
url: /blog/computer-vision/
tags:
  - Azure
  - Computer Vision
  - Cognitive Services
  - AI
  - Image Analysis
---

Computer Vision is the Cognitive Service that covers the "I have an image and I need to know what's in it" scenario without training a custom model. Read (OCR), image analysis (describe, tag, detect objects, identify brands, detect adult content), spatial analysis via a container on an edge device—all pre-trained, all callable via a REST API. The OCR capability (now unified under the "Read" API) has improved dramatically over the past year; handwritten text recognition in English is genuinely usable for document scanning. For anything domain-specific—"is this a defective weld joint?" or "is this the correct product SKU?"—you need Custom Vision. But for general-purpose image analysis, the off-the-shelf models are surprisingly capable.

## Setting Up Computer Vision

```bash
# Create Computer Vision resource
az cognitiveservices account create \
    --name mycomputervision \
    --resource-group myResourceGroup \
    --kind ComputerVision \
    --sku S1 \
    --location eastus

# Get keys and endpoint
az cognitiveservices account keys list \
    --name mycomputervision \
    --resource-group myResourceGroup
```

## Image Analysis

```python
from azure.cognitiveservices.vision.computervision import ComputerVisionClient
from azure.cognitiveservices.vision.computervision.models import VisualFeatureTypes
from msrest.authentication import CognitiveServicesCredentials
import io

class ImageAnalyzer:
    def __init__(self, endpoint, key):
        self.client = ComputerVisionClient(
            endpoint,
            CognitiveServicesCredentials(key)
        )

    def analyze_image(self, image_url, features=None):
        """Analyze an image from URL."""
        if features is None:
            features = [
                VisualFeatureTypes.categories,
                VisualFeatureTypes.description,
                VisualFeatureTypes.tags,
                VisualFeatureTypes.objects,
                VisualFeatureTypes.faces,
                VisualFeatureTypes.adult,
                VisualFeatureTypes.color,
                VisualFeatureTypes.image_type,
                VisualFeatureTypes.brands
            ]

        result = self.client.analyze_image(image_url, visual_features=features)
        return self._format_analysis(result)

    def analyze_image_stream(self, image_stream, features=None):
        """Analyze an image from stream."""
        if features is None:
            features = [
                VisualFeatureTypes.categories,
                VisualFeatureTypes.description,
                VisualFeatureTypes.tags,
                VisualFeatureTypes.objects
            ]

        result = self.client.analyze_image_in_stream(
            image_stream,
            visual_features=features
        )
        return self._format_analysis(result)

    def _format_analysis(self, result):
        """Format analysis results."""
        analysis = {}

        # Description
        if result.description:
            analysis["description"] = {
                "captions": [
                    {"text": c.text, "confidence": c.confidence}
                    for c in result.description.captions
                ],
                "tags": result.description.tags
            }

        # Tags
        if result.tags:
            analysis["tags"] = [
                {"name": t.name, "confidence": t.confidence}
                for t in result.tags
            ]

        # Objects
        if result.objects:
            analysis["objects"] = [
                {
                    "object": obj.object_property,
                    "confidence": obj.confidence,
                    "bounding_box": {
                        "x": obj.rectangle.x,
                        "y": obj.rectangle.y,
                        "width": obj.rectangle.w,
                        "height": obj.rectangle.h
                    }
                }
                for obj in result.objects
            ]

        # Faces
        if result.faces:
            analysis["faces"] = [
                {
                    "age": face.age,
                    "gender": face.gender,
                    "bounding_box": {
                        "left": face.face_rectangle.left,
                        "top": face.face_rectangle.top,
                        "width": face.face_rectangle.width,
                        "height": face.face_rectangle.height
                    }
                }
                for face in result.faces
            ]

        # Colors
        if result.color:
            analysis["colors"] = {
                "dominant_foreground": result.color.dominant_color_foreground,
                "dominant_background": result.color.dominant_color_background,
                "dominant_colors": result.color.dominant_colors,
                "accent_color": result.color.accent_color,
                "is_bw": result.color.is_bw_img
            }

        # Adult content
        if result.adult:
            analysis["adult"] = {
                "is_adult_content": result.adult.is_adult_content,
                "adult_score": result.adult.adult_score,
                "is_racy_content": result.adult.is_racy_content,
                "racy_score": result.adult.racy_score,
                "is_gory_content": result.adult.is_gory_content,
                "gore_score": result.adult.gore_score
            }

        # Brands
        if result.brands:
            analysis["brands"] = [
                {
                    "name": b.name,
                    "confidence": b.confidence,
                    "bounding_box": {
                        "x": b.rectangle.x,
                        "y": b.rectangle.y,
                        "width": b.rectangle.w,
                        "height": b.rectangle.h
                    }
                }
                for b in result.brands
            ]

        # Categories
        if result.categories:
            analysis["categories"] = [
                {"name": c.name, "score": c.score}
                for c in result.categories
            ]

        return analysis


# Usage
analyzer = ImageAnalyzer(
    "https://your-resource.cognitiveservices.azure.com",
    "your-key"
)

# Analyze from URL
result = analyzer.analyze_image(
    "https://example.com/image.jpg"
)

print(f"Description: {result['description']['captions'][0]['text']}")
print(f"Tags: {[t['name'] for t in result['tags'][:5]]}")
print(f"Objects detected: {len(result.get('objects', []))}")
```

## Optical Character Recognition (OCR)

```python
import time

class OCRReader:
    def __init__(self, endpoint, key):
        self.client = ComputerVisionClient(
            endpoint,
            CognitiveServicesCredentials(key)
        )

    def read_text(self, image_url):
        """Read text from image using Read API."""
        # Start read operation
        read_response = self.client.read(image_url, raw=True)

        # Get operation ID from response headers
        operation_location = read_response.headers["Operation-Location"]
        operation_id = operation_location.split("/")[-1]

        # Wait for operation to complete
        while True:
            result = self.client.get_read_result(operation_id)

            if result.status.lower() not in ["notstarted", "running"]:
                break

            time.sleep(1)

        # Extract text
        if result.status.lower() == "succeeded":
            return self._extract_text(result)
        else:
            raise Exception(f"OCR failed: {result.status}")

    def read_text_stream(self, image_stream):
        """Read text from image stream."""
        read_response = self.client.read_in_stream(image_stream, raw=True)

        operation_location = read_response.headers["Operation-Location"]
        operation_id = operation_location.split("/")[-1]

        while True:
            result = self.client.get_read_result(operation_id)

            if result.status.lower() not in ["notstarted", "running"]:
                break

            time.sleep(1)

        if result.status.lower() == "succeeded":
            return self._extract_text(result)
        else:
            raise Exception(f"OCR failed: {result.status}")

    def _extract_text(self, result):
        """Extract text and positions from OCR result."""
        pages = []

        for page in result.analyze_result.read_results:
            page_data = {
                "page": page.page,
                "width": page.width,
                "height": page.height,
                "angle": page.angle,
                "lines": []
            }

            for line in page.lines:
                line_data = {
                    "text": line.text,
                    "bounding_box": line.bounding_box,
                    "words": [
                        {
                            "text": word.text,
                            "bounding_box": word.bounding_box,
                            "confidence": word.confidence
                        }
                        for word in line.words
                    ]
                }
                page_data["lines"].append(line_data)

            pages.append(page_data)

        # Get full text
        full_text = "\n".join(
            line["text"]
            for page in pages
            for line in page["lines"]
        )

        return {
            "pages": pages,
            "full_text": full_text
        }


# Usage
ocr = OCRReader(
    "https://your-resource.cognitiveservices.azure.com",
    "your-key"
)

# Read text from document image
result = ocr.read_text("https://example.com/document.jpg")

print("Extracted text:")
print(result["full_text"])

# Read from local file
with open("document.jpg", "rb") as f:
    result = ocr.read_text_stream(f)
    print(result["full_text"])
```

## Object Detection

```python
def detect_objects(analyzer, image_url):
    """Detect and locate objects in image."""
    from PIL import Image, ImageDraw
    import requests
    from io import BytesIO

    # Analyze image
    result = analyzer.client.detect_objects(image_url)

    # Download image for visualization
    response = requests.get(image_url)
    img = Image.open(BytesIO(response.content))
    draw = ImageDraw.Draw(img)

    # Draw bounding boxes
    for obj in result.objects:
        rect = obj.rectangle
        draw.rectangle(
            [rect.x, rect.y, rect.x + rect.w, rect.y + rect.h],
            outline="red",
            width=3
        )
        draw.text(
            (rect.x, rect.y - 20),
            f"{obj.object_property} ({obj.confidence:.2f})",
            fill="red"
        )

    # Save annotated image
    img.save("detected_objects.jpg")

    return [
        {
            "object": obj.object_property,
            "confidence": obj.confidence,
            "rectangle": {
                "x": obj.rectangle.x,
                "y": obj.rectangle.y,
                "width": obj.rectangle.w,
                "height": obj.rectangle.h
            }
        }
        for obj in result.objects
    ]
```

## Thumbnail Generation

```python
def generate_thumbnail(analyzer, image_url, width, height, smart_cropping=True):
    """Generate smart-cropped thumbnail."""
    thumbnail = analyzer.client.generate_thumbnail(
        width,
        height,
        image_url,
        smart_cropping=smart_cropping
    )

    # Save thumbnail
    with open("thumbnail.jpg", "wb") as f:
        for chunk in thumbnail:
            f.write(chunk)

    return "thumbnail.jpg"


# Generate thumbnail from stream
def generate_thumbnail_from_file(analyzer, file_path, width, height):
    """Generate thumbnail from local file."""
    with open(file_path, "rb") as f:
        thumbnail = analyzer.client.generate_thumbnail_in_stream(
            width,
            height,
            f,
            smart_cropping=True
        )

    output_path = f"thumbnail_{width}x{height}.jpg"
    with open(output_path, "wb") as out:
        for chunk in thumbnail:
            out.write(chunk)

    return output_path
```

## Spatial Analysis (Video Analytics)

```python
# Spatial analysis for video streams (requires edge deployment)
spatial_analysis_config = {
    "ai_insights": [
        {
            "type": "cognitiveservices.vision.spatialanalysis-personcrossingline",
            "operation_id": "personcounting",
            "config": {
                "enable_face_mask_classifier": "true",
                "detector_node_config": '{"gpu_index": 0}',
                "lines": [
                    {
                        "line": {
                            "line": {
                                "start": {"x": 0.5, "y": 0.1},
                                "end": {"x": 0.5, "y": 0.9}
                            },
                            "name": "entrance"
                        },
                        "events": [
                            {
                                "type": "count",
                                "config": {
                                    "output_frequency": 1,
                                    "trigger": "event"
                                }
                            }
                        ]
                    }
                ]
            }
        }
    ]
}

# This would be deployed as part of Azure IoT Edge module
```

## REST API Integration

```python
from flask import Flask, request, jsonify
import base64

app = Flask(__name__)
analyzer = ImageAnalyzer("endpoint", "key")
ocr = OCRReader("endpoint", "key")

@app.route("/api/analyze", methods=["POST"])
def analyze_endpoint():
    """Analyze uploaded image."""
    if "image" in request.files:
        image = request.files["image"]
        stream = io.BytesIO(image.read())
        result = analyzer.analyze_image_stream(stream)
    elif "url" in request.json:
        result = analyzer.analyze_image(request.json["url"])
    else:
        return jsonify({"error": "No image provided"}), 400

    return jsonify(result)


@app.route("/api/ocr", methods=["POST"])
def ocr_endpoint():
    """Extract text from image."""
    if "image" in request.files:
        image = request.files["image"]
        stream = io.BytesIO(image.read())
        result = ocr.read_text_stream(stream)
    elif "url" in request.json:
        result = ocr.read_text(request.json["url"])
    else:
        return jsonify({"error": "No image provided"}), 400

    return jsonify(result)


@app.route("/api/describe", methods=["POST"])
def describe_endpoint():
    """Get image description."""
    url = request.json.get("url")
    if not url:
        return jsonify({"error": "URL required"}), 400

    result = analyzer.client.describe_image(url)

    return jsonify({
        "description": result.captions[0].text if result.captions else None,
        "confidence": result.captions[0].confidence if result.captions else 0,
        "tags": result.tags
    })


if __name__ == "__main__":
    app.run(debug=True)
```

## Conclusion

Azure Computer Vision provides comprehensive image analysis capabilities:

- **Image analysis** for understanding visual content
- **OCR** for extracting text from images and documents
- **Object detection** for locating items in images
- **Smart thumbnails** for content-aware cropping
- **Spatial analysis** for video stream processing

These capabilities enable applications from content moderation to document processing to retail analytics.
