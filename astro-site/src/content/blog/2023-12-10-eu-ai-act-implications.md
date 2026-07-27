---
title: "EU AI Act: Preparing for the World's First AI Law"
author: "Michael John Peña"
draft: false
date: 2023-12-10
tags: ["EU AI Act", "Regulation", "Compliance", "AI Governance", "Europe"]

---

I wrote "EU AI Act: Preparing for the World's First AI Law" to share practical, production-minded guidance on this topic.

The EU AI Act signals a shift from voluntary standards to enforceable obligations; product teams need a simple classification step (is this high-risk?) and a checklist of requirements for high-risk systems. Even non-EU deployments must assess exposure due to cross-border data flows.

## Understanding the Risk-Based Framework

## Understanding the Risk-Based Framework

```python
from dataclasses import dataclass, field
from typing import List, Dict, Optional
from enum import Enum

class AIActRiskLevel(Enum):
    UNACCEPTABLE = "Unacceptable Risk (Prohibited)"
    HIGH = "High Risk"
    LIMITED = "Limited Risk (Transparency)"
    MINIMAL = "Minimal Risk"

@dataclass
class AIActRequirement:
    risk_level: AIActRiskLevel
    description: str
    requirements: List[str]
    timeline: str
    penalties: str

ai_act_framework = {
    AIActRiskLevel.UNACCEPTABLE: AIActRequirement(
        risk_level=AIActRiskLevel.UNACCEPTABLE,
        description="AI systems that pose unacceptable risks are banned",
        requirements=[
            "Social scoring by governments",
            "Real-time biometric identification in public spaces (with exceptions)",
            "AI exploiting vulnerabilities of specific groups",
            "Subliminal manipulation causing harm"
        ],
        timeline="Immediately upon enforcement",
        penalties="Up to 35M EUR or 7% of global annual turnover"
    ),
    AIActRiskLevel.HIGH: AIActRequirement(
        risk_level=AIActRiskLevel.HIGH,
        description="AI systems with significant impact on fundamental rights",
        requirements=[
            "Risk management system",
            "Data governance measures",
            "Technical documentation",
            "Record-keeping",
            "Transparency to users",
            "Human oversight",
            "Accuracy, robustness, cybersecurity",
            "Quality management system",
            "Conformity assessment"
        ],
        timeline="24 months after enforcement",
        penalties="Up to 15M EUR or 3% of global annual turnover"
    ),
    AIActRiskLevel.LIMITED: AIActRequirement(
        risk_level=AIActRiskLevel.LIMITED,
        description="AI systems that interact with humans must be transparent",
        requirements=[
            "Notify users they're interacting with AI",
            "Label AI-generated content",
            "Disclose emotion recognition or biometric categorization"
        ],
        timeline="24 months after enforcement",
        penalties="Up to 7.5M EUR or 1.5% of global annual turnover"
    ),
    AIActRiskLevel.MINIMAL: AIActRequirement(
        risk_level=AIActRiskLevel.MINIMAL,
        description="Most AI systems with minimal regulation",
        requirements=[
            "Voluntary codes of conduct encouraged",
            "Best practices recommended"
        ],
        timeline="N/A",
        penalties="N/A"
    )
}
```

## High-Risk AI Use Cases

```python
high_risk_categories = {
    "biometric_identification": {
        "examples": [
            "Remote biometric identification",
            "Biometric categorization by sensitive attributes",
            "Emotion recognition in workplace/education"
        ],
        "additional_requirements": [
            "Prior authorization for law enforcement use",
            "Logging of all uses",
            "Human verification of results"
        ]
    },
    "critical_infrastructure": {
        "examples": [
            "AI managing electricity/gas/water",
            "Traffic management AI",
            "Digital infrastructure management"
        ],
        "additional_requirements": [
            "Safety certification",
            "Continuous monitoring",
            "Incident reporting"
        ]
    },
    "education_vocational": {
        "examples": [
            "Student admission decisions",
            "Assessment and grading",
            "Learning behavior monitoring",
            "Proctoring systems"
        ],
        "additional_requirements": [
            "Non-discrimination testing",
            "Appeal mechanisms",
            "Human oversight for final decisions"
        ]
    },
    "employment": {
        "examples": [
            "CV screening",
            "Interview analysis",
            "Performance evaluation",
            "Promotion decisions"
        ],
        "additional_requirements": [
            "Impact assessment on workers",
            "Works council consultation",
            "Transparency to employees"
        ]
    },
    "essential_services": {
        "examples": [
            "Credit scoring",
            "Insurance risk assessment",
            "Benefit eligibility determination"
        ],
        "additional_requirements": [
            "Explanation of decisions",
            "Human review on request",
            "Non-discrimination monitoring"
        ]
    },
    "law_enforcement": {
        "examples": [
            "Individual risk assessment",
            "Polygraphs and similar",
            "Evidence evaluation",
            "Crime prediction"
        ],
        "additional_requirements": [
            "Judicial oversight",
            "Strict logging",
            "Regular audits"
        ]
    }
}

def classify_use_case(description: str, context: Dict) -> Dict:
    """Classify an AI use case under EU AI Act."""
    result = {
        "description": description,
        "risk_level": None,
        "category": None,
        "requirements": [],
        "reasoning": ""
    }

    # Check for prohibited uses
    prohibited_indicators = [
        "social_scoring",
        "subliminal_manipulation",
        "exploit_vulnerabilities"
    ]

    if any(context.get(ind) for ind in prohibited_indicators):
        result["risk_level"] = AIActRiskLevel.UNACCEPTABLE
        result["reasoning"] = "Use case falls under prohibited AI practices"
        return result

    # Check for high-risk categories
    for category, details in high_risk_categories.items():
        for example in details["examples"]:
            if example.lower() in description.lower():
                result["risk_level"] = AIActRiskLevel.HIGH
                result["category"] = category
                result["requirements"] = (
                    ai_act_framework[AIActRiskLevel.HIGH].requirements +
                    details["additional_requirements"]
                )
                result["reasoning"] = f"Matches high-risk category: {category}"
                return result

    # Check for transparency requirements
    if context.get("interacts_with_humans") or context.get("generates_content"):
        result["risk_level"] = AIActRiskLevel.LIMITED
        result["requirements"] = ai_act_framework[AIActRiskLevel.LIMITED].requirements
        result["reasoning"] = "Requires transparency under Article 52"
        return result

    # Default to minimal risk
    result["risk_level"] = AIActRiskLevel.MINIMAL
    result["reasoning"] = "Does not fall under regulated categories"

    return result
```

