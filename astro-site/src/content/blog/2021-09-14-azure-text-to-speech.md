---
title: Creating Natural Voice Experiences with Azure Text-to-Speech
author: Michael John Pena
draft: false
date: 2021-09-14
tags:
  - Azure
  - Cognitive Services
  - Text-to-Speech
  - AI
  - Voice Synthesis

---

I wrote "2021-09-14-azure-text-to-speech" to share practical, production-minded guidance on this topic.

## Neural Voice Features

- **Natural intonation**: Human-like prosody and emphasis
- **Multiple styles**: Cheerful, empathetic, newscast, and more
- **Custom neural voices**: Train voices on your audio data
- **Real-time streaming**: Low-latency audio generation
- **SSML support**: Fine-grained control over pronunciation

## Basic Text-to-Speech

```python
import azure.cognitiveservices.speech as speechsdk

def text_to_speech_basic(text: str, output_file: str = None):
    """Convert text to speech."""

    speech_config = speechsdk.SpeechConfig(
        subscription="your-speech-key",
        region="westus"
    )

    # Select a neural voice
    speech_config.speech_synthesis_voice_name = "en-US-JennyNeural"

    # Output to speaker or file
    if output_file:
        audio_config = speechsdk.AudioConfig(filename=output_file)
    else:
        audio_config = speechsdk.AudioConfig(use_default_speaker=True)

    synthesizer = speechsdk.SpeechSynthesizer(
        speech_config=speech_config,
        audio_config=audio_config
    )

    result = synthesizer.speak_text(text)

    if result.reason == speechsdk.ResultReason.SynthesizingAudioCompleted:
        print("Speech synthesized successfully")
        return result.audio_data
    elif result.reason == speechsdk.ResultReason.Canceled:
        cancellation = result.cancellation_details
        print(f"Synthesis canceled: {cancellation.reason}")
        return None

# Generate speech
text_to_speech_basic(
    "Hello! Welcome to Azure Text-to-Speech. This is a neural voice.",
    "output.wav"
)
```

## Using SSML for Advanced Control

```python
import azure.cognitiveservices.speech as speechsdk

def synthesize_with_ssml(ssml: str, output_file: str):
    """Synthesize speech with SSML markup."""

    speech_config = speechsdk.SpeechConfig(
        subscription="your-speech-key",
        region="westus"
    )

    audio_config = speechsdk.AudioConfig(filename=output_file)

    synthesizer = speechsdk.SpeechSynthesizer(
        speech_config=speech_config,
        audio_config=audio_config
    )

    result = synthesizer.speak_ssml(ssml)

    return result.reason == speechsdk.ResultReason.SynthesizingAudioCompleted

# SSML with various controls
ssml = """
<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis"
       xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="en-US">
    <voice name="en-US-JennyNeural">
        <mstts:express-as style="cheerful">
            Welcome to our application!
        </mstts:express-as>

        <break time="500ms"/>

        <prosody rate="-10%" pitch="+5%">
            Let me explain how this works.
        </prosody>

        <break time="300ms"/>

        The price is <say-as interpret-as="currency">$19.99</say-as>.

        <break time="200ms"/>

        Your order number is <say-as interpret-as="digits">12345</say-as>.

        <break time="500ms"/>

        <mstts:express-as style="empathetic">
            Thank you for your patience.
        </mstts:express-as>
    </voice>
</speak>
"""

synthesize_with_ssml(ssml, "advanced_output.wav")
```

## Voice Styles and Emotions

```python
def create_styled_ssml(text: str, voice: str, style: str, style_degree: float = 1.0) -> str:
    """Create SSML with emotional style."""

    ssml = f"""
    <speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis"
           xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="en-US">
        <voice name="{voice}">
            <mstts:express-as style="{style}" styledegree="{style_degree}">
                {text}
            </mstts:express-as>
        </voice>
    </speak>
    """
    return ssml

# Available styles for en-US-JennyNeural
styles = [
    "assistant",     # Virtual assistant
    "chat",          # Casual conversation
    "cheerful",      # Happy, upbeat
    "customerservice", # Professional support
    "empathetic",    # Understanding, caring
    "excited",       # Enthusiastic
    "friendly",      # Warm, welcoming
    "hopeful",       # Optimistic
    "newscast",      # News anchor
    "sad",           # Somber
    "shouting",      # Loud, urgent
    "terrified",     # Scared
    "unfriendly",    # Cold, distant
    "whispering"     # Quiet, secretive
]

# Generate samples of each style
for style in styles:
    ssml = create_styled_ssml(
        f"This is an example of the {style} speaking style.",
        "en-US-JennyNeural",
        style
    )
    synthesize_with_ssml(ssml, f"style_{style}.wav")
```

## Multi-Language and Voice Switching

```python
def multilingual_speech(segments: list) -> str:
    """Create SSML for multiple languages/voices."""

    voice_segments = []
    for segment in segments:
        voice_segments.append(f"""
            <voice name="{segment['voice']}" xml:lang="{segment['lang']}">
                {segment['text']}
            </voice>
            <break time="500ms"/>
        """)

    ssml = f"""
    <speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis"
           xmlns:mstts="https://www.w3.org/2001/mstts">
        {''.join(voice_segments)}
    </speak>
    """
    return ssml

# Multilingual announcement
segments = [
    {"voice": "en-US-JennyNeural", "lang": "en-US", "text": "Welcome to our service."},
    {"voice": "es-ES-ElviraNeural", "lang": "es-ES", "text": "Bienvenido a nuestro servicio."},
    {"voice": "fr-FR-DeniseNeural", "lang": "fr-FR", "text": "Bienvenue dans notre service."},
    {"voice": "de-DE-KatjaNeural", "lang": "de-DE", "text": "Willkommen bei unserem Service."},
    {"voice": "ja-JP-NanamiNeural", "lang": "ja-JP", "text": "サービスへようこそ。"}
]

ssml = multilingual_speech(segments)
synthesize_with_ssml(ssml, "multilingual.wav")
```

