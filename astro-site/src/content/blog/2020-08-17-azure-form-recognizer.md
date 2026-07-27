---
title: "Extracting Data from Documents with Azure Form Recognizer"
author: Michael John Peña
draft: false
date: 2020-08-17
tags:
  - Azure
  - AI
  - Cognitive Services
  - Document Processing
---

Every accounts payable team I've ever talked to has a person whose job is, in part, retyping data from PDF invoices into an ERP. It's exhausting work, the error rate is real, and it scales linearly with invoice volume. Form Recognizer is the boring, useful AI service that makes that job go away — or at least makes it 80% review instead of 100% data entry. Prebuilt models for invoices, receipts, IDs, business cards; custom models when you have weird internal forms. Here's how I integrate it.

## What Form Recognizer Can Do

- **Prebuilt models** - For receipts, invoices, business cards, IDs
- **Layout extraction** - Tables, text, selection marks
- **Custom models** - Train on your specific document types

## Creating the Resource

```bash
# Create Form Recognizer resource
az cognitiveservices account create \
    --name form-recognizer-2020 \
    --resource-group rg-cognitive \
    --kind FormRecognizer \
    --sku S0 \
    --location australiaeast \
    --yes

# Get the endpoint and key
az cognitiveservices account show \
    --name form-recognizer-2020 \
    --resource-group rg-cognitive \
    --query properties.endpoint

az cognitiveservices account keys list \
    --name form-recognizer-2020 \
    --resource-group rg-cognitive
```

## .NET SDK Setup

```bash
dotnet add package Azure.AI.FormRecognizer
```

## Analyzing Receipts

```csharp
using Azure;
using Azure.AI.FormRecognizer;
using Azure.AI.FormRecognizer.Models;

public class ReceiptProcessor
{
    private readonly FormRecognizerClient _client;

    public ReceiptProcessor(string endpoint, string key)
    {
        var credential = new AzureKeyCredential(key);
        _client = new FormRecognizerClient(new Uri(endpoint), credential);
    }

    public async Task<ReceiptData> ProcessReceiptAsync(Stream receiptStream)
    {
        var options = new RecognizeReceiptsOptions { Locale = "en-AU" };

        var operation = await _client.StartRecognizeReceiptsAsync(receiptStream, options);
        var receipts = await operation.WaitForCompletionAsync();

        var receipt = receipts.Value.FirstOrDefault();
        if (receipt == null) return null;

        var result = new ReceiptData();

        if (receipt.Fields.TryGetValue("MerchantName", out var merchantName))
        {
            result.MerchantName = merchantName.Value.AsString();
        }

        if (receipt.Fields.TryGetValue("TransactionDate", out var date))
        {
            result.TransactionDate = date.Value.AsDate();
        }

        if (receipt.Fields.TryGetValue("Total", out var total))
        {
            result.Total = total.Value.AsFloat();
        }

        if (receipt.Fields.TryGetValue("Items", out var items))
        {
            result.Items = items.Value.AsList()
                .Select(item =>
                {
                    var fields = item.Value.AsDictionary();
                    return new ReceiptItem
                    {
                        Name = fields.TryGetValue("Name", out var name) ? name.Value.AsString() : null,
                        Quantity = fields.TryGetValue("Quantity", out var qty) ? qty.Value.AsFloat() : 1,
                        Price = fields.TryGetValue("Price", out var price) ? price.Value.AsFloat() : 0
                    };
                })
                .ToList();
        }

        return result;
    }
}

public class ReceiptData
{
    public string MerchantName { get; set; }
    public DateTime? TransactionDate { get; set; }
    public float? Total { get; set; }
    public List<ReceiptItem> Items { get; set; } = new List<ReceiptItem>();
}

public class ReceiptItem
{
    public string Name { get; set; }
    public float? Quantity { get; set; }
    public float? Price { get; set; }
}
```

## Analyzing Invoices

