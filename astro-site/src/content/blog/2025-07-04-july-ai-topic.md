---
title: "GPT-4o Vision for Document Intelligence: Building Smart OCR Pipelines"
author: Michael John Peña
draft: false
date: 2025-07-04
tags:
  - GPT-4o
  - Computer Vision
  - Document Processing
  - Azure OpenAI
  - Python

---

I wrote "GPT-4o Vision for Document Intelligence: Building Smart OCR Pipelines" to share practical, production-minded guidance on this topic.

## The Vision-First Approach

Instead of chaining OCR to NLP, GPT-4o processes documents holistically. This eliminates error propagation and handles complex layouts that defeat traditional systems:

```python
import openai
import base64
from pathlib import Path

class DocumentIntelligence:
    def __init__(self, api_key: str):
        self.client = openai.AzureOpenAI(
            api_key=api_key,
            api_version="2024-12-01-preview",
            azure_endpoint="https://your-resource.openai.azure.com"
        )

    async def extract_invoice_data(self, image_path: str) -> dict:
        image_data = self._encode_image(image_path)

        response = await self.client.chat.completions.create(
            model="gpt-4o",
            messages=[{
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": """Extract all invoice data as JSON:
                        - vendor_name, vendor_address
                        - invoice_number, invoice_date, due_date
                        - line_items (description, quantity, unit_price, total)
                        - subtotal, tax, total_amount
                        - payment_terms"""
                    },
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/png;base64,{image_data}",
                            "detail": "high"
                        }
                    }
                ]
            }],
            response_format={"type": "json_object"},
            max_tokens=2000
        )

        return response.choices[0].message.content

    def _encode_image(self, path: str) -> str:
        return base64.b64encode(Path(path).read_bytes()).decode()
```

## Handling Multi-Page Documents

For multi-page documents, process pages in parallel and use a synthesis step to merge extracted data. GPT-4o handles cross-page references like "continued from previous page" naturally, maintaining context that traditional systems lose.

## Accuracy Validation

Implement confidence scoring by asking the model to rate its extraction certainty. Route low-confidence extractions to human review, creating a feedback loop that continuously improves your extraction prompts.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
