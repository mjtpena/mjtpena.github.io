---
title: "MSAL Libraries Deep Dive: Cross-Platform Authentication"
author: Michael John Peña
draft: false
date: 2021-05-24
tags:
  - Azure
  - Identity
  - MSAL
  - Authentication
  - Development

---

I wrote "MSAL Libraries Deep Dive: Cross-Platform Authentication" to share practical, production-minded guidance on this topic.

## MSAL Architecture

MSAL handles:
- OAuth 2.0 protocol flows
- Token caching
- Token refresh
- Multi-account support
- Conditional Access handling

## Token Cache Management

### Custom Token Cache (Python)

```python
from msal import SerializableTokenCache
import json
import os

class FileTokenCache:
    """Persistent token cache using file storage"""

    def __init__(self, cache_file="token_cache.json"):
        self.cache_file = cache_file
        self.cache = SerializableTokenCache()
        self._load_cache()

    def _load_cache(self):
        if os.path.exists(self.cache_file):
            with open(self.cache_file, 'r') as f:
                self.cache.deserialize(f.read())

    def _save_cache(self):
        if self.cache.has_state_changed:
            with open(self.cache_file, 'w') as f:
                f.write(self.cache.serialize())

    def get_cache(self):
        return self.cache

    def save(self):
        self._save_cache()

# Usage
token_cache = FileTokenCache()

msal_app = msal.ConfidentialClientApplication(
    CLIENT_ID,
    authority=AUTHORITY,
    client_credential=CLIENT_SECRET,
    token_cache=token_cache.get_cache()
)

# After token acquisition
result = msal_app.acquire_token_for_client(scopes=["https://graph.microsoft.com/.default"])
token_cache.save()
```

### Redis Token Cache

```python
import redis
from msal import SerializableTokenCache
import threading

class RedisTokenCache:
    """Distributed token cache using Redis"""

    def __init__(self, redis_client, cache_key="msal_token_cache"):
        self.redis = redis_client
        self.cache_key = cache_key
        self.cache = SerializableTokenCache()
        self._lock = threading.Lock()
        self._load_cache()

    def _load_cache(self):
        data = self.redis.get(self.cache_key)
        if data:
            self.cache.deserialize(data.decode('utf-8'))

    def save(self):
        with self._lock:
            if self.cache.has_state_changed:
                self.redis.set(
                    self.cache_key,
                    self.cache.serialize(),
                    ex=86400  # 24 hour expiry
                )

    def get_cache(self):
        return self.cache

# Usage
redis_client = redis.Redis(host='localhost', port=6379, db=0)
token_cache = RedisTokenCache(redis_client)

msal_app = msal.ConfidentialClientApplication(
    CLIENT_ID,
    authority=AUTHORITY,
    client_credential=CLIENT_SECRET,
    token_cache=token_cache.get_cache()
)
```

## Multi-Tenant Applications

```python
from msal import ConfidentialClientApplication

class MultiTenantAuth:
    """Handle authentication for multi-tenant applications"""

    def __init__(self, client_id, client_secret):
        self.client_id = client_id
        self.client_secret = client_secret
        self._apps = {}

    def get_app_for_tenant(self, tenant_id):
        """Get or create MSAL app for specific tenant"""
        if tenant_id not in self._apps:
            self._apps[tenant_id] = ConfidentialClientApplication(
                self.client_id,
                authority=f"https://login.microsoftonline.com/{tenant_id}",
                client_credential=self.client_secret
            )
        return self._apps[tenant_id]

    def get_token(self, tenant_id, scopes):
        """Acquire token for specific tenant"""
        app = self.get_app_for_tenant(tenant_id)

        # Try silent first
        accounts = app.get_accounts()
        if accounts:
            result = app.acquire_token_silent(scopes, account=accounts[0])
            if result:
                return result

        # Fall back to client credentials
        return app.acquire_token_for_client(scopes=scopes)

# Usage
multi_tenant = MultiTenantAuth(CLIENT_ID, CLIENT_SECRET)

# Get token for tenant A
token_a = multi_tenant.get_token(
    "tenant-a-id",
    ["https://graph.microsoft.com/.default"]
)

# Get token for tenant B
token_b = multi_tenant.get_token(
    "tenant-b-id",
    ["https://graph.microsoft.com/.default"]
)
```

## On-Behalf-Of Flow

For APIs calling downstream APIs:

```python
from msal import ConfidentialClientApplication

class OnBehalfOfHandler:
    """Handle OBO flow for API-to-API calls"""

    def __init__(self, client_id, client_secret, authority):
        self.app = ConfidentialClientApplication(
            client_id,
            authority=authority,
            client_credential=client_secret
        )

    def get_downstream_token(self, user_token, scopes):
        """Exchange user token for downstream API token"""

        result = self.app.acquire_token_on_behalf_of(
            user_assertion=user_token,
            scopes=scopes
        )

        if "access_token" in result:
            return result["access_token"]

        raise Exception(f"OBO failed: {result.get('error_description')}")

# In your API endpoint
from flask import request

obo_handler = OnBehalfOfHandler(
    CLIENT_ID,
    CLIENT_SECRET,
    f"https://login.microsoftonline.com/{TENANT_ID}"
)

@app.route("/api/call-downstream")
def call_downstream():
    # Get user's token from request
    user_token = request.headers.get("Authorization", "").replace("Bearer ", "")

    # Exchange for downstream token
    downstream_token = obo_handler.get_downstream_token(
        user_token,
        scopes=["api://downstream-api/.default"]
    )

    # Call downstream API
    response = requests.get(
        "https://downstream-api.com/data",
        headers={"Authorization": f"Bearer {downstream_token}"}
    )

    return response.json()
```

