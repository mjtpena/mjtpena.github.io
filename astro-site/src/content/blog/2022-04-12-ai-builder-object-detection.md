---
title: "Object Detection with AI Builder: Computer Vision for Business"
author: Michael John Peña
draft: false
date: 2022-04-12
tags:
  - Power Platform
  - AI Builder
  - Object Detection
  - Computer Vision
  - AI

---

I wrote "Object Detection with AI Builder: Computer Vision for Business" to share practical, production-minded guidance on this topic.

## Object Detection Use Cases

```yaml
retail:
  - Product recognition on shelves
  - Inventory counting
  - Planogram compliance
  - Price tag verification

manufacturing:
  - Defect detection
  - Part identification
  - Assembly verification
  - Safety equipment checks

logistics:
  - Package identification
  - Loading verification
  - Asset tracking
  - Damage detection

field_service:
  - Equipment identification
  - Component recognition
  - Wear detection
```

## Training a Custom Model

### Preparing Training Data

```yaml
requirements:
  minimum_images: 15 per object type
  recommended: 50+ per object type
  variety:
    - Different angles
    - Various lighting conditions
    - Multiple backgrounds
    - Different scales

image_specs:
  formats: JPEG, PNG
  min_resolution: 256x256
  max_size: 6MB
```

### Tagging Images

```yaml
tagging_process:
  1_upload_images:
    - Add images to AI Builder
    - Group by object type if helpful

  2_draw_bounding_boxes:
    - Draw rectangle around each object instance
    - Include entire object, slight margin OK
    - Tag overlapping objects separately

  3_assign_labels:
    - Give consistent names to each object type
    - Use clear, descriptive names
    - Be consistent across all images
```

### Training and Evaluation

```yaml
training:
  process:
    - AI Builder processes tagged images
    - Builds detection model
    - Typically 15-30 minutes

  evaluation:
    metrics:
      - Mean Average Precision (mAP)
      - Per-class accuracy
      - False positive rate
    testing:
      - Use held-out test images
      - Verify detection in real scenarios
```

## Using Object Detection

### In Power Apps

```powerfx
// Capture and detect objects
DetectObjectsBtn.OnSelect =
    Set(CapturedImage, Camera1.Photo);
    Set(
        DetectionResults,
        AIBuilder.DetectObjects(
            "ShelfProductDetector",
            CapturedImage
        )
    );

// Display results
DetectedObjectsGallery.Items =
    ForAll(
        DetectionResults.predictions,
        {
            ObjectName: ThisRecord.tagName,
            Confidence: ThisRecord.probability,
            BoundingBox: ThisRecord.boundingBox,
            // Calculate center for display
            CenterX: ThisRecord.boundingBox.left + ThisRecord.boundingBox.width / 2,
            CenterY: ThisRecord.boundingBox.top + ThisRecord.boundingBox.height / 2
        }
    )

// Count specific objects
CountProducts(productName: Text): Number =
    CountIf(
        DetectionResults.predictions,
        tagName = productName And probability > 0.7
    )

// Display counts
ProductACount.Text = "Product A: " & CountProducts("ProductA")
ProductBCount.Text = "Product B: " & CountProducts("ProductB")
```

### Drawing Bounding Boxes

```powerfx
// Create overlay for detected objects
// Using HTML text component or custom visualization

ForAll(
    Filter(DetectionResults.predictions, probability > 0.75),
    {
        Left: ThisRecord.boundingBox.left * ImageWidth,
        Top: ThisRecord.boundingBox.top * ImageHeight,
        Width: ThisRecord.boundingBox.width * ImageWidth,
        Height: ThisRecord.boundingBox.height * ImageHeight,
        Label: ThisRecord.tagName & " (" & Round(ThisRecord.probability * 100, 0) & "%)"
    }
)
```

### In Power Automate

