---
title: "APIM Policies in Production: Limits, Fan-out and Fallbacks"
description: "Four Azure API Management policy patterns that hold up in production: identity-aware limits, Key Vault named values, parallel fan-out and stale fallbacks."
author: Michael John Pena
draft: false
date: 2021-01-24
url: /blog/azure-api-management-policies/
tags:
  - Azure
  - API Management
  - APIs
  - Integration
  - Security
---

Most Azure API Management policy samples work in the test console and fall over in production. They throttle the wrong thing, hard-code secrets, call backends one after another when they could call them in parallel, or label a retry loop a "circuit breaker". Four patterns fix most of that, and each one has a limit or gotcha that decides whether it works.

If you want the basics first (policy sections, scopes, `<base />`, simple JWT and caching examples), start with my [policy deep dive](/blog/2020-11-15-azure-api-management-policies/) and the [gateway patterns overview](/blog/2020-09-11-azure-api-management/). This post assumes you already know them.

## Pattern 1: Validate the token once, then trust the variable

The common sample validates a JWT and then parses the `Authorization` header again with `AsJwt()` every time it needs a claim. That works, but it's wasteful, and it puts token parsing in several places. `validate-jwt` can write the validated token to a context variable with `output-token-variable-name`. Everything downstream then reads claims from a token the gateway has already checked.

The second improvement is to keep tenant IDs and audiences out of the XML. Named values are referenced as `{{name}}` and resolved when the policy runs. API Management can now reference an Azure Key Vault secret from a named value, read through the instance's managed identity ([named values docs](https://learn.microsoft.com/azure/api-management/api-management-howto-properties)). The feature is still in preview, so I use it for non-production environments and keep encrypted secret named values in production until it reaches GA. Tenant IDs and audiences aren't secret anyway. Backend API keys are, and those are the ones I want in Key Vault eventually.

```xml
<policies>
    <inbound>
        <base />
        <validate-jwt header-name="Authorization"
                      failed-validation-httpcode="401"
                      failed-validation-error-message="Unauthorized"
                      output-token-variable-name="jwt">
            <openid-config url="https://login.microsoftonline.com/{{aad-tenant-id}}/.well-known/openid-configuration" />
            <audiences>
                <audience>{{orders-api-audience}}</audience>
            </audiences>
            <issuers>
                <issuer>https://sts.windows.net/{{aad-tenant-id}}/</issuer>
            </issuers>
            <required-claims>
                <claim name="roles" match="any">
                    <value>Orders.Read</value>
                    <value>Orders.Admin</value>
                </claim>
            </required-claims>
        </validate-jwt>
        <set-variable name="callerId" value="@(((Jwt)context.Variables["jwt"]).Claims.GetValueOrDefault("oid", "unknown"))" />
        <set-header name="X-Caller-Id" exists-action="override">
            <value>@((string)context.Variables["callerId"])</value>
        </set-header>
        <set-header name="x-functions-key" exists-action="override">
            <value>{{orders-backend-key}}</value>
        </set-header>
    </inbound>
    <backend>
        <base />
    </backend>
    <outbound>
        <base />
    </outbound>
    <on-error>
        <base />
    </on-error>
</policies>
```

Two details matter here. The issuer must match the token version your Azure Active Directory app registration issues: `sts.windows.net` for v1.0 access tokens, `login.microsoftonline.com/<tenant-id>/v2.0` for v2.0. A mismatch here is the most common reason a "correct" `validate-jwt` returns 401. Also, `X-Caller-Id` is only trustworthy because the gateway sets it with `exists-action="override"`. If your backend can be reached without going through APIM, a client can send that header itself. Lock the backend down (IP restrictions, VNet, or a gateway-only key) before you rely on it.

## Pattern 2: Throttle the identity, not just the subscription

A tempting design is a `choose` block on `context.Subscription.ProductName` with a different `rate-limit`, say 100 calls per 3,600 seconds, in each branch. It doesn't work, for two reasons. `rate-limit` caps `renewal-period` at 300 seconds, and it can be used only once per policy definition ([rate-limit reference](https://learn.microsoft.com/azure/api-management/rate-limit-policy)). Branching on product names is fragile too: rename a product in the portal and your limits disappear without an error.

My rule of thumb:

| Need | Where to put it |
|---|---|
| Different limits per tier (Free, Standard, Premium) | A plain `rate-limit` and `quota` in each **product's** policy. The product is the tier. |
| Limit per end user, IP, or tenant, across subscriptions | `rate-limit-by-key` / `quota-by-key` at API or operation scope |
| Protect a fragile backend regardless of caller | `rate-limit-by-key` with a constant key at API scope |

