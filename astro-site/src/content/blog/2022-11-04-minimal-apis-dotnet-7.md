---
title: "Minimal APIs in .NET 7: Filters, Route Groups, and Typed Results"
author: Michael John Peña
draft: false
date: 2022-11-04
tags:
  - .NET
  - ASP.NET Core
  - Web API
  - Azure

---

I wrote "Minimal APIs in .NET 7: Filters, Route Groups, and Typed Results" to share practical, production-minded guidance on this topic.

## Endpoint Filters

The biggest addition - filters provide middleware-like functionality for individual endpoints:

```csharp
var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();

app.MapGet("/items/{id}", async (int id, IItemService service) =>
    await service.GetItemAsync(id))
    .AddEndpointFilter(async (context, next) =>
    {
        var id = context.GetArgument<int>(0);

        if (id <= 0)
        {
            return Results.BadRequest(new { error = "ID must be positive" });
        }

        return await next(context);
    });

app.Run();
```

You can create reusable filter classes:

```csharp
public class ValidationFilter<T> : IEndpointFilter where T : class
{
    public async ValueTask<object?> InvokeAsync(
        EndpointFilterInvocationContext context,
        EndpointFilterDelegate next)
    {
        var argument = context.Arguments.OfType<T>().FirstOrDefault();

        if (argument is null)
        {
            return Results.BadRequest(new { error = "Request body is required" });
        }

        var validationResults = new List<ValidationResult>();
        var validationContext = new ValidationContext(argument);

        if (!Validator.TryValidateObject(argument, validationContext, validationResults, true))
        {
            return Results.ValidationProblem(
                validationResults.ToDictionary(
                    r => r.MemberNames.First(),
                    r => new[] { r.ErrorMessage ?? "Validation failed" }));
        }

        return await next(context);
    }
}

// Usage
app.MapPost("/orders", async (Order order, IOrderService service) =>
    await service.CreateOrderAsync(order))
    .AddEndpointFilter<ValidationFilter<Order>>();
```

## Route Groups

Organize related endpoints with shared configuration:

```csharp
var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();

// Create a route group for API v1
var v1 = app.MapGroup("/api/v1");

// Products group
var products = v1.MapGroup("/products")
    .AddEndpointFilter<ApiKeyValidationFilter>();

products.MapGet("/", GetAllProducts);
products.MapGet("/{id}", GetProductById);
products.MapPost("/", CreateProduct);
products.MapPut("/{id}", UpdateProduct);
products.MapDelete("/{id}", DeleteProduct);

// Orders group with different authentication
var orders = v1.MapGroup("/orders")
    .RequireAuthorization("AdminPolicy");

orders.MapGet("/", GetAllOrders);
orders.MapGet("/{id}", GetOrderById);
orders.MapPost("/", CreateOrder);

app.Run();

// Handler methods
static async Task<IResult> GetAllProducts(IProductService service)
{
    var products = await service.GetAllAsync();
    return Results.Ok(products);
}

static async Task<IResult> GetProductById(int id, IProductService service)
{
    var product = await service.GetByIdAsync(id);
    return product is not null
        ? Results.Ok(product)
        : Results.NotFound();
}
```

## Typed Results

Better IntelliSense and compile-time checking with typed results:

```csharp
using Microsoft.AspNetCore.Http.HttpResults;

var app = WebApplication.Create();

// Explicit return types for OpenAPI documentation
app.MapGet("/products/{id}", GetProduct);

static async Task<Results<Ok<Product>, NotFound>> GetProduct(
    int id,
    IProductService service)
{
    var product = await service.GetByIdAsync(id);

    return product is not null
        ? TypedResults.Ok(product)
        : TypedResults.NotFound();
}

// Multiple possible results
app.MapPost("/products", CreateProduct);

static async Task<Results<Created<Product>, ValidationProblem, Conflict>> CreateProduct(
    Product product,
    IProductService service)
{
    var validationErrors = Validate(product);
    if (validationErrors.Any())
    {
        return TypedResults.ValidationProblem(validationErrors);
    }

    if (await service.ExistsAsync(product.Id))
    {
        return TypedResults.Conflict();
    }

    var created = await service.CreateAsync(product);
    return TypedResults.Created($"/products/{created.Id}", created);
}
```

## Full API Example

Here's a complete CRUD API using .NET 7 Minimal APIs:

