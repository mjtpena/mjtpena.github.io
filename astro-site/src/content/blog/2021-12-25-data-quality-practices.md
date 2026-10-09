---
title: "Data Quality Practices: Building Trust in Your Data"
description: "Data quality in 2021 became an engineering discipline. The tools matured, but success requires organizational commitment to treating data as a product."
author: Michael John Pena
draft: false
date: 2021-12-25
tags:
  - Data Quality
  - Data Engineering
  - Great Expectations
  - Data Validation
  - Best Practices
---

## The Data Quality Dimensions

1. **Completeness**: Is all required data present?
2. **Accuracy**: Does the data reflect reality?
3. **Consistency**: Is data consistent across systems?
4. **Timeliness**: Is data fresh enough?
5. **Validity**: Does data conform to expected formats?
6. **Uniqueness**: Are duplicates properly handled?

## Implementing Data Quality with Great Expectations

```python
import great_expectations as ge
from great_expectations.core.batch import RuntimeBatchRequest
from great_expectations.checkpoint import SimpleCheckpoint
from great_expectations.data_context import BaseDataContext

class DataQualityValidator:
    """Production data quality validation"""

    def __init__(self, context_root_dir: str):
        self.context = ge.get_context(context_root_dir=context_root_dir)

    def create_expectation_suite(
        self,
        suite_name: str,
        table_schema: dict
    ):
        """Create expectations based on schema"""
        suite = self.context.create_expectation_suite(
            expectation_suite_name=suite_name,
            overwrite_existing=True
        )

        for column, config in table_schema.items():
            # Not null expectation
            if config.get('required', False):
                suite.add_expectation(
                    ge.core.ExpectationConfiguration(
                        expectation_type="expect_column_values_to_not_be_null",
                        kwargs={"column": column}
                    )
                )

            # Type expectations
            if config.get('type') == 'integer':
                suite.add_expectation(
                    ge.core.ExpectationConfiguration(
                        expectation_type="expect_column_values_to_be_of_type",
                        kwargs={"column": column, "type_": "int"}
                    )
                )

            # Range expectations
            if 'min' in config or 'max' in config:
                suite.add_expectation(
                    ge.core.ExpectationConfiguration(
                        expectation_type="expect_column_values_to_be_between",
                        kwargs={
                            "column": column,
                            "min_value": config.get('min'),
                            "max_value": config.get('max')
                        }
                    )
                )

            # Uniqueness
            if config.get('unique', False):
                suite.add_expectation(
                    ge.core.ExpectationConfiguration(
                        expectation_type="expect_column_values_to_be_unique",
                        kwargs={"column": column}
                    )
                )

            # Regex pattern
            if 'pattern' in config:
                suite.add_expectation(
                    ge.core.ExpectationConfiguration(
                        expectation_type="expect_column_values_to_match_regex",
                        kwargs={"column": column, "regex": config['pattern']}
                    )
                )

            # Allowed values
            if 'allowed_values' in config:
                suite.add_expectation(
                    ge.core.ExpectationConfiguration(
                        expectation_type="expect_column_values_to_be_in_set",
                        kwargs={"column": column, "value_set": config['allowed_values']}
                    )
                )

        self.context.save_expectation_suite(suite)
        return suite

    def validate_dataframe(
        self,
        df,
        suite_name: str,
        run_name: str = None
    ) -> dict:
        """Validate a DataFrame against expectations"""

        batch_request = RuntimeBatchRequest(
            datasource_name="runtime_datasource",
            data_connector_name="runtime_data_connector",
            data_asset_name="validation_asset",
            runtime_parameters={"batch_data": df},
            batch_identifiers={"batch_id": run_name or "default"}
        )

        checkpoint = SimpleCheckpoint(
            name="validation_checkpoint",
            data_context=self.context,
            validations=[
                {
                    "batch_request": batch_request,
                    "expectation_suite_name": suite_name
                }
            ]
        )

        result = checkpoint.run()

        return {
            "success": result.success,
            "statistics": result.statistics,
            "results": [
                {
                    "expectation": r.expectation_config.expectation_type,
                    "column": r.expectation_config.kwargs.get("column"),
                    "success": r.success,
                    "observed_value": r.result.get("observed_value"),
                    "details": r.result
                }
                for r in result.list_validation_results()[0].results
            ]
        }


# Schema definition
customer_schema = {
    "customer_id": {
        "required": True,
        "unique": True,
        "pattern": r"^CUS-[A-Z]{2}-\d{8}$"
    },
    "email": {
        "required": True,
        "pattern": r"^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$"
    },
    "age": {
        "type": "integer",
        "min": 0,
        "max": 150
    },
    "signup_date": {
        "required": True
    },
    "status": {
        "required": True,
        "allowed_values": ["active", "inactive", "suspended"]
    }
}

# Usage
validator = DataQualityValidator("/path/to/context")
validator.create_expectation_suite("customer_suite", customer_schema)
result = validator.validate_dataframe(df, "customer_suite")
```

