---
title: Azure IoT Hub Device Twins for State Management
author: Michael John Pena
draft: false
date: 2021-03-19
url: /blog/iot-hub-device-twins/
tags:
  - Azure
  - IoT Hub
  - Device Twins
  - IoT
  - Edge Computing
---

Device twins are the feature in Azure IoT Hub that solved a problem I didn't fully appreciate until a client had 3,000 industrial sensors in two factories and needed to push a configuration change to all of them without a network outage making it impossible. Device twins are JSON documents in IoT Hub—one section for desired state (what the cloud wants the device to be doing) and one for reported state (what the device says it's actually doing). The reconciliation loop runs on the device and the cloud independently. The device can be offline; when it reconnects, it gets the latest desired properties. No message queue, no polling design, just event-driven state synchronisation.

## Understanding Device Twins

A device twin consists of three main sections:
- **Tags**: Metadata visible only to the solution backend
- **Desired Properties**: Set by the backend, read by the device
- **Reported Properties**: Set by the device, read by the backend

```json
{
    "deviceId": "sensor-001",
    "etag": "AAAAAAAAAAE=",
    "version": 4,
    "tags": {
        "location": {
            "building": "Building-A",
            "floor": 3,
            "room": "Conference-Room-301"
        },
        "deployment": {
            "environment": "production",
            "region": "eastus"
        }
    },
    "properties": {
        "desired": {
            "telemetryInterval": 30,
            "temperatureThreshold": 25,
            "firmwareVersion": "2.1.0",
            "$metadata": {},
            "$version": 3
        },
        "reported": {
            "telemetryInterval": 30,
            "temperatureThreshold": 25,
            "firmwareVersion": "2.0.5",
            "lastFirmwareUpdate": "2021-03-15T10:30:00Z",
            "connectivity": {
                "type": "wifi",
                "signal": -45
            },
            "$metadata": {},
            "$version": 5
        }
    }
}
```

## Creating and Managing Device Twins

### Using Azure CLI

```bash
# Create IoT Hub
az iot hub create \
    --name myiothub \
    --resource-group myResourceGroup \
    --sku S1

# Register a device
az iot hub device-identity create \
    --hub-name myiothub \
    --device-id sensor-001

# Update device twin tags
az iot hub device-twin update \
    --hub-name myiothub \
    --device-id sensor-001 \
    --tags '{
        "location": {"building": "Building-A", "floor": 3},
        "deployment": {"environment": "production"}
    }'

# Update desired properties
az iot hub device-twin update \
    --hub-name myiothub \
    --device-id sensor-001 \
    --desired '{
        "telemetryInterval": 30,
        "temperatureThreshold": 25
    }'

# Get device twin
az iot hub device-twin show \
    --hub-name myiothub \
    --device-id sensor-001
```

### Backend Service (.NET)

```csharp
using Microsoft.Azure.Devices;
using Microsoft.Azure.Devices.Shared;
using System.Text.Json;

public class DeviceTwinService
{
    private readonly RegistryManager _registryManager;

    public DeviceTwinService(string connectionString)
    {
        _registryManager = RegistryManager.CreateFromConnectionString(connectionString);
    }

    public async Task<Twin> GetDeviceTwinAsync(string deviceId)
    {
        return await _registryManager.GetTwinAsync(deviceId);
    }

    public async Task UpdateTagsAsync(string deviceId, object tags)
    {
        var twin = await _registryManager.GetTwinAsync(deviceId);

        var patch = new Twin();
        patch.Tags = new TwinCollection(JsonSerializer.Serialize(tags));

        await _registryManager.UpdateTwinAsync(deviceId, patch, twin.ETag);
    }

    public async Task UpdateDesiredPropertiesAsync(string deviceId, object desiredProperties)
    {
        var twin = await _registryManager.GetTwinAsync(deviceId);

        var patch = new Twin();
        patch.Properties.Desired = new TwinCollection(JsonSerializer.Serialize(desiredProperties));

        await _registryManager.UpdateTwinAsync(deviceId, patch, twin.ETag);
    }

    public async Task<IEnumerable<Twin>> QueryDevicesAsync(string query)
    {
        var twins = new List<Twin>();
        var queryResult = _registryManager.CreateQuery(query);

        while (queryResult.HasMoreResults)
        {
            var page = await queryResult.GetNextAsTwinAsync();
            twins.AddRange(page);
        }

        return twins;
    }
}

// Usage
var service = new DeviceTwinService(connectionString);

// Update tags for device organization
await service.UpdateTagsAsync("sensor-001", new
{
    location = new { building = "Building-A", floor = 3 },
    deployment = new { environment = "production" }
});

// Update desired configuration
await service.UpdateDesiredPropertiesAsync("sensor-001", new
{
    telemetryInterval = 15,
    temperatureThreshold = 28,
    firmwareVersion = "2.1.0"
});

// Query devices by tags
var query = @"
    SELECT * FROM devices
    WHERE tags.location.building = 'Building-A'
    AND tags.deployment.environment = 'production'";

var devices = await service.QueryDevicesAsync(query);
```

