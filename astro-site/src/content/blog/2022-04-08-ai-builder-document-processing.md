---
title: "Document Processing with AI Builder: From PDFs to Structured Data"
author: Michael John Peña
draft: false
date: 2022-04-08
tags:
  - Power Platform
  - AI Builder
  - Document Processing
  - OCR
  - Automation
---

## Pre-built Document Models

### Invoice Processing

```json
{
    "flow": {
        "trigger": {
            "type": "When_a_file_is_created",
            "inputs": {
                "folderPath": "/Invoices/Incoming"
            }
        },
        "actions": {
            "Process_Invoice": {
                "type": "AIBuilder",
                "inputs": {
                    "model": "prebuilt-invoiceProcessing",
                    "document": "@{triggerBody()}"
                }
            },
            "Extract_Fields": {
                "type": "Compose",
                "inputs": {
                    "vendorName": "@{body('Process_Invoice')?['results']?['VendorName']?['value']}",
                    "vendorAddress": "@{body('Process_Invoice')?['results']?['VendorAddress']?['value']}",
                    "customerName": "@{body('Process_Invoice')?['results']?['CustomerName']?['value']}",
                    "invoiceId": "@{body('Process_Invoice')?['results']?['InvoiceId']?['value']}",
                    "invoiceDate": "@{body('Process_Invoice')?['results']?['InvoiceDate']?['value']}",
                    "dueDate": "@{body('Process_Invoice')?['results']?['DueDate']?['value']}",
                    "subtotal": "@{body('Process_Invoice')?['results']?['SubTotal']?['amount']}",
                    "tax": "@{body('Process_Invoice')?['results']?['TotalTax']?['amount']}",
                    "total": "@{body('Process_Invoice')?['results']?['InvoiceTotal']?['amount']}",
                    "currency": "@{body('Process_Invoice')?['results']?['InvoiceTotal']?['currencyCode']}",
                    "lineItems": "@{body('Process_Invoice')?['results']?['Items']}"
                }
            },
            "Process_Line_Items": {
                "type": "ForEach",
                "foreach": "@outputs('Extract_Fields')?['lineItems']",
                "actions": {
                    "Create_Line_Item": {
                        "type": "CreateRecord",
                        "inputs": {
                            "table": "invoice_line_items",
                            "item": {
                                "description": "@{items('Process_Line_Items')?['Description']?['value']}",
                                "quantity": "@{items('Process_Line_Items')?['Quantity']?['value']}",
                                "unitPrice": "@{items('Process_Line_Items')?['UnitPrice']?['amount']}",
                                "amount": "@{items('Process_Line_Items')?['Amount']?['amount']}"
                            }
                        }
                    }
                }
            }
        }
    }
}
```

### Receipt Processing

```powerfx
// Process receipt in Power Apps
Set(
    ReceiptResult,
    AIBuilder.ReceiptProcessor(CapturedImage)
);

// Display extracted data
MerchantName.Text = ReceiptResult.MerchantName;
MerchantAddress.Text = ReceiptResult.MerchantAddress;
TransactionDate.Text = Text(ReceiptResult.TransactionDate, "[$-en-US]mmm dd, yyyy");
TransactionTime.Text = ReceiptResult.TransactionTime;
Subtotal.Text = Text(ReceiptResult.Subtotal, "$#,##0.00");
Tax.Text = Text(ReceiptResult.Tax, "$#,##0.00");
Total.Text = Text(ReceiptResult.Total, "$#,##0.00");
PaymentMethod.Text = ReceiptResult.PaymentMethod;

// Populate line items gallery
ClearCollect(
    ReceiptItems,
    ReceiptResult.Items
);
```

### ID Document Reader

