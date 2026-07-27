---
title: "Device Twin Patterns for IoT Applications"
author: "Michael John Peña"
draft: false
date: 2022-07-29
tags: ["Azure", "IoT Hub", "Device Twins", "IoT", "Patterns"]

---

I wrote "Device Twin Patterns for IoT Applications" to share practical, production-minded guidance on this topic.

## Understanding Device Twin Structure

```json
{
  "deviceId": "device001",
  "etag": "AAAAAAAAAAE=",
  "version": 4,
  "tags": {
    "location": {
      "building": "building-1",
      "floor": "floor-2",
      "room": "room-201"
    },
    "deviceType": "temperature-sensor",
    "owner": "facilities"
  },
  "properties": {
    "desired": {
      "telemetryInterval": 60,
      "temperatureThreshold": {
        "min": 18,
        "max": 28
      },
      "$metadata": {},
      "$version": 3
    },
    "reported": {
      "telemetryInterval": 60,
      "firmwareVersion": "1.2.3",
      "status": "online",
      "lastReading": {
        "temperature": 22.5,
        "timestamp": "2022-07-29T10:30:00Z"
      },
      "$metadata": {},
      "$version": 5
    }
  }
}
```

## Pattern 1: Configuration Management

```python
from azure.iot.hub import IoTHubRegistryManager

class DeviceConfigManager:
    def __init__(self, connection_string):
        self.registry = IoTHubRegistryManager.from_connection_string(connection_string)

    def set_device_config(self, device_id, config):
        """Update desired properties for device configuration"""
        twin = self.registry.get_twin(device_id)

        # Merge new config with existing desired properties
        twin.properties.desired.update(config)

        # Update twin with optimistic concurrency
        updated_twin = self.registry.update_twin(device_id, twin, twin.etag)
        return updated_twin

    def set_fleet_config(self, query, config):
        """Update configuration for multiple devices"""
        devices = self._query_devices(query)

        results = []
        for device in devices:
            try:
                result = self.set_device_config(device['deviceId'], config)
                results.append({'deviceId': device['deviceId'], 'status': 'success'})
            except Exception as e:
                results.append({'deviceId': device['deviceId'], 'status': 'failed', 'error': str(e)})

        return results

# Usage
config_manager = DeviceConfigManager(CONNECTION_STRING)

# Update single device
config_manager.set_device_config('device001', {
    'telemetryInterval': 30,
    'alertsEnabled': True
})

# Update all sensors in building 1
config_manager.set_fleet_config(
    "SELECT deviceId FROM devices WHERE tags.location.building = 'building-1'",
    {'telemetryInterval': 15}
)
```

## Pattern 2: Device-Side Configuration Handling

```python
from azure.iot.device.aio import IoTHubDeviceClient
import asyncio
import json

class ConfigurableDevice:
    def __init__(self, connection_string):
        self.client = IoTHubDeviceClient.create_from_connection_string(connection_string)
        self.config = {}

    async def start(self):
        """Start the device and handle configuration"""
        await self.client.connect()

        # Set up handlers
        self.client.on_twin_desired_properties_patch_received = self._handle_config_update

        # Get initial configuration
        twin = await self.client.get_twin()
        await self._apply_config(twin['desired'])

    async def _handle_config_update(self, patch):
        """Handle configuration updates from IoT Hub"""
        print(f"Received config update: {json.dumps(patch, indent=2)}")
        await self._apply_config(patch)

    async def _apply_config(self, desired):
        """Apply configuration and report status"""
        # Store new config values
        for key, value in desired.items():
            if not key.startswith('$'):  # Skip metadata
                self.config[key] = value
                print(f"Applied config: {key} = {value}")

        # Report successful application
        reported = {
            key: value for key, value in desired.items()
            if not key.startswith('$')
        }
        reported['configAppliedAt'] = datetime.utcnow().isoformat()
        reported['configVersion'] = desired.get('$version')

        await self.client.patch_twin_reported_properties(reported)

    async def run(self):
        """Main device loop"""
        await self.start()

        while True:
            # Use current config for telemetry interval
            interval = self.config.get('telemetryInterval', 60)
            await self._send_telemetry()
            await asyncio.sleep(interval)
```

