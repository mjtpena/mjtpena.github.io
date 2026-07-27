---
title: "Azure SQL Edge for IoT and Edge Computing"
author: "Michael John Peña"
draft: false
date: 2022-07-19
tags: ["Azure", "SQL Edge", "IoT", "Edge Computing", "Database"]

---

I wrote "Azure SQL Edge for IoT and Edge Computing" to share practical, production-minded guidance on this topic.

## What is Azure SQL Edge?

Azure SQL Edge is a containerized SQL database engine optimized for IoT and edge deployments. It includes:

- Full SQL Server engine capabilities
- Built-in streaming analytics
- Time-series optimizations
- Machine learning inference with ONNX
- Small container footprint

## Deploying Azure SQL Edge

### Using Docker

```bash
# Pull the Azure SQL Edge image
docker pull mcr.microsoft.com/azure-sql-edge:latest

# Run the container
docker run -d \
    --name sql-edge \
    -e 'ACCEPT_EULA=Y' \
    -e 'MSSQL_SA_PASSWORD=YourStrong!Passw0rd' \
    -e 'MSSQL_PID=Premium' \
    -p 1433:1433 \
    mcr.microsoft.com/azure-sql-edge:latest

# For ARM64 devices (like Raspberry Pi 4)
docker run -d \
    --name sql-edge-arm \
    -e 'ACCEPT_EULA=Y' \
    -e 'MSSQL_SA_PASSWORD=YourStrong!Passw0rd' \
    -p 1433:1433 \
    mcr.microsoft.com/azure-sql-edge:latest
```

### Using Azure IoT Edge

```json
{
    "modulesContent": {
        "$edgeAgent": {
            "properties.desired": {
                "modules": {
                    "AzureSQLEdge": {
                        "type": "docker",
                        "status": "running",
                        "restartPolicy": "always",
                        "settings": {
                            "image": "mcr.microsoft.com/azure-sql-edge:latest",
                            "createOptions": {
                                "HostConfig": {
                                    "PortBindings": {
                                        "1433/tcp": [{"HostPort": "1433"}]
                                    }
                                }
                            }
                        },
                        "env": {
                            "ACCEPT_EULA": {"value": "Y"},
                            "MSSQL_SA_PASSWORD": {"value": "YourStrong!Passw0rd"}
                        }
                    }
                }
            }
        }
    }
}
```

## Built-in Streaming Analytics

```sql
-- Create an input stream from IoT Hub
CREATE EXTERNAL STREAM SensorInput
WITH (
    DATA_SOURCE = IoTHub,
    FILE_FORMAT = JsonFormat,
    LOCATION = N'sensors'
);

-- Create an output table for processed data
CREATE TABLE ProcessedReadings (
    SensorId INT,
    WindowStart DATETIME2,
    WindowEnd DATETIME2,
    AvgTemperature FLOAT,
    MaxTemperature FLOAT,
    ReadingCount INT
);

-- Create a streaming job
CREATE STREAMING JOB TempAggregation AS
SELECT
    SensorId,
    System.Timestamp() AS WindowEnd,
    DATEADD(minute, -5, System.Timestamp()) AS WindowStart,
    AVG(Temperature) AS AvgTemperature,
    MAX(Temperature) AS MaxTemperature,
    COUNT(*) AS ReadingCount
INTO ProcessedReadings
FROM SensorInput
TIMESTAMP BY EventTime
GROUP BY SensorId, TumblingWindow(minute, 5);

-- Start the streaming job
EXEC sys.sp_start_streaming_job @name = 'TempAggregation';
```

## Time-Series Optimization

```sql
-- Create a table with time-series optimization
CREATE TABLE SensorData (
    SensorId INT NOT NULL,
    ReadingTime DATETIME2 NOT NULL,
    Temperature FLOAT,
    Humidity FLOAT,
    INDEX IX_SensorData_Time CLUSTERED COLUMNSTORE,
    INDEX IX_SensorData_Sensor NONCLUSTERED (SensorId, ReadingTime)
);

-- Use Date_Bucket for time-series aggregation
SELECT
    SensorId,
    Date_Bucket(minute, 15, ReadingTime) AS TimeBucket,
    AVG(Temperature) AS AvgTemp,
    AVG(Humidity) AS AvgHumidity
FROM SensorData
WHERE ReadingTime >= DATEADD(hour, -24, GETUTCDATE())
GROUP BY SensorId, Date_Bucket(minute, 15, ReadingTime);
```

## Machine Learning with ONNX

```sql
-- Load an ONNX model
CREATE EXTERNAL MODEL AnomalyDetector
FROM 'https://storage.blob.core.windows.net/models/anomaly_detector.onnx'
WITH (RUNTIME = ONNX);

-- Create a prediction function
CREATE FUNCTION dbo.DetectAnomaly(@temperature FLOAT, @humidity FLOAT, @pressure FLOAT)
RETURNS TABLE
AS
RETURN (
    SELECT * FROM PREDICT(MODEL = AnomalyDetector, DATA =
        SELECT @temperature AS temperature,
               @humidity AS humidity,
               @pressure AS pressure
    ) WITH (anomaly_score FLOAT)
);

-- Use in queries
SELECT
    s.*,
    a.anomaly_score
FROM SensorData s
CROSS APPLY dbo.DetectAnomaly(s.Temperature, s.Humidity, s.Pressure) a
WHERE a.anomaly_score > 0.8;
```

## Python Integration for Edge Processing

```python
import pyodbc
import time
from datetime import datetime

class EdgeDataProcessor:
    def __init__(self):
        self.conn_str = (
            "Driver={ODBC Driver 18 for SQL Server};"
            "Server=localhost,1433;"
            "Database=EdgeDB;"
            "UID=sa;"
            "PWD=YourStrong!Passw0rd;"
            "TrustServerCertificate=yes;"
        )

    def insert_reading(self, sensor_id, temperature, humidity):
        """Insert a sensor reading"""
        with pyodbc.connect(self.conn_str) as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO SensorData (SensorId, ReadingTime, Temperature, Humidity)
                VALUES (?, GETUTCDATE(), ?, ?)
            """, sensor_id, temperature, humidity)
            conn.commit()

    def get_anomalies(self, threshold=0.8):
        """Get recent anomalies"""
        with pyodbc.connect(self.conn_str) as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT SensorId, ReadingTime, Temperature, Humidity
                FROM SensorData s
                CROSS APPLY dbo.DetectAnomaly(s.Temperature, s.Humidity, 1.0) a
                WHERE a.anomaly_score > ?
                AND ReadingTime >= DATEADD(hour, -1, GETUTCDATE())
            """, threshold)
            return cursor.fetchall()

# Usage
processor = EdgeDataProcessor()
processor.insert_reading(1, 25.5, 60.0)
anomalies = processor.get_anomalies()
```

## Data Synchronization with Cloud

```sql
-- Configure data retention for edge-to-cloud sync
ALTER DATABASE EdgeDB
SET DATA_RETENTION ON;

ALTER TABLE SensorData
SET (DATA_RETENTION_PERIOD = 7 DAYS);

-- Data older than 7 days is automatically cleaned up
-- after being synced to the cloud
```

Azure SQL Edge enables intelligent edge computing with the familiar SQL Server programming model.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
