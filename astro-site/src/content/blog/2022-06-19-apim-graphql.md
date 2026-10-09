---
title: "Azure API Management GraphQL: Modern API Gateway"
author: Michael John Peña
draft: false
date: 2022-06-19
tags:
  - Azure
  - apim
  - graphql
  - API
---

## Adding GraphQL API

```bash
# Import GraphQL schema
az apim graphql-api import \
    --resource-group myResourceGroup \
    --service-name myAPIM \
    --api-id products-graphql \
    --path /graphql \
    --specification-path schema.graphql
```

## GraphQL Schema

```graphql
type Query {
  product(id: ID!): Product
  products(category: String, limit: Int): [Product!]!
}

type Mutation {
  createProduct(input: CreateProductInput!): Product!
  updateProduct(id: ID!, input: UpdateProductInput!): Product
}

type Product {
  id: ID!
  name: String!
  price: Float!
  category: String!
  inventory: Int!
}

input CreateProductInput {
  name: String!
  price: Float!
  category: String!
}
```

## Resolver Policies

```xml
<policies>
    <inbound>
        <set-graphql-resolver parent-type="Query" field="product">
            <http-data-source>
                <http-request>
                    <set-method>GET</set-method>
                    <set-url>@($"https://api.backend.com/products/{context.Arguments["id"]}")</set-url>
                </http-request>
            </http-data-source>
        </set-graphql-resolver>
    </inbound>
</policies>
```

## Summary

APIM GraphQL support enables modern API patterns with enterprise governance, rate limiting, and authentication.
