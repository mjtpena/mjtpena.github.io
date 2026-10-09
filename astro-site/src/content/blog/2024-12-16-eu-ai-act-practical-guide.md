---
title: "EU AI Act Practical Guide: What Enterprises Need to Do Now"
description: "The EU AI Act is complex but manageable with systematic approach. Start your inventory now, prioritize high-risk systems, and build compliance into your…"
author: Michael John Peña
draft: false
date: 2024-12-16
tags:
  - AI
  - EU AI Act
  - Compliance
  - Enterprise
  - Governance
---

## Timeline and Deadlines

```
EU AI Act Implementation Timeline:

August 2024: Act enters into force
├── Prohibited AI systems: 6 months (Feb 2025)
├── GPAI requirements: 12 months (Aug 2025)
├── High-risk systems (Annex III): 24 months (Aug 2026)
└── High-risk systems (Annex I): 36 months (Aug 2027)

Priority Actions by Deadline:
├── Feb 2025: Remove any prohibited AI
├── Aug 2025: Comply for general-purpose AI
└── Aug 2026: Full high-risk compliance
```

## Step 1: AI System Inventory

```python
from dataclasses import dataclass
from typing import List, Optional
from enum import Enum

class RiskLevel(Enum):
    UNACCEPTABLE = "unacceptable"
    HIGH = "high"
    LIMITED = "limited"
    MINIMAL = "minimal"

@dataclass
class AISystem:
    name: str
    description: str
    purpose: str
    domain: str
    user_facing: bool
    decision_making: bool
    decision_impact: str  # low, medium, high
    data_types: List[str]
    affected_users: str
    eu_deployment: bool

class AIInventory:
    """Create and manage AI system inventory."""

    def __init__(self):
        self.systems = []

    def add_system(self, system: AISystem):
        """Add AI system to inventory with classification."""
        classification = self.classify_system(system)
        system.risk_level = classification
        system.compliance_requirements = self.get_requirements(classification)
        self.systems.append(system)

    def classify_system(self, system: AISystem) -> RiskLevel:
        """Classify system according to EU AI Act."""

        # Check unacceptable
        unacceptable_indicators = [
            "social_scoring" in system.purpose.lower(),
            "subliminal" in system.purpose.lower(),
            "biometric_categorization_sensitive" in system.domain
        ]
        if any(unacceptable_indicators):
            return RiskLevel.UNACCEPTABLE

        # Check high-risk domains
        high_risk_domains = [
            "biometric", "critical_infrastructure", "education",
            "employment", "credit", "insurance", "law_enforcement"
        ]
        if system.domain in high_risk_domains:
            return RiskLevel.HIGH

        # Check for significant impact decisions
        if system.decision_making and system.decision_impact == "high":
            return RiskLevel.HIGH

        # Check limited risk
        if system.user_facing:
            return RiskLevel.LIMITED

        return RiskLevel.MINIMAL

    def generate_report(self) -> dict:
        """Generate inventory report."""
        return {
            "total_systems": len(self.systems),
            "by_risk_level": {
                level.value: len([s for s in self.systems if s.risk_level == level])
                for level in RiskLevel
            },
            "eu_deployed": len([s for s in self.systems if s.eu_deployment]),
            "requiring_action": [
                s.name for s in self.systems
                if s.risk_level in [RiskLevel.UNACCEPTABLE, RiskLevel.HIGH]
            ]
        }

# Example inventory
inventory = AIInventory()

inventory.add_system(AISystem(
    name="Customer Service Chatbot",
    description="AI chatbot for customer support",
    purpose="Answer customer questions",
    domain="customer_service",
    user_facing=True,
    decision_making=False,
    decision_impact="low",
    data_types=["conversation_logs", "product_info"],
    affected_users="customers",
    eu_deployment=True
))

inventory.add_system(AISystem(
    name="Resume Screening Tool",
    description="AI tool to screen job applications",
    purpose="Filter job applicants",
    domain="employment",
    user_facing=False,
    decision_making=True,
    decision_impact="high",
    data_types=["resumes", "application_data"],
    affected_users="job_applicants",
    eu_deployment=True
))

print(inventory.generate_report())
```

## Step 2: Gap Analysis

