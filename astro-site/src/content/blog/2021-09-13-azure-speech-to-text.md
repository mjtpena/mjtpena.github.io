---
title: Building Speech-to-Text Applications with Azure Cognitive Services
author: Michael John Pena
draft: false
date: 2021-09-13
tags:
  - Azure
  - Cognitive Services
  - Speech Recognition
  - AI
  - Voice Applications
---

Azure Speech-to-Text is the service I've used in two distinct modes: real-time transcription for live meeting captions and voice-activated applications, and batch transcription for processing recorded audio files at scale. The real-time SDK handles streaming audio with incremental results (partial transcriptions as you speak) and final results (once an utterance is complete); the batch transcription REST API processes audio files in Azure Blob Storage asynchronously, which is more cost-effective for call centre recording analysis or podcast transcription. Custom Speech—training a custom acoustic model on domain-specific vocabulary and speaking styles—is what makes the difference between 85% accuracy on general speech and 95%+ accuracy on technical jargon, accented speech, or industry-specific terminology. The investment in custom model training pays for itself quickly when accuracy directly impacts downstream NLP quality.

## Speech Service Capabilities

- **Real-time transcription**: Stream audio and receive text instantly
- **Batch transcription**: Process audio files at scale
- **Custom models**: Train for specific vocabulary and acoustics
- **Multi-language support**: 100+ languages and variants
- **Speaker diarization**: Identify who said what

## Basic Speech Recognition

```python
import azure.cognitiveservices.speech as speechsdk

def transcribe_microphone():
    """Transcribe speech from microphone in real-time."""

    speech_config = speechsdk.SpeechConfig(
        subscription="your-speech-key",
        region="westus"
    )
    speech_config.speech_recognition_language = "en-US"

    # Use default microphone
    audio_config = speechsdk.AudioConfig(use_default_microphone=True)

    recognizer = speechsdk.SpeechRecognizer(
        speech_config=speech_config,
        audio_config=audio_config
    )

    print("Speak into the microphone...")
    result = recognizer.recognize_once()

    if result.reason == speechsdk.ResultReason.RecognizedSpeech:
        print(f"Recognized: {result.text}")
    elif result.reason == speechsdk.ResultReason.NoMatch:
        print("No speech could be recognized")
    elif result.reason == speechsdk.ResultReason.Canceled:
        cancellation = result.cancellation_details
        print(f"Canceled: {cancellation.reason}")

transcribe_microphone()
```

## Continuous Recognition

```python
import azure.cognitiveservices.speech as speechsdk
import threading

def continuous_recognition(audio_file: str):
    """Continuously recognize speech from an audio file."""

    speech_config = speechsdk.SpeechConfig(
        subscription="your-speech-key",
        region="westus"
    )

    audio_config = speechsdk.AudioConfig(filename=audio_file)

    recognizer = speechsdk.SpeechRecognizer(
        speech_config=speech_config,
        audio_config=audio_config
    )

    done = threading.Event()
    all_results = []

    def handle_recognized(evt):
        """Handle recognized speech."""
        if evt.result.reason == speechsdk.ResultReason.RecognizedSpeech:
            all_results.append({
                'text': evt.result.text,
                'offset': evt.result.offset,
                'duration': evt.result.duration
            })
            print(f"Recognized: {evt.result.text}")

    def handle_session_stopped(evt):
        """Handle session end."""
        print("Session stopped")
        done.set()

    def handle_canceled(evt):
        """Handle cancellation."""
        print(f"Canceled: {evt.reason}")
        done.set()

    # Connect callbacks
    recognizer.recognized.connect(handle_recognized)
    recognizer.session_stopped.connect(handle_session_stopped)
    recognizer.canceled.connect(handle_canceled)

    # Start continuous recognition
    recognizer.start_continuous_recognition()

    # Wait for completion
    done.wait()

    recognizer.stop_continuous_recognition()

    return all_results

# Transcribe audio file
results = continuous_recognition("meeting_recording.wav")
```

## Real-time Streaming with WebSocket

