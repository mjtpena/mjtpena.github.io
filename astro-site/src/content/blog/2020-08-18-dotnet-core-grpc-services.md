---
title: "gRPC on .NET Core 3.1: Contracts, Streaming and Where It Fits"
description: "A practical guide to gRPC on ASP.NET Core 3.1: .proto contracts, unary and streaming calls, deadlines, auth, health checks and when REST is the better choice."
author: Michael John Peña
draft: false
date: 2020-08-18
tags:
  - .NET Core
  - gRPC
  - Microservices
  - API
---

Once a system has more than a handful of internal services, the JSON-over-HTTP contracts between them start to drift. One team renames or drops a JSON property, a consumer quietly deserialises `null`, and you find out in production. gRPC tackles that by making the contract a compiled artefact that both sides generate code from, and since .NET Core 3.0 it has been a first-class part of ASP.NET Core rather than a wrapper around a native library. On .NET Core 3.1, the current LTS release, the contract design and the hosting limits matter far more than the C#.

## What you get, and what it costs

The [official comparison with HTTP APIs](https://learn.microsoft.com/en-us/aspnet/core/grpc/comparison?view=aspnetcore-3.1) is worth reading in full, but the short version is:

| | gRPC | REST + JSON |
|---|---|---|
| Contract | `.proto` file, required | OpenAPI, optional |
| Payload | Protocol Buffers (binary) | JSON (text) |
| Transport | HTTP/2 only | HTTP/1.1 or HTTP/2 |
| Streaming | Client, server and bidirectional | Client, server (no bidirectional) |
| Browser support | Needs gRPC-Web and a proxy or middleware | Native |
| Ad hoc testing | grpcurl, with the `.proto` files or server reflection | curl or a browser |

The performance gain is real, but it's rarely the reason I pick gRPC. The reason is the contract. Regenerating from a shared contract turns many breaking changes into compile errors, and the field-number rules below cover the ones the compiler can't see: a consumer deployed separately keeps running on its old generated stubs, and a renumbered field or changed type is a wire-level break that no compiler will flag. Protobuf also sends field numbers, not names, so renaming a field is safe on the wire. Streaming comes second, because it replaces a lot of awkward polling and batching endpoints.

The cost is tooling and reach. You can't paste a gRPC call into a browser address bar, most API gateways treat it as opaque HTTP/2 traffic, and partners outside your organisation almost always expect REST.

## Starting the project

The `grpc` template ships with the .NET Core 3.1 SDK:

```bash
dotnet new grpc -n ProductService
cd ProductService
dotnet add package Grpc.AspNetCore --version 2.31.0
dotnet add package Grpc.HealthCheck --version 2.31.0
dotnet add package Grpc.AspNetCore.Server.Reflection --version 2.31.0
```

`Grpc.AspNetCore` 2.31.0 is the current stable release of grpc-dotnet and pulls in the protobuf runtime, the `Grpc.Tools` code generator and the server hosting pieces. The template pins an older version, so I update it straight away.

## Designing the contract

Most gRPC pain I see comes from the `.proto` file, not the C#. A few rules I follow:

- **Never reuse or renumber a field.** Field numbers are the wire format. Remove a field by marking its number `reserved`.
- **Don't use `double` for money.** Floating point and currency don't mix. Use an integer in minor units (cents) or a string decimal.
- **Use well-known types** such as `google.protobuf.Timestamp` rather than inventing your own date format, and remember to import them.
- **Give every RPC its own request and response message**, even if it has one field today. It's the only way to add fields later without breaking callers. The one exception I allow is a server stream of an entity: each streamed item *is* a `Product`, so wrapping it adds nothing.

```protobuf
// Protos/product.proto
syntax = "proto3";

option csharp_namespace = "ProductService";

package product;

import "google/protobuf/timestamp.proto";

service Products {
  rpc GetProduct (GetProductRequest) returns (GetProductReply);
  rpc ListProducts (ListProductsRequest) returns (stream Product);
  rpc UpdateInventory (stream InventoryChange) returns (UpdateInventoryReply);
}

message GetProductRequest {
  string product_id = 1;
}

message GetProductReply {
  Product product = 1;
}

message ListProductsRequest {
  int32 max_results = 1;
}

message InventoryChange {
  string product_id = 1;
  int32 quantity_delta = 2;
}

message UpdateInventoryReply {
  int32 total_updated = 1;
  repeated string updated_product_ids = 2;
}

message Product {
  string id = 1;
  string name = 2;
  int64 price_cents = 3;
  int32 stock_quantity = 4;
  google.protobuf.Timestamp created_at = 5;
}
```

Register it in the project file so `Grpc.Tools` generates the server base class:

```xml
<ItemGroup>
  <Protobuf Include="Protos\product.proto" GrpcServices="Server" />
</ItemGroup>
```

If the contract is shared by several services, I put the `.proto` files in their own repository or package and reference them from each project with `GrpcServices="Client"` or `"Server"`. Copied `.proto` files drift exactly like the JSON contracts you were trying to replace.

There's no page token in `ListProductsRequest` on purpose. A server stream lets the client read results as they arrive and cancel when it has enough, which replaces most token-paging designs; `max_results` is just a ceiling.

## Implementing the service

gRPC has four call types: unary, server streaming, client streaming and bidirectional streaming. The example uses the first three; bidirectional gets its own section below. It needs a domain type and a repository; here is a minimal in-memory version so the project compiles. Swap in any data access layer you like.

```csharp
// Data/ProductRepository.cs
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

namespace ProductService
{
    public class ProductRecord
    {
        public string Id { get; set; }
        public string Name { get; set; }
        public long PriceCents { get; set; }
        public int StockQuantity { get; set; }
        public DateTime CreatedAtUtc { get; set; }
    }

    public interface IProductRepository
    {
        Task<ProductRecord> GetByIdAsync(string id, CancellationToken ct);
        Task<IReadOnlyList<ProductRecord>> ListAsync(int maxResults, CancellationToken ct);
        Task<bool> AdjustStockAsync(string id, int delta, CancellationToken ct);
    }

    public class InMemoryProductRepository : IProductRepository
    {
        private readonly ConcurrentDictionary<string, ProductRecord> _products =
            new ConcurrentDictionary<string, ProductRecord>();

        public InMemoryProductRepository()
        {
            var p = new ProductRecord
            {
                Id = "sku-001", Name = "Sample product", PriceCents = 1999,
                StockQuantity = 10, CreatedAtUtc = DateTime.UtcNow
            };
            _products[p.Id] = p;
        }

        public Task<ProductRecord> GetByIdAsync(string id, CancellationToken ct) =>
            Task.FromResult(_products.TryGetValue(id, out var p) ? p : null);

        public Task<IReadOnlyList<ProductRecord>> ListAsync(int maxResults, CancellationToken ct)
        {
            var size = maxResults > 0 ? maxResults : 50;
            IReadOnlyList<ProductRecord> page = _products.Values.Take(size).ToList();
            return Task.FromResult(page);
        }

        public Task<bool> AdjustStockAsync(string id, int delta, CancellationToken ct)
        {
            if (!_products.TryGetValue(id, out var p))
            {
                return Task.FromResult(false);
            }
            lock (p) { p.StockQuantity += delta; }
            return Task.FromResult(true);
        }
    }
}
```

The service itself:

```csharp
using System.Collections.Generic;
using System.Threading.Tasks;
using Google.Protobuf.WellKnownTypes;
using Grpc.Core;
using Microsoft.Extensions.Logging;

namespace ProductService
{
    public class ProductsService : Products.ProductsBase
    {
        private readonly IProductRepository _repository;
        private readonly ILogger<ProductsService> _logger;

        public ProductsService(IProductRepository repository, ILogger<ProductsService> logger)
        {
            _repository = repository;
            _logger = logger;
        }

        public override async Task<GetProductReply> GetProduct(
            GetProductRequest request, ServerCallContext context)
        {
            if (string.IsNullOrWhiteSpace(request.ProductId))
            {
                throw new RpcException(new Status(StatusCode.InvalidArgument, "product_id is required."));
            }
            var product = await _repository.GetByIdAsync(request.ProductId, context.CancellationToken);
            if (product == null)
            {
                throw new RpcException(new Status(StatusCode.NotFound,
                    $"Product '{request.ProductId}' was not found."));
            }
            return new GetProductReply { Product = ToMessage(product) };
        }

        public override async Task ListProducts(
            ListProductsRequest request,
            IServerStreamWriter<Product> responseStream,
            ServerCallContext context)
        {
            if (request.MaxResults < 0)
            {
                throw new RpcException(new Status(StatusCode.InvalidArgument, "max_results can't be negative."));
            }
            var products = await _repository.ListAsync(request.MaxResults, context.CancellationToken);
            foreach (var product in products)
            {
                context.CancellationToken.ThrowIfCancellationRequested();
                await responseStream.WriteAsync(ToMessage(product));
            }
        }

        public override async Task<UpdateInventoryReply> UpdateInventory(
            IAsyncStreamReader<InventoryChange> requestStream,
            ServerCallContext context)
        {
            var updated = new List<string>();
            await foreach (var change in requestStream.ReadAllAsync(context.CancellationToken))
            {
                if (string.IsNullOrWhiteSpace(change.ProductId))
                {
                    throw new RpcException(new Status(StatusCode.InvalidArgument, "product_id is required."));
                }
                if (await _repository.AdjustStockAsync(change.ProductId, change.QuantityDelta, context.CancellationToken))
                {
                    updated.Add(change.ProductId);
                }
                else
                {
                    _logger.LogWarning("Skipped unknown product {ProductId}", change.ProductId);
                }
            }
            _logger.LogInformation("Applied {Count} inventory changes", updated.Count);
            return new UpdateInventoryReply
            {
                TotalUpdated = updated.Count,
                UpdatedProductIds = { updated }
            };
        }

        private static Product ToMessage(ProductRecord product) => new Product
        {
            Id = product.Id,
            Name = product.Name,
            PriceCents = product.PriceCents,
            StockQuantity = product.StockQuantity,
            CreatedAt = Timestamp.FromDateTime(product.CreatedAtUtc)
        };
    }
}
```

Two habits worth copying. First, pass `context.CancellationToken` all the way down. When a client gives up or its deadline passes, the token fires and you stop doing work nobody will read. Second, map "not found" and validation failures to proper status codes (`NotFound`, `InvalidArgument`) rather than throwing a generic exception. An unhandled exception reaches the client as `Unknown` with no detail, which is useless for the caller.

Note the trade-off in `UpdateInventory`: a client stream isn't a transaction. Throwing `InvalidArgument` halfway through leaves the earlier changes applied, so I reject malformed input but skip unknown IDs and report only what actually changed in `updated_product_ids`. If you need all-or-nothing, buffer the stream and apply it in one database transaction at the end.

## Wiring up Startup, with health checks

```csharp
using Grpc.Health.V1;
using Grpc.HealthCheck;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace ProductService
{
    public class Startup
    {
        private readonly IWebHostEnvironment _env;

        public Startup(IWebHostEnvironment env)
        {
            _env = env;
        }

        public void ConfigureServices(IServiceCollection services)
        {
            services.AddGrpc(options =>
            {
                // Default is 4 MB; this deliberately caps incoming messages lower.
                options.MaxReceiveMessageSize = 2 * 1024 * 1024;
                options.EnableDetailedErrors = _env.IsDevelopment();
            });
            services.AddSingleton<IProductRepository, InMemoryProductRepository>();
            services.AddSingleton<HealthServiceImpl>();
            if (_env.IsDevelopment())
            {
                services.AddGrpcReflection();
            }
        }

        public void Configure(IApplicationBuilder app, HealthServiceImpl health)
        {
            // "" is the overall server status, which grpc_health_probe checks by default.
            health.SetStatus("", HealthCheckResponse.Types.ServingStatus.Serving);
            health.SetStatus("product.Products", HealthCheckResponse.Types.ServingStatus.Serving);

            app.UseRouting();
            app.UseEndpoints(endpoints =>
            {
                endpoints.MapGrpcService<ProductsService>();
                endpoints.MapGrpcService<HealthServiceImpl>();
                if (_env.IsDevelopment())
                {
                    endpoints.MapGrpcReflectionService();
                }
            });
        }
    }
}
```

`HealthServiceImpl` from the `Grpc.HealthCheck` package implements the standard `grpc.health.v1.Health` protocol. Registering it as a singleton lets other code flip the status to `NotServing` when a dependency fails. Kubernetes can't probe gRPC natively, so the usual pattern is to ship the [grpc_health_probe](https://github.com/grpc-ecosystem/grpc-health-probe) binary in the image and call it from an `exec` liveness or readiness probe, for example `grpc_health_probe -addr=:5001` (add `-tls` if the endpoint uses TLS). Without a `-service` flag the probe asks about the empty service name `""`, and `HealthServiceImpl` answers `NotFound` for any name it hasn't been told about. Skip that first `SetStatus` call and Kubernetes will restart a perfectly healthy pod. To probe the specific service instead, pass `-service=product.Products`.

The default `MaxReceiveMessageSize` is 4 MB, so the 2 MB setting above is a deliberate cap, not an increase. I'd rather reject an oversized inventory batch than buffer it. `EnableDetailedErrors` is tied to the development environment because it sends exception messages to the client, which is a good way to leak connection strings in production. Server reflection gets the same treatment. It lets grpcurl list and call services without a local copy of the `.proto` files, which is handy on a laptop, but it also hands your full API surface to anyone who can reach the port.

## Securing the endpoints

gRPC on ASP.NET Core uses the normal [authentication and authorisation pipeline](https://learn.microsoft.com/en-us/aspnet/core/grpc/authn-and-authz?view=aspnetcore-3.1), so there's no gRPC-specific security model to learn. For service-to-service calls you have two realistic choices: a JWT bearer token issued by Azure Active Directory or another identity provider, or mutual TLS with client certificates configured on Kestrel (`ClientCertificateMode.RequireCertificate`) plus the certificate authentication handler. I default to bearer tokens because they carry an identity and scopes I can authorise against; mTLS proves which machine is calling, and a mesh like Istio or Linkerd can do that part for you.

```csharp
// Fragment: additions to Startup for JWT bearer auth
// (package Microsoft.AspNetCore.Authentication.JwtBearer 3.1.x)
services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(o =>
    {
        o.Authority = "https://login.microsoftonline.com/<your-tenant-id>/v2.0";
        o.Audience = "api://<your-product-service-app-id>";
    });
services.AddAuthorization();

// In Configure, between UseRouting and UseEndpoints:
app.UseAuthentication();
app.UseAuthorization();
```

Then put `[Authorize]` on `ProductsService`, but not on `HealthServiceImpl`, or your Kubernetes probes will start failing with `Unauthenticated`. On the client side, the token travels as an `Authorization: Bearer <token>` entry in the call's `Metadata` headers.

## Calling it from another service

Register the generated client with the [gRPC client factory](https://learn.microsoft.com/en-us/aspnet/core/grpc/clientfactory?view=aspnetcore-3.1) (`Grpc.Net.ClientFactory`) so it shares `HttpClient` handlers and logging, and always set a deadline:

```csharp
// Fragment: ConfigureServices in the calling service
services.AddGrpcClient<Products.ProductsClient>(o =>
{
    o.Address = new Uri("https://product-service:5001");
});
```

```csharp
// Fragment: a consumer with the client injected
public async Task<Product> GetAsync(string id, CancellationToken ct)
{
    try
    {
        var reply = await _client.GetProductAsync(
            new GetProductRequest { ProductId = id },
            deadline: DateTime.UtcNow.AddSeconds(5),
            cancellationToken: ct);
        return reply.Product;
    }
    catch (RpcException ex) when (ex.StatusCode == StatusCode.NotFound)
    {
        return null;
    }
}
```

gRPC calls have no deadline by default. Without one, a slow downstream service holds the caller's connection open indefinitely, and that's how one struggling service takes down three others. I treat a missing deadline as a code-review failure.

## Bidirectional streaming: when it earns its keep

I left bidirectional streaming out of the example because most services don't need it. It earns its complexity when both sides genuinely talk at once over a long-lived session: chat, live inventory sync between a warehouse system and a store, or a worker that receives jobs and streams back progress on the same call. The cost is operational. One call can stay open for hours, so a request-level proxy can only balance it when it starts; reconnects, deadlines and backpressure become your problem; and gRPC-Web can't carry it to a browser. If a server stream plus the occasional unary call covers the use case, use that.

## Hosting limits to know before you commit

These are the things that catch teams out on .NET Core 3.1:

- **Kestrel only.** gRPC needs HTTP/2 response trailers, which IIS and HTTP.sys can't send yet. That also means Azure App Service can't host gRPC services today, as the [gRPC-Web for .NET announcement](https://devblogs.microsoft.com/dotnet/grpc-web-for-net-now-available/) points out. Containers on AKS or a VM running Kestrel are the realistic targets.
- **No TLS with HTTP/2 on macOS.** Kestrel can't negotiate HTTP/2 over TLS on macOS, so local development there needs an HTTP/2-only endpoint without TLS, configured through Kestrel's endpoint settings.
- **Unencrypted calls need a switch on the client.** On .NET Core 3.x, calling an `http://` gRPC endpoint (common inside a service mesh that terminates TLS for you) requires `AppContext.SetSwitch("System.Net.Http.SocketsHttpHandler.Http2UnencryptedSupport", true)` before the channel is created.
- **`Grpc.Net.Client` needs .NET Core 3.0 or later.** A .NET Framework caller has to use the older `Grpc.Core` package, which wraps the native C library.
- **Browsers need gRPC-Web.** `Grpc.AspNetCore.Web` went GA in June 2020 and works with Blazor WebAssembly and JavaScript clients, but it supports only unary and server streaming calls.
- **Plan for L7 load balancing.** gRPC multiplexes calls over one long-lived HTTP/2 connection, so a standard Kubernetes ClusterIP Service, which balances per TCP connection, pins each client to a single pod while the others sit idle. You need a proxy that balances per request: a service mesh such as Linkerd or Istio, or Envoy in front of the service. The alternative is a headless Service with client-side balancing, but `Grpc.Net.Client` has no built-in client-side load balancing today, so you'd be writing it yourself.

## When I reach for it, and when I don't

Where I actually use gRPC: backend service-to-service in a Kubernetes cluster with a mesh or proxy doing request-level balancing, where I control both ends and want strong typing across language boundaries. Where I don't: anything browser-facing (gRPC-Web exists, but it's a compromise), or for partner integrations, where partners expect an OpenAPI document they can import into Postman or Azure API Management.

I'd also hold off if your hosting is App Service or IIS, if the team has no appetite for managing shared `.proto` files, or if the API is low-volume CRUD where JSON's readability matters more than a few milliseconds. Pick gRPC when the contract and streaming benefits outweigh the loss of curl-friendly debugging, and then spend your design effort on the `.proto` file, deadlines and status codes. Those decisions outlive the C#.
