---
title: "SharePoint Syntex Document Processing: Practical Implementation"
author: Michael John Peña
draft: false
date: 2022-11-19
tags:
  - SharePoint
  - Microsoft 365
  - Document Processing
  - AI
  - Automation

---

I wrote "SharePoint Syntex Document Processing: Practical Implementation" to share practical, production-minded guidance on this topic.

## Scenario: Invoice Processing System

Our goal is to:
1. Automatically classify incoming documents as invoices
2. Extract key data (vendor, amount, date)
3. Route invoices through an approval workflow
4. Update a financial system

## Step 1: Prepare Training Data

Collect diverse samples for training:

```
/training-data
  /invoices
    invoice-001.pdf  # Different vendor formats
    invoice-002.pdf
    invoice-003.pdf
    ...
  /non-invoices
    receipt-001.pdf
    purchase-order-001.pdf
    contract-001.pdf
    ...
```

## Step 2: Create the Document Understanding Model

```powershell
# Connect to content center
Connect-PnPOnline -Url "https://contoso.sharepoint.com/sites/ContentCenter" -Interactive

# Create model
$modelName = "Vendor Invoice Processor"
$model = New-PnPSyntexModel -Name $modelName -Description "Processes vendor invoices and extracts key data"

# Upload positive training examples
$invoiceFiles = Get-ChildItem ".\training-data\invoices\*.pdf"
foreach ($file in $invoiceFiles) {
    Add-PnPSyntexModelTrainingFile -Model $model -File $file.FullName -Label "Invoice"
}

# Upload negative training examples
$nonInvoiceFiles = Get-ChildItem ".\training-data\non-invoices\*.pdf"
foreach ($file in $nonInvoiceFiles) {
    Add-PnPSyntexModelTrainingFile -Model $model -File $file.FullName -Label "Not Invoice"
}

Write-Host "Training files uploaded. Please complete training in the Content Center."
```

## Step 3: Define Extractors

In the Content Center UI, create extractors for each field:

### Invoice Number Extractor

```yaml
extractor:
  name: InvoiceNumber
  type: Text
  patterns:
    - prefix: "Invoice #"
    - prefix: "Invoice No."
    - prefix: "Invoice Number:"
    - regex: "INV-\d{6}"
  examples:
    - document: invoice-001.pdf
      value: "INV-123456"
      location: page1, top-right
    - document: invoice-002.pdf
      value: "2022-10-001"
      location: page1, header
```

### Vendor Extractor

```yaml
extractor:
  name: VendorName
  type: Text
  patterns:
    - location: top-left
      type: company_name
    - following: "From:"
    - following: "Vendor:"
  examples:
    - document: invoice-001.pdf
      value: "Acme Corporation"
    - document: invoice-002.pdf
      value: "Global Supplies Inc."
```

### Amount Extractor

```yaml
extractor:
  name: TotalAmount
  type: Currency
  patterns:
    - prefix: "Total:"
    - prefix: "Amount Due:"
    - prefix: "Grand Total:"
    - location: bottom-right
      type: largest_currency
  examples:
    - document: invoice-001.pdf
      value: "$1,234.56"
    - document: invoice-002.pdf
      value: "USD 5,678.90"
```

## Step 4: Configure Library Columns

```powershell
# Connect to destination site
Connect-PnPOnline -Url "https://contoso.sharepoint.com/sites/Finance" -Interactive

# Get library
$library = Get-PnPList -Identity "Vendor Invoices"

# Add columns to match extractors
Add-PnPField -List $library -DisplayName "Invoice Number" -InternalName "InvoiceNumber" -Type Text
Add-PnPField -List $library -DisplayName "Vendor Name" -InternalName "VendorName" -Type Text
Add-PnPField -List $library -DisplayName "Invoice Date" -InternalName "InvoiceDate" -Type DateTime
Add-PnPField -List $library -DisplayName "Total Amount" -InternalName "TotalAmount" -Type Currency
Add-PnPField -List $library -DisplayName "Processing Status" -InternalName "ProcessingStatus" -Type Choice `
    -Choices @("Pending", "Approved", "Rejected", "Paid")

# Add content type
Add-PnPContentTypeToList -List $library -ContentType "Invoice"
```

## Step 5: Apply Model to Library

```powershell
# Publish model to library
$model = Get-PnPSyntexModel -Name "Vendor Invoice Processor"

