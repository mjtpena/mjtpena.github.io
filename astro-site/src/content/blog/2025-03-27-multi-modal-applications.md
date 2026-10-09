---
title: "Multi-Modal AI Applications: Beyond Text"
description: "Multi-modal AI opens up applications from document processing to video analysis."
author: Michael John Peña
draft: false
date: 2025-03-27
tags:
  - AI
  - Multi-Modal
  - Vision
  - Audio
  - Applications
---

## Multi-Modal Pipeline

```python
from azure.ai.openai import AzureOpenAI
from azure.cognitiveservices.speech import SpeechConfig, SpeechRecognizer
import base64

class MultiModalAgent:
    def __init__(self, openai_client: AzureOpenAI, speech_config: SpeechConfig):
        self.openai = openai_client
        self.speech = speech_config

    async def analyze_image(self, image_bytes: bytes, question: str) -> str:
        """Analyze image and answer questions about it."""
        image_b64 = base64.b64encode(image_bytes).decode()

        response = await self.openai.chat.completions.create(
            model="gpt-4o",
            messages=[{
                "role": "user",
                "content": [
                    {"type": "text", "text": question},
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/png;base64,{image_b64}",
                            "detail": "high"
                        }
                    }
                ]
            }]
        )
        return response.choices[0].message.content

    async def analyze_document(self, document_images: list[bytes]) -> dict:
        """Extract structured data from document images."""
        extracted = []

        for image in document_images:
            result = await self.analyze_image(
                image,
                "Extract all text, tables, and key information from this document."
            )
            extracted.append(result)

        # Combine and structure
        combined = "\n\n".join(extracted)
        return await self.structure_extraction(combined)

    async def transcribe_and_analyze(self, audio_bytes: bytes) -> dict:
        """Transcribe audio and analyze content."""
        # Transcribe using Whisper
        transcription = await self.openai.audio.transcriptions.create(
            model="whisper-1",
            file=audio_bytes
        )

        # Analyze transcription
        analysis = await self.openai.chat.completions.create(
            model="gpt-4o",
            messages=[{
                "role": "system",
                "content": "Analyze this transcript. Extract key points, action items, and sentiment."
            }, {
                "role": "user",
                "content": transcription.text
            }],
            response_format={"type": "json_object"}
        )

        return {
            "transcript": transcription.text,
            "analysis": json.loads(analysis.choices[0].message.content)
        }

    async def generate_with_images(self, prompt: str, context_images: list[bytes]) -> str:
        """Generate response using multiple images as context."""
        content = [{"type": "text", "text": prompt}]

        for img in context_images:
            img_b64 = base64.b64encode(img).decode()
            content.append({
                "type": "image_url",
                "image_url": {"url": f"data:image/png;base64,{img_b64}"}
            })

        response = await self.openai.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": content}]
        )
        return response.choices[0].message.content
```

Multi-modal AI opens up applications from document processing to video analysis.