```python
import azure.cognitiveservices.speech as speechsdk
import pyaudio
import asyncio

class RealtimeTranscriber:
    def __init__(self, speech_key: str, region: str):
        self.speech_config = speechsdk.SpeechConfig(
            subscription=speech_key,
            region=region
        )
        self.speech_config.speech_recognition_language = "en-US"
        self.speech_config.enable_dictation()

        # Enable detailed results
        self.speech_config.output_format = speechsdk.OutputFormat.Detailed

    def create_push_stream(self):
        """Create a push audio stream for real-time audio."""
        stream_format = speechsdk.audio.AudioStreamFormat(
            samples_per_second=16000,
            bits_per_sample=16,
            channels=1
        )
        return speechsdk.audio.PushAudioInputStream(stream_format)

    async def transcribe_stream(self, push_stream):
        """Transcribe audio from a push stream."""
        audio_config = speechsdk.AudioConfig(stream=push_stream)

        recognizer = speechsdk.SpeechRecognizer(
            speech_config=self.speech_config,
            audio_config=audio_config
        )

        # Handle interim results
        def handle_recognizing(evt):
            print(f"Interim: {evt.result.text}", end='\r')

        def handle_recognized(evt):
            if evt.result.reason == speechsdk.ResultReason.RecognizedSpeech:
                print(f"\nFinal: {evt.result.text}")
                # Parse detailed results for confidence
                json_result = evt.result.json
                print(f"Confidence: {evt.result.properties}")

        recognizer.recognizing.connect(handle_recognizing)
        recognizer.recognized.connect(handle_recognized)

        recognizer.start_continuous_recognition()

        return recognizer

# Example: Feeding audio data
transcriber = RealtimeTranscriber("your-key", "westus")
push_stream = transcriber.create_push_stream()

# In a real app, you would feed audio chunks:
# push_stream.write(audio_chunk)
# push_stream.close() when done
```

## Batch Transcription

```python
import requests
import json
import time

class BatchTranscriber:
    def __init__(self, speech_key: str, region: str):
        self.base_url = f"https://{region}.api.cognitive.microsoft.com/speechtotext/v3.0"
        self.headers = {
            "Ocp-Apim-Subscription-Key": speech_key,
            "Content-Type": "application/json"
        }

    def submit_transcription(self, audio_urls: list, locale: str = "en-US") -> str:
        """Submit a batch transcription job."""

        payload = {
            "contentUrls": audio_urls,
            "locale": locale,
            "displayName": f"Batch transcription {time.time()}",
            "properties": {
                "wordLevelTimestampsEnabled": True,
                "punctuationMode": "DictatedAndAutomatic",
                "profanityFilterMode": "Masked",
                "diarizationEnabled": True,
                "timeToLive": "PT12H"
            }
        }

        response = requests.post(
            f"{self.base_url}/transcriptions",
            headers=self.headers,
            json=payload
        )

        if response.status_code == 201:
            transcription = response.json()
            return transcription["self"]
        else:
            raise Exception(f"Failed to submit: {response.text}")

    def get_transcription_status(self, transcription_url: str) -> dict:
        """Get the status of a transcription job."""
        response = requests.get(transcription_url, headers=self.headers)
        return response.json()

    def get_results(self, transcription_url: str) -> list:
        """Get transcription results when complete."""
        # Get files URL
        status = self.get_transcription_status(transcription_url)

        if status["status"] != "Succeeded":
            raise Exception(f"Transcription not complete: {status['status']}")

        # Get results files
        files_url = f"{transcription_url}/files"
        response = requests.get(files_url, headers=self.headers)
        files = response.json()

        results = []
        for file_info in files["values"]:
            if file_info["kind"] == "Transcription":
                content_url = file_info["links"]["contentUrl"]
                content = requests.get(content_url).json()
                results.append(content)

        return results

    def transcribe_and_wait(self, audio_urls: list, poll_interval: int = 30) -> list:
        """Submit transcription and wait for results."""
        transcription_url = self.submit_transcription(audio_urls)
        print(f"Transcription submitted: {transcription_url}")

        while True:
            status = self.get_transcription_status(transcription_url)
            print(f"Status: {status['status']}")

            if status["status"] == "Succeeded":
                return self.get_results(transcription_url)
            elif status["status"] == "Failed":
                raise Exception(f"Transcription failed: {status}")

            time.sleep(poll_interval)

# Usage
transcriber = BatchTranscriber("your-key", "westus")
results = transcriber.transcribe_and_wait([
    "https://storage.blob.core.windows.net/audio/meeting1.wav",
    "https://storage.blob.core.windows.net/audio/meeting2.wav"
])

for result in results:
    for segment in result["combinedRecognizedPhrases"]:
        print(segment["display"])
```

