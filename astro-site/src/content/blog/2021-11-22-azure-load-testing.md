---
title: "Azure Load Testing: Cloud-Native Performance Testing"
description: "Azure Load Testing makes performance validation accessible and integrated into modern DevOps workflows. By catching performance regressions early, you can…"
author: Michael John Pena
draft: false
date: 2021-11-22
tags:
  - Azure
  - Performance Testing
  - Load Testing
  - DevOps
  - Testing
---

## What is Azure Load Testing?

Azure Load Testing provides:

- **High-scale load**: Generate thousands of concurrent users
- **JMeter-based**: Use existing JMeter scripts
- **CI/CD integration**: Automated performance gates
- **Real-time insights**: Monitor during test execution
- **Server-side metrics**: Correlate with Azure Monitor

## Creating a Load Test

### Azure Portal Quick Test

```bash
# Create load testing resource
az load create \
    --name loadtest-myapp \
    --resource-group rg-loadtest \
    --location eastus

# Create a quick test (URL-based)
az load test create \
    --name quick-test \
    --load-test-resource loadtest-myapp \
    --resource-group rg-loadtest \
    --test-type URL \
    --url "https://myapp.azurewebsites.net/api/products" \
    --http-method GET \
    --engine-instances 1 \
    --users 100 \
    --duration 120
```

### JMeter Test Script

