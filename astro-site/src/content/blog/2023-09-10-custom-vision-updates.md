---
title: "Azure Custom Vision Updates: Enhanced Model Training and Deployment"
author: Michael John Peña
draft: false
date: 2023-09-10
description: "Explore the latest updates to Azure Custom Vision including improved training capabilities, edge deployment options, and AutoML features."
tags:
  - Azure
  - Custom Vision
  - Machine Learning
  - Computer Vision
  - AI
---

## Introduction

Azure Custom Vision continues to evolve with significant updates that make it easier to build, train, and deploy custom image classification and object detection models. This post covers the latest features and best practices for leveraging Custom Vision in your applications.

## Latest Custom Vision Features

### AutoML-Powered Training

```python
import os
from azure.cognitiveservices.vision.customvision.training import CustomVisionTrainingClient
from azure.cognitiveservices.vision.customvision.training.models import (
    Domain,
    Project,
    ImageFileCreateBatch,
    ImageFileCreateEntry,
    Region
)
from azure.cognitiveservices.vision.customvision.prediction import CustomVisionPredictionClient
from msrest.authentication import ApiKeyCredentials

class CustomVisionTrainer:
    def __init__(self):
        credentials = ApiKeyCredentials(
            in_headers={"Training-key": os.getenv("CUSTOM_VISION_TRAINING_KEY")}
        )
        self.trainer = CustomVisionTrainingClient(
            os.getenv("CUSTOM_VISION_ENDPOINT"),
            credentials
        )

        pred_credentials = ApiKeyCredentials(
            in_headers={"Prediction-key": os.getenv("CUSTOM_VISION_PREDICTION_KEY")}
        )
        self.predictor = CustomVisionPredictionClient(
            os.getenv("CUSTOM_VISION_ENDPOINT"),
            pred_credentials
        )

    def list_domains(self) -> list:
        """List available training domains"""
        domains = self.trainer.get_domains()
        return [
            {
                "id": d.id,
                "name": d.name,
                "type": d.type,
                "exportable": d.exportable
            }
            for d in domains
        ]

    def create_classification_project(
        self,
        name: str,
        classification_type: str = "Multiclass",
        exportable: bool = True
    ) -> str:
        """Create image classification project"""
        domains = self.trainer.get_domains()

        # Find appropriate domain
        if exportable:
            domain = next(
                (d for d in domains
                 if d.type == "Classification"
                 and d.exportable
                 and "General" in d.name),
                None
            )
        else:
            domain = next(
                (d for d in domains
                 if d.type == "Classification"
                 and "General" in d.name),
                None
            )

        project = self.trainer.create_project(
            name,
            domain_id=domain.id,
            classification_type=classification_type
        )

        return project.id

    def create_detection_project(
        self,
        name: str,
        exportable: bool = True
    ) -> str:
        """Create object detection project"""
        domains = self.trainer.get_domains()

        if exportable:
            domain = next(
                (d for d in domains
                 if d.type == "ObjectDetection" and d.exportable),
                None
            )
        else:
            domain = next(
                (d for d in domains if d.type == "ObjectDetection"),
                None
            )

        project = self.trainer.create_project(
            name,
            domain_id=domain.id
        )

        return project.id

# Usage
trainer = CustomVisionTrainer()

# List available domains
domains = trainer.list_domains()
for d in domains:
    print(f"{d['name']} - Type: {d['type']}, Exportable: {d['exportable']}")

# Create project
project_id = trainer.create_classification_project(
    "Product Quality Inspector",
    classification_type="Multiclass",
    exportable=True
)
```

### Enhanced Training Pipeline

