---
title: "Azure Cognitive Services Updates: What's New in Early 2023"
author: Michael John Peña
draft: false
date: 2023-02-24
tags:
  - Azure
  - Cognitive Services
  - AI
  - Updates
  - Microsoft

---

I wrote "Azure Cognitive Services Updates: What's New in Early 2023" to share practical, production-minded guidance on this topic.

## Vision Services Updates

```python
from azure.cognitiveservices.vision.computervision import ComputerVisionClient
from msrest.authentication import CognitiveServicesCredentials

# Computer Vision 4.0 - New unified API
vision_client = ComputerVisionClient(
    endpoint="https://your-resource.cognitiveservices.azure.com/",
    credentials=CognitiveServicesCredentials("your-key")
)

# New Image Analysis 4.0 features
def analyze_image_v4(image_url: str):
    """Use new Image Analysis 4.0 API."""
    from azure.ai.vision.imageanalysis import ImageAnalysisClient
    from azure.ai.vision.imageanalysis.models import VisualFeatures

    client = ImageAnalysisClient(
        endpoint="https://your-resource.cognitiveservices.azure.com/",
        credential=AzureKeyCredential("your-key")
    )

    # Specify visual features to analyze
    result = client.analyze(
        image_url=image_url,
        visual_features=[
            VisualFeatures.CAPTION,
            VisualFeatures.DENSE_CAPTIONS,
            VisualFeatures.OBJECTS,
            VisualFeatures.TAGS,
            VisualFeatures.PEOPLE,
            VisualFeatures.SMART_CROPS,
            VisualFeatures.READ
        ]
    )

    return {
        "caption": result.caption.text if result.caption else None,
        "dense_captions": [c.text for c in result.dense_captions.list] if result.dense_captions else [],
        "objects": [{"name": o.name, "confidence": o.confidence} for o in result.objects.list] if result.objects else [],
        "tags": [{"name": t.name, "confidence": t.confidence} for t in result.tags.list] if result.tags else [],
        "people": len(result.people.list) if result.people else 0,
        "text": result.read.content if result.read else None
    }
```

## Speech Services Updates

```python
import azure.cognitiveservices.speech as speechsdk

# New neural voices and languages
NEURAL_VOICES = {
    "en-US": ["Jenny", "Guy", "Aria", "Davis"],
    "en-GB": ["Sonia", "Ryan", "Libby"],
    "ja-JP": ["Nanami", "Keita"],
    "zh-CN": ["Xiaoxiao", "Yunxi"]
}

def text_to_speech_neural(
    text: str,
    voice_name: str = "en-US-JennyNeural",
    style: str = None
) -> bytes:
    """Convert text to speech with neural voices."""

    speech_config = speechsdk.SpeechConfig(
        subscription="your-key",
        region="your-region"
    )

    # Use SSML for advanced control
    if style:
        ssml = f"""
<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis"
       xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="en-US">
    <voice name="{voice_name}">
        <mstts:express-as style="{style}">
            {text}
        </mstts:express-as>
    </voice>
</speak>"""
        speech_config.speech_synthesis_ssml = ssml
    else:
        speech_config.speech_synthesis_voice_name = voice_name

    synthesizer = speechsdk.SpeechSynthesizer(
        speech_config=speech_config,
        audio_config=None  # Get raw audio
    )

    result = synthesizer.speak_text_async(text).get()

    if result.reason == speechsdk.ResultReason.SynthesizingAudioCompleted:
        return result.audio_data
    else:
        raise Exception(f"Speech synthesis failed: {result.reason}")

# Speech-to-text with new models
def speech_to_text_continuous(audio_file: str) -> list:
    """Continuous speech recognition with improved accuracy."""

    speech_config = speechsdk.SpeechConfig(
        subscription="your-key",
        region="your-region"
    )

    # Enable new features
    speech_config.set_property(
        speechsdk.PropertyId.Speech_SegmentationSilenceTimeoutMs, "1000"
    )

    audio_config = speechsdk.AudioConfig(filename=audio_file)

    recognizer = speechsdk.SpeechRecognizer(
        speech_config=speech_config,
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

    recognizer.recognized.connect(handle_result)
    recognizer.start_continuous_recognition()

    import time
    time.sleep(60)  # Process audio

    recognizer.stop_continuous_recognition()
    return results
```

## Language Services Updates

