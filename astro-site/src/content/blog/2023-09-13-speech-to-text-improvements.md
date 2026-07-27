---
title: "Speech-to-Text Improvements in Azure AI: Accuracy and Performance"
author: Michael John Peña
draft: false
date: 2023-09-13
description: "Deep dive into the latest speech-to-text improvements in Azure AI including better accuracy, noise handling, and domain-specific recognition."
tags:
  - Azure
  - Speech Recognition
  - AI
  - Transcription
  - NLP

---

I wrote "Speech-to-Text Improvements in Azure AI: Accuracy and Performance" to share practical, production-minded guidance on this topic.

## Introduction

Azure AI Speech's speech-to-text capabilities have seen significant improvements in accuracy, especially for challenging scenarios like noisy environments, accented speech, and domain-specific vocabulary. This post explores these improvements and how to leverage them effectively.

## Improved Accuracy Features

### Noise Handling and Enhancement

```python
import os
import azure.cognitiveservices.speech as speechsdk

class EnhancedSpeechRecognizer:
    def __init__(self):
        self.speech_config = speechsdk.SpeechConfig(
            subscription=os.getenv("AZURE_SPEECH_KEY"),
            region=os.getenv("AZURE_SPEECH_REGION")
        )

        # Enable audio processing enhancements
        self.speech_config.set_property(
            speechsdk.PropertyId.Speech_SegmentationSilenceTimeoutMs,
            "2000"  # 2 seconds silence detection
        )

    def recognize_with_noise_suppression(
        self,
        audio_file: str,
        enable_audio_logging: bool = False
    ) -> dict:
        """Recognize speech with enhanced noise handling"""

        # Configure for noisy audio
        self.speech_config.set_property(
            speechsdk.PropertyId.SpeechServiceConnection_EndSilenceTimeoutMs,
            "1500"
        )

        if enable_audio_logging:
            self.speech_config.enable_audio_logging()

        audio_config = speechsdk.AudioConfig(filename=audio_file)
        recognizer = speechsdk.SpeechRecognizer(
            speech_config=self.speech_config,
            audio_config=audio_config
        )

        result = recognizer.recognize_once()

        return {
            "text": result.text if result.reason == speechsdk.ResultReason.RecognizedSpeech else "",
            "reason": str(result.reason),
            "confidence": self._extract_confidence(result)
        }

    def _extract_confidence(self, result) -> float:
        """Extract confidence score from result"""
        try:
            json_result = result.properties.get(
                speechsdk.PropertyId.SpeechServiceResponse_JsonResult
            )
            if json_result:
                import json
                data = json.loads(json_result)
                if "NBest" in data and len(data["NBest"]) > 0:
                    return data["NBest"][0].get("Confidence", 0.0)
        except Exception:
            pass
        return 0.0

    def recognize_with_detailed_results(self, audio_file: str) -> dict:
        """Get detailed recognition results including alternatives"""
        self.speech_config.output_format = speechsdk.OutputFormat.Detailed

        audio_config = speechsdk.AudioConfig(filename=audio_file)
        recognizer = speechsdk.SpeechRecognizer(
            speech_config=self.speech_config,
            audio_config=audio_config
        )

        result = recognizer.recognize_once()

        detailed = {
            "best_text": result.text,
            "alternatives": [],
            "word_timings": []
        }

        if result.reason == speechsdk.ResultReason.RecognizedSpeech:
            json_result = result.properties.get(
                speechsdk.PropertyId.SpeechServiceResponse_JsonResult
            )
            if json_result:
                import json
                data = json.loads(json_result)

                # Get N-best alternatives
                if "NBest" in data:
                    for alt in data["NBest"]:
                        detailed["alternatives"].append({
                            "text": alt.get("Display", ""),
                            "confidence": alt.get("Confidence", 0),
                            "lexical": alt.get("Lexical", "")
                        })

                        # Get word timings from first alternative
                        if "Words" in alt and not detailed["word_timings"]:
                            for word in alt["Words"]:
                                detailed["word_timings"].append({
                                    "word": word.get("Word", ""),
                                    "offset": word.get("Offset", 0),
                                    "duration": word.get("Duration", 0)
                                })

        return detailed

# Usage
recognizer = EnhancedSpeechRecognizer()

# Basic recognition with noise suppression
result = recognizer.recognize_with_noise_suppression("noisy_audio.wav")
print(f"Text: {result['text']}")
print(f"Confidence: {result['confidence']:.2%}")

# Detailed results
detailed = recognizer.recognize_with_detailed_results("audio.wav")
print(f"Best: {detailed['best_text']}")
print("Alternatives:")
for alt in detailed["alternatives"][:3]:
    print(f"  {alt['text']} ({alt['confidence']:.2%})")
```

