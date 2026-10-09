---
title: Time Series Anomaly Detection with Azure Anomaly Detector
description: "Anomaly Detector is the Cognitive Service I pull out when someone asks \"can you tell us when something goes wrong?\" and the answer is \"I don't know exactly…"
author: Michael John Pena
draft: false
date: 2021-03-31
url: /blog/azure-anomaly-detector/
tags:
  - Azure
  - Anomaly Detection
  - Machine Learning
  - Time Series
  - Cognitive Services
---

Anomaly Detector is the Cognitive Service I pull out when someone asks "can you tell us when something goes wrong?" and the answer is "I don't know exactly what wrong looks like." That's the honest position for most operational metrics—you know CPU at 99% is bad, but what about API latency at 340ms when the baseline is 280ms and it's Monday morning? Anomaly Detector models the expected pattern (including seasonality, trend, and noise) and surfaces deviations that are statistically significant rather than just threshold crossings. The batch API processes historical data; the streaming API handles real-time detection. Embedding it in an Azure Function triggered by Event Hubs is the pattern I use most.

## Setting Up Anomaly Detector

```bash
# Create Anomaly Detector resource
az cognitiveservices account create \
    --name myanomalydetector \
    --resource-group myResourceGroup \
    --kind AnomalyDetector \
    --sku S0 \
    --location eastus
```

## Batch Detection

Analyze historical data to find anomalies in the entire series.

```python
from azure.ai.anomalydetector import AnomalyDetectorClient
from azure.ai.anomalydetector.models import DetectRequest, TimeGranularity
from azure.core.credentials import AzureKeyCredential
from datetime import datetime, timedelta
import pandas as pd

class AnomalyDetector:
    def __init__(self, endpoint, key):
        self.client = AnomalyDetectorClient(
            endpoint=endpoint,
            credential=AzureKeyCredential(key)
        )

    def detect_batch(self, time_series, granularity="hourly", sensitivity=95):
        """Detect anomalies in entire time series."""
        request = DetectRequest(
            series=time_series,
            granularity=TimeGranularity(granularity),
            sensitivity=sensitivity
        )

        response = self.client.detect_entire_series(request)

        results = {
            "period": response.period,
            "expected_values": response.expected_values,
            "upper_margins": response.upper_margins,
            "lower_margins": response.lower_margins,
            "is_anomaly": response.is_anomaly,
            "is_negative_anomaly": response.is_negative_anomaly,
            "is_positive_anomaly": response.is_positive_anomaly
        }

        # Find anomaly indices
        anomalies = []
        for i, is_anom in enumerate(response.is_anomaly):
            if is_anom:
                anomalies.append({
                    "index": i,
                    "timestamp": time_series[i].timestamp,
                    "value": time_series[i].value,
                    "expected": response.expected_values[i],
                    "upper_bound": response.expected_values[i] + response.upper_margins[i],
                    "lower_bound": response.expected_values[i] - response.lower_margins[i],
                    "is_positive": response.is_positive_anomaly[i]
                })

        results["anomalies"] = anomalies
        return results

    def detect_last_point(self, time_series, granularity="hourly", sensitivity=95):
        """Detect if the last point is an anomaly."""
        request = DetectRequest(
            series=time_series,
            granularity=TimeGranularity(granularity),
            sensitivity=sensitivity
        )

        response = self.client.detect_last_point(request)

        return {
            "is_anomaly": response.is_anomaly,
            "is_negative_anomaly": response.is_negative_anomaly,
            "is_positive_anomaly": response.is_positive_anomaly,
            "expected_value": response.expected_value,
            "upper_margin": response.upper_margin,
            "lower_margin": response.lower_margin,
            "period": response.period,
            "suggested_window": response.suggested_window
        }

    def detect_change_points(self, time_series, granularity="daily", threshold=0.5):
        """Detect change points in time series."""
        from azure.ai.anomalydetector.models import ChangePointDetectRequest

        request = ChangePointDetectRequest(
            series=time_series,
            granularity=TimeGranularity(granularity),
            threshold=threshold,
            stable_trend_window=5,
            period=0  # Auto-detect
        )

        response = self.client.detect_change_point(request)

        change_points = []
        for i, is_cp in enumerate(response.is_change_point):
            if is_cp:
                change_points.append({
                    "index": i,
                    "timestamp": time_series[i].timestamp,
                    "value": time_series[i].value,
                    "confidence": response.confidence_scores[i]
                })

        return {
            "period": response.period,
            "change_points": change_points
        }


# Prepare time series data
def prepare_time_series(df, timestamp_col, value_col):
    """Convert DataFrame to time series format."""
    from azure.ai.anomalydetector.models import TimeSeriesPoint

    return [
        TimeSeriesPoint(
            timestamp=row[timestamp_col],
            value=float(row[value_col])
        )
        for _, row in df.iterrows()
    ]


# Example usage
detector = AnomalyDetector(
    "https://your-resource.cognitiveservices.azure.com",
    "your-key"
)

# Load sample data
data = pd.DataFrame({
    "timestamp": pd.date_range("2021-03-01", periods=720, freq="H"),
    "value": [100 + 20 * (i % 24) / 24 + (5 if i % 168 < 48 else 0)
              for i in range(720)]  # Simulated with daily pattern
})

# Add some anomalies
data.loc[100, "value"] = 200  # Spike
data.loc[300, "value"] = 50   # Dip
data.loc[500:520, "value"] = data.loc[500:520, "value"] + 30  # Trend change

time_series = prepare_time_series(data, "timestamp", "value")

# Detect anomalies
results = detector.detect_batch(time_series, granularity="hourly")

print(f"Detected period: {results['period']} points")
print(f"Found {len(results['anomalies'])} anomalies:")
for anom in results["anomalies"]:
    direction = "spike" if anom["is_positive"] else "dip"
    print(f"  {anom['timestamp']}: {anom['value']:.2f} ({direction})")
    print(f"    Expected: {anom['expected']:.2f}, Bounds: [{anom['lower_bound']:.2f}, {anom['upper_bound']:.2f}]")
```

