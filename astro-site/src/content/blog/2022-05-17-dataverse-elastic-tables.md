---
title: "Dataverse Elastic Tables: High-Volume Data Storage"
author: Michael John Peña
draft: false
date: 2022-05-17
tags:
  - dataverse
  - power-platform
  - data
  - cosmos-db

---

I wrote "Dataverse Elastic Tables: High-Volume Data Storage" to share practical, production-minded guidance on this topic.

## When to Use Elastic Tables

Elastic tables are ideal for:
- IoT sensor data
- Application telemetry
- Audit logs
- High-frequency transactions
- Time-series data

## Creating an Elastic Table

Define an elastic table schema:

```csharp
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Messages;
using Microsoft.Xrm.Sdk.Metadata;

public class ElasticTableService
{
    private readonly IOrganizationService _service;

    public ElasticTableService(IOrganizationService service)
    {
        _service = service;
    }

    public void CreateSensorDataTable()
    {
        var entityMetadata = new EntityMetadata
        {
            SchemaName = "cr_sensordata",
            DisplayName = new Label("Sensor Data", 1033),
            DisplayCollectionName = new Label("Sensor Data", 1033),
            Description = new Label("IoT sensor readings", 1033),
            OwnershipType = OwnershipTypes.OrganizationOwned,
            TableType = "Elastic", // This makes it an elastic table
            IsActivity = false
        };

        // Primary key - using partitionid for CosmosDB
        var primaryAttribute = new StringAttributeMetadata
        {
            SchemaName = "cr_sensorid",
            RequiredLevel = new AttributeRequiredLevelManagedProperty(AttributeRequiredLevel.ApplicationRequired),
            MaxLength = 100,
            DisplayName = new Label("Sensor ID", 1033)
        };

        var createRequest = new CreateEntityRequest
        {
            Entity = entityMetadata,
            PrimaryAttribute = primaryAttribute
        };

        _service.Execute(createRequest);

        // Add additional attributes
        AddAttributes();
    }

    private void AddAttributes()
    {
        // Timestamp attribute
        var timestampAttr = new DateTimeAttributeMetadata
        {
            SchemaName = "cr_timestamp",
            DisplayName = new Label("Timestamp", 1033),
            RequiredLevel = new AttributeRequiredLevelManagedProperty(AttributeRequiredLevel.ApplicationRequired)
        };

        _service.Execute(new CreateAttributeRequest
        {
            EntityName = "cr_sensordata",
            Attribute = timestampAttr
        });

        // Temperature reading
        var tempAttr = new DecimalAttributeMetadata
        {
            SchemaName = "cr_temperature",
            DisplayName = new Label("Temperature", 1033),
            Precision = 2,
            MinValue = -100,
            MaxValue = 1000
        };

        _service.Execute(new CreateAttributeRequest
        {
            EntityName = "cr_sensordata",
            Attribute = tempAttr
        });

        // Humidity reading
        var humidityAttr = new DecimalAttributeMetadata
        {
            SchemaName = "cr_humidity",
            DisplayName = new Label("Humidity", 1033),
            Precision = 2,
            MinValue = 0,
            MaxValue = 100
        };

        _service.Execute(new CreateAttributeRequest
        {
            EntityName = "cr_sensordata",
            Attribute = humidityAttr
        });

        // Location JSON
        var locationAttr = new StringAttributeMetadata
        {
            SchemaName = "cr_location",
            DisplayName = new Label("Location", 1033),
            MaxLength = 4000 // JSON data
        };

        _service.Execute(new CreateAttributeRequest
        {
            EntityName = "cr_sensordata",
            Attribute = locationAttr
        });

        // Partition key for Cosmos DB
        var partitionAttr = new StringAttributeMetadata
        {
            SchemaName = "partitionid",
            DisplayName = new Label("Partition ID", 1033),
            MaxLength = 100
        };

        _service.Execute(new CreateAttributeRequest
        {
            EntityName = "cr_sensordata",
            Attribute = partitionAttr
        });
    }
}
```

## Writing High-Volume Data

Efficiently write data to elastic tables:

