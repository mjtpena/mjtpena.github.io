---
title: "Databricks Notebook Workflows for Data Pipelines"
description: "Databricks notebook workflows—chaining notebooks together using dbutils.notebook.run()—are the stepping stone between \"notebooks as scripts\" and proper…"
author: "Michael John Peña"
draft: false
date: 2021-10-29
tags: ["Azure", "Databricks", "Workflows", "Data Pipelines", "Orchestration"]
---

Databricks notebook workflows—chaining notebooks together using `dbutils.notebook.run()`—are the stepping stone between "notebooks as scripts" and proper pipeline orchestration. The pattern: an orchestrator notebook calls individual step notebooks with parameters, collects exit values, and handles branching logic based on results. Each step notebook handles a specific transformation stage (ingestion, cleaning, enrichment, aggregation), making the pipeline modular and testable in isolation. The limitations become apparent at production scale: `dbutils.notebook.run()` runs notebooks synchronously, maximum timeout is configurable but finite, error messages from child notebooks are serialised strings rather than rich exceptions, and testing notebook interactions requires running the full chain. For simple pipelines with linear step sequences, notebook workflows work well; for complex DAGs with parallelism and sophisticated error handling, Databricks Jobs with task-level dependencies is the better architecture.

## Basic Notebook Chaining

### Using dbutils.notebook.run

```python
# main_workflow.py
# Orchestrator notebook

# Run notebooks sequentially
result1 = dbutils.notebook.run(
    "/ETL/extract_data",
    timeout_seconds=3600,
    arguments={"date": "2021-10-29", "source": "sales"}
)
print(f"Extract completed: {result1}")

result2 = dbutils.notebook.run(
    "/ETL/transform_data",
    timeout_seconds=3600,
    arguments={"date": "2021-10-29"}
)
print(f"Transform completed: {result2}")

result3 = dbutils.notebook.run(
    "/ETL/load_data",
    timeout_seconds=3600,
    arguments={"date": "2021-10-29", "target": "warehouse"}
)
print(f"Load completed: {result3}")
```

### Child Notebook with Return Value

```python
# /ETL/extract_data.py
# Child notebook

# Get parameters
date = dbutils.widgets.get("date")
source = dbutils.widgets.get("source")

# Process data
records_count = spark.read.parquet(f"/data/raw/{source}/{date}").count()

# Return result
dbutils.notebook.exit(f"Extracted {records_count} records")
```

## Parallel Execution

### Using ThreadPoolExecutor

```python
from concurrent.futures import ThreadPoolExecutor, as_completed

def run_notebook(notebook_path, params):
    return dbutils.notebook.run(
        notebook_path,
        timeout_seconds=3600,
        arguments=params
    )

# Define parallel tasks
notebooks = [
    ("/ETL/process_sales", {"region": "east"}),
    ("/ETL/process_sales", {"region": "west"}),
    ("/ETL/process_sales", {"region": "north"}),
    ("/ETL/process_sales", {"region": "south"}),
]

# Execute in parallel
results = {}
with ThreadPoolExecutor(max_workers=4) as executor:
    futures = {
        executor.submit(run_notebook, nb, params): (nb, params)
        for nb, params in notebooks
    }

    for future in as_completed(futures):
        nb, params = futures[future]
        try:
            result = future.result()
            results[params["region"]] = result
            print(f"Completed {params['region']}: {result}")
        except Exception as e:
            print(f"Failed {params['region']}: {e}")
            raise

print(f"All regions processed: {results}")
```

## Error Handling

### Try-Catch Pattern

```python
# workflow_with_error_handling.py

import json

def safe_run_notebook(path, timeout, args):
    try:
        result = dbutils.notebook.run(path, timeout, args)
        return {"status": "success", "result": result}
    except Exception as e:
        return {"status": "failed", "error": str(e)}

# Run with error handling
steps = [
    ("/ETL/step1_extract", {"source": "raw"}),
    ("/ETL/step2_transform", {}),
    ("/ETL/step3_load", {"target": "warehouse"}),
]

results = []
for path, args in steps:
    print(f"Running {path}...")
    result = safe_run_notebook(path, 3600, args)
    results.append({"notebook": path, **result})

    if result["status"] == "failed":
        print(f"Pipeline failed at {path}")
        # Send alert
        dbutils.notebook.run("/Utilities/send_alert", 300, {
            "message": f"Pipeline failed: {result['error']}",
            "severity": "critical"
        })
        break

# Store results
dbutils.notebook.exit(json.dumps(results))
```

### Retry Logic

```python
import time

def run_with_retry(notebook_path, timeout, args, max_retries=3, delay=60):
    for attempt in range(max_retries):
        try:
            result = dbutils.notebook.run(notebook_path, timeout, args)
            return result
        except Exception as e:
            if attempt < max_retries - 1:
                print(f"Attempt {attempt + 1} failed, retrying in {delay}s...")
                time.sleep(delay)
                delay *= 2  # Exponential backoff
            else:
                raise Exception(f"Failed after {max_retries} attempts: {e}")

# Usage
result = run_with_retry(
    "/ETL/unreliable_source",
    timeout=3600,
    args={"date": "2021-10-29"},
    max_retries=3
)
```

## Passing Data Between Notebooks

### Using Temporary Tables

```python
# notebook_1.py - Create temp table
df = spark.read.parquet("/data/raw/sales")
df_transformed = df.filter(col("amount") > 100)
df_transformed.createOrReplaceTempView("processed_sales")

# Save to temp location for next notebook
df_transformed.write.mode("overwrite").parquet("/tmp/workflow/processed_sales")
dbutils.notebook.exit("success")
```

