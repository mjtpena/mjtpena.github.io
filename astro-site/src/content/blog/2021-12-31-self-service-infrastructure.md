---
title: "Self-Service Infrastructure: Empowering Teams to Move Fast"
author: Michael John Pena
draft: false
date: 2021-12-31
tags:
  - Self-Service
  - Infrastructure
  - Platform Engineering
  - DevOps
  - Cloud

---

I wrote "Self-Service Infrastructure: Empowering Teams to Move Fast" to share practical, production-minded guidance on this topic.

## The Self-Service Imperative

Traditional infrastructure provisioning:
- Developer requests infrastructure
- Ticket goes to ops team
- Days or weeks of waiting
- Context switching and delays

Self-service infrastructure:
- Developer browses catalog
- Selects and configures
- Infrastructure provisioned in minutes
- Guardrails ensure compliance

## Building Self-Service Capabilities

```python
from dataclasses import dataclass
from typing import Dict, List, Optional, Callable
from enum import Enum
import asyncio

class ApprovalLevel(Enum):
    AUTO = "auto"  # Automatic approval
    REVIEW = "review"  # Requires review
    MANAGER = "manager"  # Requires manager approval

@dataclass
class SelfServiceRequest:
    id: str
    requester: str
    team: str
    resource_type: str
    configuration: dict
    environment: str
    justification: str
    approval_level: ApprovalLevel
    status: str = "pending"

class SelfServiceOrchestrator:
    """Orchestrate self-service infrastructure requests"""

    def __init__(self):
        self.approval_rules: List[Callable] = []
        self.provisioners: Dict[str, 'Provisioner'] = {}
        self.notifications = NotificationService()

    def register_approval_rule(self, rule: Callable[[SelfServiceRequest], ApprovalLevel]):
        """Register an approval rule"""
        self.approval_rules.append(rule)

    async def submit_request(self, request: SelfServiceRequest) -> str:
        """Submit a self-service request"""

        # Determine approval level
        request.approval_level = self._determine_approval_level(request)

        # Save request
        await self._save_request(request)

        if request.approval_level == ApprovalLevel.AUTO:
            # Auto-approve and provision immediately
            await self._provision(request)
        else:
            # Notify approvers
            await self._notify_approvers(request)

        return request.id

    def _determine_approval_level(self, request: SelfServiceRequest) -> ApprovalLevel:
        """Determine required approval level based on rules"""
        highest_level = ApprovalLevel.AUTO

        for rule in self.approval_rules:
            level = rule(request)
            if level.value > highest_level.value:
                highest_level = level

        return highest_level

    async def approve_request(self, request_id: str, approver: str, comments: str = ""):
        """Approve a pending request"""
        request = await self._get_request(request_id)

        if not self._can_approve(approver, request):
            raise PermissionError(f"{approver} cannot approve this request")

        request.status = "approved"
        await self._save_request(request)
        await self._provision(request)

        # Notify requester
        await self.notifications.send(
            to=request.requester,
            subject=f"Request {request_id} Approved",
            body=f"Your request has been approved by {approver}. Provisioning in progress."
        )

    async def _provision(self, request: SelfServiceRequest):
        """Provision the requested resource"""
        provisioner = self.provisioners.get(request.resource_type)
        if not provisioner:
            raise ValueError(f"No provisioner for {request.resource_type}")

        try:
            result = await provisioner.provision(
                name=f"{request.team}-{request.id[:8]}",
                team=request.team,
                environment=request.environment,
                config=request.configuration
            )

            request.status = "provisioned"
            request.result = result

            await self.notifications.send(
                to=request.requester,
                subject=f"Resource Provisioned: {request.id}",
                body=f"Your {request.resource_type} is ready.\n\nConnection info:\n{result}"
            )

        except Exception as e:
            request.status = "failed"
            request.error = str(e)

            await self.notifications.send(
                to=request.requester,
                subject=f"Provisioning Failed: {request.id}",
                body=f"Failed to provision {request.resource_type}: {str(e)}"
            )

        await self._save_request(request)


# Approval rules
def production_requires_manager(request: SelfServiceRequest) -> ApprovalLevel:
    """Production resources require manager approval"""
    if request.environment == "production":
        return ApprovalLevel.MANAGER
    return ApprovalLevel.AUTO

def large_resources_require_review(request: SelfServiceRequest) -> ApprovalLevel:
    """Large resource requests require review"""
    size = request.configuration.get("size", "small")
    if size in ["large", "xlarge"]:
        return ApprovalLevel.REVIEW
    return ApprovalLevel.AUTO

def cost_threshold_rule(request: SelfServiceRequest) -> ApprovalLevel:
    """Requests exceeding cost threshold require approval"""
    estimated_cost = estimate_monthly_cost(request)
    if estimated_cost > 1000:
        return ApprovalLevel.MANAGER
    elif estimated_cost > 100:
        return ApprovalLevel.REVIEW
    return ApprovalLevel.AUTO
```

