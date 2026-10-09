---
title: "DataOps Practices: Agile for Data Teams"
description: "DataOps in 2021 matured from concept to standard practice. Teams that adopted these practices delivered faster and more reliably than those stuck in manual…"
author: Michael John Pena
draft: false
date: 2021-12-27
tags:
  - DataOps
  - Data Engineering
  - DevOps
  - Agile
  - Best Practices
---

## DataOps Principles

1. **Continuous Integration**: Automated testing of data pipelines
2. **Continuous Delivery**: Rapid, reliable deployment of changes
3. **Collaboration**: Breaking silos between data teams and stakeholders
4. **Automation**: Reduce manual processes everywhere
5. **Monitoring**: Comprehensive observability of data systems

## Data Pipeline CI/CD

```yaml
# .github/workflows/data-pipeline-ci.yml
name: Data Pipeline CI/CD

on:
  push:
    branches: [main, develop]
    paths:
      - 'pipelines/**'
      - 'models/**'
      - 'tests/**'
  pull_request:
    branches: [main]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2

      - name: Set up Python
        uses: actions/setup-python@v2
        with:
          python-version: '3.9'

      - name: Install dependencies
        run: |
          pip install sqlfluff black pylint

      - name: Lint SQL
        run: |
          sqlfluff lint pipelines/sql/ --dialect sparksql

      - name: Lint Python
        run: |
          black --check pipelines/python/
          pylint pipelines/python/ --fail-under=8

  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2

      - name: Set up Python
        uses: actions/setup-python@v2
        with:
          python-version: '3.9'

      - name: Install dependencies
        run: pip install -r requirements-test.txt

      - name: Run unit tests
        run: |
          pytest tests/unit/ -v --cov=pipelines --cov-report=xml

      - name: Upload coverage
        uses: codecov/codecov-action@v2

  integration-tests:
    needs: [lint, unit-tests]
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:13
        env:
          POSTGRES_PASSWORD: testpass
        ports:
          - 5432:5432

    steps:
      - uses: actions/checkout@v2

      - name: Run integration tests
        env:
          DATABASE_URL: postgresql://postgres:testpass@localhost:5432/test
        run: |
          pytest tests/integration/ -v

  data-quality-tests:
    needs: integration-tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2

      - name: Run Great Expectations
        run: |
          great_expectations checkpoint run ci_checkpoint

  deploy-staging:
    needs: data-quality-tests
    if: github.ref == 'refs/heads/develop'
    runs-on: ubuntu-latest
    environment: staging
    steps:
      - uses: actions/checkout@v2

      - name: Deploy to staging
        run: |
          python scripts/deploy.py --environment staging

      - name: Run smoke tests
        run: |
          python tests/smoke/run_smoke_tests.py --environment staging

  deploy-production:
    needs: data-quality-tests
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v2

      - name: Deploy to production
        run: |
          python scripts/deploy.py --environment production

      - name: Notify deployment
        run: |
          python scripts/notify.py --status success
```

## Testing Data Pipelines

