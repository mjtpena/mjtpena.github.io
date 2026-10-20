---
title: "Form Recognizer v2.0 in .NET: Receipts, Layout and Custom Models"
description: "Using the Form Recognizer v2.0 API from .NET: prebuilt receipts, layout tables, and custom models with and without labels, plus where each one falls short."
author: Michael John Peña
draft: false
date: 2020-08-17
tags:
  - Azure
  - Cognitive Services
  - Form Recognizer
  - Document Processing
  - .NET
---

Most accounts payable teams I've talked to have someone whose job is, in part, retyping data from PDFs into an ERP. The work is tedious, it produces real errors, and the effort grows in step with document volume. Form Recognizer won't remove that person, but it can turn their day from 100% data entry into mostly review. That's only true if you pick the right model for each document type and design for the cases where extraction is wrong.

The v2.0 API is GA, but the .NET SDK is still in preview, and that gap shapes how you should build.

## What v2.0 actually gives you

The v2.0 REST API is generally available, and it has four capabilities. Being clear about which one you're using matters more than any code:

| Capability | What it returns | Training needed | Good fit |
|---|---|---|---|
| Layout | Text lines, tables, bounding boxes | None | Pulling tables out of documents you parse yourself |
| Prebuilt receipt | Merchant, date, total, tax, line items | None | US English sales receipts (expenses, reimbursements) |
| Custom, without labels | Key-value pairs and tables the model discovers | At least five filled-in forms of one type | Fixed-layout forms where the labels sit beside the values |
| Custom, with labels | The fields you tagged | At least five tagged forms per layout | Anything where you need specific, named fields |

It's just as important to know what's missing. There's **no prebuilt invoice model** today. To process invoices, you either train a custom model per supplier layout, or you run Layout and write your own parsing over the text and tables. The receipt model is trained on US sales receipts. It will often read an Australian receipt, but don't treat it as supported for anything outside its stated scope until Microsoft says it is.

Input formats are JPEG, PNG, PDF and TIFF. Scanned PDFs work. So do PDFs with an embedded text layer, which are usually the most accurate. In v2.0, Layout and custom models support English documents only. Images must be at least 50 x 50 pixels, and the free tier caps files at 4 MB; check the [input requirements](https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/how-to-guides/build-a-custom-model?view=doc-intel-2.1.0) for S0 limits before you design around large scans.

## The .NET SDK is still a moving target

