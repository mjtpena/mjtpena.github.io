---
title: "SQL Agent Jobs in Azure SQL Managed Instance"
description: "SQL Agent in Managed Instance provides enterprise-grade job scheduling without managing infrastructure."
author: "Michael John Peña"
draft: false
date: 2022-09-21
tags: ["Azure", "SQL Managed Instance", "SQL Agent", "Automation"]
---

## Creating SQL Agent Jobs

### Basic Job Creation

```sql
-- Create a simple maintenance job
EXEC msdb.dbo.sp_add_job
    @job_name = N'DailyMaintenance',
    @enabled = 1,
    @description = N'Daily database maintenance tasks',
    @owner_login_name = N'sqladmin';

-- Add step 1: Update statistics
EXEC msdb.dbo.sp_add_jobstep
    @job_name = N'DailyMaintenance',
    @step_name = N'Update Statistics',
    @step_id = 1,
    @subsystem = N'TSQL',
    @command = N'EXEC sp_updatestats;',
    @database_name = N'MyDatabase',
    @on_success_action = 3,  -- Go to next step
    @on_fail_action = 2;     -- Quit with failure

-- Add step 2: Rebuild indexes
EXEC msdb.dbo.sp_add_jobstep
    @job_name = N'DailyMaintenance',
    @step_name = N'Rebuild Fragmented Indexes',
    @step_id = 2,
    @subsystem = N'TSQL',
    @command = N'
        DECLARE @sql NVARCHAR(MAX) = '''';

        SELECT @sql = @sql + ''ALTER INDEX '' + i.name + '' ON '' +
            SCHEMA_NAME(t.schema_id) + ''.'' + t.name + '' REBUILD;''
        FROM sys.dm_db_index_physical_stats(DB_ID(), NULL, NULL, NULL, ''LIMITED'') ips
        JOIN sys.indexes i ON ips.object_id = i.object_id AND ips.index_id = i.index_id
        JOIN sys.tables t ON i.object_id = t.object_id
        WHERE ips.avg_fragmentation_in_percent > 30
          AND i.name IS NOT NULL;

        EXEC sp_executesql @sql;
    ',
    @database_name = N'MyDatabase',
    @on_success_action = 3,
    @on_fail_action = 2;

-- Add step 3: Backup transaction log
EXEC msdb.dbo.sp_add_jobstep
    @job_name = N'DailyMaintenance',
    @step_name = N'Log Maintenance',
    @step_id = 3,
    @subsystem = N'TSQL',
    @command = N'
        -- Clear old query store data
        ALTER DATABASE MyDatabase SET QUERY_STORE CLEAR;

        -- Clean up old backup history
        DECLARE @OldestDate DATETIME = DATEADD(day, -30, GETDATE());
        EXEC msdb.dbo.sp_delete_backuphistory @oldest_date = @OldestDate;
    ',
    @database_name = N'MyDatabase',
    @on_success_action = 1,  -- Quit with success
    @on_fail_action = 2;

-- Create schedule
EXEC msdb.dbo.sp_add_schedule
    @schedule_name = N'DailyAt3AM',
    @freq_type = 4,          -- Daily
    @freq_interval = 1,
    @active_start_time = 030000;  -- 3:00 AM

-- Attach schedule to job
EXEC msdb.dbo.sp_attach_schedule
    @job_name = N'DailyMaintenance',
    @schedule_name = N'DailyAt3AM';

-- Add job server
EXEC msdb.dbo.sp_add_jobserver
    @job_name = N'DailyMaintenance';
```

### ETL Job Example

