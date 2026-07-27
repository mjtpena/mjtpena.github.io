---
title: "Custom Form Processing with AI Builder: Training Your Own Document Models"
author: Michael John Peña
draft: false
date: 2022-04-11
tags:
  - Power Platform
  - AI Builder
  - Form Processing
  - Custom Models
  - Document AI

---

I wrote "Custom Form Processing with AI Builder: Training Your Own Document Models" to share practical, production-minded guidance on this topic.

## When to Use Custom Models

```yaml
use_custom_when:
  - Standard invoices/receipts models don't work
  - You have proprietary form layouts
  - You need specific fields not in pre-built models
  - Document structure varies from standards

examples:
  - Insurance claim forms
  - Medical intake forms
  - Purchase orders (custom format)
  - Government forms
  - Internal company documents
```

## Creating a Custom Model

### Step 1: Collect Training Documents

```yaml
document_requirements:
  minimum: 5 documents
  recommended: 15-50 documents
  variety:
    - Include different layouts within same form type
    - Vary filled-in content
    - Include both good and poor quality scans

formats_supported:
  - PDF (preferred)
  - JPEG
  - PNG
  - TIFF
  - BMP
```

### Step 2: Create and Tag Model

```powershell
# Using Power Platform CLI
pac ai builder model create \
    --name "PurchaseOrderProcessor" \
    --type "FormProcessing" \
    --description "Custom PO processor for Contoso format"

# Upload training documents
pac ai builder model upload-documents \
    --model-id {model-id} \
    --folder "./training-documents"
```

### Step 3: Define Fields

```yaml
# Field definitions for purchase order
fields:
  header_fields:
    - name: PONumber
      type: Text
      required: true

    - name: OrderDate
      type: Date
      required: true

    - name: VendorName
      type: Text
      required: true

    - name: ShipToAddress
      type: Text
      required: false

    - name: TotalAmount
      type: Number
      required: true

  table_fields:
    - name: LineItems
      type: Table
      columns:
        - ItemNumber: Text
        - Description: Text
        - Quantity: Number
        - UnitPrice: Number
        - LineTotal: Number
```

### Step 4: Tag Documents

In AI Builder Studio:
1. Draw rectangles around each field
2. Assign field names to selections
3. Tag table columns and rows
4. Review and confirm tags on each document

### Step 5: Train and Evaluate

```yaml
training_process:
  duration: 15-60 minutes typically
  what_happens:
    - Model learns field positions
    - Extracts text patterns
    - Builds recognition models

evaluation:
  metrics:
    - Per-field accuracy
    - Overall document accuracy
    - Confidence scores
```

## Using the Custom Model

### In Power Automate

```json
{
    "trigger": {
        "type": "When_a_file_is_created",
        "inputs": {
            "folderPath": "/PurchaseOrders/Incoming"
        }
    },
    "actions": {
        "Process_PO_Document": {
            "type": "AIBuilder",
            "inputs": {
                "model": "PurchaseOrderProcessor",
                "document": "@{triggerBody()}"
            }
        },
        "Extract_Header_Fields": {
            "type": "Compose",
            "inputs": {
                "poNumber": "@{body('Process_PO_Document')?['fields']?['PONumber']?['value']}",
                "orderDate": "@{body('Process_PO_Document')?['fields']?['OrderDate']?['value']}",
                "vendorName": "@{body('Process_PO_Document')?['fields']?['VendorName']?['value']}",
                "shipTo": "@{body('Process_PO_Document')?['fields']?['ShipToAddress']?['value']}",
                "total": "@{body('Process_PO_Document')?['fields']?['TotalAmount']?['value']}"
            }
        },
        "Process_Line_Items": {
            "type": "ForEach",
            "foreach": "@body('Process_PO_Document')?['tables']?['LineItems']?['rows']",
            "actions": {
                "Create_PO_Line": {
                    "type": "CreateRecord",
                    "inputs": {
                        "table": "po_line_items",
                        "item": {
                            "po_number": "@{outputs('Extract_Header_Fields')?['poNumber']}",
                            "item_number": "@{items('Process_Line_Items')?['cells']?['ItemNumber']?['value']}",
                            "description": "@{items('Process_Line_Items')?['cells']?['Description']?['value']}",
                            "quantity": "@{items('Process_Line_Items')?['cells']?['Quantity']?['value']}",
                            "unit_price": "@{items('Process_Line_Items')?['cells']?['UnitPrice']?['value']}",
                            "line_total": "@{items('Process_Line_Items')?['cells']?['LineTotal']?['value']}"
                        }
                    }
                }
            }
        }
    }
}
```

### In Power Apps

```powerfx
// Process document
ProcessDocumentBtn.OnSelect =
    Set(
        ProcessedDocument,
        AIBuilder.ExtractFromDocument(
            "PurchaseOrderProcessor",
            UploadedFile.Content
        )
    );

// Display extracted data
PONumberLabel.Text = ProcessedDocument.fields.PONumber.value
OrderDateLabel.Text = Text(DateValue(ProcessedDocument.fields.OrderDate.value), "mm/dd/yyyy")
VendorLabel.Text = ProcessedDocument.fields.VendorName.value
TotalLabel.Text = Text(ProcessedDocument.fields.TotalAmount.value, "$#,##0.00")

// Populate line items gallery
ClearCollect(
    ExtractedLineItems,
    ForAll(
        ProcessedDocument.tables.LineItems.rows,
        {
            ItemNo: ThisRecord.cells.ItemNumber.value,
            Desc: ThisRecord.cells.Description.value,
            Qty: Value(ThisRecord.cells.Quantity.value),
            Price: Value(ThisRecord.cells.UnitPrice.value),
            Total: Value(ThisRecord.cells.LineTotal.value)
        }
    )
)
```

## Handling Multiple Form Versions

```yaml
strategies:
  single_model_multiple_layouts:
    description: Train one model with all variations
    pros:
      - Simple to manage
      - Works well for minor variations
    cons:
      - May reduce accuracy for very different layouts

  separate_models:
    description: Train separate model per form version
    pros:
      - Higher accuracy per form type
      - Clear separation
    cons:
      - More models to manage
      - Need routing logic

  composed_models:
    description: Combine multiple models
    pros:
      - Best of both approaches
      - Automatic form classification
```

## Model Improvement

```powerfx
// Collect feedback for model improvement
ProvideFeedback.OnSelect =
    // User corrects extracted value
    If(
        CorrectedValue <> ExtractedValue,
        AIBuilder.ProvideFeedback(
            ModelId,
            DocumentId,
            {
                FieldName: CorrectedValue
            }
        )
    );

// Periodic retraining with corrections
// Improves model over time
```

## Best Practices

```yaml
training_tips:
  document_selection:
    - Include edge cases
    - Vary filled content
    - Mix scan qualities
    - Include handwriting if expected

  field_tagging:
    - Be consistent with boundaries
    - Include field labels when helpful
    - Tag all instances of repeating fields
    - Review tags before training

  iterative_improvement:
    - Start with minimum documents
    - Test and identify gaps
    - Add documents that address gaps
    - Retrain periodically
```

## Conclusion

Custom form processing enables document automation for any form type. With proper training data and field definition, AI Builder can extract structured data from your specific documents with high accuracy.

## Resources

- [Create Form Processing Model](https://docs.microsoft.com/en-us/ai-builder/create-form-processing-model)
- [Form Processing Best Practices](https://docs.microsoft.com/en-us/ai-builder/before-you-build-form-processing-model)

