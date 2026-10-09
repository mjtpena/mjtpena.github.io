---
title: "Internal Developer Platforms: Scaling Developer Self-Service"
description: "IDPs in 2021 became the way to scale DevOps practices. They encode organizational knowledge into platforms that enable consistent, secure, and fast software…"
author: Michael John Pena
draft: false
date: 2021-12-30
tags:
  - Internal Developer Platform
  - Platform Engineering
  - Self-Service
  - Developer Experience
  - DevOps
---

## What Makes an IDP?

An Internal Developer Platform provides:
- **Self-service** infrastructure provisioning
- **Standardized** environments and deployments
- **Integrated** toolchain experience
- **Guardrails** for security and compliance
- **Visibility** into services and dependencies

## IDP Architecture

```python
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Dict, List, Optional
from enum import Enum

class ResourceState(Enum):
    PENDING = "pending"
    PROVISIONING = "provisioning"
    READY = "ready"
    FAILED = "failed"
    DELETING = "deleting"

@dataclass
class PlatformResource:
    id: str
    type: str
    name: str
    team: str
    environment: str
    state: ResourceState
    config: dict
    metadata: dict

class PlatformAPI:
    """Core IDP API"""

    def __init__(self):
        self.provisioners: Dict[str, ResourceProvisioner] = {}
        self.policies: List[Policy] = []
        self.catalog = ServiceCatalog()

    def register_provisioner(self, resource_type: str, provisioner: 'ResourceProvisioner'):
        """Register a resource provisioner"""
        self.provisioners[resource_type] = provisioner

    def register_policy(self, policy: 'Policy'):
        """Register a platform policy"""
        self.policies.append(policy)

    async def create_resource(
        self,
        resource_type: str,
        name: str,
        team: str,
        environment: str,
        config: dict,
        requester: str
    ) -> PlatformResource:
        """Create a platform resource"""

        # Validate against policies
        for policy in self.policies:
            result = await policy.evaluate({
                'resource_type': resource_type,
                'name': name,
                'team': team,
                'environment': environment,
                'config': config,
                'requester': requester
            })
            if not result.allowed:
                raise PolicyViolationError(result.reason)

        # Get provisioner
        provisioner = self.provisioners.get(resource_type)
        if not provisioner:
            raise ValueError(f"No provisioner for resource type: {resource_type}")

        # Create resource record
        resource = PlatformResource(
            id=generate_resource_id(),
            type=resource_type,
            name=name,
            team=team,
            environment=environment,
            state=ResourceState.PENDING,
            config=config,
            metadata={
                'created_by': requester,
                'created_at': datetime.utcnow().isoformat()
            }
        )

        # Start async provisioning
        await self._start_provisioning(resource, provisioner)

        return resource

    async def _start_provisioning(
        self,
        resource: PlatformResource,
        provisioner: 'ResourceProvisioner'
    ):
        """Start resource provisioning"""
        resource.state = ResourceState.PROVISIONING

        try:
            result = await provisioner.provision(resource)
            resource.state = ResourceState.READY
            resource.metadata['connection_info'] = result.connection_info
        except Exception as e:
            resource.state = ResourceState.FAILED
            resource.metadata['error'] = str(e)
            raise


class ResourceProvisioner(ABC):
    """Base class for resource provisioners"""

    @abstractmethod
    async def provision(self, resource: PlatformResource) -> 'ProvisionResult':
        pass

    @abstractmethod
    async def deprovision(self, resource: PlatformResource):
        pass

    @abstractmethod
    async def get_status(self, resource: PlatformResource) -> dict:
        pass


class Policy(ABC):
    """Base class for platform policies"""

    @abstractmethod
    async def evaluate(self, context: dict) -> 'PolicyResult':
        pass


@dataclass
class PolicyResult:
    allowed: bool
    reason: Optional[str] = None


# Example policies
class QuotaPolicy(Policy):
    """Enforce resource quotas per team"""

    def __init__(self, quotas: Dict[str, Dict[str, int]]):
        self.quotas = quotas

    async def evaluate(self, context: dict) -> PolicyResult:
        team = context['team']
        resource_type = context['resource_type']

        quota = self.quotas.get(team, {}).get(resource_type, float('inf'))
        current_count = await self._get_current_count(team, resource_type)

        if current_count >= quota:
            return PolicyResult(
                allowed=False,
                reason=f"Team {team} has reached quota for {resource_type}"
            )
        return PolicyResult(allowed=True)


class EnvironmentPolicy(Policy):
    """Enforce environment-specific rules"""

    async def evaluate(self, context: dict) -> PolicyResult:
        environment = context['environment']
        config = context['config']

        if environment == 'production':
            # Production must have HA enabled
            if not config.get('high_availability', False):
                return PolicyResult(
                    allowed=False,
                    reason="Production resources must have high_availability enabled"
                )

            # Production must have backups
            if not config.get('backup_enabled', True):
                return PolicyResult(
                    allowed=False,
                    reason="Production resources must have backups enabled"
                )

        return PolicyResult(allowed=True)
```

