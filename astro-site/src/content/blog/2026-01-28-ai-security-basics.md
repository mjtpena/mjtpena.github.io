---
title: "AI Security: The Basics Everyone Misses"
author: Michael John Peña
draft: false
date: 2026-01-28
tags:
  - AI
  - Security
  - Best-Practices
  - Azure

---

I wrote "AI Security: The Basics Everyone Misses" to share practical, production-minded guidance on this topic.

## The Forgotten Fundamentals

### 1. Input Validation

Before the AI even sees input:

```python
def validate_input(user_input: str) -> bool:
    # Length check
    if len(user_input) > 4000:
        return False
    
    # Rate limiting
    if exceeded_rate_limit(user_id):
        return False
    
    # Basic content filtering
    if contains_prohibited_content(user_input):
        return False
    
    return True
```

Most prompt injection attempts never get to your prompt if you filter input properly.

### 2. Output Validation

Check what AI generates before showing users:

```python
def validate_output(ai_response: str) -> bool:
    # PII detection
    if contains_pii(ai_response):
        return False
    
    # Code execution attempts
    if contains_code_execution(ai_response):
        return False
    
    # Malicious links
    if contains_suspicious_urls(ai_response):
        return False
    
    return True
```

### 3. API Key Management

Never, ever hardcode API keys:

```python
# NO
api_key = "sk-..." 

# YES
api_key = os.getenv("AZURE_OPENAI_KEY")

# BETTER
from azure.identity import DefaultAzureCredential
credential = DefaultAzureCredential()
```

Use managed identities. Always.

### 4. Logging and Monitoring

Log everything, but redact PII:

```python
def log_interaction(user_input: str, ai_output: str):
    logger.info({
        "user_input": redact_pii(user_input),
        "ai_output": redact_pii(ai_output),
        "timestamp": datetime.utcnow(),
        "user_id": get_user_id(),
        "model": "gpt-4o",
        "cost": calculate_cost(...)
    })
```

You'll need these logs when something goes wrong.

### 5. Cost Controls

Set budget limits:

```python
async def call_ai_with_budget(prompt: str):
    daily_spend = await get_today_spend()
    
    if daily_spend > DAILY_BUDGET:
        raise BudgetExceededError()
    
    return await ai_client.complete(prompt)
```

One misconfigured bot can cost thousands.

## The Actual Threat Model

**Prompt injection?** Possible, but rare in practice.

**API key leaks?** Common. Costs real money.

**Data exfiltration?** Happens. Users paste sensitive data.

**Excessive costs?** Very common. Bots hammering your API.

**Toxic output?** Will happen eventually. Filter it.

Focus on the common threats, not the theoretical ones.

## Minimum Security Checklist

- [ ] Input validation and sanitization
- [ ] Output content filtering
- [ ] API keys in env variables or managed identity
- [ ] Rate limiting per user
- [ ] Cost monitoring and alerting
- [ ] Comprehensive logging (with PII redaction)
- [ ] Regular security testing
- [ ] Incident response plan

## The Reality

Most AI security incidents aren't sophisticated attacks. They're:

- Leaked API keys on GitHub
- Bots running up costs
- Users pasting PII into prompts
- Missing rate limits

Fix the basics. They prevent 95% of actual problems.

Prompt injection defenses? Sure, add them. But only after you've handled the fundamentals.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
