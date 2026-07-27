---
title: "API Design Patterns That Stood the Test of Time in 2025"
author: Michael John Peña
draft: false
date: 2025-12-29
tags:
  - API-Design
  - REST
  - Best-Practices
  - Architecture
  - "2025"

---

I wrote "API Design Patterns That Stood the Test of Time in 2025" to share practical, production-minded guidance on this topic.

## 1. Resource-Based URLs with Proper Nesting

```
# Good - Clear resource hierarchy
GET /customers/{customerId}/orders
GET /customers/{customerId}/orders/{orderId}
POST /customers/{customerId}/orders

# Bad - Action-based URLs
GET /getCustomerOrders?customerId=123
POST /createOrder
```

## 2. Consistent Error Responses

```csharp
public class ApiErrorResponse
{
    public string Type { get; init; }      // Error category URI
    public string Title { get; init; }     // Human-readable summary
    public int Status { get; init; }       // HTTP status code
    public string Detail { get; init; }    // Specific error description
    public string Instance { get; init; }  // Request identifier
    public Dictionary<string, string[]> Errors { get; init; }  // Validation errors
}

// Example response
{
    "type": "https://api.example.com/errors/validation",
    "title": "Validation Failed",
    "status": 400,
    "detail": "One or more fields failed validation",
    "instance": "/orders/123",
    "errors": {
        "email": ["Invalid email format"],
        "quantity": ["Must be greater than 0"]
    }
}
```

## 3. Pagination with Cursor-Based Approach

```csharp
public class PagedResponse<T>
{
    public List<T> Data { get; init; }
    public string NextCursor { get; init; }
    public string PreviousCursor { get; init; }
    public int TotalCount { get; init; }
    public bool HasMore { get; init; }
}

// Implementation
[HttpGet("orders")]
public async Task<PagedResponse<Order>> GetOrders(
    [FromQuery] string cursor = null,
    [FromQuery] int pageSize = 20)
{
    var decodedCursor = cursor != null
        ? DecodeCursor(cursor)
        : new Cursor { LastId = Guid.Empty, LastDate = DateTime.MaxValue };

    var orders = await _db.Orders
        .Where(o => o.CreatedAt < decodedCursor.LastDate
                 || (o.CreatedAt == decodedCursor.LastDate && o.Id < decodedCursor.LastId))
        .OrderByDescending(o => o.CreatedAt)
        .ThenByDescending(o => o.Id)
        .Take(pageSize + 1)
        .ToListAsync();

    var hasMore = orders.Count > pageSize;
    var resultOrders = orders.Take(pageSize).ToList();

    return new PagedResponse<Order>
    {
        Data = resultOrders,
        HasMore = hasMore,
        NextCursor = hasMore ? EncodeCursor(resultOrders.Last()) : null
    };
}
```

## 4. Versioning via URL Path

```csharp
// Clearest approach for consumers
[ApiController]
[Route("api/v1/[controller]")]
public class OrdersV1Controller : ControllerBase { }

[ApiController]
[Route("api/v2/[controller]")]
public class OrdersV2Controller : ControllerBase { }
```

## 5. HATEOAS for Discoverability

```json
{
    "id": "order-123",
    "status": "pending",
    "total": 99.99,
    "_links": {
        "self": { "href": "/api/v1/orders/order-123" },
        "cancel": { "href": "/api/v1/orders/order-123/cancel", "method": "POST" },
        "customer": { "href": "/api/v1/customers/cust-456" },
        "items": { "href": "/api/v1/orders/order-123/items" }
    }
}
```

## 6. Idempotency Keys for Safe Retries

```csharp
[HttpPost("payments")]
public async Task<IActionResult> CreatePayment(
    [FromHeader(Name = "Idempotency-Key")] string idempotencyKey,
    [FromBody] PaymentRequest request)
{
    // Check if we've seen this key before
    var existingResult = await _cache.GetAsync($"idempotency:{idempotencyKey}");
    if (existingResult != null)
    {
        return Ok(existingResult);
    }

    var payment = await _paymentService.ProcessAsync(request);

    // Store result with TTL
    await _cache.SetAsync($"idempotency:{idempotencyKey}", payment, TimeSpan.FromHours(24));

    return CreatedAtAction(nameof(GetPayment), new { id = payment.Id }, payment);
}
```

## 7. Rate Limiting with Clear Headers

```
HTTP/1.1 200 OK
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 999
X-RateLimit-Reset: 1703894400
```

## Key Principles

- **Predictability** - Consistent patterns across all endpoints
- **Self-documentation** - Clear naming, standard responses
- **Backward compatibility** - Version and deprecate carefully
- **Performance transparency** - Pagination, rate limits visible

Good API design is timeless. These patterns work because they prioritize developer experience and operational reliability.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
