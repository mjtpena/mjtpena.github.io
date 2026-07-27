---
title: "Real-Time Transcription with Azure AI Speech"
author: Michael John Peña
draft: false
date: 2023-09-16
description: "Build real-time transcription applications using Azure AI Speech services with low latency and high accuracy."
tags:
  - Azure
  - Speech Recognition
  - Real-Time
  - Transcription
  - AI

---

I wrote "Real-Time Transcription with Azure AI Speech" to share practical, production-minded guidance on this topic.

## Introduction

Real-time transcription enables live captioning, meeting transcription, and voice-controlled applications. Azure AI Speech provides powerful capabilities for building low-latency transcription solutions. This post covers implementation patterns and best practices.

## Real-Time Transcription Architecture

### Core Implementation

```python
import os
import azure.cognitiveservices.speech as speechsdk
import threading
import queue
from dataclasses import dataclass
from typing import Callable, Optional
from datetime import datetime

@dataclass
class TranscriptionResult:
    text: str
    is_final: bool
    confidence: float
    timestamp: datetime
    speaker_id: Optional[str] = None
    offset_ms: int = 0
    duration_ms: int = 0

class RealTimeTranscriber:
    def __init__(
        self,
        language: str = "en-US",
        enable_profanity_filter: bool = True,
        enable_punctuation: bool = True
    ):
        self.speech_config = speechsdk.SpeechConfig(
            subscription=os.getenv("AZURE_SPEECH_KEY"),
            region=os.getenv("AZURE_SPEECH_REGION")
        )

        self.speech_config.speech_recognition_language = language

        # Configure recognition settings
        if enable_punctuation:
            self.speech_config.set_property(
                speechsdk.PropertyId.SpeechServiceResponse_RequestSentenceBoundary,
                "true"
            )

        if enable_profanity_filter:
            self.speech_config.set_profanity(speechsdk.ProfanityOption.Masked)
        else:
            self.speech_config.set_profanity(speechsdk.ProfanityOption.Raw)

        # Enable detailed output for confidence scores
        self.speech_config.output_format = speechsdk.OutputFormat.Detailed

        self.result_queue = queue.Queue()
        self.is_running = False
        self.recognizer = None

        # Callbacks
        self.on_interim_result: Optional[Callable[[TranscriptionResult], None]] = None
        self.on_final_result: Optional[Callable[[TranscriptionResult], None]] = None
        self.on_error: Optional[Callable[[str], None]] = None

    def _extract_result(self, evt, is_final: bool) -> TranscriptionResult:
        """Extract transcription result from event"""
        confidence = 0.0

        try:
            import json
            json_result = evt.result.properties.get(
                speechsdk.PropertyId.SpeechServiceResponse_JsonResult
            )
            if json_result:
                data = json.loads(json_result)
                if "NBest" in data and len(data["NBest"]) > 0:
                    confidence = data["NBest"][0].get("Confidence", 0.0)
        except Exception:
            pass

        return TranscriptionResult(
            text=evt.result.text,
            is_final=is_final,
            confidence=confidence,
            timestamp=datetime.now(),
            offset_ms=evt.result.offset // 10000,  # Convert ticks to ms
            duration_ms=evt.result.duration // 10000
        )

    def _handle_recognizing(self, evt):
        """Handle interim recognition results"""
        result = self._extract_result(evt, is_final=False)
        self.result_queue.put(result)
        if self.on_interim_result:
            self.on_interim_result(result)

    def _handle_recognized(self, evt):
        """Handle final recognition results"""
        if evt.result.reason == speechsdk.ResultReason.RecognizedSpeech:
            result = self._extract_result(evt, is_final=True)
            self.result_queue.put(result)
            if self.on_final_result:
                self.on_final_result(result)

    def _handle_canceled(self, evt):
        """Handle cancellation"""
        if evt.reason == speechsdk.CancellationReason.Error:
            error_msg = f"Error: {evt.error_details}"
            if self.on_error:
                self.on_error(error_msg)
        self.is_running = False

    def _handle_stopped(self, evt):
        """Handle session stopped"""
        self.is_running = False

    def start_from_microphone(self):
        """Start real-time transcription from microphone"""
        audio_config = speechsdk.AudioConfig(use_default_microphone=True)
        self._start_recognition(audio_config)

    def start_from_stream(self, audio_stream):
        """Start real-time transcription from audio stream"""
        audio_config = speechsdk.AudioConfig(stream=audio_stream)
        self._start_recognition(audio_config)

    def _start_recognition(self, audio_config):
        """Start recognition with given audio config"""
        self.recognizer = speechsdk.SpeechRecognizer(
            speech_config=self.speech_config,
            audio_config=audio_config
        )

        # Connect event handlers
        self.recognizer.recognizing.connect(self._handle_recognizing)
        self.recognizer.recognized.connect(self._handle_recognized)
        self.recognizer.canceled.connect(self._handle_canceled)
        self.recognizer.session_stopped.connect(self._handle_stopped)

        self.is_running = True
        self.recognizer.start_continuous_recognition()

    def stop(self):
        """Stop transcription"""
        if self.recognizer and self.is_running:
            self.recognizer.stop_continuous_recognition()
            self.is_running = False

    def get_result(self, timeout: float = 0.1) -> Optional[TranscriptionResult]:
        """Get next result from queue"""
        try:
            return self.result_queue.get(timeout=timeout)
        except queue.Empty:
            return None

# Usage
transcriber = RealTimeTranscriber(language="en-US")

def on_interim(result: TranscriptionResult):
    print(f"\r[Interim] {result.text}", end="", flush=True)

def on_final(result: TranscriptionResult):
    print(f"\n[Final] {result.text} (confidence: {result.confidence:.2%})")

transcriber.on_interim_result = on_interim
transcriber.on_final_result = on_final

transcriber.start_from_microphone()

# Keep running until stopped
try:
    while transcriber.is_running:
        pass
except KeyboardInterrupt:
    transcriber.stop()
```

