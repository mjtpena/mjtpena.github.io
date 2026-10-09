---
title: "Securing AI Applications: Authentication and Authorization Patterns"
description: "AI applications face unique security concerns: protecting training data, controlling model access, securing inference endpoints, and preventing prompt…"
author: Michael John Peña
draft: false
date: 2025-11-10
tags:
  - Security
  - Azure AD
  - Authentication
  - AI Applications
  - Best Practices
---

## Security Challenges for AI

AI applications face unique security concerns: protecting training data, controlling model access, securing inference endpoints, and preventing prompt injection. A defense-in-depth approach addresses each layer.

## Implementing Secure Authentication

Use Microsoft Entra ID (Azure AD) for enterprise-grade authentication:

```python
from fastapi import FastAPI, Depends, HTTPException, Security
from fastapi.security import OAuth2AuthorizationCodeBearer
from jose import jwt, JWTError
from pydantic import BaseModel
import httpx

app = FastAPI()

# Configure OAuth2 with Azure AD
oauth2_scheme = OAuth2AuthorizationCodeBearer(
    authorizationUrl=f"https://login.microsoftonline.com/{TENANT_ID}/oauth2/v2.0/authorize",
    tokenUrl=f"https://login.microsoftonline.com/{TENANT_ID}/oauth2/v2.0/token",
    scopes={"api://your-app-id/AI.Access": "Access AI endpoints"}
)

class TokenPayload(BaseModel):
    sub: str
    roles: list[str] = []
    groups: list[str] = []

async def get_current_user(token: str = Depends(oauth2_scheme)) -> TokenPayload:
    """Validate JWT token and extract user claims."""
    try:
        # Fetch Azure AD public keys
        async with httpx.AsyncClient() as client:
            jwks = await client.get(
                f"https://login.microsoftonline.com/{TENANT_ID}/discovery/v2.0/keys"
            )

        # Decode and validate token
        payload = jwt.decode(
            token,
            jwks.json(),
            algorithms=["RS256"],
            audience=f"api://{CLIENT_ID}",
            issuer=f"https://login.microsoftonline.com/{TENANT_ID}/v2.0"
        )

        return TokenPayload(
            sub=payload["sub"],
            roles=payload.get("roles", []),
            groups=payload.get("groups", [])
        )
    except JWTError as e:
        raise HTTPException(status_code=401, detail="Invalid token")

def require_role(required_role: str):
    """Dependency to enforce role-based access."""
    async def role_checker(user: TokenPayload = Depends(get_current_user)):
        if required_role not in user.roles:
            raise HTTPException(
                status_code=403,
                detail=f"Role '{required_role}' required"
            )
        return user
    return role_checker

@app.post("/api/chat")
async def chat_endpoint(
    request: ChatRequest,
    user: TokenPayload = Depends(get_current_user)
):
    """Standard AI chat endpoint - all authenticated users."""
    # Log access for audit trail
    audit_log.info(f"Chat access by user {user.sub}")
    return await process_chat(request, user)

@app.post("/api/admin/retrain")
async def retrain_model(
    user: TokenPayload = Security(require_role("AI.Admin"))
):
    """Admin-only endpoint for model retraining."""
    return await trigger_retraining()
```

## Row-Level Security for RAG

Ensure users only retrieve documents they're authorized to access:

```python
class SecureRAGService:
    def __init__(self, search_client, llm_client):
        self.search_client = search_client
        self.llm_client = llm_client

    async def query(self, question: str, user: TokenPayload) -> str:
        """Execute RAG query with user's permission scope."""

        # Build security filter based on user's groups
        security_filter = " or ".join([
            f"allowed_groups/any(g: g eq '{group}')"
            for group in user.groups
        ])

        # Add public documents
        security_filter = f"({security_filter}) or is_public eq true"

        # Search with security filter
        results = self.search_client.search(
            search_text=question,
            filter=security_filter,
            top=5
        )

        # User only sees documents they can access
        context = [doc["content"] for doc in results]

        return await self.llm_client.generate(question, context)
```

Security for AI applications must be designed in from the start. Retrofitting security after deployment is significantly more difficult and error-prone.