## Real-Time Streaming Detection

```python
class StreamingAnomalyDetector:
    def __init__(self, endpoint, key, window_size=24, granularity="hourly"):
        self.detector = AnomalyDetector(endpoint, key)
        self.window_size = window_size
        self.granularity = granularity
        self.buffer = []

    def process_point(self, timestamp, value):
        """Process a new data point in the stream."""
        from azure.ai.anomalydetector.models import TimeSeriesPoint

        point = TimeSeriesPoint(timestamp=timestamp, value=value)
        self.buffer.append(point)

        # Keep only window_size points
        if len(self.buffer) > self.window_size:
            self.buffer = self.buffer[-self.window_size:]

        # Need minimum points for detection
        if len(self.buffer) < 12:
            return {"status": "buffering", "points_needed": 12 - len(self.buffer)}

        # Detect anomaly for latest point
        result = self.detector.detect_last_point(
            self.buffer,
            granularity=self.granularity
        )

        return {
            "status": "analyzed",
            "timestamp": timestamp,
            "value": value,
            "is_anomaly": result["is_anomaly"],
            "expected": result["expected_value"],
            "upper_bound": result["expected_value"] + result["upper_margin"],
            "lower_bound": result["expected_value"] - result["lower_margin"]
        }


# Integration with Event Hub
from azure.eventhub import EventHubConsumerClient
import json

async def process_events(partition_context, events):
    """Process events from Event Hub."""
    detector = StreamingAnomalyDetector(
        "https://endpoint.cognitiveservices.azure.com",
        "key",
        window_size=48,
        granularity="hourly"
    )

    for event in events:
        data = json.loads(event.body_as_str())
        timestamp = datetime.fromisoformat(data["timestamp"])
        value = data["value"]

        result = detector.process_point(timestamp, value)

        if result["is_anomaly"]:
            # Send alert
            print(f"ANOMALY DETECTED at {timestamp}: {value}")
            await send_alert(result)

    await partition_context.update_checkpoint(events[-1])


# Start processing
consumer = EventHubConsumerClient.from_connection_string(
    conn_str="connection-string",
    consumer_group="$Default",
    eventhub_name="metrics"
)

with consumer:
    consumer.receive(on_event=process_events)
```

