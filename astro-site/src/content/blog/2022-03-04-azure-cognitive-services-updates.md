---
title: "Azure Cognitive Services Updates: What's New in Early 2022"
author: Michael John Peña
draft: false
date: 2022-03-04
tags:
  - Azure
  - Cognitive Services
  - AI
  - Machine Learning
---

## Vision Services Enhancements

### Computer Vision 4.0 Preview

The new Computer Vision API brings significant improvements:

```python
from azure.cognitiveservices.vision.computervision import ComputerVisionClient
from msrest.authentication import CognitiveServicesCredentials
import os

client = ComputerVisionClient(
    os.environ["COMPUTER_VISION_ENDPOINT"],
    CognitiveServicesCredentials(os.environ["COMPUTER_VISION_KEY"])
)

# New: Enhanced image analysis with unified API
analysis = client.analyze_image(
    url="https://example.com/image.jpg",
    visual_features=[
        "Categories", "Description", "Faces", "Objects",
        "Tags", "Color", "ImageType", "Brands", "Adult"
    ],
    details=["Celebrities", "Landmarks"],
    language="en"
)

# Enhanced object detection with bounding boxes
for obj in analysis.objects:
    print(f"Object: {obj.object_property}")
    print(f"Confidence: {obj.confidence:.2%}")
    print(f"Bounding box: {obj.rectangle}")
```

### Spatial Analysis (General Availability)

Analyze people movement in physical spaces:

```json
{
  "ai_insights": [
    {
      "type": "cognitiveservices.vision.spatialanalysis-personcrossingline",
      "configuration": {
        "lines": [
          {
            "name": "entrance",
            "line": {"x1": 0.1, "y1": 0.5, "x2": 0.9, "y2": 0.5},
            "events": [
              {
                "type": "lineCrossing",
                "config": {
                  "trigger": "event",
                  "output_frequency": 1
                }
              }
            ]
          }
        ]
      }
    }
  ]
}
```

## Language Services Updates

### Question Answering (Replacing QnA Maker)

The new unified Language service includes enhanced question answering:

```python
from azure.ai.language.questionanswering import QuestionAnsweringClient
from azure.core.credentials import AzureKeyCredential

client = QuestionAnsweringClient(
    endpoint=os.environ["LANGUAGE_ENDPOINT"],
    credential=AzureKeyCredential(os.environ["LANGUAGE_KEY"])
)

# Query a knowledge base
output = client.get_answers(
    project_name="my-knowledge-base",
    deployment_name="production",
    question="How do I reset my password?",
    top=3,
    confidence_threshold=0.5
)

for answer in output.answers:
    print(f"Answer: {answer.answer}")
    print(f"Confidence: {answer.confidence:.2%}")
    print(f"Source: {answer.source}")
```

### Custom Named Entity Recognition

Train custom NER models for domain-specific entities:

```python
from azure.ai.language.conversations import ConversationAnalysisClient

client = ConversationAnalysisClient(
    endpoint=os.environ["LANGUAGE_ENDPOINT"],
    credential=AzureKeyCredential(os.environ["LANGUAGE_KEY"])
)

# Custom NER for medical documents
result = client.analyze_conversation(
    task={
        "kind": "CustomEntityRecognition",
        "analysisInput": {
            "conversationItem": {
                "text": "Patient diagnosed with Type 2 diabetes, prescribed Metformin 500mg twice daily.",
                "id": "1",
                "participantId": "1"
            }
        },
        "parameters": {
            "projectName": "medical-ner",
            "deploymentName": "production"
        }
    }
)

for entity in result["result"]["prediction"]["entities"]:
    print(f"{entity['category']}: {entity['text']}")
```

## Speech Services

### Neural Text-to-Speech Improvements

New voices and SSML capabilities:

```python
import azure.cognitiveservices.speech as speechsdk

speech_config = speechsdk.SpeechConfig(
    subscription=os.environ["SPEECH_KEY"],
    region=os.environ["SPEECH_REGION"]
)

# Use new neural voices
speech_config.speech_synthesis_voice_name = "en-US-JennyNeural"

synthesizer = speechsdk.SpeechSynthesizer(speech_config=speech_config)

# Advanced SSML with expression styles
ssml = """
<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis"
       xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="en-US">
    <voice name="en-US-JennyNeural">
        <mstts:express-as style="cheerful" styledegree="2">
            Great news! Your order has been shipped!
        </mstts:express-as>
        <break time="500ms"/>
        <mstts:express-as style="empathetic">
            We apologize for any inconvenience caused by the delay.
        </mstts:express-as>
    </voice>
</speak>
"""

result = synthesizer.speak_ssml_async(ssml).get()
```

### Real-time Speech Translation

Improved accuracy and lower latency:

```python
import azure.cognitiveservices.speech as speechsdk

translation_config = speechsdk.translation.SpeechTranslationConfig(
    subscription=os.environ["SPEECH_KEY"],
    region=os.environ["SPEECH_REGION"]
)

translation_config.speech_recognition_language = "en-US"
translation_config.add_target_language("es")
translation_config.add_target_language("fr")
translation_config.add_target_language("de")

# Voice output for Spanish
translation_config.voice_name = "es-ES-ElviraNeural"

recognizer = speechsdk.translation.TranslationRecognizer(
    translation_config=translation_config
)

def handle_translation(evt):
    result = evt.result
    print(f"Recognized: {result.text}")
    for lang, translation in result.translations.items():
        print(f"  {lang}: {translation}")

recognizer.recognized.connect(handle_translation)
recognizer.start_continuous_recognition()
```

## Decision Services

### Personalizer Updates

Enhanced reinforcement learning with offline evaluation:

```python
from azure.cognitiveservices.personalizer import PersonalizerClient
from azure.cognitiveservices.personalizer.models import RankRequest, RankableAction

client = PersonalizerClient(
    os.environ["PERSONALIZER_ENDPOINT"],
    CognitiveServicesCredentials(os.environ["PERSONALIZER_KEY"])
)

# Define actions with features
actions = [
    RankableAction(id="article1", features=[
        {"topic": "technology", "length": "short", "hasVideo": True}
    ]),
    RankableAction(id="article2", features=[
        {"topic": "sports", "length": "long", "hasVideo": False}
    ]),
    RankableAction(id="article3", features=[
        {"topic": "technology", "length": "medium", "hasVideo": True}
    ])
]

# Context features about the user and situation
context = [
    {"userAge": "30-40", "userInterests": ["technology", "gaming"]},
    {"device": "mobile", "timeOfDay": "morning", "dayOfWeek": "monday"}
]

# Get personalized ranking
request = RankRequest(
    actions=actions,
    context_features=context,
    excluded_actions=["article2"],  # Exclude already seen
    event_id="event123"
)

response = client.rank(request)
print(f"Recommended: {response.reward_action_id}")

# Later: Send reward based on user engagement
client.reward("event123", value=1.0)  # User clicked/engaged
```

### Anomaly Detector Multivariate

Detect anomalies across multiple correlated metrics:

```python
from azure.ai.anomalydetector import AnomalyDetectorClient
from azure.core.credentials import AzureKeyCredential

client = AnomalyDetectorClient(
    endpoint=os.environ["ANOMALY_DETECTOR_ENDPOINT"],
    credential=AzureKeyCredential(os.environ["ANOMALY_DETECTOR_KEY"])
)

# Train multivariate model
model_request = {
    "dataSource": "https://storage.blob.core.windows.net/data/training.csv",
    "dataSchema": "OneTable",
    "startTime": "2022-01-01T00:00:00Z",
    "endTime": "2022-02-28T23:59:59Z",
    "displayName": "MultiMetricModel",
    "slidingWindow": 200,
    "alignPolicy": {
        "alignMode": "Outer",
        "fillNAMethod": "Linear"
    }
}

model = client.train_multivariate_model(model_request)

# Detect anomalies
detection_request = {
    "dataSource": "https://storage.blob.core.windows.net/data/inference.csv",
    "startTime": "2022-03-01T00:00:00Z",
    "endTime": "2022-03-04T00:00:00Z"
}

result = client.detect_multivariate_anomaly(model.model_id, detection_request)
```

## New: Responsible AI Dashboard

Track model fairness and interpretability:

```python
# Integration with Azure Machine Learning
from azureml.core import Workspace
from azureml.responsibleai import RAIInsights

ws = Workspace.from_config()

# Create RAI insights
rai_insights = RAIInsights(
    model=model,
    train=train_data,
    test=test_data,
    target_column="label",
    task_type="classification"
)

# Add components
rai_insights.explainer.add()
rai_insights.error_analysis.add()
rai_insights.fairness.add(sensitive_features=["gender", "age"])

# Compute insights
rai_insights.compute()

# View in Azure ML Studio
rai_insights.upload_to_workspace(ws)
```

## Regional Availability

New regions now support Cognitive Services:

| Service | New Regions |
|---------|-------------|
| Vision | UAE North, South Africa North |
| Language | Norway East, Sweden Central |
| Speech | Qatar Central, Poland Central |
| Decision | Switzerland West, Germany North |

## Pricing Updates

Several services now offer commitment tiers for cost savings:

```bash
# Create commitment tier
az cognitiveservices commitment-tier create \
    --name "my-language-commitment" \
    --resource-group myRG \
    --kind TextAnalytics \
    --sku "S" \
    --commitment-plan-id "monthly-1M" \
    --current-period-start "2022-03-01"
```

Commitment tiers provide:
- Up to 40% discount for predictable workloads
- Monthly or annual commitments
- Overage charges at standard rates

## Migration Considerations

### QnA Maker to Language Service

```python
# Old QnA Maker approach
from azure.cognitiveservices.knowledge.qnamaker import QnAMakerClient

# New Language Service approach
from azure.ai.language.questionanswering import QuestionAnsweringClient

# Migration steps:
# 1. Export knowledge base from QnA Maker
# 2. Create new Language resource
# 3. Import knowledge base to Language Question Answering
# 4. Update application code to use new SDK
```

### LUIS to CLU (Conversational Language Understanding)

```python
# Old LUIS approach
from azure.cognitiveservices.language.luis.runtime import LUISRuntimeClient

# New CLU approach
from azure.ai.language.conversations import ConversationAnalysisClient

# CLU provides:
# - Unified authoring experience
# - Better integration with other Language features
# - Improved intent classification accuracy
```

## Conclusion

Azure Cognitive Services in early 2022 represents a mature, enterprise-ready AI platform. The consolidation under the Language service umbrella, improved neural models, and responsible AI tooling show Microsoft's commitment to making AI accessible and trustworthy.

Key takeaways:
1. Migrate from QnA Maker and LUIS to the unified Language service
2. Leverage new neural voices and expression styles
3. Consider commitment tiers for cost optimization
4. Use the Responsible AI dashboard for governance

## Resources

- [Azure Cognitive Services Documentation](https://docs.microsoft.com/en-us/azure/cognitive-services/)
- [What's New in Cognitive Services](https://docs.microsoft.com/en-us/azure/cognitive-services/whats-new)
- [Cognitive Services Pricing](https://azure.microsoft.com/en-us/pricing/details/cognitive-services/)
