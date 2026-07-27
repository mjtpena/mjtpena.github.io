---
title: "Enterprise Agent Patterns: Security, Governance, and Scale"
author: Michael John Peña
draft: false
date: 2024-11-13
tags:
  - Azure
  - AI
  - AI Agents
  - Enterprise
  - Security

---

I wrote "Enterprise Agent Patterns: Security, Governance, and Scale" to share practical, production-minded guidance on this topic.

## Security Patterns

### Pattern 1: Principle of Least Privilege

```python
from azure.ai.foundry.agents import Agent, PermissionScope

class SecureAgent:
    """Agent with explicit permission boundaries."""

    def __init__(self, user_context: dict):
        self.user_context = user_context
        self.permissions = self.load_permissions(user_context)

    def load_permissions(self, context: dict) -> PermissionScope:
        """Load permissions based on user role."""

        role_permissions = {
            "analyst": PermissionScope(
                data_access=["read"],
                tables=["sales.*", "customers.*"],
                row_filters={"region": context.get("region")}
            ),
            "manager": PermissionScope(
                data_access=["read", "write"],
                tables=["sales.*", "customers.*", "targets.*"],
                row_filters=None  # Full access
            ),
            "admin": PermissionScope(
                data_access=["read", "write", "delete"],
                tables=["*"],
                row_filters=None
            )
        }

        return role_permissions.get(
            context.get("role", "analyst"),
            role_permissions["analyst"]
        )

    async def execute_query(self, query: str) -> dict:
        """Execute query with permission enforcement."""

        # Validate query against permissions
        validator = QueryValidator(self.permissions)
        validation = validator.validate(query)

        if not validation.allowed:
            return {
                "error": f"Permission denied: {validation.reason}",
                "required_permission": validation.required_permission
            }

        # Apply row-level security
        if self.permissions.row_filters:
            query = self.apply_row_filters(query, self.permissions.row_filters)

        return await self.database.execute(query)

    def apply_row_filters(self, query: str, filters: dict) -> str:
        """Inject row-level security filters."""
        where_clause = " AND ".join([
            f"{col} = '{val}'" for col, val in filters.items()
        ])

        if "WHERE" in query.upper():
            return query.replace("WHERE", f"WHERE {where_clause} AND")
        else:
            return f"{query} WHERE {where_clause}"
```

### Pattern 2: Audit Logging

```python
from azure.ai.foundry.monitoring import AuditLogger
from dataclasses import dataclass
from datetime import datetime
import json

@dataclass
class AuditEvent:
    timestamp: datetime
    user_id: str
    agent_name: str
    action: str
    input_summary: str
    output_summary: str
    tools_used: list
    data_accessed: list
    sensitive_data_flag: bool
    duration_ms: int
    status: str

class AuditedAgent:
    """Agent with comprehensive audit logging."""

    def __init__(self, agent: Agent, logger: AuditLogger):
        self.agent = agent
        self.logger = logger
        self.sensitive_patterns = [
            r'\b\d{3}-\d{2}-\d{4}\b',  # SSN
            r'\b\d{16}\b',              # Credit card
            r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b'  # Email
        ]

    async def run(self, user_id: str, message: str) -> str:
        start_time = datetime.utcnow()

        try:
            result = await self.agent.run(message)
            status = "success"
        except Exception as e:
            result = str(e)
            status = "error"

        duration = (datetime.utcnow() - start_time).total_seconds() * 1000

        # Create audit event
        event = AuditEvent(
            timestamp=start_time,
            user_id=user_id,
            agent_name=self.agent.name,
            action="agent_execution",
            input_summary=self.summarize(message),
            output_summary=self.summarize(result.output if hasattr(result, 'output') else str(result)),
            tools_used=self.extract_tools_used(result),
            data_accessed=self.extract_data_accessed(result),
            sensitive_data_flag=self.contains_sensitive_data(message + str(result)),
            duration_ms=int(duration),
            status=status
        )

        await self.logger.log(event)

        return result

    def contains_sensitive_data(self, text: str) -> bool:
        import re
        for pattern in self.sensitive_patterns:
            if re.search(pattern, text):
                return True
        return False

    def summarize(self, text: str, max_length: int = 500) -> str:
        """Summarize text for logging without sensitive data."""
        text = self.redact_sensitive(text)
        if len(text) > max_length:
            return text[:max_length] + "..."
        return text

    def redact_sensitive(self, text: str) -> str:
        import re
        for pattern in self.sensitive_patterns:
            text = re.sub(pattern, "[REDACTED]", text)
        return text
```

### Pattern 3: Input Validation and Sanitization

```python
from azure.ai.foundry.security import InputValidator, ContentFilter

class ValidatedAgent:
    """Agent with input validation and content filtering."""

    def __init__(self, agent: Agent):
        self.agent = agent
        self.validator = InputValidator()
        self.content_filter = ContentFilter()

    async def run(self, message: str) -> str:
        # Step 1: Validate input
        validation = self.validator.validate(message)
        if not validation.valid:
            return f"Invalid input: {validation.errors}"

        # Step 2: Check for injection attempts
        injection_check = self.check_injection(message)
        if injection_check.detected:
            await self.alert_security(message, injection_check)
            return "Request blocked for security review."

        # Step 3: Content filter
        filter_result = await self.content_filter.check(message)
        if filter_result.blocked:
            return f"Content policy violation: {filter_result.category}"

        # Step 4: Execute with sanitized input
        sanitized = self.sanitize(message)
        result = await self.agent.run(sanitized)

        # Step 5: Filter output
        output_check = await self.content_filter.check(result.output)
        if output_check.blocked:
            return "Response filtered due to content policy."

        return result

    def check_injection(self, message: str) -> dict:
        """Check for prompt injection attempts."""
        injection_patterns = [
            "ignore previous instructions",
            "disregard your instructions",
            "you are now",
            "new persona",
            "system prompt:",
            "```system"
        ]

        for pattern in injection_patterns:
            if pattern.lower() in message.lower():
                return {"detected": True, "pattern": pattern}

        return {"detected": False}

    def sanitize(self, message: str) -> str:
        """Sanitize input for safe processing."""
        # Remove potential control characters
        import re
        sanitized = re.sub(r'[\x00-\x1f\x7f-\x9f]', '', message)
        return sanitized