```python
import pytest
from pyspark.sql import SparkSession
from pyspark.sql.types import StructType, StructField, StringType, IntegerType, TimestampType
from datetime import datetime

@pytest.fixture(scope="session")
def spark():
    """Create Spark session for testing"""
    return SparkSession.builder \
        .appName("DataPipelineTests") \
        .master("local[*]") \
        .config("spark.sql.shuffle.partitions", "2") \
        .getOrCreate()

@pytest.fixture
def sample_orders(spark):
    """Create sample orders data"""
    schema = StructType([
        StructField("order_id", StringType(), False),
        StructField("customer_id", StringType(), False),
        StructField("order_date", TimestampType(), False),
        StructField("amount", IntegerType(), False),
        StructField("status", StringType(), False)
    ])

    data = [
        ("O001", "C001", datetime(2021, 12, 1), 100, "completed"),
        ("O002", "C002", datetime(2021, 12, 2), 200, "completed"),
        ("O003", "C001", datetime(2021, 12, 3), 150, "pending"),
        ("O004", "C003", datetime(2021, 12, 4), 300, "completed"),
    ]

    return spark.createDataFrame(data, schema)


class TestOrdersTransformation:
    """Test suite for orders transformation"""

    def test_aggregate_daily_orders(self, spark, sample_orders):
        """Test daily orders aggregation"""
        from pipelines.transformations import aggregate_daily_orders

        result = aggregate_daily_orders(sample_orders)

        assert result.count() == 4  # 4 unique dates
        assert "total_amount" in result.columns
        assert "order_count" in result.columns

    def test_filter_completed_orders(self, spark, sample_orders):
        """Test filtering completed orders"""
        from pipelines.transformations import filter_completed_orders

        result = filter_completed_orders(sample_orders)

        assert result.count() == 3
        assert result.filter(result.status != "completed").count() == 0

    def test_customer_aggregation(self, spark, sample_orders):
        """Test customer-level aggregation"""
        from pipelines.transformations import aggregate_by_customer

        result = aggregate_by_customer(sample_orders)

        # Customer C001 should have 2 orders totaling 250
        c001 = result.filter(result.customer_id == "C001").first()
        assert c001.order_count == 2
        assert c001.total_amount == 250

    def test_handles_null_values(self, spark):
        """Test handling of null values"""
        from pipelines.transformations import clean_orders

        schema = StructType([
            StructField("order_id", StringType(), True),
            StructField("amount", IntegerType(), True),
        ])

        data = [
            ("O001", 100),
            (None, 200),
            ("O003", None),
        ]

        df = spark.createDataFrame(data, schema)
        result = clean_orders(df)

        # Null order_ids should be filtered
        assert result.filter(result.order_id.isNull()).count() == 0
        # Null amounts should be filled with 0
        assert result.filter(result.amount.isNull()).count() == 0


class TestDataQuality:
    """Data quality test suite"""

    def test_no_duplicate_order_ids(self, sample_orders):
        """Verify no duplicate order IDs"""
        assert sample_orders.select("order_id").distinct().count() == sample_orders.count()

    def test_amount_positive(self, sample_orders):
        """Verify all amounts are positive"""
        assert sample_orders.filter(sample_orders.amount <= 0).count() == 0

    def test_valid_status_values(self, sample_orders):
        """Verify status values are valid"""
        valid_statuses = ["pending", "completed", "cancelled", "refunded"]
        invalid_count = sample_orders.filter(
            ~sample_orders.status.isin(valid_statuses)
        ).count()
        assert invalid_count == 0

    def test_order_dates_not_future(self, sample_orders):
        """Verify no future order dates"""
        from pyspark.sql import functions as F

        future_orders = sample_orders.filter(
            F.col("order_date") > F.current_timestamp()
        ).count()
        assert future_orders == 0
```

## Environment Management

```python
from dataclasses import dataclass
from typing import Dict, Optional
import yaml
import os

@dataclass
class EnvironmentConfig:
    name: str
    database_url: str
    storage_account: str
    storage_container: str
    compute_cluster: str
    secrets_vault: str
    features: Dict[str, bool]

class EnvironmentManager:
    """Manage data pipeline environments"""

    def __init__(self, config_path: str):
        self.config_path = config_path
        self.environments: Dict[str, EnvironmentConfig] = {}
        self._load_configs()

    def _load_configs(self):
        """Load environment configurations"""
        with open(self.config_path) as f:
            configs = yaml.safe_load(f)

        for env_name, env_config in configs['environments'].items():
            self.environments[env_name] = EnvironmentConfig(
                name=env_name,
                database_url=self._resolve_secret(env_config['database_url']),
                storage_account=env_config['storage_account'],
                storage_container=env_config['storage_container'],
                compute_cluster=env_config['compute_cluster'],
                secrets_vault=env_config['secrets_vault'],
                features=env_config.get('features', {})
            )

    def _resolve_secret(self, value: str) -> str:
        """Resolve secret references"""
        if value.startswith('${') and value.endswith('}'):
            secret_name = value[2:-1]
            return os.environ.get(secret_name, value)
        return value

    def get_environment(self, name: str) -> EnvironmentConfig:
        """Get environment configuration"""
        if name not in self.environments:
            raise ValueError(f"Unknown environment: {name}")
        return self.environments[name]

    def is_feature_enabled(self, env_name: str, feature: str) -> bool:
        """Check if feature flag is enabled"""
        env = self.get_environment(env_name)
        return env.features.get(feature, False)


# environments.yaml
"""
environments:
  development:
    database_url: ${DEV_DATABASE_URL}
    storage_account: devdatalake
    storage_container: dev
    compute_cluster: dev-cluster
    secrets_vault: dev-keyvault
    features:
      incremental_processing: true
      schema_evolution: true
      debug_logging: true

  staging:
    database_url: ${STAGING_DATABASE_URL}
    storage_account: stagingdatalake
    storage_container: staging
    compute_cluster: staging-cluster
    secrets_vault: staging-keyvault
    features:
      incremental_processing: true
      schema_evolution: true
      debug_logging: false

  production:
    database_url: ${PROD_DATABASE_URL}
    storage_account: proddatalake
    storage_container: prod
    compute_cluster: prod-cluster
    secrets_vault: prod-keyvault
    features:
      incremental_processing: true
      schema_evolution: false
      debug_logging: false
"""
```

## Data Pipeline Orchestration

