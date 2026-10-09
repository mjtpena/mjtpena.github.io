---
title: "Microsoft Syntex: Content AI for the Enterprise"
author: Michael John Peña
draft: false
date: 2022-11-18
tags:
  - Microsoft 365
  - Syntex
  - AI
  - Document Processing
  - Content Understanding
---

## What is Microsoft Syntex?

Syntex uses AI models to:
- Classify documents automatically
- Extract information from documents
- Apply metadata and retention policies
- Generate content summaries
- Enable advanced search

## Document Understanding Models

### Creating a Model

```powershell
# Connect to SharePoint
Connect-PnPOnline -Url "https://contoso.sharepoint.com/sites/ContentCenter" -Interactive

# Create a document understanding model
$model = New-PnPSyntexModel -Name "Invoice Processing" -Description "Extracts invoice data"

# Add training files
Add-PnPSyntexModelTrainingFile -Model $model -File ".\training\invoice1.pdf" -Label "Invoice"
Add-PnPSyntexModelTrainingFile -Model $model -File ".\training\receipt1.pdf" -Label "Not Invoice"

# Define extractors
Add-PnPSyntexModelExtractor -Model $model -Name "InvoiceNumber" -Type "Text"
Add-PnPSyntexModelExtractor -Model $model -Name "VendorName" -Type "Text"
Add-PnPSyntexModelExtractor -Model $model -Name "TotalAmount" -Type "Currency"
Add-PnPSyntexModelExtractor -Model $model -Name "InvoiceDate" -Type "Date"

# Train the model
Start-PnPSyntexModelTraining -Model $model
```

### Form Processing with AI Builder

```json
{
  "name": "InvoiceFormModel",
  "description": "Extract data from invoices",
  "fields": [
    {
      "name": "InvoiceNumber",
      "type": "text",
      "required": true
    },
    {
      "name": "VendorName",
      "type": "text",
      "required": true
    },
    {
      "name": "VendorAddress",
      "type": "text",
      "required": false
    },
    {
      "name": "InvoiceDate",
      "type": "date",
      "required": true
    },
    {
      "name": "DueDate",
      "type": "date",
      "required": false
    },
    {
      "name": "LineItems",
      "type": "table",
      "columns": [
        { "name": "Description", "type": "text" },
        { "name": "Quantity", "type": "number" },
        { "name": "UnitPrice", "type": "currency" },
        { "name": "Total", "type": "currency" }
      ]
    },
    {
      "name": "Subtotal",
      "type": "currency",
      "required": false
    },
    {
      "name": "Tax",
      "type": "currency",
      "required": false
    },
    {
      "name": "TotalAmount",
      "type": "currency",
      "required": true
    }
  ]
}
```

## Applying Models to Libraries

```powershell
# Apply model to document library
$library = Get-PnPList -Identity "Invoices"

Set-PnPSyntexModelLibrary -Model "Invoice Processing" -Library $library -BatchSize 100

# Configure metadata mapping
$mappings = @{
    "InvoiceNumber" = "Invoice Number"
    "VendorName" = "Vendor"
    "TotalAmount" = "Amount"
    "InvoiceDate" = "Document Date"
}

Set-PnPSyntexModelMapping -Model "Invoice Processing" -Library $library -Mappings $mappings
```

## Prebuilt Models

Syntex includes prebuilt models for common document types:

```powershell
# Use prebuilt invoice model
$prebuiltModel = Get-PnPSyntexPrebuiltModel -Name "Invoice"

# Apply to library
Set-PnPSyntexPrebuiltModelLibrary -Model $prebuiltModel -Library $library

# Use prebuilt receipt model
$receiptModel = Get-PnPSyntexPrebuiltModel -Name "Receipt"
Set-PnPSyntexPrebuiltModelLibrary -Model $receiptModel -Library "Expense Reports"
```

## Content Assembly

Generate documents from templates using extracted data:

```json
{
  "template": "ContractTemplate.docx",
  "outputName": "Contract_{ClientName}_{Date}.docx",
  "fieldMappings": [
    {
      "placeholder": "{{ClientName}}",
      "source": "listItem",
      "field": "ClientName"
    },
    {
      "placeholder": "{{ContractDate}}",
      "source": "calculated",
      "expression": "formatDateTime(utcNow(), 'MMMM d, yyyy')"
    },
    {
      "placeholder": "{{ContractValue}}",
      "source": "listItem",
      "field": "ContractAmount",
      "format": "currency"
    },
    {
      "placeholder": "{{Terms}}",
      "source": "listItem",
      "field": "PaymentTerms"
    },
    {
      "placeholder": "{{Services}}",
      "source": "related",
      "list": "ServiceItems",
      "filter": "ContractId eq '{ID}'",
      "template": "ServiceItemTemplate"
    }
  ]
}
```

## Power Automate Integration

Automate document processing workflows:

