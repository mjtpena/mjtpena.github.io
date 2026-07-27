---
title: "Pattern Matching in Streaming Data: Detecting Complex Events"
author: Michael John Peña
draft: false
date: 2022-06-30
tags:
  - azure
  - stream-analytics
  - patterns
  - cep

---

I wrote "Pattern Matching in Streaming Data: Detecting Complex Events" to share practical, production-minded guidance on this topic.

## Detecting Sequences

```sql
-- Detect login -> failed payment -> logout pattern
SELECT
    userId,
    loginTime,
    failedPaymentTime,
    logoutTime
FROM events
MATCH_RECOGNIZE (
    PARTITION BY userId
    ORDER BY eventTime
    MEASURES
        A.eventTime AS loginTime,
        B.eventTime AS failedPaymentTime,
        C.eventTime AS logoutTime
    PATTERN (A B C)
    DEFINE
        A AS A.eventType = 'login',
        B AS B.eventType = 'payment_failed',
        C AS C.eventType = 'logout'
)
```

## Anomaly Detection

```sql
-- Detect temperature spikes
SELECT
    sensorId,
    System.Timestamp() AS detectedAt,
    temperature,
    AnomalyDetection_SpikeAndDip(temperature, 95, 120, 'spikesanddips') AS anomaly
FROM sensorStream
WHERE AnomalyDetection_SpikeAndDip(temperature, 95, 120, 'spikesanddips').isAnomaly = 1
```

## Change Point Detection

```sql
-- Detect level changes in metrics
SELECT
    deviceId,
    AnomalyDetection_ChangePoint(reading, 80, 1200, 'avg') AS changePoint
FROM deviceReadings
WHERE AnomalyDetection_ChangePoint(reading, 80, 1200, 'avg').isAnomaly = 1
```

## Business Rules

```sql
-- Fraud detection: multiple high-value transactions
WITH TransactionCounts AS (
    SELECT
        cardNumber,
        COUNT(*) AS txnCount,
        SUM(amount) AS totalAmount
    FROM transactions
    GROUP BY cardNumber, TumblingWindow(minute, 5)
)
SELECT
    cardNumber,
    txnCount,
    totalAmount,
    'POTENTIAL_FRAUD' AS alert
FROM TransactionCounts
WHERE txnCount > 5 AND totalAmount > 10000
```

## Practical Example: IoT Alerts

```sql
-- Multi-condition alert
SELECT
    sensorId,
    location,
    AVG(temperature) AS avgTemp,
    AVG(humidity) AS avgHumidity,
    CASE
        WHEN AVG(temperature) > 35 AND AVG(humidity) > 80 THEN 'CRITICAL'
        WHEN AVG(temperature) > 30 OR AVG(humidity) > 70 THEN 'WARNING'
        ELSE 'NORMAL'
    END AS alertLevel
INTO alertOutput
FROM sensorData
GROUP BY sensorId, location, TumblingWindow(minute, 1)
HAVING
    AVG(temperature) > 30 OR AVG(humidity) > 70
```

## Summary

Pattern matching in streaming data enables:

- Sequence detection
- Anomaly identification
- Business rule enforcement
- Fraud detection
- Predictive maintenance

Azure Stream Analytics provides built-in functions for complex event processing at scale.