## Pattern 3: State Machine with Device Twin

```python
class DeviceStateMachine:
    STATES = ['idle', 'running', 'paused', 'error', 'maintenance']

    def __init__(self, device_client):
        self.client = device_client
        self.state = 'idle'

    async def transition_to(self, new_state, reason=None):
        """Transition to a new state and report"""
        if new_state not in self.STATES:
            raise ValueError(f"Invalid state: {new_state}")

        old_state = self.state
        self.state = new_state

        # Report state change
        reported = {
            'state': new_state,
            'previousState': old_state,
            'stateChangedAt': datetime.utcnow().isoformat(),
            'stateChangeReason': reason
        }

        await self.client.patch_twin_reported_properties(reported)
        print(f"State transition: {old_state} -> {new_state}")

    async def handle_desired_state(self, patch):
        """Handle desired state from cloud"""
        desired_state = patch.get('desiredState')

        if desired_state and desired_state != self.state:
            if self._can_transition(desired_state):
                await self.transition_to(desired_state, 'cloud_requested')
            else:
                # Report that transition is not possible
                await self.client.patch_twin_reported_properties({
                    'stateTransitionError': f"Cannot transition from {self.state} to {desired_state}"
                })

    def _can_transition(self, target_state):
        """Check if transition is valid"""
        valid_transitions = {
            'idle': ['running', 'maintenance'],
            'running': ['paused', 'idle', 'error'],
            'paused': ['running', 'idle'],
            'error': ['idle', 'maintenance'],
            'maintenance': ['idle']
        }
        return target_state in valid_transitions.get(self.state, [])
```

## Pattern 4: Tagging and Organization

```python
class DeviceOrganization:
    def __init__(self, registry):
        self.registry = registry

    def tag_device(self, device_id, tags):
        """Add or update tags on a device"""
        twin = self.registry.get_twin(device_id)

        # Merge tags
        if twin.tags is None:
            twin.tags = {}

        self._deep_merge(twin.tags, tags)

        return self.registry.update_twin(device_id, twin, twin.etag)

    def _deep_merge(self, base, updates):
        """Deep merge dictionaries"""
        for key, value in updates.items():
            if key in base and isinstance(base[key], dict) and isinstance(value, dict):
                self._deep_merge(base[key], value)
            else:
                base[key] = value

    def organize_by_location(self, device_id, building, floor, room):
        """Organize device by physical location"""
        return self.tag_device(device_id, {
            'location': {
                'building': building,
                'floor': floor,
                'room': room
            }
        })

    def assign_owner(self, device_id, owner, department):
        """Assign device ownership"""
        return self.tag_device(device_id, {
            'ownership': {
                'owner': owner,
                'department': department,
                'assignedAt': datetime.utcnow().isoformat()
            }
        })

    def find_by_tags(self, tag_query):
        """Find devices by tag query"""
        query = f"SELECT * FROM devices WHERE {tag_query}"
        return self.registry.query_iot_hub(QuerySpecification(query=query))

# Usage
org = DeviceOrganization(registry)
org.organize_by_location('device001', 'building-1', 'floor-2', 'room-201')
org.assign_owner('device001', 'john.doe@company.com', 'facilities')
```

## Pattern 5: Version Tracking and Rollback

```python
class ConfigVersionManager:
    def __init__(self, registry):
        self.registry = registry

    async def apply_config_with_version(self, device_id, config, version):
        """Apply config with version tracking"""
        twin = self.registry.get_twin(device_id)

        # Add version metadata
        config['$configVersion'] = version
        config['$configAppliedAt'] = datetime.utcnow().isoformat()

        twin.properties.desired.update(config)
        return self.registry.update_twin(device_id, twin, twin.etag)

    def check_config_status(self, device_id):
        """Check if device has applied latest config"""
        twin = self.registry.get_twin(device_id)

        desired_version = twin.properties.desired.get('$configVersion')
        reported_version = twin.properties.reported.get('configVersion')

        return {
            'deviceId': device_id,
            'desiredVersion': desired_version,
            'appliedVersion': reported_version,
            'inSync': desired_version == reported_version
        }
```

Device twins provide the foundation for managing device state, configuration, and organization in IoT solutions.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