```python
import time
from typing import List, Dict, Optional
from dataclasses import dataclass

@dataclass
class TrainingImage:
    url: str
    tags: List[str]
    regions: Optional[List[Dict]] = None  # For object detection

class EnhancedTrainingPipeline:
    def __init__(self, trainer: CustomVisionTrainer):
        self.trainer = trainer
        self.tag_cache = {}

    def prepare_tags(self, project_id: str, tag_names: List[str]) -> Dict[str, str]:
        """Create or get tags for project"""
        existing_tags = self.trainer.trainer.get_tags(project_id)
        tag_map = {t.name: t.id for t in existing_tags}

        for name in tag_names:
            if name not in tag_map:
                tag = self.trainer.trainer.create_tag(project_id, name)
                tag_map[name] = tag.id

        return tag_map

    def upload_classification_images(
        self,
        project_id: str,
        images: List[TrainingImage],
        batch_size: int = 64
    ) -> dict:
        """Upload images for classification training"""
        # Collect all unique tags
        all_tags = set()
        for img in images:
            all_tags.update(img.tags)

        # Prepare tags
        tag_map = self.prepare_tags(project_id, list(all_tags))

        # Create image entries
        entries = []
        for img in images:
            tag_ids = [tag_map[t] for t in img.tags]
            entries.append(ImageFileCreateEntry(url=img.url, tag_ids=tag_ids))

        # Upload in batches
        results = {"success": 0, "failed": 0, "duplicates": 0}

        for i in range(0, len(entries), batch_size):
            batch = entries[i:i+batch_size]
            result = self.trainer.trainer.create_images_from_urls(
                project_id,
                ImageFileCreateBatch(images=batch)
            )

            for img_result in result.images:
                if img_result.status == "OK":
                    results["success"] += 1
                elif img_result.status == "OKDuplicate":
                    results["duplicates"] += 1
                else:
                    results["failed"] += 1

        return results

    def upload_detection_images(
        self,
        project_id: str,
        images: List[TrainingImage],
        batch_size: int = 64
    ) -> dict:
        """Upload images for object detection training"""
        # Collect all unique tags
        all_tags = set()
        for img in images:
            all_tags.update(img.tags)

        # Prepare tags
        tag_map = self.prepare_tags(project_id, list(all_tags))

        # Create image entries with regions
        entries = []
        for img in images:
            regions = []
            if img.regions:
                for region in img.regions:
                    regions.append(Region(
                        tag_id=tag_map[region["tag"]],
                        left=region["left"],
                        top=region["top"],
                        width=region["width"],
                        height=region["height"]
                    ))

            entries.append(ImageFileCreateEntry(
                url=img.url,
                regions=regions
            ))

        # Upload in batches
        results = {"success": 0, "failed": 0, "duplicates": 0}

        for i in range(0, len(entries), batch_size):
            batch = entries[i:i+batch_size]
            result = self.trainer.trainer.create_images_from_urls(
                project_id,
                ImageFileCreateBatch(images=batch)
            )

            for img_result in result.images:
                if img_result.status == "OK":
                    results["success"] += 1
                elif img_result.status == "OKDuplicate":
                    results["duplicates"] += 1
                else:
                    results["failed"] += 1

        return results

    def train_with_validation(
        self,
        project_id: str,
        reserved_budget_hours: int = 1
    ) -> dict:
        """Train model with automatic validation"""
        # Start training
        iteration = self.trainer.trainer.train_project(
            project_id,
            reserved_budget_in_hours=reserved_budget_hours,
            force_train=False
        )

        # Wait for completion
        while iteration.status in ["Queued", "Training"]:
            print(f"Training status: {iteration.status}")
            time.sleep(30)
            iteration = self.trainer.trainer.get_iteration(project_id, iteration.id)

        # Get performance metrics
        performance = self.trainer.trainer.get_iteration_performance(
            project_id,
            iteration.id
        )

        return {
            "iteration_id": iteration.id,
            "status": iteration.status,
            "precision": performance.precision,
            "recall": performance.recall,
            "average_precision": performance.average_precision,
            "per_tag_performance": [
                {
                    "tag": tp.name,
                    "precision": tp.precision,
                    "recall": tp.recall,
                    "average_precision": tp.average_precision
                }
                for tp in performance.per_tag_performance
            ]
        }

# Usage
pipeline = EnhancedTrainingPipeline(trainer)

# Upload classification images
classification_images = [
    TrainingImage(url="https://example.com/good1.jpg", tags=["good_quality"]),
    TrainingImage(url="https://example.com/bad1.jpg", tags=["defective"]),
    # ... more images
]

upload_result = pipeline.upload_classification_images(project_id, classification_images)
print(f"Uploaded: {upload_result}")

# Train model
training_result = pipeline.train_with_validation(project_id)
print(f"Training complete - Precision: {training_result['precision']:.2%}")
```

## Edge Deployment Options

### Exporting Models for Edge Devices

