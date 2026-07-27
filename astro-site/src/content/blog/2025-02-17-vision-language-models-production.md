---
title: "Vision-Language Models in Production: Practical Implementation Guide"
author: Michael John Peña
draft: false
date: 2025-02-17
tags:
  - AI
  - VLM
  - Computer Vision
  - Production
  - Azure

---

I wrote "Vision-Language Models in Production: Practical Implementation Guide" to share practical, production-minded guidance on this topic.

## Production Architecture

```python
from fastapi import FastAPI, UploadFile, HTTPException
from azure.ai.foundry import AIFoundryClient
import asyncio
import base64
from io import BytesIO
from PIL import Image

app = FastAPI()

class VLMService:
    def __init__(self):
        self.ai_client = AIFoundryClient(
            project="vlm-production",
            credential=DefaultAzureCredential()
        )
        self.cache = ResponseCache()
        self.rate_limiter = RateLimiter(rpm=100, tpm=100000)

    async def analyze_image(
        self,
        image_data: bytes,
        prompt: str,
        detail: str = "auto"
    ) -> dict:
        # Check cache
        cache_key = self._cache_key(image_data, prompt)
        cached = await self.cache.get(cache_key)
        if cached:
            return cached

        # Rate limiting
        await self.rate_limiter.acquire()

        # Optimize image
        optimized = self._optimize_image(image_data, detail)

        # Call VLM
        response = await self.ai_client.chat.complete_async(
            deployment="gpt-4o",
            messages=[{
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/jpeg;base64,{optimized}",
                            "detail": detail
                        }
                    }
                ]
            }],
            max_tokens=1000
        )

        result = {
            "analysis": response.choices[0].message.content,
            "tokens_used": response.usage.total_tokens
        }

        # Cache result
        await self.cache.set(cache_key, result)

        return result

    def _optimize_image(self, image_data: bytes, detail: str) -> str:
        """Optimize image for VLM processing."""
        img = Image.open(BytesIO(image_data))

        # Resize based on detail level
        if detail == "low":
            max_size = 512
        elif detail == "high":
            max_size = 2048
        else:
            # Auto: based on image complexity
            max_size = 1024

        if max(img.size) > max_size:
            ratio = max_size / max(img.size)
            new_size = (int(img.size[0] * ratio), int(img.size[1] * ratio))
            img = img.resize(new_size, Image.LANCZOS)

        # Convert to RGB if needed
        if img.mode != "RGB":
            img = img.convert("RGB")

        # Compress
        buffer = BytesIO()
        img.save(buffer, format="JPEG", quality=85, optimize=True)

        return base64.b64encode(buffer.getvalue()).decode()

vlm_service = VLMService()

@app.post("/analyze")
async def analyze_image(
    file: UploadFile,
    prompt: str = "Describe this image"
):
    if file.content_type not in ["image/jpeg", "image/png", "image/webp"]:
        raise HTTPException(400, "Unsupported image format")

    image_data = await file.read()

    if len(image_data) > 20 * 1024 * 1024:  # 20MB limit
        raise HTTPException(400, "Image too large")

    result = await vlm_service.analyze_image(image_data, prompt)
    return result
```

## Batch Processing

```python
class VLMBatchProcessor:
    """Process multiple images efficiently."""

    def __init__(self, vlm_service: VLMService, max_concurrent: int = 10):
        self.vlm_service = vlm_service
        self.semaphore = asyncio.Semaphore(max_concurrent)

    async def process_batch(
        self,
        images: list[dict],
        prompt: str
    ) -> list[dict]:
        """Process batch of images concurrently."""

        async def process_one(image: dict):
            async with self.semaphore:
                try:
                    result = await self.vlm_service.analyze_image(
                        image["data"],
                        prompt
                    )
                    return {
                        "id": image["id"],
                        "success": True,
                        **result
                    }
                except Exception as e:
                    return {
                        "id": image["id"],
                        "success": False,
                        "error": str(e)
                    }

        tasks = [process_one(img) for img in images]
        return await asyncio.gather(*tasks)

    async def process_directory(
        self,
        directory: str,
        prompt: str,
        output_path: str
    ):
        """Process all images in a directory."""
        import os

        images = []
        for filename in os.listdir(directory):
            if filename.lower().endswith(('.jpg', '.jpeg', '.png')):
                path = os.path.join(directory, filename)
                with open(path, 'rb') as f:
                    images.append({
                        "id": filename,
                        "data": f.read()
                    })

        results = await self.process_batch(images, prompt)

        # Save results
        with open(output_path, 'w') as f:
            json.dump(results, f, indent=2)

        return results
```

## Structured Output Extraction

