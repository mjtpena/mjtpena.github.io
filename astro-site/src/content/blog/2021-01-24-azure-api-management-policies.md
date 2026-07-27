---
title: Advanced Azure API Management Policies
author: Michael John Pena
draft: false
date: 2021-01-24
url: /blog/azure-api-management-policies/
tags:
  - Azure
  - API Management
  - Policies
  - Security
  - Integration
---

I revisit APIM policies on this blog roughly every six months because the patterns are how the service earns its keep. Rate limiting per subscription, JWT validation that doesn't trust the client, response caching for idempotent reads, and the request/response transforms that let you hide a creaky backend behind a clean public API. Today I'm getting into the advanced patterns I keep reusing—policy fragments, named values backed by Key Vault, and the diagnostic traces that turn "the policy isn't firing" into a five-minute debug.

## Understanding Policy Scopes

Policies can be applied at four scopes:
- **Global**: Applies to all APIs
- **Product**: Applies to APIs in a product
- **API**: Applies to all operations in an API
- **Operation**: Applies to a specific operation

```xml
<policies>
    <inbound>
        <!-- Policies applied before the request reaches the backend -->
    </inbound>
    <backend>
        <!-- Policies applied when forwarding to backend -->
    </backend>
    <outbound>
        <!-- Policies applied to the response -->
    </outbound>
    <on-error>
        <!-- Policies applied when an error occurs -->
    </on-error>
</policies>
```

## Authentication and Authorization

### JWT Validation with Claims

```xml
<policies>
    <inbound>
        <validate-jwt header-name="Authorization"
                      failed-validation-httpcode="401"
                      failed-validation-error-message="Unauthorized">
            <openid-config url="https://login.microsoftonline.com/{tenant}/.well-known/openid-configuration" />
            <audiences>
                <audience>api://my-api</audience>
            </audiences>
            <issuers>
                <issuer>https://sts.windows.net/{tenant}/</issuer>
            </issuers>
            <required-claims>
                <claim name="roles" match="any">
                    <value>API.ReadWrite</value>
                    <value>API.Admin</value>
                </claim>
            </required-claims>
        </validate-jwt>

        <!-- Extract claims for downstream use -->
        <set-variable name="userId" value="@(context.Request.Headers.GetValueOrDefault("Authorization","").AsJwt()?.Claims.GetValueOrDefault("oid", ""))" />
        <set-variable name="userRoles" value="@(context.Request.Headers.GetValueOrDefault("Authorization","").AsJwt()?.Claims.GetValueOrDefault("roles", ""))" />

        <!-- Pass user context to backend -->
        <set-header name="X-User-Id" exists-action="override">
            <value>@((string)context.Variables["userId"])</value>
        </set-header>
    </inbound>
</policies>
```

### API Key with Subscription Tiers

```xml
<policies>
    <inbound>
        <!-- Validate subscription key -->
        <check-header name="Ocp-Apim-Subscription-Key"
                      failed-check-httpcode="401"
                      failed-check-error-message="API key required" />

        <!-- Get subscription tier from product -->
        <set-variable name="subscriptionTier"
                      value="@(context.Subscription.ProductName)" />

        <!-- Apply rate limits based on tier -->
        <choose>
            <when condition="@(context.Variables.GetValueOrDefault<string>("subscriptionTier") == "Free")">
                <rate-limit calls="100" renewal-period="3600" />
                <quota calls="1000" renewal-period="86400" />
            </when>
            <when condition="@(context.Variables.GetValueOrDefault<string>("subscriptionTier") == "Standard")">
                <rate-limit calls="1000" renewal-period="3600" />
                <quota calls="50000" renewal-period="86400" />
            </when>
            <when condition="@(context.Variables.GetValueOrDefault<string>("subscriptionTier") == "Premium")">
                <rate-limit calls="10000" renewal-period="3600" />
                <!-- No daily quota for premium -->
            </when>
        </choose>
    </inbound>
</policies>
```

## Request/Response Transformation

### GraphQL to REST Translation

