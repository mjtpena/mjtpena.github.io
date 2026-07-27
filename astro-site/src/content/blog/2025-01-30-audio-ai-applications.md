---
title: "Audio AI: Speech Recognition, Synthesis, and Analysis for Data Applications"
author: Michael John Peña
draft: false
date: 2025-01-30
tags:
  - AI
  - Audio
  - Speech Recognition
  - Azure
  - Cognitive Services

---

I wrote "Audio AI: Speech Recognition, Synthesis, and Analysis for Data Applications" to share practical, production-minded guidance on this topic.

## Azure Speech Services Overview

```
Azure Speech Services
├── Speech-to-Text (Transcription)
│   ├── Real-time transcription
│   ├── Batch transcription
│   └── Custom speech models
├── Text-to-Speech (Synthesis)
│   ├── Neural voices
│   └── Custom voices
├── Speech Translation
├── Speaker Recognition
└── Pronunciation Assessment
```

## Speech-to-Text for Data Pipelines

### Real-Time Transcription

```python
import azure.cognitiveservices.speech as speechsdk

class RealtimeTranscriber:
    def __init__(self, speech_key: str, region: str):
        self.speech_config = speechsdk.SpeechConfig(
            subscription=speech_key,
            region=region
        )
        self.speech_config.speech_recognition_language = "en-US"

    def transcribe_from_microphone(self, callback=None):
        """Transcribe speech from microphone in real-time."""

        audio_config = speechsdk.audio.AudioConfig(use_default_microphone=True)
        recognizer = speechsdk.SpeechRecognizer(
            speech_config=self.speech_config,
            audio_config=audio_config
        )

        results = []

        def handle_result(evt):
            if evt.result.reason == speechsdk.ResultReason.RecognizedSpeech:
                results.append({
                    "text": evt.result.text,
                    "offset": evt.result.offset,
                    "duration": evt.result.duration
                })
                if callback:
                    callback(evt.result.text)

        recognizer.recognized.connect(handle_result)

        # Start continuous recognition
        recognizer.start_continuous_recognition()

        return recognizer, results

    def transcribe_file(self, audio_file: str) -> dict:
        """Transcribe an audio file."""

        audio_config = speechsdk.audio.AudioConfig(filename=audio_file)
        recognizer = speechsdk.SpeechRecognizer(
            speech_config=self.speech_config,
            audio_config=audio_config
        )

        result = recognizer.recognize_once()

        if result.reason == speechsdk.ResultReason.RecognizedSpeech:
            return {"success": True, "text": result.text}
        elif result.reason == speechsdk.ResultReason.NoMatch:
            return {"success": False, "error": "No speech recognized"}
        else:
            return {"success": False, "error": str(result.reason)}
```

### Batch Transcription for Large Files

```python
from azure.storage.blob import BlobServiceClient
import requests
import time

class BatchTranscriber:
    def __init__(self, speech_key: str, region: str):
        self.speech_key = speech_key
        self.region = region
        self.base_url = f"https://{region}.api.cognitive.microsoft.com/speechtotext/v3.1"

    def transcribe_batch(
        self,
        audio_urls: list[str],
        language: str = "en-US"
    ) -> str:
        """Submit batch transcription job."""

        headers = {
            "Ocp-Apim-Subscription-Key": self.speech_key,
            "Content-Type": "application/json"
        }

        body = {
            "contentUrls": audio_urls,
            "locale": language,
            "displayName": f"Batch transcription {datetime.now().isoformat()}",
            "properties": {
                "wordLevelTimestampsEnabled": True,
                "diarizationEnabled": True,  # Speaker identification
                "punctuationMode": "DictatedAndAutomatic"
            }
        }

        response = requests.post(
            f"{self.base_url}/transcriptions",
            headers=headers,
            json=body
        )

        if response.status_code == 201:
            return response.json()["self"]  # URL to check status
        else:
            raise Exception(f"Failed to create transcription: {response.text}")

    def wait_for_completion(self, transcription_url: str, timeout_minutes: int = 60) -> dict:
        """Wait for batch transcription to complete."""

        headers = {"Ocp-Apim-Subscription-Key": self.speech_key}

        start_time = time.time()
        while time.time() - start_time < timeout_minutes * 60:
            response = requests.get(transcription_url, headers=headers)
            status = response.json()

            if status["status"] == "Succeeded":
                # Get results
                files_url = status["links"]["files"]
                files_response = requests.get(files_url, headers=headers)
                return files_response.json()

            elif status["status"] == "Failed":
                raise Exception(f"Transcription failed: {status}")

            time.sleep(30)  # Check every 30 seconds

        raise TimeoutError("Transcription timed out")
```

