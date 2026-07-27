---
title: Running Azure Cognitive Services in Containers
author: Michael John Pena
draft: false
date: 2021-09-11
tags:
  - Azure
  - Cognitive Services
  - Docker
  - Containers
  - Edge Computing

---

I wrote "2021-09-11-cognitive-services-containers" to share practical, production-minded guidance on this topic.

## Available Containerized Services

- **Vision**: Read (OCR), Spatial Analysis
- **Language**: Sentiment Analysis, Key Phrase Extraction, Language Detection, Text Analytics for Health
- **Speech**: Speech-to-Text, Text-to-Speech, Neural Text-to-Speech
- **Decision**: Anomaly Detector

## Prerequisites

1. Azure Cognitive Services resource for billing
2. Docker installed
3. Container registry access

## Pulling Container Images

```bash
# Login to Microsoft Container Registry
docker login mcr.microsoft.com

# Pull Text Analytics container
docker pull mcr.microsoft.com/azure-cognitive-services/textanalytics/sentiment:latest

# Pull Speech-to-Text container
docker pull mcr.microsoft.com/azure-cognitive-services/speechservices/speech-to-text:latest

# Pull Read (OCR) container
docker pull mcr.microsoft.com/azure-cognitive-services/vision/read:3.2
```

## Running the Sentiment Analysis Container

```bash
# Run sentiment analysis container
docker run --rm -it -p 5000:5000 \
  --memory 8g \
  --cpus 4 \
  mcr.microsoft.com/azure-cognitive-services/textanalytics/sentiment:latest \
  Eula=accept \
  Billing=https://westus.api.cognitive.microsoft.com/ \
  ApiKey=your-api-key
```

## Docker Compose Configuration

```yaml
# docker-compose.yml
version: '3.8'

services:
  sentiment:
    image: mcr.microsoft.com/azure-cognitive-services/textanalytics/sentiment:latest
    ports:
      - "5000:5000"
    environment:
      - Eula=accept
      - Billing=https://westus.api.cognitive.microsoft.com/
      - ApiKey=${COGNITIVE_SERVICES_KEY}
    deploy:
      resources:
        limits:
          memory: 8G
          cpus: '4'
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:5000/status"]
      interval: 30s
      timeout: 10s
      retries: 3

  keyphrase:
    image: mcr.microsoft.com/azure-cognitive-services/textanalytics/keyphrase:latest
    ports:
      - "5001:5000"
    environment:
      - Eula=accept
      - Billing=https://westus.api.cognitive.microsoft.com/
      - ApiKey=${COGNITIVE_SERVICES_KEY}
    deploy:
      resources:
        limits:
          memory: 4G
          cpus: '2'

  language-detection:
    image: mcr.microsoft.com/azure-cognitive-services/textanalytics/language:latest
    ports:
      - "5002:5000"
    environment:
      - Eula=accept
      - Billing=https://westus.api.cognitive.microsoft.com/
      - ApiKey=${COGNITIVE_SERVICES_KEY}
    deploy:
      resources:
        limits:
          memory: 2G
          cpus: '1'
```

## Calling the Containerized API

```python
# sentiment_client.py
import requests
import json

class CognitiveServicesContainer:
    def __init__(self, endpoint: str):
        self.endpoint = endpoint.rstrip('/')

    def analyze_sentiment(self, texts: list) -> dict:
        """Analyze sentiment of text documents."""
        url = f"{self.endpoint}/text/analytics/v3.1/sentiment"

        documents = [
            {"id": str(i), "language": "en", "text": text}
            for i, text in enumerate(texts)
        ]

        response = requests.post(
            url,
            headers={"Content-Type": "application/json"},
            json={"documents": documents}
        )

        return response.json()

    def extract_key_phrases(self, texts: list) -> dict:
        """Extract key phrases from text documents."""
        url = f"{self.endpoint}/text/analytics/v3.1/keyPhrases"

        documents = [
            {"id": str(i), "language": "en", "text": text}
            for i, text in enumerate(texts)
        ]

        response = requests.post(
            url,
            headers={"Content-Type": "application/json"},
            json={"documents": documents}
        )

        return response.json()

# Usage
client = CognitiveServicesContainer("http://localhost:5000")

texts = [
    "I love this product! It exceeded my expectations.",
    "The service was terrible and I'm very disappointed.",
    "The meeting was okay, nothing special."
]

# Analyze sentiment
sentiment_result = client.analyze_sentiment(texts)
for doc in sentiment_result['documents']:
    print(f"Text {doc['id']}: {doc['sentiment']} "
          f"(positive: {doc['confidenceScores']['positive']:.2f})")
```

