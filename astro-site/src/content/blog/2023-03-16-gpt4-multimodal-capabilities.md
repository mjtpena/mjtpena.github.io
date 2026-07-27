---
title: "GPT-4 Multimodal: Understanding Vision Capabilities"
author: Michael John Pena
draft: false
date: 2023-03-16
tags:
  - OpenAI
  - AI
  - GPT-4
  - Vision
  - Multimodal

---

I wrote "GPT-4 Multimodal: Understanding Vision Capabilities" to share practical, production-minded guidance on this topic.

## What GPT-4 Vision Can Do

Based on OpenAI's demos and technical report:

- **Understand diagrams**: Flowcharts, architecture diagrams, ERDs
- **Analyze charts**: Extract data from visualizations
- **Read documents**: Beyond OCR - understand context and layout
- **Interpret screenshots**: UI analysis, error identification
- **Describe images**: Detailed, contextual descriptions

## Preparing for Vision APIs

While we wait for access, we can prepare our applications:

```python
from dataclasses import dataclass
from typing import Optional, Union
from enum import Enum
import base64
import httpx

class ImageSource(Enum):
    URL = "url"
    BASE64 = "base64"
    FILE = "file"

@dataclass
class ImageInput:
    source_type: ImageSource
    data: str  # URL, base64 string, or file path
    detail: str = "auto"  # low, high, or auto

    @classmethod
    def from_url(cls, url: str, detail: str = "auto") -> "ImageInput":
        return cls(ImageSource.URL, url, detail)

    @classmethod
    def from_file(cls, path: str, detail: str = "auto") -> "ImageInput":
        with open(path, "rb") as f:
            data = base64.b64encode(f.read()).decode()
        return cls(ImageSource.BASE64, data, detail)

    @classmethod
    def from_bytes(cls, data: bytes, detail: str = "auto") -> "ImageInput":
        encoded = base64.b64encode(data).decode()
        return cls(ImageSource.BASE64, encoded, detail)

    def to_api_format(self) -> dict:
        """Convert to OpenAI API format."""
        if self.source_type == ImageSource.URL:
            return {
                "type": "image_url",
                "image_url": {
                    "url": self.data,
                    "detail": self.detail
                }
            }
        else:
            return {
                "type": "image_url",
                "image_url": {
                    "url": f"data:image/jpeg;base64,{self.data}",
                    "detail": self.detail
                }
            }

class VisionMessage:
    """Build multimodal messages with text and images."""

    def __init__(self, role: str = "user"):
        self.role = role
        self.content = []

    def add_text(self, text: str) -> "VisionMessage":
        self.content.append({"type": "text", "text": text})
        return self

    def add_image(self, image: ImageInput) -> "VisionMessage":
        self.content.append(image.to_api_format())
        return self

    def build(self) -> dict:
        return {"role": self.role, "content": self.content}
```

## Use Case: Architecture Diagram Analysis

```python
class ArchitectureAnalyzer:
    """Analyze architecture diagrams using GPT-4 Vision."""

    def __init__(self, client):
        self.client = client

    async def analyze_diagram(
        self,
        image: ImageInput,
        analysis_type: str = "general"
    ) -> dict:
        """Analyze an architecture diagram."""

        prompts = {
            "general": "Describe this architecture diagram in detail. Identify all components, their relationships, and data flows.",
            "security": "Analyze this architecture diagram for security concerns. Identify potential vulnerabilities, missing security controls, and compliance issues.",
            "scalability": "Evaluate this architecture for scalability. Identify bottlenecks, single points of failure, and suggest improvements.",
            "cost": "Analyze this Azure architecture for cost optimization. Identify potentially expensive components and suggest alternatives."
        }

        prompt = prompts.get(analysis_type, prompts["general"])

        message = (VisionMessage()
            .add_text(prompt)
            .add_image(image)
            .build())

        response = await self.client.chat_completion(
            model="gpt-4-vision-preview",
            messages=[message],
            max_tokens=2000
        )

        return {
            "analysis_type": analysis_type,
            "findings": response.content,
            "model": "gpt-4-vision"
        }

    async def compare_architectures(
        self,
        current: ImageInput,
        proposed: ImageInput
    ) -> dict:
        """Compare two architecture diagrams."""

        message = (VisionMessage()
            .add_text("Compare these two architecture diagrams. The first is the current state, the second is proposed. Identify: 1) What's being added, 2) What's being removed, 3) What's changing, 4) Potential risks in the migration.")
            .add_image(current)
            .add_image(proposed)
            .build())

        response = await self.client.chat_completion(
            model="gpt-4-vision-preview",
            messages=[message],
            max_tokens=2000
        )

        return response.content
```

## Use Case: Dashboard Analysis

