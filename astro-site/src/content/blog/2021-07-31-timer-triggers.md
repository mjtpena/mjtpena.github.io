---
title: Scheduling Tasks with Azure Functions Timer Triggers
author: Michael John Peña
draft: false
date: 2021-07-31
url: /blog/timer-triggers/
tags:
  - Azure
  - Serverless
  - Azure Functions
  - Scheduling
  - Automation
---

## Basic Timer Trigger

Create a scheduled function:

```csharp
using System;
using System.Threading.Tasks;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Logging;

public class ScheduledFunctions
{
    private readonly ILogger<ScheduledFunctions> _logger;

    public ScheduledFunctions(ILogger<ScheduledFunctions> logger)
    {
        _logger = logger;
    }

    // Run every 5 minutes
    [Function("CleanupTempFiles")]
    public async Task CleanupTempFiles(
        [TimerTrigger("0 */5 * * * *")] TimerInfo timer)
    {
        _logger.LogInformation("Cleanup started at {Time}", DateTime.UtcNow);

        if (timer.IsPastDue)
        {
            _logger.LogWarning("Timer is running late!");
        }

        await PerformCleanupAsync();

        _logger.LogInformation("Next scheduled run: {NextRun}", timer.ScheduleStatus?.Next);
    }

    // Run at 2 AM every day
    [Function("DailyReport")]
    public async Task DailyReport(
        [TimerTrigger("0 0 2 * * *")] TimerInfo timer)
    {
        _logger.LogInformation("Generating daily report");

        await GenerateDailyReportAsync();
    }

    // Run every Monday at 9 AM
    [Function("WeeklyDigest")]
    public async Task WeeklyDigest(
        [TimerTrigger("0 0 9 * * 1")] TimerInfo timer)
    {
        _logger.LogInformation("Generating weekly digest");

        await GenerateWeeklyDigestAsync();
    }

    // Run on the 1st of every month at midnight
    [Function("MonthlyBilling")]
    public async Task MonthlyBilling(
        [TimerTrigger("0 0 0 1 * *")] TimerInfo timer)
    {
        _logger.LogInformation("Processing monthly billing");

        await ProcessMonthlyBillingAsync();
    }
}
```

## CRON Expression Reference

Common CRON patterns:

```csharp
public class CronExamples
{
    // CRON format: {second} {minute} {hour} {day} {month} {day-of-week}

    // Every minute
    [TimerTrigger("0 * * * * *")]

    // Every 5 minutes
    [TimerTrigger("0 */5 * * * *")]

    // Every hour at minute 0
    [TimerTrigger("0 0 * * * *")]

    // Every day at 2:30 AM
    [TimerTrigger("0 30 2 * * *")]

    // Every weekday at 9 AM
    [TimerTrigger("0 0 9 * * 1-5")]

    // Every Monday at 10 AM
    [TimerTrigger("0 0 10 * * 1")]

    // First day of month at midnight
    [TimerTrigger("0 0 0 1 * *")]

    // Every 15th and last day of month
    [TimerTrigger("0 0 0 15,L * *")]

    // Every quarter (Jan, Apr, Jul, Oct) on the 1st
    [TimerTrigger("0 0 0 1 1,4,7,10 *")]
}
```

## Handling Long-Running Tasks

Implement patterns for tasks that may exceed timeout:

```csharp
public class LongRunningScheduledTasks
{
    private readonly ILogger<LongRunningScheduledTasks> _logger;
    private readonly QueueClient _workQueue;
    private readonly IDataService _dataService;

    // For long-running tasks, trigger a queue-based workflow
    [Function("InitiateBatchProcessing")]
    public async Task InitiateBatchProcessing(
        [TimerTrigger("0 0 1 * * *")] TimerInfo timer,
        [QueueOutput("batch-work-items", Connection = "StorageConnection")]
        IAsyncCollector<BatchWorkItem> workItems)
    {
        _logger.LogInformation("Initiating batch processing");

        // Get all items to process
        var items = await _dataService.GetItemsForProcessingAsync();

        _logger.LogInformation("Found {Count} items to process", items.Count);

        // Queue each item for parallel processing
        foreach (var item in items)
        {
            await workItems.AddAsync(new BatchWorkItem
            {
                ItemId = item.Id,
                BatchId = Guid.NewGuid().ToString(),
                ScheduledAt = DateTime.UtcNow
            });
        }

        _logger.LogInformation("Queued {Count} work items", items.Count);
    }

    // For tasks that need checkpointing
    [Function("ProcessWithCheckpoint")]
    public async Task ProcessWithCheckpoint(
        [TimerTrigger("0 */30 * * * *")] TimerInfo timer,
        [BlobInput("checkpoints/batch-status.json", Connection = "StorageConnection")]
        BatchStatus checkpoint,
        [BlobOutput("checkpoints/batch-status.json", Connection = "StorageConnection")]
        IAsyncCollector<BatchStatus> checkpointOutput)
    {
        var status = checkpoint ?? new BatchStatus { LastProcessedId = 0 };

        _logger.LogInformation("Resuming from checkpoint: {LastId}", status.LastProcessedId);

        var batchSize = 100;
        var processed = 0;

        while (processed < 1000) // Limit per execution
        {
            var items = await _dataService.GetNextBatchAsync(
                status.LastProcessedId,
                batchSize);

            if (!items.Any())
            {
                _logger.LogInformation("No more items to process");
                break;
            }

            foreach (var item in items)
            {
                await ProcessItemAsync(item);
                status.LastProcessedId = item.Id;
                processed++;
            }

            // Save checkpoint
            await checkpointOutput.AddAsync(status);
        }

        _logger.LogInformation("Processed {Count} items, last ID: {LastId}",
            processed, status.LastProcessedId);
    }
}
```