```csharp
public async Task<InvoiceData> ProcessInvoiceAsync(Uri invoiceUri)
{
    var operation = await _client.StartRecognizeInvoicesFromUriAsync(invoiceUri);
    var invoices = await operation.WaitForCompletionAsync();

    var invoice = invoices.Value.FirstOrDefault();
    if (invoice == null) return null;

    var result = new InvoiceData();

    if (invoice.Fields.TryGetValue("VendorName", out var vendor))
        result.VendorName = vendor.Value.AsString();

    if (invoice.Fields.TryGetValue("InvoiceId", out var invoiceId))
        result.InvoiceNumber = invoiceId.Value.AsString();

    if (invoice.Fields.TryGetValue("InvoiceDate", out var invoiceDate))
        result.InvoiceDate = invoiceDate.Value.AsDate();

    if (invoice.Fields.TryGetValue("InvoiceTotal", out var total))
        result.Total = total.Value.AsFloat();

    if (invoice.Fields.TryGetValue("Items", out var items))
    {
        result.LineItems = items.Value.AsList()
            .Select(item =>
            {
                var fields = item.Value.AsDictionary();
                return new InvoiceLineItem
                {
                    Description = fields.TryGetValue("Description", out var desc) ? desc.Value.AsString() : null,
                    Quantity = fields.TryGetValue("Quantity", out var qty) ? qty.Value.AsFloat() : 1,
                    UnitPrice = fields.TryGetValue("UnitPrice", out var price) ? price.Value.AsFloat() : 0,
                    Amount = fields.TryGetValue("Amount", out var amount) ? amount.Value.AsFloat() : 0
                };
            })
            .ToList();
    }

    return result;
}
```

## Training Custom Models

For documents specific to your business:

```csharp
public class CustomModelTrainer
{
    private readonly FormTrainingClient _trainingClient;

    public CustomModelTrainer(string endpoint, string key)
    {
        var credential = new AzureKeyCredential(key);
        _trainingClient = new FormTrainingClient(new Uri(endpoint), credential);
    }

    public async Task<string> TrainModelAsync(Uri trainingDataUri)
    {
        // Training data should be in Azure Blob Storage with labeled data
        var operation = await _trainingClient.StartTrainingAsync(
            trainingDataUri,
            useTrainingLabels: true,
            new TrainingOptions
            {
                ModelDisplayName = "MyCustomInvoiceModel"
            });

        var model = await operation.WaitForCompletionAsync();

        Console.WriteLine($"Model ID: {model.Value.ModelId}");
        Console.WriteLine($"Status: {model.Value.Status}");

        foreach (var submodel in model.Value.Submodels)
        {
            Console.WriteLine($"Form type: {submodel.FormType}");
            foreach (var field in submodel.Fields)
            {
                Console.WriteLine($"  Field: {field.Key}, Accuracy: {field.Value.Accuracy}");
            }
        }

        return model.Value.ModelId;
    }
}
```

## Using Custom Models

```csharp
public async Task<Dictionary<string, string>> AnalyzeWithCustomModelAsync(
    string modelId,
    Stream documentStream)
{
    var operation = await _client.StartRecognizeCustomFormsAsync(
        modelId,
        documentStream);

    var forms = await operation.WaitForCompletionAsync();
    var form = forms.Value.FirstOrDefault();

    var result = new Dictionary<string, string>();

    foreach (var field in form.Fields)
    {
        var value = field.Value.ValueData?.Text ?? field.Value.Value?.ToString();
        result[field.Key] = value;

        Console.WriteLine($"{field.Key}: {value} (confidence: {field.Value.Confidence})");
    }

    return result;
}
```

## Layout Analysis

Extract tables and structure:

```csharp
public async Task<LayoutResult> AnalyzeLayoutAsync(Stream documentStream)
{
    var operation = await _client.StartRecognizeContentAsync(documentStream);
    var pages = await operation.WaitForCompletionAsync();

    var result = new LayoutResult();

    foreach (var page in pages.Value)
    {
        // Extract tables
        foreach (var table in page.Tables)
        {
            var tableData = new TableData
            {
                RowCount = table.RowCount,
                ColumnCount = table.ColumnCount
            };

            foreach (var cell in table.Cells)
            {
                tableData.Cells.Add(new CellData
                {
                    RowIndex = cell.RowIndex,
                    ColumnIndex = cell.ColumnIndex,
                    Text = cell.Text
                });
            }

            result.Tables.Add(tableData);
        }

        // Extract text lines
        foreach (var line in page.Lines)
        {
            result.TextLines.Add(line.Text);
        }
    }

    return result;
}
```

## What I tell clients before they start

- **Confidence scores are not optional.** Below a threshold (I usually start at 0.75 for invoices, higher for compliance-sensitive fields), the document goes to human review. The point is not to remove humans — it's to remove the *typing*.
- **Prebuilt invoice model first, custom model only if it fails.** The prebuilt is updated by Microsoft against millions of invoices and will outperform a custom model trained on a few dozen samples.
- **Image quality is the silent killer.** Phone photos at an angle, faxed scans at 200dpi grayscale — accuracy collapses. Worth budgeting for a decent scanner or capture app.
- **Stage the rollout.** Run Form Recognizer in shadow mode for a month — extract data, but compare against what humans typed. You learn the failure modes before you bet a process on them.

Form Recognizer is one of the AI services with the clearest ROI, and the failure modes are well understood. Invoice processing was the first AI workload I deployed for a client where the savings were obvious within a month.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
