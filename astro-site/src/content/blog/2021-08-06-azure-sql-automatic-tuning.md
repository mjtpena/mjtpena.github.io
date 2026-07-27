---
title: "Azure SQL Automatic Tuning: Self-Healing Database Performance"
author: "Michael John Peña"
draft: false
date: 2021-08-06
tags: ["Azure", "SQL", "Automatic Tuning", "Performance", "AI"]
---

Azure SQL's Automatic Tuning is the machine learning system that acts on Query Store data to make index and query plan decisions that would otherwise require a DBA. The three tuning actions: FORCE_LAST_GOOD_PLAN (when a query regresses due to a plan change, force the last known-good plan automatically), CREATE_INDEX (when the query optimiser's missing index recommendations would improve performance significantly, create them), DROP_INDEX (remove unused indexes). All three actions are reversible—Automatic Tuning monitors the impact of each action and rolls back if performance doesn't improve. The CREATE_INDEX action is the one that generates the most discussion: automatically creating indexes can improve query performance but consume storage and slow down writes. I typically enable FORCE_LAST_GOOD_PLAN universally and use CREATE_INDEX selectively, with review before enabling DROP_INDEX on production systems.

## Enabling Automatic Tuning

```sql
-- Enable all automatic tuning options
ALTER DATABASE MyDatabase
SET AUTOMATIC_TUNING (
    FORCE_LAST_GOOD_PLAN = ON,
    CREATE_INDEX = ON,
    DROP_INDEX = ON
);

-- Check current automatic tuning state
SELECT
    name,
    desired_state_desc,
    actual_state_desc,
    reason_desc
FROM sys.database_automatic_tuning_options;
```

Using Azure CLI:

```bash
# Enable automatic tuning at server level
az sql server configuration set \
    --resource-group myResourceGroup \
    --server myserver \
    --name "createIndex" \
    --value "On"

az sql server configuration set \
    --resource-group myResourceGroup \
    --server myserver \
    --name "dropIndex" \
    --value "On"

az sql server configuration set \
    --resource-group myResourceGroup \
    --server myserver \
    --name "forceLastGoodPlan" \
    --value "On"
```

## Understanding Automatic Index Management

```sql
-- View automatic tuning recommendations
SELECT
    name,
    reason,
    score,
    details,
    state_desc,
    is_executable_action,
    is_revertable_action,
    execute_action_start_time,
    execute_action_duration,
    revert_action_start_time
FROM sys.dm_db_tuning_recommendations
ORDER BY score DESC;

-- View index recommendations specifically
SELECT
    r.name AS recommendation_name,
    r.reason,
    r.score,
    JSON_VALUE(r.details, '$.implementationDetails.script') AS create_script,
    JSON_VALUE(r.details, '$.indexName') AS index_name,
    JSON_VALUE(r.details, '$.schema') AS schema_name,
    JSON_VALUE(r.details, '$.table') AS table_name,
    JSON_VALUE(r.details, '$.columns') AS index_columns
FROM sys.dm_db_tuning_recommendations r
WHERE r.type = 'CREATE_INDEX'
ORDER BY r.score DESC;
```

## Monitoring Automatic Plan Correction

```sql
-- Find queries where plan was auto-corrected
SELECT
    qsq.query_id,
    qsqt.query_sql_text,
    qsp.plan_id,
    qsp.is_forced_plan,
    qsp.force_failure_count,
    qsp.last_force_failure_reason_desc,
    rs.avg_duration AS current_avg_duration
FROM sys.query_store_query qsq
JOIN sys.query_store_query_text qsqt ON qsq.query_text_id = qsqt.query_text_id
JOIN sys.query_store_plan qsp ON qsq.query_id = qsp.query_id
JOIN sys.query_store_runtime_stats rs ON qsp.plan_id = rs.plan_id
WHERE qsp.is_forced_plan = 1
ORDER BY rs.avg_duration DESC;

-- View plan forcing history
SELECT
    query_id,
    plan_id,
    force_failure_count,
    last_force_failure_reason_desc,
    count_forced_plan_executions,
    last_forced_plan_execution_time
FROM sys.query_store_plan
WHERE force_failure_count > 0;
```

## Building an Auto-Tuning Dashboard