The by-key policies are the advanced tool. One subscription key often sits behind a whole web app, so a per-subscription limit lets one noisy user use up everyone's allowance. Keying on the validated `oid` claim fixes that:

```xml
<policies>
    <inbound>
        <base />
        <rate-limit-by-key calls="60"
                           renewal-period="60"
                           counter-key="@((context.Subscription?.Id ?? "anon") + ":" + (string)context.Variables["callerId"])" />
        <quota-by-key calls="20000"
                      renewal-period="86400"
                      counter-key="@((context.Subscription?.Id ?? "anon") + ":" + (string)context.Variables["callerId"])"
                      increment-condition="@(context.Response.StatusCode >= 200 && context.Response.StatusCode < 400)" />
    </inbound>
    <backend>
        <base />
    </backend>
    <outbound>
        <base />
    </outbound>
    <on-error>
        <base />
    </on-error>
</policies>
```

This fragment depends on `callerId` from Pattern 1, so put it at a scope that runs after the JWT validation. The `?.` guard matters: on an API that doesn't require a subscription key, `context.Subscription` is null and a plain `.Id` throws. The trade-offs:

- **Tier support.** The by-key policies aren't available on the Consumption tier. If you're on Consumption, you only get subscription-based throttling.
- **Counters are per key, not per scope.** The same `counter-key` used at two scopes shares one counter. Prefix the key with the API name if you want separate budgets.
- **Accuracy.** Treat these limits as protection, not as billing. A caller can slip a few calls past the limit under load. If you charge for calls, meter them from logs.
- **Don't key on anything the client controls** unless it was validated first. Keying on a raw header lets a caller reset its own limit by changing the value.

## Pattern 3: Fan out in parallel with `wait`

Aggregation endpoints ("give me the customer, their orders, and their preferences in one call") are a legitimate gateway job when the backends already exist and a dedicated BFF service would be overkill. A common mistake is to write three `send-request` calls one after another and assume they run in parallel. They don't. Calls only run concurrently inside a [`wait` policy](https://learn.microsoft.com/azure/api-management/wait-policy), which runs its immediate children at the same time and, with `for="all"`, finishes when all of them complete.

```xml
<policies>
    <inbound>
        <base />
        <set-variable name="customerId" value="@(context.Request.MatchedParameters["customerId"])" />
        <wait for="all">
            <send-request mode="new" response-variable-name="profile" timeout="5" ignore-error="true">
                <set-url>@("https://<customers-backend>/api/customers/" + (string)context.Variables["customerId"])</set-url>
                <set-method>GET</set-method>
            </send-request>
            <send-request mode="new" response-variable-name="orders" timeout="5" ignore-error="true">
                <set-url>@("https://<orders-backend>/api/customers/" + (string)context.Variables["customerId"] + "/orders")</set-url>
                <set-method>GET</set-method>
                <set-header name="x-functions-key" exists-action="override">
                    <value>{{orders-backend-key}}</value>
                </set-header>
            </send-request>
        </wait>
        <return-response>
            <set-status code="200" reason="OK" />
            <set-header name="Content-Type" exists-action="override">
                <value>application/json</value>
            </set-header>
            <set-body>@{
                var profile = (IResponse)context.Variables["profile"];
                var orders = (IResponse)context.Variables["orders"];
                var profileOk = profile != null && profile.StatusCode == 200;
                var ordersOk = orders != null && orders.StatusCode == 200;
                return new JObject(
                    new JProperty("profile", profileOk ? profile.Body.As<JObject>() : null),
                    new JProperty("orders", ordersOk ? orders.Body.As<JArray>() : null),
                    new JProperty("partial", !(profileOk && ordersOk))
                ).ToString();
            }</set-body>
        </return-response>
    </inbound>
    <backend>
        <base />
    </backend>
    <outbound>
        <base />
    </outbound>
    <on-error>
        <base />
    </on-error>
</policies>
```

`ignore-error="true"` means a failed or timed-out call leaves the variable `null` instead of failing the whole request, so the body can return a partial result with an explicit `partial` flag. Decide up front whether partial is acceptable. For a dashboard it usually is. For a checkout page it isn't, and you should return a 502 instead.

When **not** to do this: if the aggregation needs business logic (joins, pagination across sources, writes), move it into a real service. Policy expressions are C# snippets you can't unit test, and the policy editor won't help you when one breaks.

## Pattern 4: Retry carefully, then serve stale data

APIM had no circuit breaker in January 2021. What you can build is retry plus a fallback. Two rules matter more than the XML:

1. **Retry only idempotent requests.** Retrying a `POST` that timed out after the backend committed it creates duplicate orders.
2. **Know what reaches `on-error`.** A backend that returns 500 is a *response*. It flows into `outbound`, not `on-error`. `on-error` fires when the gateway itself fails, such as a timeout or a refused connection in `forward-request`.

```xml
<policies>
    <inbound>
        <base />
    </inbound>
    <backend>
        <retry condition="@(context.Request.Method == "GET" && context.Response != null && context.Response.StatusCode >= 500)"
               count="2"
               interval="1"
               delta="1"
               max-interval="4"
               first-fast-retry="true">
            <forward-request timeout="10" />
        </retry>
    </backend>
    <outbound>
        <base />
        <set-variable name="staleKey" value="@("stale-" + context.Request.Url.Path + context.Request.Url.QueryString + ":" + context.Variables.GetValueOrDefault<string>("callerId", "shared"))" />
        <choose>
            <when condition="@(context.Request.Method == "GET" && context.Response.StatusCode == 200)">
                <cache-store-value key="@((string)context.Variables["staleKey"])"
                                   value="@(context.Response.Body.As<string>(preserveContent: true))"
                                   duration="3600" />
            </when>
            <when condition="@(context.Request.Method == "GET" && context.Response.StatusCode >= 500)">
                <cache-lookup-value key="@((string)context.Variables["staleKey"])" variable-name="stale" />
                <choose>
                    <when condition="@(context.Variables.ContainsKey("stale"))">
                        <return-response>
                            <set-status code="200" reason="OK" />
                            <set-header name="Content-Type" exists-action="override">
                                <value>application/json</value>
                            </set-header>
                            <set-header name="X-Served-Stale" exists-action="override">
                                <value>true</value>
                            </set-header>
                            <set-body>@((string)context.Variables["stale"])</set-body>
                        </return-response>
                    </when>
                </choose>
            </when>
        </choose>
    </outbound>
    <on-error>
        <base />
    </on-error>
</policies>
```

The [retry policy](https://learn.microsoft.com/azure/api-management/retry-policy) runs its children once before it evaluates `condition`, so `count="2"` means up to three attempts in total. With `interval`, `delta` and `max-interval` all set, the waits grow exponentially up to the cap. Keep the total small. Two quick retries absorb a blip; ten retries just keep a dying backend busy and hold the caller's connection open.

Both branches check for `GET`, so only safe reads are cached or replayed; a failed `POST` or `PUT` passes through with its real status instead of a cached body that pretends the write succeeded. The cache key includes the query string and, when Pattern 1 has run, the caller's `callerId`, so one user's response is never served to another. Even so, stale fallback suits shared, non-personalised data such as catalogues or reference lists. For per-user data the cache fills slowly and the fallback rarely helps.

A few more caveats. The built-in cache isn't available on the Consumption tier, so there you need an external Azure Cache for Redis configured on the instance. `cache-lookup-value` can appear only once per policy section, which is why the lookup sits inside the single `>= 500` branch. And a stale `200` hides an outage from clients, so the `X-Served-Stale` header and your monitoring need to tell the truth even if the response body doesn't. Copy the fallback lookup into `on-error` as well if you want timeouts to fall back too.

## Debugging when "the policy isn't firing"

Nearly every "it's not working" turns out to be scope, order, or a missing `<base />`. The fastest way to find out is a request trace. Send `Ocp-Apim-Trace: true` with a subscription key that has tracing allowed, then fetch the trace from the URL in the `Ocp-Apim-Trace-Location` response header. The test console in the Azure portal does this for you on the **Trace** tab. The trace shows each policy step that ran, which scope it came from, the expression results, and how long each step took. Use **Calculate effective policy** in the portal to see the merged XML. Turn tracing off for subscriptions you hand to external consumers, because traces expose your policy internals and backend URLs.

For things that aren't errors, such as "why did this caller get throttled", log the counter key and the caller to Application Insights or Event Hubs rather than adding temporary headers to responses.

## Where I'd draw the line

Policies are the right place for cross-cutting concerns that are the same for every caller: token validation, limits keyed on validated identity, secrets injection, and simple resilience. They're the wrong place for business rules, multi-step workflows, or anything you'd want a unit test for. If a policy expression is long enough to need comments, it belongs in code behind the gateway.

Keep policies in source control and deploy them with the rest of the API definition; the [APIM DevOps Resource Kit](https://github.com/Azure/azure-api-management-devops-resource-kit)'s extractor is a reasonable starting point for that. Validate claims once and pass them along, throttle on who the caller actually is, run independent backend calls inside `wait`, and only retry requests that are safe to repeat. Those four habits fix most of the production problems I see with APIM.
