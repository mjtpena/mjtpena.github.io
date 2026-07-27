---
title: "Custom Neural Voice: Creating Brand-Specific AI Voices"
author: Michael John Peña
draft: false
date: 2022-03-06
tags:
  - Azure
  - Speech Services
  - AI
  - Text-to-Speech
  - Custom Voice

---

I wrote "Custom Neural Voice: Creating Brand-Specific AI Voices" to share practical, production-minded guidance on this topic.

## Understanding Custom Neural Voice

Custom Neural Voice uses deep neural networks to create natural-sounding synthetic voices from audio recordings. Unlike traditional text-to-speech that sounds robotic, neural voices capture nuances like:

- Natural intonation and rhythm
- Emotional expression
- Speaking style variations
- Accent and pronunciation patterns

## Prerequisites

Before creating a custom voice, you need:

1. **Audio recordings**: 300-2000 high-quality recordings
2. **Transcriptions**: Matching text for each recording
3. **Azure Speech resource**: With Custom Neural Voice access
4. **Legal consent**: Written consent from the voice talent

## Recording Guidelines

Quality recordings are essential for good results:

```
Technical Requirements:
- Format: WAV, mono channel
- Sample rate: 24kHz or higher
- Bit depth: 16-bit
- Noise floor: Below -50dB
- Duration: 3-15 seconds per recording
- Environment: Professional recording studio or treated room
```

Recording script best practices:

```python
# Script selection criteria
script_requirements = {
    "phonetic_coverage": "Include all phonemes in target language",
    "prosodic_variety": "Questions, statements, exclamations",
    "domain_vocabulary": "Include domain-specific terms",
    "natural_flow": "Complete sentences, natural phrasing",
    "avoid": ["Tongue twisters", "Unusual abbreviations", "Foreign words"]
}
```

## Creating a Custom Voice Project

Use Speech Studio or the API:

```python
import requests
import json
import os

speech_key = os.environ["SPEECH_KEY"]
speech_region = os.environ["SPEECH_REGION"]
base_url = f"https://{speech_region}.api.cognitive.microsoft.com"

headers = {
    "Ocp-Apim-Subscription-Key": speech_key,
    "Content-Type": "application/json"
}

# Create a new voice project
project_payload = {
    "displayName": "Contoso Brand Voice",
    "description": "Professional voice for customer service applications",
    "projectKind": "CustomVoice",
    "locale": "en-US"
}

response = requests.post(
    f"{base_url}/speechtotext/v3.0/projects",
    headers=headers,
    json=project_payload
)

project = response.json()
project_id = project["self"].split("/")[-1]
print(f"Project created: {project_id}")
```

## Uploading Training Data

Upload audio and transcription files:

```python
from azure.storage.blob import BlobServiceClient, generate_blob_sas, BlobSasPermissions
from datetime import datetime, timedelta

def upload_training_data(audio_folder, transcription_file):
    # Upload to Azure Blob Storage
    blob_service = BlobServiceClient.from_connection_string(
        os.environ["STORAGE_CONNECTION_STRING"]
    )

    container_name = "voice-training-data"
    container_client = blob_service.get_container_client(container_name)

    # Upload audio files
    audio_files = []
    for filename in os.listdir(audio_folder):
        if filename.endswith(".wav"):
            blob_client = container_client.get_blob_client(f"audio/{filename}")
            with open(os.path.join(audio_folder, filename), "rb") as f:
                blob_client.upload_blob(f, overwrite=True)
            audio_files.append(filename)

    # Upload transcription file
    blob_client = container_client.get_blob_client("transcription.txt")
    with open(transcription_file, "rb") as f:
        blob_client.upload_blob(f, overwrite=True)

    # Generate SAS URL for Speech Service
    sas_token = generate_blob_sas(
        account_name=blob_service.account_name,
        container_name=container_name,
        blob_name="",
        permission=BlobSasPermissions(read=True, list=True),
        expiry=datetime.utcnow() + timedelta(hours=24)
    )

    return f"https://{blob_service.account_name}.blob.core.windows.net/{container_name}?{sas_token}"

# Transcription file format (tab-separated):
# audio_filename.wav\tTranscription text for the audio file.
```

## Training the Voice Model

Start the training process:

```python
def create_voice_model(project_id, dataset_id, model_name):
    training_payload = {
        "displayName": model_name,
        "description": "Custom neural voice model",
        "datasets": [
            {"datasetId": dataset_id}
        ],
        "locale": "en-US",
        "properties": {
            "voiceType": "NeuralTTS"
        }
    }

    response = requests.post(
        f"{base_url}/customvoice/models",
        headers=headers,
        json=training_payload
    )

    model = response.json()
    return model["id"]

# Training typically takes 20-40 compute hours
# Monitor status
def check_training_status(model_id):
    response = requests.get(
        f"{base_url}/customvoice/models/{model_id}",
        headers=headers
    )

    model = response.json()
    return {
        "status": model["status"],
        "created": model["createdDateTime"],
        "last_updated": model["lastActionDateTime"]
    }
```

