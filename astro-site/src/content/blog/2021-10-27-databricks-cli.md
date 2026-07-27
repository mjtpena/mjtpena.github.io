---
title: "Mastering the Databricks CLI for Automation"
author: "Michael John Peña"
draft: false
date: 2021-10-27
tags: ["Azure", "Databricks", "CLI", "Automation", "DevOps"]

---

I wrote "Mastering the Databricks CLI for Automation" to share practical, production-minded guidance on this topic.

The Databricks CLI is the command-line interface for Databricks workspace operations—running jobs, managing clusters, deploying libraries, uploading notebooks, and configuring secrets—that belongs in every data engineer's toolbox for automating repetitive workspace tasks and integrating Databricks into CI/CD pipelines. The setup: `pip install databricks-cli`, configure with `databricks configure --token` (personal access token) or profile-based authentication for multi-workspace environments. The commands that get the most use in practice: `databricks jobs run-now --job-id` for triggering pipeline jobs from external orchestration, `databricks fs cp` for uploading files to DBFS, `databricks secrets put` for managing secret scope values, and `databricks clusters list` for inventory scripting. For teams running multiple Databricks workspaces (dev/test/prod), the CLI's profile support makes scripting cross-workspace operations manageable.

## Installation

### Using pip

```bash
# Install Databricks CLI
pip install databricks-cli

# Verify installation
databricks --version
```

### Using Homebrew (macOS)

```bash
brew tap databricks/tap
brew install databricks
```

## Configuration

### Basic Authentication Setup

```bash
# Configure with personal access token
databricks configure --token

# You'll be prompted for:
# Databricks Host: https://adb-123456789.0.azuredatabricks.net
# Token: dapi1234567890abcdef
```

### Multiple Profiles

```bash
# Configure additional profile
databricks configure --token --profile production

# Use specific profile
databricks clusters list --profile production
```

### Configuration File

```ini
# ~/.databrickscfg
[DEFAULT]
host = https://adb-dev.0.azuredatabricks.net
token = dapi_dev_token

[production]
host = https://adb-prod.0.azuredatabricks.net
token = dapi_prod_token

[staging]
host = https://adb-staging.0.azuredatabricks.net
token = dapi_staging_token
```

## Cluster Management

### List Clusters

```bash
# List all clusters
databricks clusters list

# JSON output
databricks clusters list --output JSON
```

### Create Cluster

```bash
# Create cluster from JSON file
databricks clusters create --json-file cluster-config.json
```

```json
// cluster-config.json
{
  "cluster_name": "my-cluster",
  "spark_version": "9.1.x-scala2.12",
  "node_type_id": "Standard_DS3_v2",
  "num_workers": 4,
  "autotermination_minutes": 30
}
```

### Start/Stop Clusters

```bash
# Get cluster ID
CLUSTER_ID=$(databricks clusters list --output JSON | jq -r '.clusters[] | select(.cluster_name=="my-cluster") | .cluster_id')

# Start cluster
databricks clusters start --cluster-id $CLUSTER_ID

# Stop cluster
databricks clusters delete --cluster-id $CLUSTER_ID
```

### Cluster Lifecycle Script

```bash
#!/bin/bash
# cluster-lifecycle.sh

CLUSTER_NAME=$1
ACTION=$2

CLUSTER_ID=$(databricks clusters list --output JSON | \
    jq -r ".clusters[] | select(.cluster_name==\"$CLUSTER_NAME\") | .cluster_id")

case $ACTION in
    start)
        echo "Starting cluster $CLUSTER_NAME..."
        databricks clusters start --cluster-id $CLUSTER_ID
        ;;
    stop)
        echo "Stopping cluster $CLUSTER_NAME..."
        databricks clusters delete --cluster-id $CLUSTER_ID
        ;;
    status)
        databricks clusters get --cluster-id $CLUSTER_ID | jq '.state'
        ;;
    *)
        echo "Usage: $0 <cluster-name> <start|stop|status>"
        exit 1
        ;;
esac
```

