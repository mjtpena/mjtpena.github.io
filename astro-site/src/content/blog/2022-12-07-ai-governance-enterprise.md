---
title: "AI Governance for Enterprise: Policies and Practices"
author: Michael John Peña
draft: false
date: 2022-12-07
tags:
  - AI
  - Governance
  - Enterprise
  - Compliance
  - Risk Management

---

I wrote "AI Governance for Enterprise: Policies and Practices" to share practical, production-minded guidance on this topic.

## The Governance Challenge

AI governance must balance:
- **Innovation**: Enabling teams to use AI effectively
- **Risk**: Managing security, privacy, and compliance risks
- **Consistency**: Ensuring organization-wide standards
- **Accountability**: Clear ownership and responsibility

## Governance Framework

### 1. Policy Foundation

```yaml
# ai-governance-policy.yaml
policy:
  name: Enterprise AI Usage Policy
  version: 1.0
  effective_date: 2022-12-01
  owner: Chief Data Officer

  scope:
    - All AI/ML models developed internally
    - Third-party AI services (including ChatGPT, Copilot)
    - AI features embedded in products

  classification:
    levels:
      - name: Experimental
        description: Internal testing only
        approval: Team Lead
        review_cycle: None

      - name: Internal
        description: Used by employees only
        approval: Department Head
        review_cycle: Quarterly

      - name: Customer-Facing
        description: Impacts external users
        approval: AI Ethics Board
        review_cycle: Monthly

      - name: Regulated
        description: Subject to compliance requirements
        approval: Legal + Compliance + AI Ethics Board
        review_cycle: Continuous

  prohibited_uses:
    - Automated decisions affecting employment
    - Credit scoring without human review
    - Processing protected health information without consent
    - Surveillance of employees
    - Any use violating applicable laws

  data_requirements:
    - No PII in prompts to external AI services
    - Training data must be documented
    - Data retention policies must be followed
    - Cross-border data transfer restrictions apply
```

### 2. Risk Assessment Framework

```python
from enum import Enum
from dataclasses import dataclass
from typing import List

class RiskLevel(Enum):
    LOW = 1
    MEDIUM = 2
    HIGH = 3
    CRITICAL = 4

@dataclass
class AIRiskAssessment:
    system_name: str
    description: str

    # Impact factors
    affects_individuals: bool
    financial_impact: bool
    regulatory_scope: bool
    data_sensitivity: str  # public, internal, confidential, restricted
    automation_level: str  # advisory, assisted, autonomous

    # Risk scores
    fairness_risk: RiskLevel
    privacy_risk: RiskLevel
    security_risk: RiskLevel
    reliability_risk: RiskLevel
    transparency_risk: RiskLevel

    @property
    def overall_risk(self) -> RiskLevel:
        scores = [
            self.fairness_risk,
            self.privacy_risk,
            self.security_risk,
            self.reliability_risk,
            self.transparency_risk
        ]
        max_score = max(s.value for s in scores)
        return RiskLevel(max_score)

    @property
    def required_controls(self) -> List[str]:
        controls = []

        if self.fairness_risk.value >= RiskLevel.MEDIUM.value:
            controls.append("Bias testing and monitoring")
            controls.append("Fairness evaluation across protected groups")

        if self.privacy_risk.value >= RiskLevel.MEDIUM.value:
            controls.append("Privacy impact assessment")
            controls.append("Data minimization review")

        if self.security_risk.value >= RiskLevel.MEDIUM.value:
            controls.append("Security review")
            controls.append("Penetration testing")

        if self.reliability_risk.value >= RiskLevel.MEDIUM.value:
            controls.append("Performance benchmarking")
            controls.append("Fallback mechanism")

        if self.transparency_risk.value >= RiskLevel.MEDIUM.value:
            controls.append("Explainability implementation")
            controls.append("User disclosure requirements")

        if self.overall_risk == RiskLevel.CRITICAL:
            controls.append("Executive approval")
            controls.append("External audit")
            controls.append("Continuous monitoring")

        return controls
```

### 3. Approval Workflow

```python
from typing import Optional
from datetime import datetime

class AIApprovalWorkflow:
    def __init__(self, risk_assessment: AIRiskAssessment):
        self.risk_assessment = risk_assessment
        self.approvals = []
        self.status = "pending"

    def get_required_approvers(self) -> List[str]:
        """Determine required approvers based on risk level."""
        risk = self.risk_assessment.overall_risk

        if risk == RiskLevel.LOW:
            return ["team_lead"]
        elif risk == RiskLevel.MEDIUM:
            return ["team_lead", "security_team"]
        elif risk == RiskLevel.HIGH:
            return ["team_lead", "security_team", "legal", "ai_ethics_board"]
        else:  # CRITICAL
            return ["team_lead", "security_team", "legal", "ai_ethics_board", "cdo"]

    def submit_for_approval(self, submitted_by: str):
        """Submit the AI system for approval."""
        self.status = "in_review"
        self._notify_approvers()
        self._create_audit_record("submitted", submitted_by)

    def approve(self, approver: str, comments: Optional[str] = None):
        """Record an approval."""
        if approver not in self.get_required_approvers():
            raise ValueError(f"{approver} is not a required approver")

        self.approvals.append({
            "approver": approver,
            "action": "approved",
            "timestamp": datetime.utcnow(),
            "comments": comments
        })

        if self._all_approvals_received():
            self.status = "approved"
            self._notify_submitter("approved")

    def reject(self, approver: str, reason: str):
        """Reject the AI system."""
        self.approvals.append({
            "approver": approver,
            "action": "rejected",
            "timestamp": datetime.utcnow(),
            "comments": reason
        })
        self.status = "rejected"
        self._notify_submitter("rejected")

    def _all_approvals_received(self) -> bool:
        required = set(self.get_required_approvers())
        received = set(a["approver"] for a in self.approvals if a["action"] == "approved")
        return required.issubset(received)
```

