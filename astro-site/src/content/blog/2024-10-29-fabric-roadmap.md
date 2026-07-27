---
title: "Microsoft Fabric Roadmap: What's Coming in 2024-2025"
author: "Michael John Peña"
draft: false
date: 2024-10-29
tags: ["Microsoft Fabric", "Roadmap", "Future", "Azure", "Data Platform"]

---

I wrote "Microsoft Fabric Roadmap: What's Coming in 2024-2025" to share practical, production-minded guidance on this topic.

## Roadmap Overview

```python
from dataclasses import dataclass
from typing import List
from enum import Enum
from datetime import date

class ReleaseStage(Enum):
    PREVIEW = "preview"
    GA = "generally_available"
    ANNOUNCED = "announced"
    PLANNED = "planned"

@dataclass
class FabricFeature:
    name: str
    workload: str
    stage: ReleaseStage
    expected_date: str
    description: str

FABRIC_ROADMAP = [
    # Already Available (GA)
    FabricFeature(
        name="Lakehouse",
        workload="Data Engineering",
        stage=ReleaseStage.GA,
        expected_date="2023-11",
        description="Delta Lake based lakehouse"
    ),
    FabricFeature(
        name="Warehouse",
        workload="Data Warehousing",
        stage=ReleaseStage.GA,
        expected_date="2023-11",
        description="T-SQL data warehouse"
    ),

    # In Preview (October 2024)
    FabricFeature(
        name="SQL Database in Fabric",
        workload="Databases",
        stage=ReleaseStage.PREVIEW,
        expected_date="2024-10",
        description="Operational SQL database with mirroring"
    ),
    FabricFeature(
        name="Mirroring for Azure SQL",
        workload="Real-Time Intelligence",
        stage=ReleaseStage.PREVIEW,
        expected_date="2024-10",
        description="Mirror Azure SQL to OneLake"
    ),
    FabricFeature(
        name="Mirroring for Cosmos DB",
        workload="Real-Time Intelligence",
        stage=ReleaseStage.PREVIEW,
        expected_date="2024-10",
        description="Mirror Cosmos DB to OneLake"
    ),

    # Expected Soon
    FabricFeature(
        name="PostgreSQL in Fabric",
        workload="Databases",
        stage=ReleaseStage.ANNOUNCED,
        expected_date="2025-Q1",
        description="Managed PostgreSQL with OneLake integration"
    ),
    FabricFeature(
        name="GraphQL API",
        workload="Data Engineering",
        stage=ReleaseStage.PREVIEW,
        expected_date="2024-Q4",
        description="GraphQL endpoint for Fabric data"
    ),
    FabricFeature(
        name="Git Integration GA",
        workload="Platform",
        stage=ReleaseStage.PREVIEW,
        expected_date="2024-Q4",
        description="Full Git integration for all items"
    ),

    # Planned Features
    FabricFeature(
        name="Private Link GA",
        workload="Security",
        stage=ReleaseStage.PLANNED,
        expected_date="2025-Q1",
        description="Private endpoint support GA"
    ),
    FabricFeature(
        name="Cross-Workspace Lineage",
        workload="Governance",
        stage=ReleaseStage.PLANNED,
        expected_date="2025-Q1",
        description="Data lineage across workspaces"
    )
]
```

## Key Features to Watch

### Databases in Fabric

```python
# Databases becoming first-class citizens in Fabric

DATABASES_ROADMAP = {
    "sql_database": {
        "current": "preview",
        "expected_ga": "2025-Q1",
        "features": [
            "Full T-SQL compatibility",
            "Auto-mirroring to OneLake",
            "Integrated with Fabric security",
            "Direct Lake connectivity"
        ]
    },
    "postgresql": {
        "current": "announced",
        "expected_preview": "2025-Q1",
        "features": [
            "Managed PostgreSQL",
            "pgvector support expected",
            "OneLake mirroring",
            "Fabric native experience"
        ]
    },
    "mirroring_sources": {
        "available": ["Azure SQL", "Azure SQL MI", "Cosmos DB", "Snowflake"],
        "coming": ["SQL Server on-prem", "Oracle", "MySQL", "PostgreSQL"]
    }
}
```

### Real-Time Intelligence

```python
REALTIME_ROADMAP = {
    "eventstreams": {
        "enhancements": [
            "More source connectors",
            "Enhanced transformations",
            "Direct Lakehouse write",
            "Improved monitoring"
        ]
    },
    "kql_database": {
        "enhancements": [
            "Increased retention limits",
            "Better integration with Lakehouse",
            "Enhanced dashboards",
            "Copilot for KQL"
        ]
    },
    "activator": {
        "status": "preview",
        "enhancements": [
            "More trigger conditions",
            "Complex event processing",
            "Integration with Power Automate",
            "Custom actions"
        ]
    }
}
```