```json
{
    "actions": {
        "Read_ID_Document": {
            "type": "AIBuilder",
            "inputs": {
                "model": "prebuilt-idDocumentReader",
                "document": "@{body('Get_attachment')}"
            }
        },
        "Extract_Identity_Info": {
            "type": "Compose",
            "inputs": {
                "documentType": "@{body('Read_ID_Document')?['results']?['DocumentType']}",
                "firstName": "@{body('Read_ID_Document')?['results']?['FirstName']?['value']}",
                "lastName": "@{body('Read_ID_Document')?['results']?['LastName']?['value']}",
                "dateOfBirth": "@{body('Read_ID_Document')?['results']?['DateOfBirth']?['value']}",
                "documentNumber": "@{body('Read_ID_Document')?['results']?['DocumentNumber']?['value']}",
                "expirationDate": "@{body('Read_ID_Document')?['results']?['ExpirationDate']?['value']}",
                "address": "@{body('Read_ID_Document')?['results']?['Address']?['value']}",
                "region": "@{body('Read_ID_Document')?['results']?['Region']?['value']}",
                "country": "@{body('Read_ID_Document')?['results']?['Country']?['value']}"
            }
        },
        "Validate_Document": {
            "type": "Condition",
            "expression": {
                "and": [
                    {"greater": ["@body('Read_ID_Document')?['results']?['DocumentNumber']?['confidence']", 0.8]},
                    {"less": ["@outputs('Extract_Identity_Info')?['expirationDate']", "@utcNow()"]}
                ]
            }
        }
    }
}
```

## Custom Form Processing

### Creating a Custom Model

```yaml
# Steps to create custom form processor
steps:
  1_collect_samples:
    - Gather 5-50 sample documents
    - Ensure variety in formatting
    - Include edge cases

  2_create_model:
    - Navigate to AI Builder > Custom models
    - Select "Form processing"
    - Upload sample documents

  3_tag_fields:
    - Draw boxes around fields
    - Name each field consistently
    - Mark tables if present

  4_train_model:
    - Review tagged fields
    - Start training
    - Wait for completion (15-60 minutes)

  5_evaluate_and_publish:
    - Review accuracy metrics
    - Test with new documents
    - Publish when satisfied
```

### Using Custom Model in Flow

```json
{
    "actions": {
        "Process_Custom_Form": {
            "type": "AIBuilder",
            "inputs": {
                "model": "PurchaseOrderProcessor",
                "document": "@{triggerBody()?['attachments']?[0]?['contentBytes']}"
            }
        },
        "Map_To_Entity": {
            "type": "Compose",
            "inputs": {
                "po_number": "@{body('Process_Custom_Form')?['fields']?['PONumber']?['value']}",
                "vendor": "@{body('Process_Custom_Form')?['fields']?['VendorName']?['value']}",
                "order_date": "@{body('Process_Custom_Form')?['fields']?['OrderDate']?['value']}",
                "delivery_date": "@{body('Process_Custom_Form')?['fields']?['DeliveryDate']?['value']}",
                "total": "@{body('Process_Custom_Form')?['fields']?['TotalAmount']?['value']}",
                "confidence": "@{body('Process_Custom_Form')?['overallConfidence']}"
            }
        }
    }
}
```

## Handling Tables in Documents

```json
{
    "actions": {
        "Extract_Table_Data": {
            "type": "AIBuilder",
            "inputs": {
                "model": "InvoiceWithLineItems"
            }
        },
        "Process_Table_Rows": {
            "type": "ForEach",
            "foreach": "@body('Extract_Table_Data')?['tables']?['LineItems']?['rows']",
            "actions": {
                "Create_Line_Record": {
                    "type": "CreateRecord",
                    "inputs": {
                        "table": "order_lines",
                        "item": {
                            "item_code": "@{items('Process_Table_Rows')?['ItemCode']}",
                            "description": "@{items('Process_Table_Rows')?['Description']}",
                            "qty": "@{items('Process_Table_Rows')?['Quantity']}",
                            "price": "@{items('Process_Table_Rows')?['UnitPrice']}",
                            "total": "@{items('Process_Table_Rows')?['LineTotal']}"
                        }
                    }
                }
            }
        }
    }
}
```

