---
title: "Real-Time Speech Translation with Azure Cognitive Services"
author: Michael John Peña
draft: false
date: 2022-03-07
tags:
  - Azure
  - Speech Services
  - AI
  - Translation
  - Real-time

---

I wrote "Real-Time Speech Translation with Azure Cognitive Services" to share practical, production-minded guidance on this topic.

## How Speech Translation Works

The service combines three components:
1. **Speech Recognition**: Converts audio to text
2. **Machine Translation**: Translates text between languages
3. **Speech Synthesis**: Converts translated text to speech (optional)

All three happen with minimal latency for real-time conversations.

## Basic Implementation

Set up real-time speech translation:

```python
import azure.cognitiveservices.speech as speechsdk
import os

def create_translation_recognizer():
    speech_key = os.environ["SPEECH_KEY"]
    speech_region = os.environ["SPEECH_REGION"]

    # Configure translation
    translation_config = speechsdk.translation.SpeechTranslationConfig(
        subscription=speech_key,
        region=speech_region
    )

    # Source language (what you're speaking)
    translation_config.speech_recognition_language = "en-US"

    # Target languages (translations you want)
    translation_config.add_target_language("es")
    translation_config.add_target_language("fr")
    translation_config.add_target_language("de")
    translation_config.add_target_language("ja")

    # Optional: voice output for one language
    translation_config.voice_name = "es-ES-ElviraNeural"

    # Create recognizer
    audio_config = speechsdk.audio.AudioConfig(use_default_microphone=True)
    recognizer = speechsdk.translation.TranslationRecognizer(
        translation_config=translation_config,
        audio_config=audio_config
    )

    return recognizer

def start_continuous_translation():
    recognizer = create_translation_recognizer()

    # Event handlers
    def recognized_handler(evt):
        if evt.result.reason == speechsdk.ResultReason.TranslatedSpeech:
            print(f"\nRecognized: {evt.result.text}")
            print("Translations:")
            for lang, translation in evt.result.translations.items():
                print(f"  [{lang}] {translation}")

    def recognizing_handler(evt):
        # Partial results for real-time feedback
        print(f"\r  (recognizing: {evt.result.text[:50]}...)", end="", flush=True)

    def canceled_handler(evt):
        print(f"\nCanceled: {evt.result.cancellation_details.reason}")

    # Connect handlers
    recognizer.recognized.connect(recognized_handler)
    recognizer.recognizing.connect(recognizing_handler)
    recognizer.canceled.connect(canceled_handler)

    # Start continuous recognition
    print("Starting continuous translation. Speak into your microphone...")
    print("Press Ctrl+C to stop.\n")

    recognizer.start_continuous_recognition()

    try:
        import time
        while True:
            time.sleep(0.5)
    except KeyboardInterrupt:
        recognizer.stop_continuous_recognition()
        print("\nStopped.")

if __name__ == "__main__":
    start_continuous_translation()
```

## Translation with Voice Output

Synthesize the translated speech:

```python
def translate_with_voice_output():
    translation_config = speechsdk.translation.SpeechTranslationConfig(
        subscription=os.environ["SPEECH_KEY"],
        region=os.environ["SPEECH_REGION"]
    )

    translation_config.speech_recognition_language = "en-US"
    translation_config.add_target_language("es")

    # Set voice for Spanish output
    translation_config.voice_name = "es-MX-DaliaNeural"

    recognizer = speechsdk.translation.TranslationRecognizer(
        translation_config=translation_config
    )

    # Synthesizer for voice output
    speech_config = speechsdk.SpeechConfig(
        subscription=os.environ["SPEECH_KEY"],
        region=os.environ["SPEECH_REGION"]
    )
    speech_config.speech_synthesis_voice_name = "es-MX-DaliaNeural"
    synthesizer = speechsdk.SpeechSynthesizer(speech_config=speech_config)

    def synthesizing_handler(evt):
        if evt.result.reason == speechsdk.ResultReason.SynthesizingAudio:
            # Audio is available for playback
            pass

    def recognized_handler(evt):
        if evt.result.reason == speechsdk.ResultReason.TranslatedSpeech:
            print(f"English: {evt.result.text}")
            spanish = evt.result.translations["es"]
            print(f"Spanish: {spanish}")

            # Speak the translation
            synthesizer.speak_text_async(spanish)

    recognizer.recognized.connect(recognized_handler)

    print("Speak in English. Translation will be spoken in Spanish.")

    recognizer.start_continuous_recognition()

    import time
    try:
        while True:
            time.sleep(0.5)
    except KeyboardInterrupt:
        recognizer.stop_continuous_recognition()
```

