---
title: Robotic Process Automation with Power Automate Desktop
description: "Microsoft made Power Automate Desktop free for Windows 10 users in March, which quietly turned every back-office worker into a potential RPA developer. It's…"
author: Michael John Pena
draft: false
date: 2021-01-23
url: /blog/power-automate-desktop-rpa/
tags:
  - Power Automate
  - RPA
  - Automation
  - Desktop Flows
  - Microsoft 365
---

Microsoft made Power Automate Desktop free for Windows 10 users in March, which quietly turned every back-office worker into a potential RPA developer. It's the "click here, then here, then save" automation that finance and operations teams have been begging for, and the price tag finally matches the audience. Today I'm walking through scenarios I've actually shipped—legacy app data entry, scheduled report extraction from a portal that has no API, and the patterns that survive the inevitable UI change.

## Understanding Power Automate Desktop

Power Automate Desktop (PAD) allows you to:
- Record and playback desktop interactions
- Automate legacy applications without APIs
- Process files, emails, and web data
- Integrate with cloud flows and AI Builder

## Getting Started

After installing Power Automate Desktop, here is a simple flow that extracts data from a legacy application:

```
# Power Automate Desktop Flow: Extract Sales Data

# Variables
SET SalesData TO []
SET TodayDate TO %CurrentDateTime.ToString("yyyy-MM-dd")%

# Launch the legacy application
Run application
    Application path: C:\Program Files\LegacyApp\SalesSystem.exe
    Wait for application: true

# Wait for login screen
Wait for window
    Window title: Sales System - Login
    Timeout: 30

# Enter credentials (from secure credential store)
Get credential
    Credential name: LegacySalesApp
    Store in: Username, Password

Send keys
    Keys to send: %Username%

Press key
    Key: Tab

Send keys
    Keys to send: %Password%

Press key
    Key: Enter

# Navigate to reports
Wait for window
    Window title: Sales System - Main Menu

Click UI element
    Element: Reports menu item

Click UI element
    Element: Daily Sales Report

# Set date filter
Set text
    Element: Start Date field
    Text: %TodayDate%

Click UI element
    Element: Generate Report button

# Wait for report to load
Wait for UI element
    Element: Report table
    Timeout: 60

# Extract table data
Extract data from window
    Window: Sales Report
    Element: Report table
    Store data in: SalesData

# Export to Excel
Launch Excel
    Make instance visible: false
    Store instance in: ExcelInstance

Write to Excel worksheet
    Excel instance: %ExcelInstance%
    Value to write: %SalesData%
    Write mode: On specified cell
    Start column: A
    Start row: 1

Save Excel
    Excel instance: %ExcelInstance%
    File path: C:\Reports\DailySales_%TodayDate%.xlsx

Close Excel
    Excel instance: %ExcelInstance%
    Save before closing: true

# Close legacy app
Close window
    Window: Sales System
```

## Web Automation

Automate web-based tasks without Selenium coding:

```
# Power Automate Desktop Flow: Process Web Orders

# Launch browser
Launch new Chrome
    Initial URL: https://orders.company.com
    Store browser instance in: Browser

# Login
Populate text field in web page
    Browser instance: %Browser%
    Element: Username field
    Text: %Username%

Populate text field in web page
    Browser instance: %Browser%
    Element: Password field
    Text: %Password%

Click link on web page
    Browser instance: %Browser%
    Element: Login button

# Navigate to pending orders
Click link on web page
    Browser instance: %Browser%
    Element: Orders link

Click link on web page
    Browser instance: %Browser%
    Element: Pending filter

# Extract order data
Extract data from web page
    Browser instance: %Browser%
    Element: Orders table
    Store data in: PendingOrders

# Process each order
LOOP FOREACH CurrentOrder IN PendingOrders
    # Click on order
    Click link on web page
        Browser instance: %Browser%
        Element: Order link with text %CurrentOrder['OrderID']%

    # Check inventory (call cloud flow)
    Run Power Automate flow
        Flow name: Check Inventory
        Input parameters: ProductID=%CurrentOrder['ProductID']%, Quantity=%CurrentOrder['Quantity']%
        Store result in: InventoryResult

    IF %InventoryResult['InStock']% = true THEN
        # Approve order
        Click link on web page
            Browser instance: %Browser%
            Element: Approve button

        Display notification
            Title: Order Approved
            Message: Order %CurrentOrder['OrderID']% has been approved
    ELSE
        # Flag for review
        Click link on web page
            Browser instance: %Browser%
            Element: Flag for Review button

        Populate text field in web page
            Browser instance: %Browser%
            Element: Notes field
            Text: Insufficient inventory. Available: %InventoryResult['Available']%
    END

    # Return to list
    Click link on web page
        Browser instance: %Browser%
        Element: Back to Orders
END

# Close browser
Close web browser
    Browser instance: %Browser%
```