```sql
-- Create ETL job for data warehouse loading
EXEC msdb.dbo.sp_add_job
    @job_name = N'ETL_SalesDataLoad',
    @enabled = 1,
    @description = N'Load sales data to data warehouse';

-- Step 1: Extract and stage data
EXEC msdb.dbo.sp_add_jobstep
    @job_name = N'ETL_SalesDataLoad',
    @step_name = N'Extract to Staging',
    @step_id = 1,
    @subsystem = N'TSQL',
    @command = N'
        -- Clear staging table
        TRUNCATE TABLE staging.SalesData;

        -- Extract new records
        INSERT INTO staging.SalesData (
            OrderID, CustomerID, ProductID,
            Quantity, UnitPrice, OrderDate
        )
        SELECT
            o.OrderID,
            o.CustomerID,
            od.ProductID,
            od.Quantity,
            od.UnitPrice,
            o.OrderDate
        FROM dbo.Orders o
        JOIN dbo.OrderDetails od ON o.OrderID = od.OrderID
        WHERE o.OrderDate >= DATEADD(day, -1, CAST(GETDATE() AS DATE))
          AND o.OrderDate < CAST(GETDATE() AS DATE);

        -- Log extraction count
        INSERT INTO dbo.ETLLog (JobName, StepName, RecordCount, ExecutedAt)
        VALUES (''ETL_SalesDataLoad'', ''Extract'', @@ROWCOUNT, GETUTCDATE());
    ',
    @database_name = N'OperationalDB',
    @on_success_action = 3,
    @on_fail_action = 2;

-- Step 2: Transform data
EXEC msdb.dbo.sp_add_jobstep
    @job_name = N'ETL_SalesDataLoad',
    @step_name = N'Transform Data',
    @step_id = 2,
    @subsystem = N'TSQL',
    @command = N'
        -- Apply business rules and transformations
        UPDATE staging.SalesData
        SET
            TotalAmount = Quantity * UnitPrice,
            DiscountAmount = CASE
                WHEN Quantity >= 100 THEN Quantity * UnitPrice * 0.10
                WHEN Quantity >= 50 THEN Quantity * UnitPrice * 0.05
                ELSE 0
            END,
            ProcessedAt = GETUTCDATE();

        -- Flag records with data quality issues
        UPDATE staging.SalesData
        SET QualityFlag = ''REVIEW''
        WHERE UnitPrice <= 0 OR Quantity <= 0;
    ',
    @database_name = N'OperationalDB',
    @on_success_action = 3,
    @on_fail_action = 2;

-- Step 3: Load to data warehouse
EXEC msdb.dbo.sp_add_jobstep
    @job_name = N'ETL_SalesDataLoad',
    @step_name = N'Load to DW',
    @step_id = 3,
    @subsystem = N'TSQL',
    @command = N'
        -- Merge into fact table
        MERGE INTO DataWarehouse.dbo.FactSales AS target
        USING staging.SalesData AS source
        ON target.OrderID = source.OrderID AND target.ProductID = source.ProductID
        WHEN MATCHED THEN
            UPDATE SET
                Quantity = source.Quantity,
                UnitPrice = source.UnitPrice,
                TotalAmount = source.TotalAmount,
                DiscountAmount = source.DiscountAmount,
                UpdatedAt = GETUTCDATE()
        WHEN NOT MATCHED THEN
            INSERT (OrderID, CustomerID, ProductID, Quantity, UnitPrice, TotalAmount, DiscountAmount, OrderDate, LoadedAt)
            VALUES (source.OrderID, source.CustomerID, source.ProductID, source.Quantity, source.UnitPrice, source.TotalAmount, source.DiscountAmount, source.OrderDate, GETUTCDATE());

        -- Log load results
        INSERT INTO dbo.ETLLog (JobName, StepName, RecordCount, ExecutedAt)
        VALUES (''ETL_SalesDataLoad'', ''Load'', @@ROWCOUNT, GETUTCDATE());
    ',
    @database_name = N'OperationalDB',
    @on_success_action = 1,
    @on_fail_action = 2;

-- Create hourly schedule
EXEC msdb.dbo.sp_add_schedule
    @schedule_name = N'HourlyDuringBusiness',
    @freq_type = 4,
    @freq_interval = 1,
    @freq_subday_type = 4,    -- Every hour
    @freq_subday_interval = 1,
    @active_start_time = 060000,
    @active_end_time = 220000;

EXEC msdb.dbo.sp_attach_schedule
    @job_name = N'ETL_SalesDataLoad',
    @schedule_name = N'HourlyDuringBusiness';

EXEC msdb.dbo.sp_add_jobserver
    @job_name = N'ETL_SalesDataLoad';
```

### C# Job Management

