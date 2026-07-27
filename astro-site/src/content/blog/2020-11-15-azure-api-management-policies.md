---
title: "Azure API Management: Policy Deep Dive"
author: Michael John Peña
draft: false
date: 2020-11-15
tags:
  - Azure
  - API Management
  - APIs
  - Security
---

API Management is one of those services I underestimated for years. "It's a proxy, right?" The penny drops when you realise policies are the product. Rate limiting, caching, JWT validation, request/response transformation, mock responses—all configured in XML against the gateway, no backend changes required. I've used policies to ship a "new" API in front of a creaking SOAP service while we rewrote it underneath.

## Policy Structure

```xml
<policies>
    <inbound>
        <!-- Applied before request goes to backend -->
    </inbound>
    <backend>
        <!-- Applied when forwarding to backend -->
    </backend>
    <outbound>
        <!-- Applied to response from backend -->
    </outbound>
    <on-error>
        <!-- Applied when errors occur -->
    </on-error>
</policies>
```

## Authentication Policies

### Validate JWT

```xml
<inbound>
    <validate-jwt header-name="Authorization" failed-validation-httpcode="401">
        <openid-config url="https://login.microsoftonline.com/{tenant}/.well-known/openid-configuration" />
        <audiences>
            <audience>api://my-api</audience>
        </audiences>
        <issuers>
            <issuer>https://sts.windows.net/{tenant}/</issuer>
        </issuers>
        <required-claims>
            <claim name="roles" match="any">
                <value>Admin</value>
                <value>Reader</value>
            </claim>
        </required-claims>
    </validate-jwt>
</inbound>
```

### API Key

```xml
<inbound>
    <check-header name="X-API-Key" failed-check-httpcode="401" failed-check-error-message="Invalid API key">
        <value>secret-key-1</value>
        <value>secret-key-2</value>
    </check-header>
</inbound>
```

## Rate Limiting

```xml
<inbound>
    <!-- Rate limit by subscription key -->
    <rate-limit calls="100" renewal-period="60" />

    <!-- Rate limit by IP -->
    <rate-limit-by-key calls="10" renewal-period="60"
        counter-key="@(context.Request.IpAddress)" />

    <!-- Quota (monthly limits) -->
    <quota calls="10000" bandwidth="40000" renewal-period="2592000" />
</inbound>
```

## Caching

```xml
<inbound>
    <!-- Cache lookup -->
    <cache-lookup vary-by-developer="false" vary-by-developer-groups="false">
        <vary-by-header>Accept</vary-by-header>
        <vary-by-query-parameter>version</vary-by-query-parameter>
    </cache-lookup>
</inbound>

<outbound>
    <!-- Cache store -->
    <cache-store duration="3600" />
</outbound>
```

## Request Transformation

```xml
<inbound>
    <!-- Set headers -->
    <set-header name="X-Request-ID" exists-action="override">
        <value>@(Guid.NewGuid().ToString())</value>
    </set-header>

    <!-- Set query parameters -->
    <set-query-parameter name="api-version" exists-action="override">
        <value>2020-11-01</value>
    </set-query-parameter>

    <!-- Rewrite URL -->
    <rewrite-uri template="/api/v2/{path}" copy-unmatched-params="true" />

    <!-- Set body -->
    <set-body>@{
        var body = context.Request.Body.As<JObject>();
        body["timestamp"] = DateTime.UtcNow.ToString("o");
        return body.ToString();
    }</set-body>
</inbound>
```

## Response Transformation

```xml
<outbound>
    <!-- Remove headers -->
    <set-header name="X-Powered-By" exists-action="delete" />

    <!-- Transform JSON response -->
    <set-body>@{
        var response = context.Response.Body.As<JObject>();
        return new JObject(
            new JProperty("data", response),
            new JProperty("meta", new JObject(
                new JProperty("requestId", context.RequestId),
                new JProperty("timestamp", DateTime.UtcNow)
            ))
        ).ToString();
    }</set-body>

    <!-- XML to JSON -->
    <xml-to-json kind="javascript-friendly" apply="always" />
</outbound>
```

## Conditional Logic

```xml
<inbound>
    <choose>
        <when condition="@(context.Request.Headers.GetValueOrDefault("X-Premium", "false") == "true")">
            <rate-limit calls="1000" renewal-period="60" />
        </when>
        <otherwise>
            <rate-limit calls="100" renewal-period="60" />
        </otherwise>
    </choose>
</inbound>
```

## Error Handling

```xml
<on-error>
    <set-header name="Content-Type" exists-action="override">
        <value>application/json</value>
    </set-header>
    <set-body>@{
        return new JObject(
            new JProperty("error", new JObject(
                new JProperty("code", context.Response.StatusCode),
                new JProperty("message", context.LastError.Message),
                new JProperty("requestId", context.RequestId)
            ))
        ).ToString();
    }</set-body>
</on-error>
```

## Send Request (Backend Composition)

```xml
<inbound>
    <send-request mode="new" response-variable-name="userInfo" timeout="10">
        <set-url>@($"https://users-api/users/{context.Request.MatchedParameters["userId"]}")</set-url>
        <set-method>GET</set-method>
    </send-request>

    <set-header name="X-User-Name">
        <value>@(((IResponse)context.Variables["userInfo"]).Body.As<JObject>()["name"].ToString())</value>
    </set-header>
</inbound>
```

Policies make API Management a powerful gateway.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