## Excel Automation

Process Excel files with complex logic:

```
# Power Automate Desktop Flow: Monthly Report Consolidation

# Get all Excel files from folder
Get files in folder
    Folder: C:\MonthlyReports\Raw
    File filter: *.xlsx
    Store files in: ReportFiles

# Create master workbook
Launch Excel
    Make instance visible: false
    Store instance in: MasterWorkbook

Add new worksheet
    Excel instance: %MasterWorkbook%
    New worksheet name: Consolidated

SET CurrentRow TO 2
SET IsFirstFile TO true

LOOP FOREACH ReportFile IN ReportFiles
    # Open source file
    Launch Excel
        File path: %ReportFile%
        Make instance visible: false
        Store instance in: SourceWorkbook

    # Read data
    Read from Excel worksheet
        Excel instance: %SourceWorkbook%
        Retrieve: All available values
        Store data in: SourceData

    IF %IsFirstFile% = true THEN
        # Copy headers from first file
        Write to Excel worksheet
            Excel instance: %MasterWorkbook%
            Value to write: %SourceData[0]%
            Start column: A
            Start row: 1
        SET IsFirstFile TO false
    END

    # Copy data rows (skip header)
    LOOP FOREACH DataRow IN SourceData STARTING FROM 1
        Write to Excel worksheet
            Excel instance: %MasterWorkbook%
            Value to write: %DataRow%
            Start column: A
            Start row: %CurrentRow%

        SET CurrentRow TO %CurrentRow + 1%
    END

    # Close source file
    Close Excel
        Excel instance: %SourceWorkbook%
        Save before closing: false
END

# Add summary formulas
Write to Excel worksheet
    Excel instance: %MasterWorkbook%
    Value to write: Total
    Start column: A
    Start row: %CurrentRow + 1%

Write to Excel worksheet
    Excel instance: %MasterWorkbook%
    Value to write: =SUM(C2:C%CurrentRow%)
    Start column: C
    Start row: %CurrentRow + 1%

# Save master workbook
SET MonthYear TO %CurrentDateTime.ToString("yyyy-MM")%
Save Excel
    Excel instance: %MasterWorkbook%
    File path: C:\MonthlyReports\Consolidated\Report_%MonthYear%.xlsx

Close Excel
    Excel instance: %MasterWorkbook%
```

## Error Handling and Logging

Implement robust error handling in your flows:

```
# Power Automate Desktop Flow: Robust Data Processing

SET LogFile TO "C:\Logs\ProcessLog_%CurrentDateTime.ToString("yyyyMMdd_HHmmss")%.txt"
SET ProcessedCount TO 0
SET ErrorCount TO 0

# Initialize log
Write text to file
    File path: %LogFile%
    Text to write: Process started at %CurrentDateTime%
    Append new line: true

BLOCK Process Data
ON BLOCK ERROR
    # Handle any error in this block
    Write text to file
        File path: %LogFile%
        Text to write: ERROR: %LastError% at %CurrentDateTime%
        Append new line: true

    SET ErrorCount TO %ErrorCount + 1%

    # Take screenshot for debugging
    Take screenshot
        Save to file: C:\Logs\Error_%CurrentDateTime.ToString("yyyyMMdd_HHmmss")%.png

    # Send notification
    Send email
        To: admin@company.com
        Subject: RPA Flow Error
        Body: Error occurred in data processing flow. Check logs at %LogFile%
END

    # Main processing logic
    Get files in folder
        Folder: C:\Data\Input
        Store files in: DataFiles

    LOOP FOREACH DataFile IN DataFiles
        BLOCK Process File
        ON BLOCK ERROR
            Write text to file
                File path: %LogFile%
                Text to write: Failed to process %DataFile%: %LastError%
                Append new line: true
            SET ErrorCount TO %ErrorCount + 1%
            CONTINUE LOOP
        END

            # Process the file
            Read text from file
                File path: %DataFile%
                Store content in: FileContent

            # Validate content
            IF %FileContent.Length% = 0 THEN
                THROW EXCEPTION "Empty file detected"
            END

            # Process content...

            # Move processed file
            Move file
                File to move: %DataFile%
                Destination: C:\Data\Processed\

            SET ProcessedCount TO %ProcessedCount + 1%

            Write text to file
                File path: %LogFile%
                Text to write: Successfully processed %DataFile%
                Append new line: true
        END
    END
END

# Write summary
Write text to file
    File path: %LogFile%
    Text to write: Process completed. Processed: %ProcessedCount%, Errors: %ErrorCount%
    Append new line: true
```

## Integration with Cloud Flows

Connect desktop flows with Power Automate cloud flows:

```json
{
  "definition": {
    "$schema": "https://schema.management.azure.com/schemas/2016-06-01/Microsoft.Logic.json",
    "actions": {
      "Run_Desktop_Flow": {
        "type": "OpenApiConnection",
        "inputs": {
          "host": {
            "connectionName": "shared_uiflow",
            "operationId": "RunDesktopFlow"
          },
          "parameters": {
            "runMode": "Attended",
            "desktopFlowId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
            "body": {
              "inputParameters": {
                "OrderID": "@triggerBody()?['OrderID']",
                "CustomerEmail": "@triggerBody()?['Email']"
              }
            }
          }
        }
      },
      "Process_Output": {
        "type": "Compose",
        "inputs": "@body('Run_Desktop_Flow')?['outputParameters']",
        "runAfter": {
          "Run_Desktop_Flow": ["Succeeded"]
        }
      },
      "Send_Confirmation": {
        "type": "OpenApiConnection",
        "inputs": {
          "host": {
            "connectionName": "shared_office365",
            "operationId": "SendEmailV2"
          },
          "parameters": {
            "emailMessage/To": "@triggerBody()?['Email']",
            "emailMessage/Subject": "Order Processed",
            "emailMessage/Body": "Your order has been processed. Tracking: @{outputs('Process_Output')?['TrackingNumber']}"
          }
        },
        "runAfter": {
          "Process_Output": ["Succeeded"]
        }
      }
    },
    "triggers": {
      "When_a_new_order_arrives": {
        "type": "ApiConnectionWebhook",
        "inputs": {
          "host": {
            "connectionName": "shared_commondataservice"
          },
          "parameters": {
            "dataset": "default.cds",
            "table": "orders",
            "eventType": "create"
          }
        }
      }
    }
  }
}
```

## Best Practices

1. **Use UI Element Selectors**: Prefer CSS selectors and names over coordinates
2. **Add Wait Actions**: Allow time for applications to respond
3. **Implement Logging**: Track execution for troubleshooting
4. **Handle Errors Gracefully**: Use block error handling for recovery
5. **Secure Credentials**: Use the built-in credential manager
6. **Test Incrementally**: Build and test flows step by step
7. **Document Flows**: Add comments explaining complex logic

Power Automate Desktop democratizes RPA by making it accessible to business users while providing the power needed for complex automation scenarios. Combined with cloud flows and AI Builder, it forms a comprehensive automation platform.
