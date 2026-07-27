---
title: "The Rise of Platform Engineering in 2022"
author: Michael John Peña
draft: false
date: 2022-12-14
tags:
  - Platform Engineering
  - DevOps
  - Developer Experience
  - Internal Developer Platform
  - Cloud Native

---

I wrote "The Rise of Platform Engineering in 2022" to share practical, production-minded guidance on this topic.

## What is Platform Engineering?

Platform engineering is the practice of building and maintaining internal developer platforms (IDPs) that enable self-service capabilities for development teams.

The goal: Reduce cognitive load on developers while maintaining governance and best practices.

## The Problem It Solves

```python
# Before platform engineering
developer_tasks = [
    "Write application code",
    "Create Kubernetes manifests",
    "Set up CI/CD pipelines",
    "Configure monitoring",
    "Manage secrets",
    "Set up databases",
    "Configure networking",
    "Handle security scanning",
    "Manage certificates",
    "Deal with infrastructure"
]

# With platform engineering
developer_tasks = [
    "Write application code",
    "Define requirements in spec file",
    "Push code"  # Platform handles the rest
]
```

## Internal Developer Platform Components

### 1. Service Catalog

```yaml
# Backstage catalog-info.yaml
apiVersion: backstage.io/v1alpha1
kind: Component
metadata:
  name: payment-service
  description: Handles payment processing
  annotations:
    backstage.io/techdocs-ref: dir:.
    github.com/project-slug: company/payment-service
    pagerduty.com/service-id: PXXXXXX
  tags:
    - python
    - payments
    - critical
  links:
    - url: https://grafana.company.com/d/payment
      title: Grafana Dashboard
    - url: https://payment-service.docs.company.com
      title: API Documentation
spec:
  type: service
  lifecycle: production
  owner: team-payments
  system: e-commerce
  providesApis:
    - payment-api
  dependsOn:
    - resource:default/payment-db
    - component:default/fraud-detection
```

### 2. Golden Paths / Templates

```yaml
# Backstage Software Template
apiVersion: scaffolder.backstage.io/v1beta3
kind: Template
metadata:
  name: dotnet-api-template
  title: .NET API Service
  description: Create a new .NET API with all best practices
  tags:
    - recommended
    - dotnet
    - api
spec:
  owner: platform-team
  type: service

  parameters:
    - title: Service Information
      required:
        - name
        - description
        - owner
      properties:
        name:
          title: Service Name
          type: string
          pattern: '^[a-z0-9-]+$'
        description:
          title: Description
          type: string
        owner:
          title: Owner Team
          type: string
          ui:field: OwnerPicker

    - title: Technical Options
      properties:
        database:
          title: Database Type
          type: string
          enum:
            - postgresql
            - cosmosdb
            - none
        messaging:
          title: Messaging System
          type: string
          enum:
            - servicebus
            - eventhubs
            - none

  steps:
    - id: fetch-base
      name: Fetch Base Template
      action: fetch:template
      input:
        url: ./skeleton
        values:
          name: ${{ parameters.name }}
          description: ${{ parameters.description }}
          owner: ${{ parameters.owner }}

    - id: create-repo
      name: Create Repository
      action: publish:github
      input:
        repoUrl: github.com?owner=company&repo=${{ parameters.name }}
        description: ${{ parameters.description }}

    - id: create-infrastructure
      name: Provision Infrastructure
      action: http:backstage:request
      input:
        method: POST
        path: /api/platform/provision
        body:
          service: ${{ parameters.name }}
          database: ${{ parameters.database }}
          messaging: ${{ parameters.messaging }}

    - id: register-catalog
      name: Register in Catalog
      action: catalog:register
      input:
        repoContentsUrl: ${{ steps['create-repo'].output.repoContentsUrl }}
        catalogInfoPath: /catalog-info.yaml

  output:
    links:
      - title: Repository
        url: ${{ steps['create-repo'].output.remoteUrl }}
      - title: Service in Catalog
        url: ${{ steps['register-catalog'].output.catalogInfoUrl }}
```

### 3. Self-Service Infrastructure

```yaml
# Platform API - Service provisioning
openapi: 3.0.0
info:
  title: Platform Provisioning API
  version: 1.0.0

paths:
  /api/services:
    post:
      summary: Provision a new service
      requestBody:
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/ServiceRequest'
      responses:
        '202':
          description: Provisioning started
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ProvisioningStatus'

components:
  schemas:
    ServiceRequest:
      type: object
      required:
        - name
        - team
        - environment
      properties:
        name:
          type: string
          pattern: '^[a-z0-9-]+$'
        team:
          type: string
        environment:
          type: string
          enum: [dev, staging, production]
        resources:
          type: object
          properties:
            compute:
              type: string
              enum: [small, medium, large]
            database:
              type: object
              properties:
                type:
                  type: string
                  enum: [postgresql, cosmosdb]
                size:
                  type: string
                  enum: [basic, standard, premium]
            cache:
              type: boolean
            messageQueue:
              type: boolean
```

