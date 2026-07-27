---
title: Building Custom Image Classifiers with Custom Vision
author: Michael John Pena
draft: false
date: 2021-03-29
url: /blog/custom-vision/
tags:
  - Azure
  - Custom Vision
  - Machine Learning
  - Image Classification
  - Object Detection
---

Custom Vision fills the gap that the general-purpose Computer Vision API can't: domain-specific image classification and object detection where the model needs to know the difference between your products, your defects, or your specific set of categories. I've used it for quality control on a manufacturing line—trained with a few hundred photos of good parts and defective parts, deployed to an edge device as a Docker container, running inference offline. The training UI is legitimately fast to iterate with; you can go from zero labelled images to a deployed model in under an hour. The export options (ONNX, CoreML, TensorFlow Lite) mean you're not locked into calling the cloud API from the device if latency matters.

## Setting Up Custom Vision

```bash
# Create Custom Vision training resource
az cognitiveservices account create \
    --name mycustomvision-training \
    --resource-group myResourceGroup \
    --kind CustomVision.Training \
    --sku S0 \
    --location eastus

# Create Custom Vision prediction resource
az cognitiveservices account create \
    --name mycustomvision-prediction \
    --resource-group myResourceGroup \
    --kind CustomVision.Prediction \
    --sku S0 \
    --location eastus
```

## Building an Image Classifier

```python
from azure.cognitiveservices.vision.customvision.training import CustomVisionTrainingClient
from azure.cognitiveservices.vision.customvision.prediction import CustomVisionPredictionClient
from azure.cognitiveservices.vision.customvision.training.models import ImageFileCreateBatch, ImageFileCreateEntry
from msrest.authentication import ApiKeyCredentials
import os
import time

class CustomVisionClassifier:
    def __init__(self, training_key, training_endpoint, prediction_key, prediction_endpoint, prediction_resource_id):
        training_credentials = ApiKeyCredentials(in_headers={"Training-key": training_key})
        self.trainer = CustomVisionTrainingClient(training_endpoint, training_credentials)

        prediction_credentials = ApiKeyCredentials(in_headers={"Prediction-key": prediction_key})
        self.predictor = CustomVisionPredictionClient(prediction_endpoint, prediction_credentials)

        self.prediction_resource_id = prediction_resource_id
        self.project = None

    def create_project(self, name, classification_type="Multiclass", domain="General"):
        """Create a new Custom Vision project."""
        # Get domain ID
        domains = self.trainer.get_domains()
        domain_id = next(d.id for d in domains if d.name == domain and d.type == "Classification")

        self.project = self.trainer.create_project(
            name,
            domain_id=domain_id,
            classification_type=classification_type
        )

        print(f"Created project: {self.project.name} ({self.project.id})")
        return self.project

    def create_tags(self, tag_names):
        """Create tags for classification."""
        tags = {}
        for name in tag_names:
            tag = self.trainer.create_tag(self.project.id, name)
            tags[name] = tag
            print(f"Created tag: {name} ({tag.id})")
        return tags

    def upload_images(self, tag_id, image_folder):
        """Upload images for a specific tag."""
        image_list = []

        for filename in os.listdir(image_folder):
            if filename.lower().endswith(('.jpg', '.jpeg', '.png')):
                file_path = os.path.join(image_folder, filename)
                with open(file_path, "rb") as f:
                    image_list.append(ImageFileCreateEntry(
                        name=filename,
                        contents=f.read(),
                        tag_ids=[tag_id]
                    ))

                # Upload in batches of 64
                if len(image_list) >= 64:
                    self._upload_batch(image_list)
                    image_list = []

        # Upload remaining images
        if image_list:
            self._upload_batch(image_list)

    def _upload_batch(self, image_list):
        """Upload a batch of images."""
        batch = ImageFileCreateBatch(images=image_list)
        result = self.trainer.create_images_from_files(self.project.id, batch)

        if not result.is_batch_successful:
            print(f"Batch upload failed. {len([img for img in result.images if img.status != 'OK'])} images failed.")
        else:
            print(f"Uploaded {len(image_list)} images")

    def train(self, training_type="Regular"):
        """Train the model."""
        print("Training...")
        iteration = self.trainer.train_project(
            self.project.id,
            training_type=training_type
        )

        # Wait for training to complete
        while iteration.status != "Completed":
            iteration = self.trainer.get_iteration(self.project.id, iteration.id)
            print(f"Training status: {iteration.status}")
            time.sleep(10)

        print("Training completed!")
        return iteration

    def publish(self, iteration_id, publish_name):
        """Publish the trained model."""
        self.trainer.publish_iteration(
            self.project.id,
            iteration_id,
            publish_name,
            self.prediction_resource_id
        )
        print(f"Published iteration: {publish_name}")

    def predict(self, image_path, publish_name):
        """Predict image classification."""
        with open(image_path, "rb") as f:
            result = self.predictor.classify_image(
                self.project.id,
                publish_name,
                f
            )

        predictions = []
        for prediction in result.predictions:
            predictions.append({
                "tag": prediction.tag_name,
                "probability": prediction.probability
            })

        return sorted(predictions, key=lambda x: x["probability"], reverse=True)

    def predict_url(self, image_url, publish_name):
        """Predict from image URL."""
        result = self.predictor.classify_image_url(
            self.project.id,
            publish_name,
            url=image_url
        )

        return [
            {"tag": p.tag_name, "probability": p.probability}
            for p in result.predictions
        ]


# Example: Product quality classification
classifier = CustomVisionClassifier(
    training_key="your-training-key",
    training_endpoint="https://eastus.api.cognitive.microsoft.com",
    prediction_key="your-prediction-key",
    prediction_endpoint="https://eastus.api.cognitive.microsoft.com",
    prediction_resource_id="/subscriptions/.../resourceGroups/.../providers/Microsoft.CognitiveServices/accounts/mycustomvision-prediction"
)

# Create project
project = classifier.create_project("ProductQuality", "Multiclass")

# Create tags
tags = classifier.create_tags(["Good", "Defective", "Damaged"])

# Upload training images
classifier.upload_images(tags["Good"].id, "./training_data/good")
classifier.upload_images(tags["Defective"].id, "./training_data/defective")
classifier.upload_images(tags["Damaged"].id, "./training_data/damaged")

# Train model
iteration = classifier.train()

# Publish
classifier.publish(iteration.id, "quality-v1")

# Predict
result = classifier.predict("./test_image.jpg", "quality-v1")
print(f"Prediction: {result[0]['tag']} ({result[0]['probability']:.2%})")
```