```python
class ComplianceGapAnalysis:
    """Analyze compliance gaps for high-risk systems."""

    HIGH_RISK_REQUIREMENTS = {
        "risk_management": {
            "description": "Establish risk management system",
            "checks": [
                "documented_risk_assessment",
                "risk_mitigation_measures",
                "residual_risk_acceptance",
                "ongoing_risk_monitoring"
            ]
        },
        "data_governance": {
            "description": "Data governance and management",
            "checks": [
                "training_data_documentation",
                "data_quality_measures",
                "bias_detection_procedures",
                "data_provenance_tracking"
            ]
        },
        "technical_documentation": {
            "description": "Comprehensive technical documentation",
            "checks": [
                "system_architecture_doc",
                "algorithm_description",
                "training_methodology_doc",
                "performance_metrics_doc"
            ]
        },
        "transparency": {
            "description": "Transparency to users",
            "checks": [
                "user_instructions_provided",
                "capability_limitations_documented",
                "ai_interaction_disclosure"
            ]
        },
        "human_oversight": {
            "description": "Human oversight mechanisms",
            "checks": [
                "human_review_capability",
                "intervention_mechanisms",
                "override_procedures",
                "monitoring_dashboards"
            ]
        },
        "accuracy_robustness": {
            "description": "Accuracy and robustness",
            "checks": [
                "accuracy_metrics_defined",
                "testing_procedures",
                "adversarial_testing",
                "cybersecurity_measures"
            ]
        }
    }

    def analyze_gaps(self, system: AISystem, current_state: dict) -> dict:
        """Identify compliance gaps."""
        gaps = []

        for requirement, details in self.HIGH_RISK_REQUIREMENTS.items():
            requirement_status = {
                "requirement": requirement,
                "description": details["description"],
                "checks": []
            }

            for check in details["checks"]:
                is_met = current_state.get(check, False)
                requirement_status["checks"].append({
                    "check": check,
                    "met": is_met,
                    "action_needed": not is_met
                })

            met_count = sum(1 for c in requirement_status["checks"] if c["met"])
            requirement_status["compliance_percentage"] = met_count / len(details["checks"]) * 100
            requirement_status["fully_compliant"] = met_count == len(details["checks"])

            if not requirement_status["fully_compliant"]:
                gaps.append(requirement_status)

        return {
            "system": system.name,
            "total_requirements": len(self.HIGH_RISK_REQUIREMENTS),
            "gaps_found": len(gaps),
            "compliance_percentage": (len(self.HIGH_RISK_REQUIREMENTS) - len(gaps)) / len(self.HIGH_RISK_REQUIREMENTS) * 100,
            "gaps": gaps,
            "priority_actions": self.prioritize_actions(gaps)
        }

    def prioritize_actions(self, gaps: list) -> list:
        """Prioritize remediation actions."""
        priority_order = [
            "risk_management",
            "human_oversight",
            "data_governance",
            "accuracy_robustness",
            "technical_documentation",
            "transparency"
        ]

        actions = []
        for requirement in priority_order:
            gap = next((g for g in gaps if g["requirement"] == requirement), None)
            if gap:
                for check in gap["checks"]:
                    if check["action_needed"]:
                        actions.append({
                            "action": f"Implement {check['check']}",
                            "requirement": requirement,
                            "priority": priority_order.index(requirement) + 1
                        })

        return actions[:10]  # Top 10 priorities
```

## Step 3: Implement Required Controls

