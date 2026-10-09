---
title: "Custom Neural Voice in Azure AI: Creating Unique Voice Experiences"
author: Michael John Peña
draft: false
date: 2023-09-14
description: "Learn how to create custom neural voices using Azure AI Speech for branded and personalized voice experiences."
tags:
  - Azure
  - Speech Synthesis
  - Neural Voice
  - AI
  - Custom TTS
---

## Introduction

Custom Neural Voice in Azure AI allows organizations to create unique, branded voice experiences. Whether for virtual assistants, audiobooks, or accessibility applications, custom voices provide consistency and personality that generic voices cannot match.

## Understanding Custom Neural Voice

### Voice Creation Process

```python
from dataclasses import dataclass
from typing import List, Optional
from enum import Enum

class VoiceGender(Enum):
    MALE = "Male"
    FEMALE = "Female"
    NEUTRAL = "Neutral"

class VoiceStyle(Enum):
    NARRATION = "narration"
    CONVERSATIONAL = "conversational"
    NEWSCAST = "newscast"
    CUSTOMER_SERVICE = "customerservice"
    ASSISTANT = "assistant"

@dataclass
class VoiceProfile:
    name: str
    gender: VoiceGender
    locale: str
    primary_style: VoiceStyle
    description: str
    target_scenarios: List[str]

@dataclass
class TrainingRecording:
    audio_file: str
    transcript: str
    duration_seconds: float
    quality_score: Optional[float] = None

class VoiceProjectPlan:
    """Plan a custom neural voice project"""

    def __init__(self, profile: VoiceProfile):
        self.profile = profile
        self.recordings: List[TrainingRecording] = []

    def estimate_requirements(self) -> dict:
        """Estimate data requirements for voice training"""
        # CNV Lite: 20-50 utterances for limited voice
        # CNV Pro: 300-2000 utterances for full voice
        # CNV Pro+: 2000+ utterances for premium quality

        return {
            "cnv_lite": {
                "min_utterances": 20,
                "max_utterances": 50,
                "total_audio_minutes": 5,
                "training_time_hours": 1,
                "use_cases": ["Proofs of concept", "Limited scenarios"]
            },
            "cnv_pro": {
                "min_utterances": 300,
                "max_utterances": 2000,
                "total_audio_minutes": 60,
                "training_time_hours": 10,
                "use_cases": ["Production applications", "Multiple styles"]
            },
            "cnv_pro_plus": {
                "min_utterances": 2000,
                "recommended_utterances": 5000,
                "total_audio_minutes": 240,
                "training_time_hours": 24,
                "use_cases": ["High-quality production", "Expressive range"]
            }
        }

    def generate_script_guidelines(self) -> dict:
        """Generate recording script guidelines"""
        return {
            "general_requirements": [
                "Use professional recording studio or quiet environment",
                "Maintain consistent microphone distance (15-20cm)",
                "Record at 24-bit, 48kHz WAV format",
                "Keep consistent energy and tone across sessions",
                "Avoid background noise and room reverb"
            ],
            "script_guidelines": [
                f"Write scripts in {self.profile.locale} locale",
                "Include diverse phonetic coverage",
                "Mix sentence lengths (5-25 words)",
                "Include questions, statements, and exclamations",
                "Avoid tongue twisters and unusual pronunciations"
            ],
            "style_specific": self._get_style_guidelines()
        }

    def _get_style_guidelines(self) -> List[str]:
        style = self.profile.primary_style
        guidelines = {
            VoiceStyle.CONVERSATIONAL: [
                "Natural, friendly tone",
                "Varied pacing and intonation",
                "Include casual phrases and contractions"
            ],
            VoiceStyle.NARRATION: [
                "Clear, measured delivery",
                "Consistent pacing",
                "Neutral emotional tone"
            ],
            VoiceStyle.NEWSCAST: [
                "Professional, authoritative tone",
                "Clear enunciation",
                "Steady, measured pace"
            ],
            VoiceStyle.CUSTOMER_SERVICE: [
                "Warm, helpful tone",
                "Patient delivery",
                "Clear pronunciation of common terms"
            ],
            VoiceStyle.ASSISTANT: [
                "Friendly but professional",
                "Natural conversational rhythm",
                "Clear instruction delivery"
            ]
        }
        return guidelines.get(style, [])

# Example usage
voice_profile = VoiceProfile(
    name="Aria",
    gender=VoiceGender.FEMALE,
    locale="en-US",
    primary_style=VoiceStyle.ASSISTANT,
    description="Friendly virtual assistant voice",
    target_scenarios=["Customer support", "Product assistant", "Notifications"]
)

project = VoiceProjectPlan(voice_profile)
requirements = project.estimate_requirements()
guidelines = project.generate_script_guidelines()

print("Recording Guidelines:")
for g in guidelines["general_requirements"]:
    print(f"  - {g}")
```

