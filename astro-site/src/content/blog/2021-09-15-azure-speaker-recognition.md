---
title: Implementing Speaker Recognition with Azure Cognitive Services
description: "Speaker Recognition enables secure, frictionless authentication and personalized experiences based on voice identity."
author: Michael John Pena
draft: false
date: 2021-09-15
tags:
  - Azure
  - Cognitive Services
  - Speaker Recognition
  - Biometrics
  - Security
---

## Speaker Recognition Modes

1. **Speaker Verification**: Verify a claimed identity (1:1 matching)
2. **Speaker Identification**: Identify who is speaking (1:N matching)

Both modes support:
- **Text-dependent**: User speaks a specific passphrase
- **Text-independent**: User speaks any content

## Setting Up the Client

```python
import azure.cognitiveservices.speech as speechsdk
import time

class SpeakerRecognitionClient:
    def __init__(self, speech_key: str, region: str):
        self.speech_config = speechsdk.SpeechConfig(
            subscription=speech_key,
            region=region
        )

    def create_voice_profile(self, profile_type: str) -> str:
        """Create a new voice profile for enrollment."""

        if profile_type == "verification_text_dependent":
            profile_type_enum = speechsdk.VoiceProfileType.TextDependentVerification
        elif profile_type == "verification_text_independent":
            profile_type_enum = speechsdk.VoiceProfileType.TextIndependentVerification
        else:
            profile_type_enum = speechsdk.VoiceProfileType.TextIndependentIdentification

        client = speechsdk.VoiceProfileClient(
            speech_config=self.speech_config
        )

        profile = client.create_profile_async(
            profile_type_enum,
            "en-US"
        ).get()

        print(f"Created profile: {profile.profile_id}")
        return profile.profile_id
```

## Text-Dependent Speaker Verification

```python
class TextDependentVerification:
    def __init__(self, speech_key: str, region: str):
        self.speech_config = speechsdk.SpeechConfig(
            subscription=speech_key,
            region=region
        )
        self.client = speechsdk.VoiceProfileClient(
            speech_config=self.speech_config
        )

    def get_activation_phrases(self) -> list:
        """Get available activation phrases."""
        phrases = self.client.get_activation_phrases_async(
            speechsdk.VoiceProfileType.TextDependentVerification,
            "en-US"
        ).get()
        return phrases.phrases

    def enroll_speaker(self, profile_id: str, audio_file: str) -> dict:
        """Enroll a speaker with their voice sample."""

        profile = speechsdk.VoiceProfile(
            profile_id,
            speechsdk.VoiceProfileType.TextDependentVerification
        )

        audio_config = speechsdk.AudioConfig(filename=audio_file)

        result = self.client.enroll_profile_async(
            profile,
            audio_config
        ).get()

        return {
            "reason": str(result.reason),
            "enrollments_count": result.enrollments_count,
            "remaining_enrollments": result.remaining_enrollments_count
        }

    def verify_speaker(self, profile_id: str, audio_file: str) -> dict:
        """Verify a speaker against their enrolled profile."""

        model = speechsdk.SpeakerVerificationModel.from_profile(
            speechsdk.VoiceProfile(
                profile_id,
                speechsdk.VoiceProfileType.TextDependentVerification
            )
        )

        audio_config = speechsdk.AudioConfig(filename=audio_file)

        recognizer = speechsdk.SpeakerRecognizer(
            speech_config=self.speech_config,
            audio_config=audio_config
        )

        result = recognizer.recognize_once_async(model).get()

        return {
            "verified": result.reason == speechsdk.ResultReason.RecognizedSpeaker,
            "score": result.score,
            "profile_id": result.profile_id
        }

# Usage
verifier = TextDependentVerification("your-key", "westus")

# Get available phrases
phrases = verifier.get_activation_phrases()
print("Available phrases:", phrases[:3])

# Create profile
profile_id = "your-profile-id"

# Enroll (requires multiple samples)
for i in range(3):
    result = verifier.enroll_speaker(profile_id, f"enrollment_{i}.wav")
    print(f"Enrollment {i+1}: {result}")

# Verify
verification = verifier.verify_speaker(profile_id, "verification_sample.wav")
print(f"Verified: {verification['verified']}, Score: {verification['score']}")
```

## Text-Independent Speaker Identification

```python
class TextIndependentIdentification:
    def __init__(self, speech_key: str, region: str):
        self.speech_config = speechsdk.SpeechConfig(
            subscription=speech_key,
            region=region
        )
        self.client = speechsdk.VoiceProfileClient(
            speech_config=self.speech_config
        )

    def enroll_speaker(self, profile_id: str, audio_file: str) -> dict:
        """Enroll speaker with text-independent audio."""

        profile = speechsdk.VoiceProfile(
            profile_id,
            speechsdk.VoiceProfileType.TextIndependentIdentification
        )

        audio_config = speechsdk.AudioConfig(filename=audio_file)

        result = self.client.enroll_profile_async(
            profile,
            audio_config
        ).get()

        return {
            "reason": str(result.reason),
            "audio_length": result.audio_length
        }

    def identify_speaker(self, profile_ids: list, audio_file: str) -> dict:
        """Identify which enrolled speaker is in the audio."""

        profiles = [
            speechsdk.VoiceProfile(
                pid,
                speechsdk.VoiceProfileType.TextIndependentIdentification
            )
            for pid in profile_ids
        ]

        model = speechsdk.SpeakerIdentificationModel.from_profiles(profiles)

        audio_config = speechsdk.AudioConfig(filename=audio_file)

        recognizer = speechsdk.SpeakerRecognizer(
            speech_config=self.speech_config,
            audio_config=audio_config
        )

        result = recognizer.recognize_once_async(model).get()

        if result.reason == speechsdk.ResultReason.RecognizedSpeakers:
            return {
                "identified": True,
                "profile_id": result.profile_id,
                "score": result.score
            }
        else:
            return {
                "identified": False,
                "reason": str(result.reason)
            }

# Usage
identifier = TextIndependentIdentification("your-key", "westus")

# Enroll multiple speakers
speaker_profiles = {}
for speaker_name in ["alice", "bob", "charlie"]:
    # Create profile
    profile_id = f"profile-{speaker_name}"
    # Enroll with their audio
    identifier.enroll_speaker(profile_id, f"{speaker_name}_enrollment.wav")
    speaker_profiles[profile_id] = speaker_name

# Identify unknown speaker
result = identifier.identify_speaker(
    list(speaker_profiles.keys()),
    "unknown_speaker.wav"
)

if result["identified"]:
    speaker = speaker_profiles[result["profile_id"]]
    print(f"Identified speaker: {speaker} (score: {result['score']})")
```