## Data Quality in Pipelines

```python
from dataclasses import dataclass
from typing import List, Optional, Callable
from enum import Enum
import pandas as pd

class QualityAction(Enum):
    PASS = "pass"
    WARN = "warn"
    FAIL = "fail"
    QUARANTINE = "quarantine"

@dataclass
class QualityRule:
    name: str
    check: Callable[[pd.DataFrame], bool]
    severity: QualityAction
    description: str

class DataQualityGate:
    """Quality gate for data pipelines"""

    def __init__(self, rules: List[QualityRule]):
        self.rules = rules
        self.results = []

    def evaluate(self, df: pd.DataFrame) -> dict:
        """Evaluate all quality rules"""
        self.results = []
        failed_critical = False
        warnings = []

        for rule in self.rules:
            try:
                passed = rule.check(df)
                self.results.append({
                    "rule": rule.name,
                    "passed": passed,
                    "severity": rule.severity.value,
                    "description": rule.description
                })

                if not passed:
                    if rule.severity == QualityAction.FAIL:
                        failed_critical = True
                    elif rule.severity == QualityAction.WARN:
                        warnings.append(rule.name)

            except Exception as e:
                self.results.append({
                    "rule": rule.name,
                    "passed": False,
                    "severity": rule.severity.value,
                    "error": str(e)
                })
                if rule.severity == QualityAction.FAIL:
                    failed_critical = True

        return {
            "passed": not failed_critical,
            "warnings": warnings,
            "results": self.results
        }


def create_quality_rules() -> List[QualityRule]:
    """Define quality rules for the pipeline"""
    return [
        QualityRule(
            name="no_empty_dataframe",
            check=lambda df: len(df) > 0,
            severity=QualityAction.FAIL,
            description="DataFrame must not be empty"
        ),
        QualityRule(
            name="customer_id_not_null",
            check=lambda df: df['customer_id'].notna().all(),
            severity=QualityAction.FAIL,
            description="Customer ID must not be null"
        ),
        QualityRule(
            name="customer_id_unique",
            check=lambda df: df['customer_id'].is_unique,
            severity=QualityAction.FAIL,
            description="Customer ID must be unique"
        ),
        QualityRule(
            name="email_format_valid",
            check=lambda df: df['email'].str.match(
                r'^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$'
            ).all(),
            severity=QualityAction.WARN,
            description="Email should match expected format"
        ),
        QualityRule(
            name="no_future_dates",
            check=lambda df: (pd.to_datetime(df['created_at']) <= pd.Timestamp.now()).all(),
            severity=QualityAction.FAIL,
            description="Dates must not be in the future"
        ),
        QualityRule(
            name="amount_positive",
            check=lambda df: (df['amount'] >= 0).all(),
            severity=QualityAction.FAIL,
            description="Amount must be non-negative"
        ),
        QualityRule(
            name="completeness_threshold",
            check=lambda df: df.notna().mean().mean() > 0.95,
            severity=QualityAction.WARN,
            description="Overall completeness should exceed 95%"
        )
    ]


# Pipeline integration
def process_data_with_quality(df: pd.DataFrame) -> Optional[pd.DataFrame]:
    """Process data with quality gates"""
    gate = DataQualityGate(create_quality_rules())
    result = gate.evaluate(df)

    if not result["passed"]:
        # Log failures
        for r in result["results"]:
            if not r["passed"] and r["severity"] == "fail":
                print(f"FAILED: {r['rule']} - {r['description']}")
        return None

    # Log warnings
    for warning in result["warnings"]:
        print(f"WARNING: {warning}")

    return df
```

## Data Quality Metrics and Monitoring

