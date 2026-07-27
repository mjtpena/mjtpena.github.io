---
title: "Fabric Data Science: ML Workflows in the Modern Data Platform"
author: Michael John Peña
draft: false
date: 2023-07-23
tags:
  - Microsoft Fabric
  - Data Science
  - Machine Learning
  - MLflow
---

Data Science in Fabric brings ML experiment tracking, model registration, and batch prediction into the same platform where the training data lives — which eliminates a class of integration headaches I've seen derail ML projects before. The typical Fabric Data Science workflow: a notebook runs in Spark, calls `mlflow.start_run()`, logs parameters and metrics with MLflow APIs, saves the trained model as a registered model in the Fabric model registry, and then a separate notebook or pipeline runs batch scoring against new Lakehouse data using that registered model. The MLflow tracking server is hosted and managed by Fabric — no separate tracking server to provision or maintain. It's not a replacement for Azure ML for teams that need custom compute environments, feature stores, or real-time inference endpoints, but for batch ML workloads that live entirely within the data platform, it covers the common patterns well.

## Data Science in Fabric Overview

```python
# Fabric Data Science components
ds_components = {
    "notebooks": "Jupyter-style notebooks with Spark",
    "experiments": "MLflow experiment tracking",
    "models": "Model registry",
    "environments": "Custom Python environments"
}

# Pre-installed libraries
preinstalled_libs = [
    "scikit-learn",
    "pandas",
    "numpy",
    "matplotlib",
    "seaborn",
    "mlflow",
    "pytorch",
    "tensorflow",
    "xgboost",
    "lightgbm"
]
```

## Creating a Data Science Notebook

```python
# Create a notebook for ML work:
# 1. New > Notebook
# 2. Attach to Lakehouse (for data access)
# 3. Start coding!

# Access data from Lakehouse
df = spark.read.table("customers")
pandas_df = df.toPandas()

# Check available libraries
import sklearn
import mlflow
import torch
print(f"scikit-learn: {sklearn.__version__}")
print(f"MLflow: {mlflow.__version__}")
print(f"PyTorch: {torch.__version__}")
```

## End-to-End ML Workflow

### Data Preparation

```python
import pandas as pd
from pyspark.sql.functions import col
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler, LabelEncoder

# Load data from Lakehouse
df = spark.read.table("customer_data")

# Convert to pandas for ML
data = df.toPandas()

# Handle missing values
data = data.dropna(subset=['target_column'])
data['numerical_col'] = data['numerical_col'].fillna(data['numerical_col'].median())

# Encode categorical variables
le = LabelEncoder()
data['category_encoded'] = le.fit_transform(data['category_col'])

# Feature engineering
data['feature_ratio'] = data['col_a'] / (data['col_b'] + 1)
data['log_feature'] = np.log1p(data['numerical_col'])

# Prepare features and target
feature_columns = ['numerical_col', 'category_encoded', 'feature_ratio', 'log_feature']
X = data[feature_columns]
y = data['target_column']

# Split data
X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.2, random_state=42
)

# Scale features
scaler = StandardScaler()
X_train_scaled = scaler.fit_transform(X_train)
X_test_scaled = scaler.transform(X_test)

print(f"Training samples: {len(X_train)}")
print(f"Test samples: {len(X_test)}")
```

### Model Training with MLflow

```python
import mlflow
import mlflow.sklearn
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score

# Set experiment name
mlflow.set_experiment("customer_churn_prediction")

# Start MLflow run
with mlflow.start_run(run_name="random_forest_v1"):
    # Log parameters
    params = {
        "n_estimators": 100,
        "max_depth": 10,
        "min_samples_split": 5,
        "random_state": 42
    }
    mlflow.log_params(params)

    # Train model
    model = RandomForestClassifier(**params)
    model.fit(X_train_scaled, y_train)

    # Make predictions
    y_pred = model.predict(X_test_scaled)

    # Calculate metrics
    metrics = {
        "accuracy": accuracy_score(y_test, y_pred),
        "precision": precision_score(y_test, y_pred, average='weighted'),
        "recall": recall_score(y_test, y_pred, average='weighted'),
        "f1_score": f1_score(y_test, y_pred, average='weighted')
    }

    # Log metrics
    mlflow.log_metrics(metrics)

    # Log feature importance
    importance_df = pd.DataFrame({
        'feature': feature_columns,
        'importance': model.feature_importances_
    }).sort_values('importance', ascending=False)

    # Save feature importance plot
    import matplotlib.pyplot as plt
    fig, ax = plt.subplots(figsize=(10, 6))
    importance_df.plot(kind='barh', x='feature', y='importance', ax=ax)
    plt.title('Feature Importance')
    plt.tight_layout()
    mlflow.log_figure(fig, "feature_importance.png")

    # Log model
    mlflow.sklearn.log_model(model, "model")

    print(f"Accuracy: {metrics['accuracy']:.4f}")
    print(f"F1 Score: {metrics['f1_score']:.4f}")
```

### Hyperparameter Tuning

