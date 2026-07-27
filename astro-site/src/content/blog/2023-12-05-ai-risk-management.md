---
title: "AI Risk Management: Identifying and Mitigating AI Risks"
author: "Michael John Peña"
draft: false
date: 2023-12-05
tags: ["AI", "Risk Management", "Enterprise", "Security", "Governance"]

---

I wrote "AI Risk Management: Identifying and Mitigating AI Risks" to share practical, production-minded guidance on this topic.

AI introduces risks that cut across data, models, operations and people. Over the past year I've helped teams map those risks to concrete controls — from data lineage and model cards to runtime monitoring and human-in-the-loop checks — and this post explains the approach I find most practical.

## AI Risk Taxonomy

## AI Risk Taxonomy

```python
from dataclasses import dataclass
from typing import List, Dict, Optional
from enum import Enum

class RiskCategory(Enum):
    MODEL = "Model Risk"
    DATA = "Data Risk"
    OPERATIONAL = "Operational Risk"
    SECURITY = "Security Risk"
    COMPLIANCE = "Compliance Risk"
    REPUTATIONAL = "Reputational Risk"
    ETHICAL = "Ethical Risk"

@dataclass
class AIRisk:
    category: RiskCategory
    name: str
    description: str
    likelihood: int  # 1-5
    impact: int  # 1-5
    mitigations: List[str]
    detection_methods: List[str]

    @property
    def risk_score(self) -> int:
        return self.likelihood * self.impact

    @property
    def risk_level(self) -> str:
        score = self.risk_score
        if score >= 20:
            return "Critical"
        elif score >= 12:
            return "High"
        elif score >= 6:
            return "Medium"
        return "Low"

ai_risk_catalog = {
    RiskCategory.MODEL: [
        AIRisk(
            category=RiskCategory.MODEL,
            name="Hallucination",
            description="Model generates false or misleading information",
            likelihood=4,
            impact=4,
            mitigations=[
                "Implement fact-checking pipelines",
                "Use RAG to ground responses",
                "Add confidence scoring",
                "Human review for critical outputs"
            ],
            detection_methods=[
                "Automated fact verification",
                "User feedback analysis",
                "Output consistency checks"
            ]
        ),
        AIRisk(
            category=RiskCategory.MODEL,
            name="Bias",
            description="Model exhibits unfair bias against certain groups",
            likelihood=3,
            impact=5,
            mitigations=[
                "Regular bias audits",
                "Diverse training data",
                "Fairness constraints",
                "Representative test sets"
            ],
            detection_methods=[
                "Demographic parity testing",
                "Equal opportunity metrics",
                "Disparate impact analysis"
            ]
        ),
        AIRisk(
            category=RiskCategory.MODEL,
            name="Model Drift",
            description="Model performance degrades over time",
            likelihood=4,
            impact=3,
            mitigations=[
                "Continuous monitoring",
                "Automated retraining pipelines",
                "Performance baselines",
                "Regular model updates"
            ],
            detection_methods=[
                "Statistical drift detection",
                "Performance metric tracking",
                "Input distribution monitoring"
            ]
        )
    ],
    RiskCategory.SECURITY: [
        AIRisk(
            category=RiskCategory.SECURITY,
            name="Prompt Injection",
            description="Malicious inputs manipulate model behavior",
            likelihood=4,
            impact=4,
            mitigations=[
                "Input sanitization",
                "Prompt hardening",
                "Output filtering",
                "Rate limiting"
            ],
            detection_methods=[
                "Pattern matching for injection attempts",
                "Anomaly detection on inputs",
                "Output behavior analysis"
            ]
        ),
        AIRisk(
            category=RiskCategory.SECURITY,
            name="Data Leakage",
            description="Model reveals sensitive training data or context",
            likelihood=3,
            impact=5,
            mitigations=[
                "Output filtering for PII",
                "Context isolation",
                "Differential privacy",
                "Response auditing"
            ],
            detection_methods=[
                "PII detection scanning",
                "Training data extraction tests",
                "Output pattern analysis"
            ]
        )
    ],
    RiskCategory.OPERATIONAL: [
        AIRisk(
            category=RiskCategory.OPERATIONAL,
            name="Service Availability",
            description="AI service becomes unavailable affecting operations",
            likelihood=3,
            impact=4,
            mitigations=[
                "Redundant deployments",
                "Fallback mechanisms",
                "Graceful degradation",
                "SLA monitoring"
            ],
            detection_methods=[
                "Uptime monitoring",
                "Health checks",
                "Alert systems"
            ]
        )
    ]
}
```

## Risk Assessment Process