The new track-2 library, `Azure.AI.FormRecognizer`, replaces the older `Microsoft.Azure.CognitiveServices.FormRecognizer` package. It has been through several previews since April. The current release is `3.0.0-preview.1` from 11 August, which is the first one to target the GA v2.0 API rather than the v2.0 preview. The [SDK changelog](https://github.com/Azure/azure-sdk-for-net/blob/main/sdk/formrecognizer/Azure.AI.FormRecognizer/CHANGELOG.md) shows renamed parameters, types and enum values in almost every preview. Pin the exact version, and expect small edits when you move to the stable release.

```bash
dotnet add package Azure.AI.FormRecognizer --version 3.0.0-preview.1
```

The library has two clients. `FormRecognizerClient` handles analysis (layout, receipts, custom forms). `FormTrainingClient` trains and manages custom models. Both use the same endpoint and key.

## Creating the resource

```bash
az cognitiveservices account create \
    --name <your-resource-name> \
    --resource-group <your-resource-group> \
    --kind FormRecognizer \
    --sku S0 \
    --location <your-region> \
    --yes

az cognitiveservices account show \
    --name <your-resource-name> \
    --resource-group <your-resource-group> \
    --query properties.endpoint

az cognitiveservices account keys list \
    --name <your-resource-name> \
    --resource-group <your-resource-group>
```

The free F0 tier is fine for experiments, but it only processes the first two pages of each document ([input requirements](https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/how-to-guides/build-a-custom-model?view=doc-intel-2.1.0)). Test multi-page documents on S0 so the results reflect production behaviour. Keep the key in Key Vault or app settings, never in source. The resource and key handling work the same way as the other Cognitive Services; I covered that setup in more detail in the [Text Analytics post](/blog/2020-08-05-azure-cognitive-services-text-analytics/).

## Receipts: the prebuilt model

Every call is a long-running operation: you submit the document, then poll for the result. The SDK wraps that in an `Operation<T>`. One detail catches people out. Each `FormField` holds a `FieldValue`, and the `AsFloat()`, `AsDate()` and similar methods throw if the value isn't that type. When the model can't normalise a total, you get a string back, not a float. Check `ValueType` before you convert.

```csharp
using System;
using System.Collections.Generic;
using System.IO;
using System.Threading.Tasks;
using Azure;
using Azure.AI.FormRecognizer;
using Azure.AI.FormRecognizer.Models;

class Program
{
    static async Task Main(string[] args)
    {
        var endpoint = new Uri(Environment.GetEnvironmentVariable("FORM_RECOGNIZER_ENDPOINT"));
        var credential = new AzureKeyCredential(Environment.GetEnvironmentVariable("FORM_RECOGNIZER_KEY"));
        var client = new FormRecognizerClient(endpoint, credential);

        using FileStream receiptStream = File.OpenRead(args[0]);
        RecognizeReceiptsOperation operation = await client.StartRecognizeReceiptsAsync(receiptStream);
        Response<RecognizedFormCollection> response = await operation.WaitForCompletionAsync();

        foreach (RecognizedForm receipt in response.Value)
        {
            Console.WriteLine($"Merchant: {GetString(receipt.Fields, "MerchantName")}");
            Console.WriteLine($"Date:     {GetDate(receipt.Fields, "TransactionDate"):yyyy-MM-dd}");
            Console.WriteLine($"Total:    {GetFloat(receipt.Fields, "Total")}");

            if (receipt.Fields.TryGetValue("Total", out FormField total))
            {
                Console.WriteLine($"Total confidence: {total.Confidence:F2}");
            }

            if (receipt.Fields.TryGetValue("Items", out FormField items)
                && items.Value.ValueType == FieldValueType.List)
            {
                foreach (FormField item in items.Value.AsList())
                {
                    var itemFields = item.Value.AsDictionary();
                    Console.WriteLine(
                        $"  {GetString(itemFields, "Name")} x{GetFloat(itemFields, "Quantity") ?? 1} = {GetFloat(itemFields, "TotalPrice")}");
                }
            }
        }
    }

    static string GetString(IReadOnlyDictionary<string, FormField> fields, string name) =>
        fields.TryGetValue(name, out FormField f) && f.Value.ValueType == FieldValueType.String
            ? f.Value.AsString()
            : null;

    static float? GetFloat(IReadOnlyDictionary<string, FormField> fields, string name) =>
        fields.TryGetValue(name, out FormField f) && f.Value.ValueType == FieldValueType.Float
            ? f.Value.AsFloat()
            : (float?)null;

    static DateTime? GetDate(IReadOnlyDictionary<string, FormField> fields, string name) =>
        fields.TryGetValue(name, out FormField f) && f.Value.ValueType == FieldValueType.Date
            ? f.Value.AsDate()
            : (DateTime?)null;
}
```

Every field has a `Confidence` score, and that number belongs in your data model, not just your logs. More on that below.

## Layout: the underrated one

Layout gets less attention than the prebuilt and custom models. It's the one I'd reach for first when documents come from many sources and only a few values matter. It returns every line of text and every table it finds, cell by cell, with no training at all. For invoices from dozens of suppliers, running Layout and then matching a few anchors ("Total", "ABN", "Invoice No") is often less work than maintaining dozens of custom models.

This is a fragment for the receipt program's `Main`, after the receipt code. It reuses `client` and uses new variable names so it compiles alongside it:

```csharp
using FileStream documentStream = File.OpenRead("<path-to-document.pdf>");
RecognizeContentOperation contentOperation = await client.StartRecognizeContentAsync(documentStream);
Response<FormPageCollection> pages = await contentOperation.WaitForCompletionAsync();

foreach (FormPage page in pages.Value)
{
    Console.WriteLine($"Page {page.PageNumber}: {page.Lines.Count} lines, {page.Tables.Count} tables");

    foreach (FormTable table in page.Tables)
    {
        Console.WriteLine($"  Table {table.RowCount} x {table.ColumnCount}");
        foreach (FormTableCell cell in table.Cells)
        {
            Console.WriteLine($"    [{cell.RowIndex},{cell.ColumnIndex}] {cell.Text}");
        }
    }
}
```

The trade-off is that you own the parsing logic. That's fine when the anchors are stable. It's a bad deal when every supplier writes "Total" differently and puts it in a different place. The other side of the ledger is cost and upkeep. Custom-model analysis is priced per page at a higher rate than Layout, so check the S0 rates for your region before you commit to one model per supplier. Every per-supplier model also needs its own retraining and monitoring as that supplier's layout drifts, so fifty suppliers means fifty models to look after.

## Custom models: with labels or without

Custom training reads from an Azure Blob Storage container, and you need [at least five completed forms of the same type](https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/how-to-guides/build-a-custom-model?view=doc-intel-2.1.0). You pass a container SAS URL with read and list permissions. You choose between two modes with a single boolean, and they behave very differently.

**Without labels** (`useTrainingLabels: false`), the service clusters your documents by layout and learns key-value pairs on its own. The fields come back with generated names like `field-0`, and the key text it found sits in `LabelData`. It works best when every label sits above or to the left of its value. You get no say over which fields are extracted.

**With labels** (`useTrainingLabels: true`), you tag the fields you want using the [Form OCR Testing Tool (sample labeling tool)](https://github.com/microsoft/OCR-Form-Tools). It writes `.labels.json` and `.ocr.json` files next to each document in the container. Fields come back under the names you chose, and the trained model reports an estimated accuracy per field. For production work this is the mode I'd use almost every time. The tagging effort is small, and named fields with known accuracy are far easier to build a workflow on.

The training program below has its own `Main`, so put it in a separate console project (or rename `Main`) rather than alongside the receipt program.

```csharp
using System;
using System.Threading.Tasks;
using Azure;
using Azure.AI.FormRecognizer.Training;

class Trainer
{
    static async Task Main()
    {
        var endpoint = new Uri(Environment.GetEnvironmentVariable("FORM_RECOGNIZER_ENDPOINT"));
        var credential = new AzureKeyCredential(Environment.GetEnvironmentVariable("FORM_RECOGNIZER_KEY"));
        var trainingClient = new FormTrainingClient(endpoint, credential);

        var trainingFilesUri = new Uri("<your-container-sas-url>");

        TrainingOperation operation = await trainingClient.StartTrainingAsync(trainingFilesUri, useTrainingLabels: true);
        Response<CustomFormModel> response = await operation.WaitForCompletionAsync();
        CustomFormModel model = response.Value;

        Console.WriteLine($"Model ID: {model.ModelId}, status: {model.Status}");

        foreach (CustomFormSubmodel submodel in model.Submodels)
        {
            Console.WriteLine($"Form type: {submodel.FormType}");
            foreach (var field in submodel.Fields)
            {
                Console.WriteLine($"  {field.Key}: estimated accuracy {field.Value.Accuracy:F2}");
            }
        }

        foreach (TrainingDocumentInfo doc in model.TrainingDocuments)
        {
            Console.WriteLine($"  {doc.Name}: {doc.Status}, {doc.PageCount} page(s)");
        }
    }
}
```

Analysing a document with the trained model is the same pattern as receipts. This fragment also goes in the receipt program's `Main` and reuses `client`. Paste in the model ID the trainer printed:

```csharp
string modelId = "<your-model-id>";
using FileStream formStream = File.OpenRead("<path-to-form.pdf>");
RecognizeCustomFormsOperation customOperation = await client.StartRecognizeCustomFormsAsync(modelId, formStream);
Response<RecognizedFormCollection> forms = await customOperation.WaitForCompletionAsync();

foreach (RecognizedForm form in forms.Value)
{
    foreach (var field in form.Fields)
    {
        Console.WriteLine($"{field.Key}: {field.Value.ValueData?.Text} (confidence {field.Value.Confidence:F2})");
    }
}
```

Read the per-document `Status` in the training output. A model that "succeeded" while quietly skipping half the training files usually performs badly in ways that are hard to trace back to the cause.

## When not to use it

- **Born-digital PDFs from a single system.** If every document comes out of one billing platform with a real text layer, a PDF text extractor and a few rules are cheaper, deterministic, and need no network call.
- **Wildly variable layouts with no anchors.** Neither custom mode generalises well across hundreds of unrelated layouts. That's a Layout-plus-parsing problem, or a "get the data from the source system" problem.
- **Receipts outside the supported scope.** Don't build an expense workflow for non-US receipts on the prebuilt model and assume it's covered.
- **Anything you can get as structured data upstream.** The best document extraction pipeline is the one you avoid building because the supplier can send you a CSV or an e-invoice.

## Running it in production

These are the rules I give clients before they start:

- **Confidence scores are not optional.** Below a threshold, the document goes to human review. I usually start at 0.75 for invoice-style fields and set it higher for compliance-sensitive ones. The point is not to remove humans. It's to remove the *typing*.
- **Image quality matters more than training data.** Phone photos taken at an angle and low-resolution greyscale fax scans make accuracy collapse. Budget for a decent scanner or capture app before you budget for more training.
- **Stage the rollout.** Run Form Recognizer in shadow mode first: extract the data, but compare it against what people typed. You learn the failure modes before you bet a process on them.
- **Treat model IDs as deployable artefacts.** Record which model ID produced each extraction. When you retrain, you'll want to compare old and new models on the same documents.

## Where I'd start

Start with Layout to see what the service reads from your real documents. Use the prebuilt receipt model only if your receipts are in scope. For anything specific to your business, train a labelled custom model. Pin the preview SDK version and wrap field access in type checks. Build the human review step on day one, not after the first bad batch. Invoice processing was the first AI workload I deployed for a client where the savings were obvious within a month. That happened because the review loop was designed in from the start, not because the model was perfect.
