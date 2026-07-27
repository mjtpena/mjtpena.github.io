---
title: "Azure AI Speech Updates: Enhanced Recognition and Synthesis"
author: Michael John Peña
draft: false
date: 2023-09-12
description: "Explore the latest updates to Azure AI Speech services including improved speech-to-text accuracy, new voices, and real-time capabilities."
tags:
  - Azure
  - Speech
  - AI
  - Speech Recognition
  - Text-to-Speech

---

I wrote "Azure AI Speech Updates: Enhanced Recognition and Synthesis" to share practical, production-minded guidance on this topic.

## Introduction

Azure AI Speech services continue to advance with significant improvements in accuracy, language support, and real-time capabilities. This post explores the latest features and demonstrates how to leverage them in your applications.

## Speech-to-Text Enhancements

### Basic Speech Recognition

```python
import os
import azure.cognitiveservices.speech as speechsdk

class SpeechRecognizer:
    def __init__(self):
        self.speech_config = speechsdk.SpeechConfig(
            subscription=os.getenv("AZURE_SPEECH_KEY"),
            region=os.getenv("AZURE_SPEECH_REGION")
        )
        # Set recognition language
        self.speech_config.speech_recognition_language = "en-US"

    def recognize_from_microphone(self) -> str:
        """Recognize speech from microphone"""
        audio_config = speechsdk.AudioConfig(use_default_microphone=True)
        recognizer = speechsdk.SpeechRecognizer(
            speech_config=self.speech_config,
            audio_config=audio_config
        )

        result = recognizer.recognize_once()

        if result.reason == speechsdk.ResultReason.RecognizedSpeech:
            return result.text
        elif result.reason == speechsdk.ResultReason.NoMatch:
            return "No speech could be recognized"
        elif result.reason == speechsdk.ResultReason.Canceled:
            cancellation = result.cancellation_details
            return f"Recognition canceled: {cancellation.reason}"

    def recognize_from_file(self, audio_file: str) -> str:
        """Recognize speech from audio file"""
        audio_config = speechsdk.AudioConfig(filename=audio_file)
        recognizer = speechsdk.SpeechRecognizer(
            speech_config=self.speech_config,
            audio_config=audio_config
        )

        result = recognizer.recognize_once()

        if result.reason == speechsdk.ResultReason.RecognizedSpeech:
            return result.text
        else:
            return f"Recognition failed: {result.reason}"

    def recognize_continuous(self, audio_file: str, callback=None) -> list:
        """Continuous recognition for longer audio"""
        audio_config = speechsdk.AudioConfig(filename=audio_file)
        recognizer = speechsdk.SpeechRecognizer(
            speech_config=self.speech_config,
            audio_config=audio_config
        )

        results = []
        done = False

        def handle_result(evt):
            if evt.result.reason == speechsdk.ResultReason.RecognizedSpeech:
                results.append({
                    "text": evt.result.text,
                    "offset": evt.result.offset,
                    "duration": evt.result.duration
                })
                if callback:
                    callback(evt.result.text)

        def stop_cb(evt):
            nonlocal done
            done = True

        recognizer.recognized.connect(handle_result)
        recognizer.session_stopped.connect(stop_cb)
        recognizer.canceled.connect(stop_cb)

        recognizer.start_continuous_recognition()
        while not done:
            pass
        recognizer.stop_continuous_recognition()

        return results

# Usage
recognizer = SpeechRecognizer()

# From file
text = recognizer.recognize_from_file("audio.wav")
print(f"Recognized: {text}")

# Continuous recognition
def on_recognized(text):
    print(f">> {text}")

results = recognizer.recognize_continuous("long_audio.wav", callback=on_recognized)
```

### Advanced Recognition with Phrase Lists

