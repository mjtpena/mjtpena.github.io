---
title: "OAuth 2.0 Flows with Azure AD: Choosing the Right Flow"
author: Michael John Peña
draft: false
date: 2021-05-25
tags:
  - Azure
  - Identity
  - OAuth
  - Security
  - Authentication

---

I wrote "OAuth 2.0 Flows with Azure AD: Choosing the Right Flow" to share practical, production-minded guidance on this topic.

## Flow Overview

| Flow | Use Case | User Interaction |
|------|----------|------------------|
| Authorization Code | Web apps, mobile | Yes |
| Authorization Code + PKCE | SPAs, mobile, desktop | Yes |
| Client Credentials | Daemon/service apps | No |
| On-Behalf-Of | API calling API | No (uses existing token) |
| Device Code | CLI, IoT, TV apps | Yes (on another device) |

## Authorization Code Flow

Best for server-side web applications:

```
User                    App                     Azure AD
  |                      |                         |
  |---(1) Click Login--->|                         |
  |                      |---(2) Redirect--------->|
  |<---------------------------------(3) Login-----|
  |---(4) Credentials---------------------------->|
  |<------------------------(5) Redirect+Code-----|
  |                      |<---(6) Code-------------|
  |                      |---(7) Exchange Code---->|
  |                      |<---(8) Tokens-----------|
  |<---(9) Logged In-----|                         |
```

```python
from flask import Flask, redirect, request, session
import requests
import secrets

app = Flask(__name__)
app.secret_key = secrets.token_hex(32)

CLIENT_ID = "your-client-id"
CLIENT_SECRET = "your-client-secret"
TENANT_ID = "your-tenant-id"
REDIRECT_URI = "https://yourapp.com/callback"
SCOPES = "openid profile email User.Read"

AUTHORIZE_URL = f"https://login.microsoftonline.com/{TENANT_ID}/oauth2/v2.0/authorize"
TOKEN_URL = f"https://login.microsoftonline.com/{TENANT_ID}/oauth2/v2.0/token"

@app.route("/login")
def login():
    # Generate state for CSRF protection
    state = secrets.token_urlsafe(32)
    session["oauth_state"] = state

    # Build authorization URL
    params = {
        "client_id": CLIENT_ID,
        "response_type": "code",
        "redirect_uri": REDIRECT_URI,
        "scope": SCOPES,
        "state": state,
        "response_mode": "query"
    }

    auth_url = f"{AUTHORIZE_URL}?{'&'.join(f'{k}={v}' for k, v in params.items())}"
    return redirect(auth_url)

@app.route("/callback")
def callback():
    # Verify state
    if request.args.get("state") != session.get("oauth_state"):
        return "State mismatch - possible CSRF attack", 400

    # Check for errors
    if "error" in request.args:
        return f"Error: {request.args.get('error_description')}", 400

    # Exchange code for tokens
    code = request.args.get("code")
    token_response = requests.post(TOKEN_URL, data={
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET,
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": REDIRECT_URI,
        "scope": SCOPES
    })

    tokens = token_response.json()

    if "access_token" in tokens:
        session["access_token"] = tokens["access_token"]
        session["refresh_token"] = tokens.get("refresh_token")
        return redirect("/profile")

    return f"Token exchange failed: {tokens.get('error_description')}", 400
```

## Authorization Code with PKCE

Required for SPAs and recommended for mobile/desktop:

```javascript
// JavaScript SPA implementation
class PKCEAuth {
    constructor(clientId, tenantId, redirectUri) {
        this.clientId = clientId;
        this.tenantId = tenantId;
        this.redirectUri = redirectUri;
        this.authorizeUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize`;
        this.tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
    }

    // Generate code verifier and challenge
    async generatePKCE() {
        const verifier = this.generateRandomString(128);
        const challenge = await this.sha256(verifier);

        return {
            verifier,
            challenge: this.base64UrlEncode(challenge)
        };
    }

    generateRandomString(length) {
        const array = new Uint8Array(length);
        crypto.getRandomValues(array);
        return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
    }

    async sha256(plain) {
        const encoder = new TextEncoder();
        const data = encoder.encode(plain);
        return await crypto.subtle.digest('SHA-256', data);
    }

    base64UrlEncode(buffer) {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        bytes.forEach(b => binary += String.fromCharCode(b));
        return btoa(binary)
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');
    }

    async login(scopes) {
        const pkce = await this.generatePKCE();
        const state = this.generateRandomString(32);

        // Store for later verification
        sessionStorage.setItem('pkce_verifier', pkce.verifier);
        sessionStorage.setItem('oauth_state', state);

        const params = new URLSearchParams({
            client_id: this.clientId,
            response_type: 'code',
            redirect_uri: this.redirectUri,
            scope: scopes.join(' '),
            state: state,
            code_challenge: pkce.challenge,
            code_challenge_method: 'S256',
            response_mode: 'query'
        });

        window.location.href = `${this.authorizeUrl}?${params}`;
    }

    async handleCallback() {
        const params = new URLSearchParams(window.location.search);

        // Verify state
        if (params.get('state') !== sessionStorage.getItem('oauth_state')) {
            throw new Error('State mismatch');
        }

        const code = params.get('code');
        const verifier = sessionStorage.getItem('pkce_verifier');

        // Exchange code for tokens
        const response = await fetch(this.tokenUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
                client_id: this.clientId,
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: this.redirectUri,
                code_verifier: verifier
            })
        });

        const tokens = await response.json();

        // Clean up
        sessionStorage.removeItem('pkce_verifier');
        sessionStorage.removeItem('oauth_state');

        return tokens;
    }
}

