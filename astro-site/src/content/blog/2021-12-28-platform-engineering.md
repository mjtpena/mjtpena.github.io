---
title: "Platform Engineering: Building the Foundation for Developer Productivity"
author: Michael John Pena
draft: false
date: 2021-12-28
tags:
  - Platform Engineering
  - DevOps
  - Developer Experience
  - Infrastructure
  - Cloud

---

I wrote "Platform Engineering: Building the Foundation for Developer Productivity" to share practical, production-minded guidance on this topic.

## What is Platform Engineering?

Platform engineering is about creating golden paths - paved roads that make it easy for developers to do the right thing. It's infrastructure as a product, with developers as customers.

## Building an Internal Developer Platform

```yaml
# Platform API definition
apiVersion: platform.company.com/v1
kind: Application
metadata:
  name: order-service
  team: commerce
spec:
  runtime: kubernetes
  replicas:
    min: 2
    max: 10
  resources:
    cpu: "500m"
    memory: "1Gi"
  scaling:
    metric: cpu
    target: 70
  networking:
    ingress: true
    domain: orders.company.com
  databases:
    - name: orders-db
      type: postgresql
      size: small
  caching:
    - name: orders-cache
      type: redis
      size: small
  monitoring:
    enabled: true
    alerts:
      - name: high-error-rate
        condition: error_rate > 1%
        severity: warning
      - name: service-down
        condition: availability < 99%
        severity: critical
  secrets:
    vault: commerce-vault
    keys:
      - DB_PASSWORD
      - API_KEY
```

## Platform Service Catalog

```python
from dataclasses import dataclass
from typing import Dict, List, Optional
from enum import Enum

class ServiceType(Enum):
    COMPUTE = "compute"
    DATABASE = "database"
    MESSAGING = "messaging"
    STORAGE = "storage"
    MONITORING = "monitoring"
    SECURITY = "security"

@dataclass
class ServiceOffering:
    name: str
    type: ServiceType
    description: str
    tiers: Dict[str, dict]
    sla: dict
    cost_model: dict

class ServiceCatalog:
    """Platform service catalog"""

    def __init__(self):
        self.services: Dict[str, ServiceOffering] = {}
        self._initialize_catalog()

    def _initialize_catalog(self):
        """Initialize standard service offerings"""

        # Kubernetes namespace
        self.services['kubernetes-namespace'] = ServiceOffering(
            name='Kubernetes Namespace',
            type=ServiceType.COMPUTE,
            description='Isolated Kubernetes namespace with RBAC and resource quotas',
            tiers={
                'small': {
                    'cpu_limit': '4',
                    'memory_limit': '8Gi',
                    'storage_limit': '50Gi'
                },
                'medium': {
                    'cpu_limit': '16',
                    'memory_limit': '32Gi',
                    'storage_limit': '200Gi'
                },
                'large': {
                    'cpu_limit': '64',
                    'memory_limit': '128Gi',
                    'storage_limit': '1Ti'
                }
            },
            sla={'availability': '99.9%', 'support': '24x7'},
            cost_model={'type': 'resource_based', 'unit': 'per_hour'}
        )

        # PostgreSQL database
        self.services['postgresql'] = ServiceOffering(
            name='PostgreSQL Database',
            type=ServiceType.DATABASE,
            description='Managed PostgreSQL with automatic backups and monitoring',
            tiers={
                'small': {'vcores': 2, 'memory_gb': 4, 'storage_gb': 100},
                'medium': {'vcores': 4, 'memory_gb': 16, 'storage_gb': 500},
                'large': {'vcores': 16, 'memory_gb': 64, 'storage_gb': 2000}
            },
            sla={'availability': '99.95%', 'rpo': '5min', 'rto': '1hour'},
            cost_model={'type': 'tier_based', 'billing': 'monthly'}
        )

        # Redis cache
        self.services['redis'] = ServiceOffering(
            name='Redis Cache',
            type=ServiceType.DATABASE,
            description='Managed Redis for caching and session storage',
            tiers={
                'small': {'memory_gb': 1, 'connections': 1000},
                'medium': {'memory_gb': 6, 'connections': 5000},
                'large': {'memory_gb': 26, 'connections': 20000}
            },
            sla={'availability': '99.9%', 'latency_p99': '1ms'},
            cost_model={'type': 'tier_based', 'billing': 'monthly'}
        )

    def get_service(self, name: str) -> Optional[ServiceOffering]:
        return self.services.get(name)

    def list_services(self, service_type: ServiceType = None) -> List[ServiceOffering]:
        if service_type:
            return [s for s in self.services.values() if s.type == service_type]
        return list(self.services.values())
```

## Self-Service Provisioning