```python
class EnhancedRecognizer:
    def __init__(self):
        self.speech_config = speechsdk.SpeechConfig(
            subscription=os.getenv("AZURE_SPEECH_KEY"),
            region=os.getenv("AZURE_SPEECH_REGION")
        )

    def recognize_with_phrases(
        self,
        audio_file: str,
        phrases: list,
        boost: float = 1.0
    ) -> str:
        """Recognize with phrase hints for better accuracy"""
        audio_config = speechsdk.AudioConfig(filename=audio_file)
        recognizer = speechsdk.SpeechRecognizer(
            speech_config=self.speech_config,
            audio_config=audio_config
        )

        # Add phrase list for better recognition
        phrase_list = speechsdk.PhraseListGrammar.from_recognizer(recognizer)
        for phrase in phrases:
            phrase_list.addPhrase(phrase)

        result = recognizer.recognize_once()
        return result.text if result.reason == speechsdk.ResultReason.RecognizedSpeech else ""

    def recognize_with_custom_model(
        self,
        audio_file: str,
        endpoint_id: str
    ) -> str:
        """Recognize using custom speech model"""
        self.speech_config.endpoint_id = endpoint_id

        audio_config = speechsdk.AudioConfig(filename=audio_file)
        recognizer = speechsdk.SpeechRecognizer(
            speech_config=self.speech_config,
            audio_config=audio_config
        )

        result = recognizer.recognize_once()
        return result.text if result.reason == speechsdk.ResultReason.RecognizedSpeech else ""

    def recognize_with_language_detection(self, audio_file: str) -> dict:
        """Recognize speech with automatic language detection"""
        # Configure auto language detection
        auto_detect_config = speechsdk.languageconfig.AutoDetectSourceLanguageConfig(
            languages=["en-US", "es-ES", "fr-FR", "de-DE", "ja-JP"]
        )

        audio_config = speechsdk.AudioConfig(filename=audio_file)
        recognizer = speechsdk.SpeechRecognizer(
            speech_config=self.speech_config,
            audio_config=audio_config,
            auto_detect_source_language_config=auto_detect_config
        )

        result = recognizer.recognize_once()

        if result.reason == speechsdk.ResultReason.RecognizedSpeech:
            detected_lang = speechsdk.AutoDetectSourceLanguageResult(result).language
            return {
                "text": result.text,
                "detected_language": detected_lang
            }
        return {"text": "", "detected_language": None}

# Usage
enhanced = EnhancedRecognizer()

# With phrase hints for technical terms
technical_phrases = [
    "Azure OpenAI",
    "Kubernetes",
    "microservices",
    "containerization",
    "CI/CD pipeline"
]
text = enhanced.recognize_with_phrases("meeting.wav", technical_phrases)

# With language detection
result = enhanced.recognize_with_language_detection("multilingual.wav")
print(f"Language: {result['detected_language']}, Text: {result['text']}")
```

## Real-Time Transcription

```python
import queue
import threading

class RealTimeTranscriber:
    def __init__(self):
        self.speech_config = speechsdk.SpeechConfig(
            subscription=os.getenv("AZURE_SPEECH_KEY"),
            region=os.getenv("AZURE_SPEECH_REGION")
        )
        # Enable interim results
        self.speech_config.set_property(
            speechsdk.PropertyId.SpeechServiceResponse_RequestSentenceBoundary,
            "true"
        )

        self.transcript_queue = queue.Queue()
        self.is_running = False

    def start_transcription(self):
        """Start real-time transcription from microphone"""
        audio_config = speechsdk.AudioConfig(use_default_microphone=True)
        self.recognizer = speechsdk.SpeechRecognizer(
            speech_config=self.speech_config,
            audio_config=audio_config
        )

        # Handle interim results
        def handle_recognizing(evt):
            self.transcript_queue.put({
                "type": "interim",
                "text": evt.result.text
            })

        # Handle final results
        def handle_recognized(evt):
            if evt.result.reason == speechsdk.ResultReason.RecognizedSpeech:
                self.transcript_queue.put({
                    "type": "final",
                    "text": evt.result.text,
                    "offset": evt.result.offset,
                    "duration": evt.result.duration
                })

        def handle_canceled(evt):
            self.is_running = False

        self.recognizer.recognizing.connect(handle_recognizing)
        self.recognizer.recognized.connect(handle_recognized)
        self.recognizer.canceled.connect(handle_canceled)

        self.is_running = True
        self.recognizer.start_continuous_recognition()

    def stop_transcription(self):
        """Stop transcription"""
        if self.is_running:
            self.recognizer.stop_continuous_recognition()
            self.is_running = False

    def get_transcript(self, timeout: float = 0.1):
        """Get next transcript item from queue"""
        try:
            return self.transcript_queue.get(timeout=timeout)
        except queue.Empty:
            return None

# Usage example
transcriber = RealTimeTranscriber()
transcriber.start_transcription()

print("Listening... (Ctrl+C to stop)")
try:
    while transcriber.is_running:
        item = transcriber.get_transcript()
        if item:
            if item["type"] == "interim":
                print(f"\r[interim] {item['text']}", end="", flush=True)
            else:
                print(f"\n[final] {item['text']}")
except KeyboardInterrupt:
    transcriber.stop_transcription()
```

## Text-to-Speech Updates

### Neural Voice Synthesis

