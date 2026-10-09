---
title: "Building Multi-Modal AI Applications with GPT-4 Vision and Audio"
description: "Multi-modal requests consume more tokens and have higher latency. Use the detail parameter wisely: \"low\" for quick analysis, \"high\" for detailed extraction…"
author: Michael John Peña
draft: false
date: 2025-10-05
tags:
  - Multi-Modal AI
  - GPT-4 Vision
  - Azure OpenAI
  - Computer Vision
  - Audio Processing
---

## Processing Images with GPT-4 Vision

GPT-4 Vision can analyze images directly, enabling applications like document processing, visual inspection, and accessibility features:

```python
import base64
from openai import AzureOpenAI
from pathlib import Path

class MultiModalProcessor:
    def __init__(self, client: AzureOpenAI, deployment_name: str = "gpt-4-vision"):
        self.client = client
        self.deployment = deployment_name

    def encode_image(self, image_path: str) -> str:
        """Encode image to base64 for API submission."""
        with open(image_path, "rb") as image_file:
            return base64.b64encode(image_file.read()).decode("utf-8")

    def analyze_document(self, image_path: str, extraction_prompt: str) -> dict:
        """Extract structured data from document images."""

        base64_image = self.encode_image(image_path)

        response = self.client.chat.completions.create(
            model=self.deployment,
            messages=[
                {
                    "role": "system",
                    "content": "You are a document analysis assistant. Extract information accurately and return structured JSON."
                },
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": extraction_prompt},
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/png;base64,{base64_image}",
                                "detail": "high"
                            }
                        }
                    ]
                }
            ],
            max_tokens=2000,
            response_format={"type": "json_object"}
        )

        return response.choices[0].message.content
```

## Practical Application: Invoice Processing

Combine vision capabilities with structured extraction for business automation:

```python
def process_invoice(processor: MultiModalProcessor, invoice_image: str) -> dict:
    """Extract invoice data using multi-modal AI."""

    extraction_prompt = """
    Analyze this invoice image and extract the following information as JSON:
    {
        "vendor_name": "string",
        "invoice_number": "string",
        "invoice_date": "YYYY-MM-DD",
        "due_date": "YYYY-MM-DD",
        "line_items": [{"description": "string", "quantity": number, "unit_price": number}],
        "subtotal": number,
        "tax": number,
        "total": number
    }
    If any field is not visible or unclear, use null.
    """

    result = processor.analyze_document(invoice_image, extraction_prompt)
    return result

# Usage example
processor = MultiModalProcessor(azure_openai_client)
invoice_data = process_invoice(processor, "/documents/invoice_001.png")
```

## Performance Considerations

Multi-modal requests consume more tokens and have higher latency. Use the `detail` parameter wisely: "low" for quick analysis, "high" for detailed extraction, and "auto" to let the model decide based on image complexity.
