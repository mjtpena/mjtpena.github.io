---
title: "Load Testing Azure Applications with Apache JMeter"
author: Michael John Peña
draft: false
date: 2020-11-17
tags:
  - Azure
  - Testing
  - Performance
  - DevOps

---

I wrote "Load Testing Azure Applications with Apache JMeter" to share practical, production-minded guidance on this topic.

## Setting Up JMeter

### Installation

```bash
# Download JMeter
wget https://archive.apache.org/dist/jmeter/binaries/apache-jmeter-5.3.tgz

# Extract
tar -xzf apache-jmeter-5.3.tgz

# Run JMeter GUI
./apache-jmeter-5.3/bin/jmeter
```

### JMeter Test Plan

```xml
<?xml version="1.0" encoding="UTF-8"?>
<jmeterTestPlan version="1.2">
  <hashTree>
    <TestPlan guiclass="TestPlanGui" testname="API Load Test">
      <elementProp name="TestPlan.user_defined_variables" elementType="Arguments">
        <collectionProp name="Arguments.arguments">
          <elementProp name="endpoint" elementType="Argument">
            <stringProp name="Argument.name">endpoint</stringProp>
            <stringProp name="Argument.value">myapi.azurewebsites.net</stringProp>
          </elementProp>
        </collectionProp>
      </elementProp>
    </TestPlan>
    <hashTree>
      <ThreadGroup guiclass="ThreadGroupGui" testname="Users">
        <intProp name="ThreadGroup.num_threads">100</intProp>
        <intProp name="ThreadGroup.ramp_time">60</intProp>
        <longProp name="ThreadGroup.duration">300</longProp>
      </ThreadGroup>
      <hashTree>
        <HTTPSamplerProxy guiclass="HttpTestSampleGui" testname="GET /api/products">
          <stringProp name="HTTPSampler.domain">${endpoint}</stringProp>
          <stringProp name="HTTPSampler.port">443</stringProp>
          <stringProp name="HTTPSampler.protocol">https</stringProp>
          <stringProp name="HTTPSampler.path">/api/products</stringProp>
          <stringProp name="HTTPSampler.method">GET</stringProp>
        </HTTPSamplerProxy>
        <hashTree>
          <ResponseAssertion guiclass="AssertionGui" testname="Response Code 200">
            <collectionProp name="Asserion.test_strings">
              <stringProp name="49586">200</stringProp>
            </collectionProp>
            <intProp name="Assertion.test_type">8</intProp>
          </ResponseAssertion>
        </hashTree>
      </hashTree>
    </hashTree>
  </hashTree>
</jmeterTestPlan>
```

## Running JMeter from Command Line

```bash
# Run test in non-GUI mode (recommended for actual load tests)
jmeter -n -t test-plan.jmx -l results.jtl -e -o ./report

# Parameters:
# -n: Non-GUI mode
# -t: Test plan file
# -l: Results log file
# -e: Generate report dashboard
# -o: Output folder for report
```

## Running JMeter in Azure

### Option 1: Azure Virtual Machines

Deploy JMeter on Azure VMs for distributed testing:

```bash
# Create VM for JMeter controller
az vm create \
    --resource-group loadtest-rg \
    --name jmeter-controller \
    --image UbuntuLTS \
    --size Standard_D4s_v3 \
    --admin-username azureuser \
    --generate-ssh-keys

# Create VMs for JMeter workers
for i in 1 2 3; do
    az vm create \
        --resource-group loadtest-rg \
        --name jmeter-worker-$i \
        --image UbuntuLTS \
        --size Standard_D4s_v3 \
        --admin-username azureuser \
        --generate-ssh-keys
done
```

### Option 2: Azure Container Instances

Run JMeter in containers for quick, scalable tests:

```bash
# Run JMeter in ACI
az container create \
    --resource-group loadtest-rg \
    --name jmeter-test \
    --image justb4/jmeter:5.3 \
    --cpu 4 \
    --memory 8 \
    --azure-file-volume-account-name mystorageaccount \
    --azure-file-volume-account-key $STORAGE_KEY \
    --azure-file-volume-share-name jmeter-share \
    --azure-file-volume-mount-path /jmeter \
    --command-line "jmeter -n -t /jmeter/test-plan.jmx -l /jmeter/results.jtl"
```

## Integrating with Azure DevOps

```yaml
# azure-pipelines.yml
trigger:
  - main

pool:
  vmImage: 'ubuntu-latest'

steps:
  - task: Bash@3
    displayName: 'Install JMeter'
    inputs:
      targetType: 'inline'
      script: |
        wget https://archive.apache.org/dist/jmeter/binaries/apache-jmeter-5.3.tgz
        tar -xzf apache-jmeter-5.3.tgz

  - task: Bash@3
    displayName: 'Run Load Test'
    inputs:
      targetType: 'inline'
      script: |
        ./apache-jmeter-5.3/bin/jmeter -n \
          -t $(Build.SourcesDirectory)/tests/load-test.jmx \
          -l results.jtl \
          -e -o ./report \
          -Jendpoint=$(API_ENDPOINT)

  - task: PublishBuildArtifacts@1
    displayName: 'Publish Test Results'
    inputs:
      pathToPublish: './report'
      artifactName: 'jmeter-report'
```

## Key Metrics to Monitor

| Metric | Description | Target |
|--------|-------------|--------|
| Response Time (avg) | Average response time | < 500ms |
| Response Time (p95) | 95th percentile response time | < 1000ms |
| Throughput | Requests per second | Application-specific |
| Error Rate | Percentage of failed requests | < 1% |
| Virtual Users | Concurrent simulated users | Test scenario |

## Monitoring Server-Side with Application Insights

While JMeter measures client-side metrics, use Application Insights to see what is happening on the server:

```csharp
// Track custom metrics during load test
var telemetry = new TelemetryClient();

telemetry.TrackMetric("OrdersProcessed", ordersCount);
telemetry.TrackMetric("AverageProcessingTime", avgTime);
```

```kusto
// KQL query in Application Insights
requests
| where timestamp > ago(1h)
| summarize
    count(),
    avg(duration),
    percentile(duration, 95),
    percentile(duration, 99)
| by bin(timestamp, 1m)
```

## Best Practices

1. **Start small**: Begin with low user counts and gradually increase
2. **Warm up**: Include a ramp-up period in your test plan
3. **Use realistic data**: Parameterize requests with realistic test data
4. **Monitor both sides**: Client metrics (JMeter) + server metrics (App Insights)
5. **Test during off-peak**: Avoid impacting production users
6. **Baseline first**: Establish performance baselines before changes

## Alternatives to JMeter

- **Gatling**: Scala-based, great for CI/CD integration
- **Locust**: Python-based, easy to script
- **k6**: JavaScript-based, modern and developer-friendly
- **Artillery**: Node.js-based, YAML configuration

## Next Steps

Consider automating your load tests as part of your release pipeline. This ensures performance regressions are caught before reaching production.

Load testing: find bottlenecks before your users do.

