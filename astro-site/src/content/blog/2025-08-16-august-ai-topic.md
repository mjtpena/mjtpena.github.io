---
title: "GPT-4o Vision: Building Image Analysis Applications"
author: Michael John Peña
draft: false
date: 2025-08-16
tags:
  - GPT-4o
  - Vision AI
  - Azure OpenAI
  - Multimodal
  - Computer Vision

---

I wrote "GPT-4o Vision: Building Image Analysis Applications" to share practical, production-minded guidance on this topic.

## Basic Image Analysis

```python
from openai import AzureOpenAI
import base64
import os

client = AzureOpenAI(
    api_key=os.environ["AZURE_OPENAI_KEY"],
    api_version="2024-08-01-preview",
    azure_endpoint=os.environ["AZURE_OPENAI_ENDPOINT"]
)

def encode_image(image_path: str) -> str:
    """Encode image to base64."""
    with open(image_path, "rb") as image_file:
        return base64.b64encode(image_file.read()).decode("utf-8")

def analyze_image(image_path: str, prompt: str) -> str:
    """Analyze an image with GPT-4o."""
    base64_image = encode_image(image_path)

    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/jpeg;base64,{base64_image}",
                            "detail": "high"  # or "low" for faster processing
                        }
                    }
                ]
            }
        ],
        max_tokens=1000
    )

    return response.choices[0].message.content
```

## Practical Applications

```python
# Document extraction
invoice_data = analyze_image(
    "invoice.jpg",
    "Extract all line items, amounts, and the total from this invoice. Return as JSON."
)

# Quality inspection
defect_report = analyze_image(
    "product_photo.jpg",
    "Inspect this product image for manufacturing defects. List any issues found."
)

# Chart interpretation
chart_summary = analyze_image(
    "sales_chart.png",
    "Describe the trends shown in this chart and identify key insights."
)

# Multiple images for comparison
response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{
        "role": "user",
        "content": [
            {"type": "text", "text": "Compare these two product designs"},
            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{img1}"}},
            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{img2}"}}
        ]
    }]
)
```

GPT-4o vision provides remarkable understanding of images, but always validate outputs for critical applications. Combine with traditional computer vision for highest accuracy.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
