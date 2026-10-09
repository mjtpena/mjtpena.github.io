---
title: "Azure AI Services Updates: Vision, Speech, and Language Capabilities"
author: Michael John Peña
draft: false
date: 2023-09-08
description: "Exploring the latest Azure AI Services capabilities for vision, speech, and language processing in enterprise applications."
tags:
  - Azure
  - AI Services
  - Computer Vision
  - Speech
  - Language
---

## Introduction

Azure AI Services (formerly Cognitive Services) continues to evolve with new capabilities and improvements. This post provides an overview of the current state of Azure's AI services for vision, speech, and language processing.

## Azure AI Vision

### Current Capabilities

Azure AI Vision provides comprehensive image analysis:

```python
from azure.ai.vision.imageanalysis import ImageAnalysisClient
from azure.ai.vision.imageanalysis.models import VisualFeatures
from azure.core.credentials import AzureKeyCredential
import os

client = ImageAnalysisClient(
    endpoint=os.getenv("AZURE_VISION_ENDPOINT"),
    credential=AzureKeyCredential(os.getenv("AZURE_VISION_KEY"))
)

def analyze_image(image_url: str) -> dict:
    """Comprehensive image analysis."""
    result = client.analyze_from_url(
        image_url=image_url,
        visual_features=[
            VisualFeatures.CAPTION,
            VisualFeatures.DENSE_CAPTIONS,
            VisualFeatures.OBJECTS,
            VisualFeatures.TAGS,
            VisualFeatures.PEOPLE,
            VisualFeatures.SMART_CROPS,
            VisualFeatures.READ
        ],
        gender_neutral_caption=True
    )

    analysis = {
        "caption": result.caption.text if result.caption else None,
        "confidence": result.caption.confidence if result.caption else None,
        "objects": [],
        "tags": [],
        "text": []
    }

    if result.objects:
        for obj in result.objects.list:
            analysis["objects"].append({
                "name": obj.tags[0].name if obj.tags else "unknown",
                "confidence": obj.tags[0].confidence if obj.tags else 0
            })

    if result.tags:
        analysis["tags"] = [
            {"name": tag.name, "confidence": tag.confidence}
            for tag in result.tags.list
        ]

    if result.read and result.read.blocks:
        for block in result.read.blocks:
            for line in block.lines:
                analysis["text"].append(line.text)

    return analysis

# Usage
result = analyze_image("https://example.com/image.jpg")
print(f"Caption: {result['caption']}")
print(f"Objects: {[o['name'] for o in result['objects']]}")
```

### Custom Vision for Specialized Models

```python
from azure.cognitiveservices.vision.customvision.training import CustomVisionTrainingClient
from azure.cognitiveservices.vision.customvision.prediction import CustomVisionPredictionClient
from msrest.authentication import ApiKeyCredentials

class CustomVisionService:
    def __init__(self, training_endpoint: str, training_key: str,
                 prediction_endpoint: str, prediction_key: str):
        credentials = ApiKeyCredentials(in_headers={"Training-key": training_key})
        self.trainer = CustomVisionTrainingClient(training_endpoint, credentials)

        pred_credentials = ApiKeyCredentials(in_headers={"Prediction-key": prediction_key})
        self.predictor = CustomVisionPredictionClient(prediction_endpoint, pred_credentials)

    def create_project(self, name: str, domain_type: str = "Classification") -> str:
        """Create a new Custom Vision project."""
        domains = self.trainer.get_domains()

        # Find appropriate domain
        domain = next(
            (d for d in domains if domain_type in d.name and d.exportable),
            domains[0]
        )

        project = self.trainer.create_project(name, domain_id=domain.id)
        return project.id

    def predict(self, project_id: str, iteration_name: str, image_url: str) -> list:
        """Get predictions for an image."""
        results = self.predictor.classify_image_url(
            project_id,
            iteration_name,
            image_url
        )

        return [
            {"tag": p.tag_name, "probability": p.probability}
            for p in results.predictions
        ]

# Usage
service = CustomVisionService(
    os.getenv("CV_TRAINING_ENDPOINT"),
    os.getenv("CV_TRAINING_KEY"),
    os.getenv("CV_PREDICTION_ENDPOINT"),
    os.getenv("CV_PREDICTION_KEY")
)
```

## Azure AI Speech

### Speech to Text