## Speech-to-Text Container

```bash
# Run speech-to-text container
docker run --rm -it -p 5000:5000 \
  --memory 4g \
  --cpus 4 \
  mcr.microsoft.com/azure-cognitive-services/speechservices/speech-to-text:latest \
  Eula=accept \
  Billing=https://westus.api.cognitive.microsoft.com/ \
  ApiKey=your-api-key
```

```python
# speech_client.py
import azure.cognitiveservices.speech as speechsdk

def transcribe_audio(audio_file: str, endpoint: str) -> str:
    """Transcribe audio using containerized speech service."""

    # Configure for local container
    speech_config = speechsdk.SpeechConfig(
        host=endpoint
    )
    speech_config.speech_recognition_language = "en-US"

    audio_config = speechsdk.AudioConfig(filename=audio_file)

    recognizer = speechsdk.SpeechRecognizer(
        speech_config=speech_config,
        audio_config=audio_config
    )

    result = recognizer.recognize_once()

    if result.reason == speechsdk.ResultReason.RecognizedSpeech:
        return result.text
    elif result.reason == speechsdk.ResultReason.NoMatch:
        return "No speech could be recognized"
    else:
        return f"Error: {result.reason}"

# Usage
text = transcribe_audio("audio.wav", "ws://localhost:5000")
print(f"Transcription: {text}")
```

## Read (OCR) Container

```bash
# Run Read container
docker run --rm -it -p 5000:5000 \
  --memory 16g \
  --cpus 8 \
  mcr.microsoft.com/azure-cognitive-services/vision/read:3.2 \
  Eula=accept \
  Billing=https://westus.api.cognitive.microsoft.com/ \
  ApiKey=your-api-key
```

```python
# ocr_client.py
import requests
import time

class OCRContainer:
    def __init__(self, endpoint: str):
        self.endpoint = endpoint.rstrip('/')

    def read_image(self, image_path: str) -> dict:
        """Extract text from an image using the Read API."""

        # Submit read request
        with open(image_path, 'rb') as f:
            response = requests.post(
                f"{self.endpoint}/vision/v3.2/read/analyze",
                headers={"Content-Type": "application/octet-stream"},
                data=f.read()
            )

        # Get operation location
        operation_url = response.headers["Operation-Location"]

        # Poll for results
        while True:
            result = requests.get(operation_url).json()

            if result["status"] == "succeeded":
                return result["analyzeResult"]
            elif result["status"] == "failed":
                raise Exception("OCR operation failed")

            time.sleep(1)

    def extract_text(self, image_path: str) -> str:
        """Extract and concatenate all text from an image."""
        result = self.read_image(image_path)

        lines = []
        for page in result["readResults"]:
            for line in page["lines"]:
                lines.append(line["text"])

        return "\n".join(lines)

# Usage
ocr = OCRContainer("http://localhost:5000")
text = ocr.extract_text("document.png")
print(text)
```

## Kubernetes Deployment

```yaml
# cognitive-services-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: sentiment-analysis
spec:
  replicas: 3
  selector:
    matchLabels:
      app: sentiment-analysis
  template:
    metadata:
      labels:
        app: sentiment-analysis
    spec:
      containers:
      - name: sentiment
        image: mcr.microsoft.com/azure-cognitive-services/textanalytics/sentiment:latest
        ports:
        - containerPort: 5000
        env:
        - name: Eula
          value: "accept"
        - name: Billing
          valueFrom:
            secretKeyRef:
              name: cognitive-services
              key: billing-endpoint
        - name: ApiKey
          valueFrom:
            secretKeyRef:
              name: cognitive-services
              key: api-key
        resources:
          requests:
            memory: "4Gi"
            cpu: "2"
          limits:
            memory: "8Gi"
            cpu: "4"
        livenessProbe:
          httpGet:
            path: /status
            port: 5000
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /status
            port: 5000
          initialDelaySeconds: 10
          periodSeconds: 5\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
