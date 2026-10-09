---
title: "Building Voice AI Applications with Azure OpenAI"
description: "Voice AI is transforming how we interact with applications. Today I'm exploring how to build voice-enabled AI applications using Azure's current capabilities."
author: Michael John Peña
draft: false
date: 2024-05-03
tags:
  - AI
  - OpenAI
  - Voice AI
  - Azure
  - Speech Services
---

Voice AI is transforming how we interact with applications. Today I'm exploring how to build voice-enabled AI applications using Azure's current capabilities.

## Current Voice AI Architecture

The traditional voice AI pipeline:
1. Record audio (500ms)
2. Send to speech-to-text (300ms)
3. Process with LLM (500-2000ms)
4. Text-to-speech (300ms)
5. Play audio

**Total: 1.6-3+ seconds**

While not real-time, this pipeline is production-ready today.

## Azure Speech Services Integration

```python
import azure.cognitiveservices.speech as speechsdk
from openai import AzureOpenAI
import os

# Initialize clients
speech_config = speechsdk.SpeechConfig(
    subscription=os.environ["SPEECH_KEY"],
    region=os.environ["SPEECH_REGION"]
)

openai_client = AzureOpenAI(
    api_version="2024-02-15-preview",
    azure_endpoint=os.environ["AZURE_OPENAI_ENDPOINT"],
    api_key=os.environ["AZURE_OPENAI_KEY"]
)

def speech_to_text(audio_file: str) -> str:
    """Convert speech to text using Azure Speech Services"""
    audio_config = speechsdk.AudioConfig(filename=audio_file)
    recognizer = speechsdk.SpeechRecognizer(
        speech_config=speech_config,
        audio_config=audio_config
    )

    result = recognizer.recognize_once()

    if result.reason == speechsdk.ResultReason.RecognizedSpeech:
        return result.text
    elif result.reason == speechsdk.ResultReason.NoMatch:
        return ""
    else:
        raise Exception(f"Speech recognition failed: {result.reason}")

def text_to_speech(text: str, output_file: str):
    """Convert text to speech using Azure Speech Services"""
    audio_config = speechsdk.AudioConfig(filename=output_file)
    synthesizer = speechsdk.SpeechSynthesizer(
        speech_config=speech_config,
        audio_config=audio_config
    )

    result = synthesizer.speak_text(text)

    if result.reason != speechsdk.ResultReason.SynthesizingAudioCompleted:
        raise Exception(f"Speech synthesis failed: {result.reason}")
```

## Building a Voice Assistant

```python
class VoiceAssistant:
    def __init__(self, system_prompt: str):
        self.openai_client = openai_client
        self.system_prompt = system_prompt
        self.conversation_history = [
            {"role": "system", "content": system_prompt}
        ]

    def process_voice_input(self, audio_file: str) -> str:
        """Process voice input and return voice response"""

        # Step 1: Convert speech to text
        user_text = speech_to_text(audio_file)
        if not user_text:
            return "I didn't catch that. Could you please repeat?"

        # Step 2: Add to conversation history
        self.conversation_history.append({
            "role": "user",
            "content": user_text
        })

        # Step 3: Get LLM response
        response = self.openai_client.chat.completions.create(
            model="gpt-4-turbo",
            messages=self.conversation_history,
            max_tokens=500
        )

        assistant_text = response.choices[0].message.content

        # Step 4: Add to history
        self.conversation_history.append({
            "role": "assistant",
            "content": assistant_text
        })

        return assistant_text

    def speak_response(self, text: str, output_file: str):
        """Convert response to speech"""
        text_to_speech(text, output_file)
```

## Voice Quality Options

Azure Speech Services offers multiple voice options:

```python
# Configure voice
speech_config.speech_synthesis_voice_name = "en-US-JennyNeural"

# Available neural voices include:
VOICE_OPTIONS = {
    "professional": "en-US-JennyNeural",
    "friendly": "en-US-AriaNeural",
    "newscast": "en-US-GuyNeural",
    "customer_service": "en-US-SaraNeural"
}

def set_voice(voice_type: str):
    voice_name = VOICE_OPTIONS.get(voice_type, "en-US-JennyNeural")
    speech_config.speech_synthesis_voice_name = voice_name
```

