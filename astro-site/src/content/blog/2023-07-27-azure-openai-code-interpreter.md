---
title: "Azure OpenAI Code Interpreter: AI-Powered Data Analysis"
author: Michael John Peña
draft: false
date: 2023-07-27
tags:
  - Azure OpenAI
  - Code Interpreter
  - AI
  - Data Analysis

---

I wrote "Azure OpenAI Code Interpreter: AI-Powered Data Analysis" to share practical, production-minded guidance on this topic.

## What is Code Interpreter?

```python
# Code Interpreter capabilities
code_interpreter_features = {
    "code_execution": "Run Python code in a sandboxed environment",
    "file_handling": "Upload and process files",
    "data_analysis": "Analyze datasets with pandas",
    "visualization": "Generate charts and plots",
    "math": "Complex mathematical computations",
    "file_generation": "Create and download files"
}

# Use cases
use_cases = [
    "Data exploration and analysis",
    "Statistical computations",
    "File format conversions",
    "Visualization generation",
    "Math problem solving",
    "Code debugging assistance"
]
```

## Setting Up Azure OpenAI Code Interpreter

```python
from openai import AzureOpenAI

# Initialize client
client = AzureOpenAI(
    azure_endpoint="https://your-resource.openai.azure.com/",
    api_key="your-api-key",
    api_version="2024-02-15-preview"
)

# Create an assistant with Code Interpreter
assistant = client.beta.assistants.create(
    name="Data Analysis Assistant",
    instructions="""You are a data analysis expert.
    When given data, analyze it thoroughly and provide insights.
    Create visualizations to support your findings.
    Explain your methodology clearly.""",
    tools=[{"type": "code_interpreter"}],
    model="gpt-4-turbo"  # Use your deployed model name
)

print(f"Assistant ID: {assistant.id}")
```

## Basic Code Execution

```python
# Create a thread
thread = client.beta.threads.create()

# Send a message requesting analysis
message = client.beta.threads.messages.create(
    thread_id=thread.id,
    role="user",
    content="""
    Generate a random dataset of 100 sales transactions with:
    - date (last 30 days)
    - product_category (Electronics, Clothing, Food)
    - quantity (1-10)
    - unit_price (10-100)
    - total_amount

    Then analyze the data and create visualizations.
    """
)

# Run the assistant
run = client.beta.threads.runs.create(
    thread_id=thread.id,
    assistant_id=assistant.id
)

# Wait for completion
import time
while run.status in ["queued", "in_progress"]:
    time.sleep(1)
    run = client.beta.threads.runs.retrieve(
        thread_id=thread.id,
        run_id=run.id
    )

print(f"Run status: {run.status}")

# Get messages
messages = client.beta.threads.messages.list(thread_id=thread.id)
for msg in messages.data:
    print(f"{msg.role}: {msg.content[0].text.value[:500]}...")
```

## Uploading Files for Analysis

```python
# Upload a file
with open("sales_data.csv", "rb") as file:
    uploaded_file = client.files.create(
        file=file,
        purpose="assistants"
    )

print(f"File ID: {uploaded_file.id}")

# Create message with file attachment
message = client.beta.threads.messages.create(
    thread_id=thread.id,
    role="user",
    content="Analyze this sales data file. Identify trends, outliers, and provide recommendations.",
    attachments=[{
        "file_id": uploaded_file.id,
        "tools": [{"type": "code_interpreter"}]
    }]
)

# Run analysis
run = client.beta.threads.runs.create(
    thread_id=thread.id,
    assistant_id=assistant.id
)

# Wait and retrieve results
while run.status in ["queued", "in_progress"]:
    time.sleep(2)
    run = client.beta.threads.runs.retrieve(
        thread_id=thread.id,
        run_id=run.id
    )
```

## Working with Generated Files

```python
# Get messages with file outputs
messages = client.beta.threads.messages.list(thread_id=thread.id)

for msg in messages.data:
    for content in msg.content:
        # Text content
        if content.type == "text":
            print(content.text.value)

        # Image file (generated charts)
        if content.type == "image_file":
            file_id = content.image_file.file_id
            image_data = client.files.content(file_id)

            # Save the image
            with open(f"output_{file_id}.png", "wb") as f:
                f.write(image_data.read())
            print(f"Saved image: output_{file_id}.png")
```

