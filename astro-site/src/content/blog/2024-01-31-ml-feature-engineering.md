---
title: "Feature Engineering for ML: Patterns and Best Practices"
description: "Feature engineering is often the difference between mediocre and exceptional model performance. These are the production-ready patterns I apply when…"
author: Michael John Peña
draft: false
date: 2024-01-31
tags:
  - Feature Engineering
  - Machine Learning
  - Azure ML
  - Data Science
  - MLOps
---

Feature engineering is often the difference between mediocre and exceptional model performance. These are the production-ready patterns I apply when preparing features for deployment.

## Core Feature Patterns

### Numerical Transformations

```python
import pandas as pd
import numpy as np
from sklearn.preprocessing import StandardScaler, RobustScaler

def engineer_numerical_features(df: pd.DataFrame, numerical_cols: list) -> pd.DataFrame:
    """Apply common numerical transformations."""

    result = df.copy()

    for col in numerical_cols:
        # Log transform for skewed distributions
        if df[col].min() > 0:
            result[f"{col}_log"] = np.log1p(df[col])

        # Square root for moderate skew
        if df[col].min() >= 0:
            result[f"{col}_sqrt"] = np.sqrt(df[col])

        # Binning into quartiles
        result[f"{col}_quartile"] = pd.qcut(df[col], 4, labels=['Q1', 'Q2', 'Q3', 'Q4'])

        # Z-score normalization
        scaler = StandardScaler()
        result[f"{col}_zscore"] = scaler.fit_transform(df[[col]])

        # Robust scaling (handles outliers)
        robust_scaler = RobustScaler()
        result[f"{col}_robust"] = robust_scaler.fit_transform(df[[col]])

    return result
```

### Categorical Encoding

```python
from sklearn.preprocessing import OneHotEncoder, LabelEncoder

def engineer_categorical_features(df: pd.DataFrame, cat_cols: list) -> pd.DataFrame:
    """Apply categorical encoding strategies."""

    result = df.copy()

    for col in cat_cols:
        cardinality = df[col].nunique()

        if cardinality <= 10:
            # One-hot encoding for low cardinality
            dummies = pd.get_dummies(df[col], prefix=col)
            result = pd.concat([result, dummies], axis=1)

        else:
            # Target encoding for high cardinality
            # (Using simple frequency encoding as example)
            freq_map = df[col].value_counts(normalize=True).to_dict()
            result[f"{col}_freq"] = df[col].map(freq_map)

            # Label encoding
            le = LabelEncoder()
            result[f"{col}_label"] = le.fit_transform(df[col].astype(str))

    return result
```

### Time-Based Features

```python
def engineer_datetime_features(df: pd.DataFrame, datetime_col: str) -> pd.DataFrame:
    """Extract time-based features from datetime column."""

    result = df.copy()
    dt = pd.to_datetime(df[datetime_col])

    # Basic components
    result[f"{datetime_col}_year"] = dt.dt.year
    result[f"{datetime_col}_month"] = dt.dt.month
    result[f"{datetime_col}_day"] = dt.dt.day
    result[f"{datetime_col}_dayofweek"] = dt.dt.dayofweek
    result[f"{datetime_col}_hour"] = dt.dt.hour

    # Cyclical encoding
    result[f"{datetime_col}_month_sin"] = np.sin(2 * np.pi * dt.dt.month / 12)
    result[f"{datetime_col}_month_cos"] = np.cos(2 * np.pi * dt.dt.month / 12)
    result[f"{datetime_col}_hour_sin"] = np.sin(2 * np.pi * dt.dt.hour / 24)
    result[f"{datetime_col}_hour_cos"] = np.cos(2 * np.pi * dt.dt.hour / 24)

    # Business logic features
    result[f"{datetime_col}_is_weekend"] = dt.dt.dayofweek >= 5
    result[f"{datetime_col}_is_month_end"] = dt.dt.is_month_end
    result[f"{datetime_col}_quarter"] = dt.dt.quarter

    return result
```

### Aggregation Features

```python
def engineer_aggregation_features(
    df: pd.DataFrame,
    group_col: str,
    value_col: str
) -> pd.DataFrame:
    """Create aggregation features grouped by an entity."""

    result = df.copy()
    prefix = f"{value_col}_by_{group_col}"

    agg_df = df.groupby(group_col)[value_col].agg([
        'mean', 'std', 'min', 'max', 'sum', 'count'
    ]).add_prefix(f"{prefix}_")

    result = result.merge(agg_df, left_on=group_col, right_index=True, how='left')

    # Add relative features
    result[f"{prefix}_relative_mean"] = result[value_col] / result[f"{prefix}_mean"]

    return result
```

## Feature Selection

```python
from sklearn.feature_selection import SelectKBest, f_classif, mutual_info_classif
from sklearn.ensemble import RandomForestClassifier

def select_features(X: pd.DataFrame, y: pd.Series, n_features: int = 20) -> list:
    """Select top features using multiple methods."""

    results = {}

    # Univariate selection
    selector = SelectKBest(f_classif, k=n_features)
    selector.fit(X, y)
    results['univariate'] = X.columns[selector.get_support()].tolist()

    # Mutual information
    selector_mi = SelectKBest(mutual_info_classif, k=n_features)
    selector_mi.fit(X, y)
    results['mutual_info'] = X.columns[selector_mi.get_support()].tolist()

    # Feature importance from Random Forest
    rf = RandomForestClassifier(n_estimators=100, random_state=42)
    rf.fit(X, y)
    importance = pd.Series(rf.feature_importances_, index=X.columns)
    results['rf_importance'] = importance.nlargest(n_features).index.tolist()

    # Combine: features selected by at least 2 methods
    all_features = results['univariate'] + results['mutual_info'] + results['rf_importance']
    feature_counts = pd.Series(all_features).value_counts()
    selected = feature_counts[feature_counts >= 2].index.tolist()

    return selected
```

## Azure ML Feature Store Integration

```python
from azure.ai.ml import MLClient
from azure.ai.ml.entities import FeatureSet

def register_features_to_store(
    ml_client: MLClient,
    feature_df: pd.DataFrame,
    entity_col: str,
    feature_store_name: str
):
    """Register features to Azure ML Feature Store."""

    # Save features to storage
    feature_path = f"azureml://datastores/features/paths/{feature_store_name}/"
    feature_df.to_parquet(feature_path)

    # Define feature set
    features = [
        {"name": col, "type": str(feature_df[col].dtype)}
        for col in feature_df.columns if col != entity_col
    ]

    feature_set = FeatureSet(
        name=feature_store_name,
        version="1",
        entities=[entity_col],
        source={"type": "parquet", "path": feature_path},
        features=features
    )

    ml_client.feature_sets.begin_create_or_update(feature_set).result()

    return feature_set
```

## Best Practices

1. **Document features** - Track what each feature represents
2. **Version feature sets** - Enable reproducibility
3. **Test for leakage** - Ensure no target information bleeds through
4. **Monitor drift** - Features change over time
5. **Automate pipelines** - Feature engineering should be reproducible

## Conclusion

Good feature engineering amplifies model performance. Use these patterns as building blocks, adapt them to your domain, and always validate with proper evaluation. The best features come from deep domain understanding combined with systematic engineering.
