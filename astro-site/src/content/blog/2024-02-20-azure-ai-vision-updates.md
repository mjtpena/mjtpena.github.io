---
title: "Azure AI Vision Updates: New Features for 2024"
author: Michael John Peña
draft: false
date: 2024-02-20
tags:
  - Azure AI Vision
  - Computer Vision
  - Azure
  - Image Analysis
  - Updates

---

I wrote "Azure AI Vision Updates: New Features for 2024" to share practical, production-minded guidance on this topic.

## Image Analysis 4.0

```python
from azure.ai.vision.imageanalysis import ImageAnalysisClient
from azure.ai.vision.imageanalysis.models import VisualFeatures
from azure.identity import DefaultAzureCredential

client = ImageAnalysisClient(
    endpoint="https://your-vision.cognitiveservices.azure.com/",
    credential=DefaultAzureCredential()
)

def analyze_image(image_url: str) -> dict:
    """Analyze image with new Vision 4.0 features."""

    result = client.analyze_from_url(
        image_url=image_url,
        visual_features=[
            VisualFeatures.CAPTION,
            VisualFeatures.DENSE_CAPTIONS,
            VisualFeatures.OBJECTS,
            VisualFeatures.TAGS,
            VisualFeatures.PEOPLE,
            VisualFeatures.SMART_CROPS,
            VisualFeatures.READ
        ]
    )

    return {
        "caption": result.caption.text if result.caption else None,
        "dense_captions": [c.text for c in result.dense_captions.list] if result.dense_captions else [],
        "objects": [{"name": o.tags[0].name, "confidence": o.tags[0].confidence} for o in result.objects.list] if result.objects else [],
        "tags": [t.name for t in result.tags.list] if result.tags else [],
        "people_count": len(result.people.list) if result.people else 0,
        "text": result.read.blocks if result.read else []
    }
```

## Dense Captioning

```python
def get_dense_captions(image_url: str) -> list[dict]:
    """Get multiple captions describing different regions."""

    result = client.analyze_from_url(
        image_url=image_url,
        visual_features=[VisualFeatures.DENSE_CAPTIONS]
    )

    captions = []
    for caption in result.dense_captions.list:
        captions.append({
            "text": caption.text,
            "confidence": caption.confidence,
            "bounding_box": caption.bounding_box
        })

    return captions
```

## Smart Cropping

```python
def smart_crop(image_url: str, aspect_ratios: list[float]) -> list[dict]:
    """Get smart crop suggestions for multiple aspect ratios."""

    result = client.analyze_from_url(
        image_url=image_url,
        visual_features=[VisualFeatures.SMART_CROPS],
        smart_crops_aspect_ratios=aspect_ratios
    )

    crops = []
    for crop in result.smart_crops.list:
        crops.append({
            "aspect_ratio": crop.aspect_ratio,
            "bounding_box": {
                "x": crop.bounding_box.x,
                "y": crop.bounding_box.y,
                "width": crop.bounding_box.width,
                "height": crop.bounding_box.height
            }
        })

    return crops

# Get crops for social media
crops = smart_crop(image_url, [1.0, 1.91, 0.8])  # Square, Twitter, Pinterest
```

## Background Removal

```python
def remove_background(image_url: str) -> bytes:
    """Remove background from image."""

    result = client.analyze_from_url(
        image_url=image_url,
        visual_features=[],  # Background removal is separate
        background_removal_mode="foreground"
    )

    return result.foreground_image_data
```

## Best Practices

1. **Use appropriate features** - Only request what you need
2. **Handle confidence scores** - Filter low-confidence results
3. **Combine with GPT-4V** - Vision 4.0 for detection, GPT-4V for reasoning
4. **Batch processing** - Process multiple images efficiently
5. **Cache results** - Store analysis for reuse

## Conclusion

Azure AI Vision 4.0 brings powerful new features like dense captioning and smart cropping. Combine with GPT-4 Vision for comprehensive image understanding.

