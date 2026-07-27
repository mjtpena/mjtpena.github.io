---
title: "Image Generation with DALL-E 2 on Azure OpenAI Service"
author: Michael John Peña
draft: false
date: 2023-09-06
description: "Learn how to generate images using DALL-E 2 on Azure OpenAI Service for creative and business applications."
tags:
  - Azure
  - OpenAI
  - DALL-E
  - Image Generation
  - AI

---

I wrote "Image Generation with DALL-E 2 on Azure OpenAI Service" to share practical, production-minded guidance on this topic.

## Introduction

DALL-E 2 is available on Azure OpenAI Service, bringing powerful text-to-image generation capabilities to enterprise applications with Azure's security and compliance features. This post covers how to integrate DALL-E 2 into your applications.

## What is DALL-E 2?

DALL-E 2 is OpenAI's image generation model that creates images from text descriptions. It can:

- Generate original images from text prompts
- Create variations of existing images
- Edit images with inpainting
- Produce images in various styles and formats

## Getting Started

### Prerequisites

```bash
pip install openai pillow requests
```

### Basic Configuration

```python
import os
import openai
from PIL import Image
import requests
from io import BytesIO

# Configure Azure OpenAI
openai.api_type = "azure"
openai.api_base = os.getenv("AZURE_OPENAI_ENDPOINT")
openai.api_version = "2023-06-01-preview"
openai.api_key = os.getenv("AZURE_OPENAI_KEY")

DALLE_DEPLOYMENT = "dalle2"  # Your DALL-E deployment name
```

## Generating Images

### Basic Image Generation

```python
def generate_image(prompt: str, size: str = "1024x1024", n: int = 1) -> list:
    """Generate images from a text prompt."""
    response = openai.Image.create(
        prompt=prompt,
        size=size,  # 256x256, 512x512, or 1024x1024
        n=n  # Number of images (1-10)
    )

    return [item["url"] for item in response["data"]]

# Usage
urls = generate_image(
    "A serene mountain landscape at sunset with a lake reflection, digital art style"
)

for i, url in enumerate(urls):
    print(f"Image {i+1}: {url}")
```

### Downloading and Saving Images

```python
def generate_and_save(prompt: str, output_dir: str = "./generated") -> list:
    """Generate images and save them locally."""
    import os
    os.makedirs(output_dir, exist_ok=True)

    urls = generate_image(prompt)
    saved_paths = []

    for i, url in enumerate(urls):
        response = requests.get(url)
        img = Image.open(BytesIO(response.content))

        # Create filename from prompt
        safe_prompt = "".join(c for c in prompt[:30] if c.isalnum() or c == " ").strip()
        safe_prompt = safe_prompt.replace(" ", "_")
        filename = f"{safe_prompt}_{i+1}.png"
        filepath = os.path.join(output_dir, filename)

        img.save(filepath)
        saved_paths.append(filepath)
        print(f"Saved: {filepath}")

    return saved_paths

# Usage
paths = generate_and_save("A futuristic city with flying cars and neon lights")
```

## Prompt Engineering for DALL-E

### Structured Prompts

```python
from dataclasses import dataclass
from typing import Optional, List

@dataclass
class ImagePrompt:
    subject: str
    style: Optional[str] = None
    mood: Optional[str] = None
    lighting: Optional[str] = None
    composition: Optional[str] = None
    additional_details: Optional[List[str]] = None

    def build(self) -> str:
        """Build a structured prompt string."""
        parts = [self.subject]

        if self.style:
            parts.append(f"in {self.style} style")

        if self.mood:
            parts.append(f"{self.mood} mood")

        if self.lighting:
            parts.append(f"{self.lighting} lighting")

        if self.composition:
            parts.append(self.composition)

        if self.additional_details:
            parts.extend(self.additional_details)

        return ", ".join(parts)

# Usage
prompt = ImagePrompt(
    subject="A cozy coffee shop interior",
    style="watercolor painting",
    mood="warm and inviting",
    lighting="soft natural light through windows",
    composition="wide angle view",
    additional_details=["wooden furniture", "plants", "books on shelves"]
)

print(prompt.build())
# Output: A cozy coffee shop interior, in watercolor painting style, warm and inviting mood,
#         soft natural light through windows lighting, wide angle view, wooden furniture,
#         plants, books on shelves
```