```python
# notebook_2.py - Read from temp table
df = spark.read.parquet("/tmp/workflow/processed_sales")
# Continue processing...
```

### Using Delta Tables

```python
# notebook_1.py - Write to Delta
df.write.format("delta").mode("overwrite").saveAsTable("workflow_temp.step1_output")
dbutils.notebook.exit("success")
```

```python
# notebook_2.py - Read from Delta
df = spark.table("workflow_temp.step1_output")
# Process and save next step
df_processed.write.format("delta").mode("overwrite").saveAsTable("workflow_temp.step2_output")
```

## Workflow Patterns

### DAG-Style Pipeline

```python
# dag_workflow.py

from concurrent.futures import ThreadPoolExecutor, wait

class WorkflowDAG:
    def __init__(self):
        self.results = {}

    def run_task(self, task_id, notebook_path, args, dependencies=[]):
        # Wait for dependencies
        for dep in dependencies:
            if dep not in self.results:
                raise Exception(f"Dependency {dep} not completed")
            if self.results[dep]["status"] != "success":
                raise Exception(f"Dependency {dep} failed")

        # Run notebook
        result = dbutils.notebook.run(notebook_path, 3600, args)
        self.results[task_id] = {"status": "success", "result": result}
        return result

# Define DAG
dag = WorkflowDAG()

# Level 0: No dependencies
with ThreadPoolExecutor(max_workers=2) as executor:
    futures = [
        executor.submit(dag.run_task, "extract_sales", "/ETL/extract_sales", {}),
        executor.submit(dag.run_task, "extract_inventory", "/ETL/extract_inventory", {}),
    ]
    wait(futures)

# Level 1: Depends on extracts
dag.run_task("transform", "/ETL/transform", {}, ["extract_sales", "extract_inventory"])

# Level 2: Depends on transform
dag.run_task("load", "/ETL/load", {}, ["transform"])

print(f"DAG completed: {dag.results}")
```

### Factory Pattern

```python
# workflow_factory.py

class NotebookWorkflow:
    def __init__(self, name, base_path):
        self.name = name
        self.base_path = base_path
        self.steps = []

    def add_step(self, name, notebook, args=None, timeout=3600):
        self.steps.append({
            "name": name,
            "notebook": f"{self.base_path}/{notebook}",
            "args": args or {},
            "timeout": timeout
        })
        return self

    def run(self):
        results = []
        for step in self.steps:
            print(f"Running step: {step['name']}")
            result = dbutils.notebook.run(
                step["notebook"],
                step["timeout"],
                step["args"]
            )
            results.append({"step": step["name"], "result": result})
        return results

# Usage
workflow = (NotebookWorkflow("daily_etl", "/Production/ETL")
    .add_step("extract", "extract", {"date": "2021-10-29"})
    .add_step("transform", "transform")
    .add_step("load", "load", {"target": "warehouse"})
    .add_step("validate", "validate"))

results = workflow.run()
```

## Widget-Based Parameterization

### Define Widgets

```python
# Create widgets for interactive use
dbutils.widgets.text("date", "", "Processing Date")
dbutils.widgets.dropdown("environment", "dev", ["dev", "staging", "prod"], "Environment")
dbutils.widgets.multiselect("regions", "all", ["all", "east", "west", "north", "south"], "Regions")

# Get widget values
date = dbutils.widgets.get("date")
env = dbutils.widgets.get("environment")
regions = dbutils.widgets.get("regions").split(",")

print(f"Processing {date} for {env} environment, regions: {regions}")
```

### Pass Widgets to Child Notebooks

```python
# Main notebook
date = dbutils.widgets.get("date")
env = dbutils.widgets.get("environment")

# Pass to child notebooks
dbutils.notebook.run("/ETL/process", 3600, {
    "date": date,
    "environment": env
})
```

## Monitoring and Logging

### Workflow Logging

```python
import datetime
import json

class WorkflowLogger:
    def __init__(self, workflow_name):
        self.workflow_name = workflow_name
        self.start_time = datetime.datetime.now()
        self.logs = []

    def log(self, step, status, message="", duration=None):
        entry = {
            "timestamp": datetime.datetime.now().isoformat(),
            "workflow": self.workflow_name,
            "step": step,
            "status": status,
            "message": message,
            "duration_seconds": duration
        }
        self.logs.append(entry)
        print(json.dumps(entry))

    def save_log(self):
        log_path = f"/logs/workflows/{self.workflow_name}/{self.start_time.strftime('%Y%m%d_%H%M%S')}.json"
        dbutils.fs.put(log_path, json.dumps(self.logs, indent=2), overwrite=True)
        return log_path

# Usage
logger = WorkflowLogger("daily_etl")

import time
start = time.time()
result = dbutils.notebook.run("/ETL/extract", 3600, {})
duration = time.time() - start
logger.log("extract", "success", result, duration)

# Save logs
log_path = logger.save_log()
```

## Best Practices

1. **Keep notebooks focused** - Each notebook should do one thing well
2. **Use meaningful return values** - Return useful information from notebooks
3. **Implement timeouts** - Set appropriate timeout values
4. **Handle failures gracefully** - Implement retry and alerting
5. **Log extensively** - Track workflow progress and results
6. **Parameterize everything** - Make notebooks reusable
7. **Use Delta for intermediate data** - ACID guarantees between steps

## Conclusion

Notebook workflows provide a flexible way to orchestrate data pipelines in Databricks. By combining sequential and parallel execution with proper error handling, you can build robust production workflows.

Tomorrow, we'll explore Git integration in Databricks for version control.