### 4. Developer Portal

```typescript
// Backstage plugin for environment management
import React from 'react';
import { useEntity } from '@backstage/plugin-catalog-react';
import { Table, TableColumn } from '@backstage/core-components';

export const EnvironmentTable = () => {
  const { entity } = useEntity();
  const environments = useEnvironments(entity.metadata.name);

  const columns: TableColumn[] = [
    { title: 'Environment', field: 'name' },
    { title: 'Status', field: 'status' },
    { title: 'Version', field: 'version' },
    { title: 'Last Deployed', field: 'lastDeployed' },
    {
      title: 'Actions',
      render: (row) => (
        <>
          <Button onClick={() => deploy(row.name)}>Deploy</Button>
          <Button onClick={() => rollback(row.name)}>Rollback</Button>
          <Button onClick={() => viewLogs(row.name)}>Logs</Button>
        </>
      ),
    },
  ];

  return (
    <Table
      title="Environments"
      options={{ paging: false }}
      columns={columns}
      data={environments}
    />
  );
};
```

## Platform Team Structure

```yaml
platform_team:
  size: 5-10 engineers (for ~100 developers)

  roles:
    - name: Platform Lead
      focus: Strategy, stakeholder management
      count: 1

    - name: Platform Engineer
      focus: IDP development, automation
      count: 3-5

    - name: SRE
      focus: Reliability, observability
      count: 2-3

    - name: Security Engineer
      focus: DevSecOps, policies
      count: 1-2

  responsibilities:
    - Developer portal maintenance
    - Golden path templates
    - CI/CD platform
    - Observability stack
    - Security tooling
    - Documentation
    - Developer support

  metrics:
    - Time to first deployment (new service)
    - Developer satisfaction score
    - Platform adoption rate
    - Incident reduction
    - Self-service completion rate
```

## Implementation Roadmap

```python
roadmap = {
    "phase_1_foundation": {
        "duration": "3 months",
        "goals": [
            "Establish platform team",
            "Select core technologies",
            "Build first golden path",
            "Deploy developer portal"
        ]
    },
    "phase_2_self_service": {
        "duration": "3 months",
        "goals": [
            "Self-service environments",
            "Automated provisioning",
            "Integrated CI/CD",
            "Basic observability"
        ]
    },
    "phase_3_adoption": {
        "duration": "3 months",
        "goals": [
            "Migrate existing services",
            "Expand golden paths",
            "Advanced observability",
            "Cost visibility"
        ]
    },
    "phase_4_optimization": {
        "duration": "ongoing",
        "goals": [
            "Performance optimization",
            "Advanced automation",
            "AI/ML integration",
            "Continuous improvement"
        ]
    }
}
```

## Success Metrics

```python
platform_metrics = {
    "developer_experience": {
        "time_to_first_deploy": "< 1 day",
        "self_service_rate": "> 90%",
        "developer_satisfaction": "> 4.0/5",
        "documentation_coverage": "> 95%"
    },
    "operational": {
        "platform_availability": "> 99.9%",
        "mean_time_to_provision": "< 15 minutes",
        "incident_rate": "decreasing trend",
        "support_tickets": "decreasing trend"
    },
    "business": {
        "deployment_frequency": "increasing trend",
        "lead_time": "decreasing trend",
        "developer_productivity": "increasing trend",
        "infrastructure_cost": "optimized"
    }
}
```

## Common Pitfalls

1. **Building too much**: Start small, iterate
2. **Ignoring developer feedback**: Platform is for developers
3. **Forcing adoption**: Make it attractive, not mandatory
4. **Over-engineering**: Simple solutions often win
5. **Neglecting documentation**: Docs are part of the product

## Conclusion

Platform engineering represents the evolution of DevOps at scale. By providing self-service capabilities with built-in guardrails, organizations can accelerate development while maintaining consistency and governance. The key is treating the platform as a product, with developers as the customers.

## Resources

- [Platform Engineering](https://platformengineering.org/)
- [Backstage](https://backstage.io/)
- [Team Topologies](https://teamtopologies.com/)
- [Internal Developer Platform](https://internaldeveloperplatform.org/)

