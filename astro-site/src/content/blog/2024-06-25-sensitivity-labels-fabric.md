---
title: "Sensitivity Labels and Data Classification in Microsoft Fabric"
description: "Sensitivity labels help classify and protect data based on its sensitivity level. Today I'm exploring how to implement data classification in Microsoft Fabric."
author: Michael John Peña
draft: false
date: 2024-06-25
tags:
  - Microsoft Fabric
  - Sensitivity Labels
  - Data Classification
  - Microsoft Purview
  - Compliance
---

Sensitivity labels help classify and protect data based on its sensitivity level. Today I'm exploring how to implement data classification in Microsoft Fabric.

## Sensitivity Labels Overview

```
Sensitivity Label Hierarchy:
├── Public
│   └── No restrictions
├── General
│   └── Internal business data
├── Confidential
│   ├── Employee data
│   ├── Financial data
│   └── Business strategies
├── Highly Confidential
│   ├── PII / PHI
│   ├── Trade secrets
│   └── Regulated data
└── Restricted
    └── Critical secrets
```

## Label Configuration

```python
from dataclasses import dataclass
from typing import List, Dict, Optional
from enum import Enum

class LabelScope(Enum):
    FILES = "files"
    EMAILS = "emails"
    MEETINGS = "meetings"
    FABRIC_ITEMS = "fabricItems"
    SCHEMATIZED_DATA = "schematizedData"

@dataclass
class SensitivityLabelConfig:
    label_id: str
    name: str
    description: str
    tooltip: str
    priority: int  # Lower = more sensitive
    scope: List[LabelScope]
    protection_settings: Dict
    auto_labeling: Optional[Dict] = None

class SensitivityLabelManager:
    """Manage sensitivity labels in Fabric."""

    def __init__(self, purview_client, fabric_client):
        self.purview = purview_client
        self.fabric = fabric_client

    def create_label(self, config: SensitivityLabelConfig):
        """Create a new sensitivity label."""
        label = self.purview.labels.create(
            name=config.name,
            display_name=config.name,
            description=config.description,
            tooltip=config.tooltip,
            priority=config.priority,
            scope=[s.value for s in config.scope],
            settings=config.protection_settings
        )

        # Configure auto-labeling if specified
        if config.auto_labeling:
            self._configure_auto_labeling(label.id, config.auto_labeling)

        return label

    def apply_label_to_item(
        self,
        workspace_id: str,
        item_id: str,
        label_id: str,
        justification: str = None
    ):
        """Apply sensitivity label to a Fabric item."""
        return self.fabric.items.update_sensitivity_label(
            workspace_id=workspace_id,
            item_id=item_id,
            label_id=label_id,
            justification=justification
        )

    def apply_label_bulk(
        self,
        workspace_id: str,
        items: List[str],
        label_id: str
    ):
        """Apply label to multiple items."""
        results = []
        for item_id in items:
            result = self.apply_label_to_item(
                workspace_id=workspace_id,
                item_id=item_id,
                label_id=label_id
            )
            results.append(result)
        return results

    def get_label_statistics(self, workspace_id: str = None) -> dict:
        """Get statistics on label usage."""
        items = self.fabric.items.list(workspace_id=workspace_id)

        stats = {
            "total_items": 0,
            "labeled_items": 0,
            "unlabeled_items": 0,
            "by_label": {}
        }

        for item in items:
            stats["total_items"] += 1
            if item.sensitivity_label:
                stats["labeled_items"] += 1
                label_name = item.sensitivity_label.name
                stats["by_label"][label_name] = stats["by_label"].get(label_name, 0) + 1
            else:
                stats["unlabeled_items"] += 1

        return stats

    def _configure_auto_labeling(self, label_id: str, config: dict):
        """Configure auto-labeling rules."""
        self.purview.auto_labeling.create_policy(
            label_id=label_id,
            conditions=config.get("conditions", []),
            actions=config.get("actions", ["apply_label"])
        )

# Usage
label_mgr = SensitivityLabelManager(purview_client, fabric_client)

# Create Confidential label
confidential_config = SensitivityLabelConfig(
    label_id="conf-001",
    name="Confidential",
    description="Confidential business data",
    tooltip="Apply to internal business data that should not be shared externally",
    priority=2,
    scope=[LabelScope.FABRIC_ITEMS, LabelScope.SCHEMATIZED_DATA],
    protection_settings={
        "encryptionEnabled": True,
        "contentMarking": {
            "headerText": "CONFIDENTIAL",
            "footerText": "Internal Use Only"
        }
    }
)

label_mgr.create_label(confidential_config)
```