```python
class DashboardAnalyzer:
    """Extract insights from dashboard screenshots."""

    async def analyze_dashboard(
        self,
        screenshot: ImageInput,
        context: str = ""
    ) -> dict:
        """Analyze a Power BI or similar dashboard."""

        prompt = f"""Analyze this dashboard screenshot.

Context: {context if context else "Business intelligence dashboard"}

Please provide:
1. Key metrics shown and their current values
2. Trends visible in any charts
3. Any anomalies or areas of concern
4. Actionable insights based on the data

Format your response as structured analysis."""

        message = (VisionMessage()
            .add_text(prompt)
            .add_image(screenshot)
            .build())

        response = await self.client.chat_completion(
            model="gpt-4-vision-preview",
            messages=[message]
        )

        return {
            "analysis": response.content,
            "source": "dashboard_screenshot"
        }

    async def extract_chart_data(self, chart_image: ImageInput) -> dict:
        """Extract approximate data from a chart."""

        prompt = """Extract the data from this chart as accurately as possible.

Return the data in this JSON format:
{
    "chart_type": "bar|line|pie|etc",
    "title": "chart title if visible",
    "x_axis": "label",
    "y_axis": "label",
    "data_points": [
        {"label": "x value", "value": number},
        ...
    ],
    "notes": "any relevant observations"
}

Be as accurate as possible with the numbers."""

        message = (VisionMessage()
            .add_text(prompt)
            .add_image(chart_image)
            .build())

        response = await self.client.chat_completion(
            model="gpt-4-vision-preview",
            messages=[message],
            temperature=0.1
        )

        import json
        try:
            return json.loads(response.content)
        except:
            return {"raw": response.content}
```

## Use Case: Error Screenshot Analysis

```python
class ErrorAnalyzer:
    """Analyze error screenshots for debugging."""

    async def diagnose_error(
        self,
        screenshot: ImageInput,
        application_context: str = ""
    ) -> dict:
        """Analyze an error screenshot and suggest solutions."""

        prompt = f"""Analyze this error screenshot.

Application context: {application_context}

Please provide:
1. Error identification - what error is shown
2. Likely cause - based on the error message and any visible context
3. Suggested solutions - step by step remediation
4. Related issues - other things to check

If this is an Azure-related error, include relevant Azure documentation links."""

        message = (VisionMessage()
            .add_text(prompt)
            .add_image(screenshot)
            .build())

        response = await self.client.chat_completion(
            model="gpt-4-vision-preview",
            messages=[message]
        )

        return {
            "diagnosis": response.content,
            "image_analyzed": True
        }
```

## Use Case: Document Processing

```python
class DocumentProcessor:
    """Process scanned documents with vision."""

    async def extract_table(self, document_image: ImageInput) -> dict:
        """Extract table data from document image."""

        prompt = """Extract all table data from this document image.

Return as JSON:
{
    "tables": [
        {
            "headers": ["col1", "col2", ...],
            "rows": [
                ["val1", "val2", ...],
                ...
            ]
        }
    ]
}

Preserve the structure and all values as accurately as possible."""

        message = (VisionMessage()
            .add_text(prompt)
            .add_image(document_image)
            .build())

        response = await self.client.chat_completion(
            model="gpt-4-vision-preview",
            messages=[message],
            temperature=0
        )

        return response.content

    async def analyze_form(self, form_image: ImageInput) -> dict:
        """Extract field values from a form."""

        prompt = """Extract all filled fields from this form.

Return as JSON:
{
    "form_type": "detected form type",
    "fields": {
        "field_name": "field_value",
        ...
    },
    "signatures": true/false,
    "completeness": "complete|partial|empty"
}"""

        message = (VisionMessage()
            .add_text(prompt)
            .add_image(form_image)
            .build())

        response = await self.client.chat_completion(
            model="gpt-4-vision-preview",
            messages=[message],
            temperature=0
        )

        return response.content
```

## Cost Considerations

Vision API pricing is expected to be higher than text-only:
- Image processing adds significant compute cost
- `detail: "high"` costs more than `detail: "low"`
- Multiple images multiply costs

```python
def estimate_vision_cost(
    images: list[ImageInput],
    text_tokens: int = 500
) -> float:
    """Estimate cost for vision request."""
    # Estimated pricing (will update when official)
    base_cost = text_tokens * 0.03 / 1000  # GPT-4 text cost

    image_cost = 0
    for img in images:
        if img.detail == "low":
            image_cost += 0.01  # Estimated
        else:
            image_cost += 0.05  # Estimated for high detail

    return base_cost + image_cost
```

## Preparing Your Pipeline

```python
class VisionPipeline:
    """Production-ready vision processing pipeline."""

    def __init__(self, config):
        self.config = config
        self.fallback_to_text = True

    async def process(
        self,
        image: ImageInput,
        task: str,
        fallback_text: str = None
    ) -> dict:
        """Process image with fallback."""
        try:
            # Try vision API
            result = await self._process_vision(image, task)
            return {"success": True, "result": result, "method": "vision"}

        except Exception as e:
            if self.fallback_to_text and fallback_text:
                # Fall back to text description
                result = await self._process_text(fallback_text, task)
                return {"success": True, "result": result, "method": "text_fallback"}

            return {"success": False, "error": str(e)}

    async def _process_vision(self, image: ImageInput, task: str):
        # Vision API call
        pass

    async def _process_text(self, text: str, task: str):
        # Text API call
        pass
```

GPT-4 Vision opens new categories of applications. Start planning your use cases now so you're ready when access becomes available.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
