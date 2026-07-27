---
title: Azure Static Web Apps Custom Authentication
author: Michael John Pena
draft: false
date: 2021-01-16
url: /blog/azure-static-web-apps-custom-authentication/
tags:
  - Azure
  - Static Web Apps
  - Authentication
  - Serverless
  - Web Development
---

Static Web Apps shipped its preview late 2020 and has been quietly stealing front-end workloads from App Service ever since. Today I want to dig into the part most teams underuse: the built-in authentication system. Out of the box you get GitHub, AAD, Twitter, and Google providers, role-based authorisation through a `staticwebapp.config.json`, and the option to plug in custom providers when the defaults don't fit. Below is the pattern I use to wire it up without inventing my own auth layer.

## Understanding Built-in Authentication

Azure Static Web Apps provides out-of-the-box authentication with providers like Azure Active Directory, GitHub, and Twitter. The authentication flow is handled entirely by the platform, making it incredibly simple to secure your applications.

```json
{
  "routes": [
    {
      "route": "/admin/*",
      "allowedRoles": ["admin"]
    },
    {
      "route": "/api/*",
      "allowedRoles": ["authenticated"]
    },
    {
      "route": "/*",
      "allowedRoles": ["anonymous", "authenticated"]
    }
  ]
}
```

## Implementing Custom Authentication

While the built-in providers are convenient, enterprise scenarios often require custom authentication. Here is how you can configure custom providers using the `staticwebapp.config.json` file:

```json
{
  "auth": {
    "identityProviders": {
      "customOpenIdConnectProviders": {
        "myProvider": {
          "registration": {
            "clientIdSettingName": "MY_PROVIDER_CLIENT_ID",
            "clientCredential": {
              "clientSecretSettingName": "MY_PROVIDER_CLIENT_SECRET"
            },
            "openIdConnectConfiguration": {
              "wellKnownOpenIdConfiguration": "https://myidp.com/.well-known/openid-configuration"
            }
          },
          "login": {
            "nameClaimType": "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name",
            "scopes": ["openid", "profile", "email"]
          }
        }
      }
    }
  }
}
```

## Accessing User Information in API Functions

When building Azure Functions as your API backend, you can access the authenticated user information through the `x-ms-client-principal` header:

```csharp
using System;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.Azure.WebJobs;
using Microsoft.Azure.WebJobs.Extensions.Http;

public static class UserInfoFunction
{
    [FunctionName("GetUserInfo")]
    public static IActionResult Run(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "userinfo")]
        HttpRequest req)
    {
        var principal = req.Headers["x-ms-client-principal"].FirstOrDefault();

        if (string.IsNullOrEmpty(principal))
        {
            return new UnauthorizedResult();
        }

        var decoded = Convert.FromBase64String(principal);
        var json = Encoding.UTF8.GetString(decoded);
        var clientPrincipal = JsonSerializer.Deserialize<ClientPrincipal>(json);

        return new OkObjectResult(new
        {
            UserId = clientPrincipal.UserId,
            UserRoles = clientPrincipal.UserRoles,
            IdentityProvider = clientPrincipal.IdentityProvider
        });
    }
}

public class ClientPrincipal
{
    public string IdentityProvider { get; set; }
    public string UserId { get; set; }
    public string UserDetails { get; set; }
    public IEnumerable<string> UserRoles { get; set; }
}
```

## Role-Based Access Control

Managing roles in Static Web Apps involves creating an invitation system or using custom APIs. Here is an example of a function that assigns roles:

```javascript
const { CosmosClient } = require("@azure/cosmos");

module.exports = async function (context, req) {
    const userId = req.body.userId;
    const newRole = req.body.role;

    // Validate the requesting user has admin privileges
    const principal = JSON.parse(
        Buffer.from(req.headers['x-ms-client-principal'], 'base64').toString()
    );

    if (!principal.userRoles.includes('admin')) {
        context.res = {
            status: 403,
            body: "Unauthorized to assign roles"
        };
        return;
    }

    // Store role assignment in Cosmos DB
    const client = new CosmosClient(process.env.COSMOS_CONNECTION);
    const database = client.database("UserManagement");
    const container = database.container("Roles");

    await container.items.upsert({
        id: userId,
        userId: userId,
        roles: [newRole],
        assignedBy: principal.userId,
        assignedAt: new Date().toISOString()
    });

    context.res = {
        status: 200,
        body: { message: "Role assigned successfully" }
    };
};
```

## Frontend Integration with React

Here is how you can integrate authentication in your React frontend:

```jsx
import React, { useState, useEffect } from 'react';

function App() {
    const [user, setUser] = useState(null);

    useEffect(() => {
        async function fetchUser() {
            const response = await fetch('/.auth/me');
            const data = await response.json();
            if (data.clientPrincipal) {
                setUser(data.clientPrincipal);
            }
        }
        fetchUser();
    }, []);

    const login = (provider) => {
        window.location.href = `/.auth/login/${provider}`;
    };

    const logout = () => {
        window.location.href = '/.auth/logout';
    };

    if (!user) {
        return (
            <div>
                <h1>Please sign in</h1>
                <button onClick={() => login('aad')}>Login with Azure AD</button>
                <button onClick={() => login('github')}>Login with GitHub</button>
            </div>
        );
    }

    return (
        <div>
            <h1>Welcome, {user.userDetails}</h1>
            <p>Roles: {user.userRoles.join(', ')}</p>
            <button onClick={logout}>Logout</button>
        </div>
    );
}

export default App;
```

## Security Best Practices

When implementing custom authentication in Azure Static Web Apps, keep these best practices in mind:

1. **Always validate tokens server-side**: Never trust client-side authentication alone
2. **Use HTTPS**: Static Web Apps enforces HTTPS by default
3. **Implement proper CORS policies**: Configure allowed origins in your config file
4. **Rotate secrets regularly**: Use Azure Key Vault for secret management
5. **Monitor authentication events**: Use Application Insights for tracking

Azure Static Web Apps continues to evolve, and the authentication capabilities make it an excellent choice for building secure, scalable web applications without managing infrastructure.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
