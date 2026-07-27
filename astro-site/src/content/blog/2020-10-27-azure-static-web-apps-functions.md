---
title: "Azure Functions HTTP APIs: Building Serverless Backends"
author: Michael John Peña
draft: false
date: 2020-10-27
tags:
  - Azure
  - Functions
  - Serverless
  - APIs
---

Static Web Apps with the integrated Functions backend is the deployment story I keep recommending for small SaaS dashboards and internal tools. Static frontend on the global CDN, API as a Function in the same repo and deployment, GitHub Actions wiring it together. No separate App Service plan to manage, no CORS config, no auth shuffle — the platform handles it. For projects that fit the model, it's the cheapest way to ship a real production application.

## Project Structure

```
my-api/
├── GetProducts/
│   ├── function.json
│   └── index.js
├── CreateOrder/
│   ├── function.json
│   └── index.js
├── host.json
├── local.settings.json
└── package.json
```

## HTTP Trigger Function

```javascript
// GetProducts/index.js
module.exports = async function (context, req) {
    const products = [
        { id: 1, name: "Widget", price: 9.99 },
        { id: 2, name: "Gadget", price: 19.99 }
    ];

    context.res = {
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: products
    };
};
```

```json
// GetProducts/function.json
{
    "bindings": [
        {
            "authLevel": "function",
            "type": "httpTrigger",
            "direction": "in",
            "name": "req",
            "methods": ["get"],
            "route": "products"
        },
        {
            "type": "http",
            "direction": "out",
            "name": "res"
        }
    ]
}
```

## Host Configuration

```json
// host.json
{
    "version": "2.0",
    "extensions": {
        "http": {
            "routePrefix": "api",
            "maxOutstandingRequests": 200,
            "maxConcurrentRequests": 100
        }
    },
    "logging": {
        "applicationInsights": {
            "samplingSettings": {
                "isEnabled": true,
                "maxTelemetryItemsPerSecond": 20
            }
        }
    }
}
```

## Authentication Options

### Function Keys

```javascript
// Calling with function key
const response = await fetch('https://myapi.azurewebsites.net/api/products?code=<function-key>');
```

### Azure AD Authentication

```javascript
// Configure in Azure Portal
// Authentication / Authorization settings

// Client code
const token = await getAccessToken();
const response = await fetch('https://myapi.azurewebsites.net/api/products', {
    headers: {
        'Authorization': `Bearer ${token}`
    }
});
```

## Proxies for API Routing

```json
// proxies.json
{
    "$schema": "http://json.schemastore.org/proxies",
    "proxies": {
        "products": {
            "matchCondition": {
                "route": "/v1/products/{*restOfPath}"
            },
            "backendUri": "https://%BACKEND_HOST%/api/products/{restOfPath}"
        },
        "legacy-redirect": {
            "matchCondition": {
                "route": "/old-api/{*path}"
            },
            "responseOverrides": {
                "response.statusCode": "301",
                "response.headers.Location": "/api/{path}"
            }
        }
    }
}
```

## CORS Configuration

```json
// local.settings.json
{
    "IsEncrypted": false,
    "Values": {
        "AzureWebJobsStorage": "UseDevelopmentStorage=true",
        "FUNCTIONS_WORKER_RUNTIME": "node"
    },
    "Host": {
        "CORS": "*",
        "CORSCredentials": false
    }
}
```

## Integration with API Management

```bash
# Import Functions into API Management
az apim api import \
    --path /myapi \
    --api-id my-functions-api \
    --resource-group myRG \
    --service-name my-apim \
    --specification-format OpenApiJson \
    --specification-path ./openapi.json
```

## Environment Configuration

```bash
# Set application settings
az functionapp config appsettings set \
    --name my-functions-app \
    --resource-group myRG \
    --settings "DATABASE_CONNECTION=<connection-string>"

# Access in function
const connectionString = process.env.DATABASE_CONNECTION;
```

## Local Development

```bash
# Install Azure Functions Core Tools
npm install -g azure-functions-core-tools@3

# Create new function
func new --name GetProducts --template "HTTP trigger"

# Run locally
func start

# Test locally
curl http://localhost:7071/api/products
```

## Deployment Options

### Azure CLI

```bash
# Deploy to Azure
func azure functionapp publish my-functions-app
```

### GitHub Actions

```yaml
# .github/workflows/deploy.yml
name: Deploy Functions

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2

      - name: Setup Node.js
        uses: actions/setup-node@v2
        with:
          node-version: '14'

      - name: Install dependencies
        run: npm ci

      - name: Deploy to Azure Functions
        uses: Azure/functions-action@v1
        with:
          app-name: my-functions-app
          package: .
          publish-profile: ${{ secrets.AZURE_FUNCTIONAPP_PUBLISH_PROFILE }}
```

## Best Practices

| Aspect | Recommendation |
|--------|----------------|
| Cold starts | Use Premium plan for critical APIs |
| Scaling | Configure host.json limits |
| Security | Use managed identity for Azure resources |
| Monitoring | Enable Application Insights |
| Versioning | Use route prefixes or API Management |

Azure Functions HTTP triggers: the simplest path to serverless APIs.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
