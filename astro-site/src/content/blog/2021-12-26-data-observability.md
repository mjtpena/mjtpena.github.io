---
title: "Data Observability: Monitoring Your Data Pipelines"
description: "Data observability is the capability that answers \"is my data healthy right now?\" the same way application observability answers \"is my application healthy…"
author: Michael John Pena
draft: false
date: 2021-12-26
tags:
  - Data Observability
  - Data Engineering
  - Monitoring
  - Data Quality
  - DataOps
---

Data observability is the capability that answers "is my data healthy right now?" the same way application observability answers "is my application healthy right now?"—through metrics, logs, and alerting that surface anomalies before consumers discover them through wrong numbers in dashboards. The five pillars of data observability (per Monte Carlo's framework, which popularised the term): freshness (is data arriving on schedule?), distribution (are values within expected ranges and following expected statistical distributions?), volume (is the expected amount of data present?), schema (has the structure of the data changed?), and lineage (which upstream sources and downstream consumers are affected by a data issue?). Azure Purview's lineage tracking addresses the lineage pillar; custom Azure Monitor metrics and Great Expectations address freshness, distribution, and volume. The commercial data observability platforms (Monte Carlo, Acceldata, Metaplane) provide these capabilities integrated with common data stack tools.

## The Five Pillars of Data Observability

1. **Freshness**: Is data up to date?
2. **Volume**: Is the expected amount of data present?
3. **Schema**: Has the schema changed unexpectedly?
4. **Distribution**: Are data values within expected ranges?
5. **Lineage**: Where did this data come from?

## Implementing Data Observability

```python
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Dict, List, Optional
import pandas as pd
import numpy as np
from scipy import stats

@dataclass
class DatasetMetrics:
    """Metrics for a monitored dataset"""
    dataset_name: str
    timestamp: datetime
    row_count: int
    column_count: int
    freshness_seconds: float
    schema_hash: str
    column_stats: Dict[str, dict]
    anomalies: List[dict] = field(default_factory=list)

class DataObserver:
    """Monitor data for anomalies and issues"""

    def __init__(self, baseline_days: int = 30):
        self.baseline_days = baseline_days
        self.historical_metrics: Dict[str, List[DatasetMetrics]] = {}

    def observe(self, df: pd.DataFrame, dataset_name: str) -> DatasetMetrics:
        """Collect metrics for a dataset"""
        now = datetime.utcnow()

        # Calculate column statistics
        column_stats = {}
        for col in df.columns:
            column_stats[col] = self._calculate_column_stats(df[col])

        # Calculate schema hash
        schema_hash = self._hash_schema(df)

        # Determine freshness (assuming a timestamp column exists)
        freshness = self._calculate_freshness(df)

        metrics = DatasetMetrics(
            dataset_name=dataset_name,
            timestamp=now,
            row_count=len(df),
            column_count=len(df.columns),
            freshness_seconds=freshness,
            schema_hash=schema_hash,
            column_stats=column_stats
        )

        # Detect anomalies
        metrics.anomalies = self._detect_anomalies(metrics, dataset_name)

        # Store for historical comparison
        if dataset_name not in self.historical_metrics:
            self.historical_metrics[dataset_name] = []
        self.historical_metrics[dataset_name].append(metrics)

        return metrics

    def _calculate_column_stats(self, series: pd.Series) -> dict:
        """Calculate statistics for a column"""
        stats_dict = {
            'dtype': str(series.dtype),
            'null_count': series.isnull().sum(),
            'null_pct': series.isnull().mean(),
            'unique_count': series.nunique()
        }

        if series.dtype in ['int64', 'float64']:
            stats_dict.update({
                'mean': series.mean(),
                'std': series.std(),
                'min': series.min(),
                'max': series.max(),
                'median': series.median(),
                'p5': series.quantile(0.05),
                'p95': series.quantile(0.95)
            })
        elif series.dtype == 'object':
            value_counts = series.value_counts()
            stats_dict.update({
                'top_values': value_counts.head(5).to_dict(),
                'avg_length': series.str.len().mean() if series.str.len().notna().any() else None
            })

        return stats_dict

    def _hash_schema(self, df: pd.DataFrame) -> str:
        """Create hash of schema for change detection"""
        import hashlib
        schema_str = str([(col, str(dtype)) for col, dtype in df.dtypes.items()])
        return hashlib.md5(schema_str.encode()).hexdigest()

    def _calculate_freshness(self, df: pd.DataFrame) -> float:
        """Calculate data freshness in seconds"""
        timestamp_cols = df.select_dtypes(include=['datetime64']).columns

        if len(timestamp_cols) > 0:
            # Use the most recent timestamp
            max_timestamp = df[timestamp_cols].max().max()
            if pd.notna(max_timestamp):
                return (datetime.utcnow() - max_timestamp.to_pydatetime().replace(tzinfo=None)).total_seconds()

        return -1  # Unknown freshness

    def _detect_anomalies(
        self,
        current: DatasetMetrics,
        dataset_name: str
    ) -> List[dict]:
        """Detect anomalies compared to historical baseline"""
        anomalies = []
        history = self.historical_metrics.get(dataset_name, [])

        if len(history) < 7:  # Need minimum history
            return anomalies

        # Volume anomaly
        historical_counts = [m.row_count for m in history[-self.baseline_days:]]
        if historical_counts:
            mean_count = np.mean(historical_counts)
            std_count = np.std(historical_counts)

            if std_count > 0:
                z_score = (current.row_count - mean_count) / std_count
                if abs(z_score) > 3:
                    anomalies.append({
                        'type': 'volume',
                        'severity': 'high' if abs(z_score) > 5 else 'medium',
                        'message': f'Row count {current.row_count} is {z_score:.1f} std devs from mean {mean_count:.0f}',
                        'z_score': z_score
                    })

        # Freshness anomaly
        historical_freshness = [m.freshness_seconds for m in history[-self.baseline_days:] if m.freshness_seconds > 0]
        if historical_freshness and current.freshness_seconds > 0:
            max_freshness = max(historical_freshness) * 2  # 2x historical max
            if current.freshness_seconds > max_freshness:
                anomalies.append({
                    'type': 'freshness',
                    'severity': 'high',
                    'message': f'Data is {current.freshness_seconds/3600:.1f} hours old, exceeds threshold of {max_freshness/3600:.1f} hours'
                })

        # Schema change
        if history:
            if current.schema_hash != history[-1].schema_hash:
                anomalies.append({
                    'type': 'schema',
                    'severity': 'medium',
                    'message': 'Schema has changed since last observation'
                })

        # Distribution anomalies
        for col, stats in current.column_stats.items():
            if 'mean' in stats:
                anomalies.extend(
                    self._detect_distribution_anomaly(col, stats, history)
                )

        return anomalies

    def _detect_distribution_anomaly(
        self,
        column: str,
        current_stats: dict,
        history: List[DatasetMetrics]
    ) -> List[dict]:
        """Detect distribution anomalies for a column"""
        anomalies = []

        historical_means = [
            m.column_stats.get(column, {}).get('mean')
            for m in history[-self.baseline_days:]
            if m.column_stats.get(column, {}).get('mean') is not None
        ]

        if len(historical_means) >= 7:
            mean_of_means = np.mean(historical_means)
            std_of_means = np.std(historical_means)

            if std_of_means > 0:
                z_score = (current_stats['mean'] - mean_of_means) / std_of_means
                if abs(z_score) > 3:
                    anomalies.append({
                        'type': 'distribution',
                        'severity': 'medium',
                        'column': column,
                        'message': f'Column {column} mean {current_stats["mean"]:.2f} deviates from historical mean {mean_of_means:.2f}',
                        'z_score': z_score
                    })

        # Null rate anomaly
        historical_nulls = [
            m.column_stats.get(column, {}).get('null_pct', 0)
            for m in history[-self.baseline_days:]
        ]

        if historical_nulls:
            max_historical_null = max(historical_nulls)
            if current_stats['null_pct'] > max_historical_null * 2 and current_stats['null_pct'] > 0.05:
                anomalies.append({
                    'type': 'null_rate',
                    'severity': 'medium',
                    'column': column,
                    'message': f'Column {column} null rate {current_stats["null_pct"]*100:.1f}% exceeds historical max {max_historical_null*100:.1f}%'
                })

        return anomalies
```

## Alerting on Data Issues

```python
from enum import Enum
from typing import Callable
import json

class AlertSeverity(Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"

class DataObservabilityAlerts:
    """Alert management for data observability"""

    def __init__(self):
        self.alert_handlers: Dict[AlertSeverity, List[Callable]] = {
            AlertSeverity.LOW: [],
            AlertSeverity.MEDIUM: [],
            AlertSeverity.HIGH: [],
            AlertSeverity.CRITICAL: []
        }

    def register_handler(
        self,
        severity: AlertSeverity,
        handler: Callable[[dict], None]
    ):
        """Register alert handler for severity level"""
        self.alert_handlers[severity].append(handler)

    def process_anomalies(
        self,
        metrics: DatasetMetrics
    ):
        """Process anomalies and send alerts"""
        for anomaly in metrics.anomalies:
            severity = AlertSeverity(anomaly.get('severity', 'medium'))

            alert = {
                'dataset': metrics.dataset_name,
                'timestamp': metrics.timestamp.isoformat(),
                'anomaly_type': anomaly['type'],
                'severity': severity.value,
                'message': anomaly['message'],
                'details': anomaly
            }

            # Call all handlers for this severity and above
            for sev in AlertSeverity:
                if sev.value >= severity.value:
                    for handler in self.alert_handlers[sev]:
                        handler(alert)


# Alert handlers
def slack_alert_handler(alert: dict):
    """Send alert to Slack"""
    import requests

    webhook_url = os.environ.get('SLACK_WEBHOOK_URL')
    if not webhook_url:
        return

    color = {
        'low': '#36a64f',
        'medium': '#ffcc00',
        'high': '#ff6600',
        'critical': '#ff0000'
    }.get(alert['severity'], '#808080')

    payload = {
        'attachments': [{
            'color': color,
            'title': f"Data Alert: {alert['dataset']}",
            'text': alert['message'],
            'fields': [
                {'title': 'Type', 'value': alert['anomaly_type'], 'short': True},
                {'title': 'Severity', 'value': alert['severity'], 'short': True}
            ],
            'ts': datetime.utcnow().timestamp()
        }]
    }

    requests.post(webhook_url, json=payload)


def pagerduty_alert_handler(alert: dict):
    """Send critical alerts to PagerDuty"""
    if alert['severity'] not in ['high', 'critical']:
        return

    import requests

    payload = {
        'routing_key': os.environ.get('PAGERDUTY_ROUTING_KEY'),
        'event_action': 'trigger',
        'dedup_key': f"{alert['dataset']}_{alert['anomaly_type']}",
        'payload': {
            'summary': f"Data issue in {alert['dataset']}: {alert['message']}",
            'severity': 'critical' if alert['severity'] == 'critical' else 'error',
            'source': 'data-observability',
            'custom_details': alert
        }
    }

    requests.post(
        'https://events.pagerduty.com/v2/enqueue',
        json=payload
    )


# Setup
alerts = DataObservabilityAlerts()
alerts.register_handler(AlertSeverity.MEDIUM, slack_alert_handler)
alerts.register_handler(AlertSeverity.HIGH, pagerduty_alert_handler)
```

## Data Lineage Tracking

```python
from dataclasses import dataclass
from typing import Set, Optional
import networkx as nx

@dataclass
class DataAsset:
    name: str
    type: str  # 'table', 'file', 'view', etc.
    location: str
    schema: Optional[dict] = None

@dataclass
class LineageEdge:
    source: str
    target: str
    transformation: str
    job_name: Optional[str] = None

class LineageTracker:
    """Track data lineage across the pipeline"""

    def __init__(self):
        self.graph = nx.DiGraph()
        self.assets: Dict[str, DataAsset] = {}

    def register_asset(self, asset: DataAsset):
        """Register a data asset"""
        self.assets[asset.name] = asset
        self.graph.add_node(asset.name, **asset.__dict__)

    def add_lineage(self, edge: LineageEdge):
        """Add lineage relationship"""
        self.graph.add_edge(
            edge.source,
            edge.target,
            transformation=edge.transformation,
            job_name=edge.job_name
        )

    def get_upstream(self, asset_name: str, depth: int = -1) -> Set[str]:
        """Get all upstream dependencies"""
        if depth == -1:
            return nx.ancestors(self.graph, asset_name)
        else:
            upstream = set()
            current_level = {asset_name}
            for _ in range(depth):
                next_level = set()
                for node in current_level:
                    next_level.update(self.graph.predecessors(node))
                upstream.update(next_level)
                current_level = next_level
            return upstream

    def get_downstream(self, asset_name: str, depth: int = -1) -> Set[str]:
        """Get all downstream dependents"""
        if depth == -1:
            return nx.descendants(self.graph, asset_name)
        else:
            downstream = set()
            current_level = {asset_name}
            for _ in range(depth):
                next_level = set()
                for node in current_level:
                    next_level.update(self.graph.successors(node))
                downstream.update(next_level)
                current_level = next_level
            return downstream

    def impact_analysis(self, asset_name: str) -> dict:
        """Analyze impact of issues with an asset"""
        downstream = self.get_downstream(asset_name)

        return {
            'affected_asset': asset_name,
            'downstream_count': len(downstream),
            'downstream_assets': list(downstream),
            'critical_paths': self._find_critical_paths(asset_name, downstream)
        }

    def _find_critical_paths(
        self,
        source: str,
        targets: Set[str]
    ) -> List[List[str]]:
        """Find paths from source to critical downstream assets"""
        critical_paths = []
        for target in targets:
            if self.assets.get(target, DataAsset('', '', '')).type == 'report':
                try:
                    paths = list(nx.all_simple_paths(self.graph, source, target))
                    critical_paths.extend(paths)
                except nx.NetworkXNoPath:
                    pass
        return critical_paths

    def to_json(self) -> str:
        """Export lineage as JSON"""
        data = {
            'nodes': [
                {'id': node, **self.graph.nodes[node]}
                for node in self.graph.nodes
            ],
            'edges': [
                {
                    'source': u,
                    'target': v,
                    **self.graph.edges[u, v]
                }
                for u, v in self.graph.edges
            ]
        }
        return json.dumps(data, indent=2, default=str)
```

## Key Data Observability Practices

1. **Monitor Proactively**: Don't wait for users to report issues
2. **Establish Baselines**: Know what "normal" looks like
3. **Track Lineage**: Understand data flow for impact analysis
4. **Alert Intelligently**: Reduce noise, focus on actionable issues
5. **Measure SLOs**: Define and track data reliability targets

Data observability in 2021 became essential as organizations depended more on data. The tools emerged to make it practical; the discipline makes it effective.

## Resources

- [Monte Carlo Data Observability](https://www.montecarlodata.com/)
- [Great Expectations](https://greatexpectations.io/)
- [OpenLineage](https://openlineage.io/)
- [dbt Exposures](https://docs.getdbt.com/docs/build/exposures)
