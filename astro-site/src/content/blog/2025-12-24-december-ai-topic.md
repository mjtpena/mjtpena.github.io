---
title: "Christmas Eve Automation: Building a Holiday Light Controller with Azure IoT"
author: Michael John Peña
draft: false
date: 2025-12-24
tags:
  - IoT
  - Azure
  - Home-Automation
  - Raspberry-Pi
  - Holiday

---

I wrote "Christmas Eve Automation: Building a Holiday Light Controller with Azure IoT" to share practical, production-minded guidance on this topic.

## Project Overview

We'll build a system that:
- Controls holiday lights via Azure IoT Hub
- Responds to voice commands through a simple API
- Runs pre-programmed light shows
- Monitors power consumption

## Hardware Requirements

- Raspberry Pi 4 (or Zero 2 W)
- Relay module (4-channel)
- Smart power monitoring plug (optional)
- Holiday lights (LED recommended for safety)

## Azure IoT Hub Setup

```bash
# Create IoT Hub
az iot hub create \
  --name holiday-lights-hub \
  --resource-group holiday-rg \
  --sku S1

# Register device
az iot hub device-identity create \
  --hub-name holiday-lights-hub \
  --device-id raspberry-pi-lights
```

## Raspberry Pi Code

```python
import asyncio
import json
from azure.iot.device.aio import IoTHubDeviceClient
from azure.iot.device import MethodResponse
import RPi.GPIO as GPIO

# GPIO setup for relay control
RELAY_PINS = {
    "tree": 17,
    "window": 27,
    "outdoor": 22,
    "star": 23
}

GPIO.setmode(GPIO.BCM)
for pin in RELAY_PINS.values():
    GPIO.setup(pin, GPIO.OUT)
    GPIO.output(pin, GPIO.LOW)

class HolidayLightController:
    def __init__(self, connection_string: str):
        self.client = IoTHubDeviceClient.create_from_connection_string(connection_string)
        self.light_states = {name: False for name in RELAY_PINS}

    async def connect(self):
        await self.client.connect()
        self.client.on_method_request_received = self.handle_method
        print("Connected to Azure IoT Hub")

    async def handle_method(self, method_request):
        """Handle direct method calls from IoT Hub."""
        response_payload = {"result": "success"}
        status = 200

        if method_request.name == "setLight":
            light_name = method_request.payload.get("light")
            state = method_request.payload.get("state")

            if light_name in RELAY_PINS:
                self.set_light(light_name, state)
                response_payload["message"] = f"{light_name} set to {state}"
            else:
                status = 400
                response_payload = {"error": f"Unknown light: {light_name}"}

        elif method_request.name == "runShow":
            show_name = method_request.payload.get("show", "twinkle")
            asyncio.create_task(self.run_light_show(show_name))
            response_payload["message"] = f"Started {show_name} show"

        elif method_request.name == "allOff":
            self.all_lights_off()
            response_payload["message"] = "All lights off"

        response = MethodResponse.create_from_method_request(
            method_request, status, response_payload
        )
        await self.client.send_method_response(response)

    def set_light(self, name: str, state: bool):
        pin = RELAY_PINS[name]
        GPIO.output(pin, GPIO.HIGH if state else GPIO.LOW)
        self.light_states[name] = state

    def all_lights_off(self):
        for name in RELAY_PINS:
            self.set_light(name, False)

    async def run_light_show(self, show_name: str):
        """Run pre-programmed light shows."""
        if show_name == "twinkle":
            for _ in range(20):
                for name in RELAY_PINS:
                    self.set_light(name, True)
                    await asyncio.sleep(0.2)
                    self.set_light(name, False)

        elif show_name == "wave":
            for _ in range(10):
                for name in RELAY_PINS:
                    self.set_light(name, True)
                    await asyncio.sleep(0.5)
                for name in reversed(list(RELAY_PINS.keys())):
                    self.set_light(name, False)
                    await asyncio.sleep(0.5)

async def main():
    controller = HolidayLightController(
        "HostName=holiday-lights-hub.azure-devices.net;DeviceId=..."
    )
    await controller.connect()

    # Keep running
    while True:
        await asyncio.sleep(1)

asyncio.run(main())
```

## Controlling via Azure Function API

```csharp
[Function("ControlLights")]
public async Task<IActionResult> ControlLights(
    [HttpTrigger(AuthorizationLevel.Function, "post")] HttpRequest req)
{
    var command = await req.ReadFromJsonAsync<LightCommand>();

    var serviceClient = ServiceClient.CreateFromConnectionString(_connectionString);

    var method = new CloudToDeviceMethod(command.Action);
    method.SetPayloadJson(JsonSerializer.Serialize(command.Parameters));

    var response = await serviceClient.InvokeDeviceMethodAsync(
        "raspberry-pi-lights", method);

    return new OkObjectResult(response.GetPayloadAsJson());
}
```

A fun project that combines cloud, IoT, and holiday spirit. Merry Christmas Eve!\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