### Style Templates

```python
STYLE_TEMPLATES = {
    "photorealistic": "photorealistic, highly detailed, 8k resolution, professional photography",
    "digital_art": "digital art, vibrant colors, detailed illustration, artstation trending",
    "oil_painting": "oil painting style, classical, rich textures, museum quality",
    "watercolor": "watercolor painting, soft edges, flowing colors, artistic",
    "anime": "anime style, vibrant, detailed, studio quality",
    "minimalist": "minimalist design, clean lines, simple shapes, modern",
    "vintage": "vintage aesthetic, retro style, nostalgic, film grain",
    "3d_render": "3D render, octane render, detailed, realistic lighting"
}

def generate_with_style(subject: str, style_key: str) -> list:
    """Generate image with predefined style."""
    style = STYLE_TEMPLATES.get(style_key, "")
    prompt = f"{subject}, {style}" if style else subject
    return generate_image(prompt)

# Usage
urls = generate_with_style(
    "A dragon flying over a medieval castle",
    "digital_art"
)
```

## Building an Image Generation Service

```python
from dataclasses import dataclass
from typing import Optional, List
from enum import Enum
import hashlib
import json

class ImageSize(Enum):
    SMALL = "256x256"
    MEDIUM = "512x512"
    LARGE = "1024x1024"

@dataclass
class GenerationRequest:
    prompt: str
    size: ImageSize = ImageSize.LARGE
    count: int = 1
    style_template: Optional[str] = None

@dataclass
class GenerationResult:
    request: GenerationRequest
    urls: List[str]
    prompt_used: str
    success: bool
    error: Optional[str] = None

class ImageGenerationService:
    def __init__(self):
        self.style_templates = STYLE_TEMPLATES
        self.generation_history = []

    def generate(self, request: GenerationRequest) -> GenerationResult:
        """Generate images based on request."""
        try:
            # Build final prompt
            prompt = request.prompt
            if request.style_template and request.style_template in self.style_templates:
                style = self.style_templates[request.style_template]
                prompt = f"{request.prompt}, {style}"

            # Generate images
            response = openai.Image.create(
                prompt=prompt,
                size=request.size.value,
                n=request.count
            )

            urls = [item["url"] for item in response["data"]]

            result = GenerationResult(
                request=request,
                urls=urls,
                prompt_used=prompt,
                success=True
            )

            self.generation_history.append(result)
            return result

        except Exception as e:
            return GenerationResult(
                request=request,
                urls=[],
                prompt_used=request.prompt,
                success=False,
                error=str(e)
            )

    def generate_variations(self, base_prompt: str, variations: List[str]) -> List[GenerationResult]:
        """Generate multiple variations of a base concept."""
        results = []
        for variation in variations:
            request = GenerationRequest(
                prompt=f"{base_prompt}, {variation}",
                size=ImageSize.MEDIUM
            )
            result = self.generate(request)
            results.append(result)
        return results

    def get_history(self) -> List[GenerationResult]:
        """Get generation history."""
        return self.generation_history

# Usage
service = ImageGenerationService()

# Single generation
result = service.generate(GenerationRequest(
    prompt="A peaceful zen garden",
    style_template="watercolor",
    size=ImageSize.LARGE
))

if result.success:
    print(f"Generated {len(result.urls)} images")
    for url in result.urls:
        print(f"  {url}")
else:
    print(f"Error: {result.error}")

# Generate variations
variations = service.generate_variations(
    "A modern office space",
    ["with natural light", "at night with city view", "minimalist design", "with plants"]
)

for var in variations:
    if var.success:
        print(f"Prompt: {var.prompt_used[:50]}... -> {len(var.urls)} images")
```

## Content Safety

