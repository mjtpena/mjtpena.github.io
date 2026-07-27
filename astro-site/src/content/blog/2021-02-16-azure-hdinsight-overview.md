---
title: Enterprise Big Data Analytics with Azure HDInsight
author: Michael John Peña
draft: false
date: 2021-02-16
url: /blog/azure-hdinsight-overview/
tags:
  - Azure
  - HDInsight
  - Big Data
  - Hadoop
  - Spark

---

I wrote "2021-02-16-azure-hdinsight-overview" to share practical, production-minded guidance on this topic.

## HDInsight Cluster Types

HDInsight supports multiple cluster types for different workloads:

- **Apache Spark** - Fast, general-purpose cluster computing
- **Apache Hadoop** - Batch processing with MapReduce and HDFS
- **Apache Kafka** - Distributed streaming platform
- **Apache HBase** - NoSQL database built on Hadoop
- **Interactive Query** - In-memory analytics with Hive LLAP
- **ML Services** - R-based machine learning

## Creating an HDInsight Cluster

```bash
# Create storage account for cluster
az storage account create \
    --name sthdinsightdemo \
    --resource-group rg-hdinsight \
    --location eastus \
    --sku Standard_LRS

# Get storage key
STORAGE_KEY=$(az storage account keys list \
    --account-name sthdinsightdemo \
    --resource-group rg-hdinsight \
    --query '[0].value' -o tsv)

# Create container
az storage container create \
    --name hdinsight \
    --account-name sthdinsightdemo \
    --account-key $STORAGE_KEY

# Create Spark cluster
az hdinsight create \
    --name spark-cluster \
    --resource-group rg-hdinsight \
    --type Spark \
    --version 3.6 \
    --component-version Spark=2.4 \
    --http-user admin \
    --http-password "YourPassword123!" \
    --ssh-user sshuser \
    --ssh-password "YourSSHPassword123!" \
    --storage-account sthdinsightdemo \
    --storage-account-key $STORAGE_KEY \
    --storage-container hdinsight \
    --headnode-size Standard_D12_v2 \
    --workernode-size Standard_D12_v2 \
    --workernode-count 4
```

## Working with Spark on HDInsight

### Submitting Spark Jobs

```python
# spark_job.py
from pyspark.sql import SparkSession
from pyspark.sql import functions as F

def main():
    spark = SparkSession.builder \
        .appName("HDInsight Sales Analysis") \
        .getOrCreate()

    # Read data from ADLS Gen2
    sales_df = spark.read.parquet(
        "abfss://data@sthdinsightdemo.dfs.core.windows.net/sales/"
    )

    # Process data
    daily_sales = sales_df \
        .groupBy(F.to_date("order_datetime").alias("date")) \
        .agg(
            F.sum("amount").alias("total_sales"),
            F.count("*").alias("order_count"),
            F.countDistinct("customer_id").alias("unique_customers")
        ) \
        .orderBy("date")

    # Write results
    daily_sales.write \
        .mode("overwrite") \
        .parquet("abfss://output@sthdinsightdemo.dfs.core.windows.net/daily_sales/")

    spark.stop()

if __name__ == "__main__":
    main()
```

Submit the job:

```bash
# Copy script to cluster
scp spark_job.py sshuser@spark-cluster-ssh.azurehdinsight.net:/home/sshuser/

# SSH to cluster and submit job
ssh sshuser@spark-cluster-ssh.azurehdinsight.net

spark-submit \
    --master yarn \
    --deploy-mode cluster \
    --num-executors 4 \
    --executor-memory 4g \
    --executor-cores 2 \
    /home/sshuser/spark_job.py
```

## Interactive Query with Hive LLAP

```sql
-- Create external table on Data Lake
CREATE EXTERNAL TABLE IF NOT EXISTS sales_data (
    order_id STRING,
    customer_id STRING,
    product_id STRING,
    quantity INT,
    unit_price DECIMAL(10,2),
    order_date TIMESTAMP
)
STORED AS PARQUET
LOCATION 'abfss://data@sthdinsightdemo.dfs.core.windows.net/sales/';

-- Analyze data with LLAP acceleration
SET hive.llap.execution.mode=all;

SELECT
    DATE_FORMAT(order_date, 'yyyy-MM') as month,
    COUNT(*) as order_count,
    SUM(quantity * unit_price) as total_revenue,
    COUNT(DISTINCT customer_id) as unique_customers
FROM sales_data
WHERE order_date >= '2021-01-01'
GROUP BY DATE_FORMAT(order_date, 'yyyy-MM')
ORDER BY month;

-- Create materialized view for faster queries
CREATE MATERIALIZED VIEW monthly_sales_summary AS
SELECT
    DATE_FORMAT(order_date, 'yyyy-MM') as month,
    product_id,
    SUM(quantity) as total_quantity,
    SUM(quantity * unit_price) as total_revenue
FROM sales_data
GROUP BY DATE_FORMAT(order_date, 'yyyy-MM'), product_id;
```

## Apache Kafka on HDInsight