## Service Catalog Implementation

```python
@dataclass
class ServiceDefinition:
    name: str
    description: str
    type: str
    version: str
    owner_team: str
    tier: str  # 'standard', 'premium'
    configurations: List[dict]
    dependencies: List[str]
    documentation_url: str

class ServiceCatalog:
    """Service catalog for the IDP"""

    def __init__(self):
        self.services: Dict[str, ServiceDefinition] = {}
        self._initialize_standard_services()

    def _initialize_standard_services(self):
        """Initialize standard service offerings"""

        self.services['web-application'] = ServiceDefinition(
            name='Web Application',
            description='Standard web application with Kubernetes deployment',
            type='compute',
            version='1.0',
            owner_team='platform',
            tier='standard',
            configurations=[
                {
                    'name': 'replicas',
                    'type': 'integer',
                    'default': 2,
                    'min': 1,
                    'max': 10
                },
                {
                    'name': 'cpu',
                    'type': 'string',
                    'default': '500m',
                    'options': ['250m', '500m', '1000m', '2000m']
                },
                {
                    'name': 'memory',
                    'type': 'string',
                    'default': '512Mi',
                    'options': ['256Mi', '512Mi', '1Gi', '2Gi', '4Gi']
                }
            ],
            dependencies=[],
            documentation_url='https://docs.company.com/platform/web-app'
        )

        self.services['postgresql-database'] = ServiceDefinition(
            name='PostgreSQL Database',
            description='Managed PostgreSQL database with automatic backups',
            type='database',
            version='13',
            owner_team='platform',
            tier='standard',
            configurations=[
                {
                    'name': 'size',
                    'type': 'string',
                    'default': 'small',
                    'options': ['small', 'medium', 'large']
                },
                {
                    'name': 'high_availability',
                    'type': 'boolean',
                    'default': False
                },
                {
                    'name': 'backup_retention_days',
                    'type': 'integer',
                    'default': 7,
                    'min': 1,
                    'max': 35
                }
            ],
            dependencies=[],
            documentation_url='https://docs.company.com/platform/postgresql'
        )

        self.services['api-gateway'] = ServiceDefinition(
            name='API Gateway',
            description='Managed API gateway with rate limiting and authentication',
            type='networking',
            version='2.0',
            owner_team='platform',
            tier='standard',
            configurations=[
                {
                    'name': 'rate_limit',
                    'type': 'integer',
                    'default': 1000,
                    'description': 'Requests per minute'
                },
                {
                    'name': 'authentication',
                    'type': 'string',
                    'default': 'oauth2',
                    'options': ['none', 'api_key', 'oauth2', 'oidc']
                }
            ],
            dependencies=['web-application'],
            documentation_url='https://docs.company.com/platform/api-gateway'
        )

    def get_service(self, name: str) -> Optional[ServiceDefinition]:
        return self.services.get(name)

    def list_services(
        self,
        type_filter: str = None,
        tier_filter: str = None
    ) -> List[ServiceDefinition]:
        """List available services with optional filters"""
        services = list(self.services.values())

        if type_filter:
            services = [s for s in services if s.type == type_filter]
        if tier_filter:
            services = [s for s in services if s.tier == tier_filter]

        return services

    def validate_configuration(
        self,
        service_name: str,
        config: dict
    ) -> List[str]:
        """Validate configuration against service definition"""
        service = self.services.get(service_name)
        if not service:
            return [f"Unknown service: {service_name}"]

        errors = []
        for cfg_def in service.configurations:
            name = cfg_def['name']
            value = config.get(name, cfg_def.get('default'))

            if value is None and 'default' not in cfg_def:
                errors.append(f"Required configuration missing: {name}")
                continue

            if cfg_def['type'] == 'integer':
                if 'min' in cfg_def and value < cfg_def['min']:
                    errors.append(f"{name} must be >= {cfg_def['min']}")
                if 'max' in cfg_def and value > cfg_def['max']:
                    errors.append(f"{name} must be <= {cfg_def['max']}")

            if cfg_def['type'] == 'string' and 'options' in cfg_def:
                if value not in cfg_def['options']:
                    errors.append(f"{name} must be one of: {cfg_def['options']}")

        return errors
```

## Developer Portal UI

