---
title: "Multi-Image Analysis with GPT-4 Vision"
author: Michael John Peña
draft: false
date: 2024-02-18
tags:
  - GPT-4 Vision
  - Multi-Image
  - Computer Vision
  - AI
  - Analysis
---

## Comparing Multiple Images

```python
def compare_images(images: list[str], comparison_prompt: str) -> str:
    """Compare multiple images."""

    content = [{"type": "text", "text": comparison_prompt}]

    for i, img_path in enumerate(images):
        content.append({
            "type": "text",
            "text": f"Image {i+1}:"
        })
        content.append({
            "type": "image_url",
            "image_url": {"url": f"data:image/png;base64,{encode_image(img_path)}"}
        })

    response = client.chat.completions.create(
        model="gpt-4-vision-preview",
        messages=[{"role": "user", "content": content}],
        max_tokens=2000
    )

    return response.choices[0].message.content

# Before/After comparison
result = compare_images(
    ["before.jpg", "after.jpg"],
    "Compare these images and describe all differences you observe."
)
```

## Temporal Sequence Analysis

```python
def analyze_sequence(image_paths: list[str], context: str) -> dict:
    """Analyze a sequence of images over time."""

    prompt = f"""Analyze this sequence of {len(image_paths)} images.
    Context: {context}

    Describe:
    1. What's happening in each image
    2. The progression/changes between images
    3. Any trends or patterns
    4. Conclusions you can draw

    Return as JSON."""

    content = [{"type": "text", "text": prompt}]
    for path in image_paths:
        content.append({
            "type": "image_url",
            "image_url": {"url": f"data:image/png;base64,{encode_image(path)}"}
        })

    response = client.chat.completions.create(
        model="gpt-4-vision-preview",
        messages=[{"role": "user", "content": content}],
        response_format={"type": "json_object"},
        max_tokens=3000
    )

    return json.loads(response.choices[0].message.content)
```

## Multi-Angle Product Analysis

```python
def analyze_product_images(images: list[str]) -> dict:
    """Analyze product from multiple angles."""

    prompt = """Analyze this product from multiple angles and provide:
    1. Product description
    2. Key features visible
    3. Condition assessment
    4. Any defects or issues
    5. Overall quality rating (1-10)

    Return as structured JSON."""

    content = [{"type": "text", "text": prompt}]
    for img in images:
        content.append({
            "type": "image_url",
            "image_url": {"url": f"data:image/png;base64,{encode_image(img)}"}
        })

    response = client.chat.completions.create(
        model="gpt-4-vision-preview",
        messages=[{"role": "user", "content": content}],
        response_format={"type": "json_object"}
    )

    return json.loads(response.choices[0].message.content)
```

## Best Practices

1. **Order matters** - Present images in logical order
2. **Label images** - Help model distinguish between them
3. **Limit count** - 4-6 images optimal for most tasks
4. **Use consistent sizing** - Resize for uniformity
5. **Provide context** - Explain what you're comparing

## Conclusion

Multi-image analysis unlocks powerful comparison and temporal understanding capabilities. Structure your prompts to guide the model through the images effectively.