```csharp
using Microsoft.AspNetCore.Http.HttpResults;

var builder = WebApplication.CreateBuilder(args);

// Services
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();
builder.Services.AddSingleton<IProductRepository, InMemoryProductRepository>();

var app = builder.Build();

// Swagger
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

// API Routes
var api = app.MapGroup("/api/products")
    .WithTags("Products")
    .WithOpenApi();

api.MapGet("/", GetAllProducts)
    .WithName("GetAllProducts")
    .WithSummary("Get all products");

api.MapGet("/{id}", GetProductById)
    .WithName("GetProductById")
    .WithSummary("Get a product by ID");

api.MapPost("/", CreateProduct)
    .WithName("CreateProduct")
    .WithSummary("Create a new product")
    .AddEndpointFilter<ValidationFilter<CreateProductRequest>>();

api.MapPut("/{id}", UpdateProduct)
    .WithName("UpdateProduct")
    .WithSummary("Update an existing product");

api.MapDelete("/{id}", DeleteProduct)
    .WithName("DeleteProduct")
    .WithSummary("Delete a product");

app.Run();

// Handlers
static async Task<Ok<IEnumerable<Product>>> GetAllProducts(
    IProductRepository repo,
    CancellationToken ct)
{
    var products = await repo.GetAllAsync(ct);
    return TypedResults.Ok(products);
}

static async Task<Results<Ok<Product>, NotFound>> GetProductById(
    int id,
    IProductRepository repo,
    CancellationToken ct)
{
    var product = await repo.GetByIdAsync(id, ct);
    return product is not null
        ? TypedResults.Ok(product)
        : TypedResults.NotFound();
}

static async Task<Results<Created<Product>, Conflict<ProblemDetails>>> CreateProduct(
    CreateProductRequest request,
    IProductRepository repo,
    CancellationToken ct)
{
    if (await repo.ExistsByNameAsync(request.Name, ct))
    {
        return TypedResults.Conflict(new ProblemDetails
        {
            Title = "Product already exists",
            Detail = $"A product with name '{request.Name}' already exists"
        });
    }

    var product = new Product(0, request.Name, request.Price, request.Category);
    var created = await repo.CreateAsync(product, ct);

    return TypedResults.Created($"/api/products/{created.Id}", created);
}

static async Task<Results<Ok<Product>, NotFound>> UpdateProduct(
    int id,
    UpdateProductRequest request,
    IProductRepository repo,
    CancellationToken ct)
{
    var existing = await repo.GetByIdAsync(id, ct);
    if (existing is null)
    {
        return TypedResults.NotFound();
    }

    var updated = existing with
    {
        Name = request.Name ?? existing.Name,
        Price = request.Price ?? existing.Price,
        Category = request.Category ?? existing.Category
    };

    await repo.UpdateAsync(updated, ct);
    return TypedResults.Ok(updated);
}

static async Task<Results<NoContent, NotFound>> DeleteProduct(
    int id,
    IProductRepository repo,
    CancellationToken ct)
{
    if (!await repo.ExistsAsync(id, ct))
    {
        return TypedResults.NotFound();
    }

    await repo.DeleteAsync(id, ct);
    return TypedResults.NoContent();
}

// Models
public record Product(int Id, string Name, decimal Price, string Category);
public record CreateProductRequest(string Name, decimal Price, string Category);
public record UpdateProductRequest(string? Name, decimal? Price, string? Category);

// Repository
public interface IProductRepository
{
    Task<IEnumerable<Product>> GetAllAsync(CancellationToken ct);
    Task<Product?> GetByIdAsync(int id, CancellationToken ct);
    Task<bool> ExistsAsync(int id, CancellationToken ct);
    Task<bool> ExistsByNameAsync(string name, CancellationToken ct);
    Task<Product> CreateAsync(Product product, CancellationToken ct);
    Task UpdateAsync(Product product, CancellationToken ct);
    Task DeleteAsync(int id, CancellationToken ct);
}
```

## Rate Limiting Integration

```csharp
using System.Threading.RateLimiting;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddRateLimiter(options =>
{
    options.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(context =>
        RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: context.User?.Identity?.Name ?? context.Request.Headers.Host.ToString(),
            factory: _ => new FixedWindowRateLimiterOptions
            {
                AutoReplenishment = true,
                PermitLimit = 100,
                Window = TimeSpan.FromMinutes(1)
            }));

    options.AddPolicy("api", context =>
        RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: context.User?.Identity?.Name ?? "anonymous",
            factory: _ => new FixedWindowRateLimiterOptions
            {
                AutoReplenishment = true,
                PermitLimit = 10,
                Window = TimeSpan.FromSeconds(10)
            }));
});

var app = builder.Build();

app.UseRateLimiter();

// Apply rate limiting to specific endpoints
app.MapGet("/api/data", () => "Hello!")
    .RequireRateLimiting("api");

app.Run();
```

## Deploying to Azure Container Apps

```dockerfile
FROM mcr.microsoft.com/dotnet/sdk:7.0 AS build
WORKDIR /src
COPY ["MyApi.csproj", "./"]
RUN dotnet restore
COPY . .
RUN dotnet publish -c Release -o /app/publish

FROM mcr.microsoft.com/dotnet/aspnet:7.0 AS runtime
WORKDIR /app
COPY --from=build /app/publish .
EXPOSE 8080
ENV ASPNETCORE_URLS=http://+:8080
ENTRYPOINT ["dotnet", "MyApi.dll"]
```

```bash
# Deploy to Azure Container Apps
az containerapp create \
    --name my-minimal-api \
    --resource-group my-rg \
    --environment my-env \
    --image myregistry.azurecr.io/my-minimal-api:latest \
    --target-port 8080 \
    --ingress external
```

## Conclusion

.NET 7 Minimal APIs are now a first-class option for building production APIs. With endpoint filters, route groups, and typed results, you get the simplicity of minimal APIs with the power of full MVC. For new API projects, especially microservices or Azure Functions, Minimal APIs should be your default choice.

## Resources

- [Minimal APIs Overview](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis/overview)
- [Filters in Minimal APIs](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis/min-api-filters)
- [Route Groups](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis/route-handlers#route-groups)