## Real-Time Speaker Diarization

```python
import azure.cognitiveservices.speech as speechsdk

def transcribe_with_diarization(audio_file: str) -> list:
    """Transcribe audio with speaker identification."""

    speech_config = speechsdk.SpeechConfig(
        subscription="your-key",
        region="westus"
    )

    audio_config = speechsdk.AudioConfig(filename=audio_file)

    # Enable speaker diarization
    speech_config.set_property(
        speechsdk.PropertyId.SpeechServiceConnection_SingleLanguageIdPriority,
        "Latency"
    )

    transcriber = speechsdk.transcription.ConversationTranscriber(
        speech_config=speech_config,
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

    def handle_stopped(evt):
        nonlocal done
        done = True

    transcriber.transcribed.connect(handle_transcribed)
    transcriber.session_stopped.connect(handle_stopped)
    transcriber.canceled.connect(handle_stopped)

    transcriber.start_transcribing_async()

    while not done:
        time.sleep(0.5)

    transcriber.stop_transcribing_async()

    return results

# Transcribe meeting with speaker labels
results = transcribe_with_diarization("meeting.wav")

current_speaker = None
for segment in results:
    if segment['speaker_id'] != current_speaker:
        current_speaker = segment['speaker_id']
        print(f"\n[Speaker {current_speaker}]")
    print(segment['text'], end=' ')
```

## Building a Voice Authentication API

```python
from flask import Flask, request, jsonify
import azure.cognitiveservices.speech as speechsdk
import os
import tempfile
import uuid

app = Flask(__name__)

class VoiceAuthService:
    def __init__(self):
        self.speech_config = speechsdk.SpeechConfig(
            subscription=os.environ["SPEECH_KEY"],
            region=os.environ["SPEECH_REGION"]
        )
        self.client = speechsdk.VoiceProfileClient(
            speech_config=self.speech_config
        )
        self.profiles = {}  # In production, use a database

    def create_profile(self, user_id: str) -> str:
        profile = self.client.create_profile_async(
            speechsdk.VoiceProfileType.TextIndependentVerification,
            "en-US"
        ).get()
        self.profiles[user_id] = profile.profile_id
        return profile.profile_id

    def enroll(self, user_id: str, audio_data: bytes) -> dict:
        if user_id not in self.profiles:
            self.create_profile(user_id)

        # Save audio to temp file
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            f.write(audio_data)
            temp_path = f.name

        profile = speechsdk.VoiceProfile(
            self.profiles[user_id],
            speechsdk.VoiceProfileType.TextIndependentVerification
        )

        audio_config = speechsdk.AudioConfig(filename=temp_path)
        result = self.client.enroll_profile_async(profile, audio_config).get()

        os.remove(temp_path)

        return {
            "enrolled": result.reason == speechsdk.ResultReason.EnrolledVoiceProfile,
            "remaining_enrollments": result.remaining_enrollments_count
        }

    def verify(self, user_id: str, audio_data: bytes) -> dict:
        if user_id not in self.profiles:
            return {"verified": False, "error": "User not enrolled"}

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            f.write(audio_data)
            temp_path = f.name

        model = speechsdk.SpeakerVerificationModel.from_profile(
            speechsdk.VoiceProfile(
                self.profiles[user_id],
                speechsdk.VoiceProfileType.TextIndependentVerification
            )
        )

        audio_config = speechsdk.AudioConfig(filename=temp_path)
        recognizer = speechsdk.SpeakerRecognizer(
            speech_config=self.speech_config,
            audio_config=audio_config
        )

        result = recognizer.recognize_once_async(model).get()
        os.remove(temp_path)

        return {
            "verified": result.reason == speechsdk.ResultReason.RecognizedSpeaker,
            "confidence": result.score
        }

auth_service = VoiceAuthService()

@app.route('/enroll', methods=['POST'])
def enroll():
    user_id = request.form.get('user_id')
    audio = request.files['audio'].read()
    result = auth_service.enroll(user_id, audio)
    return jsonify(result)

@app.route('/verify', methods=['POST'])
def verify():
    user_id = request.form.get('user_id')
    audio = request.files['audio'].read()
    result = auth_service.verify(user_id, audio)
    return jsonify(result)

if __name__ == '__main__':
    app.run(port=5000)
```

## Best Practices

1. **Audio Quality**: Use consistent recording conditions
2. **Enrollment Samples**: Collect diverse samples for robustness
3. **Threshold Tuning**: Adjust confidence thresholds per use case
4. **Privacy**: Handle voice data with appropriate security
5. **Multi-Factor**: Combine with other authentication methods
6. **Liveness Detection**: Implement anti-spoofing measures

Speaker Recognition enables secure, frictionless authentication and personalized experiences based on voice identity.
