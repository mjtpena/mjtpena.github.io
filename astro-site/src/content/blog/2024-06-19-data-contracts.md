---
title: "Data Contracts: Agreements Between Data Producers and Consumers"
description: "Data contracts formalize the agreement between data producers and consumers. Today I'm exploring how to implement effective data contracts in your data…"
author: Michael John Peña
draft: false
date: 2024-06-19
tags:
  - Data Contracts
  - Data Mesh
  - Data Quality
  - Microsoft Fabric
  - Governance
---

Data contracts formalize the agreement between data producers and consumers. Today I'm exploring how to implement effective data contracts in your data platform.

## What is a Data Contract?

A data contract is a formal agreement that specifies:
- **Schema**: Structure and types of data
- **Semantics**: Meaning of each field
- **Quality**: Expected quality levels
- **SLA**: Freshness, availability, support
- **Usage**: Allowed use cases and restrictions

## Contract Structure

```python
from dataclasses import dataclass, field
from typing import List, Dict, Optional
from datetime import datetime
from enum import Enum

class DataType(Enum):
    STRING = "string"
    INTEGER = "integer"
    DECIMAL = "decimal"
    DATE = "date"
    TIMESTAMP = "timestamp"
    BOOLEAN = "boolean"
    ARRAY = "array"
    STRUCT = "struct"

@dataclass
class FieldContract:
    name: str
    data_type: DataType
    description: str
    nullable: bool = True
    pii: bool = False
    business_key: bool = False
    foreign_key: Optional[str] = None
    valid_values: Optional[List] = None
    pattern: Optional[str] = None
    min_value: Optional[float] = None
    max_value: Optional[float] = None
    examples: List[str] = field(default_factory=list)

@dataclass
class QualityContract:
    completeness: float = 0.95  # % non-null
    uniqueness: float = 1.0  # % unique for keys
    validity: float = 0.99  # % passing validation
    freshness_hours: int = 24
    accuracy_target: Optional[float] = None

@dataclass
class SLAContract:
    availability_percent: float = 99.5
    latency_p95_ms: int = 5000
    support_tier: str = "standard"
    incident_response_hours: int = 24
    change_notification_days: int = 14

@dataclass
class UsageContract:
    allowed_purposes: List[str]
    prohibited_purposes: List[str] = field(default_factory=list)
    requires_approval: bool = False
    retention_days: int = 365
    export_allowed: bool = True

@dataclass
class DataContract:
    name: str
    version: str
    description: str
    owner: str
    domain: str
    fields: List[FieldContract]
    quality: QualityContract
    sla: SLAContract
    usage: UsageContract
    created_at: datetime = field(default_factory=datetime.utcnow)
    effective_date: Optional[datetime] = None
    deprecation_date: Optional[datetime] = None
```

## Contract Definition (YAML)

```yaml
# contracts/customer_contract_v2.yaml
contract:
  name: CustomerMaster
  version: "2.1.0"
  description: Core customer master data
  owner: customer-data-team@company.com
  domain: Customer

schema:
  fields:
    - name: customer_id
      type: string
      description: Unique identifier for the customer
      nullable: false
      business_key: true
      pattern: "^CUS[0-9]{10}$"
      examples:
        - "CUS0000000001"
        - "CUS1234567890"

    - name: email
      type: string
      description: Customer's primary email address
      nullable: false
      pii: true
      pattern: "^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$"

    - name: full_name
      type: string
      description: Customer's full name
      nullable: false
      pii: true
      max_length: 200

    - name: segment
      type: string
      description: Customer segment classification
      nullable: false
      valid_values:
        - Premium
        - Standard
        - Basic

    - name: lifetime_value
      type: decimal
      description: Total revenue from customer
      nullable: true
      precision: 18
      scale: 2
      min_value: 0

    - name: created_date
      type: date
      description: Date customer was created
      nullable: false
      min_value: "2010-01-01"

    - name: is_active
      type: boolean
      description: Whether customer is currently active
      nullable: false
      default: true

quality:
  completeness:
    customer_id: 1.0
    email: 0.99
    full_name: 0.99
    segment: 1.0
    created_date: 1.0
    is_active: 1.0

  uniqueness:
    customer_id: 1.0
    email: 0.999

  validity: 0.99

  freshness:
    max_hours: 4
    update_frequency: hourly

sla:
  availability: 99.9%
  latency_p95: 2000ms
  support:
    tier: gold
    response_time: 4h
    escalation: customer-data-escalation@company.com
  changes:
    notification_days: 30
    breaking_change_notice: 90

usage:
  allowed_purposes:
    - analytics
    - reporting
    - personalization
    - marketing_campaigns

  prohibited_purposes:
    - third_party_sale
    - unencrypted_export

  requires_approval_for:
    - bulk_export
    - ml_training

  retention:
    active_customers: indefinite
    inactive_customers: 7_years
    deleted_customers: 90_days

  export:
    allowed: true
    formats:
      - parquet
      - csv
    requires_pii_masking: true
```

