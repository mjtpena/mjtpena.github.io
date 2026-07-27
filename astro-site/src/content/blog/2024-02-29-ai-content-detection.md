---
title: "AI Content Detection: Tools and Techniques"
author: Michael John Peña
draft: false
date: 2024-02-29
tags:
  - AI Detection
  - Content Authenticity
  - Machine Learning
  - Misinformation
  - Verification

---

I wrote "AI Content Detection: Tools and Techniques" to share practical, production-minded guidance on this topic.

## Detection Approaches

### Text Detection

```python
from transformers import pipeline

detector = pipeline("text-classification", model="roberta-base-openai-detector")

def detect_ai_text(text: str) -> dict:
    """Detect if text is AI-generated."""

    result = detector(text[:512])  # Model token limit

    return {
        "is_ai_generated": result[0]["label"] == "Fake",
        "confidence": result[0]["score"],
        "method": "classifier"
    }

# Statistical methods
def statistical_analysis(text: str) -> dict:
    """Analyze text statistics for AI indicators."""

    import nltk
    from collections import Counter

    words = nltk.word_tokenize(text.lower())
    sentences = nltk.sent_tokenize(text)

    # AI text tends to have:
    # - More consistent sentence length
    # - Less vocabulary diversity
    # - Fewer typos

    avg_sentence_len = sum(len(s.split()) for s in sentences) / len(sentences)
    vocab_diversity = len(set(words)) / len(words)

    return {
        "avg_sentence_length": avg_sentence_len,
        "vocabulary_diversity": vocab_diversity,
        "indicators": {
            "uniform_sentences": 15 < avg_sentence_len < 25,
            "low_diversity": vocab_diversity < 0.4
        }
    }
```

### Image Detection

```python
import torch
from torchvision import transforms

def detect_ai_image(image_path: str) -> dict:
    """Detect if image is AI-generated."""

    # Load detection model
    model = load_deepfake_detector()

    transform = transforms.Compose([
        transforms.Resize((224, 224)),
        transforms.ToTensor(),
        transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])
    ])

    image = Image.open(image_path)
    tensor = transform(image).unsqueeze(0)

    with torch.no_grad():
        output = model(tensor)
        probability = torch.sigmoid(output).item()

    return {
        "is_ai_generated": probability > 0.5,
        "confidence": probability,
        "method": "cnn_classifier"
    }

# Artifact analysis
def analyze_artifacts(image_path: str) -> dict:
    """Analyze image for AI generation artifacts."""

    img = cv2.imread(image_path)

    # Check for common AI artifacts
    artifacts = {
        "repeating_patterns": detect_patterns(img),
        "unnatural_textures": analyze_textures(img),
        "inconsistent_lighting": check_lighting(img),
        "anatomical_errors": check_anatomy(img) if has_people(img) else None
    }

    return artifacts
```

### Combined Detection

```python
class ContentDetector:
    def __init__(self):
        self.text_detector = TextAIDetector()
        self.image_detector = ImageAIDetector()

    def analyze(self, content: dict) -> dict:
        """Comprehensive AI content detection."""

        results = {
            "content_type": content["type"],
            "detections": []
        }

        if content["type"] == "text":
            results["detections"].append(self.text_detector.detect(content["text"]))
            results["detections"].append(statistical_analysis(content["text"]))

        elif content["type"] == "image":
            results["detections"].append(self.image_detector.detect(content["path"]))
            results["detections"].append(analyze_artifacts(content["path"]))

        # Aggregate confidence
        confidences = [d.get("confidence", 0.5) for d in results["detections"]]
        results["overall_confidence"] = sum(confidences) / len(confidences)
        results["likely_ai_generated"] = results["overall_confidence"] > 0.6

        return results
```

## Limitations

```python
detection_limitations = {
    "text": [
        "Short texts are hard to classify",
        "Edited AI text reduces accuracy",
        "Models become outdated quickly",
        "False positives on formal writing"
    ],
    "images": [
        "Post-processing reduces detectability",
        "Newer models harder to detect",
        "False positives on edited photos",
        "Low resolution impacts accuracy"
    ],
    "general": [
        "Arms race with generators",
        "No method is 100% accurate",
        "Context matters",
        "Requires regular model updates"
    ]
}
```

## Best Practices

1. **Use multiple methods** - No single detector is reliable
2. **Consider context** - Detection is probabilistic
3. **Update regularly** - Detection models age quickly
4. **Human review** - Final decisions need human judgment
5. **Be transparent** - Communicate uncertainty

## Conclusion

AI detection is an evolving challenge. Use multiple approaches, acknowledge limitations, and combine automated detection with human review for critical decisions.