### AI and Copilot

```python
AI_ROADMAP = {
    "copilot_experiences": {
        "data_factory": {
            "status": "rolling_out",
            "capabilities": [
                "Natural language to pipeline",
                "Dataflow suggestions",
                "Troubleshooting assistance"
            ]
        },
        "data_science": {
            "status": "available",
            "enhancements": [
                "Improved code generation",
                "Model recommendations",
                "AutoML improvements"
            ]
        },
        "sql": {
            "status": "available",
            "enhancements": [
                "Query optimization suggestions",
                "Schema recommendations",
                "Performance insights"
            ]
        },
        "power_bi": {
            "status": "available",
            "enhancements": [
                "Narrative generation",
                "Visual recommendations",
                "Q&A improvements"
            ]
        }
    },
    "ai_features": {
        "vector_search": {
            "status": "preview",
            "expected_ga": "2025"
        },
        "embeddings_api": {
            "status": "planned"
        }
    }
}
```

## Preparing for Upcoming Features

```python
class RoadmapPreparation:
    """Prepare for upcoming Fabric features"""

    @staticmethod
    def prepare_for_databases():
        """Prepare for Fabric Databases"""
        return {
            "assessment": [
                "Inventory current operational databases",
                "Identify candidates for Fabric migration",
                "Document current integrations"
            ],
            "pilot_planning": [
                "Select non-critical workload for pilot",
                "Plan mirroring configuration",
                "Define success criteria"
            ],
            "skills": [
                "T-SQL for SQL Database",
                "PostgreSQL basics",
                "Delta Lake for mirrored data"
            ]
        }

    @staticmethod
    def prepare_for_realtime():
        """Prepare for enhanced real-time capabilities"""
        return {
            "assessment": [
                "Identify streaming data sources",
                "Map current real-time workloads",
                "Document latency requirements"
            ],
            "architecture": [
                "Design event-driven patterns",
                "Plan KQL database schema",
                "Define alerting requirements"
            ],
            "skills": [
                "KQL (Kusto Query Language)",
                "Event stream processing concepts",
                "Real-time analytics patterns"
            ]
        }

    @staticmethod
    def prepare_for_ai():
        """Prepare for AI/Copilot features"""
        return {
            "governance": [
                "Define AI usage policies",
                "Set up Copilot permissions",
                "Establish prompt guidelines"
            ],
            "training": [
                "Train team on Copilot usage",
                "Develop prompt engineering skills",
                "Understand AI limitations"
            ],
            "data_readiness": [
                "Ensure data quality for AI",
                "Document data for context",
                "Set up semantic models"
            ]
        }
```

## Feature Request and Feedback

```python
FEEDBACK_CHANNELS = {
    "fabric_ideas": "https://ideas.fabric.microsoft.com",
    "tech_community": "https://techcommunity.microsoft.com/t5/microsoft-fabric/",
    "github": "Various repos for specific features",
    "user_voice": "Azure and Power BI User Voice sites"
}

def track_roadmap():
    """Resources for tracking Fabric roadmap"""
    return {
        "official_blog": "https://blog.fabric.microsoft.com",
        "release_notes": "Monthly release notes in docs",
        "ignite_announcements": "Microsoft Ignite conferences",
        "build_announcements": "Microsoft Build conferences",
        "community_calls": "Monthly Fabric community calls"
    }
```

## Migration Timeline Recommendations

```python
MIGRATION_TIMELINE = {
    "q4_2024": {
        "focus": "Foundation and pilots",
        "actions": [
            "Set up Fabric workspaces",
            "Pilot Lakehouse workloads",
            "Test mirroring scenarios",
            "Train core team"
        ]
    },
    "q1_2025": {
        "focus": "Data migration",
        "actions": [
            "Migrate analytics workloads",
            "Set up production Lakehouses",
            "Implement data pipelines",
            "Begin database pilots (if GA)"
        ]
    },
    "q2_2025": {
        "focus": "Full adoption",
        "actions": [
            "Migrate remaining workloads",
            "Implement real-time scenarios",
            "Deploy semantic models",
            "Complete governance setup"
        ]
    }
}
```

Stay informed about the Fabric roadmap to plan your data platform strategy effectively. The pace of innovation is rapid, so regular review of announcements is essential.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
