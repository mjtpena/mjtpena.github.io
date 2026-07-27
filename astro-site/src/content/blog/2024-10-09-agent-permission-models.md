---
title: "Permission Models for AI Agents: Fine-Grained Access Control"
author: "Michael John Peña"
draft: false
date: 2024-10-09
tags: ["Permissions", "AI Agents", "Access Control", "Security", "RBAC"]

---

I wrote "Permission Models for AI Agents: Fine-Grained Access Control" to share practical, production-minded guidance on this topic.

## Role-Based Access Control

```python
from dataclasses import dataclass, field
from typing import Set, Dict, List, Optional
from enum import Enum, auto

class Permission(Enum):
    # File operations
    FILE_READ = auto()
    FILE_WRITE = auto()
    FILE_DELETE = auto()
    FILE_EXECUTE = auto()

    # Network operations
    NETWORK_HTTP_GET = auto()
    NETWORK_HTTP_POST = auto()
    NETWORK_WEBSOCKET = auto()

    # System operations
    SYSTEM_PROCESS_SPAWN = auto()
    SYSTEM_ENV_READ = auto()
    SYSTEM_ENV_WRITE = auto()

    # Data operations
    DATA_READ = auto()
    DATA_WRITE = auto()
    DATA_DELETE = auto()

    # API operations
    API_CALL_EXTERNAL = auto()
    API_CALL_INTERNAL = auto()

    # Agent operations
    AGENT_SPAWN_CHILD = auto()
    AGENT_MODIFY_SELF = auto()

@dataclass
class Role:
    """A role with associated permissions"""
    name: str
    permissions: Set[Permission]
    description: str = ""

# Predefined roles
ROLES = {
    "reader": Role(
        name="reader",
        permissions={Permission.FILE_READ, Permission.DATA_READ},
        description="Can only read data"
    ),
    "writer": Role(
        name="writer",
        permissions={
            Permission.FILE_READ, Permission.FILE_WRITE,
            Permission.DATA_READ, Permission.DATA_WRITE
        },
        description="Can read and write data"
    ),
    "executor": Role(
        name="executor",
        permissions={
            Permission.FILE_READ, Permission.FILE_WRITE, Permission.FILE_EXECUTE,
            Permission.SYSTEM_PROCESS_SPAWN,
            Permission.DATA_READ, Permission.DATA_WRITE
        },
        description="Can execute code and processes"
    ),
    "network_agent": Role(
        name="network_agent",
        permissions={
            Permission.NETWORK_HTTP_GET, Permission.NETWORK_HTTP_POST,
            Permission.API_CALL_EXTERNAL,
            Permission.DATA_READ, Permission.DATA_WRITE
        },
        description="Can make network requests"
    ),
    "admin": Role(
        name="admin",
        permissions=set(Permission),  # All permissions
        description="Full access"
    )
}

class RBACManager:
    """Role-Based Access Control manager"""

    def __init__(self):
        self.agent_roles: Dict[str, Set[str]] = {}
        self.custom_permissions: Dict[str, Set[Permission]] = {}

    def assign_role(self, agent_id: str, role_name: str):
        """Assign a role to an agent"""
        if role_name not in ROLES:
            raise ValueError(f"Unknown role: {role_name}")

        if agent_id not in self.agent_roles:
            self.agent_roles[agent_id] = set()

        self.agent_roles[agent_id].add(role_name)

    def revoke_role(self, agent_id: str, role_name: str):
        """Revoke a role from an agent"""
        if agent_id in self.agent_roles:
            self.agent_roles[agent_id].discard(role_name)

    def add_permission(self, agent_id: str, permission: Permission):
        """Add a specific permission to an agent"""
        if agent_id not in self.custom_permissions:
            self.custom_permissions[agent_id] = set()
        self.custom_permissions[agent_id].add(permission)

    def get_permissions(self, agent_id: str) -> Set[Permission]:
        """Get all permissions for an agent"""
        permissions = set()

        # Add role permissions
        for role_name in self.agent_roles.get(agent_id, set()):
            if role_name in ROLES:
                permissions.update(ROLES[role_name].permissions)

        # Add custom permissions
        permissions.update(self.custom_permissions.get(agent_id, set()))

        return permissions

    def has_permission(self, agent_id: str, permission: Permission) -> bool:
        """Check if agent has a specific permission"""
        return permission in self.get_permissions(agent_id)

    def check_permissions(self, agent_id: str,
                         required: Set[Permission]) -> tuple[bool, Set[Permission]]:
        """Check multiple permissions, return missing ones"""
        current = self.get_permissions(agent_id)
        missing = required - current
        return len(missing) == 0, missing
```

## Capability-Based Access

