---
title: "Platform Engineering for Data and AI: Building Internal Developer Platforms"
description: "Platform engineering enables scale while maintaining quality and consistency. Build platforms that make the right thing easy and the wrong thing hard."
author: Michael John Peña
draft: false
date: 2024-12-25
tags:
  - Platform Engineering
  - Developer Experience
  - Data Platform
  - AI Platform
  - Infrastructure
---

## The Platform Engineering Approach

```
Traditional Model                    Platform Engineering Model
─────────────────                   ──────────────────────────
Each team builds infrastructure     Shared platform, self-service
Duplicate effort                    Economies of scale
Inconsistent practices              Standardized patterns
Slow onboarding                     Fast, guided onboarding
Support tickets                     Self-service with guardrails
```

## Platform Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Developer Portal                          │
│  (Documentation, Templates, Service Catalog, Self-Service)  │
├─────────────────────────────────────────────────────────────┤
│                    Platform Services                         │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐       │
│  │  Data   │  │   ML    │  │   AI    │  │ Analytics│       │
│  │ Platform│  │Platform │  │Platform │  │ Platform│       │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘       │
├─────────────────────────────────────────────────────────────┤
│                    Foundation Services                       │
│  (Security, Networking, Identity, Monitoring, Cost Mgmt)    │
├─────────────────────────────────────────────────────────────┤
│                    Infrastructure                            │
│  (Azure Fabric, Kubernetes, Storage, Compute)               │
└─────────────────────────────────────────────────────────────┘
```

## Building the Data Platform Layer

```python
class DataPlatformService:
    """Self-service data platform capabilities."""

    def __init__(self, fabric_client, governance_client):
        self.fabric = fabric_client
        self.governance = governance_client

    async def create_data_product(
        self,
        name: str,
        domain: str,
        owner: str,
        schema: dict,
        access_patterns: list
    ) -> dict:
        """Create a new data product with all supporting infrastructure."""

        # Validate against governance rules
        validation = await self.governance.validate_data_product(
            name=name,
            domain=domain,
            schema=schema
        )
        if not validation.approved:
            raise GovernanceViolation(validation.issues)

        # Create lakehouse
        lakehouse = await self.fabric.create_lakehouse(
            name=f"{domain}_{name}_lakehouse",
            workspace=self.get_workspace(domain)
        )

        # Create tables from schema
        for table_name, table_schema in schema.items():
            await self.fabric.create_table(
                lakehouse=lakehouse.id,
                name=table_name,
                schema=table_schema
            )

        # Set up security
        await self.setup_security(lakehouse, owner, access_patterns)

        # Register in data catalog
        catalog_entry = await self.governance.register_data_product(
            name=name,
            domain=domain,
            owner=owner,
            location=lakehouse.path,
            schema=schema
        )

        # Set up monitoring
        await self.setup_monitoring(lakehouse, name)

        return {
            "data_product": name,
            "lakehouse": lakehouse.id,
            "catalog_entry": catalog_entry.id,
            "status": "created"
        }

    async def request_data_access(
        self,
        data_product: str,
        requester: str,
        access_type: str,
        justification: str
    ) -> dict:
        """Request access to a data product."""

        # Create access request
        request = await self.governance.create_access_request(
            data_product=data_product,
            requester=requester,
            access_type=access_type,
            justification=justification
        )

        # Auto-approve if meets criteria
        if self.can_auto_approve(request):
            await self.grant_access(request)
            return {"status": "approved", "request_id": request.id}

        # Otherwise route to owner
        await self.notify_owner(request)
        return {"status": "pending", "request_id": request.id}

    async def create_data_pipeline(
        self,
        name: str,
        source: dict,
        destination: dict,
        transformations: list,
        schedule: str
    ) -> dict:
        """Create a data pipeline from template."""

        # Validate pipeline
        validation = await self.validate_pipeline(
            source=source,
            destination=destination,
            transformations=transformations
        )

        # Create from template
        pipeline = await self.fabric.create_pipeline(
            name=name,
            template="standard_etl",
            parameters={
                "source": source,
                "destination": destination,
                "transformations": transformations
            }
        )

        # Configure schedule
        await self.fabric.set_schedule(
            pipeline_id=pipeline.id,
            schedule=schedule
        )

        # Set up alerting
        await self.setup_pipeline_alerts(pipeline)

        return {
            "pipeline_id": pipeline.id,
            "status": "created",
            "schedule": schedule
        }