## Multivariate Anomaly Detection

Detect anomalies across multiple correlated metrics.

```python
from azure.ai.anomalydetector.models import (
    ModelInfo,
    DataSchema,
    AlignPolicy,
    FillNAMethod
)
import time

class MultivariateAnomalyDetector:
    def __init__(self, endpoint, key):
        self.client = AnomalyDetectorClient(
            endpoint=endpoint,
            credential=AzureKeyCredential(key)
        )

    def train_model(self, data_source, start_time, end_time, model_name="mv-model"):
        """Train a multivariate anomaly detection model."""
        model_info = ModelInfo(
            data_source=data_source,  # Blob storage URL with CSV files
            data_schema=DataSchema(inline_row=False),
            start_time=start_time,
            end_time=end_time,
            display_name=model_name,
            sliding_window=200,
            align_policy=AlignPolicy(
                align_mode="Outer",
                fill_na_method=FillNAMethod.LINEAR,
                padding_value=0
            )
        )

        # Start training
        response = self.client.train_multivariate_model(model_info)
        model_id = response.headers["Location"].split("/")[-1]

        # Wait for training
        while True:
            model_status = self.client.get_multivariate_model(model_id)

            if model_status.model_info.status == "READY":
                print(f"Model trained: {model_id}")
                return model_id
            elif model_status.model_info.status == "FAILED":
                raise Exception(f"Training failed: {model_status.model_info.errors}")

            print(f"Training status: {model_status.model_info.status}")
            time.sleep(30)

    def detect_multivariate(self, model_id, data_source, start_time, end_time):
        """Detect anomalies using trained multivariate model."""
        from azure.ai.anomalydetector.models import DetectionRequest

        detection_request = DetectionRequest(
            data_source=data_source,
            start_time=start_time,
            end_time=end_time,
            top_contributor_count=10
        )

        # Start detection
        response = self.client.detect_multivariate_batch_anomaly(
            model_id,
            detection_request
        )
        result_id = response.headers["Location"].split("/")[-1]

        # Wait for results
        while True:
            result = self.client.get_multivariate_batch_detection_result(result_id)

            if result.summary.status == "READY":
                return self._format_mv_results(result)
            elif result.summary.status == "FAILED":
                raise Exception(f"Detection failed: {result.summary.errors}")

            time.sleep(10)

    def detect_last_multivariate(self, model_id, variables):
        """Real-time detection for last point across multiple variables."""
        from azure.ai.anomalydetector.models import LastDetectionRequest, VariableValues

        variable_values = [
            VariableValues(
                variable=var["name"],
                timestamps=var["timestamps"],
                values=var["values"]
            )
            for var in variables
        ]

        request = LastDetectionRequest(
            variables=variable_values,
            top_contributor_count=10
        )

        result = self.client.detect_multivariate_last_anomaly(model_id, request)

        return {
            "is_anomaly": result.is_anomaly,
            "severity": result.severity,
            "interpretation": [
                {
                    "variable": interp.variable,
                    "contribution_score": interp.contribution_score,
                    "correlation_changes": interp.correlation_changes
                }
                for interp in result.interpretation
            ] if result.interpretation else []
        }

    def _format_mv_results(self, result):
        """Format multivariate detection results."""
        anomalies = []

        for r in result.results:
            if r.value.is_anomaly:
                anomalies.append({
                    "timestamp": r.timestamp,
                    "severity": r.value.severity,
                    "contributors": [
                        {
                            "variable": c.variable,
                            "contribution": c.contribution_score
                        }
                        for c in r.value.interpretation
                    ] if r.value.interpretation else []
                })

        return {
            "total_anomalies": len(anomalies),
            "anomalies": anomalies
        }


# Prepare multivariate data in blob storage
# Each variable should be in a separate CSV file:
# timestamp,value
# 2021-03-01T00:00:00Z,100
# ...

# Train model
mv_detector = MultivariateAnomalyDetector("endpoint", "key")

model_id = mv_detector.train_model(
    data_source="https://storage.blob.core.windows.net/data/training?sv=...",
    start_time=datetime(2021, 1, 1),
    end_time=datetime(2021, 2, 28),
    model_name="server-metrics"
)

# Detect anomalies
results = mv_detector.detect_multivariate(
    model_id,
    data_source="https://storage.blob.core.windows.net/data/inference?sv=...",
    start_time=datetime(2021, 3, 1),
    end_time=datetime(2021, 3, 31)
)

print(f"Found {results['total_anomalies']} multivariate anomalies")
for anom in results["anomalies"][:5]:
    print(f"\n{anom['timestamp']} (severity: {anom['severity']:.2f})")
    print("  Top contributors:")
    for c in anom["contributors"][:3]:
        print(f"    - {c['variable']}: {c['contribution']:.2%}")
```

