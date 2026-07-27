---
title: "Azure Cognitive Services Updates: OpenAI Integration and More"
author: Michael John Peña
draft: false
date: 2022-11-15
tags:
  - Azure
  - Cognitive Services
  - AI
  - OpenAI
  - Vision

---

I wrote "Azure Cognitive Services Updates: OpenAI Integration and More" to share practical, production-minded guidance on this topic.

## Azure OpenAI Integration

Cognitive Services now includes Azure OpenAI Service, bringing GPT models into the Cognitive Services family:

```python
from azure.ai.openai import OpenAIClient
from azure.identity import DefaultAzureCredential

# Unified authentication with Cognitive Services
client = OpenAIClient(
    endpoint="https://your-resource.openai.azure.com/",
    credential=DefaultAzureCredential()
)

response = client.completions.create(
    deployment="gpt-35-turbo",
    prompt="Explain Azure Cognitive Services in one paragraph:",
    max_tokens=200
)

print(response.choices[0].text)
```

## Vision API Updates

### Image Analysis 4.0

The new Image Analysis API includes enhanced capabilities:

```python
from azure.ai.vision.imageanalysis import ImageAnalysisClient
from azure.ai.vision.imageanalysis.models import VisualFeatures
from azure.core.credentials import AzureKeyCredential

client = ImageAnalysisClient(
    endpoint="https://your-vision.cognitiveservices.azure.com/",
    credential=AzureKeyCredential("your-key")
)

# Analyze with all visual features
result = client.analyze(
    image_url="https://example.com/image.jpg",
    visual_features=[
        VisualFeatures.CAPTION,
        VisualFeatures.DENSE_CAPTIONS,
        VisualFeatures.OBJECTS,
        VisualFeatures.TAGS,
        VisualFeatures.READ,
        VisualFeatures.SMART_CROPS,
        VisualFeatures.PEOPLE
    ],
    gender_neutral_caption=True,
    smart_crops_aspect_ratios=[0.9, 1.33]
)

# Get detailed caption
print(f"Caption: {result.caption.text} (confidence: {result.caption.confidence:.2f})")

# Get dense captions for different regions
for caption in result.dense_captions.values:
    print(f"Region [{caption.bounding_box}]: {caption.text}")

# Detect people
for person in result.people.values:
    print(f"Person at {person.bounding_box}, confidence: {person.confidence:.2f}")
```

### Custom Vision Improvements

```python
from azure.cognitiveservices.vision.customvision.training import CustomVisionTrainingClient
from azure.cognitiveservices.vision.customvision.prediction import CustomVisionPredictionClient

# Train a custom model
training_client = CustomVisionTrainingClient(
    endpoint="https://your-customvision.cognitiveservices.azure.com/",
    credentials=ApiKeyCredentials(in_headers={"Training-key": training_key})
)

# Create project with new domain
project = training_client.create_project(
    "Product Classification",
    domain_id="general-compact-s1",  # New compact domain
    classification_type="Multilabel"
)

# Upload images with tags
for image_path, tags in training_data:
    with open(image_path, "rb") as image_file:
        training_client.create_images_from_data(
            project.id,
            image_file.read(),
            tag_ids=tags
        )

# Train iteration
iteration = training_client.train_project(
    project.id,
    training_type="Advanced",  # New advanced training
    reserved_budget_in_hours=2
)
```

## Language Service Updates

### Question Answering with GPT

Combine custom question answering with GPT for better responses:

```python
from azure.ai.language.questionanswering import QuestionAnsweringClient

qa_client = QuestionAnsweringClient(
    endpoint="https://your-language.cognitiveservices.azure.com/",
    credential=AzureKeyCredential("your-key")
)

def enhanced_qa(question: str, project_name: str) -> dict:
    """Get answer from QA and enhance with GPT."""

    # First, get answer from custom knowledge base
    qa_response = qa_client.get_answers(
        question=question,
        project_name=project_name,
        deployment_name="production"
    )

    if qa_response.answers and qa_response.answers[0].confidence > 0.7:
        base_answer = qa_response.answers[0].answer
    else:
        base_answer = "I don't have specific information about that."

    # Enhance with GPT
    enhanced_prompt = f"""Based on this knowledge base answer:
"{base_answer}"

Provide a helpful, conversational response to: {question}

Response:"""

    gpt_response = openai.Completion.create(
        engine="text-davinci-003",
        prompt=enhanced_prompt,
        max_tokens=200
    )

    return {
        "original_answer": base_answer,
        "enhanced_answer": gpt_response.choices[0].text.strip(),
        "confidence": qa_response.answers[0].confidence if qa_response.answers else 0
    }
```

### Conversational Language Understanding (CLU)

```python
from azure.ai.language.conversations import ConversationAnalysisClient

clu_client = ConversationAnalysisClient(
    endpoint="https://your-language.cognitiveservices.azure.com/",
    credential=AzureKeyCredential("your-key")
)

def understand_conversation(user_input: str) -> dict:
    """Analyze user intent and entities."""

    result = clu_client.analyze_conversation(
        task={
            "kind": "Conversation",
            "analysisInput": {
                "conversationItem": {
                    "id": "1",
                    "participantId": "user1",
                    "text": user_input
                }
            },
            "parameters": {
                "projectName": "customer-service",
                "deploymentName": "production"
            }
        }
    )

    prediction = result["result"]["prediction"]

    return {
        "top_intent": prediction["topIntent"],
        "confidence": prediction["intents"][0]["confidenceScore"],
        "entities": [
            {
                "category": e["category"],
                "text": e["text"],
                "confidence": e["confidenceScore"]
            }
            for e in prediction.get("entities", [])
        ]
    }

# Example
result = understand_conversation("Book a flight from Seattle to New York next Monday")
print(f"Intent: {result['top_intent']}")
print(f"Entities: {result['entities']}")
```