```

## Governance Patterns

### Pattern 4: Policy Enforcement

```python
from azure.ai.foundry.governance import PolicyEngine, Policy

class GovernedAgent:
    """Agent with policy enforcement."""

    def __init__(self, agent: Agent, policies: list[Policy]):
        self.agent = agent
        self.policy_engine = PolicyEngine(policies)

    async def run(self, context: dict, message: str) -> str:
        # Pre-execution policy check
        pre_check = await self.policy_engine.check_pre_execution(
            context=context,
            message=message
        )

        if not pre_check.allowed:
            return self.format_policy_denial(pre_check)

        # Execute agent
        result = await self.agent.run(message)

        # Post-execution policy check
        post_check = await self.policy_engine.check_post_execution(
            context=context,
            message=message,
            result=result
        )

        if not post_check.allowed:
            # Log but don't return result
            await self.log_policy_violation(post_check, result)
            return self.format_policy_denial(post_check)

        return result

# Define policies
policies = [
    Policy(
        name="data_export_limit",
        description="Limit data export volume",
        condition="result.row_count > 10000",
        action="deny",
        message="Cannot export more than 10,000 rows. Please add filters."
    ),
    Policy(
        name="pii_detection",
        description="Block PII in responses",
        condition="contains_pii(result.output)",
        action="deny",
        message="Response contains PII and cannot be returned."
    ),
    Policy(
        name="business_hours",
        description="Restrict write operations outside business hours",
        condition="not is_business_hours() and action.type == 'write'",
        action="deny",
        message="Write operations restricted to business hours."
    )
]

agent = GovernedAgent(base_agent, policies)
```

### Pattern 5: Approval Workflows

```python
from azure.ai.foundry.workflows import ApprovalWorkflow

class ApprovalRequiredAgent:
    """Agent that requires approval for certain actions."""

    approval_required_actions = [
        "delete_data",
        "export_large_dataset",
        "modify_schema",
        "grant_permissions"
    ]

    def __init__(self, agent: Agent, workflow: ApprovalWorkflow):
        self.agent = agent
        self.workflow = workflow

    async def run(self, user_id: str, message: str) -> str:
        # Analyze intent
        intent = await self.analyze_intent(message)

        if intent.action in self.approval_required_actions:
            # Create approval request
            request = await self.workflow.create_request(
                requester=user_id,
                action=intent.action,
                details=message,
                approvers=self.get_approvers(user_id, intent.action)
            )

            return f"""This action requires approval.

Request ID: {request.id}
Status: Pending
Approvers: {', '.join(request.approvers)}

You will be notified when approved."""

        # Direct execution for allowed actions
        return await self.agent.run(message)

    def get_approvers(self, user_id: str, action: str) -> list:
        """Get approvers based on action type."""
        approver_map = {
            "delete_data": ["data_owner", "security_team"],
            "export_large_dataset": ["manager"],
            "modify_schema": ["architect", "data_owner"],
            "grant_permissions": ["security_team"]
        }
        return approver_map.get(action, ["manager"])
```

## Scale Patterns

### Pattern 6: Request Queuing and Rate Limiting

```python
from azure.ai.foundry.scaling import RequestQueue, RateLimiter
import asyncio

class ScalableAgent:
    """Agent with queuing and rate limiting."""

    def __init__(
        self,
        agent: Agent,
        max_concurrent: int = 10,
        requests_per_minute: int = 100
    ):
        self.agent = agent
        self.semaphore = asyncio.Semaphore(max_concurrent)
        self.rate_limiter = RateLimiter(requests_per_minute)
        self.queue = RequestQueue()

    async def run(self, request_id: str, message: str) -> str:
        # Add to queue
        await self.queue.enqueue(request_id, message)

        # Wait for rate limit
        await self.rate_limiter.acquire()

        # Wait for concurrency slot
        async with self.semaphore:
            try:
                result = await self.agent.run(message)
                await self.queue.complete(request_id, result)
                return result
            except Exception as e:
                await self.queue.fail(request_id, str(e))
                raise

    async def get_queue_status(self) -> dict:
        return {
            "pending": await self.queue.pending_count(),
            "processing": self.semaphore._value,
            "rate_limit_remaining": self.rate_limiter.remaining()
        }
```

Enterprise agents require these patterns to ensure security, compliance, and reliable operation at scale. Implement them from the start rather than retrofitting later.

## Resources

- [Enterprise AI Security](https://learn.microsoft.com/en-us/azure/ai-foundry/security/)
- [AI Governance Framework](https://learn.microsoft.com/en-us/azure/ai-foundry/governance/)
- [Scaling AI Applications](https://learn.microsoft.com/en-us/azure/ai-foundry/scaling/)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
