---
title: "Vision-Language Models: A Practical Guide for Data Applications"
author: Michael John Peña
draft: false
date: 2025-01-29
tags:
  - AI
  - Computer Vision
  - VLM
  - Azure
  - GPT-4o

---

I wrote "Vision-Language Models: A Practical Guide for Data Applications" to share practical, production-minded guidance on this topic.

## Understanding Vision-Language Models

VLMs process images and text together, enabling:
- Image description and analysis
- Visual question answering
- Document understanding
- Chart and diagram interpretation
- Multi-image reasoning

## Basic Usage with GPT-4o

```python
from openai import AzureOpenAI
import base64

client = AzureOpenAI(
    api_key=os.environ["AZURE_OPENAI_KEY"],
    api_version="2024-06-01",
    azure_endpoint=os.environ["AZURE_OPENAI_ENDPOINT"]
)

def encode_image(image_path: str) -> str:
    """Encode image to base64."""
    with open(image_path, "rb") as f:
        return base64.b64encode(f.read()).decode("utf-8")

def analyze_image(image_path: str, prompt: str) -> str:
    """Analyze an image with a custom prompt."""
    base64_image = encode_image(image_path)

    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[{
            "role": "user",
            "content": [
                {"type": "text", "text": prompt},
                {
                    "type": "image_url",
                    "image_url": {
                        "url": f"data:image/png;base64,{base64_image}",
                        "detail": "high"  # high, low, or auto
                    }
                }
            ]
        }],
        max_tokens=1000
    )

    return response.choices[0].message.content

# Example usage
result = analyze_image(
    "dashboard_screenshot.png",
    "Analyze this dashboard. What are the key metrics shown and any concerning trends?"
)
```

## Dashboard and Report Analysis

```python
class DashboardAnalyzer:
    def __init__(self, client: AzureOpenAI):
        self.client = client

    async def analyze_dashboard(self, image_path: str) -> dict:
        """Extract insights from a dashboard screenshot."""

        base64_image = encode_image(image_path)

        response = await self.client.chat.completions.create(
            model="gpt-4o",
            messages=[{
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": """Analyze this dashboard and provide:
                        1. List of all metrics/KPIs visible with their values
                        2. Time period shown
                        3. Key trends (up, down, stable)
                        4. Any anomalies or concerning values
                        5. Recommended actions based on the data

                        Return as JSON:
                        {
                            "metrics": [{"name": "...", "value": "...", "trend": "up/down/stable"}],
                            "time_period": "...",
                            "key_insights": ["..."],
                            "anomalies": ["..."],
                            "recommendations": ["..."]
                        }"""
                    },
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/png;base64,{base64_image}"}
                    }
                ]
            }]
        )

        return json.loads(response.choices[0].message.content)

    async def compare_dashboards(self, image1_path: str, image2_path: str) -> dict:
        """Compare two dashboard snapshots."""

        base64_image1 = encode_image(image1_path)
        base64_image2 = encode_image(image2_path)

        response = await self.client.chat.completions.create(
            model="gpt-4o",
            messages=[{
                "role": "user",
                "content": [
                    {"type": "text", "text": "Compare these two dashboard snapshots. What changed between them?"},
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/png;base64,{base64_image1}"}
                    },
                    {"type": "text", "text": "First dashboard (before)"},
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/png;base64,{base64_image2}"}
                    },
                    {"type": "text", "text": "Second dashboard (after). What are the key differences?"}
                ]
            }]
        )

        return {"comparison": response.choices[0].message.content}
```

## Data Extraction from Charts

```python
class ChartDataExtractor:
    def __init__(self, client: AzureOpenAI):
        self.client = client

    async def extract_data_from_chart(self, image_path: str) -> dict:
        """Extract numerical data from a chart image."""

        base64_image = encode_image(image_path)

        response = await self.client.chat.completions.create(
            model="gpt-4o",
            messages=[{
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": """Extract the data from this chart as accurately as possible.

                        Return JSON with:
                        {
                            "chart_type": "bar/line/pie/scatter/etc",
                            "title": "chart title if visible",
                            "x_axis": {"label": "...", "values": [...]},
                            "y_axis": {"label": "...", "unit": "..."},
                            "series": [
                                {"name": "series name", "data": [{"x": ..., "y": ...}, ...]}
                            ],
                            "confidence": "high/medium/low",
                            "notes": "any caveats about the extraction"
                        }

                        Be as precise as possible with the values."""
                    },
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/png;base64,{base64_image}",
                            "detail": "high"
                        }
                    }
                ]
            }]
        )

        return json.loads(response.choices[0].message.content)

    async def chart_to_dataframe(self, image_path: str) -> pd.DataFrame:
        """Convert chart to pandas DataFrame."""

        data = await self.extract_data_from_chart(image_path)

        rows = []
        for series in data.get("series", []):
            for point in series.get("data", []):
                rows.append({
                    "series": series["name"],
                    "x": point["x"],
                    "y": point["y"]
                })

        return pd.DataFrame(rows)
```