### Recording Quality Validation

```python
import os
import wave
import numpy as np
from typing import Tuple

class RecordingValidator:
    """Validate recording quality for voice training"""

    def __init__(self):
        self.requirements = {
            "sample_rate": 48000,
            "bit_depth": 24,
            "channels": 1,
            "min_duration": 1.0,
            "max_duration": 15.0,
            "min_snr_db": 35,
            "max_silence_ratio": 0.3
        }

    def validate_audio_file(self, file_path: str) -> dict:
        """Validate a single audio file"""
        results = {
            "file": file_path,
            "valid": True,
            "issues": [],
            "metrics": {}
        }

        try:
            with wave.open(file_path, 'rb') as wav:
                # Check format
                sample_rate = wav.getframerate()
                channels = wav.getnchannels()
                sample_width = wav.getsampwidth()
                n_frames = wav.getnframes()

                duration = n_frames / sample_rate

                results["metrics"]["sample_rate"] = sample_rate
                results["metrics"]["channels"] = channels
                results["metrics"]["bit_depth"] = sample_width * 8
                results["metrics"]["duration"] = duration

                # Validate sample rate
                if sample_rate < self.requirements["sample_rate"]:
                    results["valid"] = False
                    results["issues"].append(
                        f"Sample rate {sample_rate}Hz is below required {self.requirements['sample_rate']}Hz"
                    )

                # Validate channels
                if channels != self.requirements["channels"]:
                    results["valid"] = False
                    results["issues"].append(
                        f"Expected mono ({self.requirements['channels']} channel), got {channels} channels"
                    )

                # Validate duration
                if duration < self.requirements["min_duration"]:
                    results["valid"] = False
                    results["issues"].append(f"Duration {duration:.1f}s is too short")
                elif duration > self.requirements["max_duration"]:
                    results["valid"] = False
                    results["issues"].append(f"Duration {duration:.1f}s is too long")

                # Read audio data for additional analysis
                wav.rewind()
                audio_data = wav.readframes(n_frames)
                audio_array = np.frombuffer(audio_data, dtype=np.int16)

                # Analyze audio quality
                quality_metrics = self._analyze_audio_quality(audio_array, sample_rate)
                results["metrics"].update(quality_metrics)

                if quality_metrics["snr_db"] < self.requirements["min_snr_db"]:
                    results["issues"].append(
                        f"SNR {quality_metrics['snr_db']:.1f}dB is below minimum {self.requirements['min_snr_db']}dB"
                    )

                if quality_metrics["silence_ratio"] > self.requirements["max_silence_ratio"]:
                    results["issues"].append(
                        f"Too much silence ({quality_metrics['silence_ratio']:.1%})"
                    )

        except Exception as e:
            results["valid"] = False
            results["issues"].append(f"Error reading file: {str(e)}")

        return results

    def _analyze_audio_quality(self, audio: np.ndarray, sample_rate: int) -> dict:
        """Analyze audio quality metrics"""
        # Calculate RMS
        rms = np.sqrt(np.mean(audio.astype(np.float64) ** 2))

        # Estimate noise floor (using quietest 10% of frames)
        frame_size = int(sample_rate * 0.025)  # 25ms frames
        n_frames = len(audio) // frame_size
        frame_rms = []

        for i in range(n_frames):
            frame = audio[i * frame_size:(i + 1) * frame_size]
            frame_rms.append(np.sqrt(np.mean(frame.astype(np.float64) ** 2)))

        frame_rms.sort()
        noise_floor = np.mean(frame_rms[:max(1, n_frames // 10)])

        # Calculate SNR
        if noise_floor > 0:
            snr_db = 20 * np.log10(rms / noise_floor)
        else:
            snr_db = float('inf')

        # Calculate silence ratio
        silence_threshold = 0.01 * np.max(np.abs(audio))
        silence_samples = np.sum(np.abs(audio) < silence_threshold)
        silence_ratio = silence_samples / len(audio)

        # Detect clipping
        max_val = 2 ** 15 - 1  # For 16-bit audio
        clipped_samples = np.sum(np.abs(audio) >= max_val * 0.99)
        clipping_ratio = clipped_samples / len(audio)

        return {
            "rms": float(rms),
            "snr_db": float(snr_db),
            "silence_ratio": float(silence_ratio),
            "clipping_ratio": float(clipping_ratio),
            "peak_db": float(20 * np.log10(np.max(np.abs(audio)) / max_val))
        }

    def validate_batch(self, file_paths: List[str]) -> dict:
        """Validate a batch of recordings"""
        results = {
            "total_files": len(file_paths),
            "valid_files": 0,
            "invalid_files": 0,
            "file_results": []
        }

        for path in file_paths:
            file_result = self.validate_audio_file(path)
            results["file_results"].append(file_result)

            if file_result["valid"] and not file_result["issues"]:
                results["valid_files"] += 1
            else:
                results["invalid_files"] += 1

        return results

# Usage
validator = RecordingValidator()

# Validate single file
result = validator.validate_audio_file("recording_001.wav")
if result["valid"]:
    print(f"File is valid. Duration: {result['metrics']['duration']:.1f}s")
else:
    print("Issues found:")
    for issue in result["issues"]:
        print(f"  - {issue}")
```

