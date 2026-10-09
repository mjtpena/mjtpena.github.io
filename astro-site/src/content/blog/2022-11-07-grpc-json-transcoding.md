---
title: "gRPC JSON Transcoding in .NET 7: REST and gRPC from One Service"
description: "JSON transcoding bridges this gap."
author: Michael John Peña
draft: false
date: 2022-11-07
tags:
  - gRPC
  - .NET
  - ASP.NET Core
  - API
  - Azure
---

## Why JSON Transcoding?

gRPC is excellent for:
- Service-to-service communication
- High-performance scenarios
- Strongly-typed contracts

But not all clients support gRPC:
- Browsers have limited gRPC support
- Mobile apps may prefer REST
- Third-party integrations often expect REST

JSON transcoding bridges this gap.

## Setting Up gRPC JSON Transcoding

First, add the required packages:

```xml
<ItemGroup>
    <PackageReference Include="Grpc.AspNetCore" Version="2.50.0" />
    <PackageReference Include="Microsoft.AspNetCore.Grpc.JsonTranscoding" Version="7.0.0" />
</ItemGroup>
```

## Define Your Proto File

Use Google's HTTP annotations to define REST mappings:

```protobuf
syntax = "proto3";

option csharp_namespace = "ProductService";

import "google/api/annotations.proto";

package products;

service ProductService {
    rpc GetProducts (GetProductsRequest) returns (GetProductsResponse) {
        option (google.api.http) = {
            get: "/api/v1/products"
        };
    }

    rpc GetProduct (GetProductRequest) returns (Product) {
        option (google.api.http) = {
            get: "/api/v1/products/{id}"
        };
    }

    rpc CreateProduct (CreateProductRequest) returns (Product) {
        option (google.api.http) = {
            post: "/api/v1/products"
            body: "*"
        };
    }

    rpc UpdateProduct (UpdateProductRequest) returns (Product) {
        option (google.api.http) = {
            put: "/api/v1/products/{id}"
            body: "product"
        };
    }

    rpc DeleteProduct (DeleteProductRequest) returns (DeleteProductResponse) {
        option (google.api.http) = {
            delete: "/api/v1/products/{id}"
        };
    }

    rpc SearchProducts (SearchProductsRequest) returns (stream Product) {
        option (google.api.http) = {
            get: "/api/v1/products/search"
        };
    }
}

message GetProductsRequest {
    int32 page = 1;
    int32 page_size = 2;
    string category = 3;
}

message GetProductsResponse {
    repeated Product products = 1;
    int32 total_count = 2;
}

message GetProductRequest {
    string id = 1;
}

message CreateProductRequest {
    string name = 1;
    string description = 2;
    double price = 3;
    string category = 4;
}

message UpdateProductRequest {
    string id = 1;
    Product product = 2;
}

message DeleteProductRequest {
    string id = 1;
}

message DeleteProductResponse {
    bool success = 1;
}

message SearchProductsRequest {
    string query = 1;
    int32 max_results = 2;
}

message Product {
    string id = 1;
    string name = 2;
    string description = 3;
    double price = 4;
    string category = 5;
    string created_at = 6;
}
```

## Configure the Service

```csharp
var builder = WebApplication.CreateBuilder(args);

// Add gRPC with JSON transcoding
builder.Services.AddGrpc().AddJsonTranscoding();

// Add Swagger for the REST API
builder.Services.AddGrpcSwagger();
builder.Services.AddSwaggerGen(c =>
{
    c.SwaggerDoc("v1", new OpenApiInfo { Title = "Product API", Version = "v1" });
});

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI(c => c.SwaggerEndpoint("/swagger/v1/swagger.json", "Product API v1"));
}

app.MapGrpcService<ProductServiceImpl>();

app.Run();
```

## Implement the gRPC Service