// Usage
const auth = new PKCEAuth('client-id', 'tenant-id', 'http://localhost:3000/callback');

document.getElementById('login-btn').onclick = () => {
    auth.login(['openid', 'profile', 'User.Read']);
};

// On callback page
if (window.location.search.includes('code=')) {
    auth.handleCallback().then(tokens => {
        console.log('Logged in:', tokens);
    });
}
```

## Client Credentials Flow

For daemon applications with no user:

```python
import requests

def get_client_credentials_token(client_id, client_secret, tenant_id, scope):
    """Acquire token using client credentials"""

    token_url = f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token"

    response = requests.post(token_url, data={
        "client_id": client_id,
        "client_secret": client_secret,
        "grant_type": "client_credentials",
        "scope": scope
    })

    return response.json()

# For certificate-based authentication
import jwt
import time
from cryptography.hazmat.primitives import serialization
from cryptography import x509

def get_token_with_certificate(client_id, tenant_id, cert_path, private_key_path, scope):
    """Acquire token using certificate assertion"""

    # Load certificate and key
    with open(cert_path, 'rb') as f:
        cert = x509.load_pem_x509_certificate(f.read())

    with open(private_key_path, 'rb') as f:
        private_key = serialization.load_pem_private_key(f.read(), password=None)

    # Calculate certificate thumbprint
    thumbprint = cert.fingerprint(hashes.SHA1()).hex()

    # Create JWT assertion
    now = int(time.time())
    claims = {
        "aud": f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token",
        "iss": client_id,
        "sub": client_id,
        "jti": str(uuid.uuid4()),
        "iat": now,
        "exp": now + 600
    }

    assertion = jwt.encode(
        claims,
        private_key,
        algorithm="RS256",
        headers={"x5t": base64.urlsafe_b64encode(bytes.fromhex(thumbprint)).decode().rstrip('=')}
    )

    # Exchange for token
    response = requests.post(
        f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token",
        data={
            "client_id": client_id,
            "client_assertion_type": "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
            "client_assertion": assertion,
            "grant_type": "client_credentials",
            "scope": scope
        }
    )

    return response.json()
```

## Device Code Flow

For devices without browsers:

```python
import requests
import time

def device_code_flow(client_id, tenant_id, scopes):
    """Device code flow for CLI/IoT applications"""

    device_code_url = f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/devicecode"
    token_url = f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token"

    # Step 1: Get device code
    response = requests.post(device_code_url, data={
        "client_id": client_id,
        "scope": " ".join(scopes)
    })

    device_code_response = response.json()

    print(f"To sign in, open: {device_code_response['verification_uri']}")
    print(f"Enter code: {device_code_response['user_code']}")

    # Step 2: Poll for token
    interval = device_code_response.get('interval', 5)
    device_code = device_code_response['device_code']
    expires_in = device_code_response['expires_in']
    start_time = time.time()

    while time.time() - start_time < expires_in:
        time.sleep(interval)

        token_response = requests.post(token_url, data={
            "client_id": client_id,
            "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
            "device_code": device_code
        })

        result = token_response.json()

        if "access_token" in result:
            print("Successfully authenticated!")
            return result

        error = result.get("error")
        if error == "authorization_pending":
            continue
        elif error == "slow_down":
            interval += 5
        elif error == "authorization_declined":
            raise Exception("User declined authorization")
        elif error == "expired_token":
            raise Exception("Device code expired")
        else:
            raise Exception(f"Error: {result.get('error_description')}")

    raise Exception("Timeout waiting for authentication")

# Usage
tokens = device_code_flow(
    "client-id",
    "tenant-id",
    ["openid", "profile", "User.Read"]
)
```

## On-Behalf-Of Flow

For middle-tier APIs:

```python
def on_behalf_of_flow(client_id, client_secret, tenant_id, user_token, scopes):
    """Exchange user token for downstream API token"""

    token_url = f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token"

    response = requests.post(token_url, data={
        "client_id": client_id,
        "client_secret": client_secret,
        "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
        "assertion": user_token,
        "requested_token_use": "on_behalf_of",
        "scope": " ".join(scopes)
    })

    return response.json()
```

## Choosing the Right Flow

| Scenario | Recommended Flow |
|----------|------------------|
| Server-side web app | Authorization Code |
| Single-page app (SPA) | Authorization Code + PKCE |
| Mobile app | Authorization Code + PKCE |
| Desktop app | Authorization Code + PKCE |
| CLI tool | Device Code |
| Background service | Client Credentials |
| API calling another API | On-Behalf-Of |
| IoT device | Device Code or Client Credentials |

## Resources

- [OAuth 2.0 Flows](https://docs.microsoft.com/en-us/azure/active-directory/develop/v2-oauth2-auth-code-flow)
- [PKCE RFC 7636](https://tools.ietf.org/html/rfc7636)
- [Device Code Flow](https://docs.microsoft.com/en-us/azure/active-directory/develop/v2-oauth2-device-code)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
