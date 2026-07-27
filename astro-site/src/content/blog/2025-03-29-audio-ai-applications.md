---
title: "Audio AI Applications: Speech, Music, and Sound Processing"
author: Michael John Peña
draft: false
date: 2025-03-29
tags:
  - AI
  - Audio
  - Speech
  - Whisper
  - Applications

---

I wrote "Audio AI Applications: Speech, Music, and Sound Processing" to share practical, production-minded guidance on this topic.

## Audio AI Pipeline

```python
from azure.ai.openai import AzureOpenAI
from azure.cognitiveservices.speech import (
    SpeechConfig, SpeechSynthesizer, AudioConfig,
    SpeechRecognizer, ResultReason
)
import io

class AudioAIAgent:
    def __init__(self, openai_client: AzureOpenAI, speech_config: SpeechConfig):
        self.openai = openai_client
        self.speech_config = speech_config

    async def transcribe(self, audio_bytes: bytes, language: str = None) -> dict:
        """Transcribe audio with timestamps and speaker detection."""
        response = await self.openai.audio.transcriptions.create(
            model="whisper-1",
            file=("audio.mp3", audio_bytes),
            response_format="verbose_json",
            timestamp_granularities=["word", "segment"],
            language=language
        )

        return {
            "text": response.text,
            "language": response.language,
            "segments": response.segments,
            "words": response.words
        }

    async def translate_audio(self, audio_bytes: bytes) -> str:
        """Translate audio to English."""
        response = await self.openai.audio.translations.create(
            model="whisper-1",
            file=("audio.mp3", audio_bytes)
        )
        return response.text

    async def text_to_speech(self, text: str, voice: str = "nova") -> bytes:
        """Convert text to speech."""
        response = await self.openai.audio.speech.create(
            model="tts-1-hd",
            voice=voice,
            input=text
        )
        return response.content

    async def analyze_meeting(self, audio_bytes: bytes) -> dict:
        """Transcribe and analyze meeting recording."""
        # Transcribe
        transcription = await self.transcribe(audio_bytes)

        # Analyze with LLM
        analysis = await self.openai.chat.completions.create(
            model="gpt-4o",
            messages=[{
                "role": "system",
                "content": """Analyze this meeting transcript and extract:
                - Key discussion points
                - Decisions made
                - Action items with owners
                - Follow-up questions
                - Overall sentiment"""
            }, {
                "role": "user",
                "content": transcription["text"]
            }],
            response_format={"type": "json_object"}
        )

        return {
            "transcript": transcription,
            "analysis": json.loads(analysis.choices[0].message.content)
        }

    async def voice_assistant(self, audio_input: bytes, context: list) -> tuple[str, bytes]:
        """Process voice input and generate voice response."""
        # Transcribe input
        user_text = (await self.transcribe(audio_input))["text"]

        # Generate response
        context.append({"role": "user", "content": user_text})
        response = await self.openai.chat.completions.create(
            model="gpt-4o",
            messages=context
        )
        assistant_text = response.choices[0].message.content

        # Convert to speech
        audio_response = await self.text_to_speech(assistant_text)

        return assistant_text, audio_response
```

Audio AI enables hands-free interfaces and automated analysis of voice content.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