```python
class EdgeDeployment:
    def __init__(self, trainer: CustomVisionTrainer):
        self.trainer = trainer

    def export_model(
        self,
        project_id: str,
        iteration_id: str,
        platform: str,
        flavor: str = None
    ) -> str:
        """Export model for edge deployment

        Platforms: "CoreML", "TensorFlow", "DockerFile", "ONNX", "VAIDK"
        Flavors depend on platform (e.g., "TensorFlowLite" for TensorFlow)
        """
        exports = self.trainer.trainer.get_exports(project_id, iteration_id)

        # Check if export already exists
        existing = next(
            (e for e in exports if e.platform == platform and e.flavor == flavor),
            None
        )

        if existing and existing.status == "Done":
            return existing.download_uri

        # Create new export
        export = self.trainer.trainer.export_iteration(
            project_id,
            iteration_id,
            platform,
            flavor=flavor
        )

        # Wait for export
        while export.status in ["Exporting"]:
            time.sleep(5)
            exports = self.trainer.trainer.get_exports(project_id, iteration_id)
            export = next(e for e in exports if e.platform == platform)

        if export.status == "Done":
            return export.download_uri
        else:
            raise Exception(f"Export failed: {export.status}")

    def get_docker_image(
        self,
        project_id: str,
        iteration_id: str,
        platform: str = "Linux"
    ) -> str:
        """Get Docker image for containerized deployment"""
        # Export as DockerFile
        if platform == "Linux":
            flavor = "Linux"
        elif platform == "Windows":
            flavor = "Windows"
        elif platform == "ARM":
            flavor = "ARM"
        else:
            flavor = "Linux"

        return self.export_model(
            project_id,
            iteration_id,
            "DockerFile",
            flavor
        )

    def export_to_onnx(self, project_id: str, iteration_id: str) -> str:
        """Export model to ONNX format"""
        return self.export_model(project_id, iteration_id, "ONNX")

    def export_to_tensorflow_lite(self, project_id: str, iteration_id: str) -> str:
        """Export model to TensorFlow Lite for mobile"""
        return self.export_model(
            project_id,
            iteration_id,
            "TensorFlow",
            "TensorFlowLite"
        )

    def export_to_coreml(self, project_id: str, iteration_id: str) -> str:
        """Export model to CoreML for iOS"""
        return self.export_model(project_id, iteration_id, "CoreML")

# Usage
edge = EdgeDeployment(trainer)

# Export to different formats
onnx_url = edge.export_to_onnx(project_id, iteration_id)
print(f"ONNX model: {onnx_url}")

tflite_url = edge.export_to_tensorflow_lite(project_id, iteration_id)
print(f"TFLite model: {tflite_url}")

docker_url = edge.get_docker_image(project_id, iteration_id, "Linux")
print(f"Docker image: {docker_url}")
```

### Running Exported Models Locally

```python
import onnxruntime as ort
import numpy as np
from PIL import Image

class ONNXModelRunner:
    def __init__(self, model_path: str, labels_path: str):
        self.session = ort.InferenceSession(model_path)
        self.input_name = self.session.get_inputs()[0].name

        with open(labels_path, "r") as f:
            self.labels = [line.strip() for line in f.readlines()]

    def preprocess_image(self, image_path: str, target_size: tuple = (224, 224)) -> np.ndarray:
        """Preprocess image for inference"""
        img = Image.open(image_path).convert("RGB")
        img = img.resize(target_size)

        # Convert to numpy and normalize
        img_array = np.array(img).astype(np.float32)
        img_array = img_array / 255.0

        # Add batch dimension and transpose to NCHW
        img_array = np.transpose(img_array, (2, 0, 1))
        img_array = np.expand_dims(img_array, axis=0)

        return img_array

    def predict(self, image_path: str) -> list:
        """Run prediction on image"""
        input_data = self.preprocess_image(image_path)

        outputs = self.session.run(None, {self.input_name: input_data})
        probabilities = outputs[0][0]

        results = []
        for i, prob in enumerate(probabilities):
            results.append({
                "label": self.labels[i],
                "probability": float(prob)
            })

        results.sort(key=lambda x: x["probability"], reverse=True)
        return results

# Usage
model = ONNXModelRunner("model.onnx", "labels.txt")
predictions = model.predict("test_image.jpg")

for pred in predictions[:3]:
    print(f"{pred['label']}: {pred['probability']:.2%}")
```

## Conclusion

Azure Custom Vision's latest updates provide powerful capabilities for building custom image classification and object detection models. With AutoML-powered training, enhanced performance metrics, and flexible edge deployment options, it's easier than ever to create production-ready computer vision solutions. Whether deploying to the cloud or edge devices, Custom Vision offers a complete workflow from training to deployment.