## Contract Validation

```python
from typing import Tuple
import pandas as pd
import re

class ContractValidator:
    """Validate data against a contract."""

    def __init__(self, contract: DataContract):
        self.contract = contract

    def validate(self, df: pd.DataFrame) -> dict:
        """Validate a DataFrame against the contract."""
        results = {
            "valid": True,
            "schema_errors": [],
            "quality_errors": [],
            "field_errors": {}
        }

        # Schema validation
        schema_result = self._validate_schema(df)
        results["schema_errors"] = schema_result["errors"]
        if schema_result["errors"]:
            results["valid"] = False

        # Field validation
        for field in self.contract.fields:
            if field.name in df.columns:
                field_result = self._validate_field(df[field.name], field)
                if not field_result["valid"]:
                    results["field_errors"][field.name] = field_result["errors"]
                    results["valid"] = False

        # Quality validation
        quality_result = self._validate_quality(df)
        results["quality_errors"] = quality_result["errors"]
        results["quality_scores"] = quality_result["scores"]
        if quality_result["errors"]:
            results["valid"] = False

        return results

    def _validate_schema(self, df: pd.DataFrame) -> dict:
        errors = []

        # Check required columns exist
        required_fields = [f.name for f in self.contract.fields if not f.nullable]
        for field_name in required_fields:
            if field_name not in df.columns:
                errors.append(f"Missing required column: {field_name}")

        # Check for unexpected columns
        expected_columns = {f.name for f in self.contract.fields}
        unexpected = set(df.columns) - expected_columns
        if unexpected:
            errors.append(f"Unexpected columns: {unexpected}")

        return {"errors": errors}

    def _validate_field(self, series: pd.Series, field: FieldContract) -> dict:
        errors = []

        # Null check
        if not field.nullable:
            null_count = series.isnull().sum()
            if null_count > 0:
                errors.append(f"Found {null_count} null values in non-nullable field")

        # Pattern check
        if field.pattern:
            non_null = series.dropna()
            pattern_match = non_null.astype(str).str.match(field.pattern)
            invalid_count = (~pattern_match).sum()
            if invalid_count > 0:
                errors.append(f"{invalid_count} values don't match pattern {field.pattern}")

        # Valid values check
        if field.valid_values:
            non_null = series.dropna()
            invalid = ~non_null.isin(field.valid_values)
            invalid_count = invalid.sum()
            if invalid_count > 0:
                errors.append(f"{invalid_count} values not in allowed set")

        # Range check
        if field.min_value is not None:
            below_min = (series < field.min_value).sum()
            if below_min > 0:
                errors.append(f"{below_min} values below minimum {field.min_value}")

        if field.max_value is not None:
            above_max = (series > field.max_value).sum()
            if above_max > 0:
                errors.append(f"{above_max} values above maximum {field.max_value}")

        return {"valid": len(errors) == 0, "errors": errors}

    def _validate_quality(self, df: pd.DataFrame) -> dict:
        errors = []
        scores = {}

        # Completeness
        total_cells = len(df) * len(df.columns)
        non_null_cells = df.count().sum()
        completeness = non_null_cells / total_cells if total_cells > 0 else 0
        scores["completeness"] = completeness

        if completeness < self.contract.quality.completeness:
            errors.append(f"Completeness {completeness:.2%} below threshold {self.contract.quality.completeness:.2%}")

        # Uniqueness for business keys
        for field in self.contract.fields:
            if field.business_key and field.name in df.columns:
                unique_count = df[field.name].nunique()
                total_count = len(df)
                uniqueness = unique_count / total_count if total_count > 0 else 0
                scores[f"uniqueness_{field.name}"] = uniqueness

                if uniqueness < self.contract.quality.uniqueness:
                    errors.append(f"Uniqueness of {field.name}: {uniqueness:.2%} below {self.contract.quality.uniqueness:.2%}")

        return {"errors": errors, "scores": scores}
```