```xml
<?xml version="1.0" encoding="UTF-8"?>
<jmeterTestPlan version="1.2" properties="5.0" jmeter="5.4.1">
  <hashTree>
    <TestPlan guiclass="TestPlanGui" testclass="TestPlan" testname="E-Commerce Load Test">
      <stringProp name="TestPlan.comments">Load test for e-commerce API</stringProp>
      <boolProp name="TestPlan.functional_mode">false</boolProp>
      <boolProp name="TestPlan.serialize_threadgroups">false</boolProp>
    </TestPlan>
    <hashTree>
      <ThreadGroup guiclass="ThreadGroupGui" testclass="ThreadGroup" testname="Browse Products">
        <intProp name="ThreadGroup.num_threads">${__P(threads,100)}</intProp>
        <intProp name="ThreadGroup.ramp_time">${__P(rampup,60)}</intProp>
        <boolProp name="ThreadGroup.same_user_on_next_iteration">true</boolProp>
        <stringProp name="ThreadGroup.on_sample_error">continue</stringProp>
        <elementProp name="ThreadGroup.main_controller" elementType="LoopController">
          <intProp name="LoopController.loops">-1</intProp>
        </elementProp>
        <stringProp name="ThreadGroup.duration">${__P(duration,300)}</stringProp>
      </ThreadGroup>
      <hashTree>
        <HTTPSamplerProxy guiclass="HttpTestSampleGui" testclass="HTTPSamplerProxy" testname="Get Products">
          <stringProp name="HTTPSampler.domain">${__P(webapp,myapp.azurewebsites.net)}</stringProp>
          <stringProp name="HTTPSampler.port">443</stringProp>
          <stringProp name="HTTPSampler.protocol">https</stringProp>
          <stringProp name="HTTPSampler.path">/api/products</stringProp>
          <stringProp name="HTTPSampler.method">GET</stringProp>
        </HTTPSamplerProxy>
        <hashTree>
          <ResponseAssertion guiclass="AssertionGui" testclass="ResponseAssertion" testname="Response Code 200">
            <collectionProp name="Asserion.test_strings">
              <stringProp name="49586">200</stringProp>
            </collectionProp>
            <stringProp name="Assertion.test_field">Assertion.response_code</stringProp>
            <intProp name="Assertion.test_type">8</intProp>
          </ResponseAssertion>
          <JSONPathAssertion guiclass="JSONPathAssertionGui" testclass="JSONPathAssertion" testname="Products Exist">
            <stringProp name="JSON_PATH">$.products</stringProp>
            <stringProp name="EXPECTED_VALUE">true</stringProp>
            <boolProp name="JSONVALIDATION">false</boolProp>
            <boolProp name="EXPECT_NULL">false</boolProp>
            <boolProp name="INVERT">false</boolProp>
          </JSONPathAssertion>
        </hashTree>
        <HTTPSamplerProxy guiclass="HttpTestSampleGui" testclass="HTTPSamplerProxy" testname="Get Product Details">
          <stringProp name="HTTPSampler.domain">${__P(webapp,myapp.azurewebsites.net)}</stringProp>
          <stringProp name="HTTPSampler.path">/api/products/${productId}</stringProp>
          <stringProp name="HTTPSampler.method">GET</stringProp>
        </HTTPSamplerProxy>
        <hashTree>
          <RegexExtractor guiclass="RegexExtractorGui" testclass="RegexExtractor" testname="Extract Product ID">
            <stringProp name="RegexExtractor.useHeaders">false</stringProp>
            <stringProp name="RegexExtractor.refname">productId</stringProp>
            <stringProp name="RegexExtractor.regex">"id":"([^"]+)"</stringProp>
            <stringProp name="RegexExtractor.template">$1$</stringProp>
            <stringProp name="RegexExtractor.default">1</stringProp>
            <stringProp name="RegexExtractor.match_number">1</stringProp>
          </RegexExtractor>
        </hashTree>
      </hashTree>
      <ThreadGroup guiclass="ThreadGroupGui" testclass="ThreadGroup" testname="Checkout Flow">
        <intProp name="ThreadGroup.num_threads">${__P(checkout_threads,50)}</intProp>
        <intProp name="ThreadGroup.ramp_time">30</intProp>
        <stringProp name="ThreadGroup.duration">${__P(duration,300)}</stringProp>
      </ThreadGroup>
      <hashTree>
        <HTTPSamplerProxy guiclass="HttpTestSampleGui" testclass="HTTPSamplerProxy" testname="Add to Cart">
          <stringProp name="HTTPSampler.domain">${__P(webapp,myapp.azurewebsites.net)}</stringProp>
          <stringProp name="HTTPSampler.path">/api/cart</stringProp>
          <stringProp name="HTTPSampler.method">POST</stringProp>
          <boolProp name="HTTPSampler.postBodyRaw">true</boolProp>
          <elementProp name="HTTPsampler.Arguments" elementType="Arguments">
            <collectionProp name="Arguments.arguments">
              <elementProp name="" elementType="HTTPArgument">
                <stringProp name="Argument.value">{"productId": "${productId}", "quantity": 1}</stringProp>
              </elementProp>
            </collectionProp>
          </elementProp>
        </HTTPSamplerProxy>
        <hashTree>
          <HeaderManager guiclass="HeaderPanel" testclass="HeaderManager" testname="HTTP Headers">
            <collectionProp name="HeaderManager.headers">
              <elementProp name="" elementType="Header">
                <stringProp name="Header.name">Content-Type</stringProp>
                <stringProp name="Header.value">application/json</stringProp>
              </elementProp>
            </collectionProp>
          </HeaderManager>
        </hashTree>
      </hashTree>
    </hashTree>
  </hashTree>
</jmeterTestPlan>
```

### Test Configuration

```yaml
# load-test-config.yaml
version: v0.1
testId: ecommerce-load-test
testName: E-Commerce Load Test
displayName: E-Commerce API Performance Test
description: Load test for e-commerce application APIs
testPlan: test-script.jmx
engineInstances: 5
configurationFiles:
  - users.csv
  - products.csv
failureCriteria:
  - avg(response_time_ms) > 500
  - percentage(error) > 5
  - p99(response_time_ms) > 2000
autoStop:
  errorPercentage: 90
  errorRate: 10
env:
  - name: webapp
    value: myapp.azurewebsites.net
  - name: threads
    value: 200
  - name: duration
    value: 600
secrets:
  - name: api_key
    value: ${API_KEY}
```

## Running Tests

### CLI Execution

