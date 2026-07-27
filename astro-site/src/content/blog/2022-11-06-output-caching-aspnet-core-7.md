---
title: "Output Caching in ASP.NET Core 7: A Complete Guide"
author: Michael John Peña
draft: false
date: 2022-11-06
tags:
  - ASP.NET Core
  - .NET
  - Performance
  - Caching
  - Azure

---

I wrote "Output Caching in ASP.NET Core 7: A Complete Guide" to share practical, production-minded guidance on this topic.

## What is Output Caching?

Output caching stores the complete HTTP response and serves it directly for subsequent identical requests, bypassing the entire request pipeline. Unlike response caching (which relies on HTTP caching headers), output caching is server-side and gives you complete control.

## Basic Setup

```csharp
var builder = WebApplication.CreateBuilder(args);

builder.Services.AddOutputCache();

var app = builder.Build();

app.UseOutputCache();

app.MapGet("/products", async (IProductService service) =>
{
    var products = await service.GetAllAsync();
    return Results.Ok(products);
}).CacheOutput();

app.Run();
```

## Cache Policies

Create reusable caching policies:

```csharp
builder.Services.AddOutputCache(options =>
{
    // Default policy
    options.AddBasePolicy(builder => builder
        .Expire(TimeSpan.FromMinutes(5)));

    // Named policies
    options.AddPolicy("Products", builder => builder
        .Expire(TimeSpan.FromMinutes(10))
        .Tag("products"));

    options.AddPolicy("ShortCache", builder => builder
        .Expire(TimeSpan.FromSeconds(30)));

    options.AddPolicy("LongCache", builder => builder
        .Expire(TimeSpan.FromHours(1))
        .SetVaryByHeader("Accept-Language"));

    options.AddPolicy("AuthenticatedUsers", builder => builder
        .Expire(TimeSpan.FromMinutes(5))
        .SetVaryByHeader("Authorization"));
});
```

Apply policies to endpoints:

```csharp
app.MapGet("/products", GetProducts)
    .CacheOutput("Products");

app.MapGet("/categories", GetCategories)
    .CacheOutput("LongCache");

app.MapGet("/featured", GetFeatured)
    .CacheOutput("ShortCache");
```

## Vary By Options

Cache different versions based on request characteristics:

```csharp
builder.Services.AddOutputCache(options =>
{
    // Vary by query string parameters
    options.AddPolicy("VaryByQuery", builder => builder
        .Expire(TimeSpan.FromMinutes(5))
        .SetVaryByQuery("page", "pageSize", "sortBy"));

    // Vary by route values
    options.AddPolicy("VaryByRoute", builder => builder
        .Expire(TimeSpan.FromMinutes(10))
        .SetVaryByRouteValue("id"));

    // Vary by headers
    options.AddPolicy("VaryByAccept", builder => builder
        .Expire(TimeSpan.FromMinutes(5))
        .SetVaryByHeader("Accept", "Accept-Encoding"));

    // Vary by custom value
    options.AddPolicy("VaryByCustom", builder => builder
        .Expire(TimeSpan.FromMinutes(5))
        .VaryByValue((context) =>
            new KeyValuePair<string, string>(
                "region",
                context.Request.Headers["X-Region"].FirstOrDefault() ?? "default")));
});
```

## Cache Tags for Invalidation

Use tags to group cached entries for bulk invalidation:

```csharp
builder.Services.AddOutputCache(options =>
{
    options.AddPolicy("ProductDetail", builder => builder
        .Expire(TimeSpan.FromMinutes(30))
        .Tag("products")
        .SetVaryByRouteValue("id"));

    options.AddPolicy("CategoryProducts", builder => builder
        .Expire(TimeSpan.FromMinutes(30))
        .Tag("products")
        .Tag("categories")
        .SetVaryByRouteValue("categoryId"));
});

var app = builder.Build();
app.UseOutputCache();

// Read endpoints with caching
app.MapGet("/products", GetProducts).CacheOutput("Products");
app.MapGet("/products/{id}", GetProductById).CacheOutput("ProductDetail");
app.MapGet("/categories/{categoryId}/products", GetCategoryProducts).CacheOutput("CategoryProducts");

// Write endpoints that invalidate cache
app.MapPost("/products", async (
    Product product,
    IProductService service,
    IOutputCacheStore cache) =>
{
    await service.CreateAsync(product);

    // Invalidate all product-related cache entries
    await cache.EvictByTagAsync("products", default);

    return Results.Created($"/products/{product.Id}", product);
});

app.MapPut("/products/{id}", async (
    int id,
    Product product,
    IProductService service,
    IOutputCacheStore cache) =>
{
    await service.UpdateAsync(id, product);

    // Invalidate product caches
    await cache.EvictByTagAsync("products", default);

    return Results.NoContent();
});
```

## Custom Cache Policies

Create sophisticated caching logic:

```csharp
public class CustomCachePolicy : IOutputCachePolicy
{
    public static readonly CustomCachePolicy Instance = new();

    ValueTask IOutputCachePolicy.CacheRequestAsync(
        OutputCacheContext context,
        CancellationToken cancellationToken)
    {
        var attemptCache = AttemptOutputCaching(context);
        context.EnableOutputCaching = true;
        context.AllowCacheLookup = attemptCache;
        context.AllowCacheStorage = attemptCache;
        context.AllowLocking = true;

        // Set cache duration based on request
        context.ResponseExpirationTimeSpan = GetExpirationTime(context);

        return ValueTask.CompletedTask;
    }

    ValueTask IOutputCachePolicy.ServeFromCacheAsync(
        OutputCacheContext context,
        CancellationToken cancellationToken)
    {
        return ValueTask.CompletedTask;
    }

    ValueTask IOutputCachePolicy.ServeResponseAsync(
        OutputCacheContext context,
        CancellationToken cancellationToken)
    {
        var response = context.HttpContext.Response;

        // Don't cache error responses
        if (response.StatusCode >= 400)
        {
            context.AllowCacheStorage = false;
        }

        return ValueTask.CompletedTask;
    }

    private static bool AttemptOutputCaching(OutputCacheContext context)
    {
        var request = context.HttpContext.Request;

        // Only cache GET and HEAD requests
        if (!HttpMethods.IsGet(request.Method) &&
            !HttpMethods.IsHead(request.Method))
        {
            return false;
        }

        // Don't cache authenticated requests
        if (context.HttpContext.User?.Identity?.IsAuthenticated == true)
        {
            return false;
        }

        return true;
    }

    private static TimeSpan GetExpirationTime(OutputCacheContext context)
    {
        var path = context.HttpContext.Request.Path.Value;

        return path switch
        {
            var p when p?.StartsWith("/api/static") == true => TimeSpan.FromHours(24),
            var p when p?.StartsWith("/api/products") == true => TimeSpan.FromMinutes(10),
            var p when p?.StartsWith("/api/search") == true => TimeSpan.FromMinutes(5),
            _ => TimeSpan.FromMinutes(1)
        };
    }
}

// Register the custom policy
builder.Services.AddOutputCache(options =>
{
    options.AddPolicy("Custom", CustomCachePolicy.Instance);
});
```

## Distributed Cache with Redis

For scaled deployments, use Redis as the cache store:

```csharp
builder.Services.AddStackExchangeRedisOutputCache(options =>
{
    options.Configuration = builder.Configuration["Redis:ConnectionString"];
    options.InstanceName = "MyApp:";
});

builder.Services.AddOutputCache(options =>
{
    options.AddBasePolicy(builder => builder
        .Expire(TimeSpan.FromMinutes(5)));
});
```

## Complete Example with Minimal APIs