```csharp
public class SensorDataIngestion
{
    private readonly IOrganizationService _service;

    public SensorDataIngestion(IOrganizationService service)
    {
        _service = service;
    }

    // Single record insert
    public Guid InsertSensorReading(SensorReading reading)
    {
        var entity = new Entity("cr_sensordata");
        entity["cr_sensorid"] = reading.SensorId;
        entity["cr_timestamp"] = reading.Timestamp;
        entity["cr_temperature"] = reading.Temperature;
        entity["cr_humidity"] = reading.Humidity;
        entity["cr_location"] = JsonSerializer.Serialize(reading.Location);
        entity["partitionid"] = reading.SensorId; // Use sensor ID as partition

        return _service.Create(entity);
    }

    // Batch insert for high throughput
    public async Task<int> BatchInsertAsync(IEnumerable<SensorReading> readings)
    {
        var batchSize = 1000;
        var batches = readings.Chunk(batchSize);
        var totalInserted = 0;

        foreach (var batch in batches)
        {
            var multipleRequest = new ExecuteMultipleRequest
            {
                Settings = new ExecuteMultipleSettings
                {
                    ContinueOnError = true,
                    ReturnResponses = false
                },
                Requests = new OrganizationRequestCollection()
            };

            foreach (var reading in batch)
            {
                var entity = new Entity("cr_sensordata");
                entity["cr_sensorid"] = reading.SensorId;
                entity["cr_timestamp"] = reading.Timestamp;
                entity["cr_temperature"] = reading.Temperature;
                entity["cr_humidity"] = reading.Humidity;
                entity["cr_location"] = JsonSerializer.Serialize(reading.Location);
                entity["partitionid"] = reading.SensorId;

                multipleRequest.Requests.Add(new CreateRequest { Target = entity });
            }

            var response = (ExecuteMultipleResponse)_service.Execute(multipleRequest);
            totalInserted += batch.Count() - response.Responses.Count(r => r.Fault != null);
        }

        return totalInserted;
    }
}

public record SensorReading(
    string SensorId,
    DateTime Timestamp,
    decimal Temperature,
    decimal Humidity,
    GeoLocation Location);

public record GeoLocation(double Latitude, double Longitude, string? Address);
```

## Querying Elastic Tables

Query data efficiently with partition awareness:

```csharp
public class SensorDataQuery
{
    private readonly IOrganizationService _service;

    public SensorDataQuery(IOrganizationService service)
    {
        _service = service;
    }

    // Query by partition (sensor) - most efficient
    public List<SensorReading> GetSensorReadings(
        string sensorId,
        DateTime startTime,
        DateTime endTime)
    {
        var query = new QueryExpression("cr_sensordata")
        {
            ColumnSet = new ColumnSet(
                "cr_sensorid", "cr_timestamp",
                "cr_temperature", "cr_humidity", "cr_location"),
            Criteria = new FilterExpression
            {
                Conditions =
                {
                    new ConditionExpression("partitionid", ConditionOperator.Equal, sensorId),
                    new ConditionExpression("cr_timestamp", ConditionOperator.GreaterEqual, startTime),
                    new ConditionExpression("cr_timestamp", ConditionOperator.LessEqual, endTime)
                }
            },
            Orders =
            {
                new OrderExpression("cr_timestamp", OrderType.Descending)
            }
        };

        var results = _service.RetrieveMultiple(query);

        return results.Entities.Select(e => new SensorReading(
            e.GetAttributeValue<string>("cr_sensorid"),
            e.GetAttributeValue<DateTime>("cr_timestamp"),
            e.GetAttributeValue<decimal>("cr_temperature"),
            e.GetAttributeValue<decimal>("cr_humidity"),
            JsonSerializer.Deserialize<GeoLocation>(e.GetAttributeValue<string>("cr_location"))
        )).ToList();
    }

    // Aggregation query
    public SensorStats GetSensorStats(string sensorId, DateTime date)
    {
        var startOfDay = date.Date;
        var endOfDay = startOfDay.AddDays(1);

        var readings = GetSensorReadings(sensorId, startOfDay, endOfDay);

        if (!readings.Any())
            return new SensorStats(sensorId, date, 0, 0, 0, 0, 0, 0, 0);

        return new SensorStats(
            sensorId,
            date,
            readings.Count,
            readings.Average(r => r.Temperature),
            readings.Min(r => r.Temperature),
            readings.Max(r => r.Temperature),
            readings.Average(r => r.Humidity),
            readings.Min(r => r.Humidity),
            readings.Max(r => r.Humidity)
        );
    }
}

public record SensorStats(
    string SensorId,
    DateTime Date,
    int ReadingCount,
    decimal AvgTemperature,
    decimal MinTemperature,
    decimal MaxTemperature,
    decimal AvgHumidity,
    decimal MinHumidity,
    decimal MaxHumidity);
```

