---
title: "Building Plugins for ChatGPT: Extending AI with Custom Tools"
author: Michael John Peña
draft: false
date: 2023-05-17
tags:
  - ChatGPT
  - Plugins
  - OpenAI
  - AI
  - API Development

---

I wrote "Building Plugins for ChatGPT: Extending AI with Custom Tools" to share practical, production-minded guidance on this topic.

## Plugin Architecture

```
┌─────────────────────────────────────────────────────┐
│                     ChatGPT                          │
├─────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────┐│
│  │              Plugin System                       ││
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐        ││
│  │  │Manifest │  │OpenAPI  │  │ Auth    │        ││
│  │  │ (JSON)  │  │ Spec    │  │ Config  │        ││
│  │  └────┬────┘  └────┬────┘  └────┬────┘        ││
│  │       └───────────┬┴───────────┘              ││
│  │                   ▼                            ││
│  │           Plugin Host API                      ││
│  └─────────────────────────────────────────────────┘│
│                        │                            │
│                        ▼                            │
│  ┌─────────────────────────────────────────────────┐│
│  │              Your Plugin API                     ││
│  │    (Any language/framework, REST endpoints)     ││
│  └─────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────┘
```

## Plugin Components

### 1. Plugin Manifest (ai-plugin.json)

```json
{
  "schema_version": "v1",
  "name_for_human": "Product Catalog",
  "name_for_model": "product_catalog",
  "description_for_human": "Search and browse our product catalog to find items, check prices, and view availability.",
  "description_for_model": "Plugin for searching products in the catalog. Use it when users ask about products, prices, availability, or want product recommendations. Always provide helpful product information.",
  "auth": {
    "type": "none"
  },
  "api": {
    "type": "openapi",
    "url": "https://your-plugin.azurewebsites.net/.well-known/openapi.yaml"
  },
  "logo_url": "https://your-plugin.azurewebsites.net/logo.png",
  "contact_email": "support@yourcompany.com",
  "legal_info_url": "https://yourcompany.com/legal"
}
```

### 2. OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: Product Catalog Plugin
  description: Search and browse products in the catalog
  version: 1.0.0
servers:
  - url: https://your-plugin.azurewebsites.net
paths:
  /search:
    get:
      operationId: searchProducts
      summary: Search for products
      description: Search the product catalog by query, category, or price range
      parameters:
        - name: query
          in: query
          description: Search query for product name or description
          required: true
          schema:
            type: string
        - name: category
          in: query
          description: Filter by product category
          required: false
          schema:
            type: string
            enum: [electronics, clothing, home, sports, toys]
        - name: min_price
          in: query
          description: Minimum price filter
          required: false
          schema:
            type: number
        - name: max_price
          in: query
          description: Maximum price filter
          required: false
          schema:
            type: number
        - name: limit
          in: query
          description: Maximum number of results to return
          required: false
          schema:
            type: integer
            default: 10
      responses:
        "200":
          description: Successful response with product list
          content:
            application/json:
              schema:
                type: object
                properties:
                  products:
                    type: array
                    items:
                      $ref: '#/components/schemas/Product'
                  total_count:
                    type: integer

  /products/{product_id}:
    get:
      operationId: getProduct
      summary: Get product details
      description: Get detailed information about a specific product
      parameters:
        - name: product_id
          in: path
          description: The product ID
          required: true
          schema:
            type: string
      responses:
        "200":
          description: Product details
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Product'
        "404":
          description: Product not found

components:
  schemas:
    Product:
      type: object
      properties:
        id:
          type: string
          description: Unique product identifier
        name:
          type: string
          description: Product name
        description:
          type: string
          description: Product description
        category:
          type: string
          description: Product category
        price:
          type: number
          description: Current price
        currency:
          type: string
          description: Currency code (e.g., USD)
        in_stock:
          type: boolean
          description: Whether the product is in stock
        image_url:
          type: string
          description: URL to product image
        rating:
          type: number
          description: Average customer rating (1-5)
```

### 3. API Implementation (Python/FastAPI)

```python
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel
from typing import List, Optional
import json

app = FastAPI()

# Enable CORS for ChatGPT
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://chat.openai.com"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

# Sample product data
PRODUCTS = [
    {
        "id": "prod-001",
        "name": "Wireless Bluetooth Headphones",
        "description": "Premium noise-canceling headphones with 30-hour battery life",
        "category": "electronics",
        "price": 149.99,
        "currency": "USD",
        "in_stock": True,
        "image_url": "https://example.com/headphones.jpg",
        "rating": 4.5
    },
    {
        "id": "prod-002",
        "name": "Running Shoes Pro",
        "description": "Lightweight running shoes with advanced cushioning",
        "category": "sports",
        "price": 129.99,
        "currency": "USD",
        "in_stock": True,
        "image_url": "https://example.com/shoes.jpg",
        "rating": 4.8
    },
    # ... more products
]