```python
class VLMExtractor:
    """Extract structured data from images."""

    def __init__(self, vlm_service: VLMService):
        self.vlm_service = vlm_service

    async def extract_invoice_data(self, image_data: bytes) -> dict:
        """Extract structured data from invoice image."""

        prompt = """Extract all data from this invoice image.
        Return valid JSON with this structure:
        {
            "vendor": {"name": "", "address": "", "tax_id": ""},
            "customer": {"name": "", "address": ""},
            "invoice_number": "",
            "invoice_date": "",
            "due_date": "",
            "line_items": [
                {"description": "", "quantity": 0, "unit_price": 0, "total": 0}
            ],
            "subtotal": 0,
            "tax": 0,
            "total": 0,
            "currency": ""
        }
        Return ONLY the JSON, no other text."""

        result = await self.vlm_service.analyze_image(
            image_data, prompt, detail="high"
        )

        # Parse JSON from response
        try:
            return json.loads(result["analysis"])
        except json.JSONDecodeError:
            # Try to extract JSON from response
            import re
            json_match = re.search(r'\{.*\}', result["analysis"], re.DOTALL)
            if json_match:
                return json.loads(json_match.group())
            raise ValueError("Could not parse structured data from response")

    async def extract_table_data(self, image_data: bytes) -> list[dict]:
        """Extract table data from image."""

        prompt = """Extract the table data from this image.
        Return as JSON array where each row is an object with column headers as keys.
        Example: [{"Column1": "value1", "Column2": "value2"}, ...]
        Return ONLY the JSON array."""

        result = await self.vlm_service.analyze_image(
            image_data, prompt, detail="high"
        )

        return json.loads(result["analysis"])

    async def extract_with_schema(
        self,
        image_data: bytes,
        schema: dict
    ) -> dict:
        """Extract data matching a specific schema."""

        prompt = f"""Extract data from this image matching this schema:
        {json.dumps(schema, indent=2)}

        Return valid JSON matching the schema exactly.
        Use null for missing values.
        Return ONLY the JSON."""

        result = await self.vlm_service.analyze_image(
            image_data, prompt, detail="high"
        )

        return json.loads(result["analysis"])
```

## Multi-Image Analysis

```python
class MultiImageAnalyzer:
    """Analyze multiple images together."""

    def __init__(self, ai_client: AIFoundryClient):
        self.ai_client = ai_client

    async def compare_images(
        self,
        images: list[bytes],
        comparison_prompt: str
    ) -> dict:
        """Compare multiple images."""

        content = [{"type": "text", "text": comparison_prompt}]

        for i, image_data in enumerate(images):
            optimized = self._optimize(image_data)
            content.append({
                "type": "image_url",
                "image_url": {"url": f"data:image/jpeg;base64,{optimized}"}
            })
            content.append({
                "type": "text",
                "text": f"[Image {i+1}]"
            })

        response = await self.ai_client.chat.complete_async(
            deployment="gpt-4o",
            messages=[{"role": "user", "content": content}],
            max_tokens=2000
        )

        return {"comparison": response.choices[0].message.content}

    async def analyze_image_sequence(
        self,
        images: list[bytes],
        context: str
    ) -> dict:
        """Analyze a sequence of related images."""

        # Process each image
        analyses = []
        for img in images:
            result = await self._analyze_single(img)
            analyses.append(result)

        # Synthesize
        synthesis_prompt = f"""Based on these {len(images)} image analyses:
        {json.dumps(analyses)}

        Context: {context}

        Provide a comprehensive synthesis identifying:
        1. Common themes
        2. Progression/changes
        3. Key insights
        4. Recommendations"""

        response = await self.ai_client.chat.complete_async(
            deployment="gpt-4o",
            messages=[{"role": "user", "content": synthesis_prompt}]
        )

        return {
            "individual_analyses": analyses,
            "synthesis": response.choices[0].message.content
        }
```

## Error Handling and Fallbacks

```python
class RobustVLMService:
    """VLM service with comprehensive error handling."""

    def __init__(self, ai_client):
        self.ai_client = ai_client
        self.fallback_client = None  # Secondary provider

    async def analyze_with_retry(
        self,
        image_data: bytes,
        prompt: str,
        max_retries: int = 3
    ) -> dict:
        """Analyze with retry logic."""

        last_error = None

        for attempt in range(max_retries):
            try:
                return await self._analyze(image_data, prompt)
            except RateLimitError:
                wait_time = 2 ** attempt
                await asyncio.sleep(wait_time)
            except ContentFilterError as e:
                return {
                    "error": "content_filtered",
                    "message": "Image was filtered by content policy"
                }
            except Exception as e:
                last_error = e
                if attempt < max_retries - 1:
                    await asyncio.sleep(1)

        # Try fallback
        if self.fallback_client:
            try:
                return await self._analyze_fallback(image_data, prompt)
            except:
                pass

        raise last_error

    async def _analyze(self, image_data: bytes, prompt: str) -> dict:
        """Primary analysis."""
        pass

    async def _analyze_fallback(self, image_data: bytes, prompt: str) -> dict:
        """Fallback to alternative provider."""
        pass
```

## Cost Optimization

```python
def select_detail_level(image_data: bytes, task: str) -> str:
    """Select optimal detail level based on task and image."""

    # Estimate image complexity
    img = Image.open(BytesIO(image_data))
    width, height = img.size

    # Task-based selection
    high_detail_tasks = ["ocr", "table_extraction", "detailed_analysis"]
    low_detail_tasks = ["classification", "object_detection", "quick_summary"]

    if task in low_detail_tasks:
        return "low"
    if task in high_detail_tasks:
        return "high"

    # Size-based for auto tasks
    if width < 768 and height < 768:
        return "low"
    if width > 2048 or height > 2048:
        return "high"

    return "auto"

# Cost comparison
# Low detail: ~85 tokens per image
# High detail: ~765 tokens for 1024x1024, more for larger
# Auto: System decides based on image
```

## Best Practices

1. **Optimize images**: Resize and compress before sending
2. **Choose detail wisely**: Low detail for simple tasks
3. **Cache responses**: VLM calls are expensive
4. **Batch when possible**: Amortize latency
5. **Structured prompts**: Get consistent output formats
6. **Handle failures**: Images may be filtered or rejected

VLMs unlock powerful visual understanding capabilities. Deploy them thoughtfully with proper optimization and error handling.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