## MSAL for .NET

### ASP.NET Core Integration

```csharp
// Startup.cs
public void ConfigureServices(IServiceCollection services)
{
    services.AddAuthentication(OpenIdConnectDefaults.AuthenticationScheme)
        .AddMicrosoftIdentityWebApp(Configuration.GetSection("AzureAd"))
        .EnableTokenAcquisitionToCallDownstreamApi()
        .AddMicrosoftGraph(Configuration.GetSection("MicrosoftGraph"))
        .AddInMemoryTokenCaches();

    services.AddControllersWithViews()
        .AddMicrosoftIdentityUI();
}

// appsettings.json
{
    "AzureAd": {
        "Instance": "https://login.microsoftonline.com/",
        "TenantId": "your-tenant-id",
        "ClientId": "your-client-id",
        "ClientSecret": "your-client-secret",
        "CallbackPath": "/signin-oidc"
    },
    "MicrosoftGraph": {
        "BaseUrl": "https://graph.microsoft.com/v1.0",
        "Scopes": "User.Read"
    }
}
```

### Desktop Application

```csharp
using Microsoft.Identity.Client;

public class DesktopAuth
{
    private IPublicClientApplication _app;
    private string[] _scopes = { "User.Read", "Mail.Read" };

    public DesktopAuth(string clientId, string tenantId)
    {
        _app = PublicClientApplicationBuilder
            .Create(clientId)
            .WithAuthority($"https://login.microsoftonline.com/{tenantId}")
            .WithDefaultRedirectUri()
            .Build();

        // Enable token cache persistence
        TokenCacheHelper.EnableSerialization(_app.UserTokenCache);
    }

    public async Task<AuthenticationResult> SignInAsync()
    {
        AuthenticationResult result;

        // Try silent authentication first
        var accounts = await _app.GetAccountsAsync();
        var firstAccount = accounts.FirstOrDefault();

        try
        {
            result = await _app.AcquireTokenSilent(_scopes, firstAccount)
                .ExecuteAsync();
        }
        catch (MsalUiRequiredException)
        {
            // Interactive authentication required
            result = await _app.AcquireTokenInteractive(_scopes)
                .WithAccount(firstAccount)
                .WithPrompt(Prompt.SelectAccount)
                .ExecuteAsync();
        }

        return result;
    }

    public async Task SignOutAsync()
    {
        var accounts = await _app.GetAccountsAsync();
        foreach (var account in accounts)
        {
            await _app.RemoveAsync(account);
        }
    }
}
```

## Error Handling

```python
from msal import ConfidentialClientApplication
import msal

def acquire_token_with_retry(app, scopes, max_retries=3):
    """Acquire token with proper error handling"""

    for attempt in range(max_retries):
        try:
            result = app.acquire_token_for_client(scopes=scopes)

            if "access_token" in result:
                return result["access_token"]

            error = result.get("error", "")
            error_description = result.get("error_description", "")

            # Handle specific errors
            if error == "invalid_client":
                raise Exception("Client credentials are invalid")

            if error == "invalid_scope":
                raise Exception(f"Invalid scope: {error_description}")

            if "AADSTS700016" in error_description:
                raise Exception("Application not found in tenant")

            if "AADSTS7000215" in error_description:
                raise Exception("Invalid client secret")

            if "temporarily_unavailable" in error:
                # Retry for transient errors
                time.sleep(2 ** attempt)
                continue

            raise Exception(f"Token acquisition failed: {error_description}")

        except Exception as e:
            if attempt == max_retries - 1:
                raise
            time.sleep(2 ** attempt)

    raise Exception("Max retries exceeded")

# Handle Conditional Access
def handle_conditional_access(app, scopes, claims_challenge):
    """Handle Conditional Access claims challenge"""

    # The claims_challenge comes from a 401 response with WWW-Authenticate header
    result = app.acquire_token_for_client(
        scopes=scopes,
        claims_challenge=claims_challenge
    )

    return result
```

## Performance Optimization

```python
import asyncio
from msal import ConfidentialClientApplication

class OptimizedTokenProvider:
    """Optimized token acquisition with caching"""

    def __init__(self, client_id, client_secret, authority):
        self.app = ConfidentialClientApplication(
            client_id,
            authority=authority,
            client_credential=client_secret
        )
        self._token_cache = {}
        self._locks = {}

    async def get_token(self, scopes):
        """Get token with local caching"""
        scope_key = tuple(sorted(scopes))

        # Check local cache first (faster than MSAL cache lookup)
        if scope_key in self._token_cache:
            token_info = self._token_cache[scope_key]
            if token_info['expires_at'] > time.time() + 300:  # 5 min buffer
                return token_info['access_token']

        # Acquire lock for this scope
        if scope_key not in self._locks:
            self._locks[scope_key] = asyncio.Lock()

        async with self._locks[scope_key]:
            # Double-check after acquiring lock
            if scope_key in self._token_cache:
                token_info = self._token_cache[scope_key]
                if token_info['expires_at'] > time.time() + 300:
                    return token_info['access_token']

            # Acquire new token
            result = self.app.acquire_token_for_client(scopes=list(scopes))

            if "access_token" in result:
                self._token_cache[scope_key] = {
                    'access_token': result['access_token'],
                    'expires_at': time.time() + result.get('expires_in', 3600)
                }
                return result['access_token']

            raise Exception(f"Token acquisition failed: {result.get('error_description')}")
```

## Resources

- [MSAL Python Documentation](https://msal-python.readthedocs.io/)
- [MSAL.NET Documentation](https://github.com/AzureAD/microsoft-authentication-library-for-dotnet)
- [MSAL.js Documentation](https://github.com/AzureAD/microsoft-authentication-library-for-js)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