class Product(BaseModel):
    id: str
    name: str
    description: str
    category: str
    price: float
    currency: str
    in_stock: bool
    image_url: str
    rating: float

class SearchResponse(BaseModel):
    products: List[Product]
    total_count: int

# Serve plugin manifest
@app.get("/.well-known/ai-plugin.json")
async def get_manifest():
    with open("ai-plugin.json", "r") as f:
        return JSONResponse(content=json.load(f))

# Serve OpenAPI spec
@app.get("/.well-known/openapi.yaml")
async def get_openapi():
    return FileResponse("openapi.yaml", media_type="text/yaml")

# Search products endpoint
@app.get("/search", response_model=SearchResponse)
async def search_products(
    query: str = Query(..., description="Search query"),
    category: Optional[str] = Query(None, description="Category filter"),
    min_price: Optional[float] = Query(None, description="Minimum price"),
    max_price: Optional[float] = Query(None, description="Maximum price"),
    limit: int = Query(10, description="Max results")
):
    results = []

    for product in PRODUCTS:
        # Filter by query
        if query.lower() not in product["name"].lower() and \
           query.lower() not in product["description"].lower():
            continue

        # Filter by category
        if category and product["category"] != category:
            continue

        # Filter by price
        if min_price and product["price"] < min_price:
            continue
        if max_price and product["price"] > max_price:
            continue

        results.append(product)

        if len(results) >= limit:
            break

    return SearchResponse(products=results, total_count=len(results))

# Get product details endpoint
@app.get("/products/{product_id}", response_model=Product)
async def get_product(product_id: str):
    for product in PRODUCTS:
        if product["id"] == product_id:
            return product

    raise HTTPException(status_code=404, detail="Product not found")

# Health check
@app.get("/health")
async def health():
    return {"status": "healthy"}
```

## Adding Authentication

### OAuth Authentication

```json
{
  "auth": {
    "type": "oauth",
    "client_url": "https://your-plugin.azurewebsites.net/oauth/authorize",
    "scope": "read:products",
    "authorization_url": "https://your-plugin.azurewebsites.net/oauth/token",
    "authorization_content_type": "application/x-www-form-urlencoded",
    "verification_tokens": {
      "openai": "your-verification-token"
    }
  }
}
```

### Service-Level Authentication

```json
{
  "auth": {
    "type": "service_http",
    "authorization_type": "bearer",
    "verification_tokens": {
      "openai": "your-verification-token"
    }
  }
}
```

```python
from fastapi import Depends, HTTPException, Security
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

security = HTTPBearer()

async def verify_token(credentials: HTTPAuthorizationCredentials = Security(security)):
    if credentials.credentials != "expected-token":
        raise HTTPException(status_code=401, detail="Invalid token")
    return credentials.credentials

@app.get("/search", dependencies=[Depends(verify_token)])
async def search_products(...):
    # ... implementation
```

## Deploying to Azure

```bash
# Create Azure resources
az group create --name plugin-rg --location eastus

az webapp create \
    --resource-group plugin-rg \
    --plan plugin-plan \
    --name your-plugin \
    --runtime "PYTHON:3.11"

# Deploy code
az webapp deployment source config-local-git \
    --resource-group plugin-rg \
    --name your-plugin

git push azure main

# Configure custom domain and SSL
az webapp config hostname add \
    --resource-group plugin-rg \
    --webapp-name your-plugin \
    --hostname your-plugin.yourdomain.com
```

## Testing Your Plugin

```python
# Test locally before deploying
import requests

BASE_URL = "http://localhost:8000"

# Test manifest
manifest = requests.get(f"{BASE_URL}/.well-known/ai-plugin.json").json()
print(f"Plugin: {manifest['name_for_human']}")

# Test search
search_results = requests.get(
    f"{BASE_URL}/search",
    params={"query": "headphones", "max_price": 200}
).json()
print(f"Found {search_results['total_count']} products")

# Test product details
product = requests.get(f"{BASE_URL}/products/prod-001").json()
print(f"Product: {product['name']} - ${product['price']}")
```

## Best Practices

```python
plugin_best_practices = {
    "descriptions": [
        "Write clear, specific descriptions for the model",
        "Include examples of when to use each endpoint",
        "Be explicit about parameter formats"
    ],
    "responses": [
        "Return structured, consistent JSON",
        "Include relevant metadata",
        "Keep responses concise for token efficiency"
    ],
    "security": [
        "Implement rate limiting",
        "Validate all inputs",
        "Use HTTPS everywhere",
        "Implement proper authentication"
    ],
    "performance": [
        "Optimize for fast response times",
        "Implement caching where appropriate",
        "Handle errors gracefully"
    ]
}
```

ChatGPT plugins extend AI capabilities with real-time data and actions. Tomorrow, I will cover function calling patterns in more depth.

## Resources

- [ChatGPT Plugin Documentation](https://platform.openai.com/docs/plugins/)
- [OpenAPI Specification](https://swagger.io/specification/)
- [FastAPI Documentation](https://fastapi.tiangolo.com/)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
