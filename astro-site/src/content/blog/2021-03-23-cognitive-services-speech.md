---
title: Azure Cognitive Services Speech - Voice-Enabled Applications
author: Michael John Pena
draft: false
date: 2021-03-23
url: /blog/cognitive-services-speech/
tags:
  - Azure
  - Cognitive Services
  - Speech
  - AI
  - Voice
---

## Setting Up Speech Services

```bash
# Create Speech resource
az cognitiveservices account create \
    --name myspeechservice \
    --resource-group myResourceGroup \
    --kind SpeechServices \
    --sku S0 \
    --location eastus

# Get keys
az cognitiveservices account keys list \
    --name myspeechservice \
    --resource-group myResourceGroup
```

## Speech-to-Text

### Python SDK

```python
import azure.cognitiveservices.speech as speechsdk
import json

# Configure speech service
speech_config = speechsdk.SpeechConfig(
    subscription="your-subscription-key",
    region="eastus"
)

# Set recognition language
speech_config.speech_recognition_language = "en-US"

# Enable detailed output
speech_config.output_format = speechsdk.OutputFormat.Detailed

# Create recognizer with microphone
audio_config = speechsdk.AudioConfig(use_default_microphone=True)
speech_recognizer = speechsdk.SpeechRecognizer(
    speech_config=speech_config,
    audio_config=audio_config
)

def recognize_once():
    """Single utterance recognition."""
    print("Say something...")
    result = speech_recognizer.recognize_once()

    if result.reason == speechsdk.ResultReason.RecognizedSpeech:
        print(f"Recognized: {result.text}")

        # Get detailed results
        detailed = json.loads(result.json)
        print(f"Confidence: {detailed['NBest'][0]['Confidence']}")

    elif result.reason == speechsdk.ResultReason.NoMatch:
        print(f"No speech recognized: {result.no_match_details}")

    elif result.reason == speechsdk.ResultReason.Canceled:
        cancellation = result.cancellation_details
        print(f"Canceled: {cancellation.reason}")


def continuous_recognition():
    """Continuous speech recognition."""
    done = False

    def recognized_handler(evt):
        if evt.result.reason == speechsdk.ResultReason.RecognizedSpeech:
            print(f"RECOGNIZED: {evt.result.text}")

    def session_stopped_handler(evt):
        nonlocal done
        print("Session stopped")
        done = True

    # Connect callbacks
    speech_recognizer.recognized.connect(recognized_handler)
    speech_recognizer.session_stopped.connect(session_stopped_handler)
    speech_recognizer.canceled.connect(session_stopped_handler)

    # Start continuous recognition
    speech_recognizer.start_continuous_recognition()

    while not done:
        pass

    speech_recognizer.stop_continuous_recognition()


# Recognition from audio file
def recognize_from_file(audio_file_path):
    """Recognize speech from audio file."""
    audio_config = speechsdk.AudioConfig(filename=audio_file_path)
    recognizer = speechsdk.SpeechRecognizer(
        speech_config=speech_config,
        audio_config=audio_config
    )

    result = recognizer.recognize_once()
    return result.text
```

### Real-Time Transcription with WebSocket

```python
import asyncio
import websockets
import json

async def transcribe_stream():
    """Real-time streaming transcription."""
    speech_config = speechsdk.SpeechConfig(
        subscription="your-subscription-key",
        region="eastus"
    )

    # Configure for streaming
    push_stream = speechsdk.audio.PushAudioInputStream()
    audio_config = speechsdk.audio.AudioConfig(stream=push_stream)

    recognizer = speechsdk.SpeechRecognizer(
        speech_config=speech_config,
        audio_config=audio_config
    )

    all_results = []

    def recognizing_handler(evt):
        """Handle partial results (interim)."""
        print(f"RECOGNIZING: {evt.result.text}")

    def recognized_handler(evt):
        """Handle final results."""
        if evt.result.reason == speechsdk.ResultReason.RecognizedSpeech:
            all_results.append(evt.result.text)
            print(f"RECOGNIZED: {evt.result.text}")

    recognizer.recognizing.connect(recognizing_handler)
    recognizer.recognized.connect(recognized_handler)

    recognizer.start_continuous_recognition_async()

    # Simulate streaming audio (replace with actual audio source)
    async with websockets.connect("wss://your-audio-source") as ws:
        while True:
            audio_chunk = await ws.recv()
            push_stream.write(audio_chunk)

    recognizer.stop_continuous_recognition_async()
    return " ".join(all_results)
```

## Text-to-Speech

