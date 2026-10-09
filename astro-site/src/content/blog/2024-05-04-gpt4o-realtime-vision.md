---
title: "GPT-4o Real-Time Vision: Processing Images at Scale"
description: "GPT-4o's vision capabilities are impressive, but what makes them practical for enterprise is the combination of quality, speed, and cost. Today I'm…"
author: Michael John Peña
draft: false
date: 2024-05-04
tags:
  - AI
  - OpenAI
  - GPT-4o
  - Computer Vision
  - Azure
---

GPT-4o's vision capabilities are impressive, but what makes them practical for enterprise is the combination of quality, speed, and cost. Today I'm exploring real-time vision use cases.

## Vision API Basics

```python
from openai import AzureOpenAI
import base64
import httpx

client = AzureOpenAI(
    api_version="2024-05-01-preview",
    azure_endpoint=os.environ["AZURE_OPENAI_ENDPOINT"],
    api_key=os.environ["AZURE_OPENAI_KEY"]
)

def analyze_image(image_path, prompt):
    with open(image_path, "rb") as f:
        image_data = base64.b64encode(f.read()).decode("utf-8")

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

GPT-4o supports three detail levels:

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
        model="gpt-4o",
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
        response_format={"type": "json_object"},
        max_tokens=1000
    )

    data = json.loads(response.choices[0].message.content)
    return InvoiceData(**data)

async def process_batch(image_paths: List[str]) -> List[InvoiceData]:
    tasks = [process_invoice(path) for path in image_paths]
    return await asyncio.gather(*tasks)
```

## Architecture Diagram Analysis

Analyzing technical diagrams:

```python
def analyze_architecture(diagram_path: str) -> dict:
    prompt = """Analyze this architecture diagram and provide:
    1. List of components/services identified
    2. Data flow between components
    3. Potential single points of failure
    4. Scalability concerns
    5. Security considerations

    Format as structured JSON."""

    with open(diagram_path, "rb") as f:
        image_data = base64.b64encode(f.read()).decode("utf-8")

    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {
                "role": "system",
                "content": "You are an expert cloud architect reviewing system designs."
            },
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
        response_format={"type": "json_object"},
        max_tokens=2000
    )

    return json.loads(response.choices[0].message.content)
```

## Chart and Graph Understanding

Extracting data from visualizations:

```python
def extract_chart_data(chart_image: str) -> dict:
    prompt = """Analyze this chart/graph and extract:
    1. Chart type (bar, line, pie, etc.)
    2. Axis labels and units
    3. Data series with approximate values
    4. Key insights or trends
    5. Any anomalies or notable patterns

    Return as JSON with these sections."""

    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {
                        "type": "image_url",
                        "image_url": {"url": chart_image, "detail": "high"}
                    }
                ]
            }
        ],
        response_format={"type": "json_object"}
    )

    return json.loads(response.choices[0].message.content)
```

## Multi-Image Analysis

Comparing multiple images:

```python
def compare_images(image_paths: List[str], comparison_prompt: str) -> str:
    content = [{"type": "text", "text": comparison_prompt}]

    for i, path in enumerate(image_paths):
        with open(path, "rb") as f:
            image_data = base64.b64encode(f.read()).decode("utf-8")

        content.append({
            "type": "image_url",
            "image_url": {
                "url": f"data:image/png;base64,{image_data}",
                "detail": "low"  # Use low for comparison to save tokens
            }
        })

    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[{"role": "user", "content": content}],
        max_tokens=1500
    )

    return response.choices[0].message.content

# Compare dashboard screenshots over time
result = compare_images(
    ["dashboard_jan.png", "dashboard_feb.png", "dashboard_mar.png"],
    "Compare these three monthly dashboard screenshots. What trends do you see? Any concerning changes?"
)
```

## Integration with Azure Blob Storage

Processing images stored in Azure:

```python
from azure.storage.blob import BlobServiceClient
from azure.identity import DefaultAzureCredential

credential = DefaultAzureCredential()
blob_service = BlobServiceClient(
    account_url=f"https://{storage_account}.blob.core.windows.net",
    credential=credential
)

async def process_blob_image(container: str, blob_name: str) -> dict:
    container_client = blob_service.get_container_client(container)
    blob_client = container_client.get_blob_client(blob_name)

    # Download blob
    blob_data = blob_client.download_blob().readall()
    image_data = base64.b64encode(blob_data).decode("utf-8")

    # Determine MIME type
    mime_type = "image/png" if blob_name.endswith(".png") else "image/jpeg"

    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "Describe this image in detail."},
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:{mime_type};base64,{image_data}"
                        }
                    }
                ]
            }
        ]
    )

    return {
        "blob": blob_name,
        "analysis": response.choices[0].message.content
    }
```

## Best Practices

1. **Optimize image size** - Resize before sending to reduce tokens
2. **Use appropriate detail level** - Low for classification, high for extraction
3. **Batch requests** - Process multiple images concurrently
4. **Cache results** - Store analysis results to avoid reprocessing
5. **Handle errors gracefully** - Images may fail validation

## What's Next

Tomorrow we'll explore multimodal conversations combining text, voice, and vision in a single interaction.

## Resources

- [Vision API Documentation](https://platform.openai.com/docs/guides/vision)
- [Azure Blob Storage SDK](https://learn.microsoft.com/azure/storage/blobs/storage-quickstart-blobs-python)
- [Image Token Calculator](https://platform.openai.com/tokenizer)
