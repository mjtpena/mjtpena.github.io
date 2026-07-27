---
title: "Workload Management in Azure Synapse"
author: "Michael John Peña"
draft: false
date: 2021-10-23
tags: ["Azure", "Synapse", "Workload Management", "Performance", "Resource Management"]

---

I wrote "Workload Management in Azure Synapse" to share practical, production-minded guidance on this topic.

Workload management in Synapse Dedicated SQL Pool is the resource governance system that prevents low-priority ad-hoc queries from consuming all compute and starving critical ETL jobs or executive dashboard queries during business hours. The three concepts: workload groups (define a minimum and maximum percentage of system resources), workload classifiers (route queries to workload groups based on user, label, or session context), and importance (prioritise resource access when multiple groups are competing). The practical configuration: a `critical_etl` group with 50% minimum resources and `HIGH` importance, a `reporting` group with 20% minimum and `NORMAL` importance, and a `adhoc` group with 5% minimum and `LOW` importance. When resource pressure exists, `HIGH` importance queries get resources first; `LOW` importance queries wait. Without workload management, every user and query competes equally—which means the 7pm data load competes with the overnight executive dashboard refresh.

## Understanding Workload Management

Synapse workload management consists of:
- **Workload Groups** - Define resource allocation pools
- **Workload Classifiers** - Route queries to groups
- **Workload Isolation** - Guarantee minimum resources
- **Importance** - Prioritize within resource constraints

## Resource Classes (Legacy)

Traditional resource allocation using built-in classes:

```sql
-- View resource classes
SELECT * FROM sys.database_principals
WHERE type = 'R' AND name LIKE '%rc';

-- Assign user to resource class
EXEC sp_addrolemember 'mediumrc', 'ETLUser';

-- Remove from resource class
EXEC sp_droprolemember 'mediumrc', 'ETLUser';
```

Resource class sizes at DW1000c:
| Class | Memory % | Concurrency Slots |
|-------|----------|-------------------|
| smallrc | 3% | 1 |
| mediumrc | 10% | 3 |
| largerc | 22% | 7 |
| xlargerc | 70% | 22 |

## Workload Groups

Create custom resource pools:

```sql
-- Create workload group for ETL
CREATE WORKLOAD GROUP wgETL
WITH (
    MIN_PERCENTAGE_RESOURCE = 25,           -- Guaranteed minimum
    CAP_PERCENTAGE_RESOURCE = 50,           -- Maximum allowed
    REQUEST_MIN_RESOURCE_GRANT_PERCENT = 10, -- Per-query minimum
    REQUEST_MAX_RESOURCE_GRANT_PERCENT = 25  -- Per-query maximum
);

-- Create workload group for dashboards
CREATE WORKLOAD GROUP wgDashboard
WITH (
    MIN_PERCENTAGE_RESOURCE = 20,
    CAP_PERCENTAGE_RESOURCE = 40,
    REQUEST_MIN_RESOURCE_GRANT_PERCENT = 5,
    REQUEST_MAX_RESOURCE_GRANT_PERCENT = 10
);

-- Create workload group for ad-hoc queries
CREATE WORKLOAD GROUP wgAdHoc
WITH (
    MIN_PERCENTAGE_RESOURCE = 0,            -- No guarantee
    CAP_PERCENTAGE_RESOURCE = 30,
    REQUEST_MIN_RESOURCE_GRANT_PERCENT = 3,
    REQUEST_MAX_RESOURCE_GRANT_PERCENT = 10
);
```

### View Workload Groups

```sql
SELECT
    name,
    min_percentage_resource,
    cap_percentage_resource,
    request_min_resource_grant_percent,
    request_max_resource_grant_percent
FROM sys.workload_management_workload_groups;
```

## Workload Classifiers

Route queries to appropriate workload groups:

### By User

```sql
-- Route ETL user to ETL group
CREATE WORKLOAD CLASSIFIER wcETLUser
WITH (
    WORKLOAD_GROUP = 'wgETL',
    MEMBERNAME = 'ETLServiceAccount',
    IMPORTANCE = HIGH
);

-- Route dashboard service to dashboard group
CREATE WORKLOAD CLASSIFIER wcDashboard
WITH (
    WORKLOAD_GROUP = 'wgDashboard',
    MEMBERNAME = 'DashboardService',
    IMPORTANCE = ABOVE_NORMAL
);
```

### By Label

```sql
-- Classify by query label
CREATE WORKLOAD CLASSIFIER wcReporting
WITH (
    WORKLOAD_GROUP = 'wgDashboard',
    MEMBERNAME = 'AllUsers',
    WLM_LABEL = 'Report',
    IMPORTANCE = NORMAL
);

-- Use label in query
SELECT *
FROM dbo.FactSales
OPTION (LABEL = 'Report');
```

### By Start Time

```sql
-- Route queries during business hours differently
CREATE WORKLOAD CLASSIFIER wcBusinessHours
WITH (
    WORKLOAD_GROUP = 'wgDashboard',
    MEMBERNAME = 'AllUsers',
    START_TIME = '08:00',
    END_TIME = '18:00',
    IMPORTANCE = HIGH
);
```

## Importance Levels

Control query priority:

```sql
-- Create classifier with high importance
CREATE WORKLOAD CLASSIFIER wcCritical
WITH (
    WORKLOAD_GROUP = 'wgETL',
    MEMBERNAME = 'CriticalLoadUser',
    IMPORTANCE = HIGH  -- LOW, BELOW_NORMAL, NORMAL, ABOVE_NORMAL, HIGH
);

-- Importance affects queue ordering
-- Higher importance queries run before lower ones
```