## Deploying the Voice

Create an endpoint for the trained voice:

```python
def deploy_voice(model_id, endpoint_name):
    endpoint_payload = {
        "displayName": endpoint_name,
        "description": "Production endpoint for Contoso voice",
        "model": {"id": model_id}
    }

    response = requests.post(
        f"{base_url}/customvoice/endpoints",
        headers=headers,
        json=endpoint_payload
    )

    endpoint = response.json()
    return endpoint["id"]

# Get endpoint details for synthesis
def get_endpoint_details(endpoint_id):
    response = requests.get(
        f"{base_url}/customvoice/endpoints/{endpoint_id}",
        headers=headers
    )

    endpoint = response.json()
    return {
        "voice_name": endpoint["properties"]["voiceName"],
        "endpoint_url": endpoint["properties"]["endpointUrl"],
        "status": endpoint["status"]
    }
```

## Using the Custom Voice

Synthesize speech with your custom voice:

```python
import azure.cognitiveservices.speech as speechsdk

def synthesize_with_custom_voice(text, custom_voice_name, output_file=None):
    speech_config = speechsdk.SpeechConfig(
        subscription=os.environ["SPEECH_KEY"],
        region=os.environ["SPEECH_REGION"]
    )

    # Set custom voice endpoint
    speech_config.endpoint_id = os.environ["CUSTOM_VOICE_ENDPOINT_ID"]
    speech_config.speech_synthesis_voice_name = custom_voice_name

    if output_file:
        audio_config = speechsdk.audio.AudioOutputConfig(filename=output_file)
    else:
        audio_config = speechsdk.audio.AudioOutputConfig(use_default_speaker=True)

    synthesizer = speechsdk.SpeechSynthesizer(
        speech_config=speech_config,
        audio_config=audio_config
    )

    result = synthesizer.speak_text_async(text).get()

    if result.reason == speechsdk.ResultReason.SynthesizingAudioCompleted:
        print("Speech synthesized successfully")
        return True
    elif result.reason == speechsdk.ResultReason.Canceled:
        cancellation = result.cancellation_details
        print(f"Synthesis canceled: {cancellation.reason}")
        return False
```

## SSML with Custom Voice

Use SSML for fine-grained control:

```python
def synthesize_ssml(custom_voice_name, ssml_text):
    speech_config = speechsdk.SpeechConfig(
        subscription=os.environ["SPEECH_KEY"],
        region=os.environ["SPEECH_REGION"]
    )
    speech_config.endpoint_id = os.environ["CUSTOM_VOICE_ENDPOINT_ID"]

    synthesizer = speechsdk.SpeechSynthesizer(speech_config=speech_config)

    # SSML template
    ssml = f"""
    <speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis"
           xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="en-US">
        <voice name="{custom_voice_name}">
            <prosody rate="medium" pitch="default">
                {ssml_text}
            </prosody>
        </voice>
    </speak>
    """

    result = synthesizer.speak_ssml_async(ssml).get()
    return result

# Example with prosody adjustments
ssml_content = """
    <p>Welcome to Contoso customer service.</p>
    <break time="500ms"/>
    <p>
        <prosody rate="slow" pitch="+5%">
            How can I help you today?
        </prosody>
    </p>
"""

synthesize_ssml("ContosoVoice", ssml_content)
```

## Batch Synthesis

Generate audio for large volumes of text:

```python
def batch_synthesis(texts, custom_voice_name, output_folder):
    speech_config = speechsdk.SpeechConfig(
        subscription=os.environ["SPEECH_KEY"],
        region=os.environ["SPEECH_REGION"]
    )
    speech_config.endpoint_id = os.environ["CUSTOM_VOICE_ENDPOINT_ID"]
    speech_config.speech_synthesis_voice_name = custom_voice_name

    # Set output format
    speech_config.set_speech_synthesis_output_format(
        speechsdk.SpeechSynthesisOutputFormat.Audio24Khz160KBitRateMonoMp3
    )

    os.makedirs(output_folder, exist_ok=True)

    results = []
    for idx, text in enumerate(texts):
        output_file = os.path.join(output_folder, f"audio_{idx:04d}.mp3")
        audio_config = speechsdk.audio.AudioOutputConfig(filename=output_file)

        synthesizer = speechsdk.SpeechSynthesizer(
            speech_config=speech_config,
            audio_config=audio_config
        )

        result = synthesizer.speak_text_async(text).get()

        results.append({
            "index": idx,
            "text": text[:50] + "..." if len(text) > 50 else text,
            "output": output_file,
            "success": result.reason == speechsdk.ResultReason.SynthesizingAudioCompleted
        })

    return results
```