```python
from abc import ABC, abstractmethod
import pulumi
from pulumi_azure_native import resources, containerservice, dbforpostgresql

class ResourceProvisioner(ABC):
    """Abstract base for resource provisioners"""

    @abstractmethod
    def provision(self, spec: dict) -> dict:
        pass

    @abstractmethod
    def deprovision(self, resource_id: str):
        pass

    @abstractmethod
    def get_status(self, resource_id: str) -> dict:
        pass

class KubernetesNamespaceProvisioner(ResourceProvisioner):
    """Provision Kubernetes namespaces"""

    def provision(self, spec: dict) -> dict:
        from kubernetes import client, config

        config.load_kube_config()
        v1 = client.CoreV1Api()

        namespace_name = f"{spec['team']}-{spec['name']}"

        # Create namespace
        namespace = client.V1Namespace(
            metadata=client.V1ObjectMeta(
                name=namespace_name,
                labels={
                    'team': spec['team'],
                    'managed-by': 'platform',
                    'tier': spec.get('tier', 'small')
                }
            )
        )
        v1.create_namespace(namespace)

        # Create resource quota
        tier_limits = self._get_tier_limits(spec.get('tier', 'small'))
        quota = client.V1ResourceQuota(
            metadata=client.V1ObjectMeta(name='default-quota'),
            spec=client.V1ResourceQuotaSpec(
                hard={
                    'requests.cpu': tier_limits['cpu_limit'],
                    'requests.memory': tier_limits['memory_limit'],
                    'persistentvolumeclaims': '10'
                }
            )
        )
        v1.create_namespaced_resource_quota(namespace_name, quota)

        # Create network policy
        self._create_network_policy(namespace_name)

        # Create RBAC
        self._create_rbac(namespace_name, spec['team'])

        return {
            'resource_id': namespace_name,
            'status': 'provisioned',
            'connection_info': {
                'namespace': namespace_name,
                'cluster': 'production'
            }
        }

    def _get_tier_limits(self, tier: str) -> dict:
        limits = {
            'small': {'cpu_limit': '4', 'memory_limit': '8Gi'},
            'medium': {'cpu_limit': '16', 'memory_limit': '32Gi'},
            'large': {'cpu_limit': '64', 'memory_limit': '128Gi'}
        }
        return limits.get(tier, limits['small'])


class PostgreSQLProvisioner(ResourceProvisioner):
    """Provision PostgreSQL databases"""

    def provision(self, spec: dict) -> dict:
        import pulumi
        from pulumi_azure_native import dbforpostgresql

        server_name = f"psql-{spec['team']}-{spec['name']}"
        tier_config = self._get_tier_config(spec.get('tier', 'small'))

        # Create PostgreSQL server using Pulumi
        server = dbforpostgresql.Server(
            server_name,
            resource_group_name=spec['resource_group'],
            server_name=server_name,
            sku=dbforpostgresql.SkuArgs(
                name=tier_config['sku'],
                tier=tier_config['tier']
            ),
            properties=dbforpostgresql.ServerPropertiesForDefaultCreateArgs(
                administrator_login="platformadmin",
                administrator_login_password=self._generate_password(),
                create_mode="Default",
                storage_profile=dbforpostgresql.StorageProfileArgs(
                    backup_retention_days=7,
                    geo_redundant_backup="Disabled",
                    storage_mb=tier_config['storage_mb']
                ),
                version="13"
            )
        )

        return {
            'resource_id': server_name,
            'status': 'provisioning',
            'connection_info': {
                'host': f"{server_name}.postgres.database.azure.com",
                'port': 5432,
                'database': 'postgres'
            }
        }
```

## Developer Portal

```typescript
// Developer portal API
import express from 'express';
import { ServiceCatalog } from './catalog';
import { ResourceManager } from './resources';

const app = express();
const catalog = new ServiceCatalog();
const resourceManager = new ResourceManager();

// List available services
app.get('/api/catalog', (req, res) => {
    const services = catalog.listServices();
    res.json(services);
});

// Request a new resource
app.post('/api/resources', async (req, res) => {
    const { serviceType, tier, team, name, config } = req.body;

    // Validate request
    const validation = await validateRequest(req.body);
    if (!validation.valid) {
        return res.status(400).json({ error: validation.errors });
    }

    // Check team quota
    const quota = await resourceManager.checkQuota(team, serviceType);
    if (!quota.available) {
        return res.status(403).json({ error: 'Quota exceeded' });
    }

    // Provision resource
    const resource = await resourceManager.provision({
        serviceType,
        tier,
        team,
        name,
        config
    });

    // Record in service registry
    await serviceRegistry.register(resource);

    res.json(resource);
});

// Get resource status
app.get('/api/resources/:id', async (req, res) => {
    const resource = await resourceManager.getResource(req.params.id);
    if (!resource) {
        return res.status(404).json({ error: 'Resource not found' });
    }
    res.json(resource);
});

// List team resources
app.get('/api/teams/:team/resources', async (req, res) => {
    const resources = await resourceManager.listByTeam(req.params.team);
    res.json(resources);
});

// Deprovision resource
app.delete('/api/resources/:id', async (req, res) => {
    await resourceManager.deprovision(req.params.id);
    res.status(204).send();
});
```

