---
title: "Building gRPC Services with .NET Core 3.1"
description: "Where I actually use gRPC: backend service-to-service in a Kubernetes cluster, where I control both ends and want strong typing across language boundaries.…"
author: Michael John Peña
draft: false
date: 2020-08-18
tags:
  - .NET Core
  - gRPC
  - Microservices
  - API
---

## Why gRPC?

- **Performance** - Binary serialization with Protocol Buffers
- **Strongly typed** - Contract-first development
- **Streaming** - Built-in support for bidirectional streaming
- **Cross-platform** - Works across languages and platforms

## Creating a gRPC Service

```bash
# Create a new gRPC service
dotnet new grpc -n MyGrpcService

cd MyGrpcService
```

## Defining the Service Contract

Create a `.proto` file:

```protobuf
// Protos/product.proto
syntax = "proto3";

option csharp_namespace = "MyGrpcService";

package product;

service ProductService {
    rpc GetProduct (GetProductRequest) returns (ProductResponse);
    rpc GetAllProducts (GetAllProductsRequest) returns (stream ProductResponse);
    rpc CreateProduct (CreateProductRequest) returns (ProductResponse);
    rpc UpdateInventory (stream UpdateInventoryRequest) returns (UpdateInventoryResponse);
}

message GetProductRequest {
    string product_id = 1;
}

message GetAllProductsRequest {
    int32 page_size = 1;
    string page_token = 2;
}

message CreateProductRequest {
    string name = 1;
    string description = 2;
    double price = 3;
    int32 stock_quantity = 4;
}

message UpdateInventoryRequest {
    string product_id = 1;
    int32 quantity_change = 2;
}

message UpdateInventoryResponse {
    int32 total_updated = 1;
    repeated string updated_product_ids = 2;
}

message ProductResponse {
    string id = 1;
    string name = 2;
    string description = 3;
    double price = 4;
    int32 stock_quantity = 5;
    google.protobuf.Timestamp created_at = 6;
}
```

Update the `.csproj`:

```xml
<ItemGroup>
    <Protobuf Include="Protos\product.proto" GrpcServices="Server" />
</ItemGroup>
```

## Implementing the Service

```csharp
using Grpc.Core;
using Microsoft.Extensions.Logging;

public class ProductServiceImpl : ProductService.ProductServiceBase
{
    private readonly ILogger<ProductServiceImpl> _logger;
    private readonly IProductRepository _repository;

    public ProductServiceImpl(
        ILogger<ProductServiceImpl> logger,
        IProductRepository repository)
    {
        _logger = logger;
        _repository = repository;
    }

    public override async Task<ProductResponse> GetProduct(
        GetProductRequest request,
        ServerCallContext context)
    {
        _logger.LogInformation("Getting product {ProductId}", request.ProductId);

        var product = await _repository.GetByIdAsync(request.ProductId);

        if (product == null)
        {
            throw new RpcException(new Status(StatusCode.NotFound,
                $"Product {request.ProductId} not found"));
        }

        return MapToResponse(product);
    }

    public override async Task GetAllProducts(
        GetAllProductsRequest request,
        IServerStreamWriter<ProductResponse> responseStream,
        ServerCallContext context)
    {
        var products = await _repository.GetAllAsync(request.PageSize);

        foreach (var product in products)
        {
            if (context.CancellationToken.IsCancellationRequested)
                break;

            await responseStream.WriteAsync(MapToResponse(product));
        }
    }

    public override async Task<ProductResponse> CreateProduct(
        CreateProductRequest request,
        ServerCallContext context)
    {
        var product = new Product
        {
            Id = Guid.NewGuid().ToString(),
            Name = request.Name,
            Description = request.Description,
            Price = (decimal)request.Price,
            StockQuantity = request.StockQuantity,
            CreatedAt = DateTime.UtcNow
        };

        await _repository.CreateAsync(product);

        return MapToResponse(product);
    }

    public override async Task<UpdateInventoryResponse> UpdateInventory(
        IAsyncStreamReader<UpdateInventoryRequest> requestStream,
        ServerCallContext context)
    {
        var updatedIds = new List<string>();

        await foreach (var request in requestStream.ReadAllAsync())
        {
            await _repository.UpdateInventoryAsync(
                request.ProductId,
                request.QuantityChange);

            updatedIds.Add(request.ProductId);
        }

        return new UpdateInventoryResponse
        {
            TotalUpdated = updatedIds.Count,
            UpdatedProductIds = { updatedIds }
        };
    }

    private ProductResponse MapToResponse(Product product)
    {
        return new ProductResponse
        {
            Id = product.Id,
            Name = product.Name,
            Description = product.Description,
            Price = (double)product.Price,
            StockQuantity = product.StockQuantity,
            CreatedAt = Timestamp.FromDateTime(product.CreatedAt.ToUniversalTime())
        };
    }
}
```