```csharp
using Microsoft.Data.SqlClient;

public class SqlAgentJobManager
{
    private readonly string _connectionString;

    public SqlAgentJobManager(string connectionString)
    {
        _connectionString = connectionString;
    }

    public async Task<List<JobInfo>> GetJobsAsync()
    {
        using var connection = new SqlConnection(_connectionString);
        await connection.OpenAsync();

        var query = @"
            SELECT
                j.job_id,
                j.name,
                j.enabled,
                j.description,
                c.name AS category_name,
                ja.run_requested_date AS last_run_date,
                ja.run_requested_source,
                CASE ja.last_executed_step_id
                    WHEN 0 THEN 'Success'
                    ELSE 'Failed at step ' + CAST(ja.last_executed_step_id AS VARCHAR)
                END AS last_run_status
            FROM msdb.dbo.sysjobs j
            LEFT JOIN msdb.dbo.syscategories c ON j.category_id = c.category_id
            LEFT JOIN msdb.dbo.sysjobactivity ja ON j.job_id = ja.job_id
            WHERE ja.session_id = (SELECT MAX(session_id) FROM msdb.dbo.sysjobactivity)
            ORDER BY j.name";

        using var command = new SqlCommand(query, connection);
        var jobs = new List<JobInfo>();

        using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            jobs.Add(new JobInfo
            {
                JobId = reader.GetGuid(0),
                Name = reader.GetString(1),
                Enabled = reader.GetBoolean(2),
                Description = reader.IsDBNull(3) ? null : reader.GetString(3),
                CategoryName = reader.IsDBNull(4) ? null : reader.GetString(4),
                LastRunDate = reader.IsDBNull(5) ? null : reader.GetDateTime(5),
                LastRunStatus = reader.IsDBNull(7) ? null : reader.GetString(7)
            });
        }

        return jobs;
    }

    public async Task StartJobAsync(string jobName)
    {
        using var connection = new SqlConnection(_connectionString);
        await connection.OpenAsync();

        using var command = new SqlCommand("msdb.dbo.sp_start_job", connection)
        {
            CommandType = CommandType.StoredProcedure
        };
        command.Parameters.AddWithValue("@job_name", jobName);

        await command.ExecuteNonQueryAsync();
    }

    public async Task StopJobAsync(string jobName)
    {
        using var connection = new SqlConnection(_connectionString);
        await connection.OpenAsync();

        using var command = new SqlCommand("msdb.dbo.sp_stop_job", connection)
        {
            CommandType = CommandType.StoredProcedure
        };
        command.Parameters.AddWithValue("@job_name", jobName);

        await command.ExecuteNonQueryAsync();
    }

    public async Task<List<JobHistory>> GetJobHistoryAsync(string jobName, int maxRecords = 100)
    {
        using var connection = new SqlConnection(_connectionString);
        await connection.OpenAsync();

        var query = @"
            SELECT TOP (@MaxRecords)
                j.name AS job_name,
                h.step_name,
                h.run_status,
                h.run_date,
                h.run_time,
                h.run_duration,
                h.message
            FROM msdb.dbo.sysjobhistory h
            JOIN msdb.dbo.sysjobs j ON h.job_id = j.job_id
            WHERE j.name = @JobName
            ORDER BY h.run_date DESC, h.run_time DESC";

        using var command = new SqlCommand(query, connection);
        command.Parameters.AddWithValue("@JobName", jobName);
        command.Parameters.AddWithValue("@MaxRecords", maxRecords);

        var history = new List<JobHistory>();
        using var reader = await command.ExecuteReaderAsync();

        while (await reader.ReadAsync())
        {
            history.Add(new JobHistory
            {
                JobName = reader.GetString(0),
                StepName = reader.GetString(1),
                RunStatus = reader.GetInt32(2) switch
                {
                    0 => "Failed",
                    1 => "Succeeded",
                    2 => "Retry",
                    3 => "Canceled",
                    _ => "Unknown"
                },
                RunDate = reader.GetInt32(3),
                RunTime = reader.GetInt32(4),
                DurationSeconds = ParseDuration(reader.GetInt32(5)),
                Message = reader.GetString(6)
            });
        }

        return history;
    }

    private int ParseDuration(int duration)
    {
        // Duration is stored as HHMMSS
        int hours = duration / 10000;
        int minutes = (duration % 10000) / 100;
        int seconds = duration % 100;
        return hours * 3600 + minutes * 60 + seconds;
    }
}

public class JobInfo
{
    public Guid JobId { get; set; }
    public string Name { get; set; }
    public bool Enabled { get; set; }
    public string Description { get; set; }
    public string CategoryName { get; set; }
    public DateTime? LastRunDate { get; set; }
    public string LastRunStatus { get; set; }
}

public class JobHistory
{
    public string JobName { get; set; }
    public string StepName { get; set; }
    public string RunStatus { get; set; }
    public int RunDate { get; set; }
    public int RunTime { get; set; }
    public int DurationSeconds { get; set; }
    public string Message { get; set; }
}
```

### Job Notifications

```sql
-- Configure alert for job failures
EXEC msdb.dbo.sp_add_operator
    @name = N'DBA_Team',
    @enabled = 1,
    @email_address = N'dba@company.com';

-- Add notification to job
EXEC msdb.dbo.sp_add_notification
    @job_name = N'DailyMaintenance',
    @operator_name = N'DBA_Team',
    @notification_method = 1;  -- Email
```

SQL Agent in Managed Instance provides enterprise-grade job scheduling without managing infrastructure.
