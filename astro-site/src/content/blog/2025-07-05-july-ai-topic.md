---
title: "Copilot Extensibility: Building Custom Plugins for Microsoft 365 Copilot"
description: "Use the Copilot Developer Portal to test plugins in a sandboxed environment before enterprise deployment. The new debugging tools show exactly how Copilot…"
author: Michael John Peña
draft: false
date: 2025-07-05
tags:
  - Microsoft 365 Copilot
  - Copilot Extensions
  - TypeScript
  - Enterprise AI
  - Microsoft Graph
---

## Plugin Architecture Overview

Copilot plugins use the OpenAPI specification to define capabilities. The runtime handles authentication, parameter mapping, and response formatting automatically:

```typescript
// plugin-manifest.json
{
  "schema_version": "v1.1",
  "name": "Contoso CRM Plugin",
  "description": "Access customer data and manage relationships",
  "auth": {
    "type": "OAuthPluginVault",
    "reference_id": "contoso-crm-oauth"
  },
  "capabilities": {
    "conversation_starters": [
      "Show my top opportunities",
      "Find customer contacts at Fabrikam"
    ]
  },
  "functions": [
    {
      "name": "getCustomerDetails",
      "description": "Retrieve detailed customer information by name or ID",
      "parameters": {
        "type": "object",
        "properties": {
          "customer_id": {"type": "string"},
          "include_history": {"type": "boolean", "default": false}
        }
      }
    }
  ]
}
```

## Implementing the Backend

Your API endpoint receives structured requests from Copilot and returns formatted responses:

```typescript
import { CopilotPluginRequest, CopilotResponse } from '@microsoft/copilot-sdk';

export async function getCustomerDetails(
  req: CopilotPluginRequest
): Promise<CopilotResponse> {
  const { customer_id, include_history } = req.parameters;

  const customer = await crmService.getCustomer(customer_id);
  const history = include_history
    ? await crmService.getInteractionHistory(customer_id)
    : null;

  return {
    type: "AdaptiveCard",
    body: {
      customer_name: customer.name,
      account_value: customer.annualRevenue,
      primary_contact: customer.primaryContact.email,
      recent_interactions: history?.slice(0, 5),
      actions: [
        { type: "OpenUrl", title: "View in CRM", url: customer.crmUrl }
      ]
    }
  };
}
```

## Testing and Deployment

Use the Copilot Developer Portal to test plugins in a sandboxed environment before enterprise deployment. The new debugging tools show exactly how Copilot interprets your API responses and generates user-facing output.
