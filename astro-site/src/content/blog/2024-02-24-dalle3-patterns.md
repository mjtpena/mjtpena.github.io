---
title: "DALL-E 3 Patterns: Effective Image Generation for Enterprise"
author: Michael John Peña
draft: false
date: 2024-02-24
tags:
  - DALL-E 3
  - Image Generation
  - Azure OpenAI
  - Creative AI
  - Enterprise
---

I experimented with DALL‑E 3 for enterprise image generation; these patterns capture what scaled well and what to avoid.

## Basic Generation

```python
from openai import AzureOpenAI

client = AzureOpenAI(
    azure_endpoint="https://your-resource.openai.azure.com/",
    api_key="your-key",
    api_version="2024-02-15-preview"
)

def generate_image(prompt: str, size: str = "1024x1024", quality: str = "standard") -> str:
    """Generate image using DALL-E 3."""

    response = client.images.generate(
        model="dall-e-3",
        prompt=prompt,
        size=size,  # 1024x1024, 1792x1024, 1024x1792
        quality=quality,  # standard or hd
        n=1
    )

    return response.data[0].url
```

## Prompt Engineering

```python
class ImagePromptBuilder:
    def __init__(self):
        self.components = {
            "subject": "",
            "style": "",
            "composition": "",
            "lighting": "",
            "details": ""
        }

    def set_subject(self, subject: str) -> "ImagePromptBuilder":
        self.components["subject"] = subject
        return self

    def set_style(self, style: str) -> "ImagePromptBuilder":
        styles = {
            "photorealistic": "photorealistic, high detail, 8k",
            "illustration": "digital illustration, clean lines, vibrant colors",
            "corporate": "professional, clean, modern corporate style",
            "minimalist": "minimalist, simple, clean background"
        }
        self.components["style"] = styles.get(style, style)
        return self

    def build(self) -> str:
        return ", ".join([v for v in self.components.values() if v])

# Usage
prompt = (ImagePromptBuilder()
    .set_subject("Modern office building")
    .set_style("photorealistic")
    .build())
```

## Batch Generation for Variations

```python
async def generate_variations(base_prompt: str, variations: list[str], count_per: int = 3) -> list[dict]:
    """Generate multiple variations of a concept."""

    results = []

    for variation in variations:
        full_prompt = f"{base_prompt}, {variation}"

        for i in range(count_per):
            url = await generate_image_async(full_prompt)
            results.append({
                "prompt": full_prompt,
                "variation": variation,
                "url": url
            })

    return results

# Generate product images in different styles
variations = await generate_variations(
    "Smartphone on desk",
    ["morning light", "studio lighting", "outdoor setting"]
)
```

## Brand Consistency

```python
brand_style_guide = {
    "colors": "using brand colors blue (#0078D4) and white",
    "style": "clean, professional, Microsoft Fluent design",
    "elements": "no text, simple composition, ample white space"
}

def generate_brand_image(subject: str) -> str:
    """Generate on-brand image."""

    prompt = f"{subject}, {brand_style_guide['style']}, {brand_style_guide['colors']}, {brand_style_guide['elements']}"

    return generate_image(prompt, quality="hd")
```

## Best Practices

1. **Be specific** - Detailed prompts yield better results
2. **Include style** - Specify artistic style clearly
3. **Avoid text** - DALL-E struggles with text in images
4. **Generate multiple** - Select the best from variations
5. **Post-process** - Minor edits often needed

## Conclusion

DALL-E 3 enables rapid image generation for marketing, prototyping, and content creation. Develop prompt templates for consistent, on-brand results.
