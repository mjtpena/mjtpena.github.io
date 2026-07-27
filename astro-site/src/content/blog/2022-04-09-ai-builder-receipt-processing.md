---
title: "Receipt Processing with AI Builder: Automating Expense Management"
author: Michael John Peña
draft: false
date: 2022-04-09
tags:
  - Power Platform
  - AI Builder
  - Receipt Processing
  - Expense Management
  - Automation

---

I wrote "Receipt Processing with AI Builder: Automating Expense Management" to share practical, production-minded guidance on this topic.

## Receipt Processing Capabilities

AI Builder extracts the following fields from receipts:

```yaml
extracted_fields:
  merchant:
    - MerchantName
    - MerchantAddress
    - MerchantPhoneNumber

  transaction:
    - TransactionDate
    - TransactionTime

  amounts:
    - Subtotal
    - Tax
    - Tip
    - Total

  items:
    - Description
    - Quantity
    - Price
    - TotalPrice

  payment:
    - PaymentMethod (if visible)
```

## Building an Expense App

### Power Apps Receipt Capture

```powerfx
// Main screen with camera capture
CameraButton.OnSelect = Set(
    CapturedReceipt,
    Camera1.Photo
);

// Process receipt when captured
ProcessButton.OnSelect = Set(
    ProcessingStatus,
    "Processing..."
);
Set(
    ReceiptData,
    AIBuilder.ReceiptProcessor(CapturedReceipt)
);
Set(
    ProcessingStatus,
    "Complete"
);

// Populate form with extracted data
// After successful extraction
If(
    !IsBlank(ReceiptData),

    // Set form fields
    Set(MerchantName, ReceiptData.MerchantName);
    Set(TransactionDate, ReceiptData.TransactionDate);
    Set(Subtotal, ReceiptData.Subtotal);
    Set(Tax, ReceiptData.Tax);
    Set(Total, ReceiptData.Total);

    // Show items if extracted
    ClearCollect(
        LineItems,
        ReceiptData.Items
    );

    Navigate(ReviewScreen)
)
```

### Review Screen

```powerfx
// Allow editing of extracted values
Form: ExpenseReviewForm
DataSource: Expenses

// Merchant field with extraction
MerchantInput.Default = MerchantName
MerchantInput.BorderColor = If(
    ReceiptData.MerchantNameConfidence > 0.8,
    Color.Green,
    Color.Orange
)

// Amount field with validation
AmountInput.Default = Total
AmountInput.OnChange = If(
    Value(AmountInput.Text) <> Total,
    Set(ManuallyEdited, true)
)

// Category selection
CategoryDropdown.Items = ["Travel", "Meals", "Office Supplies", "Transportation", "Entertainment", "Other"]
CategoryDropdown.DefaultSelectedItems = If(
    // Auto-categorize based on merchant
    "restaurant" in Lower(MerchantName) Or "cafe" in Lower(MerchantName),
    ["Meals"],
    "uber" in Lower(MerchantName) Or "lyft" in Lower(MerchantName),
    ["Transportation"],
    ["Other"]
)

// Submit button
SubmitButton.OnSelect =
    Patch(
        Expenses,
        Defaults(Expenses),
        {
            Merchant: MerchantInput.Text,
            TransactionDate: DatePicker.SelectedDate,
            Amount: Value(AmountInput.Text),
            Category: CategoryDropdown.Selected.Value,
            ReceiptImage: CapturedReceipt,
            Submitter: User().Email,
            Status: "Pending",
            SubmittedDate: Now()
        }
    );
    Navigate(ConfirmationScreen)
```

## Power Automate Workflow

### Email Receipt Processing

