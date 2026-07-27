---
title: "Azure Cognitive Services: Building Intelligent Applications"
author: Michael John Peña
draft: false
date: 2021-05-05
tags:
  - Azure
  - AI
  - Cognitive Services
  - Machine Learning
  - NLP
---

Cognitive Services in mid-2021 is a sprawling catalogue—vision, speech, language, decision—that can be disorienting to navigate. Today's post is the practical guide I wish I'd had when I first started wiring Cognitive Services into production applications: which services do what, which ones compose well together, the SDK patterns that actually work in production, and the cost management decisions that prevent surprises on the bill. The Azure OpenAI Service preview is on the horizon but not yet generally available—this post covers the current production catalogue, not the preview.

## Why Azure Cognitive Services?

Instead of training custom models from scratch, Cognitive Services offers:
- **Pre-trained models** - Ready to use immediately
- **API-first design** - Simple REST APIs and SDKs
- **Enterprise security** - Azure compliance and data protection
- **Scalability** - Handle production workloads
- **Continuous improvement** - Microsoft updates models regularly

## Service Categories

### Vision

```python
from azure.cognitiveservices.vision.computervision import ComputerVisionClient
from msrest.authentication import CognitiveServicesCredentials

# Initialize client
credentials = CognitiveServicesCredentials(subscription_key)
client = ComputerVisionClient(endpoint, credentials)

# Analyze image
analysis = client.analyze_image(
    image_url,
    visual_features=['Categories', 'Description', 'Tags', 'Objects', 'Faces']
)

print(f"Description: {analysis.description.captions[0].text}")
print(f"Tags: {[tag.name for tag in analysis.tags]}")

# OCR - Extract text from images
ocr_result = client.read(image_url, raw=True)
operation_location = ocr_result.headers["Operation-Location"]
operation_id = operation_location.split("/")[-1]

# Wait for result
import time
while True:
    result = client.get_read_result(operation_id)
    if result.status not in ['notStarted', 'running']:
        break
    time.sleep(1)

# Extract text
for page in result.analyze_result.read_results:
    for line in page.lines:
        print(line.text)
```

### Language

```python
from azure.ai.textanalytics import TextAnalyticsClient
from azure.core.credentials import AzureKeyCredential

# Initialize client
client = TextAnalyticsClient(
    endpoint=endpoint,
    credential=AzureKeyCredential(key)
)

# Sentiment Analysis
documents = [
    "The product quality is excellent and the customer service was amazing!",
    "Disappointed with the delivery time. Very slow shipping.",
    "It's an okay product. Nothing special."
]

response = client.analyze_sentiment(documents)
for doc in response:
    print(f"Sentiment: {doc.sentiment}")
    print(f"Scores - Positive: {doc.confidence_scores.positive:.2f}, "
          f"Neutral: {doc.confidence_scores.neutral:.2f}, "
          f"Negative: {doc.confidence_scores.negative:.2f}")

# Entity Recognition
response = client.recognize_entities(documents)
for doc in response:
    for entity in doc.entities:
        print(f"Entity: {entity.text}, Category: {entity.category}, "
              f"Confidence: {entity.confidence_score:.2f}")

# Key Phrase Extraction
response = client.extract_key_phrases(documents)
for doc in response:
    print(f"Key phrases: {doc.key_phrases}")
```

### Speech

```python
import azure.cognitiveservices.speech as speechsdk

# Speech-to-Text
speech_config = speechsdk.SpeechConfig(
    subscription=speech_key,
    region=service_region
)
audio_config = speechsdk.audio.AudioConfig(filename="audio.wav")
speech_recognizer = speechsdk.SpeechRecognizer(
    speech_config=speech_config,
    audio_config=audio_config
)

result = speech_recognizer.recognize_once()
if result.reason == speechsdk.ResultReason.RecognizedSpeech:
    print(f"Recognized: {result.text}")

# Text-to-Speech
speech_config.speech_synthesis_voice_name = "en-US-JennyNeural"
synthesizer = speechsdk.SpeechSynthesizer(speech_config=speech_config)

result = synthesizer.speak_text_async("Hello, this is Azure Speech Service.").get()
if result.reason == speechsdk.ResultReason.SynthesizingAudioCompleted:
    print("Speech synthesized successfully")

# Real-time transcription
def recognized_callback(evt):
    print(f"Recognized: {evt.result.text}")

speech_recognizer.recognized.connect(recognized_callback)
speech_recognizer.start_continuous_recognition()
```