## Using Custom Voices

### Synthesizing with Custom Voice

```python
import azure.cognitiveservices.speech as speechsdk

class CustomVoiceSynthesizer:
    def __init__(self, endpoint_id: str = None):
        self.speech_config = speechsdk.SpeechConfig(
            subscription=os.getenv("AZURE_SPEECH_KEY"),
            region=os.getenv("AZURE_SPEECH_REGION")
        )

        # Set custom voice endpoint if provided
        if endpoint_id:
            self.speech_config.endpoint_id = endpoint_id

    def synthesize(
        self,
        text: str,
        voice_name: str,
        output_file: str = None
    ) -> bool:
        """Synthesize speech with custom voice"""
        self.speech_config.speech_synthesis_voice_name = voice_name

        if output_file:
            audio_config = speechsdk.AudioConfig(filename=output_file)
        else:
            audio_config = speechsdk.AudioConfig(use_default_speaker=True)

        synthesizer = speechsdk.SpeechSynthesizer(
            speech_config=self.speech_config,
            audio_config=audio_config
        )

        result = synthesizer.speak_text_async(text).get()
        return result.reason == speechsdk.ResultReason.SynthesizingAudioCompleted

    def synthesize_with_ssml(
        self,
        ssml: str,
        output_file: str = None
    ) -> bool:
        """Synthesize using SSML for fine control"""
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

    def build_custom_ssml(
        self,
        text: str,
        voice_name: str,
        style: str = None,
        rate: str = None,
        pitch: str = None
    ) -> str:
        """Build SSML for custom voice with style control"""
        style_element = ""
        if style:
            style_element = f'<mstts:express-as style="{style}">'
            style_close = '</mstts:express-as>'
        else:
            style_close = ""

        prosody_attrs = []
        if rate:
            prosody_attrs.append(f'rate="{rate}"')
        if pitch:
            prosody_attrs.append(f'pitch="{pitch}"')

        if prosody_attrs:
            prosody_element = f'<prosody {" ".join(prosody_attrs)}>'
            prosody_close = '</prosody>'
        else:
            prosody_element = ""
            prosody_close = ""

        return f'''<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis"
    xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="en-US">
    <voice name="{voice_name}">
        {style_element}
        {prosody_element}
        {text}
        {prosody_close}
        {style_close}
    </voice>
</speak>'''

# Usage
synth = CustomVoiceSynthesizer(endpoint_id="your-custom-endpoint-id")

# Basic synthesis
synth.synthesize(
    "Welcome to our service. How can I help you today?",
    voice_name="your-custom-voice-name",
    output_file="output.wav"
)

# With SSML control
ssml = synth.build_custom_ssml(
    "I'm really excited to help you with that!",
    voice_name="your-custom-voice-name",
    style="cheerful",
    rate="+10%"
)
synth.synthesize_with_ssml(ssml, "excited.wav")
```