## Integration with Azure Functions

Process IoT data in real-time:

```csharp
// Azure Function for IoT Hub processing
public class IoTDataProcessor
{
    private readonly IOrganizationService _dataverseService;
    private readonly ILogger<IoTDataProcessor> _logger;

    public IoTDataProcessor(
        IOrganizationService dataverseService,
        ILogger<IoTDataProcessor> logger)
    {
        _dataverseService = dataverseService;
        _logger = logger;
    }

    [Function("ProcessIoTMessage")]
    public async Task Run(
        [EventHubTrigger("sensor-data", Connection = "EventHubConnection")]
        EventData[] events)
    {
        var readings = new List<SensorReading>();

        foreach (var eventData in events)
        {
            try
            {
                var reading = JsonSerializer.Deserialize<SensorReading>(
                    eventData.EventBody.ToString());

                if (reading != null)
                {
                    readings.Add(reading);

                    // Check for alerts
                    await CheckAlertsAsync(reading);
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error processing event");
            }
        }

        // Batch insert to elastic table
        if (readings.Any())
        {
            var ingestion = new SensorDataIngestion(_dataverseService);
            var inserted = await ingestion.BatchInsertAsync(readings);
            _logger.LogInformation($"Inserted {inserted} sensor readings");
        }
    }

    private async Task CheckAlertsAsync(SensorReading reading)
    {
        // Temperature threshold alert
        if (reading.Temperature > 40)
        {
            var alert = new Entity("cr_alert");
            alert["cr_sensorid"] = reading.SensorId;
            alert["cr_alerttype"] = "HighTemperature";
            alert["cr_message"] = $"Temperature {reading.Temperature}C exceeds threshold";
            alert["cr_timestamp"] = reading.Timestamp;
            alert["cr_severity"] = 2; // High

            _dataverseService.Create(alert);
        }

        // Humidity threshold alert
        if (reading.Humidity > 80)
        {
            var alert = new Entity("cr_alert");
            alert["cr_sensorid"] = reading.SensorId;
            alert["cr_alerttype"] = "HighHumidity";
            alert["cr_message"] = $"Humidity {reading.Humidity}% exceeds threshold";
            alert["cr_timestamp"] = reading.Timestamp;
            alert["cr_severity"] = 1; // Medium

            _dataverseService.Create(alert);
        }
    }
}
```

## Data Retention Policies

Manage data lifecycle:

```csharp
public class DataRetentionService
{
    private readonly IOrganizationService _service;

    public DataRetentionService(IOrganizationService service)
    {
        _service = service;
    }

    public async Task<int> PurgeOldDataAsync(int retentionDays)
    {
        var cutoffDate = DateTime.UtcNow.AddDays(-retentionDays);

        var query = new QueryExpression("cr_sensordata")
        {
            ColumnSet = new ColumnSet("cr_sensordataid"),
            Criteria = new FilterExpression
            {
                Conditions =
                {
                    new ConditionExpression(
                        "cr_timestamp",
                        ConditionOperator.LessThan,
                        cutoffDate)
                }
            }
        };

        query.PageInfo = new PagingInfo
        {
            Count = 5000,
            PageNumber = 1
        };

        var totalDeleted = 0;

        while (true)
        {
            var results = _service.RetrieveMultiple(query);

            if (results.Entities.Count == 0)
                break;

            var deleteRequest = new ExecuteMultipleRequest
            {
                Settings = new ExecuteMultipleSettings
                {
                    ContinueOnError = true,
                    ReturnResponses = false
                },
                Requests = new OrganizationRequestCollection()
            };

            foreach (var entity in results.Entities)
            {
                deleteRequest.Requests.Add(new DeleteRequest
                {
                    Target = entity.ToEntityReference()
                });
            }

            _service.Execute(deleteRequest);
            totalDeleted += results.Entities.Count;

            if (!results.MoreRecords)
                break;
        }

        return totalDeleted;
    }
}
```

## Summary

Dataverse elastic tables provide:

- Cosmos DB-backed storage
- Horizontal scaling
- High write throughput
- Partition-aware querying
- Integration with Power Platform

Handle billions of records while maintaining Dataverse's security and integration capabilities.