```python
import azure.cognitiveservices.speech as speechsdk

class SpeechService:
    def __init__(self):
        self.speech_config = speechsdk.SpeechConfig(
            subscription=os.getenv("AZURE_SPEECH_KEY"),
            region=os.getenv("AZURE_SPEECH_REGION")
        )

    def transcribe_audio(self, audio_file: str) -> dict:
        """Transcribe audio file to text."""
        audio_config = speechsdk.AudioConfig(filename=audio_file)

        recognizer = speechsdk.SpeechRecognizer(
            speech_config=self.speech_config,
            audio_config=audio_config
        )

        result = recognizer.recognize_once()

        if result.reason == speechsdk.ResultReason.RecognizedSpeech:
            return {
                "success": True,
                "text": result.text,
                "confidence": "high"
            }
        elif result.reason == speechsdk.ResultReason.NoMatch:
            return {
                "success": False,
                "error": "No speech could be recognized"
            }
        else:
            return {
                "success": False,
                "error": f"Recognition failed: {result.reason}"
            }

    def transcribe_continuous(self, audio_file: str, callback) -> list:
        """Continuous transcription with callbacks."""
        audio_config = speechsdk.AudioConfig(filename=audio_file)

        recognizer = speechsdk.SpeechRecognizer(
            speech_config=self.speech_config,
            audio_config=audio_config
        )

        results = []
        done = False

        def handle_result(evt):
            if evt.result.reason == speechsdk.ResultReason.RecognizedSpeech:
                results.append(evt.result.text)
                callback(evt.result.text)

        def handle_stop(evt):
            nonlocal done
            done = True

        recognizer.recognized.connect(handle_result)
        recognizer.session_stopped.connect(handle_stop)
        recognizer.canceled.connect(handle_stop)

        recognizer.start_continuous_recognition()

        while not done:
            import time
            time.sleep(0.5)

        recognizer.stop_continuous_recognition()
        return results

# Usage
speech = SpeechService()
result = speech.transcribe_audio("meeting_recording.wav")
print(result["text"])
```

### Text to Speech

```python
def text_to_speech(text: str, output_file: str, voice: str = "en-US-JennyNeural") -> bool:
    """Convert text to speech."""
    speech_config = speechsdk.SpeechConfig(
        subscription=os.getenv("AZURE_SPEECH_KEY"),
        region=os.getenv("AZURE_SPEECH_REGION")
    )

    speech_config.speech_synthesis_voice_name = voice

    audio_config = speechsdk.AudioConfig(filename=output_file)

    synthesizer = speechsdk.SpeechSynthesizer(
        speech_config=speech_config,
        audio_config=audio_config
    )

    result = synthesizer.speak_text_async(text).get()

    return result.reason == speechsdk.ResultReason.SynthesizingAudioCompleted

# Usage
success = text_to_speech(
    "Hello, welcome to Azure AI Services.",
    "output.wav",
    "en-US-GuyNeural"
)
```

## Azure AI Language

### Text Analytics

```python
from azure.ai.textanalytics import TextAnalyticsClient
from azure.core.credentials import AzureKeyCredential

class LanguageService:
    def __init__(self):
        self.client = TextAnalyticsClient(
            endpoint=os.getenv("AZURE_LANGUAGE_ENDPOINT"),
            credential=AzureKeyCredential(os.getenv("AZURE_LANGUAGE_KEY"))
        )

    def analyze_sentiment(self, texts: list) -> list:
        """Analyze sentiment of texts."""
        results = self.client.analyze_sentiment(texts)

        return [
            {
                "text": texts[i][:50] + "...",
                "sentiment": result.sentiment,
                "confidence": {
                    "positive": result.confidence_scores.positive,
                    "neutral": result.confidence_scores.neutral,
                    "negative": result.confidence_scores.negative
                }
            }
            for i, result in enumerate(results)
            if not result.is_error
        ]

    def extract_entities(self, texts: list) -> list:
        """Extract named entities from texts."""
        results = self.client.recognize_entities(texts)

        all_entities = []
        for result in results:
            if not result.is_error:
                entities = [
                    {
                        "text": entity.text,
                        "category": entity.category,
                        "subcategory": entity.subcategory,
                        "confidence": entity.confidence_score
                    }
                    for entity in result.entities
                ]
                all_entities.append(entities)

        return all_entities

    def extract_key_phrases(self, texts: list) -> list:
        """Extract key phrases from texts."""
        results = self.client.extract_key_phrases(texts)

        return [
            result.key_phrases
            for result in results
            if not result.is_error
        ]

    def detect_language(self, texts: list) -> list:
        """Detect language of texts."""
        results = self.client.detect_language(texts)

        return [
            {
                "language": result.primary_language.name,
                "iso_code": result.primary_language.iso6391_name,
                "confidence": result.primary_language.confidence_score
            }
            for result in results
            if not result.is_error
        ]

# Usage
language = LanguageService()

texts = [
    "I love using Azure AI Services! The capabilities are amazing.",
    "The service was slow and the support was unhelpful."
]

# Sentiment analysis
sentiments = language.analyze_sentiment(texts)
for s in sentiments:
    print(f"Sentiment: {s['sentiment']}")

# Entity extraction
entities = language.extract_entities(texts)
for e in entities:
    print(f"Entities: {[ent['text'] for ent in e]}")

# Key phrases
phrases = language.extract_key_phrases(texts)
for p in phrases:
    print(f"Key phrases: {p}")
```