```bash
# Upload test files
az load test-file upload \
    --test-id ecommerce-load-test \
    --load-test-resource loadtest-myapp \
    --resource-group rg-loadtest \
    --path test-script.jmx

# Upload configuration
az load test-file upload \
    --test-id ecommerce-load-test \
    --load-test-resource loadtest-myapp \
    --resource-group rg-loadtest \
    --path load-test-config.yaml \
    --file-type ADDITIONAL_ARTIFACTS

# Run the test
az load test-run create \
    --test-id ecommerce-load-test \
    --test-run-id run-$(date +%Y%m%d-%H%M%S) \
    --load-test-resource loadtest-myapp \
    --resource-group rg-loadtest \
    --description "Performance baseline test"

# Monitor test status
az load test-run show \
    --test-run-id run-20211122-143000 \
    --load-test-resource loadtest-myapp \
    --resource-group rg-loadtest \
    --query status
```

### Parameterized Tests

```bash
# Create test with parameters
az load test create \
    --test-id param-test \
    --load-test-resource loadtest-myapp \
    --resource-group rg-loadtest \
    --test-plan test-script.jmx \
    --engine-instances 3 \
    --env webapp=staging.myapp.com threads=500 duration=900

# Run with different parameters
az load test-run create \
    --test-id param-test \
    --test-run-id peak-load-test \
    --load-test-resource loadtest-myapp \
    --resource-group rg-loadtest \
    --env webapp=prod.myapp.com threads=1000 duration=1800
```

## CI/CD Integration

### GitHub Actions

```yaml
name: Load Test

on:
  workflow_dispatch:
  schedule:
    - cron: '0 2 * * *'  # Daily at 2 AM

jobs:
  loadtest:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2

      - name: Azure Login
        uses: azure/login@v1
        with:
          creds: ${{ secrets.AZURE_CREDENTIALS }}

      - name: Run Load Test
        uses: azure/load-testing@v1
        with:
          loadTestConfigFile: 'load-test-config.yaml'
          loadTestResource: 'loadtest-myapp'
          resourceGroup: 'rg-loadtest'
          env: |
            [
              {"name": "webapp", "value": "${{ github.event.inputs.target || 'staging.myapp.com' }}"},
              {"name": "threads", "value": "500"}
            ]

      - name: Upload Results
        uses: actions/upload-artifact@v2
        if: always()
        with:
          name: load-test-results
          path: ${{ github.workspace }}/loadTest/

      - name: Post Results to PR
        if: github.event_name == 'pull_request'
        uses: actions/github-script@v5
        with:
          script: |
            const fs = require('fs');
            const results = JSON.parse(fs.readFileSync('loadTest/results.json'));

            const body = `
            ## Load Test Results

            | Metric | Value |
            |--------|-------|
            | Avg Response Time | ${results.avgResponseTime}ms |
            | P95 Response Time | ${results.p95ResponseTime}ms |
            | Error Rate | ${results.errorRate}% |
            | Throughput | ${results.throughput} req/s |

            ${results.passed ? '### PASSED' : '### FAILED'}
            `;

            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: body
            });
```

### Azure DevOps Pipeline

```yaml
trigger: none

parameters:
  - name: environment
    displayName: Target Environment
    type: string
    default: staging
    values:
      - staging
      - production

variables:
  loadTestResource: 'loadtest-myapp'
  resourceGroup: 'rg-loadtest'

stages:
  - stage: LoadTest
    displayName: 'Run Load Test'
    jobs:
      - job: ExecuteLoadTest
        pool:
          vmImage: 'ubuntu-latest'
        steps:
          - task: AzureLoadTest@1
            displayName: 'Run Load Test'
            inputs:
              azureSubscription: 'Azure-Connection'
              loadTestConfigFile: 'load-test-config.yaml'
              loadTestResource: '$(loadTestResource)'
              resourceGroup: '$(resourceGroup)'
              env: |
                [
                  {"name": "webapp", "value": "${{ parameters.environment }}.myapp.com"},
                  {"name": "threads", "value": "500"}
                ]

          - task: PublishTestResults@2
            displayName: 'Publish Results'
            inputs:
              testResultsFormat: 'JUnit'
              testResultsFiles: '**/results.xml'

          - task: PublishPipelineArtifact@1
            displayName: 'Publish Load Test Artifacts'
            inputs:
              targetPath: '$(System.DefaultWorkingDirectory)/loadTest'
              artifact: 'LoadTestResults'

  - stage: AnalyzeResults
    displayName: 'Analyze Results'
    dependsOn: LoadTest
    jobs:
      - job: ValidatePerformance
        steps:
          - download: current
            artifact: LoadTestResults

          - script: |
              # Parse results and validate
              python analyze_results.py $(Pipeline.Workspace)/LoadTestResults/results.json
            displayName: 'Validate Performance Thresholds'
```