Azure OpenAI includes content filtering for DALL-E:

```python
def safe_generate(prompt: str) -> dict:
    """Generate with safety handling."""
    try:
        response = openai.Image.create(
            prompt=prompt,
            size="1024x1024",
            n=1
        )

        return {
            "success": True,
            "url": response["data"][0]["url"]
        }

    except openai.error.InvalidRequestError as e:
        error_msg = str(e).lower()

        if "content policy" in error_msg or "safety" in error_msg:
            return {
                "success": False,
                "error": "Content policy violation",
                "details": "The prompt was flagged by content filters. Please revise."
            }

        return {
            "success": False,
            "error": "Invalid request",
            "details": str(e)
        }

    except Exception as e:
        return {
            "success": False,
            "error": "Generation failed",
            "details": str(e)
        }

# Usage
result = safe_generate("A beautiful sunset over the ocean")
if result["success"]:
    print(f"Generated: {result['url']}")
else:
    print(f"Error: {result['error']} - {result['details']}")
```

## Practical Applications

### Product Visualization

```python
def generate_product_mockup(
    product_description: str,
    background: str = "clean white studio background",
    angle: str = "3/4 view"
) -> str:
    """Generate product visualization."""
    prompt = f"{product_description}, {background}, {angle}, product photography, professional lighting"

    urls = generate_image(prompt)
    return urls[0] if urls else None

# Usage
url = generate_product_mockup(
    "A sleek wireless bluetooth speaker",
    background="modern living room setting",
    angle="hero shot from front"
)
```

### Marketing Content

```python
def generate_marketing_image(
    concept: str,
    brand_colors: List[str],
    format_type: str = "social_media"
) -> str:
    """Generate marketing visuals."""
    formats = {
        "social_media": "square format, eye-catching, bold design",
        "banner": "wide format, clean layout, professional",
        "thumbnail": "compact, high contrast, attention grabbing"
    }

    colors = " and ".join(brand_colors)
    format_style = formats.get(format_type, formats["social_media"])

    prompt = f"{concept}, using {colors} color scheme, {format_style}, marketing quality"

    urls = generate_image(prompt)
    return urls[0] if urls else None

# Usage
url = generate_marketing_image(
    "Technology innovation concept",
    ["blue", "white", "silver"],
    "social_media"
)
```

## Cost Management

```python
class CostTracker:
    # Pricing per image (approximate, check current rates)
    PRICING = {
        "256x256": 0.016,
        "512x512": 0.018,
        "1024x1024": 0.020
    }

    def __init__(self):
        self.generations = []

    def track(self, size: str, count: int):
        """Track a generation."""
        cost = self.PRICING.get(size, 0.020) * count
        self.generations.append({
            "size": size,
            "count": count,
            "cost": cost
        })
        return cost

    def get_total_cost(self) -> float:
        return sum(g["cost"] for g in self.generations)

    def get_report(self) -> dict:
        return {
            "total_images": sum(g["count"] for g in self.generations),
            "total_cost": self.get_total_cost(),
            "by_size": {
                size: sum(g["count"] for g in self.generations if g["size"] == size)
                for size in self.PRICING.keys()
            }
        }

tracker = CostTracker()

# After each generation
tracker.track("1024x1024", 1)
print(tracker.get_report())
```

## Conclusion

DALL-E 2 on Azure OpenAI Service enables powerful image generation capabilities for enterprise applications. With proper prompt engineering, content safety handling, and cost management, you can build sophisticated creative applications while maintaining Azure's security and compliance standards.

Looking ahead, we anticipate DALL-E 3 will bring even more impressive capabilities when it becomes available on Azure.

## Resources

- [Azure OpenAI DALL-E Documentation](https://learn.microsoft.com/azure/cognitive-services/openai/dall-e-quickstart)
- [DALL-E Prompt Guide](https://platform.openai.com/docs/guides/images)
- [Azure OpenAI Content Filtering](https://learn.microsoft.com/azure/cognitive-services/openai/concepts/content-filter)