## Auto-Labeling Policies

```python
class AutoLabelingPolicy:
    """Configure automatic labeling based on content."""

    def __init__(self, purview_client):
        self.purview = purview_client

    def create_sensitive_info_policy(
        self,
        policy_name: str,
        label_id: str,
        sensitive_info_types: List[str],
        min_count: int = 1
    ):
        """Create policy based on sensitive information types."""
        return self.purview.auto_labeling.create(
            name=policy_name,
            label_id=label_id,
            conditions={
                "sensitiveInfoTypes": [
                    {
                        "id": sit,
                        "minCount": min_count,
                        "minConfidence": 75
                    }
                    for sit in sensitive_info_types
                ]
            },
            scope={
                "locations": ["OneDrive", "SharePoint", "Fabric"]
            }
        )

    def create_keyword_policy(
        self,
        policy_name: str,
        label_id: str,
        keywords: List[str]
    ):
        """Create policy based on keywords."""
        return self.purview.auto_labeling.create(
            name=policy_name,
            label_id=label_id,
            conditions={
                "keywords": keywords
            }
        )

    def create_column_pattern_policy(
        self,
        policy_name: str,
        label_id: str,
        column_patterns: List[str]
    ):
        """Create policy based on column names in schematized data."""
        return self.purview.auto_labeling.create(
            name=policy_name,
            label_id=label_id,
            conditions={
                "columnNamePatterns": column_patterns
            },
            scope={
                "locations": ["Fabric"],
                "itemTypes": ["Lakehouse", "Warehouse", "Dataset"]
            }
        )

# Usage
auto_labeling = AutoLabelingPolicy(purview_client)

# Label data containing SSN
auto_labeling.create_sensitive_info_policy(
    policy_name="PII-SSN-Detection",
    label_id="highly-confidential-pii",
    sensitive_info_types=[
        "US Social Security Number (SSN)",
        "US Driver's License Number",
        "US Passport Number"
    ],
    min_count=1
)

# Label data with PII column names
auto_labeling.create_column_pattern_policy(
    policy_name="PII-Column-Detection",
    label_id="highly-confidential-pii",
    column_patterns=[
        "*ssn*",
        "*social_security*",
        "*passport*",
        "*driver_license*",
        "*credit_card*"
    ]
)
```

## Data Classification Scanning

