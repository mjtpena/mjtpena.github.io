---
title: "Microsoft Identity Platform: Modern Authentication for Developers"
author: Michael John Peña
draft: false
date: 2021-05-23
tags:
  - Azure
  - Identity
  - Authentication
  - OAuth
  - Development
---

## Platform Components

- **Azure AD**: Identity provider
- **OAuth 2.0 & OpenID Connect**: Protocols
- **Microsoft Authentication Library (MSAL)**: Client libraries
- **Microsoft Graph**: API for identity data

## Registering an Application

```bash
# Register app via CLI
az ad app create \
    --display-name "My Web App" \
    --sign-in-audience AzureADMyOrg \
    --web-redirect-uris "https://localhost:5000/auth/callback" \
    --enable-id-token-issuance true

# Create service principal
az ad sp create --id <app-id>

# Add API permissions
az ad app permission add \
    --id <app-id> \
    --api 00000003-0000-0000-c000-000000000000 \
    --api-permissions e1fe6dd8-ba31-4d61-89e7-88639da4683d=Scope
```

Via Graph API:

```python
import requests

def register_application(display_name, redirect_uris, permissions):
    """Register application in Azure AD"""

    app = {
        "displayName": display_name,
        "signInAudience": "AzureADMyOrg",
        "web": {
            "redirectUris": redirect_uris,
            "implicitGrantSettings": {
                "enableIdTokenIssuance": True
            }
        },
        "requiredResourceAccess": [
            {
                "resourceAppId": "00000003-0000-0000-c000-000000000000",  # Graph
                "resourceAccess": [
                    {
                        "id": permission_id,
                        "type": "Scope"
                    }
                    for permission_id in permissions
                ]
            }
        ]
    }

    response = requests.post(
        f"{graph_url}/applications",
        headers=headers,
        json=app
    )

    return response.json()
```

## MSAL for Python

### Web Application (Confidential Client)

```python
from msal import ConfidentialClientApplication
from flask import Flask, redirect, url_for, session, request

app = Flask(__name__)
app.secret_key = "your-secret-key"

# MSAL configuration
CLIENT_ID = "your-client-id"
CLIENT_SECRET = "your-client-secret"
AUTHORITY = "https://login.microsoftonline.com/your-tenant-id"
REDIRECT_PATH = "/auth/callback"
SCOPE = ["User.Read", "Mail.Read"]

def get_msal_app():
    return ConfidentialClientApplication(
        CLIENT_ID,
        authority=AUTHORITY,
        client_credential=CLIENT_SECRET
    )

@app.route("/login")
def login():
    msal_app = get_msal_app()

    # Generate auth URL
    auth_url = msal_app.get_authorization_request_url(
        scopes=SCOPE,
        redirect_uri=url_for("auth_callback", _external=True),
        state=session.get("state", "")
    )

    return redirect(auth_url)

@app.route("/auth/callback")
def auth_callback():
    if "error" in request.args:
        return f"Error: {request.args['error_description']}"

    code = request.args.get("code")
    msal_app = get_msal_app()

    # Exchange code for tokens
    result = msal_app.acquire_token_by_authorization_code(
        code,
        scopes=SCOPE,
        redirect_uri=url_for("auth_callback", _external=True)
    )

    if "access_token" in result:
        session["user"] = result.get("id_token_claims")
        session["access_token"] = result["access_token"]
        return redirect(url_for("profile"))

    return f"Error: {result.get('error_description')}"

@app.route("/profile")
def profile():
    if "access_token" not in session:
        return redirect(url_for("login"))

    # Call Microsoft Graph
    response = requests.get(
        "https://graph.microsoft.com/v1.0/me",
        headers={"Authorization": f"Bearer {session['access_token']}"}
    )

    return response.json()

@app.route("/logout")
def logout():
    session.clear()
    return redirect(
        f"{AUTHORITY}/oauth2/v2.0/logout"
        f"?post_logout_redirect_uri={url_for('index', _external=True)}"
    )
```

### Daemon Application (Client Credentials)

```python
from msal import ConfidentialClientApplication

def get_app_token():
    """Get token for daemon/service application"""

    msal_app = ConfidentialClientApplication(
        CLIENT_ID,
        authority=AUTHORITY,
        client_credential=CLIENT_SECRET
    )

    # Try to get token from cache first
    result = msal_app.acquire_token_silent(
        scopes=["https://graph.microsoft.com/.default"],
        account=None
    )

    if not result:
        # Acquire new token
        result = msal_app.acquire_token_for_client(
            scopes=["https://graph.microsoft.com/.default"]
        )

    if "access_token" in result:
        return result["access_token"]

    raise Exception(f"Could not acquire token: {result.get('error_description')}")

# Use token for Graph API calls
token = get_app_token()
response = requests.get(
    "https://graph.microsoft.com/v1.0/users",
    headers={"Authorization": f"Bearer {token}"}
)
```

