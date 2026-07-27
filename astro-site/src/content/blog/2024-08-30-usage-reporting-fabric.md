---
title: "Usage Reporting in Microsoft Fabric"
author: Michael John Peña
draft: false
date: 2024-08-30
tags:
  - Microsoft Fabric
  - Usage Reporting
  - Monitoring
  - Analytics
  - Governance

---

I wrote "Usage Reporting in Microsoft Fabric" to share practical, production-minded guidance on this topic.

## Usage Data Sources

```
Usage Data Flow:
┌─────────────────────────────────────────────────────────────┐
│                    Microsoft Fabric                          │
│                                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐    │
│  │ Capacity │  │ Activity │  │ Audit    │  │ Admin    │    │
│  │ Metrics  │  │  Logs    │  │  Logs    │  │  API     │    │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘    │
│       │             │             │             │           │
│       └─────────────┴─────────────┴─────────────┘           │
│                           │                                  │
│                     ┌─────▼─────┐                           │
│                     │  OneLake  │                           │
│                     │ Lakehouse │                           │
│                     └─────┬─────┘                           │
│                           │                                  │
│                     ┌─────▼─────┐                           │
│                     │  Reports  │                           │
│                     │ Dashboards│                           │
│                     └───────────┘                           │
└─────────────────────────────────────────────────────────────┘
```

## Collecting Usage Data

### Capacity Metrics Collection

```python
from datetime import datetime, timedelta
import requests

class UsageDataCollector:
    """Collect usage data from Fabric APIs."""

    def __init__(self, tenant_id: str, client_id: str, client_secret: str):
        self.tenant_id = tenant_id
        self.client_id = client_id
        self.client_secret = client_secret
        self.base_url = "https://api.fabric.microsoft.com/v1"

    def _get_token(self) -> str:
        """Get access token."""
        # OAuth token acquisition
        token_url = f"https://login.microsoftonline.com/{self.tenant_id}/oauth2/v2.0/token"

        response = requests.post(token_url, data={
            "grant_type": "client_credentials",
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "scope": "https://api.fabric.microsoft.com/.default"
        })

        return response.json().get("access_token")

    def _get_headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self._get_token()}",
            "Content-Type": "application/json"
        }

    def get_capacity_usage(
        self,
        capacity_id: str,
        start_date: str,
        end_date: str
    ) -> dict:
        """Get capacity usage metrics."""

        # This would call the actual Fabric admin API
        # Simulated response
        return {
            "capacity_id": capacity_id,
            "period": {"start": start_date, "end": end_date},
            "metrics": {
                "total_cu_hours": 1500,
                "peak_cu_usage": 95,
                "average_cu_usage": 45,
                "operations_count": 25000
            },
            "by_workload": {
                "spark": {"cu_hours": 800, "operations": 500},
                "warehouse": {"cu_hours": 400, "operations": 15000},
                "dataflow": {"cu_hours": 200, "operations": 200},
                "power_bi": {"cu_hours": 100, "operations": 9300}
            }
        }

    def get_workspace_activity(self, workspace_id: str, days: int = 30) -> list:
        """Get workspace activity logs."""

        # Simulated activity data
        return [
            {
                "timestamp": "2024-08-30T10:00:00Z",
                "operation": "RefreshDataset",
                "user": "user@company.com",
                "duration_seconds": 120,
                "status": "Success"
            },
            {
                "timestamp": "2024-08-30T09:30:00Z",
                "operation": "ExecuteQuery",
                "user": "analyst@company.com",
                "duration_seconds": 5,
                "status": "Success"
            }
        ]

    def get_storage_usage(self, workspace_id: str) -> dict:
        """Get OneLake storage usage."""

        return {
            "workspace_id": workspace_id,
            "total_size_gb": 150.5,
            "by_item_type": {
                "lakehouse": 80.2,
                "warehouse": 45.3,
                "semantic_model": 15.0,
                "other": 10.0
            }
        }

# Usage
collector = UsageDataCollector(
    tenant_id="tenant-id",
    client_id="client-id",
    client_secret="secret"
)

# Collect capacity usage
capacity_usage = collector.get_capacity_usage(
    capacity_id="capacity-123",
    start_date="2024-08-01",
    end_date="2024-08-31"
)

print(f"Total CU-hours: {capacity_usage['metrics']['total_cu_hours']}")
```

### Activity Log Processing

