---
title: "Implementing Zero-Trust Security for AI Applications"
description: "Zero-Trust security ensures AI applications remain protected while enabling legitimate business use cases."
author: Michael John Peña
draft: false
date: 2025-10-25
tags:
  - Security
  - Zero Trust
  - AI Applications
  - Azure Security
  - Identity
---

## Securing API Access with Managed Identity

Use managed identities to eliminate credential management:

```python
from azure.identity import DefaultAzureCredential, ManagedIdentityCredential
from azure.keyvault.secrets import SecretClient
from openai import AzureOpenAI
import os

class SecureAIClient:
    def __init__(self, use_managed_identity: bool = True):
        if use_managed_identity:
            self.credential = ManagedIdentityCredential()
        else:
            self.credential = DefaultAzureCredential()

        self.keyvault_url = os.environ["KEYVAULT_URL"]
        self.secret_client = SecretClient(
            vault_url=self.keyvault_url,
            credential=self.credential
        )

    def get_openai_client(self) -> AzureOpenAI:
        """Get Azure OpenAI client with credentials from Key Vault."""

        endpoint = self.secret_client.get_secret("openai-endpoint").value
        api_key = self.secret_client.get_secret("openai-api-key").value

        return AzureOpenAI(
            azure_endpoint=endpoint,
            api_key=api_key,
            api_version="2024-02-01"
        )
```

## Implementing Request Validation

Validate and sanitize all inputs:

```python
from pydantic import BaseModel, validator, Field
from typing import List, Optional
import re

class AIRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=10000)
    model: str = Field(default="gpt-4")
    temperature: float = Field(default=0.7, ge=0, le=2)
    max_tokens: int = Field(default=1000, ge=1, le=4000)
    user_id: str = Field(..., min_length=1)

    @validator('prompt')
    def sanitize_prompt(cls, v):
        # Remove potential injection patterns
        dangerous_patterns = [
            r'<script.*?>.*?</script>',
            r'javascript:',
            r'data:text/html'
        ]

        for pattern in dangerous_patterns:
            v = re.sub(pattern, '', v, flags=re.IGNORECASE)

        return v.strip()

    @validator('model')
    def validate_model(cls, v):
        allowed_models = ['gpt-4', 'gpt-4-turbo', 'gpt-3.5-turbo']
        if v not in allowed_models:
            raise ValueError(f"Model must be one of {allowed_models}")
        return v

class SecureRequestHandler:
    def __init__(self, ai_client: SecureAIClient):
        self.client = ai_client
        self.rate_limiter = {}

    def validate_and_process(self, request_data: dict, client_ip: str) -> dict:
        """Validate request and process if authorized."""

        # Validate request structure
        request = AIRequest(**request_data)

        # Check rate limits
        if not self._check_rate_limit(request.user_id, client_ip):
            raise Exception("Rate limit exceeded")

        # Process request
        openai_client = self.client.get_openai_client()
        response = openai_client.chat.completions.create(
            model=request.model,
            messages=[{"role": "user", "content": request.prompt}],
            temperature=request.temperature,
            max_tokens=request.max_tokens
        )

        return {"response": response.choices[0].message.content}

    def _check_rate_limit(self, user_id: str, client_ip: str) -> bool:
        # Implement rate limiting logic
        return True
```

## Audit Logging

Maintain comprehensive audit logs for compliance and security monitoring:

```python
import logging
from datetime import datetime

class AuditLogger:
    def __init__(self):
        self.logger = logging.getLogger("ai_audit")

    def log_request(self, user_id: str, action: str, details: dict):
        self.logger.info({
            "timestamp": datetime.utcnow().isoformat(),
            "user_id": user_id,
            "action": action,
            "details": details
        })
```

Zero-Trust security ensures AI applications remain protected while enabling legitimate business use cases.