```

## Building the ML Platform Layer

```python
class MLPlatformService:
    """Self-service ML platform capabilities."""

    def __init__(self, ml_client, feature_store, model_registry):
        self.ml = ml_client
        self.features = feature_store
        self.registry = model_registry

    async def create_ml_project(
        self,
        name: str,
        team: str,
        project_type: str,  # classification, regression, etc.
        data_sources: list
    ) -> dict:
        """Create a new ML project with standard setup."""

        # Create project workspace
        workspace = await self.ml.create_workspace(
            name=f"{team}_{name}",
            tags={"team": team, "type": project_type}
        )

        # Set up experiment tracking
        experiment = await self.ml.create_experiment(
            workspace=workspace.id,
            name=name
        )

        # Link data sources
        for source in data_sources:
            await self.ml.link_data_source(
                workspace=workspace.id,
                source=source
            )

        # Create project template
        await self.create_project_template(
            workspace=workspace,
            project_type=project_type
        )

        return {
            "project": name,
            "workspace_id": workspace.id,
            "experiment_id": experiment.id,
            "template": "created"
        }

    async def deploy_model(
        self,
        model_name: str,
        model_version: str,
        deployment_type: str,  # realtime, batch
        config: dict
    ) -> dict:
        """Deploy model to production."""

        # Get model from registry
        model = await self.registry.get_model(model_name, model_version)

        # Validate model
        validation = await self.validate_model_for_deployment(model)
        if not validation.passed:
            raise ModelValidationError(validation.issues)

        # Create deployment
        if deployment_type == "realtime":
            deployment = await self.create_realtime_deployment(model, config)
        else:
            deployment = await self.create_batch_deployment(model, config)

        # Set up monitoring
        await self.setup_model_monitoring(deployment)

        # Update registry
        await self.registry.update_deployment_status(
            model_name=model_name,
            version=model_version,
            deployment_id=deployment.id
        )

        return {
            "deployment_id": deployment.id,
            "endpoint": deployment.endpoint,
            "status": "deployed"
        }

    async def create_feature_set(
        self,
        name: str,
        entity: str,
        features: list,
        source_query: str
    ) -> dict:
        """Create a feature set in the feature store."""

        # Validate features
        validation = await self.features.validate_features(features)

        # Create feature set
        feature_set = await self.features.create_feature_set(
            name=name,
            entity=entity,
            features=features,
            source=source_query
        )

        # Set up materialization
        await self.features.configure_materialization(
            feature_set_id=feature_set.id,
            online=True,
            offline=True,
            schedule="0 * * * *"
        )

        return {
            "feature_set_id": feature_set.id,
            "features": len(features),
            "status": "created"
        }
