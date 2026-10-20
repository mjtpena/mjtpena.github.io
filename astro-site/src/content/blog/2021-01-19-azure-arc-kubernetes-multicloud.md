---
title: "Azure Arc for Kubernetes: One GitOps Baseline Across Every Cloud"
description: "How to use the Azure Arc enabled Kubernetes preview, Flux GitOps and Azure Policy to give EKS, GKE and on-prem clusters one governed baseline."
author: Michael John Pena
draft: false
date: 2021-01-19
url: /blog/azure-arc-kubernetes-multicloud/
tags:
  - Azure Arc
  - Kubernetes
  - GitOps
  - Multi-Cloud
  - Azure Policy
---

Most enterprises I work with have Kubernetes in places they didn't plan for: an on-prem cluster the platform team built, an EKS estate that arrived with an acquisition, and a GKE cluster someone stood up for a proof of concept that never went away. Running them is solved; making them behave the same, with one set of namespaces, monitoring and "secure by default" settings, is where the effort goes. Azure Arc enabled Kubernetes, currently in preview, is Microsoft's attempt to make that a configuration problem rather than a people problem.

I covered the broader Arc family in [Azure Arc: Manage Resources Anywhere](/blog/2020-11-12-azure-arc-hybrid-cloud/). This post is narrower: how to use Arc to push one GitOps baseline to a mixed fleet, enforce it with Azure Policy, and where the preview stops short.

## What Arc enabled Kubernetes actually is (January 2021)

Connecting a cluster deploys a set of agents into an `azure-arc` namespace using Helm 3. They open an outbound HTTPS connection to Azure, and the cluster appears as a `Microsoft.Kubernetes/connectedClusters` resource with a resource ID, a managed identity, a resource group and tags. Nothing needs to reach into your cluster from outside, which is the detail that usually gets a network team to agree to it.

