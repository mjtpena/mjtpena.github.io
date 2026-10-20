---
title: "Power Automate Custom Connectors: Design the OpenAPI File First"
description: "Why the OpenAPI 2.0 definition decides whether a Power Automate custom connector gets used, plus x-ms extensions, auth, paconn and licensing."
author: Michael John Peña
draft: false
date: 2020-08-30
tags:
  - Power Platform
  - Power Automate
  - Custom Connectors
  - Integration
  - Low-Code
---

Most custom connectors I see are technically working and practically unused. A developer imports a Swagger file, clicks through the wizard, and hands business users actions called "GetV1InventorySku" with inputs labelled "sku" and outputs that only appear as one blob called "body". The connector is only as good as the OpenAPI definition behind it: get that definition right (friendly names, full schemas, x-ms extensions) and keep it in source control, and the wizard becomes almost irrelevant.

## Custom connector or HTTP action?

Before writing a connector, decide whether you need one. The premium HTTP action can already call any REST endpoint, and I covered its auth, retry and paging options in [Power Automate's HTTP action](/blog/2020-08-07-power-automate-http-connector/). The trade-off is who the audience is.

| | HTTP action | Custom connector |
|---|---|---|
| Who builds the flow | Someone comfortable with URLs, headers and JSON | Anyone who can use a standard connector |
| Credentials | Entered in each action (or pulled from Key Vault) | Stored once in a connection, shared like any other |
| Dynamic content | Needs a Parse JSON step and a schema | Comes from the response schema in the definition |
| Reuse | Copy and paste between flows | One definition file, importable into Power Automate, Power Apps and Logic Apps |
| Governance | HTTP and HTTP with Azure AD can be classified in DLP policies | Can be classified in environment-level DLP policies (tenant-level via PowerShell at the time of writing) |
| Licensing | Premium | Premium |

My rule of thumb: if one developer is calling an API from one or two flows, use the HTTP action. If the API will be used by people who shouldn't need to know what a bearer token is, or by more than a handful of flows, build the connector. Licensing doesn't separate the two. The [October 2019 licensing changes](https://learn.microsoft.com/en-us/power-platform/admin/powerapps-flow-licensing-faq) moved the HTTP connectors into premium alongside custom connectors, which already needed a standalone plan, so (once the transition period for older flows ends on 1 October 2020) the flow owner needs a Power Automate per user or per flow plan rather than the rights included with Office 365.

## The definition is the user interface

Custom connectors accept an [OpenAPI 2.0 (Swagger) definition or a Postman collection](https://learn.microsoft.com/en-us/connectors/custom-connectors/define-openapi-definition). OpenAPI 3.0 isn't supported, so if your API framework emits 3.0 by default (recent Swashbuckle and NSwag versions can do either), generate 2.0 output for the connector. The file must also be under 1 MB.

Everything a maker sees in the flow designer comes from this file:

- `info.title` and `info.description` populate the connector's name and description on import (you can override the name in the wizard).
- `summary` on each operation becomes the action name in the picker.
- `operationId` is the internal identifier. Changing it later breaks every flow that uses the action, so pick stable names from day one.
- Parameter and property names, unless overridden, become the input labels and the dynamic content tokens.
- The response `schema` decides whether outputs show up as individual tokens or as one opaque `body`.

That last point matters most. If a response has no schema, makers have to add a Parse JSON step and write the schema themselves, which defeats the purpose of building a connector at all.

## Microsoft's OpenAPI extensions

The standard OpenAPI fields get you a working connector. The [x-ms extensions](https://learn.microsoft.com/en-us/connectors/custom-connectors/openapi-extensions) get you one people enjoy using. The ones I'd add to every connector:

- **`x-ms-summary`** gives parameters and response properties a friendly display name ("Warehouse code" instead of `whCode`).
- **`x-ms-visibility`** takes `important`, `advanced` or `internal`. Important fields are always shown, advanced ones sit behind "Show advanced options", and internal ones are hidden and sent with their default value. Use internal for things like an API version header that makers should never touch.
- **`x-ms-dynamic-values`** fills a dropdown by calling another operation on the same connector. Instead of asking a maker to type a warehouse code from memory, you list the valid ones.
- **`x-ms-trigger`** marks an operation as a trigger. Combined with `x-ms-notification-url` on a webhook registration operation, it lets your API push events into flows.

Here is a complete definition for a small inventory API with a dropdown-driven action and a supporting lookup operation:

```json
{
  "swagger": "2.0",
  "info": {
    "title": "Contoso Inventory",
    "description": "Check stock levels across Contoso warehouses.",
    "version": "1.0"
  },
  "host": "<your-api-host>.azurewebsites.net",
  "basePath": "/v1",
  "schemes": ["https"],
  "consumes": ["application/json"],
  "produces": ["application/json"],
  "securityDefinitions": {
    "api_key": {
      "type": "apiKey",
      "in": "header",
      "name": "X-API-Key"
    }
  },
  "security": [{ "api_key": [] }],
  "paths": {
    "/warehouses": {
      "get": {
        "operationId": "ListWarehouses",
        "summary": "List warehouses",
        "x-ms-visibility": "internal",
        "responses": {
          "200": {
            "description": "Warehouses",
            "schema": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "code": { "type": "string" },
                  "name": { "type": "string" }
                }
              }
            }
          }
        }
      }
    },
    "/warehouses/{warehouse}/inventory/{sku}": {
      "get": {
        "operationId": "GetInventoryLevel",
        "summary": "Get stock level for a product",
        "description": "Returns the quantity on hand for a SKU in one warehouse.",
        "parameters": [
          {
            "name": "warehouse",
            "in": "path",
            "required": true,
            "type": "string",
            "x-ms-summary": "Warehouse",
            "x-ms-dynamic-values": {
              "operationId": "ListWarehouses",
              "value-path": "code",
              "value-title": "name"
            }
          },
          {
            "name": "sku",
            "in": "path",
            "required": true,
            "type": "string",
            "x-ms-summary": "Product SKU"
          }
        ],
        "responses": {
          "200": {
            "description": "Stock level",
            "schema": {
              "type": "object",
              "properties": {
                "sku": { "type": "string", "x-ms-summary": "SKU" },
                "quantity": { "type": "integer", "x-ms-summary": "Quantity on hand" },
                "warehouse": { "type": "string", "x-ms-summary": "Warehouse code" },
                "updatedAt": { "type": "string", "format": "date-time", "x-ms-summary": "Last updated" }
              }
            }
          }
        }
      }
    }
  }
}
```

`ListWarehouses` is marked `internal` so it never clutters the action list, but it still powers the Warehouse dropdown on `GetInventoryLevel`. A maker picks "Sydney DC" from a list, and the flow sends the code behind it.

## Authentication choices

The connector wizard offers no authentication, basic, API key and OAuth 2.0, with OAuth providers including Azure Active Directory and generic OAuth 2.0. How you choose changes what the connection represents:

- **API key** is the quickest, but every flow that uses a connection acts as whoever owns that key. Fine for read-only reference data, weak for anything where the API needs to know which person is calling.
- **OAuth 2.0 with Azure Active Directory** means each connection runs as the signed-in user, so your API can apply its own authorisation per person. Microsoft's walkthrough uses two app registrations (one for the API, one for the connector client), which I recommend so the connector's consent and secret are separate from the API's. The connector client registration needs the redirect URL `https://global.consent.azure-apim.net/redirect`.

For internal line-of-business APIs already protected by Azure AD, I'd go straight to OAuth. Retrofitting user identity after makers have built twenty flows on a shared API key is painful.

If the API is on-premises, a custom connector can route through the on-premises data gateway, which avoids exposing the API publicly just so a flow can reach it. You tick "Connect via on-premises data gateway" on the wizard's General tab, and each connection then picks which installed gateway to use. The gateway is premium under the same licensing as custom connectors, and every call takes an extra hop through the gateway machine, so keep it close to the API and don't treat it as a substitute for publishing an API that is used heavily.

## Keep the definition in source control

The maker portal (Data → Custom connectors in flow.microsoft.com or make.powerapps.com) is fine for a first draft, but editing a connector there means the only copy of your definition lives in one environment. Microsoft's [Power Platform Connectors CLI, `paconn`](https://learn.microsoft.com/en-us/connectors/custom-connectors/paconn-cli), lets you download a connector to files, commit them, and push changes back:

```bash
pip install paconn
paconn login

# Downloads into ./<connector-id>/ (apiDefinition.swagger.json, apiProperties.json, icon.png, settings.json)
paconn download --env <environment-id> --cid <connector-id>
cd <connector-id>

# Create the connector in another environment from the committed files
paconn create --env <target-environment-id> \
  --api-def apiDefinition.swagger.json \
  --api-prop apiProperties.json \
  --icon icon.png \
  --secret "$CONNECTOR_CLIENT_SECRET"   # OAuth 2.0 connectors only; omit for API key

# Push later changes, using the connector ID that create printed
paconn update --env <target-environment-id> --cid <new-connector-id> \
  --api-def apiDefinition.swagger.json \
  --api-prop apiProperties.json \
  --icon icon.png \
  --secret "$CONNECTOR_CLIENT_SECRET"   # OAuth 2.0 connectors only; omit for API key
```

`apiProperties.json` holds the connection parameters (for example the OAuth client ID) and branding colour. Client secrets aren't stored there, so for an OAuth connector you must pass the secret with `--secret` (`-r`) on every create and update. Read it from an environment variable or secret store, as above, rather than typing it inline, so it never lands in shell history or CI logs. Always pass `--icon` on update too: without it, `paconn` replaces your custom icon with the default one. `paconn login` uses an interactive device code sign-in, so it suits a developer workstation or an attended release step rather than a fully unattended pipeline.

The other route is to create the connector inside a solution. Solution-aware custom connectors are in preview at the time of writing, and they move with the rest of your ALM story: export the solution as managed, import it into test and production, and the connector travels with the flows and apps that use it. The preview has rough edges, though. A connector has to be created from within a solution rather than added afterwards, and OAuth client secrets don't travel in the export, so you still re-enter them in each target environment. My take for 2020: use `paconn` and files in Git when the connector is the product and stands on its own, and try solutions when the connector belongs to a specific app or set of flows that you already ship as a solution.

## Limits worth knowing

From the [custom connector FAQ](https://learn.microsoft.com/en-us/connectors/custom-connectors/faq): each user can create up to 50 custom connectors, each connection is limited to 500 requests per minute, and the definition file must be under 1 MB. The request limit is the one that bites. A flow looping over 2,000 rows and calling your connector once per row will hit throttling, so design batch operations into the API if that pattern is likely.

## When not to bother

Don't build a custom connector if a certified connector already exists for the service, even if it lacks one action you need. Use it and fill the gap with the HTTP action. Don't build one for an API that changes shape every sprint either, because every breaking change ripples into flows owned by people who didn't write the API.

Build one when an API is stable, used by makers rather than developers, and worth governing as its own entry in your DLP policies. Then spend your effort on the OpenAPI file: friendly summaries, full response schemas, dropdowns instead of free text, and stable operation IDs. That file is the product. The wizard just packages it.