```python
class ActivityLogProcessor:
    """Process and aggregate activity logs."""

    def __init__(self):
        self.activity_log = []

    def ingest_activities(self, activities: list):
        """Ingest raw activity data."""
        self.activity_log.extend(activities)

    def aggregate_by_user(self) -> dict:
        """Aggregate activities by user."""

        user_stats = {}

        for activity in self.activity_log:
            user = activity.get("user", "unknown")

            if user not in user_stats:
                user_stats[user] = {
                    "operation_count": 0,
                    "total_duration_seconds": 0,
                    "operations": {}
                }

            user_stats[user]["operation_count"] += 1
            user_stats[user]["total_duration_seconds"] += activity.get("duration_seconds", 0)

            op = activity.get("operation", "unknown")
            if op not in user_stats[user]["operations"]:
                user_stats[user]["operations"][op] = 0
            user_stats[user]["operations"][op] += 1

        return user_stats

    def aggregate_by_operation(self) -> dict:
        """Aggregate activities by operation type."""

        op_stats = {}

        for activity in self.activity_log:
            op = activity.get("operation", "unknown")

            if op not in op_stats:
                op_stats[op] = {
                    "count": 0,
                    "total_duration_seconds": 0,
                    "success_count": 0,
                    "failure_count": 0
                }

            op_stats[op]["count"] += 1
            op_stats[op]["total_duration_seconds"] += activity.get("duration_seconds", 0)

            if activity.get("status") == "Success":
                op_stats[op]["success_count"] += 1
            else:
                op_stats[op]["failure_count"] += 1

        # Calculate averages and success rates
        for op, stats in op_stats.items():
            stats["avg_duration_seconds"] = stats["total_duration_seconds"] / stats["count"]
            stats["success_rate"] = stats["success_count"] / stats["count"] * 100

        return op_stats

    def get_hourly_distribution(self) -> dict:
        """Get activity distribution by hour."""

        hourly = {str(h).zfill(2): 0 for h in range(24)}

        for activity in self.activity_log:
            timestamp = activity.get("timestamp", "")
            if timestamp:
                hour = timestamp[11:13]  # Extract hour from ISO timestamp
                if hour in hourly:
                    hourly[hour] += 1

        return hourly

# Usage
processor = ActivityLogProcessor()

# Ingest sample activities
processor.ingest_activities([
    {"timestamp": "2024-08-30T10:00:00Z", "operation": "RefreshDataset", "user": "user1@company.com", "duration_seconds": 120, "status": "Success"},
    {"timestamp": "2024-08-30T10:30:00Z", "operation": "ExecuteQuery", "user": "user2@company.com", "duration_seconds": 5, "status": "Success"},
    {"timestamp": "2024-08-30T11:00:00Z", "operation": "RefreshDataset", "user": "user1@company.com", "duration_seconds": 150, "status": "Success"},
    {"timestamp": "2024-08-30T14:00:00Z", "operation": "ExecuteQuery", "user": "user3@company.com", "duration_seconds": 3, "status": "Failure"}
])

# Get aggregations
user_stats = processor.aggregate_by_user()
print("Activity by User:")
for user, stats in user_stats.items():
    print(f"  {user}: {stats['operation_count']} operations")

op_stats = processor.aggregate_by_operation()
print("\nActivity by Operation:")
for op, stats in op_stats.items():
    print(f"  {op}: {stats['count']} calls, {stats['success_rate']:.1f}% success")
```

## Building Usage Reports

### Executive Dashboard