```python
from airflow import DAG
from airflow.operators.python import PythonOperator
from airflow.operators.dummy import DummyOperator
from airflow.utils.task_group import TaskGroup
from datetime import datetime, timedelta

default_args = {
    'owner': 'data-team',
    'depends_on_past': False,
    'email_on_failure': True,
    'email_on_retry': False,
    'retries': 2,
    'retry_delay': timedelta(minutes=5),
    'execution_timeout': timedelta(hours=2)
}

with DAG(
    'customer_analytics_pipeline',
    default_args=default_args,
    description='Customer analytics data pipeline',
    schedule_interval='0 6 * * *',  # Daily at 6 AM
    start_date=datetime(2021, 12, 1),
    catchup=False,
    tags=['analytics', 'customer'],
    max_active_runs=1
) as dag:

    start = DummyOperator(task_id='start')

    # Data ingestion group
    with TaskGroup('ingestion') as ingestion:
        ingest_orders = PythonOperator(
            task_id='ingest_orders',
            python_callable=ingest_orders_data,
            op_kwargs={'source': 'orders_api'}
        )

        ingest_customers = PythonOperator(
            task_id='ingest_customers',
            python_callable=ingest_customers_data,
            op_kwargs={'source': 'crm'}
        )

        ingest_products = PythonOperator(
            task_id='ingest_products',
            python_callable=ingest_products_data,
            op_kwargs={'source': 'catalog'}
        )

    # Data quality checks
    with TaskGroup('quality_checks') as quality_checks:
        check_orders = PythonOperator(
            task_id='check_orders_quality',
            python_callable=run_quality_checks,
            op_kwargs={'dataset': 'bronze.orders'}
        )

        check_customers = PythonOperator(
            task_id='check_customers_quality',
            python_callable=run_quality_checks,
            op_kwargs={'dataset': 'bronze.customers'}
        )

    # Transformations
    with TaskGroup('transformations') as transformations:
        transform_silver = PythonOperator(
            task_id='transform_to_silver',
            python_callable=run_silver_transformations
        )

        transform_gold = PythonOperator(
            task_id='transform_to_gold',
            python_callable=run_gold_transformations
        )

        transform_silver >> transform_gold

    # Data serving
    with TaskGroup('serving') as serving:
        update_warehouse = PythonOperator(
            task_id='update_data_warehouse',
            python_callable=sync_to_warehouse
        )

        refresh_dashboards = PythonOperator(
            task_id='refresh_dashboards',
            python_callable=refresh_power_bi
        )

    end = DummyOperator(task_id='end')

    # Define dependencies
    start >> ingestion >> quality_checks >> transformations >> serving >> end
```

## DataOps Metrics

```python
from prometheus_client import Counter, Histogram, Gauge
import time
from functools import wraps

# Define metrics
pipeline_runs = Counter(
    'pipeline_runs_total',
    'Total pipeline runs',
    ['pipeline', 'status']
)

pipeline_duration = Histogram(
    'pipeline_duration_seconds',
    'Pipeline execution duration',
    ['pipeline'],
    buckets=[60, 300, 600, 1800, 3600, 7200]
)

data_freshness = Gauge(
    'data_freshness_seconds',
    'Data freshness in seconds',
    ['dataset']
)

records_processed = Counter(
    'records_processed_total',
    'Total records processed',
    ['pipeline', 'stage']
)

def track_pipeline(pipeline_name: str):
    """Decorator to track pipeline metrics"""
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            start_time = time.time()
            try:
                result = func(*args, **kwargs)
                pipeline_runs.labels(pipeline=pipeline_name, status='success').inc()
                return result
            except Exception as e:
                pipeline_runs.labels(pipeline=pipeline_name, status='failure').inc()
                raise
            finally:
                duration = time.time() - start_time
                pipeline_duration.labels(pipeline=pipeline_name).observe(duration)
        return wrapper
    return decorator

# Usage
@track_pipeline('customer_analytics')
def run_customer_analytics():
    # Pipeline logic
    pass
```

## Key DataOps Practices

1. **Version Everything**: Code, configs, and schemas in Git
2. **Automate Testing**: Unit, integration, and data quality tests
3. **Environment Parity**: Dev/staging match production
4. **Continuous Monitoring**: Track pipeline health and data quality
5. **Collaborative Development**: Data teams work like software teams

DataOps in 2021 matured from concept to standard practice. Teams that adopted these practices delivered faster and more reliably than those stuck in manual processes.

## Resources

- [DataOps Manifesto](https://dataopsmanifesto.org/)
- [dbt](https://www.getdbt.com/)
- [Apache Airflow](https://airflow.apache.org/)
- [Great Expectations](https://greatexpectations.io/)
