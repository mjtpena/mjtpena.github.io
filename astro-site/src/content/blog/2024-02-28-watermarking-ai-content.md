---
title: "Watermarking AI-Generated Content: Techniques and Standards"
author: Michael John Peña
draft: false
date: 2024-02-28
tags:
  - Watermarking
  - AI Content
  - Content Authenticity
  - Digital Provenance
  - C2PA

---

I wrote "Watermarking AI-Generated Content: Techniques and Standards" to share practical, production-minded guidance on this topic.

## Watermarking Approaches

### Visible Watermarks

```python
from PIL import Image, ImageDraw, ImageFont

def add_visible_watermark(image_path: str, watermark_text: str, output_path: str):
    """Add visible watermark to image."""

    img = Image.open(image_path)
    draw = ImageDraw.Draw(img)

    # Semi-transparent watermark
    font = ImageFont.truetype("arial.ttf", 20)
    text_color = (128, 128, 128, 128)  # Gray with transparency

    # Position at bottom right
    x = img.width - 200
    y = img.height - 30

    draw.text((x, y), watermark_text, fill=text_color, font=font)

    img.save(output_path)
    return output_path

# Usage
add_visible_watermark("generated.png", "AI-Generated", "watermarked.png")
```

### Invisible Watermarks (Steganography)

```python
import numpy as np
from PIL import Image

def embed_invisible_watermark(image_path: str, message: str, output_path: str):
    """Embed invisible watermark in image LSB."""

    img = np.array(Image.open(image_path))

    # Convert message to binary
    binary_message = ''.join(format(ord(c), '08b') for c in message)
    binary_message += '00000000'  # Null terminator

    # Embed in LSB
    flat = img.flatten()
    for i, bit in enumerate(binary_message):
        if i >= len(flat):
            break
        flat[i] = (flat[i] & 0xFE) | int(bit)

    watermarked = flat.reshape(img.shape)
    Image.fromarray(watermarked.astype('uint8')).save(output_path)

    return output_path

def extract_invisible_watermark(image_path: str) -> str:
    """Extract invisible watermark from image."""

    img = np.array(Image.open(image_path))
    flat = img.flatten()

    binary = ''
    for i in range(len(flat)):
        binary += str(flat[i] & 1)

        if len(binary) >= 8 and binary[-8:] == '00000000':
            break

    # Convert to text
    message = ''
    for i in range(0, len(binary) - 8, 8):
        message += chr(int(binary[i:i+8], 2))

    return message
```

### C2PA Standard

```python
# Content Authenticity Initiative (C2PA) standard
c2pa_metadata = {
    "claim_generator": "MyApp/1.0",
    "actions": [
        {
            "action": "c2pa.created",
            "when": "2024-02-28T10:00:00Z",
            "softwareAgent": "DALL-E 3"
        }
    ],
    "assertions": [
        {
            "type": "c2pa.ai_generated",
            "value": True
        }
    ]
}

def embed_c2pa_metadata(image_path: str, metadata: dict, output_path: str):
    """Embed C2PA compliant metadata."""
    # Use C2PA library for proper implementation
    pass
```

## Implementation Strategy

```python
class ContentWatermarkingPipeline:
    def __init__(self, visible: bool = True, invisible: bool = True, c2pa: bool = True):
        self.visible = visible
        self.invisible = invisible
        self.c2pa = c2pa

    def process(self, image_path: str, metadata: dict) -> str:
        """Apply all watermarking layers."""

        current_path = image_path

        if self.invisible:
            current_path = embed_invisible_watermark(
                current_path,
                f"AI-GEN:{metadata['id']}",
                f"{current_path}_inv.png"
            )

        if self.visible:
            current_path = add_visible_watermark(
                current_path,
                "AI Generated",
                f"{current_path}_vis.png"
            )

        if self.c2pa:
            current_path = embed_c2pa_metadata(
                current_path,
                metadata,
                f"{current_path}_c2pa.png"
            )

        return current_path
```

## Best Practices

1. **Layer approaches** - Combine visible and invisible
2. **Use standards** - C2PA for interoperability
3. **Be robust** - Survive compression and editing
4. **Document** - Keep records of watermarking
5. **Verify** - Test watermark survival

## Conclusion

Watermarking is essential for AI content provenance. Implement multiple layers and follow emerging standards like C2PA.