```python
class ExecutiveUsageReport:
    """Generate executive-level usage reports."""

    def __init__(self):
        self.data = {}

    def load_data(
        self,
        capacity_usage: dict,
        cost_data: dict,
        user_activity: dict
    ):
        """Load all data sources."""
        self.data["capacity"] = capacity_usage
        self.data["cost"] = cost_data
        self.data["activity"] = user_activity

    def generate_kpis(self) -> dict:
        """Generate key performance indicators."""

        capacity = self.data.get("capacity", {})
        cost = self.data.get("cost", {})
        activity = self.data.get("activity", {})

        return {
            "utilization": {
                "average_percent": capacity.get("metrics", {}).get("average_cu_usage", 0),
                "peak_percent": capacity.get("metrics", {}).get("peak_cu_usage", 0),
                "trend": "up"  # Would calculate from historical data
            },
            "cost": {
                "mtd": cost.get("mtd_cost", 0),
                "budget": cost.get("budget", 0),
                "variance_percent": ((cost.get("mtd_cost", 0) - cost.get("budget", 0)) / cost.get("budget", 1)) * 100 if cost.get("budget") else 0
            },
            "adoption": {
                "active_users": len(activity),
                "total_operations": sum(u.get("operation_count", 0) for u in activity.values())
            }
        }

    def generate_trends(self, historical_data: list) -> dict:
        """Generate trend analysis."""

        if not historical_data:
            return {}

        # Calculate month-over-month changes
        current = historical_data[-1] if historical_data else {}
        previous = historical_data[-2] if len(historical_data) > 1 else {}

        def calc_change(curr, prev):
            if prev and prev > 0:
                return ((curr - prev) / prev) * 100
            return 0

        return {
            "cu_hours_change": calc_change(
                current.get("cu_hours", 0),
                previous.get("cu_hours", 0)
            ),
            "cost_change": calc_change(
                current.get("cost", 0),
                previous.get("cost", 0)
            ),
            "users_change": calc_change(
                current.get("active_users", 0),
                previous.get("active_users", 0)
            )
        }

    def to_markdown(self) -> str:
        """Generate markdown report."""

        kpis = self.generate_kpis()

        report = """
# Fabric Usage Report

## Key Metrics

| Metric | Value | Status |
|--------|-------|--------|
| Avg Utilization | {util_avg}% | {util_status} |
| Peak Utilization | {util_peak}% | - |
| MTD Cost | ${cost_mtd:,.2f} | {cost_status} |
| Active Users | {users} | - |

## Utilization Trend

Current average utilization is {util_avg}%, with peak reaching {util_peak}%.

## Cost Status

Month-to-date spending is ${cost_mtd:,.2f} against a budget of ${budget:,.2f}.
Variance: {variance:.1f}%

        """.format(
            util_avg=kpis["utilization"]["average_percent"],
            util_peak=kpis["utilization"]["peak_percent"],
            util_status="Good" if kpis["utilization"]["average_percent"] > 50 else "Review",
            cost_mtd=kpis["cost"]["mtd"],
            budget=kpis["cost"]["budget"],
            variance=kpis["cost"]["variance_percent"],
            cost_status="On Track" if kpis["cost"]["variance_percent"] <= 10 else "Over Budget",
            users=kpis["adoption"]["active_users"]
        )

        return report

# Usage
report = ExecutiveUsageReport()

report.load_data(
    capacity_usage={
        "metrics": {"average_cu_usage": 65, "peak_cu_usage": 92}
    },
    cost_data={
        "mtd_cost": 8500,
        "budget": 10000
    },
    user_activity={
        "user1": {"operation_count": 100},
        "user2": {"operation_count": 50},
        "user3": {"operation_count": 25}
    }
)

print(report.to_markdown())
```

### Detailed Usage Report