```python
from azure.ai.textanalytics import TextAnalyticsClient
from azure.core.credentials import AzureKeyCredential

# New unified Text Analytics client
text_client = TextAnalyticsClient(
    endpoint="https://your-resource.cognitiveservices.azure.com/",
    credential=AzureKeyCredential("your-key")
)

# New conversational language understanding
def analyze_conversation(messages: list) -> dict:
    """Analyze conversation with new CLU."""
    from azure.ai.language.conversations import ConversationAnalysisClient

    client = ConversationAnalysisClient(
        endpoint="https://your-resource.cognitiveservices.azure.com/",
        credential=AzureKeyCredential("your-key")
    )

    result = client.analyze_conversation(
        task={
            "kind": "Conversation",
            "analysisInput": {
                "conversationItem": {
                    "participantId": "user",
                    "id": "1",
                    "text": messages[-1]
                }
            },
            "parameters": {
                "projectName": "your-project",
                "deploymentName": "your-deployment"
            }
        }
    )

    return {
        "intent": result.result.prediction.top_intent,
        "confidence": result.result.prediction.intents[0].confidence,
        "entities": [
            {"category": e.category, "text": e.text}
            for e in result.result.prediction.entities
        ]
    }

# PII detection improvements
def detect_pii_enhanced(text: str) -> dict:
    """Detect PII with enhanced categories."""
    result = text_client.recognize_pii_entities(
        documents=[text],
        categories_filter=[
            "PhoneNumber", "Email", "Address",
            "CreditCardNumber", "IPAddress",
            "InternationalBankingAccountNumber",
            "SocialSecurityNumber"
        ]
    )[0]

    return {
        "redacted_text": result.redacted_text,
        "entities": [
            {
                "text": e.text,
                "category": e.category,
                "confidence": e.confidence_score,
                "offset": e.offset
            }
            for e in result.entities
        ]
    }
```

## Decision Services Updates

```python
# Personalizer updates
from azure.cognitiveservices.personalizer import PersonalizerClient

def rank_with_personalizer(
    context: dict,
    actions: list
) -> dict:
    """Rank actions using Personalizer."""
    personalizer_client = PersonalizerClient(
        endpoint="https://your-personalizer.cognitiveservices.azure.com/",
        credential=CognitiveServicesCredentials("your-key")
    )

    rank_request = {
        "contextFeatures": [context],
        "actions": [
            {"id": a["id"], "features": [a["features"]]}
            for a in actions
        ],
        "excludedActions": [],
        "eventId": str(uuid.uuid4()),
        "deferActivation": False
    }

    response = personalizer_client.rank(rank_request)

    return {
        "event_id": rank_request["eventId"],
        "recommended_action": response.reward_action_id,
        "ranking": [
            {"id": r.id, "probability": r.probability}
            for r in response.ranking
        ]
    }

# Content Moderator updates
from azure.cognitiveservices.contentmoderator import ContentModeratorClient

def moderate_content_enhanced(text: str) -> dict:
    """Enhanced content moderation."""
    moderator_client = ContentModeratorClient(
        endpoint="https://your-moderator.cognitiveservices.azure.com/",
        credentials=CognitiveServicesCredentials("your-key")
    )

    # Text moderation with classification
    screen_result = moderator_client.text_moderation.screen_text(
        text_content_type="text/plain",
        text_content=text,
        language="eng",
        autocorrect=True,
        pii=True,
        classify=True
    )

    return {
        "classification": {
            "category1": screen_result.classification.category1.score,
            "category2": screen_result.classification.category2.score,
            "category3": screen_result.classification.category3.score
        },
        "pii": screen_result.pii,
        "terms": screen_result.terms,
        "autocorrected": screen_result.autocorrected_text
    }
```

## Multi-Service Solutions

```python
class CognitiveServicesHub:
    """Unified access to multiple Cognitive Services."""

    def __init__(self, endpoint: str, key: str):
        self.credential = AzureKeyCredential(key)
        self.endpoint = endpoint

    async def process_document_complete(self, document_url: str) -> dict:
        """Process document with multiple services."""
        results = {}

        # Extract text with Form Recognizer
        from azure.ai.formrecognizer import DocumentAnalysisClient
        doc_client = DocumentAnalysisClient(self.endpoint, self.credential)

        poller = doc_client.begin_analyze_document_from_url(
            "prebuilt-read", document_url
        )
        doc_result = poller.result()

        text_content = ""
        for page in doc_result.pages:
            for line in page.lines:
                text_content += line.content + "\n"

        results["extracted_text"] = text_content

        # Analyze text with Text Analytics
        text_client = TextAnalyticsClient(self.endpoint, self.credential)

        # Get key phrases
        key_phrases = text_client.extract_key_phrases([text_content])[0]
        results["key_phrases"] = key_phrases.key_phrases

        # Get sentiment
        sentiment = text_client.analyze_sentiment([text_content])[0]
        results["sentiment"] = sentiment.sentiment

        # Detect language
        language = text_client.detect_language([text_content])[0]
        results["language"] = language.primary_language.iso6391_name

        # Detect PII
        pii = text_client.recognize_pii_entities([text_content])[0]
        results["pii_detected"] = len(pii.entities) > 0

        return results
```

## What's Coming

- GPT-4 integration in Azure OpenAI
- More neural voice options
- Enhanced document understanding
- Improved multi-modal capabilities

## Resources

- [What's New in Azure AI](https://learn.microsoft.com/azure/cognitive-services/whats-new)
- [Azure AI Services Documentation](https://learn.microsoft.com/azure/cognitive-services/)
- [Azure AI Blog](https://techcommunity.microsoft.com/t5/azure-ai/bg-p/AzureAIBlog)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