```xml
<policies>
    <inbound>
        <!-- Transform GraphQL query to REST call -->
        <set-variable name="graphqlQuery" value="@(context.Request.Body.As<JObject>()["query"].ToString())" />

        <choose>
            <when condition="@(((string)context.Variables["graphqlQuery"]).Contains("getUser"))">
                <!-- Extract user ID from GraphQL variables -->
                <set-variable name="userId"
                              value="@(context.Request.Body.As<JObject>()["variables"]["id"].ToString())" />

                <!-- Rewrite to REST endpoint -->
                <rewrite-uri template="@("/api/users/" + context.Variables["userId"])" />
                <set-method>GET</set-method>
                <set-body>@("")</set-body>
            </when>
            <when condition="@(((string)context.Variables["graphqlQuery"]).Contains("listOrders"))">
                <rewrite-uri template="/api/orders" />
                <set-method>GET</set-method>
            </when>
        </choose>
    </inbound>

    <outbound>
        <!-- Wrap REST response in GraphQL format -->
        <set-body>@{
            var response = context.Response.Body.As<JObject>();
            return new JObject(
                new JProperty("data", response),
                new JProperty("errors", null)
            ).ToString();
        }</set-body>
    </outbound>
</policies>
```

### Response Filtering Based on User Role

```xml
<policies>
    <outbound>
        <choose>
            <when condition="@(!context.Variables.GetValueOrDefault<string>("userRoles", "").Contains("Admin"))">
                <!-- Filter sensitive fields for non-admin users -->
                <set-body>@{
                    var response = context.Response.Body.As<JObject>();

                    // Remove sensitive fields
                    var sensitiveFields = new[] { "ssn", "salary", "internalNotes", "costPrice" };

                    void RemoveSensitiveFields(JToken token)
                    {
                        if (token is JObject obj)
                        {
                            foreach (var field in sensitiveFields)
                            {
                                obj.Remove(field);
                            }
                            foreach (var child in obj.Children())
                            {
                                RemoveSensitiveFields(child);
                            }
                        }
                        else if (token is JArray arr)
                        {
                            foreach (var item in arr)
                            {
                                RemoveSensitiveFields(item);
                            }
                        }
                    }

                    RemoveSensitiveFields(response);
                    return response.ToString();
                }</set-body>
            </when>
        </choose>
    </outbound>
</policies>
```

## Caching Strategies

### Conditional Caching

```xml
<policies>
    <inbound>
        <!-- Only cache GET requests for authenticated users -->
        <choose>
            <when condition="@(context.Request.Method == "GET" && context.Variables.ContainsKey("userId"))">
                <cache-lookup vary-by-developer="false"
                              vary-by-developer-groups="false"
                              downstream-caching-type="none">
                    <vary-by-header>Accept</vary-by-header>
                    <vary-by-query-parameter>page</vary-by-query-parameter>
                    <vary-by-query-parameter>pageSize</vary-by-query-parameter>
                </cache-lookup>
            </when>
        </choose>
    </inbound>

    <outbound>
        <choose>
            <when condition="@(context.Request.Method == "GET" && context.Response.StatusCode == 200)">
                <!-- Cache successful GET responses for 5 minutes -->
                <cache-store duration="300" />
            </when>
        </choose>
    </outbound>
</policies>
```

### External Redis Cache

```xml
<policies>
    <inbound>
        <cache-lookup-value key="@("order-" + context.Request.MatchedParameters["orderId"])"
                            variable-name="cachedOrder"
                            caching-type="external" />

        <choose>
            <when condition="@(context.Variables.ContainsKey("cachedOrder"))">
                <!-- Return cached response immediately -->
                <return-response>
                    <set-status code="200" reason="OK" />
                    <set-header name="X-Cache" exists-action="override">
                        <value>HIT</value>
                    </set-header>
                    <set-body>@((string)context.Variables["cachedOrder"])</set-body>
                </return-response>
            </when>
        </choose>
    </inbound>

    <outbound>
        <choose>
            <when condition="@(context.Response.StatusCode == 200)">
                <cache-store-value key="@("order-" + context.Request.MatchedParameters["orderId"])"
                                   value="@(context.Response.Body.As<string>(preserveContent: true))"
                                   duration="600"
                                   caching-type="external" />
                <set-header name="X-Cache" exists-action="override">
                    <value>MISS</value>
                </set-header>
            </when>
        </choose>
    </outbound>
</policies>
```

## Backend Integration Patterns

### Circuit Breaker with Retry