```python
class DataClassificationScanner:
    """Scan data for classification."""

    def __init__(self, fabric_client, purview_client):
        self.fabric = fabric_client
        self.purview = purview_client

    def scan_lakehouse(
        self,
        workspace_id: str,
        lakehouse_id: str
    ) -> dict:
        """Scan lakehouse for sensitive data."""
        tables = self.fabric.lakehouses.list_tables(
            workspace_id=workspace_id,
            lakehouse_id=lakehouse_id
        )

        scan_results = {
            "lakehouse_id": lakehouse_id,
            "tables_scanned": 0,
            "findings": []
        }

        for table in tables:
            table_findings = self._scan_table(
                workspace_id, lakehouse_id, table.name
            )
            scan_results["tables_scanned"] += 1
            if table_findings:
                scan_results["findings"].extend(table_findings)

        return scan_results

    def _scan_table(
        self,
        workspace_id: str,
        lakehouse_id: str,
        table_name: str
    ) -> List[dict]:
        """Scan a single table for sensitive data."""
        findings = []

        # Get sample data
        sample = self.fabric.lakehouses.query(
            workspace_id=workspace_id,
            lakehouse_id=lakehouse_id,
            query=f"SELECT * FROM {table_name} LIMIT 1000"
        )

        # Get schema
        schema = self.fabric.lakehouses.get_table_schema(
            workspace_id=workspace_id,
            lakehouse_id=lakehouse_id,
            table_name=table_name
        )

        # Check column names for PII patterns
        pii_patterns = [
            ("ssn", "Social Security Number"),
            ("email", "Email Address"),
            ("phone", "Phone Number"),
            ("address", "Physical Address"),
            ("dob", "Date of Birth"),
            ("birth", "Date of Birth"),
            ("salary", "Financial Data"),
            ("credit", "Credit Card")
        ]

        for column in schema.columns:
            col_lower = column.name.lower()
            for pattern, category in pii_patterns:
                if pattern in col_lower:
                    findings.append({
                        "table": table_name,
                        "column": column.name,
                        "category": category,
                        "confidence": "high",
                        "suggested_label": self._suggest_label(category)
                    })

        # Use Purview to scan sample data
        data_findings = self.purview.scan.analyze_content(
            content=sample.to_dict(),
            content_type="structured_data"
        )

        for finding in data_findings:
            findings.append({
                "table": table_name,
                "column": finding["column"],
                "category": finding["sensitiveInfoType"],
                "confidence": finding["confidence"],
                "sample_matches": finding.get("matches", [])[:3],
                "suggested_label": self._suggest_label(finding["sensitiveInfoType"])
            })

        return findings

    def _suggest_label(self, category: str) -> str:
        """Suggest appropriate sensitivity label."""
        high_sensitivity = [
            "Social Security Number",
            "Credit Card",
            "Bank Account",
            "Health Information"
        ]

        if category in high_sensitivity:
            return "Highly Confidential"
        elif "Financial" in category or "Personal" in category:
            return "Confidential"
        else:
            return "General"

    def generate_classification_report(
        self,
        workspace_id: str
    ) -> dict:
        """Generate classification report for workspace."""
        items = self.fabric.items.list(workspace_id=workspace_id)

        report = {
            "workspace_id": workspace_id,
            "scan_date": datetime.utcnow().isoformat(),
            "items": []
        }

        for item in items:
            if item.type in ["Lakehouse", "Warehouse"]:
                scan_result = self.scan_lakehouse(workspace_id, item.id)
                report["items"].append({
                    "item_id": item.id,
                    "item_name": item.display_name,
                    "item_type": item.type,
                    "current_label": item.sensitivity_label,
                    "findings": scan_result["findings"],
                    "recommended_label": self._get_highest_label(scan_result["findings"])
                })

        return report

# Usage
scanner = DataClassificationScanner(fabric_client, purview_client)

# Scan workspace
report = scanner.generate_classification_report("ws-analytics")

# Review findings
for item in report["items"]:
    if item["findings"]:
        print(f"\n{item['item_name']} ({item['item_type']}):")
        print(f"  Current label: {item['current_label']}")
        print(f"  Recommended: {item['recommended_label']}")
        for finding in item["findings"]:
            print(f"  - {finding['table']}.{finding['column']}: {finding['category']}")
```

## Label Enforcement

```python
class LabelEnforcement:
    """Enforce labeling policies."""

    def __init__(self, fabric_client, admin_client):
        self.fabric = fabric_client
        self.admin = admin_client

    def require_labels_for_workspace(
        self,
        workspace_id: str,
        min_label_priority: int = 3
    ):
        """Require sensitivity labels for all items in workspace."""
        items = self.fabric.items.list(workspace_id=workspace_id)

        unlabeled = []
        for item in items:
            if not item.sensitivity_label:
                unlabeled.append(item)
            elif item.sensitivity_label.priority > min_label_priority:
                unlabeled.append(item)

        return {
            "workspace_id": workspace_id,
            "total_items": len(items),
            "compliant_items": len(items) - len(unlabeled),
            "non_compliant_items": unlabeled
        }

    def enable_mandatory_labeling(self, tenant_setting: bool = True):
        """Enable mandatory labeling at tenant level."""
        return self.admin.tenant_settings.update(
            "MandatorySensitivityLabeling",
            enabled=tenant_setting
        )

    def block_unlabeled_export(self, workspace_id: str):
        """Prevent export of unlabeled data."""
        return self.fabric.workspaces.update_settings(
            workspace_id=workspace_id,
            settings={
                "blockExportWithoutLabel": True
            }
        )

# Usage
enforcement = LabelEnforcement(fabric_client, admin_client)

# Check compliance
compliance = enforcement.require_labels_for_workspace("ws-analytics")
print(f"Compliance rate: {compliance['compliant_items']}/{compliance['total_items']}")

# Enable mandatory labeling
enforcement.enable_mandatory_labeling(True)
```

## Best Practices

1. **Start with classification** - Know your data before labeling
2. **Use auto-labeling** - Reduce manual effort
3. **Inherit labels** - From sources to derived data
4. **Monitor compliance** - Track labeling coverage
5. **Educate users** - Training on proper label use

## What's Next

Tomorrow I'll cover data loss prevention in Microsoft Fabric.

## Resources

- [Sensitivity Labels in Fabric](https://learn.microsoft.com/fabric/governance/sensitivity-labels)
- [Microsoft Purview](https://learn.microsoft.com/purview/sensitivity-labels)
- [Auto-Labeling](https://learn.microsoft.com/purview/apply-sensitivity-label-automatically)