## Data Analysis Examples

### Statistical Analysis

```python
message = client.beta.threads.messages.create(
    thread_id=thread.id,
    role="user",
    content="""
    With the uploaded data, perform:
    1. Descriptive statistics (mean, median, std, quartiles)
    2. Correlation analysis between numerical variables
    3. Group by category and calculate aggregates
    4. Identify statistical outliers using IQR method
    5. Create a summary report with key findings
    """
)

run = client.beta.threads.runs.create(
    thread_id=thread.id,
    assistant_id=assistant.id
)
```

### Time Series Analysis

```python
message = client.beta.threads.messages.create(
    thread_id=thread.id,
    role="user",
    content="""
    Analyze the time series patterns in the data:
    1. Plot daily/weekly trends
    2. Identify seasonality patterns
    3. Calculate moving averages (7-day, 30-day)
    4. Detect any anomalies in the time series
    5. If possible, provide a simple forecast for the next 7 days
    """
)
```

### Visualization Requests

```python
message = client.beta.threads.messages.create(
    thread_id=thread.id,
    role="user",
    content="""
    Create the following visualizations:
    1. Line chart showing sales over time
    2. Bar chart comparing sales by category
    3. Scatter plot of quantity vs unit price
    4. Box plot showing price distribution by category
    5. Heatmap of correlations between numerical variables

    Use a professional color scheme and add proper labels/titles.
    """
)
```

## Advanced Use Cases

### Data Cleaning

```python
message = client.beta.threads.messages.create(
    thread_id=thread.id,
    role="user",
    content="""
    Clean the uploaded dataset:
    1. Identify and report missing values
    2. Detect and handle duplicates
    3. Fix data type issues
    4. Standardize text fields (trim, case)
    5. Handle outliers appropriately
    6. Create a cleaned version of the dataset and provide it for download
    """
)
```

### Report Generation

```python
message = client.beta.threads.messages.create(
    thread_id=thread.id,
    role="user",
    content="""
    Generate a comprehensive analysis report including:

    ## Executive Summary
    - Key metrics and findings
    - Top recommendations

    ## Data Overview
    - Dataset description
    - Data quality assessment

    ## Analysis Results
    - Trend analysis with visualizations
    - Segment analysis
    - Anomaly detection

    ## Recommendations
    - Data-driven suggestions
    - Areas for further investigation

    Format the report professionally with headers and bullet points.
    """
)
```

## Best Practices

```python
best_practices = {
    "prompting": {
        "be_specific": "Clearly describe what analysis you want",
        "provide_context": "Explain the business context",
        "request_methodology": "Ask AI to explain its approach"
    },
    "file_handling": {
        "size_limits": "Be aware of file size limits (512MB)",
        "formats": "CSV, JSON, Excel work best",
        "clean_data": "Cleaner input = better analysis"
    },
    "iteration": {
        "follow_up": "Ask clarifying questions",
        "refine": "Request modifications to visualizations",
        "validate": "Verify results make sense"
    },
    "security": {
        "sensitive_data": "Don't upload PII or confidential data",
        "review_output": "Check generated code before using",
        "api_keys": "Keep API keys secure"
    }
}
```

## Limitations and Considerations

```python
limitations = {
    "execution_time": "Long-running computations may timeout",
    "package_availability": "Limited to pre-installed packages",
    "network_access": "No external network access",
    "file_persistence": "Files don't persist across sessions",
    "cost": "Token usage for code generation and execution"
}

# Cost considerations
# - Input tokens: Your prompts and uploaded file content
# - Output tokens: AI responses and generated code
# - Code execution: Additional compute time
```

Tomorrow we'll explore ChatGPT Code Interpreter capabilities.

## Resources

- [Azure OpenAI Assistants](https://learn.microsoft.com/en-us/azure/ai-services/openai/assistants-quickstart)
- [Code Interpreter Guide](https://learn.microsoft.com/en-us/azure/ai-services/openai/how-to/code-interpreter)
- [Azure OpenAI Pricing](https://azure.microsoft.com/en-us/pricing/details/cognitive-services/openai-service/)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