### Push Stream for Custom Audio Sources

```python
class PushStreamTranscriber:
    """Transcribe from custom audio sources using push stream"""

    def __init__(self, sample_rate: int = 16000, channels: int = 1):
        self.speech_config = speechsdk.SpeechConfig(
            subscription=os.getenv("AZURE_SPEECH_KEY"),
            region=os.getenv("AZURE_SPEECH_REGION")
        )

        # Create push stream with audio format
        self.audio_format = speechsdk.audio.AudioStreamFormat(
            samples_per_second=sample_rate,
            bits_per_sample=16,
            channels=channels
        )

        self.push_stream = speechsdk.audio.PushAudioInputStream(
            stream_format=self.audio_format
        )

        self.audio_config = speechsdk.audio.AudioConfig(
            stream=self.push_stream
        )

        self.recognizer = speechsdk.SpeechRecognizer(
            speech_config=self.speech_config,
            audio_config=self.audio_config
        )

        self.results = []
        self.is_running = False
        self._setup_handlers()

    def _setup_handlers(self):
        def on_recognized(evt):
            if evt.result.reason == speechsdk.ResultReason.RecognizedSpeech:
                self.results.append({
                    "text": evt.result.text,
                    "timestamp": datetime.now().isoformat()
                })

        self.recognizer.recognized.connect(on_recognized)

    def start(self):
        """Start recognition"""
        self.is_running = True
        self.recognizer.start_continuous_recognition()

    def push_audio(self, audio_data: bytes):
        """Push audio data to stream"""
        if self.is_running:
            self.push_stream.write(audio_data)

    def stop(self):
        """Stop recognition"""
        self.is_running = False
        self.push_stream.close()
        self.recognizer.stop_continuous_recognition()

    def get_results(self) -> list:
        """Get all transcription results"""
        return self.results

# Usage example with file audio
def transcribe_file_realtime(file_path: str):
    import wave

    with wave.open(file_path, 'rb') as wav:
        sample_rate = wav.getframerate()
        channels = wav.getnchannels()

        transcriber = PushStreamTranscriber(
            sample_rate=sample_rate,
            channels=channels
        )

        transcriber.start()

        # Push audio in chunks (simulate real-time)
        chunk_size = sample_rate * 2  # 1 second chunks (16-bit = 2 bytes)
        while True:
            audio_chunk = wav.readframes(chunk_size // 2)
            if not audio_chunk:
                break
            transcriber.push_audio(audio_chunk)
            import time
            time.sleep(0.9)  # Simulate real-time

        transcriber.stop()
        return transcriber.get_results()
```

### WebSocket-Based Real-Time Transcription Server