## Document Intelligence

```python
class DocumentVisionAnalyzer:
    def __init__(self, client: AzureOpenAI):
        self.client = client

    async def analyze_invoice(self, image_path: str) -> dict:
        """Extract structured data from an invoice image."""

        base64_image = encode_image(image_path)

        response = await self.client.chat.completions.create(
            model="gpt-4o",
            messages=[{
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": """Extract all information from this invoice:

                        Return JSON:
                        {
                            "vendor": {"name": "...", "address": "...", "tax_id": "..."},
                            "customer": {"name": "...", "address": "..."},
                            "invoice_number": "...",
                            "invoice_date": "...",
                            "due_date": "...",
                            "line_items": [
                                {"description": "...", "quantity": ..., "unit_price": ..., "total": ...}
                            ],
                            "subtotal": ...,
                            "tax": ...,
                            "total": ...,
                            "currency": "...",
                            "payment_terms": "..."
                        }"""
                    },
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/png;base64,{base64_image}"}
                    }
                ]
            }]
        )

        return json.loads(response.choices[0].message.content)

    async def analyze_technical_diagram(self, image_path: str) -> dict:
        """Analyze a technical or architectural diagram."""

        base64_image = encode_image(image_path)

        response = await self.client.chat.completions.create(
            model="gpt-4o",
            messages=[{
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": """Analyze this technical diagram and extract:

                        1. What type of diagram is this?
                        2. All components/elements shown
                        3. Relationships/connections between components
                        4. Data flows if applicable
                        5. Technologies/products mentioned

                        Return structured JSON representing the diagram."""
                    },
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/png;base64,{base64_image}"}
                    }
                ]
            }]
        )

        return json.loads(response.choices[0].message.content)
```

## Quality Control with Vision

```python
class VisualQABot:
    def __init__(self, client: AzureOpenAI):
        self.client = client

    async def verify_report_output(
        self,
        report_image: str,
        expected_content: dict
    ) -> dict:
        """Verify a generated report matches expectations."""

        base64_image = encode_image(report_image)

        response = await self.client.chat.completions.create(
            model="gpt-4o",
            messages=[{
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": f"""Verify this report matches the expected content:

                        Expected:
                        {json.dumps(expected_content, indent=2)}

                        Check the image and report:
                        1. Are all expected sections present?
                        2. Do the values match (approximately)?
                        3. Is the formatting correct?
                        4. Any missing or extra content?

                        Return JSON:
                        {{
                            "matches": true/false,
                            "discrepancies": ["..."],
                            "missing": ["..."],
                            "confidence": "high/medium/low"
                        }}"""
                    },
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/png;base64,{base64_image}"}
                    }
                ]
            }]
        )

        return json.loads(response.choices[0].message.content)
```

## Best Practices

### Image Preparation

```python
from PIL import Image
import io

def optimize_image_for_vlm(image_path: str, max_size: int = 2048) -> str:
    """Optimize image for VLM processing."""

    img = Image.open(image_path)

    # Resize if too large
    if max(img.size) > max_size:
        ratio = max_size / max(img.size)
        new_size = (int(img.size[0] * ratio), int(img.size[1] * ratio))
        img = img.resize(new_size, Image.LANCZOS)

    # Convert to RGB if necessary
    if img.mode != "RGB":
        img = img.convert("RGB")

    # Save to buffer
    buffer = io.BytesIO()
    img.save(buffer, format="PNG", optimize=True)

    return base64.b64encode(buffer.getvalue()).decode()
```

### Cost Optimization

```python
def select_detail_level(image_path: str, task: str) -> str:
    """Select appropriate detail level for cost optimization."""

    # High detail: complex charts, small text, detailed diagrams
    # Low detail: simple images, overview analysis
    # Auto: let the model decide

    high_detail_tasks = [
        "extract_data",
        "read_text",
        "analyze_chart",
        "detailed_comparison"
    ]

    if task in high_detail_tasks:
        return "high"

    # Check image complexity
    img = Image.open(image_path)
    if img.size[0] > 1000 or img.size[1] > 1000:
        return "high"

    return "low"
```

### Prompting Tips

1. **Be specific**: Tell the model exactly what to look for
2. **Request structure**: Ask for JSON output for parsing
3. **Set expectations**: Mention confidence levels and caveats
4. **Use detail parameter**: Control cost vs. accuracy tradeoff
5. **Batch when possible**: Process multiple images in one call

Vision-language models transform how we interact with visual data. Start with simple use cases like dashboard analysis and expand to more complex document processing workflows.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