```json
{
    "trigger": {
        "type": "When_a_new_email_arrives",
        "inputs": {
            "folderPath": "Inbox",
            "importance": "Any",
            "hasAttachment": true,
            "subjectFilter": "Receipt"
        }
    },
    "actions": {
        "Filter_Image_Attachments": {
            "type": "Filter",
            "inputs": {
                "from": "@triggerBody()?['attachments']",
                "where": "@or(endsWith(item()?['name'], '.jpg'), endsWith(item()?['name'], '.png'), endsWith(item()?['name'], '.pdf'))"
            }
        },
        "Process_Each_Receipt": {
            "type": "ForEach",
            "foreach": "@body('Filter_Image_Attachments')",
            "actions": {
                "Extract_Receipt_Data": {
                    "type": "AIBuilder",
                    "inputs": {
                        "model": "prebuilt-receiptProcessing",
                        "document": "@{items('Process_Each_Receipt')?['contentBytes']}"
                    }
                },
                "Create_Expense_Record": {
                    "type": "CreateRecord",
                    "inputs": {
                        "table": "expenses",
                        "item": {
                            "merchant_name": "@{body('Extract_Receipt_Data')?['results']?['MerchantName']?['value']}",
                            "transaction_date": "@{body('Extract_Receipt_Data')?['results']?['TransactionDate']?['value']}",
                            "subtotal": "@{body('Extract_Receipt_Data')?['results']?['Subtotal']?['value']}",
                            "tax": "@{body('Extract_Receipt_Data')?['results']?['Tax']?['value']}",
                            "total": "@{body('Extract_Receipt_Data')?['results']?['Total']?['value']}",
                            "submitter_email": "@{triggerBody()?['from']}",
                            "receipt_image": "@{items('Process_Each_Receipt')?['contentBytes']}",
                            "confidence_score": "@{body('Extract_Receipt_Data')?['confidence']}",
                            "status": "Pending Review"
                        }
                    }
                },
                "Check_Requires_Review": {
                    "type": "Condition",
                    "expression": {
                        "less": ["@body('Extract_Receipt_Data')?['confidence']", 0.85]
                    },
                    "actions": {
                        "Create_Review_Task": {
                            "type": "CreateRecord",
                            "inputs": {
                                "table": "tasks",
                                "item": {
                                    "subject": "Review expense from @{triggerBody()?['from']}",
                                    "regarding": "@{body('Create_Expense_Record')?['id']}",
                                    "priority": "Normal"
                                }
                            }
                        }
                    }
                }
            }
        },
        "Send_Confirmation": {
            "type": "SendEmail",
            "inputs": {
                "to": "@{triggerBody()?['from']}",
                "subject": "Receipt processed",
                "body": "Your receipt has been processed and submitted for approval."
            }
        }
    }
}
```

## Batch Processing

```json
{
    "trigger": {
        "type": "Recurrence",
        "recurrence": {
            "frequency": "Hour",
            "interval": 1
        }
    },
    "actions": {
        "Get_Unprocessed_Receipts": {
            "type": "ListRecords",
            "inputs": {
                "table": "receipt_uploads",
                "filter": "status eq 'Pending'"
            }
        },
        "Process_Batch": {
            "type": "ForEach",
            "foreach": "@body('Get_Unprocessed_Receipts')?['value']",
            "runtimeConfiguration": {
                "concurrency": {
                    "repetitions": 5
                }
            },
            "actions": {
                "Process_Receipt": {
                    "type": "AIBuilder",
                    "inputs": {
                        "model": "prebuilt-receiptProcessing",
                        "document": "@{items('Process_Batch')?['image']}"
                    }
                },
                "Update_Record": {
                    "type": "UpdateRecord",
                    "inputs": {
                        "table": "receipt_uploads",
                        "id": "@{items('Process_Batch')?['id']}",
                        "item": {
                            "extracted_data": "@{body('Process_Receipt')}",
                            "status": "Processed",
                            "processed_at": "@{utcNow()}"
                        }
                    }
                }
            }
        }
    }
}
```

## Handling Multiple Receipt Types