### Question Answering

```python
from azure.ai.language.questionanswering import QuestionAnsweringClient

class QAService:
    def __init__(self, project_name: str, deployment_name: str):
        self.client = QuestionAnsweringClient(
            endpoint=os.getenv("AZURE_LANGUAGE_ENDPOINT"),
            credential=AzureKeyCredential(os.getenv("AZURE_LANGUAGE_KEY"))
        )
        self.project = project_name
        self.deployment = deployment_name

    def answer_question(self, question: str) -> dict:
        """Get answer from knowledge base."""
        result = self.client.get_answers(
            question=question,
            project_name=self.project,
            deployment_name=self.deployment
        )

        if result.answers:
            top_answer = result.answers[0]
            return {
                "answer": top_answer.answer,
                "confidence": top_answer.confidence,
                "source": top_answer.source
            }

        return {
            "answer": "No answer found",
            "confidence": 0,
            "source": None
        }

# Usage
qa = QAService("my-kb-project", "production")
result = qa.answer_question("What are Azure Cognitive Services?")
print(f"Answer: {result['answer']}")
```

## Combining Services

### Multimodal Analysis Pipeline

```python
class MultimodalAnalyzer:
    def __init__(self):
        self.vision = ImageAnalysisClient(
            endpoint=os.getenv("AZURE_VISION_ENDPOINT"),
            credential=AzureKeyCredential(os.getenv("AZURE_VISION_KEY"))
        )
        self.language = LanguageService()

    def analyze_image_with_context(self, image_url: str, context: str) -> dict:
        """Analyze image and combine with language analysis."""
        # Get image analysis
        image_result = self.vision.analyze_from_url(
            image_url=image_url,
            visual_features=[
                VisualFeatures.CAPTION,
                VisualFeatures.TAGS,
                VisualFeatures.READ
            ]
        )

        # Extract text from image
        extracted_text = []
        if image_result.read and image_result.read.blocks:
            for block in image_result.read.blocks:
                for line in block.lines:
                    extracted_text.append(line.text)

        # Analyze extracted text
        text_to_analyze = " ".join(extracted_text) if extracted_text else context

        sentiment = self.language.analyze_sentiment([text_to_analyze])
        entities = self.language.extract_entities([text_to_analyze])

        return {
            "image_caption": image_result.caption.text if image_result.caption else None,
            "image_tags": [t.name for t in image_result.tags.list] if image_result.tags else [],
            "extracted_text": extracted_text,
            "sentiment": sentiment[0] if sentiment else None,
            "entities": entities[0] if entities else []
        }

# Usage
analyzer = MultimodalAnalyzer()
result = analyzer.analyze_image_with_context(
    "https://example.com/document.jpg",
    "Business document analysis"
)
```

## Conclusion

Azure AI Services provides a comprehensive suite of capabilities for building intelligent applications. The integration between vision, speech, and language services enables powerful multimodal solutions. As these services continue to evolve, we can expect even more sophisticated capabilities for enterprise AI applications.

## Resources

- [Azure AI Services Documentation](https://learn.microsoft.com/azure/cognitive-services/)
- [Azure AI Vision](https://learn.microsoft.com/azure/cognitive-services/computer-vision/)
- [Azure AI Speech](https://learn.microsoft.com/azure/cognitive-services/speech-service/)
- [Azure AI Language](https://learn.microsoft.com/azure/cognitive-services/language-service/)