```python
# Producer example
from kafka import KafkaProducer
import json
import time

producer = KafkaProducer(
    bootstrap_servers=['kafka-cluster-kafka-broker0.azurehdinsight.net:9092'],
    security_protocol='SASL_SSL',
    sasl_mechanism='PLAIN',
    sasl_plain_username='admin',
    sasl_plain_password='YourPassword123!',
    value_serializer=lambda v: json.dumps(v).encode('utf-8')
)

def send_events():
    """Send events to Kafka topic."""
    events = [
        {"event_type": "page_view", "user_id": "user123", "page": "/home"},
        {"event_type": "click", "user_id": "user123", "element": "buy_button"},
        {"event_type": "purchase", "user_id": "user123", "product_id": "prod456"}
    ]

    for event in events:
        event["timestamp"] = int(time.time() * 1000)
        producer.send("user-events", value=event)
        print(f"Sent: {event}")

    producer.flush()

# Consumer example
from kafka import KafkaConsumer

consumer = KafkaConsumer(
    'user-events',
    bootstrap_servers=['kafka-cluster-kafka-broker0.azurehdinsight.net:9092'],
    security_protocol='SASL_SSL',
    sasl_mechanism='PLAIN',
    sasl_plain_username='admin',
    sasl_plain_password='YourPassword123!',
    auto_offset_reset='earliest',
    value_deserializer=lambda m: json.loads(m.decode('utf-8'))
)

def consume_events():
    """Consume events from Kafka topic."""
    for message in consumer:
        event = message.value
        print(f"Received: {event}")
        # Process event
        process_event(event)

def process_event(event):
    """Process individual event."""
    event_type = event.get("event_type")
    if event_type == "purchase":
        # Handle purchase event
        print(f"Processing purchase for user {event['user_id']}")
```

## HBase for NoSQL Workloads

```python
import happybase

# Connect to HBase
connection = happybase.Connection(
    host='hbase-cluster.azurehdinsight.net',
    port=9090,
    transport='buffered'
)

# Create table
connection.create_table(
    'user_profiles',
    {
        'info': dict(max_versions=3),
        'activity': dict(max_versions=10)
    }
)

table = connection.table('user_profiles')

# Insert data
table.put(
    b'user:123',
    {
        b'info:name': b'John Doe',
        b'info:email': b'john@example.com',
        b'activity:last_login': b'2021-02-16T10:30:00Z',
        b'activity:page_views': b'150'
    }
)

# Read data
row = table.row(b'user:123')
print(row)

# Scan with filter
for key, data in table.scan(row_prefix=b'user:'):
    print(f"Key: {key}, Data: {data}")

# Batch operations
with table.batch() as batch:
    for i in range(1000):
        batch.put(
            f'user:{i}'.encode(),
            {
                b'info:name': f'User {i}'.encode(),
                b'activity:score': str(i * 10).encode()
            }
        )
```

## Monitoring HDInsight

Enable and query logs:

```kusto
// Spark application metrics
SparkMetrics_CL
| where TimeGenerated > ago(24h)
| where MetricName_s == "executor.runTime"
| summarize AvgRunTime = avg(MetricValue_d) by bin(TimeGenerated, 1h)
| render timechart

// Yarn application status
YarnApplicationLogs_CL
| where TimeGenerated > ago(1h)
| where ApplicationState_s == "FAILED"
| project TimeGenerated, ApplicationId_s, ApplicationName_s, Diagnostics_s

// Kafka consumer lag
KafkaMetrics_CL
| where MetricName_s == "records-lag"
| summarize MaxLag = max(MetricValue_d) by bin(TimeGenerated, 5m), Topic_s
| render timechart
```

## ARM Template for HDInsight

```json
{
    "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
    "contentVersion": "1.0.0.0",
    "parameters": {
        "clusterName": {
            "type": "string"
        },
        "clusterType": {
            "type": "string",
            "allowedValues": ["Spark", "Hadoop", "Kafka", "HBase"],
            "defaultValue": "Spark"
        },
        "workerNodeCount": {
            "type": "int",
            "defaultValue": 4
        }
    },
    "resources": [
        {
            "type": "Microsoft.HDInsight/clusters",
            "apiVersion": "2021-06-01",
            "name": "[parameters('clusterName')]",
            "location": "[resourceGroup().location]",
            "properties": {
                "clusterVersion": "4.0",
                "osType": "Linux",
                "clusterDefinition": {
                    "kind": "[parameters('clusterType')]",
                    "configurations": {
                        "gateway": {
                            "restAuthCredential.isEnabled": true,
                            "restAuthCredential.username": "admin",
                            "restAuthCredential.password": "[parameters('clusterLoginPassword')]"
                        }
                    }
                },
                "storageProfile": {
                    "storageaccounts": [
                        {
                            "name": "[concat(parameters('storageAccountName'), '.blob.core.windows.net')]",
                            "isDefault": true,
                            "container": "[parameters('clusterName')]",
                            "key": "[listKeys(resourceId('Microsoft.Storage/storageAccounts', parameters('storageAccountName')), '2021-02-01').keys[0].value]"
                        }
                    ]
                },
                "computeProfile": {
                    "roles": [
                        {
                            "name": "headnode",
                            "targetInstanceCount": 2,
                            "hardwareProfile": {
                                "vmSize": "Standard_D12_v2"
                            }
                        },
                        {
                            "name": "workernode",
                            "targetInstanceCount": "[parameters('workerNodeCount')]",
                            "hardwareProfile": {
                                "vmSize": "Standard_D12_v2"
                            }
                        }
                    ]
                }
            }
        }
    ]
}
```

## Best Practices

1. **Choose the right cluster type** for your workload
2. **Use autoscale** for variable workloads
3. **Configure VNet integration** for secure networking
4. **Enable monitoring** with Azure Monitor integration
5. **Use managed identities** for secure access to data services
6. **Optimize storage** with Data Lake Storage Gen2

## Conclusion

Azure HDInsight provides a flexible, fully managed platform for running open-source big data frameworks. Whether you need batch processing with Hadoop, stream processing with Kafka, or interactive queries with Hive LLAP, HDInsight can handle your enterprise big data needs.

Evaluate your workload requirements to choose the appropriate cluster type and configuration.

