---
title: "GPT-4 Vision Patterns: Building Visual AI Applications"
author: Michael John Peña
draft: false
date: 2024-02-14
tags:
  - GPT-4 Vision
  - Computer Vision
  - Azure OpenAI
  - Multimodal AI
  - Image Analysis
---

I've used GPT-4 Vision in real projects; these are the practical patterns that helped move visual AI from experiment to production.

## Basic Image Analysis

```python
from openai import AzureOpenAI
import base64

client = AzureOpenAI(
    azure_endpoint="https://your-resource.openai.azure.com/",
    api_key="your-key",
    api_version="2024-02-15-preview"
)

def encode_image(image_path: str) -> str:
    with open(image_path, "rb") as f:
        return base64.b64encode(f.read()).decode("utf-8")

def analyze_image(image_path: str, prompt: str) -> str:
    base64_image = encode_image(image_path)

    response = client.chat.completions.create(
        model="gpt-4-vision-preview",
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/png;base64,{base64_image}",
                            "detail": "high"  # or "low" for faster processing
                        }
                    }
                ]
            }
        ],
        max_tokens=1000
    )

    return response.choices[0].message.content

# Usage
description = analyze_image("product.jpg", "Describe this product in detail.")
```

## Multi-Image Comparison

```python
def compare_images(image_paths: list[str], comparison_prompt: str) -> str:
    """Compare multiple images."""

    content = [{"type": "text", "text": comparison_prompt}]

    for path in image_paths:
        content.append({
            "type": "image_url",
            "image_url": {
                "url": f"data:image/png;base64,{encode_image(path)}",
                "detail": "high"
            }
        })

    response = client.chat.completions.create(
        model="gpt-4-vision-preview",
        messages=[{"role": "user", "content": content}],
        max_tokens=2000
    )

    return response.choices[0].message.content

# Compare before/after images
result = compare_images(
    ["before.jpg", "after.jpg"],
    "Compare these before and after images. What changes do you observe?"
)
```

## Structured Data Extraction

```python
def extract_structured_data(image_path: str, schema: dict) -> dict:
    """Extract structured data from image."""

    import json

    schema_str = json.dumps(schema, indent=2)

    prompt = f"""Analyze this image and extract information matching this schema:
    {schema_str}

    Return valid JSON only."""

    response = client.chat.completions.create(
        model="gpt-4-vision-preview",
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/png;base64,{encode_image(image_path)}"}
                    }
                ]
            }
        ],
        response_format={"type": "json_object"},
        max_tokens=1000
    )

    return json.loads(response.choices[0].message.content)

# Extract receipt data
receipt_schema = {
    "vendor_name": "string",
    "date": "string",
    "total": "number",
    "items": [{"name": "string", "price": "number"}]
}
receipt_data = extract_structured_data("receipt.jpg", receipt_schema)
```

## Best Practices

1. **Use appropriate detail level** - "low" for speed, "high" for accuracy
2. **Optimize image size** - Resize before encoding
3. **Provide clear prompts** - Specific instructions improve results
4. **Handle multiple images** - Batch when comparing
5. **Extract structured data** - Use JSON mode for consistency

## Conclusion

GPT-4 Vision opens new possibilities for document processing, visual inspection, and multimodal applications. Start with simple analysis and build toward complex workflows.