### Translator

```python
import requests
import uuid

# Translate text
def translate_text(text, target_languages):
    path = '/translate'
    url = f"https://api.cognitive.microsofttranslator.com{path}"

    params = {
        'api-version': '3.0',
        'to': target_languages
    }

    headers = {
        'Ocp-Apim-Subscription-Key': translator_key,
        'Ocp-Apim-Subscription-Region': service_region,
        'Content-type': 'application/json',
        'X-ClientTraceId': str(uuid.uuid4())
    }

    body = [{'text': text}]

    response = requests.post(url, params=params, headers=headers, json=body)
    return response.json()

# Usage
result = translate_text(
    "Hello, how are you today?",
    ['es', 'fr', 'de', 'ja']
)

for translation in result[0]['translations']:
    print(f"{translation['to']}: {translation['text']}")

# Detect language
def detect_language(text):
    path = '/detect'
    url = f"https://api.cognitive.microsofttranslator.com{path}"

    params = {'api-version': '3.0'}
    headers = {
        'Ocp-Apim-Subscription-Key': translator_key,
        'Content-type': 'application/json'
    }
    body = [{'text': text}]

    response = requests.post(url, params=params, headers=headers, json=body)
    return response.json()

detected = detect_language("Bonjour, comment allez-vous?")
print(f"Language: {detected[0]['language']}, Confidence: {detected[0]['score']}")
```

### Form Recognizer

```python
from azure.ai.formrecognizer import DocumentAnalysisClient
from azure.core.credentials import AzureKeyCredential

# Initialize client
client = DocumentAnalysisClient(
    endpoint=endpoint,
    credential=AzureKeyCredential(key)
)

# Analyze invoice
with open("invoice.pdf", "rb") as f:
    poller = client.begin_analyze_document("prebuilt-invoice", f)

result = poller.result()

for document in result.documents:
    print(f"Invoice number: {document.fields.get('InvoiceId').value}")
    print(f"Vendor: {document.fields.get('VendorName').value}")
    print(f"Total: {document.fields.get('InvoiceTotal').value}")

# Analyze receipts
with open("receipt.jpg", "rb") as f:
    poller = client.begin_analyze_document("prebuilt-receipt", f)

result = poller.result()
for document in result.documents:
    print(f"Merchant: {document.fields.get('MerchantName').value}")
    print(f"Total: {document.fields.get('Total').value}")
```

## Building a Document Intelligence Solution

Combine multiple services for a complete solution:

```python
from azure.ai.formrecognizer import DocumentAnalysisClient
from azure.ai.textanalytics import TextAnalyticsClient
from azure.cognitiveservices.vision.computervision import ComputerVisionClient
import json

class DocumentProcessor:
    def __init__(self, config):
        self.form_client = DocumentAnalysisClient(
            config['form_endpoint'],
            AzureKeyCredential(config['form_key'])
        )
        self.text_client = TextAnalyticsClient(
            config['text_endpoint'],
            AzureKeyCredential(config['text_key'])
        )

    def process_document(self, document_path):
        """Process a document through multiple cognitive services."""
        results = {}

        # Extract text and structure with Form Recognizer
        with open(document_path, "rb") as f:
            poller = self.form_client.begin_analyze_document(
                "prebuilt-document", f
            )
        form_result = poller.result()

        # Extract all text
        full_text = " ".join([
            page.content for page in form_result.pages
        ])
        results['extracted_text'] = full_text

        # Analyze sentiment
        sentiment = self.text_client.analyze_sentiment([full_text])[0]
        results['sentiment'] = {
            'overall': sentiment.sentiment,
            'scores': {
                'positive': sentiment.confidence_scores.positive,
                'neutral': sentiment.confidence_scores.neutral,
                'negative': sentiment.confidence_scores.negative
            }
        }

        # Extract entities
        entities = self.text_client.recognize_entities([full_text])[0]
        results['entities'] = [
            {
                'text': e.text,
                'category': e.category,
                'confidence': e.confidence_score
            }
            for e in entities.entities
        ]

        # Extract key phrases
        key_phrases = self.text_client.extract_key_phrases([full_text])[0]
        results['key_phrases'] = key_phrases.key_phrases

        return results

# Usage
config = {
    'form_endpoint': os.environ['FORM_ENDPOINT'],
    'form_key': os.environ['FORM_KEY'],
    'text_endpoint': os.environ['TEXT_ENDPOINT'],
    'text_key': os.environ['TEXT_KEY']
}

processor = DocumentProcessor(config)
results = processor.process_document("contract.pdf")

print(json.dumps(results, indent=2))
```

## Deploying to Azure Functions

```python
import azure.functions as func
from azure.ai.textanalytics import TextAnalyticsClient
from azure.core.credentials import AzureKeyCredential
import json
import os

# Initialize client
client = TextAnalyticsClient(
    endpoint=os.environ['TEXT_ANALYTICS_ENDPOINT'],
    credential=AzureKeyCredential(os.environ['TEXT_ANALYTICS_KEY'])
)

def main(req: func.HttpRequest) -> func.HttpResponse:
    try:
        body = req.get_json()
        text = body.get('text')

        if not text:
            return func.HttpResponse(
                json.dumps({'error': 'Text is required'}),
                status_code=400
            )

        # Analyze text
        sentiment = client.analyze_sentiment([text])[0]
        entities = client.recognize_entities([text])[0]
        key_phrases = client.extract_key_phrases([text])[0]

        result = {
            'sentiment': sentiment.sentiment,
            'confidence': {
                'positive': sentiment.confidence_scores.positive,
                'negative': sentiment.confidence_scores.negative,
                'neutral': sentiment.confidence_scores.neutral
            },
            'entities': [
                {'text': e.text, 'category': e.category}
                for e in entities.entities
            ],
            'key_phrases': key_phrases.key_phrases
        }

        return func.HttpResponse(
            json.dumps(result),
            mimetype='application/json'
        )

    except Exception as e:
        return func.HttpResponse(
            json.dumps({'error': str(e)}),
            status_code=500
        )
```

## Best Practices

1. **Handle rate limits** - Implement retry logic with exponential backoff
2. **Batch requests** - Process multiple documents in single API calls
3. **Cache results** - Store analysis results to avoid redundant calls
4. **Monitor costs** - Use Azure Cost Management to track usage
5. **Secure credentials** - Use Azure Key Vault for API keys

## Cost Optimization

| Tip | Benefit |
|-----|---------|
| Use free tier for dev | 5,000 transactions/month free |
| Batch processing | Reduce number of API calls |
| Choose right tier | Match capacity to workload |
| Cache results | Avoid duplicate processing |

## Conclusion

Azure Cognitive Services enables developers to add sophisticated AI capabilities without deep machine learning expertise. The pre-built models handle common scenarios effectively, while custom training options allow for domain-specific optimization. Combined with Azure's infrastructure, you can build scalable, intelligent applications.

## Resources

- [Azure Cognitive Services Documentation](https://docs.microsoft.com/en-us/azure/cognitive-services/)
- [Text Analytics SDK](https://docs.microsoft.com/en-us/azure/cognitive-services/text-analytics/)
- [Form Recognizer Documentation](https://docs.microsoft.com/en-us/azure/cognitive-services/form-recognizer/)