## Real-Time Streaming

```python
import azure.cognitiveservices.speech as speechsdk
import pyaudio

class StreamingSynthesizer:
    def __init__(self, speech_key: str, region: str):
        self.speech_config = speechsdk.SpeechConfig(
            subscription=speech_key,
            region=region
        )
        self.speech_config.speech_synthesis_voice_name = "en-US-JennyNeural"
        self.speech_config.set_speech_synthesis_output_format(
            speechsdk.SpeechSynthesisOutputFormat.Raw16Khz16BitMonoPcm
        )

    def synthesize_stream(self, text: str):
        """Stream audio as it's being synthesized."""

        synthesizer = speechsdk.SpeechSynthesizer(
            speech_config=self.speech_config,
            audio_config=None  # No output config for streaming
        )

        # Set up audio playback
        p = pyaudio.PyAudio()
        stream = p.open(
            format=pyaudio.paInt16,
            channels=1,
            rate=16000,
            output=True
        )

        def handle_audio_data(evt):
            """Play audio chunks as they arrive."""
            if evt.result.audio_data:
                stream.write(evt.result.audio_data)

        synthesizer.synthesizing.connect(handle_audio_data)

        # Start synthesis
        result = synthesizer.speak_text_async(text).get()

        # Clean up
        stream.stop_stream()
        stream.close()
        p.terminate()

        return result

# Stream speech in real-time
synth = StreamingSynthesizer("your-key", "westus")
synth.synthesize_stream("This text is being converted to speech and played in real-time as it generates.")
```

## Audio Format Options

```python
def synthesize_with_format(text: str, output_format: str, output_file: str):
    """Synthesize with specific audio format."""

    speech_config = speechsdk.SpeechConfig(
        subscription="your-speech-key",
        region="westus"
    )

    # Available formats
    formats = {
        "mp3": speechsdk.SpeechSynthesisOutputFormat.Audio16Khz128KBitRateMonoMp3,
        "mp3_hq": speechsdk.SpeechSynthesisOutputFormat.Audio24Khz160KBitRateMonoMp3,
        "wav": speechsdk.SpeechSynthesisOutputFormat.Riff16Khz16BitMonoPcm,
        "wav_hq": speechsdk.SpeechSynthesisOutputFormat.Riff24Khz16BitMonoPcm,
        "ogg": speechsdk.SpeechSynthesisOutputFormat.Ogg16Khz16BitMonoOpus,
        "webm": speechsdk.SpeechSynthesisOutputFormat.Webm16Khz16BitMonoOpus
    }

    speech_config.set_speech_synthesis_output_format(formats[output_format])
    speech_config.speech_synthesis_voice_name = "en-US-JennyNeural"

    synthesizer = speechsdk.SpeechSynthesizer(
        speech_config=speech_config,
        audio_config=None
    )

    result = synthesizer.speak_text(text)

    if result.reason == speechsdk.ResultReason.SynthesizingAudioCompleted:
        with open(output_file, 'wb') as f:
            f.write(result.audio_data)
        return True

    return False

# Generate in different formats
synthesize_with_format("High quality audio.", "mp3_hq", "output.mp3")
synthesize_with_format("Standard quality audio.", "wav", "output.wav")
```

## Building a Voice API

```python
from flask import Flask, request, Response
import azure.cognitiveservices.speech as speechsdk
import os

app = Flask(__name__)

speech_config = speechsdk.SpeechConfig(
    subscription=os.environ["SPEECH_KEY"],
    region=os.environ["SPEECH_REGION"]
)

@app.route('/synthesize', methods=['POST'])
def synthesize():
    """API endpoint for text-to-speech."""

    data = request.json
    text = data.get('text', '')
    voice = data.get('voice', 'en-US-JennyNeural')
    style = data.get('style', None)
    output_format = data.get('format', 'mp3')

    speech_config.speech_synthesis_voice_name = voice
    speech_config.set_speech_synthesis_output_format(
        speechsdk.SpeechSynthesisOutputFormat.Audio16Khz128KBitRateMonoMp3
    )

    synthesizer = speechsdk.SpeechSynthesizer(
        speech_config=speech_config,
        audio_config=None
    )

    if style:
        ssml = f"""
        <speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis"
               xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="en-US">
            <voice name="{voice}">
                <mstts:express-as style="{style}">
                    {text}
                </mstts:express-as>
            </voice>
        </speak>
        """
        result = synthesizer.speak_ssml(ssml)
    else:
        result = synthesizer.speak_text(text)

    if result.reason == speechsdk.ResultReason.SynthesizingAudioCompleted:
        return Response(
            result.audio_data,
            mimetype='audio/mpeg'
        )
    else:
        return {'error': 'Synthesis failed'}, 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
```

## Best Practices

1. **Choose appropriate voices**: Match voice to content tone
2. **Use SSML for control**: Fine-tune pronunciation and pacing
3. **Cache generated audio**: Avoid regenerating static content
4. **Stream for real-time**: Use streaming for interactive applications
5. **Handle long text**: Break into segments for better quality
6. **Monitor usage**: Track API calls for cost management

Azure Text-to-Speech enables natural voice experiences across applications, from virtual assistants to accessibility features.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
