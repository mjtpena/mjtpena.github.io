---
title: "Building Integrations with Power Automate HTTP Connector"
description: "A pattern I keep seeing this year: the IT team has standardised on Power Automate for citizen-developer workflows, but the moment a flow needs to talk to an…"
author: Michael John Peña
draft: false
date: 2020-08-07
tags:
  - Power Platform
  - Power Automate
  - Integration
  - Low Code
---

A pattern I keep seeing this year: the IT team has standardised on Power Automate for citizen-developer workflows, but the moment a flow needs to talk to an internal REST API, the pre-built connector list lets them down. The HTTP action fills that gap. It's also the action I've watched cause the most production grief, because everyone treats it like a magic "call thing on internet" button instead of an actual HTTP client. Here's how I use it without regretting it later.

## When to Use HTTP Connector

Use the HTTP connector when:
- No pre-built connector exists for your service
- You need custom API calls
- You are integrating with internal APIs
- You need more control over request/response handling

## Basic HTTP Request

1. Create a new flow
2. Add an HTTP action
3. Configure the request:

```
Method: GET
URI: https://api.example.com/users
Headers:
  Content-Type: application/json
  Authorization: Bearer @{variables('accessToken')}
```

## Authentication Patterns

### API Key Authentication

```
Headers:
  X-API-Key: your-api-key-here
```

### OAuth 2.0

For APIs requiring OAuth:

1. Use the HTTP with Azure AD connector for Azure APIs
2. Or implement the OAuth flow manually:

```
// Get token
Method: POST
URI: https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token
Headers:
  Content-Type: application/x-www-form-urlencoded
Body:
  client_id=your-client-id
  &client_secret=your-client-secret
  &scope=https://graph.microsoft.com/.default
  &grant_type=client_credentials
```

Then parse the response:

```
@{body('HTTP_Get_Token')?['access_token']}
```

## Parsing JSON Responses

Use the Parse JSON action after HTTP:

```json
{
    "type": "object",
    "properties": {
        "users": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": { "type": "string" },
                    "name": { "type": "string" },
                    "email": { "type": "string" }
                }
            }
        }
    }
}
```

## Error Handling

Configure run after settings for error handling:

```
Configure run after:
  - Has succeeded
  - Has failed
  - Has timed out
```

Add a condition to check status:

```
Condition: @equals(outputs('HTTP')['statusCode'], 200)

If yes: Process response
If no: Send error notification
```

## Retry Policies

Configure retry policy in HTTP action settings:

```json
{
    "retryPolicy": {
        "type": "exponential",
        "count": 3,
        "interval": "PT10S",
        "minimumInterval": "PT5S",
        "maximumInterval": "PT1H"
    }
}
```

## Pagination Handling

For APIs that return paginated results:

```
Initialize variable: allResults (Array)
Initialize variable: nextUrl (String) = initial API URL

Do until: empty(variables('nextUrl'))
  HTTP GET: variables('nextUrl')
  Parse JSON: response
  Append to array: allResults
  Set variable: nextUrl = body('Parse_JSON')?['nextLink']
```

## Calling Azure Functions

```
Method: POST
URI: https://your-function.azurewebsites.net/api/ProcessData
Headers:
  x-functions-key: your-function-key
  Content-Type: application/json
Body:
{
    "data": "@{triggerBody()}",
    "timestamp": "@{utcNow()}"
}
```

## Webhook Integration

Create a flow triggered by HTTP request:

1. Use "When a HTTP request is received" trigger
2. Define the JSON schema for incoming data
3. Process the webhook payload
4. Return a response

```
Response action:
  Status Code: 200
  Body: { "status": "processed", "id": "@{guid()}" }
```

## Security Best Practices

1. **Store secrets in Azure Key Vault** - Use the Key Vault connector
2. **Use managed identities** - When calling Azure services
3. **Implement IP restrictions** - For webhook endpoints
4. **Log all API calls** - For auditing and debugging

## Performance Tips

1. **Use parallel branches** - For independent API calls
2. **Implement caching** - Store frequently accessed data
3. **Batch requests** - When APIs support it
4. **Set reasonable timeouts** - Default is 100 seconds

A note for anyone treating this as a free pass: the HTTP connector is a Premium connector. It's licensed per user (or per flow), and the licensing question has killed more "we'll just use Power Automate" projects in my experience than any technical limitation. Check the licensing first. Then build the flow.