```xml
<policies>
    <backend>
        <retry condition="@(context.Response.StatusCode >= 500)"
               count="3"
               interval="1"
               max-interval="10"
               delta="2"
               first-fast-retry="true">
            <forward-request buffer-request-body="true" timeout="30" />
        </retry>
    </backend>

    <on-error>
        <choose>
            <!-- Circuit breaker: if backend fails repeatedly, return cached response -->
            <when condition="@(context.LastError.Reason == "Timeout" || context.Response.StatusCode >= 500)">
                <cache-lookup-value key="@("fallback-" + context.Request.Url.Path)"
                                    variable-name="fallbackResponse" />

                <choose>
                    <when condition="@(context.Variables.ContainsKey("fallbackResponse"))">
                        <return-response>
                            <set-status code="200" reason="OK (Cached)" />
                            <set-header name="X-Fallback" exists-action="override">
                                <value>true</value>
                            </set-header>
                            <set-body>@((string)context.Variables["fallbackResponse"])</set-body>
                        </return-response>
                    </when>
                    <otherwise>
                        <return-response>
                            <set-status code="503" reason="Service Temporarily Unavailable" />
                            <set-body>@{
                                return new JObject(
                                    new JProperty("error", "Service temporarily unavailable"),
                                    new JProperty("retryAfter", 30)
                                ).ToString();
                            }</set-body>
                        </return-response>
                    </otherwise>
                </choose>
            </when>
        </choose>
    </on-error>
</policies>
```

### Request Aggregation

```xml
<policies>
    <inbound>
        <base />
    </inbound>

    <backend>
        <!-- Make parallel calls to multiple backends -->
        <send-request mode="new" response-variable-name="userResponse" timeout="10" ignore-error="true">
            <set-url>@("https://users-api.internal/api/users/" + context.Request.MatchedParameters["userId"])</set-url>
            <set-method>GET</set-method>
        </send-request>

        <send-request mode="new" response-variable-name="ordersResponse" timeout="10" ignore-error="true">
            <set-url>@("https://orders-api.internal/api/users/" + context.Request.MatchedParameters["userId"] + "/orders")</set-url>
            <set-method>GET</set-method>
        </send-request>

        <send-request mode="new" response-variable-name="preferencesResponse" timeout="10" ignore-error="true">
            <set-url>@("https://preferences-api.internal/api/users/" + context.Request.MatchedParameters["userId"] + "/preferences")</set-url>
            <set-method>GET</set-method>
        </send-request>
    </backend>

    <outbound>
        <!-- Aggregate responses -->
        <set-body>@{
            var user = ((IResponse)context.Variables["userResponse"]).Body.As<JObject>();
            var orders = ((IResponse)context.Variables["ordersResponse"]).Body.As<JArray>();
            var prefs = ((IResponse)context.Variables["preferencesResponse"]).Body.As<JObject>();

            return new JObject(
                new JProperty("user", user),
                new JProperty("recentOrders", orders),
                new JProperty("preferences", prefs)
            ).ToString();
        }</set-body>
    </outbound>
</policies>
```

## Logging and Monitoring

### Structured Logging to Event Hub

```xml
<policies>
    <inbound>
        <set-variable name="requestId" value="@(Guid.NewGuid().ToString())" />
        <set-variable name="requestTime" value="@(DateTime.UtcNow)" />
    </inbound>

    <outbound>
        <log-to-eventhub logger-id="api-logger">@{
            var requestTime = (DateTime)context.Variables["requestTime"];
            var duration = (DateTime.UtcNow - requestTime).TotalMilliseconds;

            return new JObject(
                new JProperty("timestamp", DateTime.UtcNow.ToString("o")),
                new JProperty("requestId", context.Variables["requestId"]),
                new JProperty("api", context.Api.Name),
                new JProperty("operation", context.Operation.Name),
                new JProperty("method", context.Request.Method),
                new JProperty("url", context.Request.Url.ToString()),
                new JProperty("statusCode", context.Response.StatusCode),
                new JProperty("durationMs", duration),
                new JProperty("subscriptionId", context.Subscription?.Id ?? "anonymous"),
                new JProperty("clientIp", context.Request.IpAddress),
                new JProperty("userAgent", context.Request.Headers.GetValueOrDefault("User-Agent", ""))
            ).ToString();
        }</log-to-eventhub>
    </outbound>
</policies>
```

## Best Practices

1. **Use Policy Fragments**: Extract reusable policies into fragments
2. **Test Incrementally**: Use the APIM test console during development
3. **Monitor Performance**: Policy execution adds latency; measure impact
4. **Handle Errors**: Always implement on-error policies
5. **Version Policies**: Store policies in source control
6. **Use Named Values**: Externalize configuration for different environments

Azure API Management policies provide a powerful declarative way to implement cross-cutting concerns. Mastering policies enables you to build robust, secure, and performant API gateways without modifying backend services.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