```

## Building the AI Platform Layer

```python
class AIPlatformService:
    """Self-service AI platform capabilities."""

    def __init__(self, ai_foundry_client, prompt_registry, eval_service):
        self.ai = ai_foundry_client
        self.prompts = prompt_registry
        self.evaluator = eval_service

    async def create_ai_application(
        self,
        name: str,
        team: str,
        app_type: str,  # chatbot, agent, rag
        config: dict
    ) -> dict:
        """Create a new AI application from template."""

        # Select template
        template = self.get_template(app_type)

        # Create project
        project = await self.ai.create_project(
            name=name,
            template=template,
            config=config
        )

        # Set up prompt management
        await self.prompts.create_prompt_set(
            project_id=project.id,
            prompts=template.default_prompts
        )

        # Set up evaluation
        await self.evaluator.create_eval_suite(
            project_id=project.id,
            test_cases=template.default_test_cases
        )

        # Configure guardrails
        await self.setup_guardrails(project, config.get("guardrails", {}))

        return {
            "project_id": project.id,
            "template": app_type,
            "status": "created"
        }

    async def deploy_ai_agent(
        self,
        agent_config: dict,
        deployment_config: dict
    ) -> dict:
        """Deploy an AI agent."""

        # Validate agent configuration
        validation = await self.validate_agent(agent_config)

        # Create agent
        agent = await self.ai.create_agent(
            name=agent_config["name"],
            model=agent_config["model"],
            instructions=agent_config["instructions"],
            tools=agent_config["tools"]
        )

        # Deploy
        deployment = await self.ai.deploy_agent(
            agent_id=agent.id,
            config=deployment_config
        )

        # Set up monitoring
        await self.setup_agent_monitoring(deployment)

        return {
            "agent_id": agent.id,
            "deployment_id": deployment.id,
            "endpoint": deployment.endpoint
        }
```

## Developer Portal

```python
class DeveloperPortal:
    """Self-service portal for platform capabilities."""

    def __init__(self):
        self.data_platform = DataPlatformService(...)
        self.ml_platform = MLPlatformService(...)
        self.ai_platform = AIPlatformService(...)
        self.templates = TemplateRegistry()
        self.docs = DocumentationService()

    def get_service_catalog(self) -> dict:
        """Get available platform services."""
        return {
            "data": {
                "create_data_product": {
                    "description": "Create a new governed data product",
                    "sla": "< 5 minutes",
                    "self_service": True
                },
                "request_data_access": {
                    "description": "Request access to existing data",
                    "sla": "< 24 hours (or instant if auto-approved)",
                    "self_service": True
                },
                "create_pipeline": {
                    "description": "Create data pipeline from template",
                    "sla": "< 10 minutes",
                    "self_service": True
                }
            },
            "ml": {
                "create_ml_project": {
                    "description": "Create ML project with standard setup",
                    "sla": "< 15 minutes",
                    "self_service": True
                },
                "deploy_model": {
                    "description": "Deploy model to production",
                    "sla": "< 30 minutes",
                    "self_service": True
                }
            },
            "ai": {
                "create_ai_application": {
                    "description": "Create AI application from template",
                    "sla": "< 10 minutes",
                    "self_service": True
                },
                "deploy_agent": {
                    "description": "Deploy AI agent",
                    "sla": "< 20 minutes",
                    "self_service": True
                }
            }
        }

    def get_templates(self, category: str) -> list:
        """Get available templates."""
        return self.templates.list(category=category)

    def get_documentation(self, topic: str) -> dict:
        """Get documentation for a topic."""
        return self.docs.get(topic)

    def get_golden_paths(self) -> list:
        """Get recommended paths for common scenarios."""
        return [
            {
                "name": "New Analytics Dashboard",
                "steps": [
                    "Create data product",
                    "Build semantic model",
                    "Create Power BI report"
                ],
                "estimated_time": "2 hours"
            },
            {
                "name": "ML Model to Production",
                "steps": [
                    "Create ML project",
                    "Use feature store",
                    "Train and evaluate",
                    "Deploy model"
                ],
                "estimated_time": "1 day"
            },
            {
                "name": "AI-Powered Chatbot",
                "steps": [
                    "Create AI application",
                    "Configure knowledge base",
                    "Set up guardrails",
                    "Deploy to Teams"
                ],
                "estimated_time": "4 hours"
            }
        ]
```

Platform engineering enables scale while maintaining quality and consistency. Build platforms that make the right thing easy and the wrong thing hard.

## Resources

- [Platform Engineering Guide](https://platformengineering.org/)
- [Internal Developer Platforms](https://internaldeveloperplatform.org/)
- [Team Topologies](https://teamtopologies.com/)