## Query Timeouts

Set timeouts for workload groups:

```sql
-- Create group with timeout
CREATE WORKLOAD GROUP wgAdHocLimited
WITH (
    MIN_PERCENTAGE_RESOURCE = 0,
    CAP_PERCENTAGE_RESOURCE = 20,
    REQUEST_MIN_RESOURCE_GRANT_PERCENT = 3,
    QUERY_EXECUTION_TIMEOUT_SEC = 3600  -- 1 hour timeout
);
```

## Monitoring Workload Management

### Active Queries by Workload Group

```sql
SELECT
    wg.name as workload_group,
    r.request_id,
    r.status,
    r.submit_time,
    r.resource_allocation_percentage,
    r.importance,
    r.command
FROM sys.dm_pdw_exec_requests r
JOIN sys.workload_management_workload_groups wg
    ON r.group_name = wg.name
WHERE r.status NOT IN ('Completed', 'Failed', 'Cancelled')
ORDER BY r.submit_time;
```

### Resource Utilization by Group

```sql
SELECT
    wg.name as workload_group,
    COUNT(*) as active_requests,
    SUM(r.resource_allocation_percentage) as total_resource_pct,
    AVG(r.total_elapsed_time) as avg_elapsed_time
FROM sys.dm_pdw_exec_requests r
JOIN sys.workload_management_workload_groups wg
    ON r.group_name = wg.name
WHERE r.status = 'Running'
GROUP BY wg.name;
```

### Queued Queries

```sql
SELECT
    r.request_id,
    r.group_name,
    r.importance,
    r.submit_time,
    DATEDIFF(second, r.submit_time, GETDATE()) as queue_time_sec,
    r.command
FROM sys.dm_pdw_exec_requests r
WHERE r.status = 'Queued'
ORDER BY r.importance DESC, r.submit_time;
```

## Real-World Configuration

### Data Warehouse with Mixed Workloads

```sql
-- ETL workload group (batch loads)
CREATE WORKLOAD GROUP wgBatchETL
WITH (
    MIN_PERCENTAGE_RESOURCE = 30,
    CAP_PERCENTAGE_RESOURCE = 60,
    REQUEST_MIN_RESOURCE_GRANT_PERCENT = 15
);

-- Reporting workload group (scheduled reports)
CREATE WORKLOAD GROUP wgReporting
WITH (
    MIN_PERCENTAGE_RESOURCE = 20,
    CAP_PERCENTAGE_RESOURCE = 40,
    REQUEST_MIN_RESOURCE_GRANT_PERCENT = 5
);

-- Interactive workload group (ad-hoc analysis)
CREATE WORKLOAD GROUP wgInteractive
WITH (
    MIN_PERCENTAGE_RESOURCE = 10,
    CAP_PERCENTAGE_RESOURCE = 30,
    REQUEST_MIN_RESOURCE_GRANT_PERCENT = 3,
    QUERY_EXECUTION_TIMEOUT_SEC = 1800
);

-- Create classifiers
CREATE WORKLOAD CLASSIFIER wcETLService
WITH (WORKLOAD_GROUP = 'wgBatchETL', MEMBERNAME = 'ETLService', IMPORTANCE = HIGH);

CREATE WORKLOAD CLASSIFIER wcReportService
WITH (WORKLOAD_GROUP = 'wgReporting', MEMBERNAME = 'ReportingService', IMPORTANCE = ABOVE_NORMAL);

CREATE WORKLOAD CLASSIFIER wcAnalysts
WITH (WORKLOAD_GROUP = 'wgInteractive', MEMBERNAME = 'AnalystGroup', IMPORTANCE = NORMAL);
```

## Managing Workload Groups

### Alter Workload Group

```sql
-- Modify existing group
ALTER WORKLOAD GROUP wgETL
WITH (
    CAP_PERCENTAGE_RESOURCE = 70,
    REQUEST_MAX_RESOURCE_GRANT_PERCENT = 30
);
```

### Drop Workload Group

```sql
-- First drop associated classifiers
DROP WORKLOAD CLASSIFIER wcETLUser;

-- Then drop the group
DROP WORKLOAD GROUP wgETL;
```

## Best Practices

### Resource Allocation Guidelines

```sql
-- Total MIN_PERCENTAGE_RESOURCE across all groups should not exceed 100%
-- Leave headroom for system operations (recommend 10-20%)

-- Example balanced allocation:
-- wgETL:        MIN 30%, CAP 60%
-- wgReporting:  MIN 25%, CAP 50%
-- wgInteractive: MIN 15%, CAP 40%
-- wgAdHoc:      MIN 0%,  CAP 30%
-- System reserve: ~30%
```

### Classifier Priority

Classifiers are evaluated in order:
1. MEMBERNAME match
2. WLM_LABEL match
3. START_TIME/END_TIME match
4. IMPORTANCE (for queue ordering)

```sql
-- More specific classifier should have precedence
-- Use label for fine-grained control
SELECT * FROM dbo.Table
OPTION (LABEL = 'CriticalQuery');
```

## Conclusion

Workload management enables fine-grained control over resource allocation in Synapse. By designing appropriate workload groups and classifiers, you can ensure critical workloads get the resources they need while maintaining overall system efficiency.

Tomorrow, we'll shift focus to Azure Databricks clusters and configuration best practices.