## Device-Side Implementation

### Python Device Client

```python
import asyncio
from azure.iot.device.aio import IoTHubDeviceClient
from azure.iot.device import MethodResponse
import json

class IoTDevice:
    def __init__(self, connection_string):
        self.client = IoTHubDeviceClient.create_from_connection_string(connection_string)
        self.current_config = {
            'telemetryInterval': 60,
            'temperatureThreshold': 25
        }

    async def connect(self):
        await self.client.connect()

        # Set up handlers
        self.client.on_twin_desired_properties_patch_received = self.handle_twin_patch

        # Get initial twin
        twin = await self.client.get_twin()
        await self.apply_desired_properties(twin['desired'])

    async def handle_twin_patch(self, patch):
        """Handle desired property updates from backend."""
        print(f"Received twin patch: {patch}")
        await self.apply_desired_properties(patch)

    async def apply_desired_properties(self, desired):
        """Apply configuration changes and report back."""
        changes_applied = {}

        if 'telemetryInterval' in desired:
            self.current_config['telemetryInterval'] = desired['telemetryInterval']
            changes_applied['telemetryInterval'] = desired['telemetryInterval']

        if 'temperatureThreshold' in desired:
            self.current_config['temperatureThreshold'] = desired['temperatureThreshold']
            changes_applied['temperatureThreshold'] = desired['temperatureThreshold']

        if 'firmwareVersion' in desired:
            # Simulate firmware update
            new_version = desired['firmwareVersion']
            changes_applied['firmwareUpdateStatus'] = 'downloading'
            await self.report_properties(changes_applied)

            # Simulate update process
            await asyncio.sleep(5)
            changes_applied['firmwareVersion'] = new_version
            changes_applied['firmwareUpdateStatus'] = 'completed'
            changes_applied['lastFirmwareUpdate'] = datetime.utcnow().isoformat()

        await self.report_properties(changes_applied)

    async def report_properties(self, properties):
        """Report device state to IoT Hub."""
        reported_patch = properties
        await self.client.patch_twin_reported_properties(reported_patch)
        print(f"Reported properties: {reported_patch}")

    async def send_telemetry_loop(self):
        """Send telemetry at configured interval."""
        import random

        while True:
            temperature = 20 + random.random() * 10
            humidity = 40 + random.random() * 20

            telemetry = {
                'temperature': temperature,
                'humidity': humidity,
                'timestamp': datetime.utcnow().isoformat()
            }

            # Check threshold
            if temperature > self.current_config['temperatureThreshold']:
                telemetry['alert'] = 'high_temperature'

            await self.client.send_message(json.dumps(telemetry))
            print(f"Sent telemetry: {telemetry}")

            # Report connectivity status periodically
            await self.report_properties({
                'connectivity': {
                    'type': 'wifi',
                    'lastConnected': datetime.utcnow().isoformat()
                }
            })

            await asyncio.sleep(self.current_config['telemetryInterval'])

    async def run(self):
        await self.connect()
        await self.send_telemetry_loop()

# Run the device
async def main():
    device = IoTDevice(
        "HostName=myiothub.azure-devices.net;DeviceId=sensor-001;SharedAccessKey=xxx"
    )
    await device.run()

asyncio.run(main())
```

### C# Device Client