## Custom Speech Models

```python
# custom_speech.py
import requests

class CustomSpeechTrainer:
    def __init__(self, speech_key: str, region: str):
        self.base_url = f"https://{region}.api.cognitive.microsoft.com/speechtotext/v3.0"
        self.headers = {
            "Ocp-Apim-Subscription-Key": speech_key,
            "Content-Type": "application/json"
        }

    def create_dataset(self, name: str, audio_url: str, transcript_url: str) -> str:
        """Create a training dataset."""
        payload = {
            "displayName": name,
            "locale": "en-US",
            "kind": "Acoustic",
            "contentUrl": audio_url,
            "properties": {
                "transcriptionContentUrl": transcript_url
            }
        }

        response = requests.post(
            f"{self.base_url}/datasets",
            headers=self.headers,
            json=payload
        )

        return response.json()["self"]

    def train_model(self, name: str, dataset_url: str, base_model_url: str) -> str:
        """Train a custom acoustic model."""
        payload = {
            "displayName": name,
            "locale": "en-US",
            "datasets": [{"self": dataset_url}],
            "baseModel": {"self": base_model_url}
        }

        response = requests.post(
            f"{self.base_url}/models",
            headers=self.headers,
            json=payload
        )

        return response.json()["self"]

    def create_endpoint(self, name: str, model_url: str) -> str:
        """Deploy a custom model to an endpoint."""
        payload = {
            "displayName": name,
            "locale": "en-US",
            "model": {"self": model_url}
        }

        response = requests.post(
            f"{self.base_url}/endpoints",
            headers=self.headers,
            json=payload
        )

        return response.json()["self"]
```

## Integration with Azure Functions

```python
# function_app.py
import azure.functions as func
import azure.cognitiveservices.speech as speechsdk
import json
import os

app = func.FunctionApp()

@app.function_name(name="TranscribeAudio")
@app.route(route="transcribe", methods=["POST"])
@app.blob_input(arg_name="audioBlob",
                path="audio/{filename}",
                connection="AzureWebJobsStorage")
def transcribe_audio(req: func.HttpRequest, audioBlob: bytes) -> func.HttpResponse:
    """HTTP-triggered function to transcribe audio."""

    speech_config = speechsdk.SpeechConfig(
        subscription=os.environ["SPEECH_KEY"],
        region=os.environ["SPEECH_REGION"]
    )

    # Write blob to temp file
    import tempfile
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        f.write(audioBlob)
        temp_path = f.name

    audio_config = speechsdk.AudioConfig(filename=temp_path)
    recognizer = speechsdk.SpeechRecognizer(
        speech_config=speech_config,
        audio_config=audio_config
    )

    result = recognizer.recognize_once()

    # Clean up
    os.remove(temp_path)

    return func.HttpResponse(
        json.dumps({"text": result.text}),
        mimetype="application/json"
    )
```

## Best Practices

1. **Audio Quality**: Use 16kHz, 16-bit, mono audio
2. **Noise Handling**: Pre-process audio to reduce background noise
3. **Custom Models**: Train for domain-specific terminology
4. **Error Handling**: Implement retry logic for network issues
5. **Streaming**: Use continuous recognition for long audio
6. **Batch Processing**: Use batch API for large volumes

Azure Speech-to-Text enables powerful voice-driven applications with industry-leading accuracy and flexibility.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