```json
{
  "definition": {
    "triggers": {
      "When_a_file_is_classified_by_a_content_understanding_model": {
        "type": "OpenApiConnectionWebhook",
        "inputs": {
          "host": {
            "connectionName": "shared_sharepointonline"
          },
          "parameters": {
            "dataset": "https://contoso.sharepoint.com/sites/Invoices",
            "table": "Documents",
            "modelId": "invoice-processing-model"
          }
        }
      }
    },
    "actions": {
      "Get_extracted_values": {
        "type": "OpenApiConnection",
        "inputs": {
          "parameters": {
            "id": "@triggerBody()?['ID']"
          }
        }
      },
      "Check_invoice_amount": {
        "type": "If",
        "expression": "@greater(body('Get_extracted_values')?['TotalAmount'], 10000)",
        "actions": {
          "Start_approval_workflow": {
            "type": "OpenApiConnection",
            "inputs": {
              "parameters": {
                "approvalType": "Basic",
                "title": "Invoice Approval Required",
                "assignedTo": "finance-approvers@contoso.com",
                "details": "Invoice from @{body('Get_extracted_values')?['VendorName']} for @{body('Get_extracted_values')?['TotalAmount']}"
              }
            }
          }
        }
      },
      "Create_invoice_record": {
        "type": "OpenApiConnection",
        "inputs": {
          "host": {
            "connectionName": "shared_commondataservice"
          },
          "method": "post",
          "path": "/v2/datasets/@{encodeURIComponent('org')}/tables/@{encodeURIComponent('invoices')}/items",
          "body": {
            "invoicenumber": "@body('Get_extracted_values')?['InvoiceNumber']",
            "vendorname": "@body('Get_extracted_values')?['VendorName']",
            "amount": "@body('Get_extracted_values')?['TotalAmount']",
            "invoicedate": "@body('Get_extracted_values')?['InvoiceDate']",
            "documenturl": "@triggerBody()?['Link']"
          }
        }
      }
    }
  }
}
```

## Taxonomy and Metadata

Configure taxonomy for automatic tagging:

```powershell
# Create term set for document types
$termSet = New-PnPTermSet -Name "Document Types" -TermGroup "Enterprise Metadata"

# Add terms
New-PnPTerm -TermSet $termSet -Name "Invoice"
New-PnPTerm -TermSet $termSet -Name "Contract"
New-PnPTerm -TermSet $termSet -Name "Purchase Order"
New-PnPTerm -TermSet $termSet -Name "Receipt"

# Configure Syntex to use taxonomy
Set-PnPSyntexModelClassification -Model "Invoice Processing" `
    -TermSet $termSet `
    -Term "Invoice"
```

## Advanced Queries with Search

Query processed documents:

```kusto
// Find all invoices over $10,000 from last month
ContentType:"Invoice"
AND TotalAmountOWSTEXT:>10000
AND InvoiceDateOWSDATE:[2022-10-01 TO 2022-10-31]
```

```csharp
// C# - Search API
using Microsoft.Graph;

public async Task<IEnumerable<DriveItem>> SearchInvoicesAsync(
    GraphServiceClient client,
    decimal minAmount,
    DateTime fromDate)
{
    var query = new SearchRequestObject
    {
        Requests = new List<SearchRequest>
        {
            new SearchRequest
            {
                EntityTypes = new List<EntityType> { EntityType.DriveItem },
                Query = new SearchQuery
                {
                    QueryString = $"ContentType:Invoice AND TotalAmount>{minAmount} AND InvoiceDate>={fromDate:yyyy-MM-dd}"
                },
                From = 0,
                Size = 100
            }
        }
    };

    var response = await client.Search.Query(query).Request().PostAsync();

    return response.SelectMany(r => r.HitsContainers)
        .SelectMany(h => h.Hits)
        .Select(h => h.Resource as DriveItem);
}
```

## Content Center Management

```powershell
# Create content center
New-PnPSite -Type ContentCenter -Title "Contoso Content Center" `
    -Url "https://contoso.sharepoint.com/sites/ContentCenter" `
    -Owner "admin@contoso.com"

# Configure content center settings
Set-PnPSyntexContentCenter -Url "https://contoso.sharepoint.com/sites/ContentCenter" `
    -AllowModelCreation $true `
    -AllowModelPublishing $true

# Monitor model performance
$stats = Get-PnPSyntexModelStatistics -Model "Invoice Processing"

Write-Host "Documents Processed: $($stats.DocumentsProcessed)"
Write-Host "Success Rate: $($stats.SuccessRate)%"
Write-Host "Average Confidence: $($stats.AverageConfidence)%"
```

## Compliance and Retention

```powershell
# Apply retention labels based on classification
$retentionPolicy = @{
    "Invoice" = "FinancialRecords-7Years"
    "Contract" = "LegalDocuments-10Years"
    "Receipt" = "ExpenseRecords-3Years"
}

foreach ($docType in $retentionPolicy.Keys) {
    Set-PnPSyntexRetentionLabel -Model $docType -Label $retentionPolicy[$docType]
}
```

## Cost Considerations

Syntex pricing is based on:
- Number of pages processed
- Model training and inference
- Content assembly transactions

```powershell
# Estimate costs
$estimatedPages = 10000
$pricePerPage = 0.05  # Approximate

$monthlyCost = $estimatedPages * $pricePerPage
Write-Host "Estimated monthly cost: $($monthlyCost)"
```

## Conclusion

Microsoft Syntex transforms content management by bringing AI to everyday documents. Whether you're processing invoices, classifying contracts, or extracting data from forms, Syntex automates tedious manual work while improving accuracy and compliance. For organizations drowning in documents, it's a game-changer.

## Resources

- [Microsoft Syntex Documentation](https://docs.microsoft.com/en-us/microsoft-365/contentunderstanding/)
- [AI Builder Form Processing](https://docs.microsoft.com/en-us/ai-builder/form-processing-model-overview)
- [Syntex Licensing](https://docs.microsoft.com/en-us/microsoft-365/contentunderstanding/syntex-licensing)
- [Content Center Overview](https://docs.microsoft.com/en-us/microsoft-365/contentunderstanding/create-a-content-center)
