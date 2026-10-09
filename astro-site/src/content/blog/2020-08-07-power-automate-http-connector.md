---
title: "Power Automate's HTTP Action: Auth, Retries, Paging and Licensing"
description: "How to use the premium HTTP action in Power Automate properly: built-in Azure AD auth, retry policies, the 120-second limit, paging, and licensing."
author: Michael John Peña
draft: false
date: 2020-08-07
tags:
  - Power Platform
  - Power Automate
  - Integration
  - REST API
  - Low-Code
---

Once an organisation standardises on Power Automate for citizen-developer workflows, the first internal REST API exposes the gap in the connector list. The HTTP action fills it, and it's also the action most likely to fail in production, because people treat it as a convenience rather than an HTTP client with real failure modes. Treat it like any other HTTP client: authenticate properly, plan for failure, and license it before you build.

## When the HTTP action is the right tool

The HTTP action is a raw HTTP client running inside the same workflow engine as Azure Logic Apps. That means you get Logic Apps behaviour for free: retry policies, the asynchronous polling pattern, built-in authentication, and run history that records every request and response.

Reach for it when:

- No connector exists for the service, and you need one or two calls, not a whole API surface.
- You're calling an internal API you own and can change if the integration gets awkward.
- You need control the connector doesn't give you, such as a specific header, an endpoint the connector doesn't expose, or the raw status code.

Don't reach for it when:

- **A certified connector exists.** It handles auth, paging and throttling for you, and admins can govern it with DLP policies by name. An HTTP call to the same API is just "HTTP" to your data loss prevention policy, which is a governance problem.
- **More than one or two flows will call the same API.** Build a custom connector instead. You define the API once, and the connection holds the credentials.
- **The work is heavy.** If you need to transform thousands of records or wait minutes for a response, push that into an Azure Function or a Logic App and have the flow call it.

## A basic request

The action takes a method, URI, headers, query parameters and a body. Under the hood, every action is a JSON definition, and you can see it with **Peek code** on the action menu. I'll show definitions in that form because they're unambiguous. This fragment is a simple unauthenticated GET; authentication comes next:

```json
{
  "type": "Http",
  "inputs": {
    "method": "GET",
    "uri": "https://<your-api-host>/api/customers",
    "headers": {
      "Accept": "application/json"
    },
    "queries": {
      "status": "active"
    }
  }
}
```

Two habits worth forming early. First, put query string values in **Queries** rather than concatenating them into the URI, so they're encoded properly. Second, rename the action straight away (`Get_active_customers`, not `HTTP_3`). Hand-typed expressions reference that name, and the designer doesn't always rewrite them when you rename later.

## Authentication: use the built-in options first

The most common mistake I see in HTTP flows is a manual token request: an HTTP POST to the Azure AD token endpoint with a client secret in the body, followed by a second HTTP call that pastes the `access_token` into an `Authorization` header. It works, but the secret sits in plain text in the flow definition and in every run's inputs.