## Speech Service Updates

### Neural Voice Customization

```python
from azure.cognitiveservices.speech import SpeechConfig, SpeechSynthesizer
from azure.cognitiveservices.speech.audio import AudioOutputConfig

speech_config = SpeechConfig(
    subscription="your-key",
    region="eastus"
)

# Use custom neural voice
speech_config.speech_synthesis_voice_name = "your-custom-neural-voice"

synthesizer = SpeechSynthesizer(
    speech_config=speech_config,
    audio_config=AudioOutputConfig(filename="output.wav")
)

# SSML for fine control
ssml = """
<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis"
       xmlns:mstts="http://www.w3.org/2001/mstts" xml:lang="en-US">
    <voice name="your-custom-neural-voice">
        <mstts:express-as style="customerservice" styledegree="2">
            Welcome to Azure support! How can I help you today?
        </mstts:express-as>
    </voice>
</speak>
"""

result = synthesizer.speak_ssml_async(ssml).get()
```

### Real-time Speech Translation

```python
import azure.cognitiveservices.speech as speechsdk

def setup_translation(source_lang: str, target_langs: list) -> speechsdk.translation.TranslationRecognizer:
    """Set up real-time speech translation."""

    translation_config = speechsdk.translation.SpeechTranslationConfig(
        subscription="your-key",
        region="eastus"
    )

    translation_config.speech_recognition_language = source_lang

    for lang in target_langs:
        translation_config.add_target_language(lang)

    # Enable voice output for first target language
    translation_config.voice_name = "de-DE-KatjaNeural"

    recognizer = speechsdk.translation.TranslationRecognizer(
        translation_config=translation_config
    )

    return recognizer

def on_recognized(evt):
    """Handle recognized speech."""
    if evt.result.reason == speechsdk.ResultReason.TranslatedSpeech:
        print(f"Original: {evt.result.text}")
        for lang, translation in evt.result.translations.items():
            print(f"{lang}: {translation}")

# Usage
recognizer = setup_translation("en-US", ["de", "fr", "es"])
recognizer.recognized.connect(on_recognized)
recognizer.start_continuous_recognition()
```

## Form Recognizer Updates

```python
from azure.ai.formrecognizer import DocumentAnalysisClient

form_client = DocumentAnalysisClient(
    endpoint="https://your-formrecognizer.cognitiveservices.azure.com/",
    credential=AzureKeyCredential("your-key")
)

# Analyze with new prebuilt models
with open("invoice.pdf", "rb") as f:
    poller = form_client.begin_analyze_document(
        "prebuilt-invoice",  # New enhanced invoice model
        f
    )

result = poller.result()

for document in result.documents:
    print(f"Document type: {document.doc_type}")

    # Extract structured fields
    vendor = document.fields.get("VendorName")
    if vendor:
        print(f"Vendor: {vendor.value} (confidence: {vendor.confidence:.2f})")

    total = document.fields.get("InvoiceTotal")
    if total:
        print(f"Total: {total.value} (confidence: {total.confidence:.2f})")

    # Extract line items
    items = document.fields.get("Items")
    if items:
        for item in items.value:
            desc = item.value.get("Description")
            amount = item.value.get("Amount")
            print(f"  - {desc.value}: {amount.value}")
```

## Unified Multi-service Deployment

```bicep
// Deploy multiple Cognitive Services with unified key
resource cognitiveServices 'Microsoft.CognitiveServices/accounts@2022-12-01' = {
  name: 'cognitive-multi-service'
  location: location
  sku: {
    name: 'S0'
  }
  kind: 'CognitiveServices'  // Multi-service account
  properties: {
    customSubDomainName: 'my-cognitive-services'
    networkAcls: {
      defaultAction: 'Deny'
      virtualNetworkRules: [
        {
          id: subnetId
        }
      ]
    }
    publicNetworkAccess: 'Disabled'
  }
}

// Private endpoint
resource privateEndpoint 'Microsoft.Network/privateEndpoints@2021-05-01' = {
  name: 'pe-cognitive'
  location: location
  properties: {
    subnet: {
      id: subnetId
    }
    privateLinkServiceConnections: [
      {
        name: 'cognitive-connection'
        properties: {
          privateLinkServiceId: cognitiveServices.id
          groupIds: [
            'account'
          ]
        }
      }
    ]
  }
}
```

## Conclusion

Azure Cognitive Services is becoming more powerful with OpenAI integration while maintaining the familiar, easy-to-use APIs. The improvements across vision, language, and speech services, combined with better enterprise features, make it an excellent choice for adding AI capabilities to applications.

## Resources

- [Azure Cognitive Services Documentation](https://learn.microsoft.com/en-us/azure/cognitive-services/)
- [Azure OpenAI Service](https://learn.microsoft.com/en-us/azure/cognitive-services/openai/)
- [Vision API Reference](https://learn.microsoft.com/en-us/azure/cognitive-services/computer-vision/)
- [Language Service](https://learn.microsoft.com/en-us/azure/cognitive-services/language-service/)