## Configuring the Service

In `Startup.cs`:

```csharp
public class Startup
{
    public void ConfigureServices(IServiceCollection services)
    {
        services.AddGrpc(options =>
        {
            options.EnableDetailedErrors = true;
            options.MaxReceiveMessageSize = 2 * 1024 * 1024; // 2MB
            options.MaxSendMessageSize = 5 * 1024 * 1024; // 5MB
        });

        services.AddSingleton<IProductRepository, ProductRepository>();
    }

    public void Configure(IApplicationBuilder app, IWebHostEnvironment env)
    {
        app.UseRouting();

        app.UseEndpoints(endpoints =>
        {
            endpoints.MapGrpcService<ProductServiceImpl>();
        });
    }
}
```

## Creating a gRPC Client

```csharp
using Grpc.Net.Client;

public class ProductClient
{
    private readonly ProductService.ProductServiceClient _client;

    public ProductClient(string address)
    {
        var channel = GrpcChannel.ForAddress(address);
        _client = new ProductService.ProductServiceClient(channel);
    }

    public async Task<ProductResponse> GetProductAsync(string productId)
    {
        var request = new GetProductRequest { ProductId = productId };
        return await _client.GetProductAsync(request);
    }

    public async Task<List<ProductResponse>> GetAllProductsAsync(int pageSize)
    {
        var request = new GetAllProductsRequest { PageSize = pageSize };
        var products = new List<ProductResponse>();

        using var call = _client.GetAllProducts(request);

        await foreach (var product in call.ResponseStream.ReadAllAsync())
        {
            products.Add(product);
        }

        return products;
    }

    public async Task<UpdateInventoryResponse> UpdateInventoryBatchAsync(
        List<(string ProductId, int QuantityChange)> updates)
    {
        using var call = _client.UpdateInventory();

        foreach (var (productId, quantityChange) in updates)
        {
            await call.RequestStream.WriteAsync(new UpdateInventoryRequest
            {
                ProductId = productId,
                QuantityChange = quantityChange
            });
        }

        await call.RequestStream.CompleteAsync();

        return await call.ResponseAsync;
    }
}
```

## Dependency Injection for Clients

```csharp
// In client application Startup.cs
services.AddGrpcClient<ProductService.ProductServiceClient>(options =>
{
    options.Address = new Uri("https://localhost:5001");
})
.ConfigurePrimaryHttpMessageHandler(() =>
{
    var handler = new HttpClientHandler();
    // For development only
    handler.ServerCertificateCustomValidationCallback =
        HttpClientHandler.DangerousAcceptAnyServerCertificateValidator;
    return handler;
});
```

## Error Handling

```csharp
try
{
    var product = await _client.GetProductAsync(new GetProductRequest { ProductId = "123" });
}
catch (RpcException ex) when (ex.StatusCode == StatusCode.NotFound)
{
    Console.WriteLine($"Product not found: {ex.Status.Detail}");
}
catch (RpcException ex) when (ex.StatusCode == StatusCode.Unavailable)
{
    Console.WriteLine("Service is unavailable");
}
```

## Health Checks

```csharp
// Add health check support
services.AddGrpcHealthChecks()
    .AddCheck("database", () => HealthCheckResult.Healthy());

// In endpoints
endpoints.MapGrpcHealthChecksService();
```

Where I actually use gRPC: backend service-to-service in a Kubernetes cluster, where I control both ends and want strong typing across language boundaries. Where I don't: anything browser-facing (gRPC-Web exists, but it's a compromise), or for partner integrations where REST + OpenAPI is the universal currency. Pick gRPC when the perf and contract benefits outweigh the loss of curl-friendly debugging.