The HTTP action already has an [Authentication](https://learn.microsoft.com/en-us/azure/logic-apps/set-up-security-permissions#add-authentication-outbound) setting under its advanced options, with these types: Basic, Client Certificate, Active Directory OAuth, and Raw. For anything protected by Azure Active Directory, including your own APIs and Microsoft Graph, use **Active Directory OAuth** and let the engine get the token:

```json
{
  "type": "Http",
  "inputs": {
    "method": "GET",
    "uri": "https://graph.microsoft.com/v1.0/users?$select=id,displayName,mail",
    "authentication": {
      "type": "ActiveDirectoryOAuth",
      "authority": "https://login.microsoftonline.com",
      "tenant": "<your-tenant-id>",
      "audience": "https://graph.microsoft.com",
      "clientId": "<your-app-registration-client-id>",
      "secret": "@{body('Get_secret')?['value']}"
    }
  }
}
```

The `audience` is the resource you're calling, not a scope; for your own API it's the Application ID URI from its app registration. This is the client credentials flow, so the app registration needs **application** permissions with admin consent, and the flow acts as the app, not as the person who triggered it.

If you want delegated calls instead, the separate [HTTP with Azure AD](https://learn.microsoft.com/en-us/connectors/webcontents/) connector signs in as whoever owns the connection. It's limited to the permissions its Microsoft-owned app has been granted. Calls run as the connection owner, not as the person who triggered the flow, unless run-only users supply their own connection. I use it for quick admin reads, not for anything shared.

For APIs that use a static key, a header such as `X-API-Key` or a `code` query parameter for Azure Functions is fine. Just don't type the key into the action.

### Keeping secrets out of run history

Run history is visible to every owner of the flow, and it records action inputs and outputs in full. Two things help:

- **Secure Inputs and Secure Outputs** in the action's settings hide those values from run history. Turn them on for any action that handles a token, key or password, including the action that fetches the secret.
- **Fetch the secret at run time** from Azure Key Vault with the Key Vault connector's "Get secret" action (that's what `body('Get_secret')` refers to above), rather than storing it in a variable or a compose action. Securing the Get secret action's outputs doesn't secure the HTTP action that consumes them; turn on Secure Inputs there as well.

A custom connector is still cleaner: the credential lives in the connection, never in the flow definition.

## Know the limits before you design

The HTTP action inherits the platform's request limits, and they shape the design more than people expect. The ones that matter most, from the [Power Automate limits and configuration](https://learn.microsoft.com/en-us/power-automate/limits-and-config) page:

| Limit | Value | What it means for you |
|---|---|---|
| Outbound synchronous request timeout | 120 seconds | A slow API call fails, whatever the flow's total duration |
| Asynchronous (202 + `Location`) request | Polled until the run's 30-day duration limit | Make long jobs return 202 and a status URL |
| Do until loop | 60 iterations, 1 hour by default | Paging loops stop silently unless you raise the limits |
| Daily action requests | Based on licence | Tight polling loops burn through it |

The asynchronous pattern is the important one. If your API returns `202 Accepted` with a `Location` header, the HTTP action polls that URL until it gets a final response, honouring any `Retry-After` header. If you control the API, that pattern is the fix for "the call takes three minutes"; a synchronous call won't wait longer.

## Retries and error handling

By default, the action retries failures on 408, 429 and 5xx responses with an exponential policy of up to four retries. Override it when the API has its own guidance, such as a throttled internal service that needs longer gaps. The setting maps to a `retryPolicy` block inside `inputs`:

```json
{
  "type": "Http",
  "inputs": {
    "method": "GET",
    "uri": "https://<your-api-host>/api/customers",
    "retryPolicy": {
      "type": "exponential",
      "count": 4,
      "interval": "PT10S",
      "minimumInterval": "PT5S",
      "maximumInterval": "PT1H"
    }
  }
}
```

The Logic Apps error handling documentation lists each policy type and its allowed ranges. Two warnings. Never retry a non-idempotent POST against an API that doesn't support idempotency keys, or you'll create duplicates. Set the policy to **None** for that action. And remember that retries extend the run: four exponential retries on a slow endpoint can add minutes.

The part that trips people up is what happens after a failure. A 4xx or 5xx response **fails the action**, and by default every action after it is skipped. A Condition checking `outputs('Get_active_customers')['statusCode']` after the call only ever sees successes unless you change its **Configure run after** setting to include "has failed" and "has timed out".

The structure I use is a scope-based try/catch:

1. A **Try** scope containing the HTTP call and the actions that process its result.
2. A **Catch** scope configured to run after Try has failed, has timed out or is skipped.
3. Inside Catch, read the details with `result('Try')`, which returns the status, inputs and outputs of each action in the scope. Log them or notify someone, then end the run with a **Terminate** action set to Failed.

That last step matters. If the Catch scope succeeds, the run shows as succeeded, and nobody looks at it.

## Paging through results

Most REST APIs page. Microsoft Graph, for example, returns an `@odata.nextLink` property until the last page, as the Graph paging documentation describes. The pattern in a flow:

1. Initialise an array variable `allUsers` and a string variable `nextUrl` set to the first page URL.
2. Add a **Do until** loop that runs until `empty(variables('nextUrl'))` is true.
3. Inside it, call the HTTP action with `variables('nextUrl')` as the URI.
4. Use **Append to array variable** on each item, or `union()` the page with the existing array through a Compose action.
5. Set `nextUrl` to `coalesce(body('Get_users_page')?['@odata.nextLink'], '')`.

The `coalesce` is there because the property is absent on the last page, and setting a string variable to null fails. Also raise the loop's **Change limits** values. With the default of 60 iterations and Graph's default page size, the loop stops partway through a large tenant and reports success. The data is quietly incomplete.

If you need the whole result set every time, a Logic App or Data Factory pipeline is a better home.

## Receiving calls: the Request trigger

The other half of HTTP integration is the **When a HTTP request is received** trigger, which gives the flow a URL that other systems can POST to. Provide a JSON schema so the body's fields show up as dynamic content, and pair it with a **Response** action if the caller expects a reply.

Treat that URL as a credential. It contains a shared access signature in the `sig` query parameter, and anyone with the full URL can trigger the flow. Don't paste it into tickets or front-end code. The caller must also get its response within the inbound request limit, so if the work takes longer, respond with `202 Accepted` first and do the work after the Response action.

## Decide licensing before you build

Here's the note for anyone treating this as a free pass: the HTTP action, the Request trigger and the Response action are all **premium**. The Power Automate use rights included with Office 365 cover standard connectors only. Under the [standalone plans Microsoft introduced last October](https://learn.microsoft.com/en-us/power-platform-release-plan/2019wave2/power-automate/new-licensing-options-power-automate-standalone-paid-plans), that means either the per user plan (US$15 per user per month) for everyone who runs the flow, or the per flow plan (US$500 per month for five flows, regardless of how many people use them). Who needs the licence depends on the trigger: an automated or scheduled flow runs under its owner's licence, while an instant flow needs a licence for each user who runs it, including run-only users, as the [Power Platform licensing FAQ](https://learn.microsoft.com/en-us/power-platform/admin/powerapps-flow-licensing-faq) explains. Power Apps per app and per user plans, and Dynamics 365 licences, also cover premium connectors for flows that run in the context of that app.

My order of operations is fixed now: confirm who will run the flow and how they're licensed, then decide between a connector, a custom connector, or the HTTP action, and only then build. An HTTP action is the right tool when it's one or two calls to an API you control. When it becomes the backbone of an integration, that's the signal to graduate to a custom connector or a Logic App.