```powerfx
// Different receipt formats require different handling
ProcessReceipt(receiptImage: Image): Record =
    With(
        {
            result: AIBuilder.ReceiptProcessor(receiptImage)
        },
        {
            // Standard fields
            merchant: result.MerchantName,
            date: result.TransactionDate,
            total: result.Total,

            // Handle missing tax (some receipts don't show tax separately)
            tax: If(
                IsBlank(result.Tax),
                0,
                result.Tax
            ),

            // Calculate subtotal if not extracted
            subtotal: If(
                IsBlank(result.Subtotal),
                result.Total - Coalesce(result.Tax, 0) - Coalesce(result.Tip, 0),
                result.Subtotal
            ),

            // Handle tips (restaurant receipts)
            tip: Coalesce(result.Tip, 0),

            // Line items (may not be available for all receipts)
            items: If(
                CountRows(result.Items) > 0,
                result.Items,
                Table({Description: "Total", TotalPrice: result.Total})
            ),

            // Confidence for review routing
            needsReview: result.Confidence < 0.8 Or IsBlank(result.Total)
        }
    )
```

## Integration with Approval Workflows

```json
{
    "actions": {
        "Get_Expense_Policy": {
            "type": "Query",
            "inputs": {
                "table": "expense_policies",
                "filter": "category eq '@{body('Create_Expense')?['category']}'"
            }
        },
        "Route_For_Approval": {
            "type": "Condition",
            "expression": {
                "greater": [
                    "@body('Create_Expense')?['total']",
                    "@first(body('Get_Expense_Policy')?['value'])?['auto_approve_limit']"
                ]
            },
            "actions": {
                "Start_Approval": {
                    "type": "StartAndWaitForAnApproval",
                    "inputs": {
                        "approvalType": "Basic",
                        "title": "Expense approval: @{body('Create_Expense')?['merchant_name']} - @{body('Create_Expense')?['total']}",
                        "assignedTo": "@{first(body('Get_Expense_Policy')?['value'])?['approver_email']}",
                        "details": "Please review this expense submission.\n\nMerchant: @{body('Create_Expense')?['merchant_name']}\nAmount: @{body('Create_Expense')?['total']}\nDate: @{body('Create_Expense')?['transaction_date']}\nCategory: @{body('Create_Expense')?['category']}",
                        "itemLink": "@{body('Create_Expense')?['id']}"
                    }
                }
            },
            "else": {
                "actions": {
                    "Auto_Approve": {
                        "type": "UpdateRecord",
                        "inputs": {
                            "table": "expenses",
                            "id": "@{body('Create_Expense')?['id']}",
                            "item": {
                                "status": "Approved",
                                "approved_by": "Auto-approved",
                                "approved_date": "@{utcNow()}"
                            }
                        }
                    }
                }
            }
        }
    }
}
```

## Reporting and Analytics

```sql
-- Expense analytics query
SELECT
    MONTH(transaction_date) as month,
    category,
    COUNT(*) as receipt_count,
    SUM(total) as total_amount,
    AVG(total) as avg_amount,
    AVG(confidence_score) as avg_confidence
FROM expenses
WHERE YEAR(transaction_date) = 2022
GROUP BY MONTH(transaction_date), category
ORDER BY month, total_amount DESC
```

## Best Practices

```yaml
receipt_processing_tips:
  capture_quality:
    - Flatten receipt before photographing
    - Ensure good lighting
    - Capture entire receipt in frame
    - Avoid shadows and glare

  handling_variations:
    - Different thermal paper qualities
    - Faded receipts (older)
    - Handwritten receipts (limited support)
    - Foreign language receipts

  validation:
    - Cross-check total with line items
    - Verify date is reasonable
    - Flag unusually high amounts
    - Check for duplicates
```

## Conclusion

Receipt processing with AI Builder transforms expense management:
- Instant data extraction from photos
- Reduced manual entry errors
- Faster reimbursement cycles
- Better compliance through consistent processing

Combined with approval workflows, it creates a complete expense automation solution.

## Resources

- [Receipt Processing Documentation](https://docs.microsoft.com/en-us/ai-builder/prebuilt-receipt-processing)
- [Expense Report Template](https://powerusers.microsoft.com/t5/Power-Apps-Community-Blog/Building-an-Expense-Report-App-with-AI-Builder/ba-p/646267)