```python
from dataclasses import dataclass
from typing import Callable, Any
import secrets
import time

@dataclass
class Capability:
    """A capability token granting specific access"""
    id: str
    permission: Permission
    scope: str  # Resource or path this applies to
    granted_to: str
    granted_at: float
    expires_at: Optional[float] = None
    revoked: bool = False
    max_uses: Optional[int] = None
    use_count: int = 0

class CapabilityManager:
    """Manage capability-based access"""

    def __init__(self):
        self.capabilities: Dict[str, Capability] = {}

    def grant(self, agent_id: str, permission: Permission,
              scope: str, expires_in_seconds: int = None,
              max_uses: int = None) -> str:
        """Grant a capability to an agent"""

        cap_id = secrets.token_urlsafe(32)
        now = time.time()

        capability = Capability(
            id=cap_id,
            permission=permission,
            scope=scope,
            granted_to=agent_id,
            granted_at=now,
            expires_at=now + expires_in_seconds if expires_in_seconds else None,
            max_uses=max_uses
        )

        self.capabilities[cap_id] = capability
        return cap_id

    def verify(self, cap_id: str, agent_id: str,
               permission: Permission, scope: str) -> bool:
        """Verify a capability is valid"""

        if cap_id not in self.capabilities:
            return False

        cap = self.capabilities[cap_id]

        # Check revocation
        if cap.revoked:
            return False

        # Check ownership
        if cap.granted_to != agent_id:
            return False

        # Check permission
        if cap.permission != permission:
            return False

        # Check scope
        if not self._scope_matches(cap.scope, scope):
            return False

        # Check expiration
        if cap.expires_at and time.time() > cap.expires_at:
            return False

        # Check use count
        if cap.max_uses and cap.use_count >= cap.max_uses:
            return False

        return True

    def use(self, cap_id: str) -> bool:
        """Record a capability use"""
        if cap_id in self.capabilities:
            self.capabilities[cap_id].use_count += 1
            return True
        return False

    def revoke(self, cap_id: str) -> bool:
        """Revoke a capability"""
        if cap_id in self.capabilities:
            self.capabilities[cap_id].revoked = True
            return True
        return False

    def revoke_all_for_agent(self, agent_id: str):
        """Revoke all capabilities for an agent"""
        for cap in self.capabilities.values():
            if cap.granted_to == agent_id:
                cap.revoked = True

    def _scope_matches(self, cap_scope: str, request_scope: str) -> bool:
        """Check if capability scope covers requested scope"""
        # Wildcard support
        if cap_scope == "*":
            return True

        # Exact match
        if cap_scope == request_scope:
            return True

        # Path prefix match
        if cap_scope.endswith("/*"):
            prefix = cap_scope[:-2]
            return request_scope.startswith(prefix)

        return False
```

## Attribute-Based Access Control

```python
@dataclass
class AgentAttributes:
    """Attributes describing an agent"""
    agent_id: str
    trust_level: int  # 0-100
    created_at: float
    owner: str
    environment: str  # production, staging, development
    capabilities: Set[str]
    labels: Dict[str, str]

@dataclass
class ResourceAttributes:
    """Attributes describing a resource"""
    resource_id: str
    resource_type: str
    sensitivity: str  # public, internal, confidential, secret
    owner: str
    environment: str
    labels: Dict[str, str]

class Policy:
    """Access control policy"""

    def __init__(self, name: str):
        self.name = name
        self.conditions: List[Callable[[AgentAttributes, ResourceAttributes], bool]] = []

    def add_condition(self, condition: Callable[[AgentAttributes, ResourceAttributes], bool]):
        """Add a condition to the policy"""
        self.conditions.append(condition)
        return self

    def evaluate(self, agent: AgentAttributes, resource: ResourceAttributes) -> bool:
        """Evaluate all conditions"""
        return all(cond(agent, resource) for cond in self.conditions)

class ABACManager:
    """Attribute-Based Access Control manager"""

    def __init__(self):
        self.policies: Dict[str, Policy] = {}
        self.default_deny = True

    def register_policy(self, policy: Policy):
        """Register an access policy"""
        self.policies[policy.name] = policy

    def check_access(self, agent: AgentAttributes,
                    resource: ResourceAttributes,
                    action: str) -> bool:
        """Check if agent can perform action on resource"""

        # Find applicable policies
        for policy in self.policies.values():
            if policy.evaluate(agent, resource):
                return True

        return not self.default_deny

# Example policies
def create_standard_policies() -> ABACManager:
    abac = ABACManager()

    # Policy: High trust agents can access internal resources
    internal_access = Policy("internal_access")
    internal_access.add_condition(
        lambda a, r: a.trust_level >= 50 and r.sensitivity in ["public", "internal"]
    )
    abac.register_policy(internal_access)

    # Policy: Same owner can access
    owner_access = Policy("owner_access")
    owner_access.add_condition(lambda a, r: a.owner == r.owner)
    abac.register_policy(owner_access)

    # Policy: Production agents can't access development resources
    env_separation = Policy("env_separation")
    env_separation.add_condition(
        lambda a, r: a.environment == r.environment or r.environment == "production"
    )
    abac.register_policy(env_separation)

    return abac
```

## Permission Enforcement

```python
from functools import wraps

class PermissionEnforcer:
    """Enforce permissions on agent actions"""

    def __init__(self, rbac: RBACManager, capability_mgr: CapabilityManager):
        self.rbac = rbac
        self.capability_mgr = capability_mgr

    def require_permission(self, permission: Permission, scope: str = "*"):
        """Decorator to require permission for a function"""

        def decorator(func):
            @wraps(func)
            def wrapper(agent_id: str, *args, **kwargs):
                # Check RBAC
                if self.rbac.has_permission(agent_id, permission):
                    return func(agent_id, *args, **kwargs)

                # Check capability
                cap_id = kwargs.get("capability_id")
                if cap_id and self.capability_mgr.verify(cap_id, agent_id, permission, scope):
                    self.capability_mgr.use(cap_id)
                    return func(agent_id, *args, **kwargs)

                raise PermissionDenied(
                    f"Agent {agent_id} lacks permission {permission.name} for scope {scope}"
                )

            return wrapper
        return decorator

class PermissionDenied(Exception):
    pass

# Usage example
enforcer = PermissionEnforcer(rbac_manager, capability_manager)

@enforcer.require_permission(Permission.FILE_WRITE, scope="/data/*")
def write_data(agent_id: str, path: str, content: str, capability_id: str = None):
    """Write data to path"""
    # Implementation here
    pass
```

Permission models for AI agents must be flexible yet secure. Combine RBAC for broad access patterns with capabilities for fine-grained, time-limited access.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