```python
import asyncio
import websockets
import json

class TranscriptionServer:
    """WebSocket server for real-time transcription"""

    def __init__(self, host: str = "localhost", port: int = 8765):
        self.host = host
        self.port = port
        self.clients = set()

    async def handler(self, websocket, path):
        """Handle WebSocket connection"""
        self.clients.add(websocket)
        print(f"Client connected. Total clients: {len(self.clients)}")

        transcriber = RealTimeTranscriber()

        # Set up callbacks to send to WebSocket
        async def send_result(result: TranscriptionResult):
            message = json.dumps({
                "type": "interim" if not result.is_final else "final",
                "text": result.text,
                "confidence": result.confidence,
                "timestamp": result.timestamp.isoformat()
            })
            await websocket.send(message)

        # Wrapper to run async from sync callback
        def on_result(result: TranscriptionResult):
            asyncio.create_task(send_result(result))

        transcriber.on_interim_result = on_result
        transcriber.on_final_result = on_result

        try:
            async for message in websocket:
                data = json.loads(message)

                if data["action"] == "start":
                    transcriber.start_from_microphone()
                    await websocket.send(json.dumps({"type": "status", "message": "started"}))

                elif data["action"] == "stop":
                    transcriber.stop()
                    await websocket.send(json.dumps({"type": "status", "message": "stopped"}))

                elif data["action"] == "audio":
                    # Handle audio chunks if using push stream
                    pass

        except websockets.exceptions.ConnectionClosed:
            print("Client disconnected")
        finally:
            transcriber.stop()
            self.clients.remove(websocket)

    async def start(self):
        """Start WebSocket server"""
        async with websockets.serve(self.handler, self.host, self.port):
            print(f"Transcription server running on ws://{self.host}:{self.port}")
            await asyncio.Future()  # Run forever

# Run server
# server = TranscriptionServer()
# asyncio.run(server.start())
```

### Client-Side Integration (JavaScript)

```javascript
// Browser-based real-time transcription client
class TranscriptionClient {
    constructor(serverUrl) {
        this.serverUrl = serverUrl;
        this.ws = null;
        this.onInterim = null;
        this.onFinal = null;
    }

    connect() {
        return new Promise((resolve, reject) => {
            this.ws = new WebSocket(this.serverUrl);

            this.ws.onopen = () => {
                console.log('Connected to transcription server');
                resolve();
            };

            this.ws.onerror = (error) => {
                reject(error);
            };

            this.ws.onmessage = (event) => {
                const data = JSON.parse(event.data);

                if (data.type === 'interim' && this.onInterim) {
                    this.onInterim(data);
                } else if (data.type === 'final' && this.onFinal) {
                    this.onFinal(data);
                }
            };
        });
    }

    start() {
        this.ws.send(JSON.stringify({ action: 'start' }));
    }

    stop() {
        this.ws.send(JSON.stringify({ action: 'stop' }));
    }

    disconnect() {
        this.ws.close();
    }
}

// Usage
const client = new TranscriptionClient('ws://localhost:8765');

client.onInterim = (data) => {
    document.getElementById('interim').textContent = data.text;
};

client.onFinal = (data) => {
    const transcript = document.getElementById('transcript');
    transcript.innerHTML += `<p>${data.text} <small>(${(data.confidence * 100).toFixed(1)}%)</small></p>`;
};

await client.connect();
client.start();
```

## Performance Optimization

```python
class OptimizedTranscriber:
    """Transcriber with performance optimizations"""

    def __init__(self):
        self.speech_config = speechsdk.SpeechConfig(
            subscription=os.getenv("AZURE_SPEECH_KEY"),
            region=os.getenv("AZURE_SPEECH_REGION")
        )

        # Optimize for low latency
        self.speech_config.set_property(
            speechsdk.PropertyId.SpeechServiceConnection_InitialSilenceTimeoutMs,
            "5000"  # 5 seconds initial silence timeout
        )
        self.speech_config.set_property(
            speechsdk.PropertyId.SpeechServiceConnection_EndSilenceTimeoutMs,
            "1000"  # 1 second end silence timeout
        )
        self.speech_config.set_property(
            speechsdk.PropertyId.Speech_SegmentationSilenceTimeoutMs,
            "500"  # 500ms segmentation silence
        )

        # Use compressed audio format for lower bandwidth
        self.speech_config.set_property(
            speechsdk.PropertyId.SpeechServiceConnection_CompressionType,
            "gzip"
        )

    def configure_for_scenario(self, scenario: str):
        """Configure based on specific scenario"""
        if scenario == "live_captioning":
            # Prioritize speed over accuracy
            self.speech_config.set_property(
                speechsdk.PropertyId.SpeechServiceConnection_EndSilenceTimeoutMs,
                "500"
            )

        elif scenario == "meeting_transcription":
            # Balance speed and accuracy
            self.speech_config.enable_dictation()

        elif scenario == "voice_command":
            # Single phrase recognition
            pass  # Use recognize_once instead of continuous

        return self
```

## Conclusion

Real-time transcription with Azure AI Speech enables powerful voice-enabled applications. By implementing proper streaming, WebSocket communication, and performance optimizations, you can build responsive transcription solutions for live captioning, meetings, and voice interfaces. The key is balancing latency with accuracy based on your specific use case requirements.

