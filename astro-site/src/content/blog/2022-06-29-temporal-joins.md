---
title: "Temporal Joins: Correlating Events Across Time"
author: Michael John Peña
draft: false
date: 2022-06-29
tags:
  - Azure
  - stream-analytics
  - temporal
  - Data
---

## Time-Based Joins

```sql
-- Join clicks with impressions within 30 minutes
SELECT
    i.adId,
    i.userId,
    i.impressionTime,
    c.clickTime,
    DATEDIFF(second, i.impressionTime, c.clickTime) AS timeToClick
FROM impressions i
JOIN clicks c
ON i.adId = c.adId AND i.userId = c.userId
AND DATEDIFF(minute, i, c) BETWEEN 0 AND 30
```

## Session Windows

```sql
-- Group events into sessions
SELECT
    userId,
    MIN(eventTime) AS sessionStart,
    MAX(eventTime) AS sessionEnd,
    COUNT(*) AS eventCount,
    DATEDIFF(second, MIN(eventTime), MAX(eventTime)) AS sessionDuration
FROM userEvents
GROUP BY userId, SessionWindow(eventTime, INTERVAL '5' MINUTE, INTERVAL '30' MINUTE)
```

## Event Ordering

```sql
-- Find sequence of events
SELECT
    userId,
    LAG(eventType, 1) OVER (PARTITION BY userId LIMIT DURATION(minute, 10)) AS prevEvent,
    eventType AS currentEvent,
    LEAD(eventType, 1) OVER (PARTITION BY userId LIMIT DURATION(minute, 10)) AS nextEvent
FROM userEvents
```

## Sliding Windows

```sql
-- Detect rapid temperature changes
SELECT
    sensorId,
    System.Timestamp() AS windowEnd,
    AVG(temperature) AS avgTemp,
    MAX(temperature) - MIN(temperature) AS tempRange
FROM sensorReadings
GROUP BY sensorId, SlidingWindow(minute, 5)
HAVING MAX(temperature) - MIN(temperature) > 10
```

## Summary

Temporal joins and windows enable sophisticated event correlation, essential for IoT analytics, fraud detection, and user behavior analysis.
