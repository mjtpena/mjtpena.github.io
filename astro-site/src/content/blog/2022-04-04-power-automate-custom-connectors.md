---
title: "Building Custom Connectors for Power Automate"
author: Michael John Peña
draft: false
date: 2022-04-04
tags:
  - Power Platform
  - Power Automate
  - Custom Connectors
  - API
  - Integration

---

I wrote "Building Custom Connectors for Power Automate" to share practical, production-minded guidance on this topic.

## Custom Connector Basics

A custom connector defines:
- API endpoints and operations
- Authentication method
- Request/response schemas
- Triggers and actions

## Creating from OpenAPI/Swagger

The easiest approach is importing an OpenAPI specification:

```yaml
# openapi.yaml
openapi: '3.0.0'
info:
  title: Inventory API
  version: '1.0'
  description: Custom inventory management API

servers:
  - url: https://api.mycompany.com/v1

security:
  - apiKey: []

paths:
  /products:
    get:
      operationId: GetProducts
      summary: Get all products
      parameters:
        - name: category
          in: query
          schema:
            type: string
        - name: inStock
          in: query
          schema:
            type: boolean
      responses:
        '200':
          description: List of products
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: '#/components/schemas/Product'

    post:
      operationId: CreateProduct
      summary: Create a new product
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/ProductInput'
      responses:
        '201':
          description: Product created
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Product'

  /products/{id}:
    get:
      operationId: GetProduct
      summary: Get product by ID
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      responses:
        '200':
          description: Product details
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Product'

    put:
      operationId: UpdateProduct
      summary: Update a product
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/ProductInput'
      responses:
        '200':
          description: Product updated

    delete:
      operationId: DeleteProduct
      summary: Delete a product
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      responses:
        '204':
          description: Product deleted

components:
  schemas:
    Product:
      type: object
      properties:
        id:
          type: string
        name:
          type: string
        category:
          type: string
        price:
          type: number
        quantity:
          type: integer
        inStock:
          type: boolean
        lastUpdated:
          type: string
          format: date-time

    ProductInput:
      type: object
      required:
        - name
        - category
        - price
      properties:
        name:
          type: string
        category:
          type: string
        price:
          type: number
        quantity:
          type: integer

  securitySchemes:
    apiKey:
      type: apiKey
      name: X-API-Key
      in: header
```

## Authentication Options

### API Key

```yaml
securityDefinitions:
  api_key:
    type: apiKey
    name: X-API-Key
    in: header

# In connector definition
authentication:
  type: apiKey
  apiKey:
    parameterLocation: Header
    name: X-API-Key
```

### OAuth 2.0

```yaml
securityDefinitions:
  oauth2:
    type: oauth2
    flow: accessCode
    authorizationUrl: https://login.example.com/oauth/authorize
    tokenUrl: https://login.example.com/oauth/token
    scopes:
      read: Read access
      write: Write access

# Connector security configuration
authentication:
  type: oauth2
  oauth2:
    authorizationUrl: https://login.example.com/oauth/authorize
    tokenUrl: https://login.example.com/oauth/token
    refreshUrl: https://login.example.com/oauth/refresh
    scopes:
      - read
      - write
    clientId: '{YOUR_CLIENT_ID}'
```

### Azure AD

```yaml
authentication:
  type: oauth2
  oauth2:
    authorizationUrl: https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize
    tokenUrl: https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token
    refreshUrl: https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token
    scopes:
      - api://{client-id}/.default
```

## Adding Triggers

### Webhook Trigger

```yaml
paths:
  /webhooks:
    x-ms-notification-content:
      schema:
        $ref: '#/components/schemas/WebhookPayload'
      description: Webhook payload

    post:
      operationId: CreateWebhook
      x-ms-trigger: single
      summary: When an item is created
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                callbackUrl:
                  type: string
                  x-ms-notification-url: true
                eventType:
                  type: string
                  enum:
                    - created
                    - updated
                    - deleted
      responses:
        '201':
          description: Webhook created

  /webhooks/{webhookId}:
    delete:
      operationId: DeleteWebhook
      summary: Delete webhook
      parameters:
        - name: webhookId
          in: path
          required: true
          schema:
            type: string
      responses:
        '204':
          description: Webhook deleted
```

### Polling Trigger

```yaml
paths:
  /items/poll:
    get:
      operationId: PollForNewItems
      x-ms-trigger: batch
      x-ms-trigger-hint: Poll for new items
      summary: When new items are available
      parameters:
        - name: since
          in: query
          x-ms-trigger-metadata: triggerState
          schema:
            type: string
            format: date-time
      responses:
        '200':
          description: New items
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: '#/components/schemas/Item'
```

## Policy Templates

Add custom behavior with policies:

```xml
<!-- Transform request -->
<set-body template="liquid">
{
    "externalId": "{{body.id}}",
    "displayName": "{{body.name}}",
    "metadata": {
        "source": "PowerAutomate",
        "timestamp": "{{utcNow}}"
    }
}
</set-body>

<!-- Transform response -->
<set-body template="liquid">
{
    "items": [
        {% for item in body.data %}
        {
            "id": "{{item.externalId}}",
            "name": "{{item.displayName}}",
            "created": "{{item.createdAt}}"
        }{% unless forloop.last %},{% endunless %}
        {% endfor %}
    ],
    "count": {{body.total}}
}
</set-body>

<!-- Add headers -->
<set-header name="X-Custom-Header" exists-action="override">
    <value>@(context.Request.Headers.GetValueOrDefault("X-Correlation-Id", Guid.NewGuid().ToString()))</value>
</set-header>
```

## Testing Custom Connectors

### Using the Test Panel

```powershell
# Create test connection
$testParams = @{
    OperationId = "GetProducts"
    Parameters = @{
        category = "Electronics"
        inStock = $true
    }
}

# Execute and verify response
$result = Invoke-CustomConnectorOperation @testParams
$result | Should -Not -BeNullOrEmpty
$result.Count | Should -BeGreaterThan 0
```

### Postman Collection

```json
{
    "info": {
        "name": "Custom Connector Tests"
    },
    "item": [
        {
            "name": "Get Products",
            "request": {
                "method": "GET",
                "header": [
                    {
                        "key": "X-API-Key",
                        "value": "{{apiKey}}"
                    }
                ],
                "url": {
                    "raw": "{{baseUrl}}/products?category=Electronics",
                    "host": ["{{baseUrl}}"],
                    "path": ["products"],
                    "query": [
                        {
                            "key": "category",
                            "value": "Electronics"
                        }
                    ]
                }
            },
            "event": [
                {
                    "listen": "test",
                    "script": {
                        "exec": [
                            "pm.test('Status code is 200', function () {",
                            "    pm.response.to.have.status(200);",
                            "});",
                            "pm.test('Response is array', function () {",
                            "    var jsonData = pm.response.json();",
                            "    pm.expect(jsonData).to.be.an('array');",
                            "});"
                        ]
                    }
                }
            ]
        }
    ]
}
```

## Sharing and Certification

### Share Within Organization

```powershell
# Export connector
Export-PowerAppConnector `
    -ConnectorName "InventoryAPI" `
    -EnvironmentName "Default-{tenant}" `
    -OutputFilePath "./InventoryAPI.zip"

# Import to another environment
Import-PowerAppConnector `
    -FilePath "./InventoryAPI.zip" `
    -EnvironmentName "Production-{tenant}"
```

### Microsoft Certification

For ISV certification, ensure:

```yaml
certification_requirements:
  documentation:
    - Complete API reference
    - Getting started guide
    - Authentication setup instructions
    - Sample flows

  technical:
    - All operations tested
    - Error responses defined
    - Pagination implemented
    - Rate limiting documented

  compliance:
    - Privacy policy URL
    - Terms of service URL
    - Support contact
    - SLA documentation
```

## Best Practices

### Operation Design

```yaml
best_practices:
  naming:
    - Use clear, descriptive operation IDs
    - Follow verb-noun pattern (GetProducts, CreateOrder)
    - Group related operations

  parameters:
    - Use appropriate parameter types
    - Provide default values where sensible
    - Mark required parameters correctly
    - Add descriptions for all parameters

  responses:
    - Define all possible response codes
    - Include error response schemas
    - Use consistent response structure
```

### Error Handling

```yaml
responses:
  '400':
    description: Bad Request
    content:
      application/json:
        schema:
          $ref: '#/components/schemas/Error'
  '401':
    description: Unauthorized
  '403':
    description: Forbidden
  '404':
    description: Not Found
  '429':
    description: Rate Limited
    headers:
      Retry-After:
        schema:
          type: integer
  '500':
    description: Internal Server Error

components:
  schemas:
    Error:
      type: object
      properties:
        code:
          type: string
        message:
          type: string
        details:
          type: array
          items:
            type: object
            properties:
              field:
                type: string
              error:
                type: string
```

## Conclusion

Custom connectors extend Power Automate to any API:
- Import from OpenAPI for quick setup
- Support multiple authentication methods
- Enable triggers via webhooks or polling
- Share across your organization

With custom connectors, there's no API that Power Automate can't integrate with.

## Resources

- [Custom Connector Documentation](https://docs.microsoft.com/en-us/connectors/custom-connectors/)
- [OpenAPI Specification](https://swagger.io/specification/)
- [Connector Certification](https://docs.microsoft.com/en-us/connectors/custom-connectors/submit-certification)