## Infrastructure Templates

```yaml
# templates/web-service.yaml
apiVersion: platform.company.com/v1
kind: InfrastructureTemplate
metadata:
  name: web-service
  description: Standard web service with all required components
  category: compute
  tags:
    - web
    - kubernetes
    - standard
spec:
  parameters:
    - name: service_name
      type: string
      required: true
      pattern: "^[a-z][a-z0-9-]{2,28}[a-z0-9]$"

    - name: replicas
      type: integer
      default: 2
      min: 1
      max: 10

    - name: cpu
      type: string
      default: "500m"
      enum: ["250m", "500m", "1000m", "2000m"]

    - name: memory
      type: string
      default: "512Mi"
      enum: ["256Mi", "512Mi", "1Gi", "2Gi", "4Gi"]

    - name: expose_publicly
      type: boolean
      default: false

    - name: database
      type: string
      default: "none"
      enum: ["none", "postgresql", "mysql", "mongodb"]

    - name: cache
      type: boolean
      default: false

  resources:
    # Kubernetes namespace
    - type: kubernetes/namespace
      name: "{{ .service_name }}-namespace"
      config:
        labels:
          team: "{{ .team }}"
          service: "{{ .service_name }}"

    # Deployment
    - type: kubernetes/deployment
      name: "{{ .service_name }}"
      config:
        namespace: "{{ .service_name }}-namespace"
        replicas: "{{ .replicas }}"
        resources:
          requests:
            cpu: "{{ .cpu }}"
            memory: "{{ .memory }}"
          limits:
            cpu: "{{ .cpu }}"
            memory: "{{ .memory }}"

    # Service
    - type: kubernetes/service
      name: "{{ .service_name }}-svc"
      config:
        namespace: "{{ .service_name }}-namespace"
        type: ClusterIP
        ports:
          - port: 80
            targetPort: 8080

    # Ingress (if public)
    - type: kubernetes/ingress
      name: "{{ .service_name }}-ingress"
      condition: "{{ .expose_publicly }}"
      config:
        namespace: "{{ .service_name }}-namespace"
        host: "{{ .service_name }}.company.com"
        tls: true

    # Database (if requested)
    - type: azure/postgresql
      name: "{{ .service_name }}-db"
      condition: "{{ eq .database 'postgresql' }}"
      config:
        sku: "GP_Gen5_2"
        storage_mb: 51200

    # Redis cache (if requested)
    - type: azure/redis
      name: "{{ .service_name }}-cache"
      condition: "{{ .cache }}"
      config:
        sku: "Basic"
        capacity: 1

  outputs:
    - name: namespace
      value: "{{ .service_name }}-namespace"
    - name: service_url
      value: "http://{{ .service_name }}-svc.{{ .service_name }}-namespace.svc.cluster.local"
    - name: public_url
      value: "https://{{ .service_name }}.company.com"
      condition: "{{ .expose_publicly }}"
    - name: database_host
      value: "{{ .resources.database.host }}"
      condition: "{{ ne .database 'none' }}"
```