## MSAL for JavaScript (SPA)

```javascript
import { PublicClientApplication, InteractionType } from "@azure/msal-browser";

const msalConfig = {
    auth: {
        clientId: "your-client-id",
        authority: "https://login.microsoftonline.com/your-tenant-id",
        redirectUri: "http://localhost:3000"
    },
    cache: {
        cacheLocation: "sessionStorage",
        storeAuthStateInCookie: false
    }
};

const msalInstance = new PublicClientApplication(msalConfig);

const loginRequest = {
    scopes: ["User.Read", "Mail.Read"]
};

// Login with popup
async function signIn() {
    try {
        const response = await msalInstance.loginPopup(loginRequest);
        console.log("Login successful:", response.account.username);
        return response;
    } catch (error) {
        console.error("Login failed:", error);
    }
}

// Acquire token silently
async function getToken() {
    const accounts = msalInstance.getAllAccounts();

    if (accounts.length === 0) {
        throw new Error("No accounts found. Please sign in first.");
    }

    const silentRequest = {
        scopes: ["User.Read"],
        account: accounts[0]
    };

    try {
        const response = await msalInstance.acquireTokenSilent(silentRequest);
        return response.accessToken;
    } catch (error) {
        // Fall back to interactive
        const response = await msalInstance.acquireTokenPopup(silentRequest);
        return response.accessToken;
    }
}

// Call Microsoft Graph
async function callGraph() {
    const token = await getToken();

    const response = await fetch("https://graph.microsoft.com/v1.0/me", {
        headers: {
            Authorization: `Bearer ${token}`
        }
    });

    return response.json();
}
```

## Token Validation

Validate tokens in your API:

```python
import jwt
from jwt import PyJWKClient

def validate_token(token, audience):
    """Validate Azure AD token"""

    # Get signing keys from Azure AD
    jwks_url = f"https://login.microsoftonline.com/{TENANT_ID}/discovery/v2.0/keys"
    jwks_client = PyJWKClient(jwks_url)
    signing_key = jwks_client.get_signing_key_from_jwt(token)

    # Validate token
    try:
        payload = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            audience=audience,
            issuer=f"https://login.microsoftonline.com/{TENANT_ID}/v2.0"
        )
        return payload
    except jwt.ExpiredSignatureError:
        raise Exception("Token has expired")
    except jwt.InvalidAudienceError:
        raise Exception("Invalid audience")
    except jwt.InvalidIssuerError:
        raise Exception("Invalid issuer")

# Flask middleware
from functools import wraps
from flask import request, jsonify

def require_auth(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return jsonify({"error": "Missing token"}), 401

        token = auth_header.replace("Bearer ", "")

        try:
            claims = validate_token(token, CLIENT_ID)
            request.user = claims
        except Exception as e:
            return jsonify({"error": str(e)}), 401

        return f(*args, **kwargs)
    return decorated

@app.route("/api/protected")
@require_auth
def protected_resource():
    return jsonify({
        "message": "Hello, authenticated user!",
        "user": request.user.get("preferred_username")
    })
```

## Protecting Your Own API

Register your API and define scopes:

```python
def create_api_registration():
    """Register API with custom scopes"""

    api_app = {
        "displayName": "My Protected API",
        "identifierUris": ["api://my-api"],
        "api": {
            "oauth2PermissionScopes": [
                {
                    "id": "unique-guid-1",
                    "adminConsentDescription": "Read data from the API",
                    "adminConsentDisplayName": "Read API Data",
                    "userConsentDescription": "Read data from the API",
                    "userConsentDisplayName": "Read API Data",
                    "isEnabled": True,
                    "type": "User",
                    "value": "Data.Read"
                },
                {
                    "id": "unique-guid-2",
                    "adminConsentDescription": "Write data to the API",
                    "adminConsentDisplayName": "Write API Data",
                    "userConsentDescription": "Write data to the API",
                    "userConsentDisplayName": "Write API Data",
                    "isEnabled": True,
                    "type": "User",
                    "value": "Data.Write"
                }
            ]
        }
    }

    response = requests.post(
        f"{graph_url}/applications",
        headers=headers,
        json=api_app
    )

    return response.json()
```

## Resources

- [Microsoft Identity Platform Documentation](https://docs.microsoft.com/en-us/azure/active-directory/develop/)
- [MSAL Python](https://github.com/AzureAD/microsoft-authentication-library-for-python)
- [MSAL.js](https://github.com/AzureAD/microsoft-authentication-library-for-js)