```python
from sklearn.model_selection import GridSearchCV

# Define parameter grid
param_grid = {
    'n_estimators': [50, 100, 200],
    'max_depth': [5, 10, 15, None],
    'min_samples_split': [2, 5, 10],
    'min_samples_leaf': [1, 2, 4]
}

# Perform grid search
with mlflow.start_run(run_name="hyperparameter_tuning"):
    base_model = RandomForestClassifier(random_state=42)

    grid_search = GridSearchCV(
        base_model,
        param_grid,
        cv=5,
        scoring='f1_weighted',
        n_jobs=-1,
        verbose=1
    )

    grid_search.fit(X_train_scaled, y_train)

    # Log best parameters
    mlflow.log_params(grid_search.best_params_)

    # Evaluate best model
    best_model = grid_search.best_estimator_
    y_pred = best_model.predict(X_test_scaled)

    metrics = {
        "accuracy": accuracy_score(y_test, y_pred),
        "f1_score": f1_score(y_test, y_pred, average='weighted')
    }
    mlflow.log_metrics(metrics)

    # Log best model
    mlflow.sklearn.log_model(best_model, "best_model")

    print(f"Best parameters: {grid_search.best_params_}")
    print(f"Best F1 Score: {grid_search.best_score_:.4f}")
```

### Deep Learning Example

```python
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader, TensorDataset

# Define neural network
class ChurnPredictor(nn.Module):
    def __init__(self, input_size):
        super().__init__()
        self.layers = nn.Sequential(
            nn.Linear(input_size, 64),
            nn.ReLU(),
            nn.Dropout(0.3),
            nn.Linear(64, 32),
            nn.ReLU(),
            nn.Dropout(0.3),
            nn.Linear(32, 1),
            nn.Sigmoid()
        )

    def forward(self, x):
        return self.layers(x)

# Prepare PyTorch data
X_train_tensor = torch.FloatTensor(X_train_scaled)
y_train_tensor = torch.FloatTensor(y_train.values).reshape(-1, 1)
train_dataset = TensorDataset(X_train_tensor, y_train_tensor)
train_loader = DataLoader(train_dataset, batch_size=32, shuffle=True)

# Train model
with mlflow.start_run(run_name="neural_network"):
    model = ChurnPredictor(X_train_scaled.shape[1])
    criterion = nn.BCELoss()
    optimizer = optim.Adam(model.parameters(), lr=0.001)

    epochs = 50
    for epoch in range(epochs):
        model.train()
        total_loss = 0
        for batch_X, batch_y in train_loader:
            optimizer.zero_grad()
            outputs = model(batch_X)
            loss = criterion(outputs, batch_y)
            loss.backward()
            optimizer.step()
            total_loss += loss.item()

        if (epoch + 1) % 10 == 0:
            print(f"Epoch {epoch+1}/{epochs}, Loss: {total_loss/len(train_loader):.4f}")

    # Log model
    mlflow.pytorch.log_model(model, "pytorch_model")
```

## Model Registry

```python
# Register model from experiment run
model_name = "customer_churn_model"
run_id = "abc123..."  # From MLflow UI or API

# Register the model
model_uri = f"runs:/{run_id}/model"
registered_model = mlflow.register_model(model_uri, model_name)

# Transition to production
client = mlflow.tracking.MlflowClient()
client.transition_model_version_stage(
    name=model_name,
    version=registered_model.version,
    stage="Production"
)
```

## Batch Scoring

```python
# Load production model and score new data
import mlflow.pyfunc

# Load model
model_name = "customer_churn_model"
model = mlflow.pyfunc.load_model(f"models:/{model_name}/Production")

# Load new data
new_data = spark.read.table("new_customers")
new_data_pd = new_data.toPandas()

# Prepare features (same as training)
features = prepare_features(new_data_pd)  # Your preprocessing function

# Make predictions
predictions = model.predict(features)

# Add predictions to DataFrame
new_data_pd['churn_prediction'] = predictions

# Save to Lakehouse
spark.createDataFrame(new_data_pd).write \
    .format("delta") \
    .mode("overwrite") \
    .saveAsTable("customer_predictions")
```

## Best Practices

```python
best_practices = {
    "experiment_tracking": [
        "Always use MLflow for tracking",
        "Log parameters, metrics, and artifacts",
        "Use descriptive run names"
    ],
    "data_management": [
        "Version your datasets",
        "Document feature engineering",
        "Store preprocessing as pipelines"
    ],
    "model_development": [
        "Start simple, iterate",
        "Cross-validate rigorously",
        "Test on holdout data"
    ],
    "deployment": [
        "Register production models",
        "Monitor model performance",
        "Plan for retraining"
    ]
}
```

Tomorrow we'll dive deeper into ML models in Fabric.

## Resources

- [Fabric Data Science Documentation](https://learn.microsoft.com/en-us/fabric/data-science/data-science-overview)
- [MLflow in Fabric](https://learn.microsoft.com/en-us/fabric/data-science/mlflow-autologging)
- [Model Training Tutorial](https://learn.microsoft.com/en-us/fabric/data-science/tutorial-train-models)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