```json
{
    "trigger": {
        "type": "When_file_created",
        "inputs": {
            "folderPath": "/QualityControl/Images"
        }
    },
    "actions": {
        "Detect_Defects": {
            "type": "AIBuilder",
            "inputs": {
                "model": "DefectDetector",
                "image": "@{triggerBody()}"
            }
        },
        "Check_For_Issues": {
            "type": "Condition",
            "expression": {
                "greater": [
                    "@length(body('Detect_Defects')?['predictions'])",
                    0
                ]
            },
            "actions": {
                "Alert_Quality_Team": {
                    "type": "SendEmail",
                    "inputs": {
                        "to": "quality@company.com",
                        "subject": "Defect Detected - Immediate Review Required",
                        "body": "Defects detected in image @{triggerBody()?['name']}\n\nDetected issues:\n@{body('Format_Defect_List')}"
                    }
                },
                "Create_Quality_Issue": {
                    "type": "CreateRecord",
                    "inputs": {
                        "table": "quality_issues",
                        "item": {
                            "image": "@{triggerBody()}",
                            "defects_found": "@{body('Detect_Defects')?['predictions']}",
                            "status": "Pending Review"
                        }
                    }
                }
            }
        }
    }
}
```

## Inventory Counting App

```powerfx
// Complete inventory counting solution
Screen: InventoryCountScreen

// Capture shelf image
CaptureShelfBtn.OnSelect =
    Set(ShelfImage, Camera1.Photo);
    Set(IsProcessing, true);
    Set(
        ShelfDetections,
        AIBuilder.DetectObjects("ShelfProductDetector", ShelfImage)
    );
    Set(IsProcessing, false);
    Set(ShowResults, true);

// Aggregate counts by product
CalculateCounts.OnSelect =
    ClearCollect(
        ProductCounts,
        GroupBy(
            Filter(ShelfDetections.predictions, probability > 0.7),
            "tagName",
            "detections"
        )
    );
    ForAll(
        ProductCounts,
        Patch(
            ProductCounts,
            ThisRecord,
            {count: CountRows(ThisRecord.detections)}
        )
    );

// Compare to expected inventory
CompareToExpected.OnSelect =
    ClearCollect(
        InventoryVariance,
        AddColumns(
            ProductCounts,
            "expected", LookUp(ExpectedInventory, ProductName = tagName, Quantity),
            "variance", count - LookUp(ExpectedInventory, ProductName = tagName, Quantity)
        )
    );

// Flag significant variances
FlagIssues.OnSelect =
    ClearCollect(
        InventoryIssues,
        Filter(
            InventoryVariance,
            Abs(variance) > 2  // More than 2 items off
        )
    );

// Submit count
SubmitCountBtn.OnSelect =
    ForAll(
        ProductCounts,
        Patch(
            InventoryCounts,
            Defaults(InventoryCounts),
            {
                CountDate: Today(),
                Location: LocationDropdown.Selected.Value,
                ProductName: ThisRecord.tagName,
                CountedQuantity: ThisRecord.count,
                ExpectedQuantity: LookUp(ExpectedInventory, ProductName = ThisRecord.tagName, Quantity),
                CountedBy: User().Email,
                CountImage: ShelfImage
            }
        )
    );
    Notify("Inventory count submitted", NotificationType.Success)
```

## Best Practices

```yaml
model_accuracy:
  training_data:
    - More images = better accuracy
    - Include challenging cases
    - Vary conditions systematically

  tagging:
    - Tight bounding boxes
    - Tag all instances
    - Be consistent

  validation:
    - Test with real-world images
    - Monitor confidence scores
    - Retrain as needed

deployment:
  confidence_thresholds:
    - Adjust based on use case
    - Higher for critical decisions
    - Lower for suggestions

  error_handling:
    - Handle no detections gracefully
    - Provide manual override
    - Log edge cases for retraining
```

## Conclusion

Object detection brings computer vision to business processes without requiring ML expertise. From retail to manufacturing, AI Builder makes visual AI accessible through the Power Platform.

## Resources

- [Object Detection Documentation](https://docs.microsoft.com/en-us/ai-builder/object-detection-model-in-powerapps)
- [Training Best Practices](https://docs.microsoft.com/en-us/ai-builder/collect-images)

