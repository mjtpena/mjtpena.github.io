---
title: "Mastering IoT Hub Queries for Device Management"
author: "Michael John Peña"
draft: false
date: 2022-07-28
tags: ["Azure", "IoT Hub", "Queries", "Device Management", "Device Twin"]

---

I wrote "Mastering IoT Hub Queries for Device Management" to share practical, production-minded guidance on this topic.

## Query Basics

IoT Hub queries support:
- Device twin queries
- Job queries
- Module twin queries

## Device Twin Queries

### Basic Queries

```sql
-- Get all devices
SELECT * FROM devices

-- Get specific device
SELECT * FROM devices WHERE deviceId = 'device001'

-- Get devices by tag
SELECT * FROM devices WHERE tags.location = 'building1'

-- Get devices by reported property
SELECT * FROM devices WHERE properties.reported.firmwareVersion = '1.2.3'

-- Get devices by desired property
SELECT * FROM devices WHERE properties.desired.telemetryInterval = 60
```

### Advanced Filtering

```sql
-- Multiple conditions
SELECT * FROM devices
WHERE tags.location = 'building1'
  AND properties.reported.status = 'online'
  AND properties.reported.batteryLevel > 20

-- Using OR conditions
SELECT * FROM devices
WHERE tags.deviceType = 'sensor'
  OR tags.deviceType = 'gateway'

-- Checking for property existence
SELECT * FROM devices
WHERE IS_DEFINED(tags.location)

-- Null checks
SELECT * FROM devices
WHERE tags.owner != null

-- String operations
SELECT * FROM devices
WHERE STARTSWITH(deviceId, 'prod-')

SELECT * FROM devices
WHERE ENDSWITH(tags.location, '-floor1')

SELECT * FROM devices
WHERE CONTAINS(tags.description, 'temperature')
```

### Projection and Aggregation

```sql
-- Select specific fields
SELECT deviceId, tags.location, properties.reported.status
FROM devices
WHERE tags.deviceType = 'sensor'

-- Count devices
SELECT COUNT() AS totalDevices FROM devices

-- Count by tag
SELECT tags.location, COUNT() AS deviceCount
FROM devices
GROUP BY tags.location

-- Get top N results
SELECT TOP 10 * FROM devices
WHERE properties.reported.batteryLevel < 30
ORDER BY properties.reported.batteryLevel ASC
```

## Running Queries with Python

```python
from azure.iot.hub import IoTHubRegistryManager
from azure.iot.hub.models import QuerySpecification

class DeviceQueryManager:
    def __init__(self, connection_string):
        self.registry = IoTHubRegistryManager.from_connection_string(connection_string)

    def query_devices(self, query_string):
        """Execute a device twin query"""
        query_spec = QuerySpecification(query=query_string)

        # Get query result with pagination
        query_result = self.registry.query_iot_hub(query_spec)

        devices = []
        continuation_token = None

        while True:
            # Get next page of results
            response = self.registry.query_iot_hub(
                query_spec,
                continuation_token=continuation_token,
                max_items_per_page=100
            )

            devices.extend(response.items)

            if not response.continuation_token:
                break

            continuation_token = response.continuation_token

        return devices

    def get_devices_by_location(self, location):
        """Get all devices in a specific location"""
        query = f"SELECT * FROM devices WHERE tags.location = '{location}'"
        return self.query_devices(query)

    def get_offline_devices(self):
        """Get devices that haven't reported recently"""
        query = """
            SELECT deviceId, properties.reported.lastHeartbeat
            FROM devices
            WHERE properties.reported.status = 'offline'
               OR NOT IS_DEFINED(properties.reported.lastHeartbeat)
        """
        return self.query_devices(query)

    def get_devices_needing_update(self, target_version):
        """Get devices with outdated firmware"""
        query = f"""
            SELECT deviceId, properties.reported.firmwareVersion
            FROM devices
            WHERE properties.reported.firmwareVersion != '{target_version}'
              AND tags.autoUpdate = true
        """
        return self.query_devices(query)

    def get_device_statistics(self):
        """Get device statistics by type"""
        query = """
            SELECT tags.deviceType, COUNT() as count
            FROM devices
            GROUP BY tags.deviceType
        """
        return self.query_devices(query)

# Usage
manager = DeviceQueryManager(IOT_HUB_CONNECTION_STRING)

# Find all sensors in building 1
sensors = manager.get_devices_by_location("building1")
print(f"Found {len(sensors)} devices in building1")

# Find devices needing firmware update
outdated = manager.get_devices_needing_update("2.0.0")
for device in outdated:
    print(f"{device['deviceId']}: {device.get('properties', {}).get('reported', {}).get('firmwareVersion')}")
```