## Compliance Preparation Checklist

```python
@dataclass
class ComplianceChecklist:
    organization: str
    ai_systems: List[Dict]
    preparation_status: Dict[str, bool] = field(default_factory=dict)

    def __post_init__(self):
        self.preparation_status = {
            "ai_inventory": False,
            "risk_classification": False,
            "gap_analysis": False,
            "documentation_framework": False,
            "quality_management": False,
            "human_oversight_procedures": False,
            "technical_measures": False,
            "conformity_assessment_plan": False,
            "incident_response": False,
            "training_program": False
        }

    def create_ai_inventory(self) -> Dict:
        """Create inventory of all AI systems."""
        return {
            "step": "AI System Inventory",
            "actions": [
                "Identify all AI/ML systems in use",
                "Document purpose and functionality",
                "Identify data inputs and outputs",
                "Map system owners and stakeholders",
                "Determine geographic scope of deployment"
            ],
            "template": {
                "system_name": "",
                "description": "",
                "purpose": "",
                "data_processed": [],
                "deployment_regions": [],
                "owner": "",
                "vendor": "",
                "users_affected": ""
            }
        }

    def conduct_gap_analysis(self, system: Dict) -> Dict:
        """Analyze gaps against AI Act requirements."""
        classification = classify_use_case(
            system.get("description", ""),
            system
        )

        gaps = []
        if classification["risk_level"] == AIActRiskLevel.HIGH:
            required = ai_act_framework[AIActRiskLevel.HIGH].requirements

            for req in required:
                if not system.get(f"has_{req.lower().replace(' ', '_')}"):
                    gaps.append({
                        "requirement": req,
                        "current_state": "Not implemented",
                        "priority": "High",
                        "estimated_effort": "TBD"
                    })

        return {
            "system": system.get("system_name"),
            "risk_level": classification["risk_level"].value,
            "gaps_identified": len(gaps),
            "gaps": gaps
        }

    def generate_roadmap(self) -> str:
        """Generate compliance roadmap."""
        roadmap = """
# EU AI Act Compliance Roadmap

## Phase 1: Discovery (Months 1-3)
- [ ] Complete AI system inventory
- [ ] Classify all systems by risk level
- [ ] Conduct initial gap analysis
- [ ] Identify high-priority systems

## Phase 2: Foundation (Months 4-6)
- [ ] Establish documentation framework
- [ ] Create quality management system outline
- [ ] Define human oversight procedures
- [ ] Begin technical documentation

## Phase 3: Implementation (Months 7-12)
- [ ] Implement technical requirements for high-risk systems
- [ ] Develop conformity assessment procedures
- [ ] Create incident response procedures
- [ ] Train relevant personnel

## Phase 4: Validation (Months 13-18)
- [ ] Internal audits
- [ ] Conformity assessments
- [ ] Documentation review
- [ ] Remediation of findings

## Phase 5: Maintenance (Ongoing)
- [ ] Continuous monitoring
- [ ] Regular reviews and updates
- [ ] Post-market surveillance
- [ ] Incident management
"""
        return roadmap

    def get_compliance_score(self) -> float:
        """Calculate overall compliance preparation score."""
        completed = sum(1 for v in self.preparation_status.values() if v)
        return completed / len(self.preparation_status)
```

## Key Dates and Timeline

```python
ai_act_timeline = {
    "2024_Q1": "Expected final text adoption",
    "2024_Q2": "Publication in Official Journal",
    "2024_Q4": "Entry into force (20 days after publication)",
    "2025_Q2": "Prohibited AI practices enforcement (6 months)",
    "2025_Q4": "GPAI rules apply (12 months)",
    "2026_Q4": "High-risk AI requirements (24 months)",
    "2027_Q4": "Full enforcement including Annex I systems (36 months)"
}

def get_time_to_compliance(risk_level: AIActRiskLevel) -> str:
    """Calculate time remaining to compliance."""
    deadlines = {
        AIActRiskLevel.UNACCEPTABLE: "6 months after entry into force",
        AIActRiskLevel.HIGH: "24 months after entry into force",
        AIActRiskLevel.LIMITED: "24 months after entry into force",
        AIActRiskLevel.MINIMAL: "No mandatory deadline"
    }
    return deadlines.get(risk_level, "Unknown")
```

Tomorrow, we'll explore responsible AI practices and how to implement them!\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