## Confidence Handling

```json
{
    "actions": {
        "Check_Confidence": {
            "type": "Condition",
            "expression": {
                "greaterOrEquals": [
                    "@body('Process_Document')?['overallConfidence']",
                    0.85
                ]
            },
            "actions": {
                "High_Confidence_Path": {
                    "Auto_Process": {
                        "type": "CreateRecord",
                        "inputs": {
                            "table": "processed_documents",
                            "status": "Approved"
                        }
                    }
                }
            },
            "else": {
                "actions": {
                    "Low_Confidence_Path": {
                        "Create_Review_Task": {
                            "type": "CreateRecord",
                            "inputs": {
                                "table": "review_queue",
                                "item": {
                                    "document_id": "@{body('Process_Document')?['documentId']}",
                                    "confidence": "@{body('Process_Document')?['overallConfidence']}",
                                    "fields_needing_review": "@{body('Get_Low_Confidence_Fields')}",
                                    "status": "Pending Review"
                                }
                            }
                        },
                        "Notify_Reviewer": {
                            "type": "SendEmail",
                            "inputs": {
                                "to": "reviewers@company.com",
                                "subject": "Document requires review",
                                "body": "Document @{body('Process_Document')?['documentId']} needs manual verification."
                            }
                        }
                    }
                }
            }
        }
    }
}
```

## Human-in-the-Loop Review

```powerfx
// Review screen for low-confidence extractions
Screen: DocumentReviewScreen

// Load document image
DocumentImage.Image = CurrentReview.DocumentImage

// Show extracted values with editable fields
VendorNameText.Default = CurrentReview.ExtractedVendor
VendorNameText.BorderColor = If(
    CurrentReview.VendorConfidence < 0.8,
    Color.Orange,
    Color.Green
)

// Approve with corrections
ApproveButton.OnSelect =
    Patch(
        ProcessedDocuments,
        {ID: CurrentReview.ID},
        {
            VendorName: VendorNameText.Text,
            InvoiceNumber: InvoiceNumberText.Text,
            Amount: Value(AmountText.Text),
            Status: "Approved",
            ReviewedBy: User().Email,
            ReviewedAt: Now()
        }
    );
    // Train model with correction
    AIBuilder.ProvideFeedback(
        CurrentReview.ModelId,
        CurrentReview.DocumentId,
        {
            VendorName: VendorNameText.Text,
            InvoiceNumber: InvoiceNumberText.Text
        }
    );
    Navigate(ReviewListScreen);
```

## Best Practices

### Document Quality

```yaml
document_preparation:
  scan_quality:
    - Minimum 200 DPI resolution
    - Good contrast
    - No skew or rotation
    - Clear, readable text

  file_formats:
    supported:
      - PDF (preferred)
      - JPEG
      - PNG
      - BMP
      - TIFF
    max_size: 20MB
    max_pages: 200

  common_issues:
    - Handwritten text (lower accuracy)
    - Poor scan quality
    - Unusual fonts
    - Complex layouts
```

### Model Improvement

```yaml
continuous_improvement:
  feedback_loop:
    - Collect human corrections
    - Retrain periodically
    - Monitor accuracy trends

  version_management:
    - Test new versions before publishing
    - Keep previous version as fallback
    - Document changes

  monitoring:
    - Track confidence scores over time
    - Identify problematic document types
    - Alert on accuracy degradation
```

## Conclusion

AI Builder document processing transforms manual data entry:
- Pre-built models for common documents
- Custom models for specific formats
- Human-in-the-loop for quality assurance
- Continuous improvement through feedback

Start with pre-built models, then customize as needs evolve.

## Resources

- [Document Processing](https://docs.microsoft.com/en-us/ai-builder/form-processing-model-overview)
- [Invoice Processing](https://docs.microsoft.com/en-us/ai-builder/prebuilt-invoice-processing)
- [Receipt Processing](https://docs.microsoft.com/en-us/ai-builder/prebuilt-receipt-processing)