## Golden Paths with Templates

```yaml
# Application template - golden path for microservices
apiVersion: scaffolder.backstage.io/v1beta3
kind: Template
metadata:
  name: microservice-template
  title: Microservice Template
  description: Create a new microservice with all standard configurations
  tags:
    - recommended
    - microservice
spec:
  owner: platform-team
  type: service

  parameters:
    - title: Service Information
      required:
        - name
        - team
        - description
      properties:
        name:
          title: Service Name
          type: string
          pattern: '^[a-z0-9-]+$'
        team:
          title: Team
          type: string
          enum:
            - commerce
            - customer
            - payments
            - platform
        description:
          title: Description
          type: string

    - title: Technical Configuration
      properties:
        language:
          title: Programming Language
          type: string
          enum:
            - python
            - go
            - java
            - typescript
          default: python
        database:
          title: Database
          type: string
          enum:
            - none
            - postgresql
            - mongodb
          default: none
        caching:
          title: Redis Cache
          type: boolean
          default: false

  steps:
    - id: fetch-template
      name: Fetch Template
      action: fetch:template
      input:
        url: ./templates/${{ parameters.language }}
        values:
          name: ${{ parameters.name }}
          team: ${{ parameters.team }}
          description: ${{ parameters.description }}

    - id: create-repo
      name: Create Repository
      action: publish:github
      input:
        repoUrl: github.com?owner=${{ parameters.team }}&repo=${{ parameters.name }}
        description: ${{ parameters.description }}

    - id: setup-pipeline
      name: Setup CI/CD Pipeline
      action: github:actions:create
      input:
        repoUrl: ${{ steps.create-repo.output.repoUrl }}
        template: standard-pipeline

    - id: register-service
      name: Register in Catalog
      action: catalog:register
      input:
        repoContentsUrl: ${{ steps.create-repo.output.repoContentsUrl }}
        catalogInfoPath: /catalog-info.yaml

    - id: provision-infrastructure
      name: Provision Infrastructure
      action: platform:provision
      input:
        team: ${{ parameters.team }}
        service: ${{ parameters.name }}
        database: ${{ parameters.database }}
        caching: ${{ parameters.caching }}

  output:
    links:
      - title: Repository
        url: ${{ steps.create-repo.output.remoteUrl }}
      - title: Pipeline
        url: ${{ steps.setup-pipeline.output.pipelineUrl }}
      - title: Service Catalog
        url: /catalog/services/${{ parameters.name }}
```

## Platform Metrics

```python
# Platform health and usage metrics
from prometheus_client import Counter, Histogram, Gauge

# Provisioning metrics
provisions_total = Counter(
    'platform_provisions_total',
    'Total resource provisions',
    ['service_type', 'tier', 'status']
)

provision_duration = Histogram(
    'platform_provision_duration_seconds',
    'Time to provision resources',
    ['service_type'],
    buckets=[10, 30, 60, 120, 300, 600]
)

# Usage metrics
active_resources = Gauge(
    'platform_active_resources',
    'Number of active resources',
    ['service_type', 'team']
)

resource_utilization = Gauge(
    'platform_resource_utilization',
    'Resource utilization percentage',
    ['resource_id', 'metric']
)

# Developer experience metrics
time_to_first_deploy = Histogram(
    'platform_time_to_first_deploy_hours',
    'Time from onboarding to first production deploy',
    ['team'],
    buckets=[1, 4, 8, 24, 48, 168]
)

self_service_success_rate = Gauge(
    'platform_self_service_success_rate',
    'Percentage of self-service requests completed without support'
)
```

## Key Platform Engineering Principles

1. **Product Mindset**: Treat the platform as a product with developer customers
2. **Self-Service**: Enable teams to provision without tickets
3. **Golden Paths**: Make the right way the easy way
4. **Documentation**: Comprehensive, up-to-date documentation
5. **Measure Success**: Track developer productivity metrics

Platform engineering in 2021 emerged as the answer to scaling DevOps practices. By building platforms that abstract complexity, organizations enable faster, safer software delivery.

## Resources

- [Team Topologies](https://teamtopologies.com/)
- [Backstage](https://backstage.io/)
- [Platform Engineering Community](https://platformengineering.org/)
- [Internal Developer Platform](https://internaldeveloperplatform.org/)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