Set-PnPSyntexModelLibrary -Model $model `
    -Library "Vendor Invoices" `
    -SiteUrl "https://contoso.sharepoint.com/sites/Finance" `
    -BatchSize 50

# Configure column mappings
$mappings = @{
    "InvoiceNumber" = "Invoice Number"
    "VendorName" = "Vendor Name"
    "InvoiceDate" = "Invoice Date"
    "TotalAmount" = "Total Amount"
}

Set-PnPSyntexModelMapping -Model $model -Mappings $mappings
```

## Step 6: Create Approval Workflow

Using Power Automate:

```json
{
  "definition": {
    "$schema": "https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#",
    "triggers": {
      "When_invoice_classified": {
        "type": "OpenApiConnectionWebhook",
        "inputs": {
          "host": {
            "connectionName": "shared_sharepointonline"
          },
          "body": {
            "siteAddress": "https://contoso.sharepoint.com/sites/Finance",
            "listName": "Vendor Invoices"
          }
        },
        "conditions": [
          {
            "expression": "@equals(triggerBody()?['ContentType']?['Name'], 'Invoice')"
          }
        ]
      }
    },
    "actions": {
      "Initialize_approval_level": {
        "type": "InitializeVariable",
        "inputs": {
          "variables": [
            {
              "name": "ApprovalLevel",
              "type": "string",
              "value": "@if(greater(triggerBody()?['TotalAmount'], 10000), 'Executive', if(greater(triggerBody()?['TotalAmount'], 1000), 'Manager', 'Standard'))"
            }
          ]
        }
      },
      "Get_approvers": {
        "type": "Switch",
        "expression": "@variables('ApprovalLevel')",
        "cases": {
          "Executive": {
            "actions": {
              "Set_executive_approvers": {
                "type": "SetVariable",
                "inputs": {
                  "name": "Approvers",
                  "value": "cfo@contoso.com"
                }
              }
            }
          },
          "Manager": {
            "actions": {
              "Set_manager_approvers": {
                "type": "SetVariable",
                "inputs": {
                  "name": "Approvers",
                  "value": "finance-managers@contoso.com"
                }
              }
            }
          }
        },
        "default": {
          "actions": {
            "Set_standard_approvers": {
              "type": "SetVariable",
              "inputs": {
                "name": "Approvers",
                "value": "ap-team@contoso.com"
              }
            }
          }
        }
      },
      "Start_approval": {
        "type": "OpenApiConnectionWebhook",
        "inputs": {
          "host": {
            "connectionName": "shared_approvals"
          },
          "body": {
            "title": "Invoice Approval: @{triggerBody()?['VendorName']} - @{formatNumber(triggerBody()?['TotalAmount'], 'C')}",
            "assignedTo": "@variables('Approvers')",
            "details": "Please review the invoice from @{triggerBody()?['VendorName']}\n\nInvoice Number: @{triggerBody()?['InvoiceNumber']}\nAmount: @{formatNumber(triggerBody()?['TotalAmount'], 'C')}\nDate: @{formatDateTime(triggerBody()?['InvoiceDate'], 'MMMM d, yyyy')}\n\n[View Invoice](@{triggerBody()?['{Link}']})",
            "itemLink": "@triggerBody()?['{Link}']"
          }
        }
      },
      "Update_status": {
        "type": "OpenApiConnection",
        "inputs": {
          "host": {
            "connectionName": "shared_sharepointonline"
          },
          "method": "patch",
          "path": "/datasets/@{encodeURIComponent('https://contoso.sharepoint.com/sites/Finance')}/tables/@{encodeURIComponent('Vendor Invoices')}/items/@{triggerBody()?['ID']}",
          "body": {
            "ProcessingStatus": "@if(equals(body('Start_approval')?['outcome'], 'Approve'), 'Approved', 'Rejected')"
          }
        }
      },
      "Condition_approved": {
        "type": "If",
        "expression": "@equals(body('Start_approval')?['outcome'], 'Approve')",
        "actions": {
          "Create_ERP_record": {
            "type": "OpenApiConnection",
            "inputs": {
              "host": {
                "connectionName": "shared_sql"
              },
              "method": "post",
              "path": "/datasets/@{encodeURIComponent('erp-server.database.windows.net')}/tables/@{encodeURIComponent('InvoiceQueue')}/items",
              "body": {
                "InvoiceNumber": "@triggerBody()?['InvoiceNumber']",
                "VendorName": "@triggerBody()?['VendorName']",
                "Amount": "@triggerBody()?['TotalAmount']",
                "InvoiceDate": "@triggerBody()?['InvoiceDate']",
                "DocumentUrl": "@triggerBody()?['{Link}']",
                "ApprovedBy": "@body('Start_approval')?['responder']?['displayName']",
                "ApprovedDate": "@utcNow()"
              }
            }
          }
        }
      }
    }
  }
}
```

