---
title: "Azure Functions with Python: Getting Started"
description: ".NET on Functions is the default story Microsoft tells, but in practice the serverless workload that lands on my desk most often is a Python data scientist…"
author: Michael John Peña
draft: false
date: 2020-09-27
tags:
  - Azure
  - Azure Functions
  - Python
  - Serverless
---

.NET on Functions is the default story Microsoft tells, but in practice the serverless workload that lands on my desk most often is a Python data scientist saying "can we run this scoring code on every incoming request?" Pandas, scikit-learn, and numpy work well on Functions now that the Python worker is mature. The cold-start hit is real for heavier dependencies, but for batch and request-rate workloads under 100 RPS it's a clean fit.

## Project Structure

```
MyFunctionApp/
├── .venv/
├── host.json
├── local.settings.json
├── requirements.txt
└── ProcessData/
    ├── __init__.py
    └── function.json
```

## HTTP Trigger Example

```python
# ProcessData/__init__.py
import azure.functions as func
import pandas as pd
import json

def main(req: func.HttpRequest) -> func.HttpResponse:
    try:
        # Get JSON body
        data = req.get_json()

        # Process with pandas
        df = pd.DataFrame(data['records'])
        summary = df.groupby('category').agg({
            'amount': ['sum', 'mean', 'count']
        }).to_dict()

        return func.HttpResponse(
            json.dumps(summary),
            mimetype="application/json"
        )
    except Exception as e:
        return func.HttpResponse(
            f"Error: {str(e)}",
            status_code=400
        )
```

## Blob Trigger

```python
import azure.functions as func
import pandas as pd

def main(blob: func.InputStream, outputBlob: func.Out[bytes]):
    # Read CSV from blob
    df = pd.read_csv(blob)

    # Transform
    df['processed_date'] = pd.Timestamp.now()
    df['total'] = df['quantity'] * df['price']

    # Write to output
    outputBlob.set(df.to_csv(index=False).encode())
```

```json
// function.json
{
  "bindings": [
    {
      "type": "blobTrigger",
      "direction": "in",
      "name": "blob",
      "path": "raw/{name}.csv",
      "connection": "AzureWebJobsStorage"
    },
    {
      "type": "blob",
      "direction": "out",
      "name": "outputBlob",
      "path": "processed/{name}.csv",
      "connection": "AzureWebJobsStorage"
    }
  ]
}
```

## requirements.txt

```
azure-functions
pandas
numpy
scikit-learn
```

## Deployment

```bash
# Deploy to Azure
func azure functionapp publish MyFunctionApp --python
```

Python Functions unlock ML inference, data processing, and analytics at serverless scale.
