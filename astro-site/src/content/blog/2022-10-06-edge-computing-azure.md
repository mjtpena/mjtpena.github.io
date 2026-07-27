---
title: "Edge Computing with Azure"
author: "Michael John Peña"
draft: false
date: 2022-10-06
tags: ["Azure", "Edge Computing", "IoT", "AI"]

---

I wrote "Edge Computing with Azure" to share practical, production-minded guidance on this topic.

## Azure IoT Edge

### Setting Up IoT Edge

```bash
# Install IoT Edge runtime on Linux device
curl https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor > microsoft.gpg
sudo mv microsoft.gpg /etc/apt/trusted.gpg.d/microsoft.gpg

sudo apt-get update
sudo apt-get install aziot-edge

# Configure with connection string
sudo iotedge config mp --connection-string "your-connection-string"
sudo iotedge config apply

# Verify installation
sudo iotedge check
sudo iotedge list
```

### Custom IoT Edge Module

```csharp
// Custom IoT Edge module in C#
using Microsoft.Azure.Devices.Client;
using Microsoft.Azure.Devices.Client.Transport.Mqtt;

public class EdgeModule
{
    private static ModuleClient _moduleClient;
    private static int _messageCount = 0;

    public static async Task Main(string[] args)
    {
        var mqttSetting = new MqttTransportSettings(TransportType.Mqtt_Tcp_Only);
        var settings = new ITransportSettings[] { mqttSetting };

        _moduleClient = await ModuleClient.CreateFromEnvironmentAsync(settings);
        await _moduleClient.OpenAsync();

        // Register message handler
        await _moduleClient.SetInputMessageHandlerAsync(
            "sensorInput",
            ProcessSensorMessage,
            _moduleClient);

        // Register direct method handler
        await _moduleClient.SetMethodHandlerAsync(
            "GetStatus",
            HandleGetStatus,
            null);

        // Register twin update handler
        await _moduleClient.SetDesiredPropertyUpdateCallbackAsync(
            OnDesiredPropertyChanged,
            null);

        Console.WriteLine("IoT Edge module started");
        await Task.Delay(Timeout.Infinite);
    }

    private static async Task<MessageResponse> ProcessSensorMessage(
        Message message,
        object userContext)
    {
        var messageBytes = message.GetBytes();
        var messageString = Encoding.UTF8.GetString(messageBytes);

        Console.WriteLine($"Received message: {messageString}");

        // Process the sensor data
        var sensorData = JsonConvert.DeserializeObject<SensorData>(messageString);

        // Apply edge analytics
        var processedData = ProcessSensorData(sensorData);

        // Forward to next module or cloud
        if (processedData.IsAnomaly)
        {
            var alertMessage = new Message(
                Encoding.UTF8.GetBytes(JsonConvert.SerializeObject(processedData)));

            await _moduleClient.SendEventAsync("alertOutput", alertMessage);
        }

        _messageCount++;
        return MessageResponse.Completed;
    }

    private static ProcessedData ProcessSensorData(SensorData data)
    {
        // Edge analytics logic
        var isAnomaly = data.Temperature > 100 || data.Pressure > 500;

        return new ProcessedData
        {
            DeviceId = data.DeviceId,
            Temperature = data.Temperature,
            Pressure = data.Pressure,
            IsAnomaly = isAnomaly,
            ProcessedAt = DateTime.UtcNow
        };
    }

    private static Task<MethodResponse> HandleGetStatus(
        MethodRequest request,
        object userContext)
    {
        var status = new
        {
            MessageCount = _messageCount,
            Status = "Running",
            Timestamp = DateTime.UtcNow
        };

        var json = JsonConvert.SerializeObject(status);
        return Task.FromResult(new MethodResponse(
            Encoding.UTF8.GetBytes(json), 200));
    }

    private static async Task OnDesiredPropertyChanged(
        TwinCollection desiredProperties,
        object userContext)
    {
        Console.WriteLine($"Desired properties changed: {desiredProperties.ToJson()}");

        // Update module configuration
        var reportedProperties = new TwinCollection
        {
            ["lastConfigUpdate"] = DateTime.UtcNow
        };

        await _moduleClient.UpdateReportedPropertiesAsync(reportedProperties);
    }
}

public class SensorData
{
    public string DeviceId { get; set; }
    public double Temperature { get; set; }
    public double Pressure { get; set; }
    public DateTime Timestamp { get; set; }
}
```

