---
title: Intelligent Document Processing with Azure Form Recognizer
description: "An accounts payable team I worked with last quarter was processing 4,000 invoices a month by hand—open the PDF, retype line items into the ERP, repeat. The…"
author: Michael John Pena
draft: false
date: 2021-01-18
url: /blog/azure-form-recognizer-document-processing/
tags:
  - Azure
  - Form Recognizer
  - AI
  - Cognitive Services
  - Document Processing
---

An accounts payable team I worked with last quarter was processing 4,000 invoices a month by hand—open the PDF, retype line items into the ERP, repeat. The cost wasn't the data entry; it was the errors. Form Recognizer is the service I built their pilot on. Pre-built models for invoices, receipts, business cards, and IDs; custom models when your form is bespoke; layout API when you just need structure. Today I'm walking through the practical bits—training a custom model, integrating with Logic Apps, and the accuracy tuning that doesn't show up in the marketing.

## Understanding Form Recognizer Models

Form Recognizer offers several pre-built models and the ability to train custom models:

- **Layout API**: Extracts text, tables, and structure
- **Pre-built Models**: Invoice, Receipt, Business Card, ID Document
- **Custom Models**: Train on your specific document types

## Setting Up the Service

```bash
# Create Form Recognizer resource
az cognitiveservices account create \
    --name my-form-recognizer \
    --resource-group my-resource-group \
    --kind FormRecognizer \
    --sku S0 \
    --location eastus
```

## Processing Invoices with Python

Here is a complete example for extracting invoice data:

```python
from azure.ai.formrecognizer import DocumentAnalysisClient
from azure.core.credentials import AzureKeyCredential
import os

endpoint = os.environ["FORM_RECOGNIZER_ENDPOINT"]
key = os.environ["FORM_RECOGNIZER_KEY"]

client = DocumentAnalysisClient(
    endpoint=endpoint,
    credential=AzureKeyCredential(key)
)

def analyze_invoice(invoice_url):
    poller = client.begin_analyze_document_from_url(
        "prebuilt-invoice",
        invoice_url
    )
    result = poller.result()

    invoices = []
    for idx, invoice in enumerate(result.documents):
        invoice_data = {
            "vendor_name": get_field_value(invoice.fields.get("VendorName")),
            "vendor_address": get_field_value(invoice.fields.get("VendorAddress")),
            "customer_name": get_field_value(invoice.fields.get("CustomerName")),
            "invoice_id": get_field_value(invoice.fields.get("InvoiceId")),
            "invoice_date": get_field_value(invoice.fields.get("InvoiceDate")),
            "due_date": get_field_value(invoice.fields.get("DueDate")),
            "subtotal": get_field_value(invoice.fields.get("SubTotal")),
            "total_tax": get_field_value(invoice.fields.get("TotalTax")),
            "invoice_total": get_field_value(invoice.fields.get("InvoiceTotal")),
            "line_items": []
        }

        # Extract line items
        items = invoice.fields.get("Items")
        if items:
            for item in items.value:
                line_item = {
                    "description": get_field_value(item.value.get("Description")),
                    "quantity": get_field_value(item.value.get("Quantity")),
                    "unit_price": get_field_value(item.value.get("UnitPrice")),
                    "amount": get_field_value(item.value.get("Amount"))
                }
                invoice_data["line_items"].append(line_item)

        invoices.append(invoice_data)

    return invoices

def get_field_value(field):
    if field is None:
        return None
    return field.value

# Usage
invoice_url = "https://example.com/invoices/sample.pdf"
extracted_data = analyze_invoice(invoice_url)
print(json.dumps(extracted_data, indent=2, default=str))
```

## Training Custom Models

When pre-built models do not fit your needs, train custom models on your document types:

```python
from azure.ai.formrecognizer import DocumentModelAdministrationClient
from azure.core.credentials import AzureKeyCredential

admin_client = DocumentModelAdministrationClient(
    endpoint=endpoint,
    credential=AzureKeyCredential(key)
)

def train_custom_model(training_data_url, model_id):
    """
    Train a custom model using labeled training data.
    Training data should be in Azure Blob Storage with a properly
    formatted .ocr.json file for each document.
    """
    poller = admin_client.begin_build_document_model(
        build_mode="template",
        blob_container_url=training_data_url,
        model_id=model_id,
        description="Custom purchase order model"
    )

    model = poller.result()

    print(f"Model ID: {model.model_id}")
    print(f"Description: {model.description}")
    print(f"Created on: {model.created_on}")

    print("Document types:")
    for doc_type, doc_type_info in model.doc_types.items():
        print(f"  Document type: {doc_type}")
        for field_name, field in doc_type_info.field_schema.items():
            print(f"    Field: {field_name} ({field['type']})")

    return model

# Train the model
training_url = "https://mystorageaccount.blob.core.windows.net/training-data?sas_token"
model = train_custom_model(training_url, "purchase-order-model-v1")
```

## Building an Invoice Processing Pipeline

Here is a complete C# implementation for an Azure Function-based invoice processing pipeline:

```csharp
using Azure;
using Azure.AI.FormRecognizer.DocumentAnalysis;
using Azure.Storage.Blobs;
using Microsoft.Azure.WebJobs;
using Microsoft.Extensions.Logging;
using System.Text.Json;

public class InvoiceProcessor
{
    private readonly DocumentAnalysisClient _formRecognizerClient;
    private readonly BlobServiceClient _blobServiceClient;

    public InvoiceProcessor()
    {
        var endpoint = Environment.GetEnvironmentVariable("FORM_RECOGNIZER_ENDPOINT");
        var key = Environment.GetEnvironmentVariable("FORM_RECOGNIZER_KEY");

        _formRecognizerClient = new DocumentAnalysisClient(
            new Uri(endpoint),
            new AzureKeyCredential(key)
        );

        _blobServiceClient = new BlobServiceClient(
            Environment.GetEnvironmentVariable("STORAGE_CONNECTION_STRING")
        );
    }

    [FunctionName("ProcessInvoice")]
    public async Task Run(
        [BlobTrigger("invoices/{name}", Connection = "STORAGE_CONNECTION_STRING")]
        Stream invoiceStream,
        string name,
        ILogger log)
    {
        log.LogInformation($"Processing invoice: {name}");

        try
        {
            // Analyze the document
            var operation = await _formRecognizerClient.AnalyzeDocumentAsync(
                WaitUntil.Completed,
                "prebuilt-invoice",
                invoiceStream
            );

            var result = operation.Value;

            foreach (var document in result.Documents)
            {
                var invoice = ExtractInvoiceData(document);

                // Save processed data
                await SaveProcessedInvoice(invoice, name, log);

                // Trigger downstream processing
                await TriggerApprovalWorkflow(invoice, log);
            }
        }
        catch (Exception ex)
        {
            log.LogError(ex, $"Error processing invoice {name}");
            await MoveToErrorQueue(name, ex.Message);
        }
    }

    private InvoiceData ExtractInvoiceData(AnalyzedDocument document)
    {
        return new InvoiceData
        {
            VendorName = GetFieldString(document, "VendorName"),
            VendorAddress = GetFieldString(document, "VendorAddress"),
            CustomerName = GetFieldString(document, "CustomerName"),
            InvoiceId = GetFieldString(document, "InvoiceId"),
            InvoiceDate = GetFieldDate(document, "InvoiceDate"),
            DueDate = GetFieldDate(document, "DueDate"),
            SubTotal = GetFieldCurrency(document, "SubTotal"),
            TotalTax = GetFieldCurrency(document, "TotalTax"),
            InvoiceTotal = GetFieldCurrency(document, "InvoiceTotal"),
            LineItems = ExtractLineItems(document)
        };
    }

    private string GetFieldString(AnalyzedDocument doc, string fieldName)
    {
        if (doc.Fields.TryGetValue(fieldName, out var field))
        {
            return field.Value.AsString();
        }
        return null;
    }

    private DateTime? GetFieldDate(AnalyzedDocument doc, string fieldName)
    {
        if (doc.Fields.TryGetValue(fieldName, out var field))
        {
            return field.Value.AsDate();
        }
        return null;
    }

    private decimal? GetFieldCurrency(AnalyzedDocument doc, string fieldName)
    {
        if (doc.Fields.TryGetValue(fieldName, out var field))
        {
            return (decimal?)field.Value.AsCurrency().Amount;
        }
        return null;
    }

    private List<LineItem> ExtractLineItems(AnalyzedDocument doc)
    {
        var items = new List<LineItem>();

        if (doc.Fields.TryGetValue("Items", out var itemsField))
        {
            foreach (var item in itemsField.Value.AsList())
            {
                var itemDict = item.Value.AsDictionary();
                items.Add(new LineItem
                {
                    Description = itemDict.TryGetValue("Description", out var desc)
                        ? desc.Value.AsString() : null,
                    Quantity = itemDict.TryGetValue("Quantity", out var qty)
                        ? (decimal?)qty.Value.AsDouble() : null,
                    UnitPrice = itemDict.TryGetValue("UnitPrice", out var price)
                        ? (decimal?)price.Value.AsCurrency().Amount : null,
                    Amount = itemDict.TryGetValue("Amount", out var amount)
                        ? (decimal?)amount.Value.AsCurrency().Amount : null
                });
            }
        }

        return items;
    }

    private async Task SaveProcessedInvoice(InvoiceData invoice, string originalName, ILogger log)
    {
        var container = _blobServiceClient.GetBlobContainerClient("processed-invoices");
        var blobName = $"{Path.GetFileNameWithoutExtension(originalName)}.json";
        var blob = container.GetBlobClient(blobName);

        var json = JsonSerializer.Serialize(invoice, new JsonSerializerOptions
        {
            WriteIndented = true
        });

        await blob.UploadAsync(new BinaryData(json), overwrite: true);
        log.LogInformation($"Saved processed invoice to {blobName}");
    }

    private async Task TriggerApprovalWorkflow(InvoiceData invoice, ILogger log)
    {
        // Integration with Power Automate or Logic Apps
        // Send to approval queue based on amount thresholds
        if (invoice.InvoiceTotal > 10000)
        {
            log.LogInformation($"Invoice {invoice.InvoiceId} requires executive approval");
            // Trigger high-value approval workflow
        }
    }
}

public class InvoiceData
{
    public string VendorName { get; set; }
    public string VendorAddress { get; set; }
    public string CustomerName { get; set; }
    public string InvoiceId { get; set; }
    public DateTime? InvoiceDate { get; set; }
    public DateTime? DueDate { get; set; }
    public decimal? SubTotal { get; set; }
    public decimal? TotalTax { get; set; }
    public decimal? InvoiceTotal { get; set; }
    public List<LineItem> LineItems { get; set; }
}

public class LineItem
{
    public string Description { get; set; }
    public decimal? Quantity { get; set; }
    public decimal? UnitPrice { get; set; }
    public decimal? Amount { get; set; }
}
```

## Confidence Scores and Human Review

Form Recognizer provides confidence scores for each extracted field. Implement human review for low-confidence extractions:

```python
def process_with_confidence_check(result, confidence_threshold=0.8):
    """
    Process results and flag low-confidence fields for human review.
    """
    for document in result.documents:
        review_required = []

        for field_name, field in document.fields.items():
            if field.confidence < confidence_threshold:
                review_required.append({
                    "field": field_name,
                    "extracted_value": field.value,
                    "confidence": field.confidence,
                    "bounding_regions": field.bounding_regions
                })

        if review_required:
            # Queue for human review
            send_to_review_queue(document, review_required)
        else:
            # Auto-process high-confidence documents
            auto_process_document(document)
```

## Performance Tips

1. **Batch Processing**: Use async operations for processing multiple documents
2. **Model Selection**: Use pre-built models when possible; they are optimized and require no training
3. **Image Quality**: Ensure documents are at least 50x50 pixels and less than 10,000x10,000
4. **File Formats**: PDF, JPEG, PNG, BMP, and TIFF are supported

Azure Form Recognizer significantly reduces the manual effort in document processing while maintaining high accuracy. Combined with Azure Functions and Logic Apps, you can build end-to-end intelligent document processing pipelines.
