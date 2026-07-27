---
title: "Azure AI Speech: Building Voice-Enabled AI Applications"
author: Michael John Peña
draft: false
date: 2025-10-24
tags:
  - Azure AI Speech
  - Voice AI
  - Speech Recognition
  - Text-to-Speech
  - Accessibility

---

I wrote "Azure AI Speech: Building Voice-Enabled AI Applications" to share practical, production-minded guidance on this topic.

## Implementing Speech-to-Text

Build real-time speech recognition:

```python
import azure.cognitiveservices.speech as speechsdk
from typing import Callable, Optional
import asyncio

class SpeechRecognizer:
    def __init__(self, speech_key: str, speech_region: str):
        self.speech_config = speechsdk.SpeechConfig(
            subscription=speech_key,
            region=speech_region
        )
        self.speech_config.speech_recognition_language = "en-US"

    def recognize_from_microphone(self, on_recognized: Callable[[str], None]) -> None:
        """Continuous speech recognition from microphone."""

        audio_config = speechsdk.AudioConfig(use_default_microphone=True)
        recognizer = speechsdk.SpeechRecognizer(
            speech_config=self.speech_config,
            audio_config=audio_config
        )

        def handle_result(evt):
            if evt.result.reason == speechsdk.ResultReason.RecognizedSpeech:
                on_recognized(evt.result.text)

        recognizer.recognized.connect(handle_result)
        recognizer.start_continuous_recognition()

    def recognize_from_file(self, audio_file: str) -> str:
        """Recognize speech from audio file."""

        audio_config = speechsdk.AudioConfig(filename=audio_file)
        recognizer = speechsdk.SpeechRecognizer(
            speech_config=self.speech_config,
            audio_config=audio_config
        )

        result = recognizer.recognize_once()

        if result.reason == speechsdk.ResultReason.RecognizedSpeech:
            return result.text
        elif result.reason == speechsdk.ResultReason.NoMatch:
            return ""
        else:
            raise Exception(f"Speech recognition failed: {result.reason}")
```

## Text-to-Speech with Neural Voices

Generate natural-sounding speech:

```python
class SpeechSynthesizer:
    def __init__(self, speech_key: str, speech_region: str):
        self.speech_config = speechsdk.SpeechConfig(
            subscription=speech_key,
            region=speech_region
        )
        self.speech_config.speech_synthesis_voice_name = "en-US-JennyNeural"

    def synthesize_to_speaker(self, text: str) -> None:
        """Synthesize speech and play through speaker."""

        synthesizer = speechsdk.SpeechSynthesizer(speech_config=self.speech_config)
        result = synthesizer.speak_text_async(text).get()

        if result.reason != speechsdk.ResultReason.SynthesizingAudioCompleted:
            raise Exception(f"Speech synthesis failed: {result.reason}")

    def synthesize_to_file(self, text: str, output_file: str) -> None:
        """Synthesize speech to audio file."""

        audio_config = speechsdk.AudioConfig(filename=output_file)
        synthesizer = speechsdk.SpeechSynthesizer(
            speech_config=self.speech_config,
            audio_config=audio_config
        )

        result = synthesizer.speak_text_async(text).get()

        if result.reason != speechsdk.ResultReason.SynthesizingAudioCompleted:
            raise Exception(f"Speech synthesis failed: {result.reason}")

    def synthesize_with_ssml(self, ssml: str, output_file: str) -> None:
        """Synthesize with SSML for advanced control."""

        audio_config = speechsdk.AudioConfig(filename=output_file)
        synthesizer = speechsdk.SpeechSynthesizer(
            speech_config=self.speech_config,
            audio_config=audio_config
        )

        result = synthesizer.speak_ssml_async(ssml).get()
```

## Building a Voice-Enabled AI Assistant

Combine speech recognition with Azure OpenAI for conversational AI:

```python
class VoiceAIAssistant:
    def __init__(self, recognizer: SpeechRecognizer, synthesizer: SpeechSynthesizer, openai_client):
        self.recognizer = recognizer
        self.synthesizer = synthesizer
        self.openai_client = openai_client

    def process_voice_query(self, audio_file: str) -> str:
        """Process voice query and respond with speech."""

        text = self.recognizer.recognize_from_file(audio_file)
        response = self.openai_client.chat.completions.create(
            model="gpt-4",
            messages=[{"role": "user", "content": text}]
        )
        answer = response.choices[0].message.content
        self.synthesizer.synthesize_to_speaker(answer)
        return answer
```

Voice interfaces make AI applications accessible to broader audiences and enable hands-free interaction scenarios.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