## Workspace Operations

### List Files

```bash
# List workspace contents
databricks workspace ls /Users/user@example.com

# Recursive list
databricks workspace ls --long /Shared
```

### Import/Export Notebooks

```bash
# Export single notebook
databricks workspace export /Users/user@example.com/MyNotebook ./MyNotebook.py

# Export with format
databricks workspace export --format SOURCE /Shared/ETL/transform ./transform.py

# Export directory
databricks workspace export_dir /Shared/ETL ./local-etl/

# Import notebook
databricks workspace import ./MyNotebook.py /Users/user@example.com/MyNotebook

# Import directory
databricks workspace import_dir ./local-etl/ /Shared/ETL
```

### Sync Notebooks Script

```bash
#!/bin/bash
# sync-notebooks.sh

LOCAL_DIR="./notebooks"
REMOTE_DIR="/Shared/Production"

echo "Syncing notebooks to $REMOTE_DIR..."

# Export current state
databricks workspace export_dir $REMOTE_DIR ./backup/

# Import new notebooks
databricks workspace import_dir $LOCAL_DIR $REMOTE_DIR --overwrite

echo "Sync complete!"
```

## DBFS Operations

### List Files

```bash
# List DBFS root
databricks fs ls dbfs:/

# List with details
databricks fs ls -l dbfs:/data/
```

### Copy Files

```bash
# Upload local file to DBFS
databricks fs cp ./data.csv dbfs:/data/data.csv

# Download from DBFS
databricks fs cp dbfs:/data/results.csv ./results.csv

# Recursive copy
databricks fs cp -r ./local-data/ dbfs:/data/ --overwrite
```

### Delete Files

```bash
# Delete file
databricks fs rm dbfs:/data/old-file.csv

# Delete directory recursively
databricks fs rm -r dbfs:/data/archive/
```

### DBFS Data Pipeline Script

```bash
#!/bin/bash
# upload-data.sh

SOURCE_DIR=$1
TARGET_PATH=$2
DATE=$(date +%Y%m%d)

echo "Uploading data to DBFS..."

# Create dated directory
databricks fs mkdirs dbfs:$TARGET_PATH/$DATE

# Upload files
for file in $SOURCE_DIR/*; do
    filename=$(basename $file)
    echo "Uploading $filename..."
    databricks fs cp $file dbfs:$TARGET_PATH/$DATE/$filename
done

echo "Upload complete!"
```

## Jobs Management

### List Jobs

```bash
# List all jobs
databricks jobs list

# JSON output with details
databricks jobs list --output JSON | jq '.jobs[] | {id: .job_id, name: .settings.name}'
```

### Create Job

```bash
# Create job from JSON
databricks jobs create --json-file job-config.json
```

```json
// job-config.json
{
  "name": "Daily ETL Job",
  "new_cluster": {
    "spark_version": "9.1.x-scala2.12",
    "node_type_id": "Standard_DS4_v2",
    "num_workers": 8
  },
  "notebook_task": {
    "notebook_path": "/Production/ETL/daily_etl"
  },
  "schedule": {
    "quartz_cron_expression": "0 0 6 * * ?",
    "timezone_id": "UTC"
  },
  "max_retries": 3,
  "timeout_seconds": 7200
}
```

### Run Job

```bash
# Run job now
databricks jobs run-now --job-id 123

# Run with parameters
databricks jobs run-now --job-id 123 --notebook-params '{"date": "2021-10-27"}'

# Get run status
databricks runs get --run-id 456
```

### Job Deployment Script