## Job Queries

```sql
-- Get all running jobs
SELECT * FROM devices.jobs
WHERE devices.jobs.status = 'running'

-- Get failed jobs
SELECT * FROM devices.jobs
WHERE devices.jobs.status = 'failed'

-- Get jobs for specific device
SELECT * FROM devices.jobs
WHERE devices.jobs.deviceId = 'device001'

-- Get jobs by type
SELECT * FROM devices.jobs
WHERE devices.jobs.type = 'firmwareUpdate'
```

## Module Twin Queries

```sql
-- Get all modules
SELECT * FROM devices.modules

-- Get modules by device
SELECT * FROM devices.modules
WHERE deviceId = 'gateway001'

-- Get specific module type
SELECT * FROM devices.modules
WHERE properties.reported.moduleType = 'temperatureSensor'
```

## Query Performance Tips

```python
def efficient_query_patterns():
    """Examples of efficient query patterns"""

    # Good: Use specific filters
    good_query = """
        SELECT deviceId, properties.reported.status
        FROM devices
        WHERE tags.location = 'building1'
          AND tags.floor = 'floor2'
    """

    # Avoid: Selecting all fields when not needed
    # SELECT * FROM devices

    # Good: Use TOP for limited results
    good_query_top = """
        SELECT TOP 100 deviceId, properties.reported.batteryLevel
        FROM devices
        WHERE properties.reported.batteryLevel < 30
        ORDER BY properties.reported.batteryLevel ASC
    """

    # Good: Use pagination for large result sets
    def paginated_query(registry, query, page_size=100):
        continuation = None
        while True:
            result = registry.query_iot_hub(
                QuerySpecification(query=query),
                continuation_token=continuation,
                max_items_per_page=page_size
            )
            yield from result.items
            if not result.continuation_token:
                break
            continuation = result.continuation_token
```

## Real-World Query Scenarios

```python
class FleetManager:
    def __init__(self, registry):
        self.registry = registry

    def find_unhealthy_devices(self):
        """Find devices with issues"""
        query = """
            SELECT deviceId, tags.location,
                   properties.reported.status,
                   properties.reported.errorCount,
                   properties.reported.lastError
            FROM devices
            WHERE properties.reported.errorCount > 0
               OR properties.reported.status = 'error'
        """
        return self.query(query)

    def find_devices_for_maintenance(self, days_threshold=30):
        """Find devices due for maintenance"""
        query = f"""
            SELECT deviceId, tags.location,
                   properties.reported.lastMaintenanceDate
            FROM devices
            WHERE tags.requiresMaintenance = true
        """
        return self.query(query)

    def get_fleet_summary(self):
        """Get summary of device fleet"""
        queries = {
            'total': "SELECT COUNT() FROM devices",
            'online': "SELECT COUNT() FROM devices WHERE properties.reported.status = 'online'",
            'offline': "SELECT COUNT() FROM devices WHERE properties.reported.status = 'offline'",
            'by_type': "SELECT tags.deviceType, COUNT() FROM devices GROUP BY tags.deviceType"
        }
        return {name: self.query(q) for name, q in queries.items()}
```

Effective use of IoT Hub queries enables proactive device fleet management at scale.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
