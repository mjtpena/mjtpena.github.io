---
title: "Building Real-Time Dashboards with Azure SignalR and React"
author: Michael John Peña
draft: false
date: 2025-12-22
tags:
  - SignalR
  - React
  - Real-Time
  - Azure
  - Dashboard

---

I wrote "Building Real-Time Dashboards with Azure SignalR and React" to share practical, production-minded guidance on this topic.

## Architecture

```
Data Sources -> Azure Functions -> SignalR Service -> React Dashboard
                                        |
                              Connection Management
                              (auto-scaling, reconnection)
```

## Backend: Azure Functions with SignalR

```csharp
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;

public class DashboardHub
{
    [Function("negotiate")]
    public static SignalRConnectionInfo Negotiate(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post")] HttpRequestData req,
        [SignalRConnectionInfoInput(HubName = "dashboard")] SignalRConnectionInfo connectionInfo)
    {
        return connectionInfo;
    }

    [Function("BroadcastMetrics")]
    [SignalROutput(HubName = "dashboard")]
    public static SignalRMessageAction BroadcastMetrics(
        [TimerTrigger("*/5 * * * * *")] TimerInfo timer,
        [CosmosDBInput("metrics", "current",
            Connection = "CosmosConnection",
            SqlQuery = "SELECT TOP 1 * FROM c ORDER BY c._ts DESC")]
        IEnumerable<MetricDocument> metrics)
    {
        var latestMetrics = metrics.FirstOrDefault();

        return new SignalRMessageAction("metricsUpdate")
        {
            Arguments = new object[] { latestMetrics }
        };
    }

    [Function("SendAlert")]
    [SignalROutput(HubName = "dashboard")]
    public static SignalRMessageAction SendAlert(
        [ServiceBusTrigger("alerts", Connection = "ServiceBusConnection")]
        AlertMessage alert)
    {
        return new SignalRMessageAction("alertReceived")
        {
            Arguments = new object[] { alert }
        };
    }
}
```

## React Dashboard Component

```tsx
import { useEffect, useState, useCallback } from 'react';
import * as signalR from '@microsoft/signalr';

interface Metrics {
  cpu: number;
  memory: number;
  requests: number;
  errors: number;
  timestamp: string;
}

interface Alert {
  id: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
}

export function Dashboard() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<string>('Disconnected');

  useEffect(() => {
    const connection = new signalR.HubConnectionBuilder()
      .withUrl('/api/negotiate')
      .withAutomaticReconnect({
        nextRetryDelayInMilliseconds: (retryContext) => {
          // Exponential backoff: 0, 2, 4, 8, 16... seconds
          return Math.min(1000 * Math.pow(2, retryContext.previousRetryCount), 30000);
        }
      })
      .configureLogging(signalR.LogLevel.Information)
      .build();

    connection.on('metricsUpdate', (data: Metrics) => {
      setMetrics(data);
    });

    connection.on('alertReceived', (alert: Alert) => {
      setAlerts(prev => [alert, ...prev].slice(0, 10));
    });

    connection.onreconnecting(() => setConnectionStatus('Reconnecting...'));
    connection.onreconnected(() => setConnectionStatus('Connected'));
    connection.onclose(() => setConnectionStatus('Disconnected'));

    connection.start()
      .then(() => setConnectionStatus('Connected'))
      .catch(err => console.error('Connection failed:', err));

    return () => { connection.stop(); };
  }, []);

  return (
    <div className="dashboard">
      <header>
        <h1>System Dashboard</h1>
        <span className={`status ${connectionStatus.toLowerCase()}`}>
          {connectionStatus}
        </span>
      </header>

      <div className="metrics-grid">
        <MetricCard title="CPU" value={metrics?.cpu ?? 0} unit="%" />
        <MetricCard title="Memory" value={metrics?.memory ?? 0} unit="%" />
        <MetricCard title="Requests/min" value={metrics?.requests ?? 0} />
        <MetricCard title="Errors" value={metrics?.errors ?? 0} />
      </div>

      <AlertList alerts={alerts} />
    </div>
  );
}

function MetricCard({ title, value, unit = '' }: { title: string; value: number; unit?: string }) {
  return (
    <div className="metric-card">
      <h3>{title}</h3>
      <span className="value">{value.toFixed(1)}{unit}</span>
    </div>
  );
}
```

## Scaling Considerations

Azure SignalR Service handles connection management automatically:
- Free tier: 20 concurrent connections
- Standard tier: 1,000+ connections per unit
- Auto-scale based on connection count

```bash
# Create SignalR Service
az signalr create \
  --name mydashboard-signalr \
  --resource-group myRG \
  --sku Standard_S1 \
  --unit-count 1 \
  --service-mode Serverless
```

Real-time dashboards are now straightforward with Azure SignalR. The serverless model means you only pay for messages, making it cost-effective for most scenarios.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