```bash
#!/bin/bash
# deploy-job.sh

JOB_CONFIG=$1
JOB_NAME=$(jq -r '.name' $JOB_CONFIG)

# Check if job exists
EXISTING_JOB=$(databricks jobs list --output JSON | \
    jq -r ".jobs[] | select(.settings.name==\"$JOB_NAME\") | .job_id")

if [ -n "$EXISTING_JOB" ]; then
    echo "Updating existing job $JOB_NAME (ID: $EXISTING_JOB)..."
    databricks jobs reset --job-id $EXISTING_JOB --json-file $JOB_CONFIG
else
    echo "Creating new job $JOB_NAME..."
    databricks jobs create --json-file $JOB_CONFIG
fi

echo "Deployment complete!"
```

## Secrets Management

### Create Secret Scope

```bash
# Create scope
databricks secrets create-scope --scope my-scope

# Create scope with Azure Key Vault backing
databricks secrets create-scope --scope azure-kv \
    --scope-backend-type AZURE_KEYVAULT \
    --resource-id /subscriptions/.../Microsoft.KeyVault/vaults/my-vault \
    --dns-name https://my-vault.vault.azure.net/
```

### Manage Secrets

```bash
# Put secret
databricks secrets put --scope my-scope --key database-password

# List secrets (values not shown)
databricks secrets list --scope my-scope

# Delete secret
databricks secrets delete --scope my-scope --key old-secret
```

### Secret Deployment Script

```bash
#!/bin/bash
# deploy-secrets.sh

SCOPE=$1
SECRETS_FILE=$2

# Read secrets from file and deploy
while IFS='=' read -r key value; do
    echo "Setting secret: $key"
    echo -n "$value" | databricks secrets put --scope $SCOPE --key $key
done < $SECRETS_FILE

echo "Secrets deployed!"
```

## CI/CD Integration

### GitHub Actions Example

```yaml
# .github/workflows/databricks-deploy.yml
name: Deploy to Databricks

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2

      - name: Install Databricks CLI
        run: pip install databricks-cli

      - name: Configure Databricks CLI
        env:
          DATABRICKS_HOST: ${{ secrets.DATABRICKS_HOST }}
          DATABRICKS_TOKEN: ${{ secrets.DATABRICKS_TOKEN }}
        run: |
          echo "[DEFAULT]" > ~/.databrickscfg
          echo "host = $DATABRICKS_HOST" >> ~/.databrickscfg
          echo "token = $DATABRICKS_TOKEN" >> ~/.databrickscfg

      - name: Deploy Notebooks
        run: |
          databricks workspace import_dir ./notebooks /Shared/Production --overwrite

      - name: Deploy Jobs
        run: |
          for job in ./jobs/*.json; do
            ./scripts/deploy-job.sh $job
          done
```

### Azure DevOps Pipeline

```yaml
# azure-pipelines.yml
trigger:
  - main

pool:
  vmImage: 'ubuntu-latest'

steps:
  - task: UsePythonVersion@0
    inputs:
      versionSpec: '3.8'

  - script: pip install databricks-cli
    displayName: 'Install Databricks CLI'

  - script: |
      echo "[DEFAULT]" > ~/.databrickscfg
      echo "host = $(DATABRICKS_HOST)" >> ~/.databrickscfg
      echo "token = $(DATABRICKS_TOKEN)" >> ~/.databrickscfg
    displayName: 'Configure Databricks CLI'
    env:
      DATABRICKS_TOKEN: $(databricks-token)

  - script: databricks workspace import_dir ./notebooks /Production --overwrite
    displayName: 'Deploy Notebooks'
```

## Best Practices

1. **Use profiles** - Separate environments with profiles
2. **Store config in version control** - Track job and cluster configs
3. **Use secrets management** - Never hardcode credentials
4. **Automate deployments** - Integrate with CI/CD
5. **Script common operations** - Create reusable scripts
6. **Log operations** - Track what changes were made

## Conclusion

The Databricks CLI is essential for automation and DevOps practices. By mastering its commands and integrating it with CI/CD pipelines, you can achieve consistent, reproducible deployments.

Tomorrow, we'll explore the Databricks REST API for even more advanced automation scenarios.