## Contract Registry

```python
class ContractRegistry:
    """Central registry for data contracts."""

    def __init__(self, storage_client):
        self.storage = storage_client
        self.contracts = {}

    def register(self, contract: DataContract) -> str:
        """Register a new contract version."""
        contract_id = f"{contract.name}:{contract.version}"

        # Validate against previous version
        previous = self.get_latest(contract.name)
        if previous:
            compatibility = self._check_compatibility(previous, contract)
            if not compatibility["compatible"]:
                raise ValueError(f"Breaking changes detected: {compatibility['issues']}")

        # Store contract
        self.storage.save(f"contracts/{contract_id}.json", contract.to_dict())
        self.contracts[contract_id] = contract

        return contract_id

    def get_latest(self, name: str) -> Optional[DataContract]:
        """Get the latest version of a contract."""
        versions = [c for c in self.contracts.values() if c.name == name]
        if not versions:
            return None
        return max(versions, key=lambda c: c.version)

    def _check_compatibility(
        self,
        previous: DataContract,
        new: DataContract
    ) -> dict:
        """Check backward compatibility between versions."""
        issues = []

        # Check for removed fields
        previous_fields = {f.name for f in previous.fields}
        new_fields = {f.name for f in new.fields}
        removed = previous_fields - new_fields
        if removed:
            issues.append(f"Removed fields: {removed}")

        # Check for type changes
        for prev_field in previous.fields:
            new_field = next((f for f in new.fields if f.name == prev_field.name), None)
            if new_field and new_field.data_type != prev_field.data_type:
                issues.append(f"Type changed for {prev_field.name}: {prev_field.data_type} -> {new_field.data_type}")

        # Check for stricter constraints
        for prev_field in previous.fields:
            new_field = next((f for f in new.fields if f.name == prev_field.name), None)
            if new_field:
                if prev_field.nullable and not new_field.nullable:
                    issues.append(f"Field {prev_field.name} made non-nullable")

        return {
            "compatible": len(issues) == 0,
            "issues": issues
        }
```

## Contract in CI/CD

```yaml
# .github/workflows/contract-validation.yml
name: Data Contract Validation

on:
  pull_request:
    paths:
      - 'contracts/**'
      - 'data/**'

jobs:
  validate-contracts:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Set up Python
        uses: actions/setup-python@v4
        with:
          python-version: '3.11'

      - name: Install dependencies
        run: pip install data-contract-validator

      - name: Validate contract schema
        run: |
          for contract in contracts/*.yaml; do
            data-contract validate-schema $contract
          done

      - name: Check backward compatibility
        run: |
          data-contract check-compatibility \
            --previous main \
            --current ${{ github.sha }}

      - name: Validate sample data
        run: |
          data-contract validate-data \
            --contract contracts/customer_contract_v2.yaml \
            --data tests/sample_data/customers.parquet
```

## Best Practices

1. **Version contracts** - Semantic versioning for changes
2. **Validate continuously** - Part of CI/CD
3. **Document semantics** - Not just schema
4. **Plan for evolution** - Backward compatibility
5. **Automate enforcement** - Don't rely on manual checks

## What's Next

Tomorrow I'll cover API-first data design.

## Resources

- [Data Contracts](https://datacontract.com/)
- [Open Data Contract Standard](https://github.com/bitol-io/open-data-contract-standard)
- [Great Expectations](https://greatexpectations.io/)