```csharp
using Microsoft.AspNetCore.OutputCaching;

var builder = WebApplication.CreateBuilder(args);

// Configure output caching
builder.Services.AddOutputCache(options =>
{
    // Default policy for all cached endpoints
    options.AddBasePolicy(policy => policy.Expire(TimeSpan.FromMinutes(5)));

    // Specific policies
    options.AddPolicy("ProductList", policy => policy
        .Expire(TimeSpan.FromMinutes(10))
        .Tag("products")
        .SetVaryByQuery("page", "pageSize", "category"));

    options.AddPolicy("ProductDetail", policy => policy
        .Expire(TimeSpan.FromMinutes(30))
        .Tag("products")
        .SetVaryByRouteValue("id"));

    options.AddPolicy("SearchResults", policy => policy
        .Expire(TimeSpan.FromMinutes(2))
        .Tag("search")
        .SetVaryByQuery("q", "page"));

    options.AddPolicy("NoCache", policy => policy.NoCache());
});

builder.Services.AddSingleton<IProductService, ProductService>();

var app = builder.Build();

app.UseOutputCache();

// Cached endpoints
var api = app.MapGroup("/api");

api.MapGet("/products", async (
    int page,
    int pageSize,
    string? category,
    IProductService service) =>
{
    var products = await service.GetProductsAsync(page, pageSize, category);
    return Results.Ok(products);
}).CacheOutput("ProductList");

api.MapGet("/products/{id}", async (int id, IProductService service) =>
{
    var product = await service.GetProductAsync(id);
    return product is not null ? Results.Ok(product) : Results.NotFound();
}).CacheOutput("ProductDetail");

api.MapGet("/search", async (string q, int page, IProductService service) =>
{
    var results = await service.SearchAsync(q, page);
    return Results.Ok(results);
}).CacheOutput("SearchResults");

// Non-cached endpoints
api.MapPost("/products", async (
    Product product,
    IProductService service,
    IOutputCacheStore cache) =>
{
    await service.CreateProductAsync(product);
    await cache.EvictByTagAsync("products", default);
    return Results.Created($"/api/products/{product.Id}", product);
});

api.MapPut("/products/{id}", async (
    int id,
    Product product,
    IProductService service,
    IOutputCacheStore cache) =>
{
    await service.UpdateProductAsync(id, product);
    await cache.EvictByTagAsync("products", default);
    return Results.NoContent();
});

api.MapDelete("/products/{id}", async (
    int id,
    IProductService service,
    IOutputCacheStore cache) =>
{
    await service.DeleteProductAsync(id);
    await cache.EvictByTagAsync("products", default);
    return Results.NoContent();
});

// Health check without caching
api.MapGet("/health", () => Results.Ok(new { Status = "Healthy" }))
    .CacheOutput("NoCache");

app.Run();

// Models and service
public record Product(int Id, string Name, decimal Price, string Category);

public interface IProductService
{
    Task<IEnumerable<Product>> GetProductsAsync(int page, int pageSize, string? category);
    Task<Product?> GetProductAsync(int id);
    Task<IEnumerable<Product>> SearchAsync(string query, int page);
    Task CreateProductAsync(Product product);
    Task UpdateProductAsync(int id, Product product);
    Task DeleteProductAsync(int id);
}
```

## Performance Comparison

Output caching can dramatically improve response times:

| Scenario | Without Cache | With Cache |
|----------|--------------|------------|
| Database query | 50-200ms | 1-5ms |
| Complex computation | 100-500ms | 1-5ms |
| External API call | 200-1000ms | 1-5ms |

## Best Practices

1. **Use tags liberally**: Makes invalidation much easier
2. **Set appropriate expiration**: Balance freshness vs. performance
3. **Vary carefully**: Too many variations reduce cache hit rate
4. **Monitor hit rates**: Use metrics to optimize cache policies
5. **Don't cache sensitive data**: Be careful with authenticated endpoints

## Conclusion

Output caching in ASP.NET Core 7 is a powerful, flexible solution for improving API performance. With support for policies, tags, and distributed caching, it covers most production scenarios out of the box. Combined with the new rate limiting middleware, you have comprehensive tools for building high-performance, resilient APIs.

## Resources

- [Output Caching Middleware](https://learn.microsoft.com/en-us/aspnet/core/performance/caching/output)
- [Distributed Caching](https://learn.microsoft.com/en-us/aspnet/core/performance/caching/distributed)
- [Response Caching](https://learn.microsoft.com/en-us/aspnet/core/performance/caching/response)