## Visualization

```python
import matplotlib.pyplot as plt

def visualize_anomalies(data, results, title="Anomaly Detection Results"):
    """Visualize time series with detected anomalies."""
    fig, ax = plt.subplots(figsize=(15, 6))

    # Plot original data
    ax.plot(data["timestamp"], data["value"], "b-", label="Actual", alpha=0.7)

    # Plot expected values
    ax.plot(data["timestamp"], results["expected_values"],
            "g--", label="Expected", alpha=0.7)

    # Plot confidence bounds
    upper = [e + m for e, m in zip(results["expected_values"], results["upper_margins"])]
    lower = [e - m for e, m in zip(results["expected_values"], results["lower_margins"])]
    ax.fill_between(data["timestamp"], lower, upper,
                   alpha=0.2, color="green", label="Confidence Bounds")

    # Highlight anomalies
    anomaly_times = [a["timestamp"] for a in results["anomalies"]]
    anomaly_values = [a["value"] for a in results["anomalies"]]
    ax.scatter(anomaly_times, anomaly_values,
              c="red", s=100, zorder=5, label="Anomalies")

    ax.set_xlabel("Time")
    ax.set_ylabel("Value")
    ax.set_title(title)
    ax.legend()
    plt.xticks(rotation=45)
    plt.tight_layout()

    return fig


# Usage
fig = visualize_anomalies(data, results)
fig.savefig("anomaly_detection_results.png")
plt.show()
```

## Integration with Azure Monitor

```python
from azure.monitor.ingestion import LogsIngestionClient
from azure.identity import DefaultAzureCredential

def send_anomaly_alerts(anomalies, data_collection_endpoint, dcr_id, stream_name):
    """Send anomaly alerts to Azure Monitor."""
    credential = DefaultAzureCredential()
    client = LogsIngestionClient(endpoint=data_collection_endpoint, credential=credential)

    logs = [
        {
            "TimeGenerated": anom["timestamp"].isoformat(),
            "AnomalyValue": anom["value"],
            "ExpectedValue": anom["expected"],
            "Severity": "High" if abs(anom["value"] - anom["expected"]) > 50 else "Medium",
            "Direction": "Spike" if anom["is_positive"] else "Dip"
        }
        for anom in anomalies
    ]

    client.upload(rule_id=dcr_id, stream_name=stream_name, logs=logs)
```

## Conclusion

Azure Anomaly Detector provides powerful time series analysis:

- **Batch detection** for historical analysis
- **Real-time detection** for streaming scenarios
- **Change point detection** for trend shifts
- **Multivariate detection** for correlated metrics
- **Automatic seasonality** detection and handling

It's essential for monitoring systems, IoT analytics, and business metrics where detecting unusual patterns drives action.