### Custom Speech Models for Domain Accuracy

```python
class CustomSpeechTrainer:
    """Train custom speech models for improved domain accuracy"""

    def __init__(self):
        self.speech_config = speechsdk.SpeechConfig(
            subscription=os.getenv("AZURE_SPEECH_KEY"),
            region=os.getenv("AZURE_SPEECH_REGION")
        )
        # Custom Speech API endpoint would be different
        self.custom_speech_endpoint = os.getenv("CUSTOM_SPEECH_ENDPOINT")

    def prepare_training_data(
        self,
        transcripts: list,
        audio_files: list
    ) -> dict:
        """Prepare data format for custom speech training

        Args:
            transcripts: List of text transcripts
            audio_files: List of corresponding audio file paths
        """
        # Training data format
        training_data = []
        for transcript, audio in zip(transcripts, audio_files):
            training_data.append({
                "audio_url": audio,
                "transcript": transcript,
                "locale": "en-US"
            })

        return {
            "data_type": "acoustic",
            "training_data": training_data
        }

    def prepare_language_data(self, sentences: list, phrases: list) -> dict:
        """Prepare language model training data

        Args:
            sentences: Domain-specific sentences
            phrases: Important phrases and terms
        """
        return {
            "data_type": "language",
            "sentences": sentences,
            "phrases": phrases,
            "locale": "en-US"
        }

    def create_phrase_list_file(
        self,
        phrases: list,
        output_path: str
    ):
        """Create phrase list file for upload"""
        with open(output_path, "w", encoding="utf-8") as f:
            for phrase in phrases:
                f.write(f"{phrase}\n")

    def create_pronunciation_file(
        self,
        pronunciations: list,
        output_path: str
    ):
        """Create custom pronunciation file

        Args:
            pronunciations: List of {"word": "...", "pronunciation": "..."}
        """
        with open(output_path, "w", encoding="utf-8") as f:
            for item in pronunciations:
                f.write(f"{item['word']}\t{item['pronunciation']}\n")

# Example usage for medical domain
trainer = CustomSpeechTrainer()

# Medical phrases for better recognition
medical_phrases = [
    "myocardial infarction",
    "electrocardiogram",
    "systolic blood pressure",
    "diastolic blood pressure",
    "magnetic resonance imaging",
    "computed tomography",
    "prothrombin time",
    "international normalized ratio"
]

trainer.create_phrase_list_file(medical_phrases, "medical_phrases.txt")

# Custom pronunciations
pronunciations = [
    {"word": "COVID-19", "pronunciation": "k ow v ih d n ay n t iy n"},
    {"word": "mRNA", "pronunciation": "eh m aa r eh n ey"},
    {"word": "HIPAA", "pronunciation": "hh ih p ax"}
]

trainer.create_pronunciation_file(pronunciations, "pronunciations.txt")
```

### Batch Transcription for Large Audio Files