## Meeting Transcription with Speaker Diarization

```python
class MeetingTranscriber:
    def __init__(self, speech_key: str, region: str):
        self.speech_config = speechsdk.SpeechConfig(
            subscription=speech_key,
            region=region
        )

    def transcribe_meeting(self, audio_file: str) -> list[dict]:
        """Transcribe a meeting with speaker identification."""

        audio_config = speechsdk.audio.AudioConfig(filename=audio_file)

        # Create conversation transcriber
        conversation_transcriber = speechsdk.transcription.ConversationTranscriber(
            speech_config=self.speech_config,
            audio_config=audio_config
        )

        transcription = []
        done = False

        def handle_transcribed(evt):
            if evt.result.reason == speechsdk.ResultReason.RecognizedSpeech:
                transcription.append({
                    "speaker": evt.result.speaker_id,
                    "text": evt.result.text,
                    "offset_seconds": evt.result.offset / 10_000_000,  # Convert ticks to seconds
                    "duration_seconds": evt.result.duration / 10_000_000
                })

        def handle_stopped(evt):
            nonlocal done
            done = True

        conversation_transcriber.transcribed.connect(handle_transcribed)
        conversation_transcriber.session_stopped.connect(handle_stopped)
        conversation_transcriber.canceled.connect(handle_stopped)

        conversation_transcriber.start_transcribing_async()

        while not done:
            time.sleep(0.5)

        conversation_transcriber.stop_transcribing_async()

        return transcription

    def format_as_dialogue(self, transcription: list[dict]) -> str:
        """Format transcription as readable dialogue."""

        lines = []
        current_speaker = None

        for segment in transcription:
            if segment["speaker"] != current_speaker:
                current_speaker = segment["speaker"]
                lines.append(f"\n[{current_speaker}]:")

            lines.append(segment["text"])

        return " ".join(lines)
```

## Text-to-Speech for Reports

```python
class ReportNarrator:
    def __init__(self, speech_key: str, region: str):
        self.speech_config = speechsdk.SpeechConfig(
            subscription=speech_key,
            region=region
        )
        # Use a neural voice
        self.speech_config.speech_synthesis_voice_name = "en-US-JennyNeural"

    def narrate_report(self, text: str, output_file: str) -> bool:
        """Convert report text to audio file."""

        audio_config = speechsdk.audio.AudioOutputConfig(filename=output_file)
        synthesizer = speechsdk.SpeechSynthesizer(
            speech_config=self.speech_config,
            audio_config=audio_config
        )

        result = synthesizer.speak_text_async(text).get()

        if result.reason == speechsdk.ResultReason.SynthesizingAudioCompleted:
            return True
        else:
            return False

    def narrate_with_ssml(self, content: dict, output_file: str) -> bool:
        """Narrate with SSML for better control."""

        ssml = f"""
        <speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">
            <voice name="en-US-JennyNeural">
                <prosody rate="medium" pitch="medium">
                    <p>
                        <s><emphasis level="strong">{content['title']}</emphasis></s>
                        <break time="500ms"/>
                        <s>Report generated on {content['date']}</s>
                    </p>
                    <break time="1s"/>
                    <p>
                        <s>Key highlights:</s>
                        {"".join(f'<s>{highlight}</s><break time="300ms"/>' for highlight in content['highlights'])}
                    </p>
                    <break time="1s"/>
                    <p>
                        <s>In summary, {content['summary']}</s>
                    </p>
                </prosody>
            </voice>
        </speak>
        """

        audio_config = speechsdk.audio.AudioOutputConfig(filename=output_file)
        synthesizer = speechsdk.SpeechSynthesizer(
            speech_config=self.speech_config,
            audio_config=audio_config
        )

        result = synthesizer.speak_ssml_async(ssml).get()
        return result.reason == speechsdk.ResultReason.SynthesizingAudioCompleted
```

