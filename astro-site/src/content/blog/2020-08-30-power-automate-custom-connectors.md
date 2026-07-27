---
title: "Building Power Automate Custom Connectors"
author: Michael John Peña
draft: false
date: 2020-08-30
tags:
  - Power Platform
  - Power Automate
  - Integration
  - Low-Code

---

I wrote "Building Power Automate Custom Connectors" to share practical, production-minded guidance on this topic.

## OpenAPI Definition

Start with a Swagger/OpenAPI spec:

```yaml
swagger: "2.0"
info:
  title: Inventory API
  version: "1.0"
host: api.company.com
basePath: /v1
schemes:
  - https
securityDefinitions:
  apiKey:
    type: apiKey
    in: header
    name: X-API-Key
paths:
  /inventory/{sku}:
    get:
      operationId: GetInventory
      summary: Get inventory level for a SKU
      parameters:
        - name: sku
          in: path
          required: true
          type: string
      responses:
        200:
          description: Success
          schema:
            type: object
            properties:
              sku:
                type: string
              quantity:
                type: integer
              warehouse:
                type: string
```

## Creating the Connector

1. Navigate to make.powerapps.com
2. Data → Custom Connectors → New
3. Import your OpenAPI file
4. Configure authentication
5. Test and create

## Usage in Flows

Once created, business users can use it like any other connector:

```
When an item is created in SharePoint (Trigger)
  ↓
Get Inventory (Custom Connector)
  ↓
Condition: If quantity < 10
  ↓
Send email notification
```

The power of custom connectors: developers build once, business users consume forever.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
