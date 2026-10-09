---
title: "Azure API Management for AI APIs: Rate Limiting and Cost Control"
description: "Configure Azure Monitor alerts when subscriptions approach quota limits. Provide self-service usage dashboards so customers can track their consumption and…"
author: Michael John Peña
draft: false
date: 2025-07-27
tags:
  - Azure API Management
  - AI APIs
  - Rate Limiting
  - Cost Management
  - Infrastructure
---

## Configuring AI-Specific Policies

Create policies that account for token-based billing:

```xml
<policies>
    <inbound>
        <base />

        <!-- Extract token count from request -->
        <set-variable name="requestTokens" value="@{
            var body = context.Request.Body.As<JObject>();
            var messages = body["messages"] as JArray;
            int tokens = 0;
            foreach (var msg in messages) {
                tokens += msg["content"].ToString().Length / 4; // Rough estimate
            }
            return tokens;
        }" />

        <!-- Token-based rate limiting -->
        <rate-limit-by-key
            calls="1000"
            renewal-period="60"
            counter-key="@(context.Subscription.Id)"
            increment-condition="@(true)"
            increment-count="@((int)context.Variables["requestTokens"])" />

        <!-- Daily quota per subscription -->
        <quota-by-key
            calls="100000"
            bandwidth="0"
            renewal-period="86400"
            counter-key="@(context.Subscription.Id)" />

        <!-- Cost tracking header -->
        <set-header name="X-Token-Estimate" exists-action="override">
            <value>@((string)context.Variables["requestTokens"])</value>
        </set-header>
    </inbound>

    <outbound>
        <base />

        <!-- Track actual usage from response -->
        <set-variable name="responseTokens" value="@{
            var body = context.Response.Body.As<JObject>();
            return body["usage"]?["total_tokens"]?.Value<int>() ?? 0;
        }" />

        <!-- Log to Event Hub for billing -->
        <log-to-eventhub logger-id="ai-usage-logger">@{
            return new JObject(
                new JProperty("subscriptionId", context.Subscription.Id),
                new JProperty("operation", context.Operation.Id),
                new JProperty("tokensUsed", context.Variables["responseTokens"]),
                new JProperty("timestamp", DateTime.UtcNow)
            ).ToString();
        }</log-to-eventhub>
    </outbound>
</policies>
```

## Implementing Tiered Access

Different subscription tiers get different limits:

```xml
<choose>
    <when condition="@(context.Product.Name == "Enterprise")">
        <rate-limit-by-key calls="10000" renewal-period="60"
            counter-key="@(context.Subscription.Id)" />
    </when>
    <when condition="@(context.Product.Name == "Professional")">
        <rate-limit-by-key calls="1000" renewal-period="60"
            counter-key="@(context.Subscription.Id)" />
    </when>
    <otherwise>
        <rate-limit-by-key calls="100" renewal-period="60"
            counter-key="@(context.Subscription.Id)" />
    </otherwise>
</choose>
```

## Monitoring and Alerts

Configure Azure Monitor alerts when subscriptions approach quota limits. Provide self-service usage dashboards so customers can track their consumption and plan accordingly.