```python
class HighRiskAIControls:
    """Implement required controls for high-risk AI."""

    def __init__(self, system: AISystem):
        self.system = system
        self.controls = {}

    def implement_human_oversight(self):
        """Implement human oversight capabilities."""

        class HumanOversight:
            def __init__(self, system):
                self.system = system
                self.decisions_for_review = []

            def flag_for_review(self, decision: dict, reason: str):
                """Flag AI decision for human review."""
                self.decisions_for_review.append({
                    "decision": decision,
                    "reason": reason,
                    "timestamp": datetime.now(),
                    "status": "pending_review"
                })

            def human_override(self, decision_id: str, override_value, reviewer: str):
                """Allow human to override AI decision."""
                decision = self.get_decision(decision_id)
                decision["override"] = {
                    "original_value": decision["ai_output"],
                    "override_value": override_value,
                    "reviewer": reviewer,
                    "timestamp": datetime.now()
                }
                decision["status"] = "overridden"
                return decision

            def emergency_stop(self):
                """Emergency stop for the AI system."""
                self.system.enabled = False
                self.log_emergency_stop()
                return {"status": "stopped", "timestamp": datetime.now()}

        self.controls["human_oversight"] = HumanOversight(self.system)
        return self.controls["human_oversight"]

    def implement_transparency(self):
        """Implement transparency requirements."""

        class TransparencyModule:
            def __init__(self):
                self.disclosures = {}

            def disclose_ai_interaction(self, user_id: str) -> str:
                """Disclose AI interaction to user."""
                return f"""
                NOTICE: You are interacting with an AI system.
                System: {self.system.name}
                Purpose: {self.system.purpose}
                Limitations: This AI may not always be accurate.
                Human support available upon request.
                """

            def explain_decision(self, decision: dict) -> dict:
                """Provide explanation for AI decision."""
                return {
                    "decision_made": decision["output"],
                    "factors_considered": decision.get("features", []),
                    "confidence": decision.get("confidence", 0),
                    "model_version": decision.get("model_version"),
                    "appeal_process": "Contact compliance@company.com"
                }

        self.controls["transparency"] = TransparencyModule()
        return self.controls["transparency"]

    def implement_logging(self):
        """Implement required logging."""

        class ComplianceLogger:
            def __init__(self):
                self.retention_years = 10  # High-risk AI requirement

            def log_decision(self, decision: dict):
                """Log AI decision with full audit trail."""
                log_entry = {
                    "timestamp": datetime.now().isoformat(),
                    "system": self.system.name,
                    "input": decision.get("input"),
                    "output": decision.get("output"),
                    "model_version": decision.get("model_version"),
                    "confidence": decision.get("confidence"),
                    "features_used": decision.get("features", []),
                    "human_oversight_applied": decision.get("human_reviewed", False)
                }
                self.store_securely(log_entry)

            def log_incident(self, incident: dict):
                """Log AI incidents."""
                incident_log = {
                    "timestamp": datetime.now().isoformat(),
                    "incident_type": incident["type"],
                    "description": incident["description"],
                    "impact": incident["impact"],
                    "remediation": incident.get("remediation")
                }
                self.store_securely(incident_log)
                self.notify_authorities_if_required(incident_log)

        self.controls["logging"] = ComplianceLogger()
        return self.controls["logging"]
```

## Step 4: Documentation

```python
class EUAIActDocumentation:
    """Generate required documentation."""

    def generate_conformity_assessment(self, system: AISystem) -> dict:
        """Generate conformity assessment documentation."""
        return {
            "document_type": "EU AI Act Conformity Assessment",
            "system_name": system.name,
            "assessment_date": datetime.now().isoformat(),
            "sections": {
                "1_general_information": {
                    "provider": "Company Name",
                    "system_purpose": system.purpose,
                    "intended_users": system.affected_users,
                    "deployment_regions": ["EU"]
                },
                "2_risk_management": {
                    "risk_assessment_completed": True,
                    "risks_identified": [],
                    "mitigations_implemented": [],
                    "residual_risks": []
                },
                "3_data_governance": {
                    "training_data_documented": True,
                    "bias_assessment_completed": True,
                    "data_quality_measures": []
                },
                "4_technical_documentation": {
                    "architecture_documented": True,
                    "algorithms_documented": True,
                    "performance_documented": True
                },
                "5_transparency_measures": {
                    "user_notification_implemented": True,
                    "decision_explanation_available": True
                },
                "6_human_oversight": {
                    "oversight_mechanism": "Human-in-the-loop",
                    "override_capability": True,
                    "monitoring_in_place": True
                },
                "7_accuracy_and_robustness": {
                    "accuracy_metrics": {},
                    "testing_completed": True,
                    "cybersecurity_measures": []
                }
            },
            "declaration": "This AI system conforms to EU AI Act requirements",
            "signed_by": "",
            "date": ""
        }
```

The EU AI Act is complex but manageable with systematic approach. Start your inventory now, prioritize high-risk systems, and build compliance into your development process.

## Resources

- [Official EU AI Act Text](https://eur-lex.europa.eu/eli/reg/2024/1689)
- [European Commission AI Act Guide](https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai)
- [AI Act Compliance Checklist](https://artificialintelligenceact.eu/compliance-checker/)
