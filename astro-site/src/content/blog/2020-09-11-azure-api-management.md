---
title: "Azure API Management: API Gateway Patterns"
description: "Three years ago a client asked me to \"put a gateway in front of my APIs.\" It turned into a six-month conversation about rate limiting, OAuth, partner…"
author: Michael John Peña
draft: false
date: 2020-09-11
tags:
  - Azure
  - API Management
  - APIs
  - Security
---

Three years ago a client asked me to "put a gateway in front of my APIs." It turned into a six-month conversation about rate limiting, OAuth, partner onboarding, versioning, and analytics. APIM is the answer to all of those at once — not just a reverse proxy, but the layer where you put policies, transformations, products, and a developer portal. It's also the layer that's hard to retrofit later, which is why I push clients to set it up early, even when they think they only need URL routing.

## Core Capabilities

1. **Request/Response Transformation**
2. **Authentication & Authorization**
3. **Rate Limiting & Throttling**
4. **Caching**
5. **Analytics & Monitoring**

## Policy Examples

### Rate Limiting

```xml
<policies>
  <inbound>
    <rate-limit-by-key
      calls="100"
      renewal-period="60"
      counter-key="@(context.Subscription.Id)"
      increment-condition="@(context.Response.StatusCode >= 200 && context.Response.StatusCode < 300)" />
  </inbound>
</policies>
```

### JWT Validation

```xml
<validate-jwt header-name="Authorization" failed-validation-httpcode="401">
  <openid-config url="https://login.microsoftonline.com/{tenant}/.well-known/openid-configuration" />
  <required-claims>
    <claim name="aud" match="any">
      <value>{app-id}</value>
    </claim>
  </required-claims>
</validate-jwt>
```

### Response Caching

```xml
<cache-lookup vary-by-developer="false" vary-by-developer-groups="false">
  <vary-by-header>Accept</vary-by-header>
  <vary-by-query-parameter>version</vary-by-query-parameter>
</cache-lookup>
<!-- outbound -->
<cache-store duration="3600" />
```

### Backend Circuit Breaker

```xml
<retry condition="@(context.Response.StatusCode == 503)" count="3" interval="10">
  <forward-request />
</retry>
```

## Developer Portal

APIM includes a customizable developer portal where consumers can:
- Browse API documentation
- Test APIs interactively
- Register for API keys
- View usage analytics

For organizations exposing APIs to partners or developers, APIM is essential infrastructure.
