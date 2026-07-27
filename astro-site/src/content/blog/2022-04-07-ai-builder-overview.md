---
title: "AI Builder: No-Code AI for the Power Platform"
author: Michael John Peña
draft: false
date: 2022-04-07
tags:
  - Power Platform
  - AI Builder
  - AI
  - Machine Learning
  - Low-Code

---

I wrote "AI Builder: No-Code AI for the Power Platform" to share practical, production-minded guidance on this topic.

## AI Builder Capabilities

### Pre-built Models

Ready-to-use AI that requires no training:

```yaml
prebuilt_models:
  document_processing:
    - Invoice processing
    - Receipt processing
    - ID document reader
    - Business card reader

  text_analysis:
    - Sentiment analysis
    - Key phrase extraction
    - Language detection
    - Entity extraction
    - Text recognition (OCR)

  vision:
    - Object detection
    - Text recognition in images

  language:
    - Category classification
```

### Custom Models

Train models on your own data:

```yaml
custom_models:
  - Object detection (custom)
  - Form processing (custom)
  - Prediction (classification/regression)
  - Category classification (custom)
  - Entity extraction (custom)
```

## Using Pre-built Models

### In Power Apps

```powerfx
// Analyze sentiment
Set(
    SentimentResult,
    AIBuilder.AnalyzeSentiment(TextInput.Text)
);

// Display results
Label.Text = If(
    SentimentResult.sentiment = "positive",
    "Customer is happy! 😊",
    If(
        SentimentResult.sentiment = "negative",
        "Customer may need attention 😟",
        "Neutral feedback"
    )
)

// Process business card
Set(
    BusinessCardData,
    AIBuilder.BusinessCardReader(CapturedImage)
);

// Extract fields
ContactName.Text = BusinessCardData.CleanedName
ContactEmail.Text = BusinessCardData.Email
ContactPhone.Text = BusinessCardData.Phone
ContactCompany.Text = BusinessCardData.CompanyName
```

### In Power Automate

```json
{
    "actions": {
        "Extract_invoice_data": {
            "type": "ApiConnection",
            "inputs": {
                "host": {
                    "connection": {
                        "name": "@parameters('$connections')['aibuilder']['connectionId']"
                    }
                },
                "method": "post",
                "path": "/v1.0/predict",
                "body": {
                    "modelId": "prebuilt-invoiceProcessing",
                    "input": "@{body('Get_file_content')}"
                }
            }
        },
        "Store_extracted_data": {
            "type": "ApiConnection",
            "inputs": {
                "method": "post",
                "path": "/v2/datasets/@{encodeURIComponent('default.cds')}/tables/@{encodeURIComponent('invoices')}/items",
                "body": {
                    "vendor_name": "@{body('Extract_invoice_data')?['results']?['VendorName']?['value']}",
                    "invoice_number": "@{body('Extract_invoice_data')?['results']?['InvoiceId']?['value']}",
                    "total_amount": "@{body('Extract_invoice_data')?['results']?['InvoiceTotal']?['amount']}",
                    "due_date": "@{body('Extract_invoice_data')?['results']?['DueDate']?['value']}",
                    "confidence": "@{body('Extract_invoice_data')?['results']?['InvoiceTotal']?['confidence']}"
                }
            }
        }
    }
}
```

## Building Custom Models

### Prediction Model

```yaml
# Train a customer churn prediction model
model:
  type: Prediction
  name: CustomerChurnPrediction
  target: ChurnedWithin30Days  # Boolean column

training_data:
  table: Customers
  columns:
    - TotalOrders
    - LifetimeValue
    - DaysSinceLastOrder
    - SupportTicketCount
    - EmailOpenRate
    - ProductCategory

configuration:
  training_percentage: 80
  evaluation_percentage: 20
```

### Form Processing Model

