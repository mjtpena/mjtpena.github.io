---
title: "gRPC on Azure: High-Performance API Communication"
author: Michael John Peña
draft: false
date: 2022-06-18
tags:
  - gRPC
  - Azure
  - API
  - Microservices
---

## Defining gRPC Services

```protobuf
// product.proto
syntax = "proto3";
package product;

service ProductService {
  rpc GetProduct(GetProductRequest) returns (Product);
  rpc ListProducts(ListProductsRequest) returns (stream Product);
  rpc CreateProduct(Product) returns (Product);
}

message GetProductRequest {
  string id = 1;
}

message ListProductsRequest {
  int32 page_size = 1;
  string page_token = 2;
}

message Product {
  string id = 1;
  string name = 2;
  double price = 3;
  string category = 4;
}
```

## .NET gRPC Implementation

```csharp
public class ProductServiceImpl : ProductService.ProductServiceBase
{
    private readonly IProductRepository _repository;

    public ProductServiceImpl(IProductRepository repository)
    {
        _repository = repository;
    }

    public override async Task<Product> GetProduct(
        GetProductRequest request,
        ServerCallContext context)
    {
        var product = await _repository.GetByIdAsync(request.Id);
        if (product == null)
        {
            throw new RpcException(new Status(StatusCode.NotFound, "Product not found"));
        }
        return product;
    }

    public override async Task ListProducts(
        ListProductsRequest request,
        IServerStreamWriter<Product> responseStream,
        ServerCallContext context)
    {
        await foreach (var product in _repository.GetAllAsync())
        {
            await responseStream.WriteAsync(product);
        }
    }
}
```

## gRPC with Azure Container Apps

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: grpc-service
spec:
  template:
    spec:
      containers:
      - name: grpc
        image: mygrpc:latest
        ports:
        - containerPort: 50051
          protocol: TCP
```

## Summary

gRPC offers binary serialization, HTTP/2 multiplexing, and streaming for high-performance microservices on Azure.