## Server-Side Metrics

### Configure App Components

```bash
# Add Azure resource to monitor during test
az load test app-component add \
    --test-id ecommerce-load-test \
    --load-test-resource loadtest-myapp \
    --resource-group rg-loadtest \
    --app-component-id "/subscriptions/.../providers/Microsoft.Web/sites/myapp" \
    --app-component-name "myapp" \
    --app-component-type "Microsoft.Web/sites"

# Add database metrics
az load test app-component add \
    --test-id ecommerce-load-test \
    --load-test-resource loadtest-myapp \
    --resource-group rg-loadtest \
    --app-component-id "/subscriptions/.../providers/Microsoft.Sql/servers/mysql/databases/mydb" \
    --app-component-name "mydb" \
    --app-component-type "Microsoft.Sql/servers/databases"
```

### Custom Metrics

```python
# analyze_results.py
import json
import sys
from datetime import datetime

def analyze_load_test_results(results_file):
    with open(results_file) as f:
        results = json.load(f)

    analysis = {
        "timestamp": datetime.utcnow().isoformat(),
        "summary": {
            "total_requests": results["totalRequests"],
            "successful_requests": results["successfulRequests"],
            "failed_requests": results["failedRequests"],
            "error_rate": (results["failedRequests"] / results["totalRequests"]) * 100
        },
        "response_times": {
            "average": results["avgResponseTime"],
            "p50": results["p50ResponseTime"],
            "p90": results["p90ResponseTime"],
            "p95": results["p95ResponseTime"],
            "p99": results["p99ResponseTime"]
        },
        "throughput": results["throughput"]
    }

    # Check thresholds
    thresholds = {
        "avg_response_time_ms": 500,
        "p95_response_time_ms": 2000,
        "error_rate_percent": 5
    }

    passed = True
    failures = []

    if analysis["response_times"]["average"] > thresholds["avg_response_time_ms"]:
        passed = False
        failures.append(f"Average response time {analysis['response_times']['average']}ms exceeds {thresholds['avg_response_time_ms']}ms")

    if analysis["response_times"]["p95"] > thresholds["p95_response_time_ms"]:
        passed = False
        failures.append(f"P95 response time {analysis['response_times']['p95']}ms exceeds {thresholds['p95_response_time_ms']}ms")

    if analysis["summary"]["error_rate"] > thresholds["error_rate_percent"]:
        passed = False
        failures.append(f"Error rate {analysis['summary']['error_rate']:.2f}% exceeds {thresholds['error_rate_percent']}%")

    analysis["passed"] = passed
    analysis["failures"] = failures

    print(json.dumps(analysis, indent=2))

    if not passed:
        print("\nLoad test FAILED!")
        for failure in failures:
            print(f"  - {failure}")
        sys.exit(1)

    print("\nLoad test PASSED!")
    sys.exit(0)

if __name__ == "__main__":
    analyze_load_test_results(sys.argv[1])
```

Azure Load Testing makes performance validation accessible and integrated into modern DevOps workflows. By catching performance regressions early, you can ship with confidence.

## Resources

- [Azure Load Testing Documentation](https://docs.microsoft.com/en-us/azure/load-testing/overview-what-is-azure-load-testing)
- [JMeter Documentation](https://jmeter.apache.org/usermanual/index.html)
- [CI/CD Integration](https://docs.microsoft.com/en-us/azure/load-testing/how-to-configure-load-test-cicd)