## Guardrails and Governance

```python
from dataclasses import dataclass
from typing import List, Callable
import re

@dataclass
class GuardrailResult:
    passed: bool
    rule_name: str
    message: str

class InfrastructureGuardrails:
    """Enforce guardrails on self-service requests"""

    def __init__(self):
        self.guardrails: List[Callable] = []
        self._register_default_guardrails()

    def _register_default_guardrails(self):
        """Register default guardrails"""

        # Naming convention
        self.register(self._naming_convention_guardrail)

        # Resource limits
        self.register(self._resource_limits_guardrail)

        # Security requirements
        self.register(self._security_guardrail)

        # Cost guardrails
        self.register(self._cost_guardrail)

        # Tagging requirements
        self.register(self._tagging_guardrail)

    def register(self, guardrail: Callable):
        """Register a guardrail"""
        self.guardrails.append(guardrail)

    def evaluate(self, request: dict) -> List[GuardrailResult]:
        """Evaluate all guardrails"""
        results = []
        for guardrail in self.guardrails:
            result = guardrail(request)
            results.append(result)
        return results

    def _naming_convention_guardrail(self, request: dict) -> GuardrailResult:
        """Enforce naming conventions"""
        name = request.get('name', '')
        pattern = r'^[a-z][a-z0-9-]{2,28}[a-z0-9]$'

        if not re.match(pattern, name):
            return GuardrailResult(
                passed=False,
                rule_name="naming_convention",
                message=f"Name '{name}' does not match pattern: lowercase, 4-30 chars, alphanumeric and hyphens only"
            )

        return GuardrailResult(
            passed=True,
            rule_name="naming_convention",
            message="Name meets naming convention"
        )

    def _resource_limits_guardrail(self, request: dict) -> GuardrailResult:
        """Enforce resource limits"""
        config = request.get('configuration', {})

        # Check CPU limits
        cpu = config.get('cpu', '500m')
        max_cpu = '4000m'
        if self._parse_cpu(cpu) > self._parse_cpu(max_cpu):
            return GuardrailResult(
                passed=False,
                rule_name="resource_limits",
                message=f"CPU request {cpu} exceeds maximum {max_cpu}"
            )

        # Check memory limits
        memory = config.get('memory', '512Mi')
        max_memory = '8Gi'
        if self._parse_memory(memory) > self._parse_memory(max_memory):
            return GuardrailResult(
                passed=False,
                rule_name="resource_limits",
                message=f"Memory request {memory} exceeds maximum {max_memory}"
            )

        return GuardrailResult(
            passed=True,
            rule_name="resource_limits",
            message="Resource requests within limits"
        )

    def _security_guardrail(self, request: dict) -> GuardrailResult:
        """Enforce security requirements"""
        config = request.get('configuration', {})
        environment = request.get('environment', 'development')

        if environment == 'production':
            # Production must have encryption
            if not config.get('encryption_at_rest', True):
                return GuardrailResult(
                    passed=False,
                    rule_name="security",
                    message="Production resources must have encryption at rest enabled"
                )

            # Production must not have public access (unless explicitly approved)
            if config.get('public_access', False) and not request.get('public_access_approved'):
                return GuardrailResult(
                    passed=False,
                    rule_name="security",
                    message="Public access requires explicit approval for production"
                )

        return GuardrailResult(
            passed=True,
            rule_name="security",
            message="Security requirements met"
        )

    def _cost_guardrail(self, request: dict) -> GuardrailResult:
        """Enforce cost guardrails"""
        estimated_cost = self._estimate_cost(request)
        team_budget = self._get_team_budget(request.get('team'))

        if estimated_cost > team_budget:
            return GuardrailResult(
                passed=False,
                rule_name="cost",
                message=f"Estimated cost ${estimated_cost}/month exceeds team budget ${team_budget}/month"
            )

        return GuardrailResult(
            passed=True,
            rule_name="cost",
            message=f"Estimated cost ${estimated_cost}/month within budget"
        )

    def _tagging_guardrail(self, request: dict) -> GuardrailResult:
        """Enforce tagging requirements"""
        required_tags = ['team', 'environment', 'cost-center', 'owner']
        tags = request.get('tags', {})

        missing = [tag for tag in required_tags if tag not in tags]

        if missing:
            return GuardrailResult(
                passed=False,
                rule_name="tagging",
                message=f"Missing required tags: {', '.join(missing)}"
            )

        return GuardrailResult(
            passed=True,
            rule_name="tagging",
            message="All required tags present"
        )
```