```csharp
using Grpc.Core;

public class ProductServiceImpl : ProductService.ProductServiceBase
{
    private readonly IProductRepository _repository;
    private readonly ILogger<ProductServiceImpl> _logger;

    public ProductServiceImpl(IProductRepository repository, ILogger<ProductServiceImpl> logger)
    {
        _repository = repository;
        _logger = logger;
    }

    public override async Task<GetProductsResponse> GetProducts(
        GetProductsRequest request,
        ServerCallContext context)
    {
        _logger.LogInformation("Getting products - Page: {Page}, Size: {Size}",
            request.Page, request.PageSize);

        var (products, totalCount) = await _repository.GetProductsAsync(
            request.Page,
            request.PageSize,
            request.Category);

        var response = new GetProductsResponse { TotalCount = totalCount };
        response.Products.AddRange(products.Select(MapToProto));

        return response;
    }

    public override async Task<Product> GetProduct(
        GetProductRequest request,
        ServerCallContext context)
    {
        var product = await _repository.GetByIdAsync(request.Id);

        if (product is null)
        {
            throw new RpcException(new Status(StatusCode.NotFound,
                $"Product {request.Id} not found"));
        }

        return MapToProto(product);
    }

    public override async Task<Product> CreateProduct(
        CreateProductRequest request,
        ServerCallContext context)
    {
        var product = new Domain.Product
        {
            Id = Guid.NewGuid().ToString(),
            Name = request.Name,
            Description = request.Description,
            Price = (decimal)request.Price,
            Category = request.Category,
            CreatedAt = DateTime.UtcNow
        };

        await _repository.CreateAsync(product);

        _logger.LogInformation("Created product {ProductId}", product.Id);

        return MapToProto(product);
    }

    public override async Task<Product> UpdateProduct(
        UpdateProductRequest request,
        ServerCallContext context)
    {
        var existing = await _repository.GetByIdAsync(request.Id);

        if (existing is null)
        {
            throw new RpcException(new Status(StatusCode.NotFound,
                $"Product {request.Id} not found"));
        }

        existing.Name = request.Product.Name;
        existing.Description = request.Product.Description;
        existing.Price = (decimal)request.Product.Price;
        existing.Category = request.Product.Category;

        await _repository.UpdateAsync(existing);

        return MapToProto(existing);
    }

    public override async Task<DeleteProductResponse> DeleteProduct(
        DeleteProductRequest request,
        ServerCallContext context)
    {
        var success = await _repository.DeleteAsync(request.Id);

        if (!success)
        {
            throw new RpcException(new Status(StatusCode.NotFound,
                $"Product {request.Id} not found"));
        }

        return new DeleteProductResponse { Success = true };
    }

    public override async Task SearchProducts(
        SearchProductsRequest request,
        IServerStreamWriter<Product> responseStream,
        ServerCallContext context)
    {
        await foreach (var product in _repository.SearchAsync(request.Query, request.MaxResults))
        {
            if (context.CancellationToken.IsCancellationRequested)
                break;

            await responseStream.WriteAsync(MapToProto(product));
        }
    }

    private static Product MapToProto(Domain.Product product) => new()
    {
        Id = product.Id,
        Name = product.Name,
        Description = product.Description ?? "",
        Price = (double)product.Price,
        Category = product.Category ?? "",
        CreatedAt = product.CreatedAt.ToString("O")
    };
}
```

## Using the APIs

Now you can access the same service via gRPC or REST:

### gRPC Client

```csharp
using Grpc.Net.Client;
using ProductService;

var channel = GrpcChannel.ForAddress("https://localhost:5001");
var client = new ProductService.ProductServiceClient(channel);

// Get all products
var response = await client.GetProductsAsync(new GetProductsRequest
{
    Page = 1,
    PageSize = 10,
    Category = "Electronics"
});

foreach (var product in response.Products)
{
    Console.WriteLine($"{product.Id}: {product.Name} - ${product.Price}");
}

// Create a product
var newProduct = await client.CreateProductAsync(new CreateProductRequest
{
    Name = "New Product",
    Description = "A great new product",
    Price = 29.99,
    Category = "Electronics"
});
```

### REST Client (same service!)

```bash
# Get all products
curl https://localhost:5001/api/v1/products?page=1&page_size=10&category=Electronics

# Get a single product
curl https://localhost:5001/api/v1/products/123

# Create a product
curl -X POST https://localhost:5001/api/v1/products \
  -H "Content-Type: application/json" \
  -d '{"name":"New Product","description":"A great product","price":29.99,"category":"Electronics"}'

# Update a product
curl -X PUT https://localhost:5001/api/v1/products/123 \
  -H "Content-Type: application/json" \
  -d '{"product":{"name":"Updated Product","price":39.99}}'

# Delete a product
curl -X DELETE https://localhost:5001/api/v1/products/123
```

## Error Handling

gRPC status codes are automatically mapped to HTTP status codes:

```csharp
public override async Task<Product> GetProduct(
    GetProductRequest request,
    ServerCallContext context)
{
    var product = await _repository.GetByIdAsync(request.Id);

    if (product is null)
    {
        // gRPC: StatusCode.NotFound
        // REST: HTTP 404
        throw new RpcException(new Status(StatusCode.NotFound,
            $"Product {request.Id} not found"));
    }

    if (!await _authService.CanAccessProduct(context, request.Id))
    {
        // gRPC: StatusCode.PermissionDenied
        // REST: HTTP 403
        throw new RpcException(new Status(StatusCode.PermissionDenied,
            "Access denied"));
    }

    return MapToProto(product);
}
```

## Custom JSON Options

Configure JSON serialization:

```csharp
builder.Services.AddGrpc().AddJsonTranscoding();
builder.Services.Configure<JsonTranscodingOptions>(options =>
{
    options.JsonSettings.WriteIndented = true;
    options.JsonSettings.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
});
```

## Deploying to Azure

### Azure Kubernetes Service (AKS)

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: product-service
spec:
  replicas: 3
  template:
    spec:
      containers:
      - name: product-service
        image: myregistry.azurecr.io/product-service:latest
        ports:
        - containerPort: 80   # REST/HTTP
        - containerPort: 443  # gRPC/HTTP2
```
