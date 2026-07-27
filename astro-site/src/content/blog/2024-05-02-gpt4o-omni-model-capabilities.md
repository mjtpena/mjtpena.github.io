---
title: "The Future of Multimodal AI: What's Next After GPT-4 Vision"
author: Michael John Peña
draft: false
date: 2024-05-02
tags:
  - AI
  - OpenAI
  - GPT-4
  - Multimodal
  - Azure OpenAI

---

I wrote "The Future of Multimodal AI: What's Next After GPT-4 Vision" to share practical, production-minded guidance on this topic.

## Current Multimodal Architecture

Traditional multimodal systems work like this:

```
Audio -> Speech-to-Text -> LLM -> Text-to-Speech -> Audio
Image -> Vision Encoder -> LLM -> Text
```

Each modality is handled separately, then combined. This works, but has latency and integration challenges.

## GPT-4 Vision Today

GPT-4V can analyze images alongside text:

```python
from openai import AzureOpenAI
import base64
import os

client = AzureOpenAI(
    api_version="2024-02-15-preview",
    azure_endpoint=os.environ["AZURE_OPENAI_ENDPOINT"],
    api_key=os.environ["AZURE_OPENAI_KEY"]
)

def analyze_image(image_path, prompt):
    with open(image_path, "rb") as f:
        image_data = base64.b64encode(f.read()).decode("utf-8")

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
                            "url": f"data:image/png;base64,{image_data}",
                            "detail": "high"
                        }
                    }
                ]
            }
        ],
        max_tokens=1000
    )
    return response.choices[0].message.content
```

## Image Detail Levels

GPT-4V supports different detail levels:

| Detail | Tokens | Use Case |
|--------|--------|----------|
| `low` | 85 | Quick classification |
| `high` | 85 + 170/tile | Detailed analysis |
| `auto` | Varies | Let model decide |

```python
def estimate_tokens(width, height, detail="auto"):
    if detail == "low":
        return 85

    # Scale down if needed
    if max(width, height) > 2048:
        ratio = 2048 / max(width, height)
        width = int(width * ratio)
        height = int(height * ratio)

    if min(width, height) > 768:
        ratio = 768 / min(width, height)
        width = int(width * ratio)
        height = int(height * ratio)

    tiles_x = (width + 511) // 512
    tiles_y = (height + 511) // 512

    return 85 + (170 * tiles_x * tiles_y)
```

## Document Processing Pipeline

Processing invoices, receipts, and forms:

```python
import asyncio
from dataclasses import dataclass
from typing import List
import json

@dataclass
class InvoiceData:
    vendor: str
    invoice_number: str
    date: str
    total: float
    line_items: List[dict]

async def process_invoice(image_path: str) -> InvoiceData:
    prompt = """Extract invoice data in JSON format:
    {
        "vendor": "company name",
        "invoice_number": "INV-XXX",
        "date": "YYYY-MM-DD",
        "total": 0.00,
        "line_items": [
            {"description": "", "quantity": 0, "unit_price": 0.00, "total": 0.00}
        ]
    }
    Return only valid JSON."""

    with open(image_path, "rb") as f:
        image_data = base64.b64encode(f.read()).decode("utf-8")

    response = await asyncio.to_thread(
        client.chat.completions.create,
        model="gpt-4-vision-preview",
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/png;base64,{image_data}",
                            "detail": "high"
                        }
                    }
                ]
            }
        ],
        max_tokens=1000
    )

    data = json.loads(response.choices[0].message.content)
    return InvoiceData(**data)
```

## The Future: Unified Multimodal Models

The industry is moving toward models that process all modalities natively:

```
Audio/Image/Text -> Single Unified Model -> Audio/Image/Text
```

This end-to-end training means the model understands relationships across modalities that separate models miss.

### Expected Benefits

1. **Lower latency**: No pipeline overhead
2. **Better understanding**: Cross-modal relationships preserved
3. **Simpler integration**: One API for everything
4. **Cost efficiency**: Fewer separate services

## Preparing for the Future

Build abstractions that can adapt:

```python
class MultimodalClient:
    """Abstraction for multimodal AI that can evolve"""

    def __init__(self, client, vision_model: str = "gpt-4-vision-preview"):
        self.client = client
        self.vision_model = vision_model

    def analyze_with_image(self, text: str, image_base64: str) -> str:
        response = self.client.chat.completions.create(
            model=self.vision_model,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": text},
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:image/png;base64,{image_base64}"}
                        }
                    ]
                }
            ],
            max_tokens=1000
        )
        return response.choices[0].message.content

    def upgrade_model(self, new_model: str):
        """Ready for future multimodal models"""
        self.vision_model = new_model
```

## Best Practices Today

1. **Optimize image size** - Resize before sending to reduce tokens
2. **Use appropriate detail level** - Low for classification, high for extraction
3. **Batch requests** - Process multiple images concurrently
4. **Cache results** - Store analysis results to avoid reprocessing
5. **Handle errors gracefully** - Images may fail validation

## What's Next

The AI landscape is evolving rapidly. Keep an eye on:
- Microsoft Build announcements (May 21-23)
- OpenAI updates
- Azure OpenAI new model deployments

Tomorrow I'll cover current best practices for voice AI integration.

## Resources

- [Vision API Documentation](https://platform.openai.com/docs/guides/vision)
- [Azure Blob Storage SDK](https://learn.microsoft.com/azure/storage/blobs/storage-quickstart-blobs-python)
- [Image Token Calculator](https://platform.openai.com/tokenizer)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
