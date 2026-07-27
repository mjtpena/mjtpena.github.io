---
title: "Self-Hosted Agents in Azure DevOps"
author: "Michael John Peña"
draft: false
date: 2022-10-30
tags: ["Azure", "Azure DevOps", "Agents", "Infrastructure"]

---

I wrote "Self-Hosted Agents in Azure DevOps" to share practical, production-minded guidance on this topic.

## Setting Up Self-Hosted Agents

```dockerfile
# Dockerfile for containerized agent
FROM ubuntu:22.04

RUN apt-get update && apt-get install -y \
    curl \
    git \
    jq \
    libicu70 \
    docker.io \
    && rm -rf /var/lib/apt/lists/*

# Install .NET SDK
RUN curl -sSL https://dot.net/v1/dotnet-install.sh | bash /dev/stdin --channel 7.0

# Download agent
WORKDIR /azp
RUN curl -LsS https://vstsagentpackage.azureedge.net/agent/3.220.0/vsts-agent-linux-x64-3.220.0.tar.gz | tar -xz

COPY start.sh .
RUN chmod +x start.sh

ENTRYPOINT ["./start.sh"]
```

```bash
#!/bin/bash
# start.sh
./config.sh --unattended \
  --url "$AZP_URL" \
  --auth pat \
  --token "$AZP_TOKEN" \
  --pool "$AZP_POOL" \
  --agent "${AZP_AGENT_NAME:-$(hostname)}" \
  --replace

./run.sh
```

## Kubernetes Deployment

```yaml
# Azure DevOps agent on Kubernetes
apiVersion: apps/v1
kind: Deployment
metadata:
  name: azp-agent
spec:
  replicas: 3
  selector:
    matchLabels:
      app: azp-agent
  template:
    spec:
      containers:
        - name: agent
          image: myregistry/azp-agent:latest
          env:
            - name: AZP_URL
              value: https://dev.azure.com/myorg
            - name: AZP_TOKEN
              valueFrom:
                secretKeyRef:
                  name: azp-secrets
                  key: token
            - name: AZP_POOL
              value: kubernetes-pool
```

Self-hosted agents provide flexibility for specialized build requirements and secure access to internal resources.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
