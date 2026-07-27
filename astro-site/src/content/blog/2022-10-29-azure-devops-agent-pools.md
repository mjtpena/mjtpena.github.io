---
title: "Azure DevOps Agent Pools"
author: "Michael John Peña"
draft: false
date: 2022-10-29
tags: ["Azure", "Azure DevOps", "Agents", "Infrastructure"]

---

I wrote "Azure DevOps Agent Pools" to share practical, production-minded guidance on this topic.

## Pool Types

```yaml
# Microsoft-hosted agents
jobs:
  - job: WindowsBuild
    pool:
      vmImage: 'windows-latest'

  - job: LinuxBuild
    pool:
      vmImage: 'ubuntu-latest'

  - job: MacBuild
    pool:
      vmImage: 'macos-latest'

# Self-hosted agent pool
jobs:
  - job: OnPremBuild
    pool:
      name: 'MyAgentPool'
      demands:
        - docker
        - Agent.OS -equals Linux
```

## Agent Configuration

```bash
# Download and configure agent
./config.sh --unattended \
  --url https://dev.azure.com/myorg \
  --auth pat \
  --token $PAT \
  --pool MyAgentPool \
  --agent my-agent-01 \
  --acceptTeeEula \
  --replace

# Run as service
sudo ./svc.sh install
sudo ./svc.sh start
```

## Pool Management

```yaml
# Capabilities and demands
agent_capabilities:
  system:
    - Agent.OS: Linux
    - Agent.Version: 2.x
  user_defined:
    - docker
    - node18
    - dotnet7

pipeline_demands:
  - docker
  - dotnet7
```

Agent pools provide flexible compute resources for diverse build requirements.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