## Object Detection

```python
class CustomVisionObjectDetector:
    def __init__(self, training_key, training_endpoint, prediction_key, prediction_endpoint, prediction_resource_id):
        training_credentials = ApiKeyCredentials(in_headers={"Training-key": training_key})
        self.trainer = CustomVisionTrainingClient(training_endpoint, training_credentials)

        prediction_credentials = ApiKeyCredentials(in_headers={"Prediction-key": prediction_key})
        self.predictor = CustomVisionPredictionClient(prediction_endpoint, prediction_credentials)

        self.prediction_resource_id = prediction_resource_id
        self.project = None

    def create_project(self, name, domain="General"):
        """Create object detection project."""
        domains = self.trainer.get_domains()
        domain_id = next(d.id for d in domains if d.name == domain and d.type == "ObjectDetection")

        self.project = self.trainer.create_project(name, domain_id=domain_id)
        return self.project

    def create_tags(self, tag_names):
        """Create tags for detection."""
        tags = {}
        for name in tag_names:
            tag = self.trainer.create_tag(self.project.id, name)
            tags[name] = tag
        return tags

    def upload_image_with_regions(self, image_path, regions):
        """Upload image with bounding box regions.

        regions format: [{"tag_id": "...", "left": 0.1, "top": 0.1, "width": 0.3, "height": 0.3}]
        Coordinates are normalized (0-1)
        """
        from azure.cognitiveservices.vision.customvision.training.models import (
            ImageFileCreateEntry, Region
        )

        with open(image_path, "rb") as f:
            image_data = f.read()

        region_objects = [
            Region(
                tag_id=r["tag_id"],
                left=r["left"],
                top=r["top"],
                width=r["width"],
                height=r["height"]
            )
            for r in regions
        ]

        entry = ImageFileCreateEntry(
            name=os.path.basename(image_path),
            contents=image_data,
            regions=region_objects
        )

        result = self.trainer.create_images_from_files(
            self.project.id,
            ImageFileCreateBatch(images=[entry])
        )

        return result.is_batch_successful

    def train(self):
        """Train the detection model."""
        iteration = self.trainer.train_project(self.project.id)

        while iteration.status != "Completed":
            iteration = self.trainer.get_iteration(self.project.id, iteration.id)
            time.sleep(10)

        return iteration

    def detect_objects(self, image_path, publish_name):
        """Detect objects in image."""
        with open(image_path, "rb") as f:
            result = self.predictor.detect_image(
                self.project.id,
                publish_name,
                f
            )

        detections = []
        for prediction in result.predictions:
            if prediction.probability > 0.5:  # Confidence threshold
                detections.append({
                    "tag": prediction.tag_name,
                    "probability": prediction.probability,
                    "bounding_box": {
                        "left": prediction.bounding_box.left,
                        "top": prediction.bounding_box.top,
                        "width": prediction.bounding_box.width,
                        "height": prediction.bounding_box.height
                    }
                })

        return detections


# Example: Retail shelf detection
detector = CustomVisionObjectDetector(
    training_key="your-key",
    training_endpoint="https://eastus.api.cognitive.microsoft.com",
    prediction_key="your-key",
    prediction_endpoint="https://eastus.api.cognitive.microsoft.com",
    prediction_resource_id="your-resource-id"
)

# Create project
project = detector.create_project("ShelfProducts", "General")

# Create tags for products
tags = detector.create_tags(["Cola", "Water", "Juice", "Empty"])

# Upload images with annotations
detector.upload_image_with_regions("shelf1.jpg", [
    {"tag_id": tags["Cola"].id, "left": 0.1, "top": 0.2, "width": 0.15, "height": 0.3},
    {"tag_id": tags["Water"].id, "left": 0.3, "top": 0.2, "width": 0.15, "height": 0.3},
    {"tag_id": tags["Empty"].id, "left": 0.5, "top": 0.2, "width": 0.15, "height": 0.3}
])

# Train and publish
iteration = detector.train()
detector.trainer.publish_iteration(
    detector.project.id,
    iteration.id,
    "shelf-v1",
    detector.prediction_resource_id
)

# Detect
detections = detector.detect_objects("test_shelf.jpg", "shelf-v1")
for d in detections:
    print(f"Found {d['tag']} at ({d['bounding_box']['left']:.2f}, {d['bounding_box']['top']:.2f})")
```