## Audio Analysis with AI

```python
class AudioAnalyzer:
    def __init__(self, transcriber: RealtimeTranscriber, llm_client):
        self.transcriber = transcriber
        self.llm = llm_client

    async def analyze_customer_call(self, audio_file: str) -> dict:
        """Analyze a customer support call."""

        # Transcribe
        transcription_result = self.transcriber.transcribe_file(audio_file)

        if not transcription_result["success"]:
            return {"error": transcription_result["error"]}

        transcript = transcription_result["text"]

        # Analyze with LLM
        response = await self.llm.chat.complete_async(
            deployment="gpt-4o",
            messages=[{
                "role": "user",
                "content": f"""Analyze this customer support call transcript:

                {transcript}

                Provide:
                1. Call summary
                2. Customer sentiment (positive/neutral/negative)
                3. Issue category
                4. Resolution status (resolved/escalated/pending)
                5. Key action items
                6. Quality score (1-10) for the support agent
                7. Improvement suggestions

                Return as JSON."""
            }]
        )

        return json.loads(response.choices[0].message.content)

    async def extract_meeting_insights(self, transcription: list[dict]) -> dict:
        """Extract actionable insights from meeting transcription."""

        transcript_text = "\n".join([
            f"{s['speaker']}: {s['text']}"
            for s in transcription
        ])

        response = await self.llm.chat.complete_async(
            deployment="gpt-4o",
            messages=[{
                "role": "user",
                "content": f"""Analyze this meeting transcript:

                {transcript_text}

                Extract:
                1. Meeting summary (2-3 sentences)
                2. Key decisions made
                3. Action items with owners
                4. Questions raised but not answered
                5. Follow-up meetings needed
                6. Topics that need more discussion

                Return as JSON."""
            }]
        )

        return json.loads(response.choices[0].message.content)
```

## Voice Interface for Data Queries

```python
class VoiceDataAssistant:
    def __init__(self, transcriber, synthesizer, data_assistant):
        self.transcriber = transcriber
        self.synthesizer = synthesizer
        self.assistant = data_assistant  # Your existing data assistant

    async def process_voice_query(self) -> str:
        """Process a voice query and respond with voice."""

        # Listen for query
        recognizer, _ = self.transcriber.transcribe_from_microphone()

        print("Listening... Speak your question.")
        result = recognizer.recognize_once()

        if result.reason == speechsdk.ResultReason.RecognizedSpeech:
            query = result.text
            print(f"You asked: {query}")

            # Process with data assistant
            response = await self.assistant.query(query)

            # Speak the response
            self.synthesizer.speak_text_async(response["answer"]).get()

            return response

        return {"error": "Could not understand speech"}
```

## Best Practices

1. **Audio quality**: Clean audio improves accuracy significantly
2. **Custom models**: Train on domain-specific vocabulary
3. **Batch large files**: Use batch API for cost efficiency
4. **Cache transcriptions**: Store results to avoid re-processing
5. **Handle silence**: Detect and handle empty audio gracefully

Audio AI adds a new dimension to data applications. Start with transcription use cases and expand to voice interfaces as your needs evolve.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