It works with any CNCF-certified distribution. The [overview documentation](https://learn.microsoft.com/azure/azure-arc/kubernetes/overview) names GKE, EKS and VMware vSphere as examples, and lists OpenShift 4.3, Rancher RKE 1.0.8, Charmed Kubernetes 1.18, AKS Engine and AKS on Azure Stack HCI among the distributions the Arc team has tested. What you get once connected is a short list:

| Capability | How it works in the preview |
|---|---|
| Inventory | Clusters are ARM resources, so tags, resource groups, RBAC on the Azure resource and Resource Graph queries all apply |
| GitOps | `sourceControlConfigurations` that deploy a managed Flux (v1) operator into the cluster |
| Governance | Azure Policy add-on (OPA Gatekeeper v3), installed with Helm, preview |
| Monitoring | Azure Monitor for containers, onboarded with a script, preview |

What it is not matters just as much. Arc does not upgrade, scale or patch your clusters. EKS is still managed through AWS, and your on-prem cluster is still your problem. Arc is a management plane, not a control plane. Don't connect AKS clusters running in Azure either: the docs are clear that AKS already has an Azure resource and gets Policy and Monitor natively. (AKS on Azure Stack HCI is different: the FAQ says to connect it.)

Two preview constraints I'd raise with any architect before a pilot. First, the service is only available in **East US** and **West Europe**, so the cluster metadata and configuration live in one of those regions. For Australian organisations with data residency commitments, that needs a conversation with whoever owns those commitments. Second, Microsoft's own documentation says the preview isn't recommended for production workloads. I'd treat it as something to pilot on non-production clusters now, ahead of general availability.

## Onboarding a cluster

You need [Azure CLI 2.15 or later](https://learn.microsoft.com/azure/azure-arc/kubernetes/quickstart-connect-cluster), Helm 3, a kubeconfig with cluster-admin on the target cluster, and an identity with the **Kubernetes Cluster - Azure Arc Onboarding** role. The CLI extensions are `connectedk8s` and `k8sconfiguration`.

```bash
az extension add --name connectedk8s
az extension add --name k8sconfiguration

az provider register --namespace Microsoft.Kubernetes
az provider register --namespace Microsoft.KubernetesConfiguration

# Registration is asynchronous; wait until both show "Registered"
az provider show -n Microsoft.Kubernetes -o table
az provider show -n Microsoft.KubernetesConfiguration -o table
```

Then connect the cluster, with the kubeconfig context pointing at it. Encode where the cluster runs in its name and tags from day one. Once you have twenty clusters in one resource group, tags are how you'll target policy, filter cost reports and answer "which of these are on AWS?"

```bash
RESOURCE_GROUP="rg-arc-k8s"
CLUSTER_NAME="eks-prod-useast1"
LOCATION="eastus"

az group create --name "$RESOURCE_GROUP" --location "$LOCATION"

az connectedk8s connect \
  --name "$CLUSTER_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --tags environment=production cloud=aws

az connectedk8s list --resource-group "$RESOURCE_GROUP" -o table
kubectl -n azure-arc get deployments
```

If the cluster sits behind an outbound proxy, `connectedk8s` 0.2.5 or later supports `--proxy-https`, `--proxy-http`, `--proxy-skip-range` and `--proxy-cert`. Note that the docs say this proxy setting currently applies to the Arc agents only, not to the Flux pods. If your Git server is only reachable through the proxy, test that before you promise anyone GitOps.

## GitOps with source control configurations

The GitOps model in Arc is a `sourceControlConfiguration`: an Azure resource attached to the cluster that says "run a Flux operator, point it at this repository and this path, with this scope". The `config-agent` in the cluster polls Azure for new or changed configurations every 30 seconds and deploys a Flux instance for each one. The operator is [Flux v1](https://github.com/fluxcd/flux), and Microsoft's [arc-k8s-demo repository](https://github.com/Azure/arc-k8s-demo) is a small working example to point your first configuration at.

That choice has a shelf life. Upstream put [Flux v1 into maintenance mode](https://github.com/fluxcd/flux) in October 2020 in favour of Flux v2, and Microsoft hasn't yet said when Arc will move to Flux v2. I'd keep the repository plain Kustomize so that the `.flux.yaml` shim described below is the only Flux v1-specific file you'd drop in a migration.

```bash
az k8sconfiguration create \
  --name platform-baseline \
  --cluster-name "$CLUSTER_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --cluster-type connectedClusters \
  --scope cluster \
  --operator-instance-name platform-baseline \
  --operator-namespace platform-baseline \
  --operator-params='--git-readonly --git-branch=main --git-path=clusters/eks-prod --manifest-generation=true --sync-garbage-collection' \
  --repository-url https://github.com/<your-org>/<your-platform-repo>

az k8sconfiguration show \
  --name platform-baseline \
  --cluster-name "$CLUSTER_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --cluster-type connectedClusters \
  --query complianceStatus
```

A few of those operator parameters deserve an explanation, because the defaults will catch you out:

- **`--git-branch=main`**. Flux v1 defaults to `master`. Most new repositories now default to `main`, and a mismatch shows up as a configuration that installs cleanly and then does nothing.
- **`--git-readonly`**. Flux v1 can write sync tags back to the repository. For a platform baseline I don't want the operator writing to Git, so I make that explicit.
- **`--sync-garbage-collection`**. Without it, deleting a manifest from Git leaves the resource running in the cluster. With it, Flux deletes what it created and no longer sees. I turn it on for the platform baseline because drift is the problem I'm solving. I'm more cautious for application repositories, where a bad merge could delete a production deployment.
- **`--scope cluster` vs `namespace`**. Cluster scope gives Flux cluster-admin. For application teams, create a separate configuration with `--scope namespace`, so each team's operator can only touch its own namespace. Multiple configurations on one cluster is the supported way to split platform and application ownership.

Most platform baseline repositories are private, and the docs support three ways in. With an SSH URL and no key, Flux generates a key pair: read `repositoryPublicKey` from `az k8sconfiguration show` and add it as a deploy key on the repository. Alternatively, supply your own key with `--ssh-private-key-file`, or use HTTPS with `--https-user` and `--https-key` (a personal access token). With the policy-driven approach below, every cluster generates its own Flux key that someone has to register, so a user-provided key or an HTTPS token scales better across a fleet.

If the configuration should deploy Helm charts, add `--enable-helm-operator` and `--helm-operator-params='--set helm.versions=v3'`. The Helm operator chart version defaults to 1.2.0.

## Structuring the repository for a fleet

The design goal is one shared base and a thin layer per cluster. A layout that works with Flux v1:

```text
platform-repo/
├── .flux.yaml
├── base/
│   ├── kustomization.yaml
│   ├── namespaces.yaml
│   └── network-policies.yaml
└── clusters/
    ├── eks-prod/
    │   └── kustomization.yaml
    ├── gke-dev/
    │   └── kustomization.yaml
    └── onprem-prod/
        └── kustomization.yaml
```

Flux v1 applies plain YAML by default. It doesn't run Kustomize unless manifest generation is on (the `--manifest-generation=true` parameter above) and it finds a `.flux.yaml` file in the `--git-path` directory or one of its parents. One file at the root covers every cluster folder:

```yaml
# .flux.yaml
version: 1
commandUpdated:
  generators:
    - command: kustomize build .
```

Each cluster folder then pulls in the base and adds only what's specific to that cluster:

```yaml
# clusters/eks-prod/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - ../../base
commonLabels:
  platform.example.com/cloud: aws
  platform.example.com/environment: production
```

The trade-off is that every cluster folder is a small amount of duplication you have to keep in sync. The alternative, one path for every cluster, is simpler until the first time one cloud needs a different storage class or ingress annotation. I'd take the per-cluster folder from the start.

## Applying the baseline to every cluster with Azure Policy

Running `az k8sconfiguration create` against each cluster by hand doesn't scale, and it quietly fails when someone connects a new cluster and forgets. Azure Policy has a built-in definition for this, [**Deploy GitOps to Kubernetes cluster**](https://learn.microsoft.com/azure/azure-arc/kubernetes/use-azure-policy), in the Kubernetes category. Assign it at a subscription or resource group, set the repository and operator parameters, and every connected cluster in that scope gets the `sourceControlConfiguration`.

```bash
az policy definition list \
  --query "[?displayName=='Deploy GitOps to Kubernetes cluster'].{name:name, category:metadata.category}" \
  -o table
```

That command finds the definition; the documented flow for the assignment itself is the Azure portal, where you pick the scope, fill in the configuration parameters, tick **Create a remediation task** and let it create the managed identity. I'd follow the portal flow for the first assignment and only script it once you've seen which parameters it asks for.

Two things to know. The policy uses a `deployIfNotExists` effect, so the assignment needs a managed identity with Contributor rights. And it only acts on new clusters automatically. Existing clusters need a remediation task, and the docs say it typically takes 10 to 20 minutes for the assignment to take effect. If you have separate repositories for the platform team and application teams, use one policy assignment per repository.

This is the piece that turns Arc from an inventory tool into a governance tool. The cluster is compliant when the configuration exists, and the Azure Policy compliance view shows you which clusters have drifted.

## Guardrails with the Azure Policy add-on

GitOps puts the baseline in place. It doesn't stop someone running a privileged container next to it. For that, the [Azure Policy for Kubernetes](https://learn.microsoft.com/azure/governance/policy/concepts/policy-for-kubernetes) add-on installs OPA Gatekeeper v3 and syncs policy assignments to the cluster. For Arc clusters it is in preview, needs Kubernetes 1.14 or later, supports Linux nodes and built-in definitions only, and is installed with Helm using a service principal that has the **Policy Insights Data Writer (Preview)** role on the cluster resource.

```bash
az provider register --namespace Microsoft.PolicyInsights

CLUSTER_ID=$(az connectedk8s show --name "$CLUSTER_NAME" --resource-group "$RESOURCE_GROUP" --query id -o tsv)

# Capture the credentials in variables so the secret never appears on a command line
SP_JSON=$(az ad sp create-for-rbac --role "Policy Insights Data Writer (Preview)" --scopes "$CLUSTER_ID")
SP_APP_ID=$(echo "$SP_JSON" | jq -r .appId)
SP_TENANT_ID=$(echo "$SP_JSON" | jq -r .tenant)
SP_SECRET_FILE=$(mktemp)
printf "%s" "$(echo "$SP_JSON" | jq -r .password)" > "$SP_SECRET_FILE"
unset SP_JSON

helm repo add azure-policy https://raw.githubusercontent.com/Azure/azure-policy/master/extensions/policy-addon-kubernetes/helm-charts

helm install azure-policy-addon azure-policy/azure-policy-addon-arc-clusters \
  --set azurepolicy.env.resourceid="$CLUSTER_ID" \
  --set azurepolicy.env.clientid="$SP_APP_ID" \
  --set-file azurepolicy.env.clientsecret="$SP_SECRET_FILE" \
  --set azurepolicy.env.tenantid="$SP_TENANT_ID"

rm -f "$SP_SECRET_FILE"
```

That service principal secret now lives in the cluster, and it will expire. Put its rotation in your runbook on the day you install it. Start every assignment with the `audit` effect, and only move to `deny` once the compliance report is clean.

Monitoring follows the same preview pattern. Azure Monitor for containers is onboarded with the `enable-monitoring.sh` script against the cluster's resource ID and a Log Analytics workspace. Live Data isn't supported for Arc clusters yet.

## Where I'd draw the line

Arc enabled Kubernetes is worth piloting now if you already have clusters in more than one place and Azure is where your identity, policy and monitoring already live. The combination of a GitOps policy assignment and a per-cluster repository folder is the most useful thing in the preview. It turns "please configure your cluster like this" into a compliance report.

I wouldn't use it yet for production clusters that hold regulated data, given the region list and the preview status. I also wouldn't use it as a reason to standardise on Azure tooling if your platform team already runs Flux or Argo CD well across clouds. Arc adds a resource model and policy on top of GitOps. It doesn't replace the GitOps engine. And if all your clusters are AKS, you don't need Arc for Kubernetes at all.

My rule of thumb: connect the clusters, prove the policy-driven baseline on non-production, and keep application deployments in namespace-scoped configurations owned by the teams that ship them.