## Step 7: Create Dashboard

Build a Power BI dashboard to monitor processing:

```dax
// Measures for invoice dashboard

Total Invoices = COUNTROWS(Invoices)

Total Value = SUM(Invoices[TotalAmount])

Avg Processing Time =
AVERAGEX(
    Invoices,
    DATEDIFF(Invoices[UploadDate], Invoices[ApprovalDate], HOUR)
)

Pending Count =
CALCULATE(
    COUNTROWS(Invoices),
    Invoices[ProcessingStatus] = "Pending"
)

Approval Rate =
DIVIDE(
    CALCULATE(COUNTROWS(Invoices), Invoices[ProcessingStatus] = "Approved"),
    CALCULATE(COUNTROWS(Invoices), Invoices[ProcessingStatus] IN {"Approved", "Rejected"})
)

Extraction Accuracy =
AVERAGEX(
    Invoices,
    Invoices[ExtractionConfidence]
)
```

## Step 8: Monitor and Improve

```powershell
# Get model statistics
$stats = Get-PnPSyntexModelStatistics -Model "Vendor Invoice Processor"

Write-Host "=== Model Performance ==="
Write-Host "Documents Processed: $($stats.TotalDocuments)"
Write-Host "Classification Accuracy: $($stats.ClassificationAccuracy)%"
Write-Host "Extraction Accuracy: $($stats.ExtractionAccuracy)%"

# Get extraction details
$extractionStats = Get-PnPSyntexExtractionStatistics -Model "Vendor Invoice Processor"

foreach ($extractor in $extractionStats) {
    Write-Host "$($extractor.Name): $($extractor.Accuracy)% accuracy"
}

# Identify documents needing review
$lowConfidence = Get-PnPListItem -List "Vendor Invoices" `
    -Query "<View><Query><Where><Lt><FieldRef Name='SyntexConfidence'/><Value Type='Number'>0.7</Value></Lt></Where></Query></View>"

Write-Host "Documents needing manual review: $($lowConfidence.Count)"
```

## Error Handling

```powershell
# Handle processing errors
$errorLog = @()

Get-PnPListItem -List "Vendor Invoices" -Query "<View><Query><Where><IsNull><FieldRef Name='InvoiceNumber'/></IsNull></Where></Query></View>" | ForEach-Object {
    $errorLog += [PSCustomObject]@{
        FileName = $_["FileLeafRef"]
        UploadDate = $_["Created"]
        Error = "Invoice number not extracted"
    }
}

# Export for review
$errorLog | Export-Csv -Path "extraction-errors.csv" -NoTypeInformation

# Notify team
if ($errorLog.Count -gt 0) {
    Send-PnPMail -To "syntex-admins@contoso.com" `
        -Subject "Syntex Extraction Errors" `
        -Body "There are $($errorLog.Count) documents that need manual review."
}
```

## Conclusion

This practical implementation shows how SharePoint Syntex can transform document processing. The combination of AI-powered extraction, automated workflows, and monitoring creates a robust solution that reduces manual effort and improves accuracy. Start with a focused use case like invoices, measure results, and expand from there.

## Resources

- [Document Understanding Models](https://docs.microsoft.com/en-us/microsoft-365/contentunderstanding/create-a-classifier)
- [Extractor Best Practices](https://docs.microsoft.com/en-us/microsoft-365/contentunderstanding/create-an-extractor)
- [Model Evaluation](https://docs.microsoft.com/en-us/microsoft-365/contentunderstanding/learn-about-document-understanding-models-through-the-sample-model)