## Real-Time Streaming with WebSockets

For lower latency, use streaming:

```python
import asyncio
import websockets

class StreamingVoiceClient:
    def __init__(self, api_key: str):
        self.api_key = api_key
        self.ws = None

    async def stream_text_to_speech(self, text: str):
        """Stream text to speech for lower latency"""
        # Azure Speech Services supports streaming synthesis
        speech_config.set_speech_synthesis_output_format(
            speechsdk.SpeechSynthesisOutputFormat.Audio16Khz32KBitRateMonoMp3
        )

        synthesizer = speechsdk.SpeechSynthesizer(
            speech_config=speech_config,
            audio_config=None  # Stream output
        )

        # Use async callback for streaming
        result = synthesizer.speak_text_async(text).get()

        if result.reason == speechsdk.ResultReason.SynthesizingAudioCompleted:
            return result.audio_data
        return None
```

## Building a Data Assistant with Voice

```python
class DataAnalyticsVoiceAssistant:
    def __init__(self):
        self.assistant = VoiceAssistant(
            system_prompt="""You are a data analytics assistant.
            Help users understand their data through natural conversation.
            Be concise but thorough. When asked about data, provide
            clear insights and recommendations."""
        )
        self.tools = self._setup_tools()

    def _setup_tools(self):
        return [
            {
                "type": "function",
                "function": {
                    "name": "query_database",
                    "description": "Execute a SQL query against the analytics database",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "query": {
                                "type": "string",
                                "description": "The SQL query to execute"
                            }
                        },
                        "required": ["query"]
                    }
                }
            }
        ]

    def process_with_tools(self, user_text: str) -> str:
        """Process request with potential tool use"""
        response = openai_client.chat.completions.create(
            model="gpt-4-turbo",
            messages=[
                {"role": "system", "content": self.assistant.system_prompt},
                {"role": "user", "content": user_text}
            ],
            tools=self.tools,
            tool_choice="auto"
        )

        message = response.choices[0].message

        if message.tool_calls:
            # Execute tools and continue
            tool_results = []
            for tool_call in message.tool_calls:
                result = self._execute_tool(tool_call)
                tool_results.append(result)

            # Get final response with tool results
            return self._get_final_response(user_text, tool_results)

        return message.content

    def _execute_tool(self, tool_call):
        """Execute a tool call"""
        # Implementation depends on your data infrastructure
        pass

    def _get_final_response(self, original_query, tool_results):
        """Generate response incorporating tool results"""
        pass
```

## Cost Considerations

Voice AI costs (as of May 2024):

| Service | Cost |
|---------|------|
| Azure Speech-to-Text | $1/hour of audio |
| Azure Text-to-Speech (Neural) | $16/1M characters |
| GPT-4 Turbo | $10/$30 per 1M tokens |

**Rough estimate**: 1 minute of conversation ~ $0.05-0.10

## Best Practices

1. **Implement VAD client-side** - Don't send silence
2. **Handle interruptions** - Users may speak while response plays
3. **Provide visual feedback** - Show when listening/speaking
4. **Graceful degradation** - Fall back to text if audio fails
5. **Cache common responses** - Reduce latency for frequent queries

## The Future: Real-Time Multimodal

The industry is moving toward true real-time multimodal models where audio is processed natively without the speech-to-text intermediary. This will dramatically reduce latency. Keep an eye on announcements from OpenAI and Microsoft Build.

## What's Next

Tomorrow I'll cover vision capabilities and document understanding.

## Resources

- [Azure Speech Services](https://learn.microsoft.com/azure/ai-services/speech-service/)
- [Azure OpenAI Documentation](https://learn.microsoft.com/azure/ai-services/openai/)
- [Audio Processing Basics](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