```typescript
// React component for service creation
import React, { useState, useEffect } from 'react';

interface ServiceConfig {
    name: string;
    type: string;
    default: any;
    options?: string[];
    min?: number;
    max?: number;
}

interface ServiceDefinition {
    name: string;
    description: string;
    configurations: ServiceConfig[];
    documentation_url: string;
}

const CreateServiceForm: React.FC<{ service: ServiceDefinition }> = ({ service }) => {
    const [config, setConfig] = useState<Record<string, any>>({});
    const [errors, setErrors] = useState<string[]>([]);
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        // Initialize with defaults
        const defaults: Record<string, any> = {};
        service.configurations.forEach(cfg => {
            defaults[cfg.name] = cfg.default;
        });
        setConfig(defaults);
    }, [service]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitting(true);

        try {
            const response = await fetch('/api/resources', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    service_type: service.name,
                    config: config
                })
            });

            if (!response.ok) {
                const data = await response.json();
                setErrors(data.errors || ['Failed to create resource']);
            } else {
                // Redirect to resource page
                const data = await response.json();
                window.location.href = `/resources/${data.id}`;
            }
        } catch (error) {
            setErrors(['Network error']);
        } finally {
            setSubmitting(false);
        }
    };

    const renderConfigField = (cfg: ServiceConfig) => {
        if (cfg.options) {
            return (
                <select
                    value={config[cfg.name]}
                    onChange={e => setConfig({...config, [cfg.name]: e.target.value})}
                >
                    {cfg.options.map(opt => (
                        <option key={opt} value={opt}>{opt}</option>
                    ))}
                </select>
            );
        }

        if (cfg.type === 'boolean') {
            return (
                <input
                    type="checkbox"
                    checked={config[cfg.name]}
                    onChange={e => setConfig({...config, [cfg.name]: e.target.checked})}
                />
            );
        }

        if (cfg.type === 'integer') {
            return (
                <input
                    type="number"
                    value={config[cfg.name]}
                    min={cfg.min}
                    max={cfg.max}
                    onChange={e => setConfig({...config, [cfg.name]: parseInt(e.target.value)})}
                />
            );
        }

        return (
            <input
                type="text"
                value={config[cfg.name]}
                onChange={e => setConfig({...config, [cfg.name]: e.target.value})}
            />
        );
    };

    return (
        <form onSubmit={handleSubmit}>
            <h2>Create {service.name}</h2>
            <p>{service.description}</p>

            {errors.length > 0 && (
                <div className="errors">
                    {errors.map((err, i) => <p key={i}>{err}</p>)}
                </div>
            )}

            {service.configurations.map(cfg => (
                <div key={cfg.name} className="form-field">
                    <label>{cfg.name}</label>
                    {renderConfigField(cfg)}
                </div>
            ))}

            <button type="submit" disabled={submitting}>
                {submitting ? 'Creating...' : 'Create'}
            </button>

            <a href={service.documentation_url} target="_blank">
                View Documentation
            </a>
        </form>
    );
};
```

## IDP Metrics and Success Criteria

```python
from prometheus_client import Counter, Histogram, Gauge

# Platform usage metrics
resource_creations = Counter(
    'idp_resource_creations_total',
    'Total resource creations',
    ['service_type', 'team', 'environment']
)

self_service_rate = Gauge(
    'idp_self_service_rate',
    'Percentage of resources created via self-service'
)

time_to_provision = Histogram(
    'idp_provision_time_seconds',
    'Time to provision resources',
    ['service_type'],
    buckets=[30, 60, 120, 300, 600, 1800]
)

# Developer satisfaction
platform_nps = Gauge(
    'idp_net_promoter_score',
    'Platform Net Promoter Score'
)

support_tickets = Counter(
    'idp_support_tickets_total',
    'Support tickets for platform issues',
    ['category']
)

class IDPMetrics:
    """Track IDP success metrics"""

    def get_platform_health(self) -> dict:
        """Get overall platform health metrics"""
        return {
            'self_service_rate': self._calculate_self_service_rate(),
            'average_provision_time': self._get_avg_provision_time(),
            'platform_availability': self._get_availability(),
            'active_resources': self._count_active_resources(),
            'developer_satisfaction': self._get_satisfaction_score()
        }

    def _calculate_self_service_rate(self) -> float:
        """Calculate % of resources created without support"""
        total = self.store.count_resources(days=30)
        self_service = self.store.count_resources(days=30, created_by='self-service')
        return (self_service / total * 100) if total > 0 else 0
```

## IDP Best Practices

1. **Start Small**: Begin with high-value, low-complexity services
2. **Listen to Developers**: Build what they need, not what you think they need
3. **Document Everything**: Self-service requires excellent documentation
4. **Iterate Quickly**: Treat the platform as a product with regular releases
5. **Measure Success**: Track adoption, satisfaction, and productivity

IDPs in 2021 became the way to scale DevOps practices. They encode organizational knowledge into platforms that enable consistent, secure, and fast software delivery.

## Resources

- [Humanitec](https://humanitec.com/)
- [Backstage](https://backstage.io/)
- [Port](https://www.getport.io/)
- [Internal Developer Platform](https://internaldeveloperplatform.org/)