## Exporting Models for Edge Deployment

```python
def export_model(trainer, project_id, iteration_id, platform="TensorFlow"):
    """Export model for offline use."""
    # Available platforms: TensorFlow, CoreML, ONNX, DockerFile, OpenVino

    # Request export
    export = trainer.export_iteration(
        project_id,
        iteration_id,
        platform
    )

    # Wait for export
    while export.status == "Exporting":
        time.sleep(5)
        exports = trainer.get_exports(project_id, iteration_id)
        export = next((e for e in exports if e.platform == platform), None)

    if export.status == "Done":
        print(f"Export URL: {export.download_uri}")
        return export.download_uri
    else:
        raise Exception(f"Export failed: {export.status}")


# Export to TensorFlow Lite for mobile
export_url = export_model(
    classifier.trainer,
    classifier.project.id,
    iteration_id,
    "TensorFlow"
)

# Export to ONNX for cross-platform
export_url = export_model(
    classifier.trainer,
    classifier.project.id,
    iteration_id,
    "ONNX"
)

# Export to CoreML for iOS
export_url = export_model(
    classifier.trainer,
    classifier.project.id,
    iteration_id,
    "CoreML"
)
```

## Using Exported Model (ONNX)

```python
import onnxruntime as ort
import numpy as np
from PIL import Image

class ONNXPredictor:
    def __init__(self, model_path, labels_path):
        self.session = ort.InferenceSession(model_path)
        self.input_name = self.session.get_inputs()[0].name
        self.output_name = self.session.get_outputs()[0].name

        with open(labels_path) as f:
            self.labels = [line.strip() for line in f]

    def preprocess(self, image_path, size=(224, 224)):
        """Preprocess image for model."""
        img = Image.open(image_path).convert("RGB")
        img = img.resize(size)
        img_array = np.array(img).astype(np.float32)

        # Normalize (Custom Vision specific)
        img_array = img_array / 255.0

        # Add batch dimension and transpose to NCHW
        img_array = np.transpose(img_array, (2, 0, 1))
        img_array = np.expand_dims(img_array, axis=0)

        return img_array

    def predict(self, image_path):
        """Run prediction."""
        input_data = self.preprocess(image_path)
        outputs = self.session.run([self.output_name], {self.input_name: input_data})

        probabilities = outputs[0][0]
        top_idx = np.argmax(probabilities)

        return {
            "label": self.labels[top_idx],
            "confidence": float(probabilities[top_idx]),
            "all_predictions": [
                {"label": self.labels[i], "confidence": float(p)}
                for i, p in enumerate(probabilities)
            ]
        }


# Use exported model locally
predictor = ONNXPredictor("model.onnx", "labels.txt")
result = predictor.predict("test_image.jpg")
print(f"Prediction: {result['label']} ({result['confidence']:.2%})")
```

## Iterative Improvement

```python
def add_misclassified_images(classifier, publish_name, image_folder, correct_tag):
    """Add misclassified images to improve model."""
    tags = {t.name: t for t in classifier.trainer.get_tags(classifier.project.id)}

    for filename in os.listdir(image_folder):
        if filename.lower().endswith(('.jpg', '.jpeg', '.png')):
            image_path = os.path.join(image_folder, filename)

            # Get current prediction
            predictions = classifier.predict(image_path, publish_name)

            # If misclassified, add to training data
            if predictions[0]["tag"] != correct_tag:
                print(f"Adding misclassified image: {filename}")
                print(f"  Was: {predictions[0]['tag']}, Should be: {correct_tag}")

                classifier.upload_images(
                    tags[correct_tag].id,
                    image_folder
                )

    # Retrain
    iteration = classifier.train()
    return iteration
```

## Conclusion

Custom Vision makes it easy to build domain-specific image recognition:

- **No ML expertise required**: Simple web interface and SDK
- **Classification and detection**: Both scenarios supported
- **Export for edge**: Deploy to mobile and IoT devices
- **Iterative improvement**: Continuously enhance accuracy
- **Quick training**: Results in minutes, not hours

It's perfect for quality inspection, inventory management, and specialized recognition tasks.