```python
import azure.cognitiveservices.speech as speechsdk

# Configure TTS
speech_config = speechsdk.SpeechConfig(
    subscription="your-subscription-key",
    region="eastus"
)

# Set voice
speech_config.speech_synthesis_voice_name = "en-US-JennyNeural"

def text_to_speech(text):
    """Convert text to speech."""
    synthesizer = speechsdk.SpeechSynthesizer(speech_config=speech_config)

    result = synthesizer.speak_text_async(text).get()

    if result.reason == speechsdk.ResultReason.SynthesizingAudioCompleted:
        print("Speech synthesized successfully")
    elif result.reason == speechsdk.ResultReason.Canceled:
        cancellation = result.cancellation_details
        print(f"Synthesis canceled: {cancellation.reason}")


def text_to_speech_with_ssml(ssml):
    """Use SSML for advanced control."""
    synthesizer = speechsdk.SpeechSynthesizer(speech_config=speech_config)
    result = synthesizer.speak_ssml_async(ssml).get()
    return result


# SSML example
ssml = """
<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis"
       xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="en-US">
    <voice name="en-US-JennyNeural">
        <mstts:express-as style="cheerful">
            Welcome to the Azure Speech Service demo!
        </mstts:express-as>
        <break time="500ms"/>
        <prosody rate="-10%" pitch="+5%">
            This is an example of SSML with prosody control.
        </prosody>
    </voice>
</speak>
"""


def text_to_audio_file(text, output_file):
    """Save synthesized speech to file."""
    audio_config = speechsdk.audio.AudioOutputConfig(filename=output_file)
    synthesizer = speechsdk.SpeechSynthesizer(
        speech_config=speech_config,
        audio_config=audio_config
    )

    result = synthesizer.speak_text_async(text).get()
    return result.reason == speechsdk.ResultReason.SynthesizingAudioCompleted


# List available voices
def list_voices():
    """Get available voices."""
    synthesizer = speechsdk.SpeechSynthesizer(speech_config=speech_config)
    voices_result = synthesizer.get_voices_async().get()

    for voice in voices_result.voices:
        print(f"{voice.short_name} - {voice.local_name} ({voice.locale})")
```

## Speech Translation

```python
import azure.cognitiveservices.speech as speechsdk

def translate_speech():
    """Real-time speech translation."""
    translation_config = speechsdk.translation.SpeechTranslationConfig(
        subscription="your-subscription-key",
        region="eastus"
    )

    # Source language
    translation_config.speech_recognition_language = "en-US"

    # Target languages
    translation_config.add_target_language("es")
    translation_config.add_target_language("fr")
    translation_config.add_target_language("de")

    # Voice for speech output
    translation_config.voice_name = "es-ES-ElviraNeural"

    audio_config = speechsdk.audio.AudioConfig(use_default_microphone=True)
    translator = speechsdk.translation.TranslationRecognizer(
        translation_config=translation_config,
        audio_config=audio_config
    )

    def result_handler(evt):
        if evt.result.reason == speechsdk.ResultReason.TranslatedSpeech:
            print(f"Recognized: {evt.result.text}")
            for lang, translation in evt.result.translations.items():
                print(f"  -> {lang}: {translation}")

    translator.recognized.connect(result_handler)

    print("Speak in English...")
    translator.start_continuous_recognition()

    import time
    time.sleep(30)  # Listen for 30 seconds

    translator.stop_continuous_recognition()


def translate_with_synthesis():
    """Translation with voice output in target language."""
    translation_config = speechsdk.translation.SpeechTranslationConfig(
        subscription="your-subscription-key",
        region="eastus"
    )

    translation_config.speech_recognition_language = "en-US"
    translation_config.add_target_language("es")

    audio_config = speechsdk.audio.AudioConfig(use_default_microphone=True)

    translator = speechsdk.translation.TranslationRecognizer(
        translation_config=translation_config,
        audio_config=audio_config
    )

    def synthesize_translation(text, target_language):
        """Synthesize translated text."""
        speech_config = speechsdk.SpeechConfig(
            subscription="your-subscription-key",
            region="eastus"
        )
        speech_config.speech_synthesis_voice_name = f"{target_language}-ES-ElviraNeural"

        synthesizer = speechsdk.SpeechSynthesizer(speech_config=speech_config)
        synthesizer.speak_text_async(text).get()

    def result_handler(evt):
        if evt.result.reason == speechsdk.ResultReason.TranslatedSpeech:
            spanish_translation = evt.result.translations.get("es", "")
            if spanish_translation:
                synthesize_translation(spanish_translation, "es")

    translator.recognized.connect(result_handler)
    translator.start_continuous_recognition()
```

## Speaker Recognition