```python
# Python script to monitor automatic tuning
import pyodbc
import pandas as pd
from datetime import datetime, timedelta

class AutoTuningMonitor:
    def __init__(self, connection_string):
        self.connection_string = connection_string

    def get_recommendations(self):
        query = """
        SELECT
            name,
            type,
            reason,
            score,
            state_desc,
            is_executable_action,
            execute_action_start_time,
            execute_action_duration,
            JSON_VALUE(details, '$.implementationDetails.script') AS script
        FROM sys.dm_db_tuning_recommendations
        WHERE state_desc IN ('Active', 'Verifying', 'Success')
        ORDER BY score DESC
        """

        with pyodbc.connect(self.connection_string) as conn:
            return pd.read_sql(query, conn)

    def get_applied_recommendations(self, days_back=30):
        query = f"""
        SELECT
            name,
            type,
            reason,
            score,
            state_desc,
            execute_action_start_time,
            execute_action_duration,
            revert_action_start_time
        FROM sys.dm_db_tuning_recommendations
        WHERE execute_action_start_time >= DATEADD(DAY, -{days_back}, GETDATE())
        ORDER BY execute_action_start_time DESC
        """

        with pyodbc.connect(self.connection_string) as conn:
            return pd.read_sql(query, conn)

    def get_performance_improvement(self):
        query = """
        SELECT
            r.name,
            r.type,
            r.score,
            JSON_VALUE(r.details, '$.estimatedImpact[0].deltaValue') AS estimated_impact,
            JSON_VALUE(r.details, '$.estimatedImpact[0].unit') AS impact_unit,
            r.execute_action_start_time,
            r.state_desc
        FROM sys.dm_db_tuning_recommendations r
        WHERE r.state_desc = 'Success'
        AND r.execute_action_start_time >= DATEADD(DAY, -7, GETDATE())
        ORDER BY estimated_impact DESC
        """

        with pyodbc.connect(self.connection_string) as conn:
            return pd.read_sql(query, conn)

    def generate_report(self):
        recommendations = self.get_recommendations()
        applied = self.get_applied_recommendations()
        improvements = self.get_performance_improvement()

        report = f"""
        Automatic Tuning Report - {datetime.now().strftime('%Y-%m-%d')}
        ================================================

        Active Recommendations: {len(recommendations)}
        Applied in Last 30 Days: {len(applied)}

        Top Recommendations by Score:
        {recommendations.head(10).to_string()}

        Recent Improvements:
        {improvements.head(10).to_string()}
        """

        return report

# Usage
monitor = AutoTuningMonitor(connection_string)
print(monitor.generate_report())
```

## Handling Automatic Tuning Events

```csharp
// C# Azure Function to respond to tuning events
public class AutoTuningAlertFunction
{
    [FunctionName("ProcessAutoTuningAlert")]
    public async Task Run(
        [ServiceBusTrigger("auto-tuning-alerts")] string message,
        ILogger log)
    {
        var alert = JsonConvert.DeserializeObject<AutoTuningAlert>(message);

        switch (alert.Type)
        {
            case "CREATE_INDEX":
                log.LogInformation($"Index created: {alert.IndexName} on {alert.TableName}");
                await NotifyTeam(alert);
                break;

            case "DROP_INDEX":
                log.LogWarning($"Index dropped: {alert.IndexName}");
                await NotifyTeam(alert);
                break;

            case "FORCE_PLAN":
                log.LogInformation($"Plan forced for query {alert.QueryId}");
                await AnalyzePlanForcing(alert);
                break;
        }
    }

    private async Task NotifyTeam(AutoTuningAlert alert)
    {
        // Send notification via Teams, Slack, or email
    }

    private async Task AnalyzePlanForcing(AutoTuningAlert alert)
    {
        // Additional analysis for plan corrections
    }
}

public class AutoTuningAlert
{
    public string Type { get; set; }
    public string IndexName { get; set; }
    public string TableName { get; set; }
    public long? QueryId { get; set; }
    public double Score { get; set; }
}
```

## Best Practices

1. **Start with observation**: Enable recommendations but review before auto-apply
2. **Monitor revertions**: High revert rates indicate unstable workloads
3. **Combine with Query Store**: Use Query Store data for deeper analysis
4. **Set up alerts**: Get notified when significant changes occur

Automatic tuning reduces the operational burden of database performance management while ensuring your databases adapt to changing workload patterns.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
