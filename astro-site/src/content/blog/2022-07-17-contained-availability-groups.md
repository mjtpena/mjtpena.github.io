---
title: "Contained Availability Groups in SQL Server 2022"
description: "Contained AGs maintain their own system databases (master and msdb) within the AG, ensuring instance-level objects replicate automatically."
author: "Michael John Peña"
draft: false
date: 2022-07-17
tags: ["SQL Server", "Availability Groups", "High Availability", "SQL Server 2022"]
---

## The Problem with Traditional AGs

In traditional availability groups, objects like logins, jobs, and linked servers exist at the instance level. After failover, you often encounter:

- Login mismatches
- Missing SQL Agent jobs
- Broken linked servers
- Application connection failures

## How Contained AGs Work

Contained AGs maintain their own system databases (master and msdb) within the AG, ensuring instance-level objects replicate automatically.

## Creating a Contained Availability Group

```sql
-- Enable contained availability groups on all replicas
EXEC sp_configure 'contained availability group', 1;
RECONFIGURE;

-- Create the availability group with CONTAINED
CREATE AVAILABILITY GROUP [ContainedAG]
    WITH (
        CONTAINED,
        AUTOMATED_BACKUP_PREFERENCE = PRIMARY,
        DB_FAILOVER = ON,
        DTC_SUPPORT = NONE
    )
    FOR DATABASE [SalesDB]
    REPLICA ON
        N'SQL2022-1' WITH (
            ENDPOINT_URL = N'TCP://SQL2022-1:5022',
            AVAILABILITY_MODE = SYNCHRONOUS_COMMIT,
            FAILOVER_MODE = AUTOMATIC,
            SEEDING_MODE = AUTOMATIC
        ),
        N'SQL2022-2' WITH (
            ENDPOINT_URL = N'TCP://SQL2022-2:5022',
            AVAILABILITY_MODE = SYNCHRONOUS_COMMIT,
            FAILOVER_MODE = AUTOMATIC,
            SEEDING_MODE = AUTOMATIC
        );
```

## Managing Contained AG Users

```sql
-- Connect to the contained AG context
USE [ContainedAG];
GO

-- Create a login within the contained AG
CREATE LOGIN AppUser WITH PASSWORD = 'SecurePassword123!';

-- Create a user mapped to the login
USE [SalesDB];
CREATE USER AppUser FOR LOGIN AppUser;
ALTER ROLE db_datareader ADD MEMBER AppUser;
ALTER ROLE db_datawriter ADD MEMBER AppUser;

-- This login/user combination replicates automatically!
```

## SQL Agent Jobs in Contained AGs

```sql
-- Connect to contained AG system database
USE [ContainedAG];
GO

-- Create a job that will replicate
EXEC msdb.dbo.sp_add_job
    @job_name = N'DailyBackup',
    @enabled = 1,
    @description = N'Daily backup job';

EXEC msdb.dbo.sp_add_jobstep
    @job_name = N'DailyBackup',
    @step_name = N'BackupDatabases',
    @subsystem = N'TSQL',
    @command = N'BACKUP DATABASE SalesDB TO DISK = ''C:\Backups\SalesDB.bak''',
    @database_name = N'SalesDB';

EXEC msdb.dbo.sp_add_schedule
    @schedule_name = N'NightlySchedule',
    @freq_type = 4,  -- Daily
    @freq_interval = 1,
    @active_start_time = 020000;  -- 2:00 AM

EXEC msdb.dbo.sp_attach_schedule
    @job_name = N'DailyBackup',
    @schedule_name = N'NightlySchedule';
```

## Linked Servers in Contained AGs

```sql
-- Create a linked server within the contained AG
USE [ContainedAG];
GO

EXEC sp_addlinkedserver
    @server = N'LinkedDB',
    @srvproduct = N'',
    @provider = N'SQLNCLI11',
    @datasrc = N'AnalyticsServer';

EXEC sp_addlinkedsrvlogin
    @rmtsrvname = N'LinkedDB',
    @useself = N'FALSE',
    @rmtuser = N'linkeduser',
    @rmtpassword = N'LinkedPassword123!';
```

## Monitoring Contained AG Status

```sql
-- Check contained AG health
SELECT
    ag.name AS ag_name,
    ag.is_contained,
    cs.synchronization_health_desc,
    cs.primary_replica,
    cs.primary_recovery_health_desc
FROM sys.availability_groups ag
JOIN sys.dm_hadr_availability_group_states cs
    ON ag.group_id = cs.group_id
WHERE ag.is_contained = 1;

-- View contained AG objects
SELECT
    type_desc,
    name,
    create_date
FROM sys.server_principals
WHERE is_contained_ag_principal = 1;
```

## Failover Behavior

```sql
-- Manual failover works the same way
ALTER AVAILABILITY GROUP [ContainedAG] FAILOVER;

-- After failover, verify objects are present
USE [ContainedAG];
SELECT name FROM sys.server_principals WHERE type = 'S';
SELECT name FROM msdb.dbo.sysjobs;
```

## Best Practices

1. **Plan for contained scope**: Not all objects can be contained
2. **Test failover thoroughly**: Ensure all application dependencies are met
3. **Monitor synchronization**: Keep system databases in sync
4. **Document external dependencies**: Some objects may still need manual sync

Contained Availability Groups dramatically simplify high availability deployments by keeping everything your application needs within the AG itself.
