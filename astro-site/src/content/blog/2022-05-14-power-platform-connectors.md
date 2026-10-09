---
title: "Power Platform Custom Connectors: Extending Low-Code Capabilities"
author: Michael John Peña
draft: false
date: 2022-05-14
tags:
  - power-platform
  - Connectors
  - Low-Code
  - Azure
---

## Custom Connector Overview

Custom connectors bridge the gap between your APIs and the Power Platform ecosystem, enabling:
- Power Apps integration
- Power Automate workflows
- Logic Apps orchestration

## Creating a Custom Connector

Define your connector using OpenAPI specification:

```yaml
# connector-definition.yaml
swagger: "2.0"
info:
  title: Product Catalog API
  description: API for managing product catalog
  version: "1.0"
host: api.example.com
basePath: /v1
schemes:
  - https
consumes:
  - application/json
produces:
  - application/json
securityDefinitions:
  apiKey:
    type: apiKey
    in: header
    name: X-API-Key
security:
  - apiKey: []

paths:
  /products:
    get:
      summary: Get all products
      operationId: GetProducts
      parameters:
        - name: category
          in: query
          type: string
          description: Filter by category
        - name: minPrice
          in: query
          type: number
          description: Minimum price filter
        - name: maxPrice
          in: query
          type: number
          description: Maximum price filter
        - name: page
          in: query
          type: integer
          default: 1
        - name: pageSize
          in: query
          type: integer
          default: 20
      responses:
        200:
          description: List of products
          schema:
            $ref: "#/definitions/ProductListResponse"
    post:
      summary: Create a product
      operationId: CreateProduct
      parameters:
        - name: body
          in: body
          required: true
          schema:
            $ref: "#/definitions/CreateProductRequest"
      responses:
        201:
          description: Product created
          schema:
            $ref: "#/definitions/Product"

  /products/{id}:
    get:
      summary: Get product by ID
      operationId: GetProduct
      parameters:
        - name: id
          in: path
          required: true
          type: string
      responses:
        200:
          description: Product details
          schema:
            $ref: "#/definitions/Product"
        404:
          description: Product not found
    put:
      summary: Update product
      operationId: UpdateProduct
      parameters:
        - name: id
          in: path
          required: true
          type: string
        - name: body
          in: body
          required: true
          schema:
            $ref: "#/definitions/UpdateProductRequest"
      responses:
        200:
          description: Product updated
          schema:
            $ref: "#/definitions/Product"
    delete:
      summary: Delete product
      operationId: DeleteProduct
      parameters:
        - name: id
          in: path
          required: true
          type: string
      responses:
        204:
          description: Product deleted

definitions:
  Product:
    type: object
    properties:
      id:
        type: string
      name:
        type: string
      description:
        type: string
      price:
        type: number
      category:
        type: string
      imageUrl:
        type: string
      inStock:
        type: boolean
      createdAt:
        type: string
        format: date-time

  ProductListResponse:
    type: object
    properties:
      products:
        type: array
        items:
          $ref: "#/definitions/Product"
      totalCount:
        type: integer
      page:
        type: integer
      pageSize:
        type: integer

  CreateProductRequest:
    type: object
    required:
      - name
      - price
      - category
    properties:
      name:
        type: string
      description:
        type: string
      price:
        type: number
      category:
        type: string
      imageUrl:
        type: string

  UpdateProductRequest:
    type: object
    properties:
      name:
        type: string
      description:
        type: string
      price:
        type: number
      category:
        type: string
      imageUrl:
        type: string
      inStock:
        type: boolean
```

## Backend API Implementation

Create the API that the connector will call:

```csharp
// Controllers/ProductsController.cs
using Microsoft.AspNetCore.Mvc;

[ApiController]
[Route("v1/[controller]")]
public class ProductsController : ControllerBase
{
    private readonly IProductService _productService;

    public ProductsController(IProductService productService)
    {
        _productService = productService;
    }

    [HttpGet]
    public async Task<ActionResult<ProductListResponse>> GetProducts(
        [FromQuery] string? category,
        [FromQuery] decimal? minPrice,
        [FromQuery] decimal? maxPrice,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 20)
    {
        var filter = new ProductFilter
        {
            Category = category,
            MinPrice = minPrice,
            MaxPrice = maxPrice
        };

        var (products, totalCount) = await _productService.GetProductsAsync(filter, page, pageSize);

        return Ok(new ProductListResponse
        {
            Products = products,
            TotalCount = totalCount,
            Page = page,
            PageSize = pageSize
        });
    }

    [HttpGet("{id}")]
    public async Task<ActionResult<Product>> GetProduct(string id)
    {
        var product = await _productService.GetByIdAsync(id);

        if (product == null)
            return NotFound();

        return Ok(product);
    }

    [HttpPost]
    public async Task<ActionResult<Product>> CreateProduct([FromBody] CreateProductRequest request)
    {
        var product = await _productService.CreateAsync(request);
        return CreatedAtAction(nameof(GetProduct), new { id = product.Id }, product);
    }

    [HttpPut("{id}")]
    public async Task<ActionResult<Product>> UpdateProduct(
        string id,
        [FromBody] UpdateProductRequest request)
    {
        var product = await _productService.UpdateAsync(id, request);

        if (product == null)
            return NotFound();

        return Ok(product);
    }

    [HttpDelete("{id}")]
    public async Task<IActionResult> DeleteProduct(string id)
    {
        var deleted = await _productService.DeleteAsync(id);

        if (!deleted)
            return NotFound();

        return NoContent();
    }
}
```