### Voice Consistency Testing

```python
class VoiceConsistencyTester:
    """Test custom voice consistency across different inputs"""

    def __init__(self, synthesizer: CustomVoiceSynthesizer, voice_name: str):
        self.synthesizer = synthesizer
        self.voice_name = voice_name

    def generate_test_suite(self) -> List[dict]:
        """Generate comprehensive test cases"""
        return [
            {
                "category": "basic_sentences",
                "cases": [
                    "Hello, how are you today?",
                    "The quick brown fox jumps over the lazy dog.",
                    "Please wait while I process your request."
                ]
            },
            {
                "category": "questions",
                "cases": [
                    "What would you like to do next?",
                    "Can I help you with anything else?",
                    "Did you find what you were looking for?"
                ]
            },
            {
                "category": "numbers_dates",
                "cases": [
                    "Your order number is 12345.",
                    "The meeting is scheduled for September 15th, 2023.",
                    "The total comes to $99.99."
                ]
            },
            {
                "category": "long_sentences",
                "cases": [
                    "Thank you for your patience while we review your account information and verify all the details you have provided to ensure accuracy.",
                    "Please be advised that due to scheduled maintenance, some services may be temporarily unavailable between 2 AM and 4 AM Eastern Time."
                ]
            },
            {
                "category": "special_characters",
                "cases": [
                    "Visit us at www.example.com for more information.",
                    "Send your questions to support@company.com.",
                    "Use code SAVE20 for a 20% discount."
                ]
            }
        ]

    def run_tests(self, output_dir: str) -> dict:
        """Run all test cases and save audio files"""
        os.makedirs(output_dir, exist_ok=True)

        test_suite = self.generate_test_suite()
        results = {
            "total_tests": 0,
            "passed": 0,
            "failed": 0,
            "details": []
        }

        for category in test_suite:
            for i, text in enumerate(category["cases"]):
                results["total_tests"] += 1

                filename = f"{category['category']}_{i+1}.wav"
                output_path = os.path.join(output_dir, filename)

                try:
                    success = self.synthesizer.synthesize(
                        text,
                        self.voice_name,
                        output_path
                    )

                    if success:
                        results["passed"] += 1
                        results["details"].append({
                            "category": category["category"],
                            "text": text,
                            "file": output_path,
                            "status": "passed"
                        })
                    else:
                        results["failed"] += 1
                        results["details"].append({
                            "category": category["category"],
                            "text": text,
                            "status": "failed",
                            "error": "Synthesis did not complete"
                        })

                except Exception as e:
                    results["failed"] += 1
                    results["details"].append({
                        "category": category["category"],
                        "text": text,
                        "status": "failed",
                        "error": str(e)
                    })

        return results

# Usage
tester = VoiceConsistencyTester(synth, "your-custom-voice-name")
results = tester.run_tests("./voice_tests")

print(f"Tests: {results['passed']}/{results['total_tests']} passed")
```

## Conclusion

Custom Neural Voice enables organizations to create distinctive, branded voice experiences that strengthen their identity across applications. By following proper recording guidelines, validating audio quality, and implementing comprehensive testing, you can build high-quality custom voices that deliver consistent, engaging user experiences.