```python
class AIRiskAssessment:
    """Conduct comprehensive AI risk assessments."""

    def __init__(self):
        self.assessments: Dict[str, Dict] = {}

    def create_assessment(
        self,
        system_name: str,
        system_description: str,
        assessor: str
    ) -> str:
        """Create a new risk assessment."""
        import uuid
        assessment_id = str(uuid.uuid4())[:8]

        self.assessments[assessment_id] = {
            "system_name": system_name,
            "description": system_description,
            "assessor": assessor,
            "created_at": datetime.now(),
            "status": "In Progress",
            "identified_risks": [],
            "risk_score_total": 0
        }

        return assessment_id

    def identify_risks(
        self,
        assessment_id: str,
        use_case_details: Dict
    ) -> List[AIRisk]:
        """Identify applicable risks based on use case."""
        identified = []

        # Customer-facing systems have higher reputational risk
        if use_case_details.get("customer_facing"):
            for risk in ai_risk_catalog[RiskCategory.REPUTATIONAL]:
                risk.impact = min(risk.impact + 1, 5)  # Increase impact
                identified.append(risk)

        # Systems handling PII have higher data and compliance risk
        if use_case_details.get("handles_pii"):
            identified.extend(ai_risk_catalog[RiskCategory.DATA])
            identified.extend(ai_risk_catalog[RiskCategory.COMPLIANCE])

        # All systems have model and operational risks
        identified.extend(ai_risk_catalog[RiskCategory.MODEL])
        identified.extend(ai_risk_catalog[RiskCategory.OPERATIONAL])
        identified.extend(ai_risk_catalog[RiskCategory.SECURITY])

        self.assessments[assessment_id]["identified_risks"] = identified

        return identified

    def calculate_overall_risk(self, assessment_id: str) -> Dict:
        """Calculate overall risk profile."""
        risks = self.assessments[assessment_id]["identified_risks"]

        risk_summary = {
            "total_risks": len(risks),
            "by_level": {"Critical": 0, "High": 0, "Medium": 0, "Low": 0},
            "by_category": {},
            "top_risks": [],
            "overall_score": 0
        }

        for risk in risks:
            risk_summary["by_level"][risk.risk_level] += 1

            cat = risk.category.value
            if cat not in risk_summary["by_category"]:
                risk_summary["by_category"][cat] = 0
            risk_summary["by_category"][cat] += risk.risk_score

            risk_summary["overall_score"] += risk.risk_score

        # Top 5 risks
        sorted_risks = sorted(risks, key=lambda r: r.risk_score, reverse=True)
        risk_summary["top_risks"] = [
            {"name": r.name, "score": r.risk_score, "level": r.risk_level}
            for r in sorted_risks[:5]
        ]

        self.assessments[assessment_id]["risk_summary"] = risk_summary

        return risk_summary

    def generate_mitigation_plan(self, assessment_id: str) -> str:
        """Generate mitigation plan for identified risks."""
        risks = self.assessments[assessment_id]["identified_risks"]
        high_risks = [r for r in risks if r.risk_level in ["Critical", "High"]]

        plan = "# Risk Mitigation Plan\n\n"
        plan += f"Assessment ID: {assessment_id}\n"
        plan += f"Generated: {datetime.now().strftime('%Y-%m-%d')}\n\n"

        plan += "## Priority Mitigations\n\n"

        for risk in high_risks:
            plan += f"### {risk.name} ({risk.risk_level})\n\n"
            plan += f"**Category:** {risk.category.value}\n"
            plan += f"**Risk Score:** {risk.risk_score}\n\n"
            plan += "**Required Mitigations:**\n"
            for mitigation in risk.mitigations:
                plan += f"- [ ] {mitigation}\n"
            plan += "\n**Detection Methods:**\n"
            for method in risk.detection_methods:
                plan += f"- {method}\n"
            plan += "\n---\n\n"

        return plan
```

## Continuous Risk Monitoring

```python
class RiskMonitor:
    """Continuous monitoring of AI risks."""

    def __init__(self):
        self.alerts: List[Dict] = []
        self.metrics: Dict[str, List] = {}

    def monitor_hallucination_rate(
        self,
        system_id: str,
        responses: List[Dict],
        threshold: float = 0.05
    ) -> Dict:
        """Monitor hallucination rate."""
        flagged = sum(1 for r in responses if r.get("verified") == False)
        rate = flagged / len(responses) if responses else 0

        result = {
            "system_id": system_id,
            "metric": "hallucination_rate",
            "value": rate,
            "threshold": threshold,
            "status": "Alert" if rate > threshold else "Normal"
        }

        if rate > threshold:
            self.alerts.append({
                "system_id": system_id,
                "alert_type": "Hallucination Rate Exceeded",
                "value": rate,
                "timestamp": datetime.now()
            })

        return result

    def monitor_bias_metrics(
        self,
        system_id: str,
        outcomes: Dict[str, Dict],
        tolerance: float = 0.1
    ) -> Dict:
        """Monitor for bias in outcomes."""
        results = {"system_id": system_id, "groups": {}}

        baseline_rate = sum(g["positive_rate"] for g in outcomes.values()) / len(outcomes)

        for group, data in outcomes.items():
            deviation = abs(data["positive_rate"] - baseline_rate)
            results["groups"][group] = {
                "positive_rate": data["positive_rate"],
                "deviation_from_baseline": deviation,
                "status": "Alert" if deviation > tolerance else "Normal"
            }

            if deviation > tolerance:
                self.alerts.append({
                    "system_id": system_id,
                    "alert_type": "Potential Bias Detected",
                    "group": group,
                    "deviation": deviation,
                    "timestamp": datetime.now()
                })

        return results

    def get_risk_dashboard(self) -> Dict:
        """Generate risk monitoring dashboard."""
        return {
            "active_alerts": len([a for a in self.alerts if a.get("resolved") != True]),
            "recent_alerts": self.alerts[-10:],
            "metrics_tracked": list(self.metrics.keys()),
            "last_updated": datetime.now()
        }
```

Tomorrow, we'll explore model risk and how to manage it specifically for LLMs!\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
