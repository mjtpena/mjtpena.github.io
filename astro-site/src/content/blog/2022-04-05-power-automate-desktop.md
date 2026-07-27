---
title: "Power Automate Desktop: Robotic Process Automation for Everyone"
author: Michael John Peña
draft: false
date: 2022-04-05
tags:
  - Power Platform
  - Power Automate
  - RPA
  - Desktop Automation
  - Low-Code

---

I wrote "Power Automate Desktop: Robotic Process Automation for Everyone" to share practical, production-minded guidance on this topic.

## Getting Started

Power Automate Desktop is free for Windows 10/11 users. Premium features require a Power Automate license.

### Core Concepts

```yaml
components:
  flows: Automation sequences
  actions: Individual steps (400+ built-in)
  variables: Data storage during execution
  subflows: Reusable flow components
  error_handling: Try-catch blocks
  loops: Iteration constructs
```

## Building Desktop Flows

### UI Automation

```
# Record or build UI interactions

# Launch application
System.RunApplication ApplicationPath: 'C:\Program Files\App\app.exe'

# Wait for window
UIAutomation.WaitForWindowToBeReady Window: MainWindow Timeout: 30

# Click button
UIAutomation.Click Element: SubmitButton ClickType: LeftClick

# Enter text
UIAutomation.PopulateTextField TextField: UsernameField Text: '%Username%'

# Read text
UIAutomation.GetElementText Element: ResultLabel TextValue=> ExtractedText
```

### Web Automation

```
# Browser automation

# Launch browser
WebAutomation.LaunchChrome Url: 'https://app.example.com' BrowserInstance=> Browser

# Wait for element
WebAutomation.WaitForElementOnWebPage Browser: Browser Selector: 'input[name="search"]' Timeout: 30

# Enter text in web field
WebAutomation.PopulateTextField Browser: Browser TextField: 'input[name="search"]' Text: '%SearchTerm%'

# Click web element
WebAutomation.Click Browser: Browser Element: 'button[type="submit"]'

# Extract web data
WebAutomation.ExtractDataFromWebPage Browser: Browser Selector: 'table.results' ExtractedData=> DataTable

# Close browser
WebAutomation.CloseWebBrowser Browser: Browser
```

### Excel Automation

```
# Excel operations

# Launch Excel
Excel.LaunchExcel Visible: True Instance=> ExcelInstance

# Open workbook
Excel.OpenWorkbook Instance: ExcelInstance Path: 'C:\Data\Report.xlsx' Workbook=> Workbook

# Read range
Excel.ReadFromExcel Instance: ExcelInstance Range: 'A1:D100' ReadAsText: False DataTable=> ExcelData

# Write data
Excel.WriteToExcel Instance: ExcelInstance DataToWrite: %ProcessedData% StartColumn: 1 StartRow: 1

# Run macro
Excel.RunMacro Instance: ExcelInstance Macro: 'FormatReport'

# Save and close
Excel.SaveExcel Instance: ExcelInstance
Excel.CloseExcel Instance: ExcelInstance
```

## Variables and Data

### Working with Variables

```
# Set variable
Variables.SetVariable Name: 'Counter' Value: 0

# Increment
Variables.IncreaseVariable Name: 'Counter' Value: 1

# Create list
Variables.CreateNewList List=> ItemList

# Add to list
Variables.AddItemToList List: ItemList Item: '%CurrentItem%'

# Create data table
Variables.CreateNewDataTable Columns: ['Name', 'Email', 'Status'] DataTable=> ResultTable

# Add row to data table
Variables.AddRowToDataTable DataTable: ResultTable RowData: ['John', 'john@example.com', 'Active']
```

### Conditions and Loops

```
# If condition
IF %Status% = 'Pending' THEN
    # Actions for pending status
    UIAutomation.Click Element: ApproveButton
ELSE IF %Status% = 'Review' THEN
    # Actions for review status
    UIAutomation.Click Element: ReviewButton
ELSE
    # Default actions
    Text.AppendLine Text: %Log% LineToAppend: 'Unknown status: %Status%'
END

# For each loop
LOOP FOREACH CurrentRow IN %DataTable%
    # Process each row
    Variables.SetVariable Name: 'CustomerName' Value: %CurrentRow['Name']%

    # Perform actions
    UIAutomation.PopulateTextField TextField: NameField Text: '%CustomerName%'

    # Handle errors
    ON BLOCK ERROR
        Text.AppendLine Text: %ErrorLog% LineToAppend: 'Error processing: %CustomerName%'
    END
END

# While loop
LOOP WHILE %Counter% < 100
    # Increment counter
    Variables.IncreaseVariable Name: 'Counter' Value: 1

    # Check condition to break
    IF %FoundItem% = True THEN
        EXIT LOOP
    END
END
```