## Policy Templates for Connectors

Add custom policies for data transformation:

```csharp
// Connector Policy Template
public class ConnectorPolicyTemplate
{
    public string TemplateId { get; set; }
    public string Title { get; set; }
    public List<PolicyParameter> Parameters { get; set; }
}

// Example: Add header policy
{
    "templateId": "setheader",
    "title": "Set API Key Header",
    "parameters": {
        "x-api-key": "@connectionParameters('apiKey')"
    }
}

// Example: Transform response
{
    "templateId": "routeRequestToEndpoint",
    "title": "Route to endpoint",
    "parameters": {
        "x-ms-apimTemplateParameter.newPath": "/v1/products"
    }
}
```

## Power Automate Flow Example

Use the custom connector in a flow:

```json
{
  "definition": {
    "$schema": "https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#",
    "contentVersion": "1.0.0.0",
    "triggers": {
      "When_a_new_email_arrives": {
        "type": "ApiConnectionWebhook",
        "inputs": {
          "host": {
            "connection": {
              "name": "@parameters('$connections')['office365']['connectionId']"
            }
          },
          "body": {
            "callback_url": "@{listCallbackUrl()}"
          },
          "path": "/trigger/mailmessage/onnewemail"
        }
      }
    },
    "actions": {
      "Parse_Email_Content": {
        "type": "ParseJson",
        "inputs": {
          "content": "@triggerBody()?['body']",
          "schema": {
            "type": "object",
            "properties": {
              "productName": { "type": "string" },
              "price": { "type": "number" },
              "category": { "type": "string" }
            }
          }
        }
      },
      "Create_Product_via_Custom_Connector": {
        "type": "ApiConnection",
        "inputs": {
          "host": {
            "connection": {
              "name": "@parameters('$connections')['productcatalog']['connectionId']"
            }
          },
          "method": "post",
          "path": "/products",
          "body": {
            "name": "@body('Parse_Email_Content')?['productName']",
            "price": "@body('Parse_Email_Content')?['price']",
            "category": "@body('Parse_Email_Content')?['category']"
          }
        }
      },
      "Send_Confirmation_Email": {
        "type": "ApiConnection",
        "inputs": {
          "host": {
            "connection": {
              "name": "@parameters('$connections')['office365']['connectionId']"
            }
          },
          "method": "post",
          "path": "/v2/Mail",
          "body": {
            "To": "@triggerBody()?['from']",
            "Subject": "Product Created Successfully",
            "Body": "Product @{body('Create_Product_via_Custom_Connector')?['name']} has been created."
          }
        }
      }
    }
  }
}
```

## Power Apps Integration

Use the connector in a Power App:

```javascript
// Power Apps formula examples

// Load products on screen load
Set(
    varProducts,
    ProductCatalog.GetProducts({
        category: Dropdown1.Selected.Value,
        page: 1,
        pageSize: 50
    }).products
);

// Create new product
Set(
    varNewProduct,
    ProductCatalog.CreateProduct({
        name: txtName.Text,
        description: txtDescription.Text,
        price: Value(txtPrice.Text),
        category: ddCategory.Selected.Value
    })
);

If(
    !IsBlank(varNewProduct.id),
    Notify("Product created successfully", NotificationType.Success),
    Notify("Failed to create product", NotificationType.Error)
);

// Update product
ProductCatalog.UpdateProduct(
    Gallery1.Selected.id,
    {
        name: txtEditName.Text,
        price: Value(txtEditPrice.Text),
        inStock: chkInStock.Value
    }
);

// Delete product with confirmation
If(
    Confirm("Are you sure you want to delete this product?"),
    ProductCatalog.DeleteProduct(Gallery1.Selected.id);
    Refresh(varProducts)
);
```

## OAuth 2.0 Authentication

Configure OAuth for secure authentication:

```yaml
securityDefinitions:
  oauth2:
    type: oauth2
    flow: accessCode
    authorizationUrl: https://login.microsoftonline.com/{tenantId}/oauth2/v2.0/authorize
    tokenUrl: https://login.microsoftonline.com/{tenantId}/oauth2/v2.0/token
    scopes:
      api://your-api-client-id/.default: Access the API
```

## Summary

Power Platform custom connectors enable:

- API integration without code
- Citizen developer empowerment
- Reusable connections across apps
- OAuth and API key authentication
- Policy-based request transformation

Bridge your APIs to the low-code world and accelerate digital transformation.