## Self-Service Metrics

```python
from prometheus_client import Counter, Histogram, Gauge

# Request metrics
self_service_requests = Counter(
    'self_service_requests_total',
    'Total self-service requests',
    ['resource_type', 'team', 'status']
)

request_to_provision_time = Histogram(
    'self_service_provision_seconds',
    'Time from request to provisioned',
    ['resource_type', 'approval_level'],
    buckets=[60, 300, 900, 1800, 3600, 7200, 86400]
)

# Adoption metrics
self_service_adoption_rate = Gauge(
    'self_service_adoption_percent',
    'Percentage of infrastructure via self-service',
    ['team']
)

# Guardrail metrics
guardrail_violations = Counter(
    'guardrail_violations_total',
    'Total guardrail violations',
    ['rule_name', 'team']
)

class SelfServiceMetrics:
    """Track self-service infrastructure metrics"""

    def calculate_adoption(self) -> dict:
        """Calculate self-service adoption by team"""
        teams = self.get_all_teams()
        adoption = {}

        for team in teams:
            total_resources = self.count_resources(team)
            self_service_resources = self.count_resources(team, source='self-service')

            rate = (self_service_resources / total_resources * 100) if total_resources > 0 else 0
            adoption[team] = rate
            self_service_adoption_rate.labels(team=team).set(rate)

        return adoption

    def get_time_savings(self) -> dict:
        """Calculate time saved through self-service"""
        # Average time for ticket-based provisioning: 3 days
        ticket_based_hours = 72

        self_service_times = self.get_provision_times()
        avg_self_service_hours = sum(self_service_times) / len(self_service_times) / 3600

        total_requests = len(self_service_times)
        hours_saved_per_request = ticket_based_hours - avg_self_service_hours
        total_hours_saved = hours_saved_per_request * total_requests

        return {
            'avg_ticket_based_hours': ticket_based_hours,
            'avg_self_service_hours': avg_self_service_hours,
            'hours_saved_per_request': hours_saved_per_request,
            'total_requests': total_requests,
            'total_hours_saved': total_hours_saved,
            'equivalent_fte_months': total_hours_saved / 160
        }
```

## 2021 in Review: The Year of Self-Service

As we close out 2021, self-service infrastructure has transformed how organizations deliver software:

1. **Speed**: Provisioning dropped from days to minutes
2. **Consistency**: Templates ensure standardization
3. **Compliance**: Guardrails enforce policies automatically
4. **Empowerment**: Developers own their infrastructure
5. **Focus**: Ops teams build platforms instead of processing tickets

The future is developers who can move fast within safe guardrails. Self-service infrastructure makes that possible.

## Looking Ahead to 2022

- More sophisticated cost controls
- Better multi-cloud abstractions
- Tighter security integration
- Enhanced observability
- AI-assisted recommendations

Thank you for reading this series on Azure, Data, and AI trends throughout December 2021. Here's to building better platforms and experiences in 2022!

## Resources

- [Platform Engineering](https://platformengineering.org/)
- [Backstage](https://backstage.io/)
- [Crossplane](https://crossplane.io/)
- [Terraform Cloud](https://www.terraform.io/cloud)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