## File-Based Translation

Translate pre-recorded audio:

```python
def translate_audio_file(audio_file_path, source_language, target_languages):
    translation_config = speechsdk.translation.SpeechTranslationConfig(
        subscription=os.environ["SPEECH_KEY"],
        region=os.environ["SPEECH_REGION"]
    )

    translation_config.speech_recognition_language = source_language
    for lang in target_languages:
        translation_config.add_target_language(lang)

    audio_config = speechsdk.audio.AudioConfig(filename=audio_file_path)
    recognizer = speechsdk.translation.TranslationRecognizer(
        translation_config=translation_config,
        audio_config=audio_config
    )

    results = []
    done = threading.Event()

    def handle_result(evt):
        if evt.result.reason == speechsdk.ResultReason.TranslatedSpeech:
            results.append({
                "original": evt.result.text,
                "translations": dict(evt.result.translations),
                "offset": evt.result.offset,
                "duration": evt.result.duration
            })

    def handle_session_stopped(evt):
        done.set()

    recognizer.recognized.connect(handle_result)
    recognizer.session_stopped.connect(handle_session_stopped)
    recognizer.canceled.connect(handle_session_stopped)

    recognizer.start_continuous_recognition()
    done.wait()
    recognizer.stop_continuous_recognition()

    return results

# Usage
results = translate_audio_file(
    "meeting_recording.wav",
    "en-US",
    ["es", "fr", "de"]
)

for segment in results:
    print(f"Original: {segment['original']}")
    for lang, text in segment['translations'].items():
        print(f"  {lang}: {text}")
```

## Building a Meeting Translator

Create a multi-participant translation system:

```python
import asyncio
import websockets
import json

class MeetingTranslator:
    def __init__(self, source_language="en-US"):
        self.source_language = source_language
        self.participants = {}  # participant_id -> preferred_language
        self.translation_config = None
        self.recognizer = None
        self.setup_recognizer()

    def setup_recognizer(self):
        self.translation_config = speechsdk.translation.SpeechTranslationConfig(
            subscription=os.environ["SPEECH_KEY"],
            region=os.environ["SPEECH_REGION"]
        )
        self.translation_config.speech_recognition_language = self.source_language

        # Add all supported target languages
        supported_languages = ["es", "fr", "de", "ja", "zh-Hans", "ko", "pt", "it"]
        for lang in supported_languages:
            self.translation_config.add_target_language(lang)

    def add_participant(self, participant_id, preferred_language):
        self.participants[participant_id] = preferred_language

    async def broadcast_translation(self, websocket_clients, translation_result):
        for participant_id, ws in websocket_clients.items():
            preferred_lang = self.participants.get(participant_id, "en")

            if preferred_lang == "en":
                text = translation_result["original"]
            else:
                text = translation_result["translations"].get(
                    preferred_lang,
                    translation_result["original"]
                )

            message = json.dumps({
                "type": "translation",
                "text": text,
                "original": translation_result["original"],
                "speaker": translation_result.get("speaker", "Unknown")
            })

            try:
                await ws.send(message)
            except websockets.exceptions.ConnectionClosed:
                pass

    def start_session(self, audio_stream, websocket_clients):
        audio_config = speechsdk.audio.AudioConfig(stream=audio_stream)
        self.recognizer = speechsdk.translation.TranslationRecognizer(
            translation_config=self.translation_config,
            audio_config=audio_config
        )

        loop = asyncio.get_event_loop()

        def on_recognized(evt):
            if evt.result.reason == speechsdk.ResultReason.TranslatedSpeech:
                result = {
                    "original": evt.result.text,
                    "translations": dict(evt.result.translations)
                }
                asyncio.run_coroutine_threadsafe(
                    self.broadcast_translation(websocket_clients, result),
                    loop
                )

        self.recognizer.recognized.connect(on_recognized)
        self.recognizer.start_continuous_recognition()

    def stop_session(self):
        if self.recognizer:
            self.recognizer.stop_continuous_recognition()
```

