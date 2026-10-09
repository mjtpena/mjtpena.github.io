---
title: "Vision-Language Models: Understanding Images with AI"
description: "Vision-language models enable applications from document understanding to visual inspection."
author: Michael John Peña
draft: false
date: 2025-03-28
tags:
  - AI
  - Vision
  - VLM
  - GPT-4V
  - Computer Vision
---

## Vision-Language Applications

```python
from azure.ai.openai import AzureOpenAI
import base64
from PIL import Image
import io

class VisionLanguageAgent:
    def __init__(self, openai_client: AzureOpenAI):
        self.openai = openai_client

    async def describe_image(self, image_bytes: bytes, detail_level: str = "high") -> str:
        """Generate detailed image description."""
        image_b64 = base64.b64encode(image_bytes).decode()

        response = await self.openai.chat.completions.create(
            model="gpt-4o",
            messages=[{
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": "Describe this image in detail, including objects, people, text, colors, and composition."
                    },
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/png;base64,{image_b64}",
                            "detail": detail_level
                        }
                    }
                ]
            }]
        )
        return response.choices[0].message.content

    async def extract_text_from_image(self, image_bytes: bytes) -> dict:
        """OCR with understanding - extract and structure text."""
        image_b64 = base64.b64encode(image_bytes).decode()

        response = await self.openai.chat.completions.create(
            model="gpt-4o",
            messages=[{
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": """Extract all text from this image.
                        Return JSON with:
                        - raw_text: all text found
                        - structured: organized by sections/categories
                        - handwritten: boolean if handwriting detected"""
                    },
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/png;base64,{image_b64}"}
                    }
                ]
            }],
            response_format={"type": "json_object"}
        )
        return json.loads(response.choices[0].message.content)

    async def compare_images(self, image1: bytes, image2: bytes, comparison_type: str) -> dict:
        """Compare two images."""
        img1_b64 = base64.b64encode(image1).decode()
        img2_b64 = base64.b64encode(image2).decode()

        response = await self.openai.chat.completions.create(
            model="gpt-4o",
            messages=[{
                "role": "user",
                "content": [
                    {"type": "text", "text": f"Compare these two images for {comparison_type}. List similarities and differences."},
                    {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{img1_b64}"}},
                    {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{img2_b64}"}}
                ]
            }]
        )
        return response.choices[0].message.content

    async def visual_qa(self, image_bytes: bytes, questions: list[str]) -> list[dict]:
        """Answer multiple questions about an image."""
        image_b64 = base64.b64encode(image_bytes).decode()
        results = []

        for question in questions:
            response = await self.openai.chat.completions.create(
                model="gpt-4o",
                messages=[{
                    "role": "user",
                    "content": [
                        {"type": "text", "text": question},
                        {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{image_b64}"}}
                    ]
                }]
            )
            results.append({"question": question, "answer": response.choices[0].message.content})

        return results
```

Vision-language models enable applications from document understanding to visual inspection.
