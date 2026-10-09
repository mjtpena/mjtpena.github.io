---
title: "Enterprise AI Governance: Building Model Registries and Approval Workflows"
description: "A model registry serves as the single source of truth for all ML models, tracking versions, lineage, and deployment status."
author: Michael John Peña
draft: false
date: 2025-09-10
tags:
  - AI Governance
  - MLOps
  - Model Registry
  - Enterprise
  - Compliance
---

## The Model Registry Pattern

A model registry serves as the single source of truth for all ML models, tracking versions, lineage, and deployment status.

```python
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import List, Dict, Optional
import hashlib
import json

class ModelStatus(Enum):
    DRAFT = "draft"
    PENDING_REVIEW = "pending_review"
    APPROVED = "approved"
    REJECTED = "rejected"
    DEPLOYED = "deployed"
    DEPRECATED = "deprecated"

@dataclass
class ModelVersion:
    version: str
    artifact_path: str
    artifact_hash: str
    metrics: Dict[str, float]
    parameters: Dict[str, any]
    training_data_ref: str
    created_at: datetime
    created_by: str
    status: ModelStatus = ModelStatus.DRAFT

@dataclass
class RegisteredModel:
    name: str
    description: str
    owner: str
    use_case: str
    risk_tier: str
    versions: List[ModelVersion] = field(default_factory=list)
    tags: List[str] = field(default_factory=list)

    def register_version(self, version: ModelVersion) -> None:
        """Register a new model version."""
        # Validate version number is unique
        existing = [v.version for v in self.versions]
        if version.version in existing:
            raise ValueError(f"Version {version.version} already exists")
        self.versions.append(version)

    def get_latest_approved(self) -> Optional[ModelVersion]:
        """Get the most recent approved version."""
        approved = [v for v in self.versions if v.status == ModelStatus.APPROVED]
        if not approved:
            return None
        return sorted(approved, key=lambda v: v.created_at, reverse=True)[0]
```

## Approval Workflow Engine

```python
@dataclass
class ApprovalRequest:
    model_name: str
    version: str
    requester: str
    justification: str
    required_approvers: List[str]
    approvals: Dict[str, Dict] = field(default_factory=dict)
    created_at: datetime = field(default_factory=datetime.now)

class ApprovalWorkflow:
    def __init__(self, registry: Dict[str, RegisteredModel]):
        self.registry = registry
        self.pending_requests: Dict[str, ApprovalRequest] = {}

    def submit_for_approval(self, model_name: str, version: str,
                           requester: str, justification: str) -> str:
        """Submit a model version for approval."""
        model = self.registry.get(model_name)
        if not model:
            raise ValueError(f"Model {model_name} not found")

        # Determine required approvers based on risk tier
        approvers = self._get_required_approvers(model.risk_tier)

        request_id = f"{model_name}-{version}-{datetime.now().timestamp()}"
        self.pending_requests[request_id] = ApprovalRequest(
            model_name=model_name,
            version=version,
            requester=requester,
            justification=justification,
            required_approvers=approvers
        )

        # Update model status
        for v in model.versions:
            if v.version == version:
                v.status = ModelStatus.PENDING_REVIEW

        return request_id

    def _get_required_approvers(self, risk_tier: str) -> List[str]:
        """Determine approvers based on model risk tier."""
        tiers = {
            "low": ["ml_lead"],
            "medium": ["ml_lead", "security_reviewer"],
            "high": ["ml_lead", "security_reviewer", "compliance_officer"],
            "critical": ["ml_lead", "security_reviewer", "compliance_officer", "ciso"]
        }
        return tiers.get(risk_tier, tiers["high"])
```

Implementing governance early prevents technical debt and compliance issues as your AI portfolio grows. The registry becomes the foundation for auditing, reproducibility, and trust in AI systems.