```csharp
using Microsoft.Azure.Devices.Client;
using Microsoft.Azure.Devices.Shared;
using System.Text;
using System.Text.Json;

public class IoTDevice
{
    private readonly DeviceClient _client;
    private DeviceConfiguration _config = new();

    public IoTDevice(string connectionString)
    {
        _client = DeviceClient.CreateFromConnectionString(
            connectionString,
            TransportType.Mqtt);
    }

    public async Task RunAsync(CancellationToken cancellationToken)
    {
        // Set up twin change handler
        await _client.SetDesiredPropertyUpdateCallbackAsync(
            OnDesiredPropertyChanged, null);

        // Get initial twin
        var twin = await _client.GetTwinAsync();
        await ApplyDesiredProperties(twin.Properties.Desired);

        // Start telemetry loop
        await SendTelemetryLoopAsync(cancellationToken);
    }

    private async Task OnDesiredPropertyChanged(
        TwinCollection desiredProperties, object userContext)
    {
        Console.WriteLine($"Desired property change: {desiredProperties.ToJson()}");
        await ApplyDesiredProperties(desiredProperties);
    }

    private async Task ApplyDesiredProperties(TwinCollection desired)
    {
        var reported = new TwinCollection();

        if (desired.Contains("telemetryInterval"))
        {
            _config.TelemetryInterval = desired["telemetryInterval"];
            reported["telemetryInterval"] = _config.TelemetryInterval;
        }

        if (desired.Contains("temperatureThreshold"))
        {
            _config.TemperatureThreshold = desired["temperatureThreshold"];
            reported["temperatureThreshold"] = _config.TemperatureThreshold;
        }

        await _client.UpdateReportedPropertiesAsync(reported);
    }

    private async Task SendTelemetryLoopAsync(CancellationToken cancellationToken)
    {
        var random = new Random();

        while (!cancellationToken.IsCancellationRequested)
        {
            var telemetry = new
            {
                temperature = 20 + random.NextDouble() * 10,
                humidity = 40 + random.NextDouble() * 20,
                timestamp = DateTime.UtcNow
            };

            var message = new Message(
                Encoding.UTF8.GetBytes(JsonSerializer.Serialize(telemetry)));

            if (telemetry.temperature > _config.TemperatureThreshold)
            {
                message.Properties.Add("alert", "high_temperature");
            }

            await _client.SendEventAsync(message);
            Console.WriteLine($"Sent: {JsonSerializer.Serialize(telemetry)}");

            await Task.Delay(
                TimeSpan.FromSeconds(_config.TelemetryInterval),
                cancellationToken);
        }
    }
}

public class DeviceConfiguration
{
    public int TelemetryInterval { get; set; } = 60;
    public double TemperatureThreshold { get; set; } = 25;
}
```

## Querying Device Twins

```sql
-- Find all devices in a specific building
SELECT * FROM devices
WHERE tags.location.building = 'Building-A'

-- Find devices with outdated firmware
SELECT deviceId, properties.reported.firmwareVersion
FROM devices
WHERE properties.desired.firmwareVersion != properties.reported.firmwareVersion

-- Find devices with high temperature alerts
SELECT deviceId, properties.reported.lastTemperature
FROM devices
WHERE properties.reported.lastTemperature > 30

-- Complex query with multiple conditions
SELECT deviceId, tags.location, properties.reported.connectivity
FROM devices
WHERE tags.deployment.environment = 'production'
  AND properties.reported.connectivity.signal > -60
  AND is_defined(properties.reported.lastTelemetry)
```

## Bulk Operations

```csharp
// Bulk update desired properties for multiple devices
public async Task BulkUpdateDesiredPropertiesAsync(
    string query, object desiredProperties)
{
    var exportJob = await _registryManager.CreateQuery(query);
    var deviceIds = new List<string>();

    while (exportJob.HasMoreResults)
    {
        var twins = await exportJob.GetNextAsTwinAsync();
        deviceIds.AddRange(twins.Select(t => t.DeviceId));
    }

    var jobs = deviceIds.Select(async deviceId =>
    {
        var twin = await _registryManager.GetTwinAsync(deviceId);
        var patch = new Twin();
        patch.Properties.Desired = new TwinCollection(
            JsonSerializer.Serialize(desiredProperties));
        await _registryManager.UpdateTwinAsync(deviceId, patch, twin.ETag);
    });

    await Task.WhenAll(jobs);
}

// Usage: Update all devices in Building-A
await service.BulkUpdateDesiredPropertiesAsync(
    "SELECT * FROM devices WHERE tags.location.building = 'Building-A'",
    new { firmwareVersion = "2.1.0" }
);
```

## Conclusion

Device twins are essential for managing IoT device state at scale:

- **Configuration Management**: Push config changes without device reconnection
- **Device Organization**: Use tags for logical grouping and queries
- **State Synchronization**: Track desired vs. reported state
- **Offline Capable**: Changes sync when device reconnects

Combined with IoT Hub's other features like direct methods and device-to-cloud messaging, device twins provide a complete device management solution.