```python
import azure.cognitiveservices.speech as speechsdk
import uuid

def enroll_speaker():
    """Enroll a speaker for verification."""
    profile_config = speechsdk.speaker.VoiceProfileConfig(
        subscription="your-subscription-key",
        region="eastus"
    )

    # Create voice profile
    profile_client = speechsdk.speaker.VoiceProfileClient(
        speech_config=profile_config
    )

    profile = profile_client.create_profile_async(
        speechsdk.speaker.VoiceProfileType.TextIndependentVerification,
        "en-US"
    ).get()

    print(f"Profile created: {profile.profile_id}")

    # Enroll with audio
    audio_config = speechsdk.audio.AudioConfig(use_default_microphone=True)

    print("Please speak for enrollment (20 seconds of speech required)...")

    for i in range(3):  # Multiple enrollments for accuracy
        print(f"Recording {i + 1}/3...")
        result = profile_client.enroll_profile_async(profile, audio_config).get()

        if result.reason == speechsdk.ResultReason.EnrollingVoiceProfile:
            print(f"Remaining enrollments: {result.profile_enrollment_result.enrollments_remaining}")

    print("Enrollment complete!")
    return profile.profile_id


def verify_speaker(profile_id):
    """Verify a speaker against enrolled profile."""
    profile_config = speechsdk.speaker.VoiceProfileConfig(
        subscription="your-subscription-key",
        region="eastus"
    )

    profile_client = speechsdk.speaker.VoiceProfileClient(
        speech_config=profile_config
    )

    profile = speechsdk.speaker.VoiceProfile(profile_id)
    audio_config = speechsdk.audio.AudioConfig(use_default_microphone=True)

    verifier = speechsdk.speaker.SpeakerVerifier(
        speech_config=profile_config
    )

    print("Please speak for verification...")
    result = verifier.verify_once_async(profile, audio_config).get()

    if result.reason == speechsdk.ResultReason.Verified:
        print(f"Verified! Score: {result.score}")
        return True
    else:
        print(f"Verification failed: {result.reason}")
        return False


def identify_speaker(profile_ids):
    """Identify speaker from multiple enrolled profiles."""
    profile_config = speechsdk.speaker.VoiceProfileConfig(
        subscription="your-subscription-key",
        region="eastus"
    )

    profiles = [speechsdk.speaker.VoiceProfile(pid) for pid in profile_ids]
    audio_config = speechsdk.audio.AudioConfig(use_default_microphone=True)

    identifier = speechsdk.speaker.SpeakerIdentifier(
        speech_config=profile_config
    )

    print("Please speak for identification...")
    result = identifier.identify_once_async(
        speechsdk.speaker.SpeakerIdentificationModel(profiles),
        audio_config
    ).get()

    if result.reason == speechsdk.ResultReason.Identified:
        print(f"Identified profile: {result.profile_id}")
        print(f"Confidence: {result.score}")
        return result.profile_id
    else:
        print("Speaker not identified")
        return None
```

## Integration Example: Voice Assistant

```python
import azure.cognitiveservices.speech as speechsdk
from azure.core.credentials import AzureKeyCredential
from azure.ai.textanalytics import TextAnalyticsClient

class VoiceAssistant:
    def __init__(self, speech_key, speech_region, language_key, language_endpoint):
        self.speech_config = speechsdk.SpeechConfig(
            subscription=speech_key,
            region=speech_region
        )
        self.speech_config.speech_recognition_language = "en-US"
        self.speech_config.speech_synthesis_voice_name = "en-US-JennyNeural"

        self.text_analytics = TextAnalyticsClient(
            endpoint=language_endpoint,
            credential=AzureKeyCredential(language_key)
        )

    def listen(self):
        """Listen for user speech."""
        recognizer = speechsdk.SpeechRecognizer(speech_config=self.speech_config)
        result = recognizer.recognize_once()

        if result.reason == speechsdk.ResultReason.RecognizedSpeech:
            return result.text
        return None

    def speak(self, text):
        """Speak response."""
        synthesizer = speechsdk.SpeechSynthesizer(speech_config=self.speech_config)
        synthesizer.speak_text_async(text).get()

    def analyze_intent(self, text):
        """Analyze user intent."""
        # Simple keyword matching (replace with LUIS or CLU for production)
        text_lower = text.lower()

        if "weather" in text_lower:
            return "weather"
        elif "time" in text_lower:
            return "time"
        elif "reminder" in text_lower:
            return "reminder"
        else:
            return "unknown"

    def run(self):
        """Main assistant loop."""
        self.speak("Hello! How can I help you?")

        while True:
            user_input = self.listen()
            if user_input:
                print(f"You said: {user_input}")

                intent = self.analyze_intent(user_input)
                response = self.handle_intent(intent, user_input)
                self.speak(response)

                if "goodbye" in user_input.lower():
                    break

    def handle_intent(self, intent, text):
        """Handle detected intent."""
        if intent == "weather":
            return "The weather today is sunny with a high of 72 degrees."
        elif intent == "time":
            from datetime import datetime
            return f"The current time is {datetime.now().strftime('%I:%M %p')}"
        else:
            return "I'm sorry, I didn't understand that. Could you please repeat?"
```

## Conclusion

Azure Speech Services enable rich voice experiences:

- **Speech-to-Text**: Real-time transcription with high accuracy
- **Text-to-Speech**: Natural-sounding neural voices
- **Translation**: Real-time multi-language translation
- **Speaker Recognition**: Voice-based identity verification

These capabilities power virtual assistants, accessibility features, and multilingual applications.
