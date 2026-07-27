---
title: "Microsoft Power Platform Updates: What's New in Spring 2022"
author: Michael John Peña
draft: false
date: 2022-04-01
tags:
  - Power Platform
  - Power Apps
  - Power Automate
  - Microsoft 365
  - Low-Code

---

I wrote "Microsoft Power Platform Updates: What's New in Spring 2022" to share practical, production-minded guidance on this topic.

## Power Apps Updates

### Modern App Designer

The new modern app designer is now generally available:

```yaml
Key Features:
  - Unified design experience
  - Real-time collaboration
  - Component libraries
  - Responsive design tools
  - Git integration preview
```

### Power Fx Enhancements

New functions and capabilities:

```powerfx
// New ParseJSON function
Set(userData, ParseJSON(jsonString));
userData.name  // Access properties directly

// Enhanced error handling
IfError(
    LookUp(Customers, ID = customerID),
    Notify("Customer not found", NotificationType.Warning),
    Navigate(CustomerDetails)
)

// Named formulas (preview)
userFullName = User().FullName;
currentDate = Today();

// Use anywhere in your app
Label.Text = userFullName
```

### Dataverse Improvements

```powerfx
// Improved Dataverse operations
// Batch operations for better performance
ForAll(
    Filter(Customers, Status = "Pending"),
    Patch(Customers, ThisRecord, {Status: "Processed"})
)

// File and image columns
Patch(
    Documents,
    Defaults(Documents),
    {
        Name: "Report.pdf",
        FileContent: UploadedFile.Content
    }
)
```

## Power Automate Updates

### Cloud Flows

New triggers and actions:

```json
{
    "trigger": {
        "type": "When_a_row_is_added_modified_or_deleted",
        "inputs": {
            "table": "accounts",
            "scope": "Organization",
            "filterRows": "statuscode eq 1",
            "runAs": "Flow owner"
        }
    },
    "actions": {
        "Get_row": {
            "type": "GetRow",
            "inputs": {
                "table": "accounts",
                "rowId": "@triggerOutputs()?['body/accountid']"
            }
        },
        "Condition": {
            "type": "If",
            "expression": {
                "greater": ["@outputs('Get_row')?['body/revenue']", 1000000]
            },
            "actions": {
                "Send_notification": {
                    "type": "SendEmailNotification",
                    "inputs": {
                        "to": "sales-team@company.com",
                        "subject": "High-value account updated",
                        "body": "Account @{outputs('Get_row')?['body/name']} has been updated."
                    }
                }
            }
        }
    }
}
```

### Desktop Flows

Power Automate Desktop enhancements:

```
New Actions:
- PDF text extraction
- OCR improvements
- Excel macro execution
- SAP GUI automation
- Terminal emulator support

Performance:
- 40% faster execution
- Reduced memory usage
- Better error recovery
```

### Process Advisor

AI-powered process mining:

```python
# Process Advisor analyzes recorded processes
# and provides optimization recommendations

# Key metrics tracked:
# - Process duration
# - Variation analysis
# - Bottleneck identification
# - Automation opportunities
```

## Power BI Updates

### Enhanced Visualizations

```dax
// New DAX functions
EVALUATE
SUMMARIZECOLUMNS(
    'Date'[Month],
    'Product'[Category],
    "Total Sales", [Total Sales],
    "Running Total", CALCULATE(
        [Total Sales],
        FILTER(
            ALL('Date'),
            'Date'[Date] <= MAX('Date'[Date])
        )
    ),
    "YoY Growth", DIVIDE(
        [Total Sales] - [Total Sales LY],
        [Total Sales LY]
    )
)
```

### Deployment Pipelines

```yaml
# CI/CD for Power BI
stages:
  - development
  - test
  - production

deployment_rules:
  - require_approval: production
  - auto_bind_datasets: true
  - preserve_workspace_users: true
```

## Power Virtual Agents

### Enhanced Bot Capabilities

```yaml
# New conversation features
Topics:
  - name: "Order Status"
    trigger_phrases:
      - "Where is my order"
      - "Track my package"
      - "Order status"
    actions:
      - type: "Question"
        prompt: "What's your order number?"
        variable: OrderNumber
      - type: "Action"
        flow: "Get Order Status"
        inputs:
          orderNumber: "{OrderNumber}"
      - type: "Message"
        content: "Your order {OrderNumber} is {OrderStatus}"
```

### Power Automate Integration

```json
{
    "name": "GetOrderStatus",
    "trigger": {
        "type": "PowerVirtualAgents",
        "inputs": {
            "orderNumber": "@triggerBody()['orderNumber']"
        }
    },
    "actions": {
        "Query_Orders": {
            "type": "Query",
            "inputs": {
                "table": "orders",
                "filter": "ordernumber eq '@{triggerBody()['orderNumber']}'"
            }
        },
        "Return_to_Bot": {
            "type": "Response",
            "inputs": {
                "statusCode": 200,
                "body": {
                    "orderStatus": "@{first(outputs('Query_Orders')?['body/value'])?['status']}"
                }
            }
        }
    }
}
```

## Governance and Administration

### Environment Management

```powershell
# Power Platform Admin PowerShell
# New environment management capabilities

# Create environment with settings
New-AdminPowerAppEnvironment `
    -DisplayName "Production" `
    -Location "unitedstates" `
    -EnvironmentSku "Production" `
    -ProvisionDatabase $true `
    -CurrencyName "USD" `
    -LanguageName "English"

# Configure DLP policies
New-DlpPolicy `
    -DisplayName "Default Policy" `
    -DefaultConnectorClassification "Blocked" `
    -Environments @("Production", "Test")

# Set business data connectors
Set-DlpPolicyConnectorConfigurations `
    -PolicyName "Default Policy" `
    -ConnectorConfigurations @(
        @{
            ConnectorId = "shared_sharepointonline"
            Classification = "Business"
        },
        @{
            ConnectorId = "shared_office365"
            Classification = "Business"
        }
    )
```

### Center of Excellence Starter Kit

```yaml
# Updated CoE components
components:
  - core:
      - Environment inventory
      - App inventory
      - Flow inventory
      - Connector audit
  - governance:
      - Compliance dashboard
      - Adoption metrics
      - License management
  - nurture:
      - Training tracking
      - Community management
      - Innovation hub
```

## Best Practices

### App Development

```powerfx
// Performance optimization
// Use delegation-friendly queries
Filter(
    LargeDataset,
    StartsWith(Name, TextInput.Text),
    Status = "Active"
)

// Avoid:
// - Non-delegable functions on large datasets
// - Complex nested galleries
// - Unnecessary data loading

// Cache data appropriately
Set(CachedCustomers,
    Filter(Customers, Region = userRegion)
);
```

### Flow Design

```yaml
best_practices:
  error_handling:
    - Use scopes for try-catch patterns
    - Implement retry policies
    - Log errors to central location

  performance:
    - Use pagination for large datasets
    - Implement parallel branches
    - Minimize API calls

  maintainability:
    - Use descriptive action names
    - Add comments
    - Create child flows for reuse
```

## Conclusion

Spring 2022 brings substantial improvements to Power Platform:
- Enhanced development experience
- Better performance and scalability
- Improved governance tools
- Deeper AI integration

Whether you're a citizen developer or professional developer, these updates make building business applications faster and more powerful.

## Resources

- [Power Platform Release Notes](https://docs.microsoft.com/en-us/power-platform/released-versions/power-platform)
- [Power Apps Documentation](https://docs.microsoft.com/en-us/powerapps/)
- [Power Automate Documentation](https://docs.microsoft.com/en-us/power-automate/)