## Preventing Duplicate Executions

Ensure single instance execution:

```csharp
public class SingletonTimerFunctions
{
    private readonly IDistributedLock _lockProvider;
    private readonly ILogger<SingletonTimerFunctions> _logger;

    [Function("SingletonTask")]
    public async Task SingletonTask(
        [TimerTrigger("0 */10 * * * *")] TimerInfo timer)
    {
        var lockId = "singleton-task-lock";

        // Try to acquire distributed lock
        await using var lockHandle = await _lockProvider.TryAcquireAsync(
            lockId,
            TimeSpan.FromMinutes(15));

        if (lockHandle == null)
        {
            _logger.LogWarning("Could not acquire lock, another instance is running");
            return;
        }

        _logger.LogInformation("Lock acquired, executing task");

        try
        {
            await ExecuteTaskAsync();
        }
        finally
        {
            _logger.LogInformation("Task completed, releasing lock");
        }
    }
}

// Alternative: Use host.json singleton setting
// host.json
{
    "version": "2.0",
    "singleton": {
        "lockPeriod": "00:00:15",
        "listenerLockPeriod": "00:01:00",
        "listenerLockRecoveryPollingInterval": "00:01:00",
        "lockAcquisitionTimeout": "00:01:00",
        "lockAcquisitionPollingInterval": "00:00:03"
    }
}
```

## Dynamic Schedules

Configure schedules from app settings:

```csharp
public class DynamicScheduledFunctions
{
    // Schedule from app setting
    [Function("ConfigurableTask")]
    public async Task ConfigurableTask(
        [TimerTrigger("%TaskSchedule%")] TimerInfo timer)
    {
        // TaskSchedule app setting contains the CRON expression
        await ExecuteTaskAsync();
    }
}

// For more complex scenarios, use Durable Functions
public class DurableScheduledFunctions
{
    [Function("SchedulerOrchestrator")]
    public async Task SchedulerOrchestrator(
        [OrchestrationTrigger] TaskOrchestrationContext context)
    {
        // Get schedule from configuration
        var scheduleConfig = await context.CallActivityAsync<ScheduleConfig>(
            "GetScheduleConfig", null);

        while (true)
        {
            // Execute the scheduled task
            await context.CallActivityAsync("ExecuteScheduledTask", scheduleConfig);

            // Calculate next run time
            var nextRun = CalculateNextRun(scheduleConfig);
            await context.CreateTimer(nextRun, CancellationToken.None);
        }
    }

    [Function("GetScheduleConfig")]
    public async Task<ScheduleConfig> GetScheduleConfig(
        [ActivityTrigger] object input)
    {
        // Load from database or configuration service
        return await _configService.GetScheduleConfigAsync();
    }
}
```

## Error Handling and Retry

Implement robust error handling:

```csharp
public class RobustTimerFunctions
{
    private readonly ILogger<RobustTimerFunctions> _logger;
    private readonly IAlertService _alertService;

    [Function("RobustScheduledTask")]
    public async Task RobustScheduledTask(
        [TimerTrigger("0 0 * * * *")] TimerInfo timer)
    {
        var startTime = DateTime.UtcNow;
        var taskName = "HourlyDataSync";

        try
        {
            _logger.LogInformation("Starting {TaskName}", taskName);

            // Track execution metrics
            using var operation = _telemetry.StartOperation<RequestTelemetry>(taskName);

            await ExecuteWithRetryAsync(async () =>
            {
                await SyncDataAsync();
            }, maxRetries: 3);

            var duration = DateTime.UtcNow - startTime;
            _logger.LogInformation("{TaskName} completed in {Duration}",
                taskName, duration);

            operation.Telemetry.Success = true;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "{TaskName} failed after retries", taskName);

            // Send alert
            await _alertService.SendAlertAsync(new Alert
            {
                Severity = AlertSeverity.High,
                Title = $"Scheduled task {taskName} failed",
                Description = ex.Message,
                Timestamp = DateTime.UtcNow
            });

            // Optionally throw to mark function as failed
            throw;
        }
    }

    private async Task ExecuteWithRetryAsync(Func<Task> action, int maxRetries)
    {
        var retryCount = 0;
        var delay = TimeSpan.FromSeconds(5);

        while (true)
        {
            try
            {
                await action();
                return;
            }
            catch (Exception ex) when (retryCount < maxRetries)
            {
                retryCount++;
                _logger.LogWarning(ex,
                    "Attempt {Attempt} failed, retrying in {Delay}",
                    retryCount, delay);

                await Task.Delay(delay);
                delay = TimeSpan.FromSeconds(delay.TotalSeconds * 2); // Exponential backoff
            }
        }
    }
}
```

## Monitoring Timer Functions

Monitor scheduled function execution:

```python
# KQL queries for monitoring timer functions

# Execution history
traces
| where timestamp > ago(24h)
| where operation_Name contains "Timer"
| summarize
    Executions = count(),
    Failures = countif(severityLevel >= 3),
    AvgDuration = avg(duration)
    by operation_Name, bin(timestamp, 1h)
| render timechart

# Missed executions
customEvents
| where timestamp > ago(24h)
| where name == "TimerInfo"
| extend IsPastDue = tobool(customDimensions.IsPastDue)
| where IsPastDue == true
| project timestamp, operation_Name, customDimensions
```

```csharp
// Add custom telemetry
public class MonitoredTimerFunction
{
    private readonly TelemetryClient _telemetry;

    [Function("MonitoredTask")]
    public async Task MonitoredTask(
        [TimerTrigger("0 */15 * * * *")] TimerInfo timer)
    {
        // Track if timer is late
        if (timer.IsPastDue)
        {
            _telemetry.TrackEvent("TimerPastDue", new Dictionary<string, string>
            {
                ["FunctionName"] = "MonitoredTask",
                ["ScheduledTime"] = timer.ScheduleStatus?.Last.ToString()
            });
        }

        var stopwatch = Stopwatch.StartNew();

        await ExecuteTaskAsync();

        stopwatch.Stop();

        // Track custom metrics
        _telemetry.TrackMetric("TaskDuration", stopwatch.ElapsedMilliseconds);
        _telemetry.TrackMetric("TaskSuccess", 1);
    }
}
```

## Best Practices

Timer trigger recommendations:

```python
best_practices = {
    "scheduling": [
        "Use UTC time zone for consistency across regions",
        "Avoid scheduling at exactly :00 minutes (high contention)",
        "Consider time zone differences for business-critical tasks",
        "Use configuration for schedules to enable changes without deployment"
    ],
    "reliability": [
        "Handle IsPastDue gracefully - decide whether to skip or run",
        "Implement idempotency for tasks that might run multiple times",
        "Use distributed locks for singleton execution",
        "Add checkpointing for long-running tasks"
    ],
    "monitoring": [
        "Track execution duration and success/failure",
        "Alert on missed executions (IsPastDue)",
        "Monitor function timeout approaching",
        "Log start and completion with correlation IDs"
    ],
    "scaling": [
        "For intensive tasks, use timer to trigger queue-based processing",
        "Consider Premium plan to avoid cold starts for critical schedules",
        "Break large tasks into smaller scheduled increments"
    ]
}

for category, practices in best_practices.items():
    print(f"\n{category.upper()}:")
    for practice in practices:
        print(f"  - {practice}")
```

## Conclusion

Timer-triggered Azure Functions provide a powerful, serverless approach to scheduled tasks. From simple cleanup jobs to complex batch processing workflows, timer triggers enable you to run code reliably on a schedule without managing infrastructure.

Key practices include handling late executions appropriately, implementing idempotency for reliability, and monitoring execution patterns. For tasks that may exceed function timeout limits, consider using timer triggers to initiate queue-based workflows that can process in parallel.

Combined with other Azure services like Durable Functions for complex orchestrations or Logic Apps for visual workflow design, timer triggers are a versatile tool in your serverless toolkit.