```python
class DetailedUsageReport:
    """Generate detailed usage reports for teams."""

    def __init__(self):
        self.usage_data = {}

    def add_workspace_usage(
        self,
        workspace_name: str,
        team: str,
        cu_hours: float,
        storage_gb: float,
        query_count: int,
        refresh_count: int
    ):
        """Add usage data for a workspace."""

        if team not in self.usage_data:
            self.usage_data[team] = {"workspaces": []}

        self.usage_data[team]["workspaces"].append({
            "name": workspace_name,
            "cu_hours": cu_hours,
            "storage_gb": storage_gb,
            "query_count": query_count,
            "refresh_count": refresh_count
        })

    def generate_team_report(self, team: str) -> dict:
        """Generate detailed report for a team."""

        if team not in self.usage_data:
            return {"error": "Team not found"}

        workspaces = self.usage_data[team]["workspaces"]

        total_cu = sum(w["cu_hours"] for w in workspaces)
        total_storage = sum(w["storage_gb"] for w in workspaces)
        total_queries = sum(w["query_count"] for w in workspaces)
        total_refreshes = sum(w["refresh_count"] for w in workspaces)

        # Sort workspaces by CU usage
        sorted_workspaces = sorted(
            workspaces,
            key=lambda x: x["cu_hours"],
            reverse=True
        )

        return {
            "team": team,
            "summary": {
                "total_cu_hours": total_cu,
                "total_storage_gb": total_storage,
                "total_queries": total_queries,
                "total_refreshes": total_refreshes,
                "workspace_count": len(workspaces)
            },
            "workspaces": sorted_workspaces,
            "recommendations": self._generate_recommendations(sorted_workspaces)
        }

    def _generate_recommendations(self, workspaces: list) -> list:
        """Generate optimization recommendations."""

        recommendations = []

        for ws in workspaces:
            # Low query count but high CU
            if ws["cu_hours"] > 100 and ws["query_count"] < 10:
                recommendations.append({
                    "workspace": ws["name"],
                    "issue": "High compute with low query activity",
                    "recommendation": "Review if refreshes are necessary"
                })

            # High storage
            if ws["storage_gb"] > 50:
                recommendations.append({
                    "workspace": ws["name"],
                    "issue": f"Large storage footprint ({ws['storage_gb']:.1f} GB)",
                    "recommendation": "Consider data lifecycle policies"
                })

        return recommendations

    def compare_teams(self) -> dict:
        """Compare usage across teams."""

        team_summaries = {}

        for team, data in self.usage_data.items():
            workspaces = data["workspaces"]
            team_summaries[team] = {
                "cu_hours": sum(w["cu_hours"] for w in workspaces),
                "storage_gb": sum(w["storage_gb"] for w in workspaces),
                "workspace_count": len(workspaces)
            }

        # Rank teams
        total_cu = sum(t["cu_hours"] for t in team_summaries.values())

        for team in team_summaries:
            team_summaries[team]["cu_percent"] = (
                team_summaries[team]["cu_hours"] / total_cu * 100
                if total_cu > 0 else 0
            )

        return team_summaries

# Usage
detailed = DetailedUsageReport()

# Add workspace data
detailed.add_workspace_usage("Sales Dashboard", "Sales", 300, 25, 5000, 60)
detailed.add_workspace_usage("Sales ETL", "Sales", 450, 80, 100, 30)
detailed.add_workspace_usage("Marketing Analytics", "Marketing", 200, 15, 2000, 30)
detailed.add_workspace_usage("Finance Reports", "Finance", 100, 10, 1000, 15)

# Generate team report
sales_report = detailed.generate_team_report("Sales")
print(f"Sales Team Summary:")
print(f"  Total CU-hours: {sales_report['summary']['total_cu_hours']}")
print(f"  Total Storage: {sales_report['summary']['total_storage_gb']:.1f} GB")

# Compare teams
comparison = detailed.compare_teams()
print("\nTeam Comparison:")
for team, stats in comparison.items():
    print(f"  {team}: {stats['cu_hours']} CU-hours ({stats['cu_percent']:.1f}%)")
```

## Automating Reports

```python
class ReportScheduler:
    """Schedule and distribute usage reports."""

    def __init__(self):
        self.schedules = []

    def add_schedule(
        self,
        report_name: str,
        frequency: str,  # "daily", "weekly", "monthly"
        recipients: list,
        report_type: str
    ):
        """Add a report schedule."""

        self.schedules.append({
            "name": report_name,
            "frequency": frequency,
            "recipients": recipients,
            "report_type": report_type,
            "last_run": None
        })

    def should_run(self, schedule: dict, current_date: datetime) -> bool:
        """Check if report should run."""

        if schedule["last_run"] is None:
            return True

        last_run = schedule["last_run"]
        frequency = schedule["frequency"]

        if frequency == "daily":
            return (current_date - last_run).days >= 1
        elif frequency == "weekly":
            return (current_date - last_run).days >= 7
        elif frequency == "monthly":
            return (current_date - last_run).days >= 30

        return False

    def run_due_reports(self, current_date: datetime) -> list:
        """Run all due reports."""

        results = []

        for schedule in self.schedules:
            if self.should_run(schedule, current_date):
                result = {
                    "report_name": schedule["name"],
                    "generated_at": current_date.isoformat(),
                    "recipients": schedule["recipients"],
                    "status": "generated"
                }

                schedule["last_run"] = current_date
                results.append(result)

        return results

# Usage
scheduler = ReportScheduler()

scheduler.add_schedule(
    "Executive Summary",
    "weekly",
    ["cto@company.com", "cfo@company.com"],
    "executive"
)

scheduler.add_schedule(
    "Team Usage Detail",
    "daily",
    ["data-team@company.com"],
    "detailed"
)

# Run due reports
results = scheduler.run_due_reports(datetime.now())
print(f"Reports generated: {len(results)}")
```

## Best Practices

1. **Collect comprehensively**: Gather data from all sources
2. **Aggregate appropriately**: Different audiences need different views
3. **Automate distribution**: Regular reports without manual effort
4. **Include trends**: Show direction, not just current state
5. **Add recommendations**: Make reports actionable

## Conclusion

Effective usage reporting provides the visibility needed for informed decisions about Microsoft Fabric investments. Build reports that serve different audiences - executives need KPIs, teams need details, finance needs cost allocation.

Automate report generation and distribution to ensure stakeholders always have current information without manual overhead.