```yaml
# Create custom document processor
model:
  type: FormProcessing
  name: PurchaseOrderProcessor

documents:
  # Upload 5+ sample documents
  samples:
    - PO_sample_1.pdf
    - PO_sample_2.pdf
    - PO_sample_3.pdf
    - PO_sample_4.pdf
    - PO_sample_5.pdf

fields_to_extract:
  - name: PONumber
    type: Text
  - name: VendorName
    type: Text
  - name: OrderDate
    type: Date
  - name: DeliveryDate
    type: Date
  - name: TotalAmount
    type: Number
  - name: LineItems
    type: Table
    columns:
      - Description
      - Quantity
      - UnitPrice
      - Amount
```

### Object Detection Model

```yaml
# Train custom object detection
model:
  type: ObjectDetection
  name: ProductShelfAnalysis

objects:
  - name: ProductA
    min_samples: 15
  - name: ProductB
    min_samples: 15
  - name: EmptySpace
    min_samples: 10

training:
  images: 50+  # Varied angles, lighting
  annotations: Bounding boxes for each object

output:
  - Detected objects
  - Bounding box coordinates
  - Confidence scores
```

## Model Training and Publishing

```powershell
# PowerShell for AI Builder administration
# Get available models
Get-AIPredictionModel -EnvironmentName "Default-{tenant}"

# Publish model
Publish-AIPredictionModel `
    -ModelId "{model-id}" `
    -EnvironmentName "Default-{tenant}"

# Get model metrics
Get-AIPredictionModelMetrics `
    -ModelId "{model-id}" `
    -EnvironmentName "Default-{tenant}"
```

## Best Practices

### Data Quality

```yaml
training_data_guidelines:
  prediction_models:
    - Minimum 50 rows (1000+ recommended)
    - Balanced classes for classification
    - Clean, consistent data
    - Representative of production data

  form_processing:
    - Minimum 5 documents per form type
    - Varied formats within type
    - Clear, readable scans
    - Consistent field locations

  object_detection:
    - Minimum 15 images per object
    - Varied backgrounds and lighting
    - Multiple angles
    - Realistic scenarios
```

### Model Evaluation

```yaml
evaluation_metrics:
  prediction:
    - Accuracy: Overall correctness
    - Precision: True positive rate
    - Recall: Detection rate
    - F1 Score: Balanced metric

  form_processing:
    - Field accuracy per field
    - Overall document accuracy
    - Confidence distribution

  object_detection:
    - Mean Average Precision (mAP)
    - Per-class accuracy
    - False positive rate
```

## Integration Patterns

### Document Processing Pipeline

```
1. Document arrives (email, upload, scan)
2. Power Automate triggered
3. AI Builder extracts data
4. Validation rules applied
5. Human review for low confidence
6. Data stored in Dataverse
7. Downstream processes triggered
```

### Prediction Integration

```powerfx
// Real-time prediction in Power Apps
Button.OnSelect = Set(
    ChurnRisk,
    AIBuilder.Predict(
        ChurnPredictionModel,
        {
            TotalOrders: Customer.OrderCount,
            LifetimeValue: Customer.TotalSpend,
            DaysSinceLastOrder: Customer.DaysSinceOrder,
            SupportTicketCount: Customer.OpenTickets
        }
    )
);

// Display risk
If(
    ChurnRisk.Probability > 0.7,
    Navigate(HighRiskScreen),
    If(
        ChurnRisk.Probability > 0.4,
        Navigate(MediumRiskScreen),
        Navigate(LowRiskScreen)
    )
)
```

## Conclusion

AI Builder makes AI accessible:
- Pre-built models for common scenarios
- Custom models without coding
- Deep Power Platform integration
- Continuous improvement through feedback

It's ideal for organizations wanting AI capabilities without building a data science team.

## Resources

- [AI Builder Documentation](https://docs.microsoft.com/en-us/ai-builder/)
- [Model Types](https://docs.microsoft.com/en-us/ai-builder/model-types)
- [Best Practices](https://docs.microsoft.com/en-us/ai-builder/before-you-build-form-processing-model)