### Deployment Manifest

```json
{
    "modulesContent": {
        "$edgeAgent": {
            "properties.desired": {
                "schemaVersion": "1.1",
                "runtime": {
                    "type": "docker",
                    "settings": {
                        "minDockerVersion": "v1.25",
                        "loggingOptions": ""
                    }
                },
                "systemModules": {
                    "edgeAgent": {
                        "type": "docker",
                        "settings": {
                            "image": "mcr.microsoft.com/azureiotedge-agent:1.4"
                        }
                    },
                    "edgeHub": {
                        "type": "docker",
                        "status": "running",
                        "restartPolicy": "always",
                        "settings": {
                            "image": "mcr.microsoft.com/azureiotedge-hub:1.4"
                        }
                    }
                },
                "modules": {
                    "SensorProcessor": {
                        "version": "1.0",
                        "type": "docker",
                        "status": "running",
                        "restartPolicy": "always",
                        "settings": {
                            "image": "myregistry.azurecr.io/sensor-processor:1.0",
                            "createOptions": {
                                "HostConfig": {
                                    "Binds": ["/data:/app/data"]
                                }
                            }
                        }
                    },
                    "AIProcessor": {
                        "version": "1.0",
                        "type": "docker",
                        "status": "running",
                        "restartPolicy": "always",
                        "settings": {
                            "image": "myregistry.azurecr.io/ai-processor:1.0"
                        },
                        "env": {
                            "MODEL_PATH": {
                                "value": "/app/models/anomaly-detection.onnx"
                            }
                        }
                    }
                }
            }
        },
        "$edgeHub": {
            "properties.desired": {
                "schemaVersion": "1.1",
                "routes": {
                    "sensorToProcessor": "FROM /messages/modules/SimulatedSensor/outputs/* INTO BrokeredEndpoint(\"/modules/SensorProcessor/inputs/sensorInput\")",
                    "processorToAI": "FROM /messages/modules/SensorProcessor/outputs/alertOutput INTO BrokeredEndpoint(\"/modules/AIProcessor/inputs/input\")",
                    "aiToCloud": "FROM /messages/modules/AIProcessor/outputs/* INTO $upstream"
                },
                "storeAndForwardConfiguration": {
                    "timeToLiveSecs": 7200
                }
            }
        }
    }
}
```

### Edge AI with ONNX

```python
# Edge AI inference module
import onnxruntime as ort
import numpy as np
from azure.iot.device import IoTHubModuleClient
import json

class EdgeAIProcessor:
    def __init__(self):
        self.model = ort.InferenceSession("/app/models/anomaly-detection.onnx")
        self.client = IoTHubModuleClient.create_from_edge_environment()

    def process_message(self, message):
        data = json.loads(message.data)

        # Prepare input
        input_array = np.array([[
            data['temperature'],
            data['pressure'],
            data['humidity']
        ]], dtype=np.float32)

        # Run inference
        input_name = self.model.get_inputs()[0].name
        output_name = self.model.get_outputs()[0].name
        result = self.model.run([output_name], {input_name: input_array})

        # Process result
        anomaly_score = result[0][0][0]
        is_anomaly = anomaly_score > 0.8

        return {
            'device_id': data['device_id'],
            'anomaly_score': float(anomaly_score),
            'is_anomaly': is_anomaly,
            'timestamp': data['timestamp']
        }

    async def run(self):
        async def message_handler(message):
            result = self.process_message(message)

            if result['is_anomaly']:
                await self.client.send_message_to_output(
                    json.dumps(result),
                    "anomalyOutput"
                )

        self.client.on_message_received = message_handler
        await self.client.connect()

        while True:
            await asyncio.sleep(1)

if __name__ == "__main__":
    processor = EdgeAIProcessor()
    asyncio.run(processor.run())
```

## Edge Computing Patterns

1. **Data filtering** - Process and filter data at edge
2. **Local analytics** - Run ML models locally
3. **Store and forward** - Handle intermittent connectivity
4. **Real-time response** - Low-latency decision making
5. **Privacy preservation** - Keep sensitive data local

Edge computing with Azure provides the foundation for intelligent, responsive, and resilient IoT solutions.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
