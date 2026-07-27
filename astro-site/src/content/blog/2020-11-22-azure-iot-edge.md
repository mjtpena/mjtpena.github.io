---
title: "Azure IoT Edge: Intelligence at the Edge"
author: Michael John Peña
draft: false
date: 2020-11-22
tags:
  - Azure
  - IoT
  - Edge Computing
  - AI
---

Streaming every sensor reading to the cloud sounds clean until you cost the bandwidth, or until the 4G link in the back of a truck drops for an hour. IoT Edge is Microsoft's answer to "do the work where the data lives." Containers running on the device—stream analytics, ML inference, even Functions—with the cloud for management and the long tail of telemetry. I tend to push aggregations and anomaly detection to the edge and let the cloud get the summaries.

## IoT Edge Architecture

```
┌──────────────────────────────────────────┐
│              Azure Cloud                  │
│  ┌─────────────┐  ┌─────────────────┐   │
│  │  IoT Hub    │  │ Container       │   │
│  │             │  │ Registry        │   │
│  └─────────────┘  └─────────────────┘   │
└──────────────────────────────────────────┘
              │
              ▼
┌──────────────────────────────────────────┐
│           IoT Edge Device                 │
│  ┌─────────────────────────────────────┐ │
│  │         IoT Edge Runtime            │ │
│  │  ┌─────────┐ ┌─────────┐ ┌───────┐ │ │
│  │  │ Module 1│ │ Module 2│ │Module3│ │ │
│  │  │ (ML)    │ │(Stream) │ │(Logic)│ │ │
│  │  └─────────┘ └─────────┘ └───────┘ │ │
│  └─────────────────────────────────────┘ │
│  ┌─────────────┐  ┌─────────────┐       │
│  │  edgeHub    │  │  edgeAgent  │       │
│  └─────────────┘  └─────────────┘       │
└──────────────────────────────────────────┘
```

## Deployment Manifest

```json
{
    "modulesContent": {
        "$edgeAgent": {
            "properties.desired": {
                "modules": {
                    "TempSensor": {
                        "type": "docker",
                        "settings": {
                            "image": "mcr.microsoft.com/azureiotedge-simulated-temperature-sensor:1.0"
                        },
                        "status": "running",
                        "restartPolicy": "always"
                    },
                    "FilterModule": {
                        "type": "docker",
                        "settings": {
                            "image": "myacr.azurecr.io/filter-module:1.0"
                        },
                        "env": {
                            "TEMP_THRESHOLD": { "value": "25" }
                        }
                    }
                }
            }
        },
        "$edgeHub": {
            "properties.desired": {
                "routes": {
                    "sensorToFilter": "FROM /messages/modules/TempSensor/* INTO BrokeredEndpoint(\"/modules/FilterModule/inputs/input1\")",
                    "filterToCloud": "FROM /messages/modules/FilterModule/* INTO $upstream"
                }
            }
        }
    }
}
```

## Custom Module (C#)

```csharp
public class Program
{
    static double temperatureThreshold = 25;

    static async Task Init()
    {
        var moduleClient = await ModuleClient.CreateFromEnvironmentAsync();
        await moduleClient.OpenAsync();

        // Set input message handler
        await moduleClient.SetInputMessageHandlerAsync("input1", FilterMessages, moduleClient);

        // Handle twin updates
        await moduleClient.SetDesiredPropertyUpdateCallbackAsync(OnDesiredPropertiesUpdate, null);
    }

    static async Task<MessageResponse> FilterMessages(Message message, object userContext)
    {
        var moduleClient = (ModuleClient)userContext;
        var messageBody = message.GetBytes();
        var data = JsonConvert.DeserializeObject<SensorData>(Encoding.UTF8.GetString(messageBody));

        if (data.Temperature > temperatureThreshold)
        {
            var alertMessage = new Message(messageBody);
            alertMessage.Properties.Add("alertType", "temperature");
            await moduleClient.SendEventAsync("output1", alertMessage);
        }

        return MessageResponse.Completed;
    }
}
```

## ML at the Edge

```json
{
    "MLModule": {
        "type": "docker",
        "settings": {
            "image": "myacr.azurecr.io/ml-module:1.0",
            "createOptions": {
                "HostConfig": {
                    "Binds": ["/var/lib/azurecv:/azurecv"]
                }
            }
        }
    }
}
```

```python
# Python module with ONNX model
import onnxruntime as rt

class MLModule:
    def __init__(self):
        self.session = rt.InferenceSession('/azurecv/model.onnx')

    def score(self, input_data):
        result = self.session.run(None, {'input': input_data})
        return result
```

## Stream Analytics at Edge

```sql
-- Edge SQL query
SELECT
    System.Timestamp() AS WindowEnd,
    AVG(temperature) AS AvgTemp,
    MAX(temperature) AS MaxTemp,
    COUNT(*) AS EventCount
INTO
    AlertOutput
FROM
    SensorInput TIMESTAMP BY timestamp
GROUP BY
    TumblingWindow(second, 30)
HAVING
    AVG(temperature) > 25
```

## Offline Capabilities

```json
{
    "$edgeHub": {
        "properties.desired": {
            "storeAndForwardConfiguration": {
                "timeToLiveSecs": 7200
            }
        }
    }
}
```

## CLI Operations

```bash
# Set deployment
az iot edge set-modules \
    --hub-name myiothub \
    --device-id myedgedevice \
    --content deployment.json

# Monitor messages
az iot hub monitor-events \
    --hub-name myiothub \
    --device-id myedgedevice
```

IoT Edge: cloud intelligence where it matters most.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