```python
import requests
import time
from typing import List, Optional

class BatchTranscriber:
    """Batch transcription for processing large audio files"""

    def __init__(self):
        self.api_key = os.getenv("AZURE_SPEECH_KEY")
        self.region = os.getenv("AZURE_SPEECH_REGION")
        self.base_url = f"https://{self.region}.api.cognitive.microsoft.com/speechtotext/v3.1"

    def create_transcription(
        self,
        audio_urls: List[str],
        locale: str = "en-US",
        model_id: Optional[str] = None,
        properties: dict = None
    ) -> str:
        """Create a batch transcription job

        Args:
            audio_urls: List of audio file URLs (must be accessible)
            locale: Language locale
            model_id: Custom model ID (optional)
            properties: Additional properties

        Returns:
            Transcription job ID
        """
        url = f"{self.base_url}/transcriptions"
        headers = {
            "Ocp-Apim-Subscription-Key": self.api_key,
            "Content-Type": "application/json"
        }

        body = {
            "contentUrls": audio_urls,
            "locale": locale,
            "displayName": f"Batch transcription {time.strftime('%Y%m%d-%H%M%S')}",
            "properties": properties or {
                "wordLevelTimestampsEnabled": True,
                "punctuationMode": "DictatedAndAutomatic",
                "profanityFilterMode": "Masked",
                "diarizationEnabled": True,
                "timeToLive": "PT12H"  # Results available for 12 hours
            }
        }

        if model_id:
            body["model"] = {"self": f"{self.base_url}/models/{model_id}"}

        response = requests.post(url, headers=headers, json=body)
        response.raise_for_status()

        data = response.json()
        return data["self"].split("/")[-1]

    def get_transcription_status(self, transcription_id: str) -> dict:
        """Get status of transcription job"""
        url = f"{self.base_url}/transcriptions/{transcription_id}"
        headers = {"Ocp-Apim-Subscription-Key": self.api_key}

        response = requests.get(url, headers=headers)
        response.raise_for_status()

        return response.json()

    def wait_for_completion(
        self,
        transcription_id: str,
        poll_interval: int = 30,
        timeout: int = 3600
    ) -> dict:
        """Wait for transcription to complete"""
        start_time = time.time()

        while True:
            status = self.get_transcription_status(transcription_id)

            if status["status"] == "Succeeded":
                return status
            elif status["status"] == "Failed":
                raise Exception(f"Transcription failed: {status}")

            if time.time() - start_time > timeout:
                raise TimeoutError("Transcription timed out")

            print(f"Status: {status['status']}, waiting...")
            time.sleep(poll_interval)

    def get_transcription_results(self, transcription_id: str) -> List[dict]:
        """Get transcription results"""
        url = f"{self.base_url}/transcriptions/{transcription_id}/files"
        headers = {"Ocp-Apim-Subscription-Key": self.api_key}

        response = requests.get(url, headers=headers)
        response.raise_for_status()

        files = response.json()["values"]
        results = []

        for file in files:
            if file["kind"] == "Transcription":
                # Download transcription content
                content_response = requests.get(
                    file["links"]["contentUrl"],
                    headers=headers
                )
                results.append(content_response.json())

        return results

    def transcribe_and_wait(
        self,
        audio_urls: List[str],
        locale: str = "en-US"
    ) -> List[dict]:
        """Convenience method to transcribe and wait for results"""
        job_id = self.create_transcription(audio_urls, locale)
        print(f"Created transcription job: {job_id}")

        self.wait_for_completion(job_id)
        return self.get_transcription_results(job_id)

# Usage
batch = BatchTranscriber()

# Transcribe multiple files
audio_urls = [
    "https://storage.blob.core.windows.net/audio/meeting1.wav",
    "https://storage.blob.core.windows.net/audio/meeting2.wav"
]

results = batch.transcribe_and_wait(audio_urls)

for result in results:
    print(f"Source: {result['source']}")
    for segment in result.get("combinedRecognizedPhrases", []):
        print(f"  Speaker: {segment.get('speaker', 'unknown')}")
        print(f"  Text: {segment['display']}")
```

### Speaker Diarization

```python
class SpeakerDiarization:
    """Identify different speakers in audio"""

    def __init__(self):
        self.speech_config = speechsdk.SpeechConfig(
            subscription=os.getenv("AZURE_SPEECH_KEY"),
            region=os.getenv("AZURE_SPEECH_REGION")
        )

    def transcribe_with_diarization(
        self,
        audio_file: str,
        min_speakers: int = 1,
        max_speakers: int = 5
    ) -> List[dict]:
        """Transcribe audio with speaker identification"""
        audio_config = speechsdk.AudioConfig(filename=audio_file)

        # Create conversation transcriber
        transcriber = speechsdk.transcription.ConversationTranscriber(
            speech_config=self.speech_config,
            audio_config=audio_config
        )

        results = []
        done = False

        def handle_transcribed(evt):
            if evt.result.reason == speechsdk.ResultReason.RecognizedSpeech:
                results.append({
                    "speaker_id": evt.result.speaker_id,
                    "text": evt.result.text,
                    "offset": evt.result.offset,
                    "duration": evt.result.duration
                })

        def handle_canceled(evt):
            nonlocal done
            done = True

        def handle_stopped(evt):
            nonlocal done
            done = True

        transcriber.transcribed.connect(handle_transcribed)
        transcriber.canceled.connect(handle_canceled)
        transcriber.session_stopped.connect(handle_stopped)

        transcriber.start_transcribing_async()

        while not done:
            time.sleep(0.5)

        transcriber.stop_transcribing_async()

        return results

    def format_conversation(self, results: List[dict]) -> str:
        """Format diarized results as conversation"""
        formatted = []
        current_speaker = None

        for segment in sorted(results, key=lambda x: x["offset"]):
            speaker = segment["speaker_id"]

            if speaker != current_speaker:
                current_speaker = speaker
                formatted.append(f"\n[Speaker {speaker}]")

            formatted.append(segment["text"])

        return " ".join(formatted)

# Usage
diarizer = SpeakerDiarization()

results = diarizer.transcribe_with_diarization("meeting.wav", max_speakers=4)
conversation = diarizer.format_conversation(results)
print(conversation)
```

## Conclusion

The latest speech-to-text improvements in Azure AI provide significantly enhanced accuracy for real-world scenarios. By leveraging noise suppression, custom models, batch transcription, and speaker diarization, you can build robust transcription solutions for challenging use cases. The combination of real-time and batch processing options ensures flexibility for various application requirements.