```python
class SpeechSynthesizer:
    def __init__(self):
        self.speech_config = speechsdk.SpeechConfig(
            subscription=os.getenv("AZURE_SPEECH_KEY"),
            region=os.getenv("AZURE_SPEECH_REGION")
        )

    def list_voices(self, locale: str = None) -> list:
        """List available neural voices"""
        synthesizer = speechsdk.SpeechSynthesizer(
            speech_config=self.speech_config,
            audio_config=None
        )

        result = synthesizer.get_voices_async(locale).get()

        voices = []
        for voice in result.voices:
            voices.append({
                "name": voice.short_name,
                "display_name": voice.local_name,
                "locale": voice.locale,
                "gender": voice.gender.name,
                "voice_type": voice.voice_type.name,
                "styles": voice.style_list
            })

        return voices

    def synthesize_to_speaker(self, text: str, voice: str = "en-US-JennyNeural"):
        """Synthesize speech and play through speaker"""
        self.speech_config.speech_synthesis_voice_name = voice

        audio_config = speechsdk.AudioConfig(use_default_speaker=True)
        synthesizer = speechsdk.SpeechSynthesizer(
            speech_config=self.speech_config,
            audio_config=audio_config
        )

        result = synthesizer.speak_text_async(text).get()
        return result.reason == speechsdk.ResultReason.SynthesizingAudioCompleted

    def synthesize_to_file(
        self,
        text: str,
        output_file: str,
        voice: str = "en-US-JennyNeural",
        format: str = "wav"
    ) -> bool:
        """Synthesize speech to audio file"""
        self.speech_config.speech_synthesis_voice_name = voice

        # Set output format
        if format == "mp3":
            self.speech_config.set_speech_synthesis_output_format(
                speechsdk.SpeechSynthesisOutputFormat.Audio16Khz32KBitRateMonoMp3
            )
        elif format == "wav":
            self.speech_config.set_speech_synthesis_output_format(
                speechsdk.SpeechSynthesisOutputFormat.Riff24Khz16BitMonoPcm
            )

        audio_config = speechsdk.AudioConfig(filename=output_file)
        synthesizer = speechsdk.SpeechSynthesizer(
            speech_config=self.speech_config,
            audio_config=audio_config
        )

        result = synthesizer.speak_text_async(text).get()
        return result.reason == speechsdk.ResultReason.SynthesizingAudioCompleted

    def synthesize_with_ssml(self, ssml: str, output_file: str = None):
        """Synthesize using SSML for advanced control"""
        if output_file:
            audio_config = speechsdk.AudioConfig(filename=output_file)
        else:
            audio_config = speechsdk.AudioConfig(use_default_speaker=True)

        synthesizer = speechsdk.SpeechSynthesizer(
            speech_config=self.speech_config,
            audio_config=audio_config
        )

        result = synthesizer.speak_ssml_async(ssml).get()
        return result.reason == speechsdk.ResultReason.SynthesizingAudioCompleted

# Usage
synth = SpeechSynthesizer()

# List available voices
voices = synth.list_voices("en-US")
for v in voices[:5]:
    print(f"{v['name']}: {v['display_name']} ({v['gender']})")
    if v['styles']:
        print(f"  Styles: {', '.join(v['styles'])}")

# Synthesize with different voices
synth.synthesize_to_file(
    "Welcome to Azure AI Speech services.",
    "welcome.wav",
    voice="en-US-GuyNeural"
)
```

### SSML for Expressive Speech

```python
class SSMLBuilder:
    def __init__(self, voice: str = "en-US-JennyNeural"):
        self.voice = voice
        self.content = []

    def add_text(self, text: str):
        """Add plain text"""
        self.content.append(text)
        return self

    def add_break(self, time: str = "500ms"):
        """Add a pause"""
        self.content.append(f'<break time="{time}"/>')
        return self

    def add_emphasis(self, text: str, level: str = "moderate"):
        """Add emphasized text (reduced, moderate, strong)"""
        self.content.append(f'<emphasis level="{level}">{text}</emphasis>')
        return self

    def add_prosody(
        self,
        text: str,
        rate: str = None,
        pitch: str = None,
        volume: str = None
    ):
        """Add text with prosody control"""
        attrs = []
        if rate:
            attrs.append(f'rate="{rate}"')
        if pitch:
            attrs.append(f'pitch="{pitch}"')
        if volume:
            attrs.append(f'volume="{volume}"')

        attr_str = " ".join(attrs)
        self.content.append(f'<prosody {attr_str}>{text}</prosody>')
        return self

    def add_say_as(self, text: str, interpret_as: str, format: str = None):
        """Add text with specific interpretation (date, time, number, etc.)"""
        if format:
            self.content.append(f'<say-as interpret-as="{interpret_as}" format="{format}">{text}</say-as>')
        else:
            self.content.append(f'<say-as interpret-as="{interpret_as}">{text}</say-as>')
        return self

    def add_style(self, text: str, style: str):
        """Add text with emotional style (voice must support it)"""
        self.content.append(f'<mstts:express-as style="{style}">{text}</mstts:express-as>')
        return self

    def build(self) -> str:
        """Build complete SSML document"""
        content_str = "".join(self.content)
        return f'''<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis"
    xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="en-US">
    <voice name="{self.voice}">
        {content_str}
    </voice>
</speak>'''

# Usage
builder = SSMLBuilder("en-US-JennyNeural")
ssml = (builder
    .add_text("Welcome to the meeting.")
    .add_break("1s")
    .add_prosody("Today we have some exciting news!", rate="+10%", pitch="+5%")
    .add_break()
    .add_text("The meeting is scheduled for ")
    .add_say_as("2023-09-15", "date", "mdy")
    .add_text(" at ")
    .add_say_as("14:30", "time", "hms12")
    .add_break("500ms")
    .add_emphasis("Please don't be late!", "strong")
    .build()
)

synth.synthesize_with_ssml(ssml, "meeting_announcement.wav")
```

## Conclusion

Azure AI Speech services provide comprehensive capabilities for both speech recognition and synthesis. With continuous improvements in accuracy, language support, and real-time processing, these services enable powerful voice-enabled applications. The combination of standard recognition, phrase hints, and SSML-based synthesis gives developers fine-grained control over speech interactions.