```python
from prometheus_client import Gauge, Counter
import time

# Prometheus metrics
data_quality_score = Gauge(
    'data_quality_score',
    'Overall data quality score',
    ['dataset', 'dimension']
)

quality_check_failures = Counter(
    'quality_check_failures_total',
    'Total quality check failures',
    ['dataset', 'check_name']
)

records_quarantined = Counter(
    'records_quarantined_total',
    'Total records sent to quarantine',
    ['dataset', 'reason']
)

class DataQualityMonitor:
    """Monitor and track data quality over time"""

    def __init__(self, dataset_name: str):
        self.dataset_name = dataset_name

    def calculate_quality_score(self, df: pd.DataFrame) -> dict:
        """Calculate quality scores across dimensions"""
        scores = {}

        # Completeness
        completeness = df.notna().mean()
        scores['completeness'] = completeness.mean()

        # Uniqueness (for key columns)
        key_cols = self._identify_key_columns(df)
        if key_cols:
            uniqueness_scores = [
                df[col].nunique() / len(df) for col in key_cols
            ]
            scores['uniqueness'] = sum(uniqueness_scores) / len(uniqueness_scores)
        else:
            scores['uniqueness'] = 1.0

        # Validity
        validity_checks = self._run_validity_checks(df)
        scores['validity'] = sum(validity_checks.values()) / len(validity_checks)

        # Consistency
        consistency_checks = self._run_consistency_checks(df)
        scores['consistency'] = sum(consistency_checks.values()) / len(consistency_checks) if consistency_checks else 1.0

        # Overall score
        scores['overall'] = sum(scores.values()) / len(scores)

        # Update metrics
        for dimension, score in scores.items():
            data_quality_score.labels(
                dataset=self.dataset_name,
                dimension=dimension
            ).set(score)

        return scores

    def _identify_key_columns(self, df: pd.DataFrame) -> List[str]:
        """Identify likely key columns"""
        key_cols = []
        for col in df.columns:
            if 'id' in col.lower() or 'key' in col.lower():
                key_cols.append(col)
        return key_cols

    def _run_validity_checks(self, df: pd.DataFrame) -> dict:
        """Run validity checks"""
        checks = {}

        for col in df.columns:
            if df[col].dtype == 'object':
                # Check for empty strings
                checks[f"{col}_no_empty_strings"] = (df[col] != '').mean()
            elif df[col].dtype in ['int64', 'float64']:
                # Check for reasonable values (no infinities)
                checks[f"{col}_finite"] = np.isfinite(df[col].dropna()).mean()

        return checks

    def _run_consistency_checks(self, df: pd.DataFrame) -> dict:
        """Run consistency checks"""
        checks = {}

        # Example: date ordering checks
        date_cols = df.select_dtypes(include=['datetime64']).columns
        if len(date_cols) >= 2:
            # Check if dates are in logical order
            pass

        return checks

    def quarantine_bad_records(
        self,
        df: pd.DataFrame,
        rules: List[QualityRule]
    ) -> tuple:
        """Separate good and bad records"""
        good_mask = pd.Series([True] * len(df))
        quarantine_reasons = []

        for rule in rules:
            if rule.severity in [QualityAction.FAIL, QualityAction.QUARANTINE]:
                try:
                    # Apply rule at row level
                    row_results = df.apply(
                        lambda row: rule.check(pd.DataFrame([row])),
                        axis=1
                    )
                    failed_mask = ~row_results
                    good_mask &= row_results

                    failed_count = failed_mask.sum()
                    if failed_count > 0:
                        quarantine_reasons.extend([rule.name] * failed_count)
                        records_quarantined.labels(
                            dataset=self.dataset_name,
                            reason=rule.name
                        ).inc(failed_count)
                except Exception:
                    pass

        good_records = df[good_mask]
        bad_records = df[~good_mask]

        return good_records, bad_records
```

## Data Quality Dashboard Queries

```sql
-- Quality metrics over time
SELECT
    date_trunc('day', check_timestamp) as day,
    dataset_name,
    AVG(completeness_score) as avg_completeness,
    AVG(validity_score) as avg_validity,
    AVG(uniqueness_score) as avg_uniqueness,
    COUNT(*) FILTER (WHERE check_passed = false) as failed_checks
FROM data_quality_checks
WHERE check_timestamp > current_date - interval '30 days'
GROUP BY 1, 2
ORDER BY 1, 2;

-- Most common quality issues
SELECT
    rule_name,
    COUNT(*) as failure_count,
    COUNT(DISTINCT dataset_name) as affected_datasets
FROM data_quality_failures
WHERE failure_timestamp > current_date - interval '7 days'
GROUP BY rule_name
ORDER BY failure_count DESC
LIMIT 10;
```

## Key Data Quality Principles

1. **Shift Left**: Validate data as early as possible
2. **Automate**: Manual quality checks don't scale
3. **Monitor Continuously**: Quality can degrade over time
4. **Document Expectations**: Make quality rules explicit
5. **Act on Issues**: Quality checks without action are useless

Data quality in 2021 became an engineering discipline. The tools matured, but success requires organizational commitment to treating data as a product.

## Resources

- [Great Expectations](https://greatexpectations.io/)
- [dbt Tests](https://docs.getdbt.com/docs/build/tests)
- [Data Quality at Airbnb](https://medium.com/airbnb-engineering/data-quality-at-airbnb-e582465f3ef7)
- [Monte Carlo Data Observability](https://www.montecarlodata.com/)