### 4. Monitoring and Compliance

```python
from azure.monitor.query import LogsQueryClient
from datetime import timedelta

class AIComplianceMonitor:
    def __init__(self, workspace_id: str):
        self.workspace_id = workspace_id
        self.client = LogsQueryClient(DefaultAzureCredential())

    def check_data_leakage(self, ai_system_id: str) -> dict:
        """Check for potential data leakage in AI requests."""

        query = f"""
        AIRequests
        | where SystemId == "{ai_system_id}"
        | where TimeGenerated > ago(24h)
        | extend HasPII = extract(@"\\b[A-Z][a-z]+ [A-Z][a-z]+\\b", 0, RequestContent) != ""
               or extract(@"\\b\\d{{3}}-\\d{{2}}-\\d{{4}}\\b", 0, RequestContent) != ""
               or extract(@"\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{{2,}}\\b", 0, RequestContent) != ""
        | summarize
            TotalRequests = count(),
            PotentialPIIRequests = countif(HasPII),
            PIIPercentage = round(100.0 * countif(HasPII) / count(), 2)
        """

        result = self.client.query_workspace(
            self.workspace_id,
            query,
            timespan=timedelta(days=1)
        )

        return {
            "total_requests": result.tables[0].rows[0][0],
            "potential_pii_requests": result.tables[0].rows[0][1],
            "pii_percentage": result.tables[0].rows[0][2],
            "compliant": result.tables[0].rows[0][2] < 1.0  # Less than 1% threshold
        }

    def check_usage_patterns(self, ai_system_id: str) -> dict:
        """Monitor for unusual usage patterns."""

        query = f"""
        AIRequests
        | where SystemId == "{ai_system_id}"
        | where TimeGenerated > ago(7d)
        | summarize
            AvgRequestsPerHour = count() / 168.0,
            MaxRequestsInHour = max(RequestCount),
            UniqueUsers = dcount(UserId),
            ErrorRate = round(100.0 * countif(ResponseCode >= 400) / count(), 2)
            by bin(TimeGenerated, 1h)
        | summarize
            AvgHourly = avg(AvgRequestsPerHour),
            PeakHourly = max(MaxRequestsInHour),
            AvgUsers = avg(UniqueUsers),
            AvgErrorRate = avg(ErrorRate)
        """

        result = self.client.query_workspace(
            self.workspace_id,
            query,
            timespan=timedelta(days=7)
        )

        return dict(zip(
            ["avg_hourly", "peak_hourly", "avg_users", "avg_error_rate"],
            result.tables[0].rows[0]
        ))
```

### 5. Training and Awareness

```yaml
# ai-training-program.yaml
training_program:
  name: Enterprise AI Literacy
  modules:
    - name: AI Fundamentals
      audience: All employees
      duration: 1 hour
      topics:
        - What is AI and how it works
        - Common AI applications
        - Limitations and risks
      frequency: Once + annual refresher

    - name: Responsible AI Use
      audience: AI users
      duration: 2 hours
      topics:
        - Company AI policies
        - Data handling requirements
        - Recognizing AI limitations
        - Reporting concerns
      frequency: Before first use + annual

    - name: AI Development Standards
      audience: Developers
      duration: 4 hours
      topics:
        - AI development lifecycle
        - Testing and validation
        - Fairness and bias
        - Documentation requirements
      frequency: Before development + biannual

    - name: AI Ethics and Governance
      audience: Leaders and AI Ethics Board
      duration: 8 hours
      topics:
        - Ethical frameworks
        - Regulatory landscape
        - Risk assessment
        - Incident response
      frequency: Annual + as needed
```

## ChatGPT-Specific Governance

```yaml
# chatgpt-usage-policy.yaml
policy:
  name: ChatGPT and External AI Services Policy

  approved_uses:
    - Code assistance and review
    - Documentation drafting
    - Learning and research
    - Brainstorming and ideation

  prohibited_uses:
    - Processing customer data
    - Sharing proprietary code or algorithms
    - Making business decisions
    - Creating customer-facing content without review

  requirements:
    - Review all output before use
    - Do not share confidential information
    - Disclose AI assistance when required
    - Report concerning outputs to security team

  data_restrictions:
    - No customer PII
    - No employee PII
    - No financial data
    - No intellectual property
    - No security credentials or keys

  monitoring:
    - Usage tracked via enterprise browser extension
    - Periodic audits of AI-assisted work
    - Incident reporting required
```

## Conclusion

AI governance isn't about blocking innovation - it's about enabling it safely. With clear policies, risk-based controls, and ongoing monitoring, organizations can harness AI's benefits while managing its risks. Start with foundational policies and evolve as your AI usage matures.

## Resources

- [NIST AI Risk Management Framework](https://www.nist.gov/itl/ai-risk-management-framework)
- [EU AI Act](https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai)
- [Microsoft Responsible AI Resources](https://www.microsoft.com/en-us/ai/responsible-ai-resources)