## Error Handling

```
# Try-catch pattern
BLOCK 'Process Invoice'
ON BLOCK ERROR
    # Log error
    Text.AppendLine Text: %ErrorLog% LineToAppend: 'Error: %LastError%'

    # Take screenshot for debugging
    System.TakeScreenshot Screen: 0 File: 'C:\Logs\error_%DateTime%.png'

    # Send notification
    Email.SendEmail Server: 'smtp.company.com' To: 'support@company.com' Subject: 'RPA Error' Body: '%LastError%'

    # Decide whether to continue or stop
    IF %ErrorCount% > 3 THEN
        THROW EXCEPTION 'Too many errors'
    END
END
    # Normal processing
    UIAutomation.Click Element: SubmitButton
    UIAutomation.WaitForElement Element: SuccessMessage Timeout: 30
END
```

## Integration with Cloud Flows

### Trigger Desktop Flow from Cloud

```json
{
    "trigger": {
        "type": "Request",
        "inputs": {
            "schema": {
                "type": "object",
                "properties": {
                    "invoiceNumber": {"type": "string"},
                    "amount": {"type": "number"}
                }
            }
        }
    },
    "actions": {
        "Run_Desktop_Flow": {
            "type": "ApiConnection",
            "inputs": {
                "host": {
                    "connection": {
                        "name": "@parameters('$connections')['shared_uiflow']['connectionId']"
                    }
                },
                "method": "post",
                "path": "/providers/Microsoft.ProcessSimple/environments/@{encodeURIComponent('Default')}/flows/@{encodeURIComponent('desktop-flow-id')}/runs",
                "body": {
                    "invoiceNumber": "@triggerBody()?['invoiceNumber']",
                    "amount": "@triggerBody()?['amount']"
                }
            }
        }
    }
}
```

### Return Data to Cloud Flow

```
# In desktop flow
# Process data and prepare output

# Set output variable (defined in flow properties)
Variables.SetVariable Name: 'OutputResult' Value: %ProcessedData%
Variables.SetVariable Name: 'OutputStatus' Value: 'Success'

# These variables are returned to the cloud flow
```

## OCR and Document Processing

```
# OCR for image text extraction

# Capture region
System.TakeScreenshotOfRegion Region: %DocumentArea% Image=> CapturedImage

# OCR extraction
OCR.ExtractTextWithEngine Image: %CapturedImage% Engine: WindowsOCR Text=> ExtractedText

# Parse extracted text
Text.RegexMatch Text: %ExtractedText% Pattern: 'Invoice #: (\d+)' Match=> InvoiceNumber

# PDF text extraction
PDF.ExtractTextFromPDF File: 'C:\Documents\invoice.pdf' Text=> PDFText
```

## Best Practices

### Reliable Selectors

```
# Use multiple selector attributes for reliability
UIAutomation.WaitForElement
    Element: {
        "Name": "Submit",
        "ClassName": "btn-primary",
        "AutomationId": "submitButton"
    }
    Timeout: 30
    FoundElement=> SubmitBtn

# Add fallback selectors
IF %SubmitBtn% = '' THEN
    UIAutomation.WaitForElement
        Element: {"Name": "Submit Order"}
        Timeout: 10
        FoundElement=> SubmitBtn
END
```

### Performance Optimization

```yaml
tips:
  - Use keyboard shortcuts over mouse clicks
  - Minimize screen captures
  - Close applications when done
  - Use specific waits, not fixed delays
  - Batch operations when possible
  - Disable UI animations if possible
```

### Maintenance

```
# Add logging throughout
Text.AppendLine Text: %Log% LineToAppend: '[%DateTime%] Starting process'

# Version control your flows
# Export flows regularly
# Document selector dependencies
# Test after application updates
```

## Unattended vs Attended

```yaml
attended:
  description: User interacts with desktop during execution
  use_cases:
    - User-triggered tasks
    - Assisted automation
    - Training scenarios

unattended:
  description: Runs on dedicated machine without user
  use_cases:
    - Scheduled batch processing
    - Background operations
    - High-volume processing
  requirements:
    - Windows machine (VM or physical)
    - Power Automate unattended license
    - Machine registered in Power Platform
```

## Conclusion

Power Automate Desktop democratizes RPA:
- No-code automation for legacy apps
- Integration with cloud flows
- Built-in OCR and document processing
- Free for basic Windows automation

It's particularly valuable for automating processes in applications without APIs.

## Resources

- [Power Automate Desktop Documentation](https://docs.microsoft.com/en-us/power-automate/desktop-flows/)
- [Desktop Flow Actions](https://docs.microsoft.com/en-us/power-automate/desktop-flows/actions-reference)
- [RPA Best Practices](https://docs.microsoft.com/en-us/power-automate/desktop-flows/best-practices)