## Real-time Streaming

Stream synthesis results for low-latency applications:

```python
import queue
import threading

def stream_synthesis(text, custom_voice_name, audio_queue):
    speech_config = speechsdk.SpeechConfig(
        subscription=os.environ["SPEECH_KEY"],
        region=os.environ["SPEECH_REGION"]
    )
    speech_config.endpoint_id = os.environ["CUSTOM_VOICE_ENDPOINT_ID"]
    speech_config.speech_synthesis_voice_name = custom_voice_name

    # Create stream
    stream = speechsdk.audio.PushAudioOutputStream()
    audio_config = speechsdk.audio.AudioOutputConfig(stream=stream)

    synthesizer = speechsdk.SpeechSynthesizer(
        speech_config=speech_config,
        audio_config=audio_config
    )

    def synthesis_callback(evt):
        if evt.result.reason == speechsdk.ResultReason.SynthesizingAudio:
            audio_queue.put(evt.result.audio_data)
        elif evt.result.reason == speechsdk.ResultReason.SynthesizingAudioCompleted:
            audio_queue.put(None)  # Signal completion

    synthesizer.synthesizing.connect(synthesis_callback)
    synthesizer.synthesis_completed.connect(synthesis_callback)

    synthesizer.speak_text_async(text)

# Usage with audio playback
audio_queue = queue.Queue()
synthesis_thread = threading.Thread(
    target=stream_synthesis,
    args=("Hello, welcome to our service.", "ContosoVoice", audio_queue)
)
synthesis_thread.start()

# Process audio chunks as they arrive
while True:
    chunk = audio_queue.get()
    if chunk is None:
        break
    # Play or process audio chunk
    play_audio(chunk)
```

## Voice Comparison and Quality Assessment

Evaluate voice quality:

```python
def assess_voice_quality(original_audio, synthesized_audio):
    """Compare original recording with synthesized output"""
    import librosa
    import numpy as np

    # Load audio files
    original, sr = librosa.load(original_audio, sr=None)
    synthesized, _ = librosa.load(synthesized_audio, sr=sr)

    # Extract features
    def extract_features(audio, sr):
        mfcc = librosa.feature.mfcc(y=audio, sr=sr, n_mfcc=13)
        spectral_centroid = librosa.feature.spectral_centroid(y=audio, sr=sr)
        f0, voiced_flag, voiced_probs = librosa.pyin(
            audio, fmin=librosa.note_to_hz('C2'),
            fmax=librosa.note_to_hz('C7')
        )
        return {
            "mfcc_mean": np.mean(mfcc, axis=1),
            "spectral_centroid_mean": np.mean(spectral_centroid),
            "f0_mean": np.nanmean(f0)
        }

    original_features = extract_features(original, sr)
    synthesized_features = extract_features(synthesized, sr)

    # Compare features
    mfcc_distance = np.linalg.norm(
        original_features["mfcc_mean"] - synthesized_features["mfcc_mean"]
    )

    return {
        "mfcc_distance": mfcc_distance,
        "f0_difference": abs(original_features["f0_mean"] - synthesized_features["f0_mean"]),
        "spectral_difference": abs(
            original_features["spectral_centroid_mean"] -
            synthesized_features["spectral_centroid_mean"]
        )
    }
```

## Best Practices

1. **Voice talent selection**: Choose talent whose voice matches your brand personality
2. **Recording quality**: Invest in professional recording - quality in, quality out
3. **Script diversity**: Cover all phonemes and prosodic patterns
4. **Consent documentation**: Maintain clear legal records
5. **Regular updates**: Retrain with new data as needed

## Ethical Considerations

Custom Neural Voice requires responsible use:

```python
# Azure requires explicit consent from voice talent
consent_requirements = {
    "written_consent": "Signed agreement from voice talent",
    "video_consent": "Recording of talent giving verbal consent",
    "usage_disclosure": "Clear description of how voice will be used",
    "right_to_revoke": "Process for talent to request voice deletion",
    "no_impersonation": "Cannot create voices of public figures without consent"
}

# Microsoft reviews applications for Custom Neural Voice access
# to ensure responsible use
```

## Conclusion

Custom Neural Voice enables organizations to create distinctive, on-brand voice experiences. The technology produces remarkably natural results, but requires significant investment in quality recordings and responsible implementation. When done right, it creates memorable, consistent voice interactions that strengthen brand identity.

## Resources

- [Custom Neural Voice Documentation](https://docs.microsoft.com/en-us/azure/cognitive-services/speech-service/custom-neural-voice)
- [Speech Studio](https://speech.microsoft.com/)
- [Responsible AI Guidelines](https://docs.microsoft.com/en-us/azure/cognitive-services/speech-service/concepts-guidelines-responsible-deployment-synthetic)