## WebSocket Server for Real-Time Translation

```python
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
import uvicorn

app = FastAPI()
translator = MeetingTranslator()
connected_clients = {}

@app.websocket("/translate/{participant_id}")
async def websocket_endpoint(websocket: WebSocket, participant_id: str):
    await websocket.accept()
    connected_clients[participant_id] = websocket

    try:
        # Receive participant preferences
        data = await websocket.receive_json()
        preferred_language = data.get("preferred_language", "en")
        translator.add_participant(participant_id, preferred_language)

        # Keep connection alive and handle messages
        while True:
            message = await websocket.receive_text()
            if message == "ping":
                await websocket.send_text("pong")

    except WebSocketDisconnect:
        del connected_clients[participant_id]

@app.post("/start-translation")
async def start_translation():
    # In production, this would connect to an audio stream
    # from a meeting platform or audio device
    return {"status": "started"}

@app.get("/")
async def get():
    html = """
    <!DOCTYPE html>
    <html>
        <head><title>Meeting Translator</title></head>
        <body>
            <h1>Real-Time Meeting Translation</h1>
            <div id="translations"></div>
            <script>
                const ws = new WebSocket("ws://localhost:8000/translate/user1");
                ws.onopen = () => {
                    ws.send(JSON.stringify({preferred_language: "es"}));
                };
                ws.onmessage = (event) => {
                    const data = JSON.parse(event.data);
                    if (data.type === "translation") {
                        const div = document.getElementById("translations");
                        div.innerHTML += `<p>${data.text}</p>`;
                    }
                };
            </script>
        </body>
    </html>
    """
    return HTMLResponse(html)
```

## Custom Phrase Lists

Improve recognition of domain-specific terms:

```python
def create_translator_with_phrases(custom_phrases):
    translation_config = speechsdk.translation.SpeechTranslationConfig(
        subscription=os.environ["SPEECH_KEY"],
        region=os.environ["SPEECH_REGION"]
    )

    translation_config.speech_recognition_language = "en-US"
    translation_config.add_target_language("es")

    recognizer = speechsdk.translation.TranslationRecognizer(
        translation_config=translation_config
    )

    # Add phrase list for better recognition
    phrase_list = speechsdk.PhraseListGrammar.from_recognizer(recognizer)
    for phrase in custom_phrases:
        phrase_list.addPhrase(phrase)

    return recognizer

# Usage with technical terms
technical_phrases = [
    "Azure Cognitive Services",
    "Kubernetes",
    "microservices architecture",
    "API gateway",
    "neural network",
    "machine learning pipeline"
]

recognizer = create_translator_with_phrases(technical_phrases)
```

## Translation Quality Enhancement

Post-process translations for better quality:

```python
def enhance_translation(original_text, translation, target_language):
    """Apply post-processing rules to improve translation quality"""

    # Define terminology mappings
    terminology = {
        "es": {
            "cloud computing": "computación en la nube",
            "machine learning": "aprendizaje automático",
            "artificial intelligence": "inteligencia artificial",
            "data pipeline": "canalización de datos"
        },
        "fr": {
            "cloud computing": "informatique en nuage",
            "machine learning": "apprentissage automatique",
            "artificial intelligence": "intelligence artificielle"
        }
    }

    # Apply terminology corrections
    lang_terms = terminology.get(target_language, {})
    for eng_term, translated_term in lang_terms.items():
        if eng_term.lower() in original_text.lower():
            # Check if machine translation used a different term
            # and suggest the preferred terminology
            pass  # Implementation depends on specific needs

    # Handle proper nouns (keep them in original form)
    proper_nouns = extract_proper_nouns(original_text)
    for noun in proper_nouns:
        # Preserve proper nouns that shouldn't be translated
        pass

    return translation

def extract_proper_nouns(text):
    """Extract proper nouns using NER"""
    # Use Azure Text Analytics or similar for NER
    return []
```

## Latency Optimization

Minimize translation delay:

```python
translation_config = speechsdk.translation.SpeechTranslationConfig(
    subscription=os.environ["SPEECH_KEY"],
    region=os.environ["SPEECH_REGION"]
)

# Enable real-time mode
translation_config.set_property(
    speechsdk.PropertyId.SpeechServiceResponse_RequestSentenceBoundary,
    "true"
)

# Use partial results for faster feedback
translation_config.set_property(
    speechsdk.PropertyId.SpeechServiceConnection_EnableAudioLogging,
    "false"  # Disable for lower latency
)

# Choose region closest to users
# Regions with best latency: West US 2, West Europe, Southeast Asia
```

## Error Handling and Resilience

Handle connection issues gracefully:

```python
class ResilientTranslator:
    def __init__(self):
        self.recognizer = None
        self.retry_count = 0
        self.max_retries = 3

    def create_recognizer(self):
        config = speechsdk.translation.SpeechTranslationConfig(
            subscription=os.environ["SPEECH_KEY"],
            region=os.environ["SPEECH_REGION"]
        )
        config.speech_recognition_language = "en-US"
        config.add_target_language("es")

        self.recognizer = speechsdk.translation.TranslationRecognizer(
            translation_config=config
        )

        self.recognizer.canceled.connect(self.handle_canceled)
        self.recognizer.session_stopped.connect(self.handle_session_stopped)

    def handle_canceled(self, evt):
        cancellation = evt.result.cancellation_details

        if cancellation.reason == speechsdk.CancellationReason.Error:
            print(f"Error: {cancellation.error_details}")

            if self.retry_count < self.max_retries:
                self.retry_count += 1
                print(f"Retrying ({self.retry_count}/{self.max_retries})...")
                time.sleep(2 ** self.retry_count)  # Exponential backoff
                self.restart()
            else:
                print("Max retries exceeded. Please check your connection.")

    def handle_session_stopped(self, evt):
        print("Session stopped. Attempting to reconnect...")
        self.restart()

    def restart(self):
        if self.recognizer:
            self.recognizer.stop_continuous_recognition()
        self.create_recognizer()
        self.recognizer.start_continuous_recognition()
```

## Conclusion

Azure Speech Translation provides powerful real-time translation capabilities that can transform global communication. Whether building meeting translators, customer service solutions, or accessibility tools, the service offers the accuracy and low latency needed for natural conversations across language barriers.

Key considerations:
- Choose the closest Azure region for lowest latency
- Use custom phrase lists for domain-specific terminology
- Implement robust error handling for production systems
- Consider voice output for fully hands-free experiences

## Resources

- [Speech Translation Documentation](https://docs.microsoft.com/en-us/azure/cognitive-services/speech-service/speech-translation)
- [Language Support](https://docs.microsoft.com/en-us/azure/cognitive-services/speech-service/language-support)
- [Speech SDK Reference](https://docs.microsoft.com/en-us/python/api/azure-cognitiveservices-speech/)

