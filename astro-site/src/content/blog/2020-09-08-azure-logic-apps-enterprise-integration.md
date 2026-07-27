---
title: "Azure Logic Apps for Enterprise Integration"
author: Michael John Peña
draft: false
date: 2020-09-08
tags:
  - Azure
  - Logic Apps
  - Integration
  - Enterprise
---

Logic Apps excels at the unglamorous middleware work — turning the SOAP service the warehouse system exposes into the REST endpoint the new mobile app expects, then mapping the schema differences between the two ERPs that finance refuses to consolidate. Most of my Logic Apps work isn't fancy; it's the connective tissue that lets older and newer systems live together until someone funds a proper replacement.

## Common Integration Patterns

### 1. File Processing

```json
{
  "definition": {
    "triggers": {
      "When_a_blob_is_added": {
        "type": "ApiConnection",
        "inputs": {
          "host": {"connection": {"name": "@parameters('$connections')['azureblob']['connectionId']"}},
          "method": "get",
          "path": "/datasets/default/triggers/batch/onupdatedfile",
          "queries": {"folderId": "/incoming"}
        }
      }
    },
    "actions": {
      "Parse_CSV": {"type": "Compose", "inputs": "@split(body('Get_blob_content'), '\\n')"},
      "For_each_row": {
        "type": "Foreach",
        "foreach": "@body('Parse_CSV')",
        "actions": {
          "Insert_to_SQL": {
            "type": "ApiConnection",
            "inputs": {"body": "@items('For_each_row')"}
          }
        }
      }
    }
  }
}
```

### 2. API Orchestration

```
HTTP Request → Get Customer → Get Orders → Get Shipments → Compose Response → HTTP Response
```

### 3. EDI/B2B Integration

With Integration Accounts:
- X12 and EDIFACT message processing
- Partner agreements
- Schema validation
- Map transformations

## Retry Policies

```json
{
  "type": "Http",
  "inputs": {"method": "POST", "uri": "https://api.example.com"},
  "retryPolicy": {
    "type": "exponential",
    "count": 4,
    "interval": "PT7S",
    "minimumInterval": "PT5S",
    "maximumInterval": "PT1H"
  }
}
```

## Best Practices

1. Use Standard tier for VNet integration
2. Enable diagnostic logging
3. Use managed identities for authentication
4. Parameterize connection strings
5. Implement idempotent actions

Logic Apps handles the complex plumbing of enterprise integration so you can focus on business logic.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
