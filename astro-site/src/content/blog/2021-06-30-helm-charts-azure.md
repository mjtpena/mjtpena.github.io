---
title: Helm Charts for Azure Kubernetes Service
author: Michael John Peña
draft: false
date: 2021-06-30
url: /blog/helm-charts-azure/
tags:
  - Azure
  - Kubernetes
  - Helm
  - AKS

---

I wrote "2021-06-30-helm-charts-azure" to share practical, production-minded guidance on this topic.

## Chart Structure

```
myapp/
├── Chart.yaml
├── values.yaml
├── values-dev.yaml
├── values-prod.yaml
├── templates/
│   ├── _helpers.tpl
│   ├── deployment.yaml
│   ├── service.yaml
│   ├── ingress.yaml
│   ├── hpa.yaml
│   ├── serviceaccount.yaml
│   ├── configmap.yaml
│   ├── secret.yaml
│   ├── pdb.yaml
│   └── tests/
│       └── test-connection.yaml
└── charts/
```

## Chart.yaml

```yaml
apiVersion: v2
name: myapp
description: A Helm chart for deploying my application to AKS
type: application
version: 1.0.0
appVersion: "1.0.0"
keywords:
  - dotnet
  - api
  - azure
maintainers:
  - name: Platform Team
    email: platform@company.com
dependencies:
  - name: redis
    version: "17.x.x"
    repository: "https://charts.bitnami.com/bitnami"
    condition: redis.enabled
```

## Values Configuration

### values.yaml (Default)

```yaml
# Default values for myapp
replicaCount: 2

  repository: myacr.azurecr.io/myapp
  pullPolicy: IfNotPresent
  tag: ""  # Overridden by appVersion

imagePullSecrets: []
nameOverride: ""
fullnameOverride: ""

serviceAccount:
  create: true
  annotations:
    azure.workload.identity/client-id: ""
  name: ""

podAnnotations:
  prometheus.io/scrape: "true"
  prometheus.io/port: "80"
  prometheus.io/path: "/metrics"

podSecurityContext:
  fsGroup: 1000

securityContext:
  runAsNonRoot: true
  runAsUser: 1000
  capabilities:
    drop:
      - ALL
  readOnlyRootFilesystem: true

service:
  type: ClusterIP
  port: 80

ingress:
  enabled: true
  className: "nginx"
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
  hosts:
    - host: api.myapp.com
      paths:
        - path: /
          pathType: Prefix
  tls:
    - secretName: api-tls
      hosts:
        - api.myapp.com

resources:
  limits:
    cpu: 500m
    memory: 512Mi
  requests:
    cpu: 100m
    memory: 128Mi

autoscaling:
  enabled: true
  minReplicas: 2
  maxReplicas: 10
  targetCPUUtilizationPercentage: 70
  targetMemoryUtilizationPercentage: 80

nodeSelector:
  kubernetes.io/os: linux

tolerations: []

affinity:
  podAntiAffinity:
    preferredDuringSchedulingIgnoredDuringExecution:
      - weight: 100
        podAffinityTerm:
          labelSelector:
            matchExpressions:
              - key: app.kubernetes.io/name
                operator: In
                values:
                  - myapp
          topologyKey: topology.kubernetes.io/zone

# Azure-specific configuration
azure:
  keyVault:
    enabled: true
    name: kv-myapp-prod
    tenantId: ""
    secrets:
      - secretName: connection-string
        keyVaultKey: DatabaseConnectionString
      - secretName: api-key
        keyVaultKey: ExternalApiKey

  appInsights:
    enabled: true
    connectionString: ""

  managedIdentity:
    enabled: true
    clientId: ""

# Application configuration
config:
  aspnetcoreEnvironment: Production
  logLevel: Information

# Feature flags
features:
  enableSwagger: false
  enableHealthUI: true

# Redis subchart configuration
redis:
  enabled: true
  architecture: standalone
  auth:
    enabled: true
    existingSecret: redis-secret
```

### values-prod.yaml

```yaml
replicaCount: 3

resources:
  limits:
    cpu: 1000m
    memory: 1Gi
  requests:
    cpu: 250m
    memory: 256Mi

autoscaling:
  minReplicas: 3
  maxReplicas: 20

ingress:
  hosts:
    - host: api.myapp.com
      paths:
        - path: /
          pathType: Prefix

azure:
  keyVault:
    name: kv-myapp-prod
  managedIdentity:
    clientId: "prod-client-id"

config:
  aspnetcoreEnvironment: Production
  logLevel: Warning

features:
  enableSwagger: false
```

## Template Files

### _helpers.tpl

```yaml
{{/*
Expand the name of the chart.
*/}}
{{- define "myapp.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "myapp.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "myapp.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "myapp.labels" -}}
helm.sh/chart: {{ include "myapp.chart" . }}
{{ include "myapp.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "myapp.selectorLabels" -}}
app.kubernetes.io/name: {{ include "myapp.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "myapp.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "myapp.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}
```

### deployment.yaml

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "myapp.fullname" . }}
  labels:
    {{- include "myapp.labels" . | nindent 4 }}
spec:
  {{- if not .Values.autoscaling.enabled }}
  replicas: {{ .Values.replicaCount }}
  {{- end }}
  selector:
    matchLabels:
      {{- include "myapp.selectorLabels" . | nindent 6 }}
  template:
    metadata:
      annotations:
        checksum/config: {{ include (print $.Template.BasePath "/configmap.yaml") . | sha256sum }}
        {{- with .Values.podAnnotations }}
        {{- toYaml . | nindent 8 }}
        {{- end }}
      labels:
        {{- include "myapp.selectorLabels" . | nindent 8 }}
        {{- if .Values.azure.managedIdentity.enabled }}
        azure.workload.identity/use: "true"
        {{- end }}
    spec:
      {{- with .Values.imagePullSecrets }}
      imagePullSecrets:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      serviceAccountName: {{ include "myapp.serviceAccountName" . }}
      securityContext:
        {{- toYaml .Values.podSecurityContext | nindent 8 }}
      containers:
        - name: {{ .Chart.Name }}
          securityContext:
            {{- toYaml .Values.securityContext | nindent 12 }}
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag | default .Chart.AppVersion }}"
          imagePullPolicy: {{ .Values.image.pullPolicy }}
          ports:
            - name: http
              containerPort: 80
              protocol: TCP
          env:
            - name: ASPNETCORE_ENVIRONMENT
              value: {{ .Values.config.aspnetcoreEnvironment | quote }}
            - name: Logging__LogLevel__Default
              value: {{ .Values.config.logLevel | quote }}
            {{- if .Values.azure.appInsights.enabled }}
            - name: APPLICATIONINSIGHTS_CONNECTION_STRING
              valueFrom:
                secretKeyRef:
                  name: {{ include "myapp.fullname" . }}-secrets
                  key: appinsights-connection-string
            {{- end }}
            {{- if .Values.redis.enabled }}
            - name: Redis__ConnectionString
              valueFrom:
                secretKeyRef:
                  name: redis-secret
                  key: redis-password
            {{- end }}
          envFrom:
            - configMapRef:
                name: {{ include "myapp.fullname" . }}-config
          {{- if .Values.azure.keyVault.enabled }}
          volumeMounts:
            - name: secrets-store
              mountPath: "/mnt/secrets-store"
              readOnly: true
          {{- end }}
          livenessProbe:
            httpGet:
              path: /health/live
              port: http
            initialDelaySeconds: 30
            periodSeconds: 10
            timeoutSeconds: 5
            failureThreshold: 3
          readinessProbe:
            httpGet:
              path: /health/ready
              port: http
            initialDelaySeconds: 5
            periodSeconds: 5
            timeoutSeconds: 3
            failureThreshold: 3
          resources:
            {{- toYaml .Values.resources | nindent 12 }}
      {{- if .Values.azure.keyVault.enabled }}
      volumes:
        - name: secrets-store
          csi:
            driver: secrets-store.csi.k8s.io
            readOnly: true
            volumeAttributes:
              secretProviderClass: {{ include "myapp.fullname" . }}-secrets
      {{- end }}
      {{- with .Values.nodeSelector }}
      nodeSelector:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      {{- with .Values.affinity }}
      affinity:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      {{- with .Values.tolerations }}
      tolerations:
        {{- toYaml . | nindent 8 }}
      {{- end }}
```

### secretproviderclass.yaml (Key Vault Integration)

```yaml
{{- if .Values.azure.keyVault.enabled }}
apiVersion: secrets-store.csi.x-k8s.io/v1
kind: SecretProviderClass
metadata:
  name: {{ include "myapp.fullname" . }}-secrets
  labels:
    {{- include "myapp.labels" . | nindent 4 }}
spec:
  provider: azure
  parameters:
    usePodIdentity: "false"
    useVMManagedIdentity: "false"
    clientID: {{ .Values.azure.managedIdentity.clientId | quote }}
    keyvaultName: {{ .Values.azure.keyVault.name | quote }}
    tenantId: {{ .Values.azure.keyVault.tenantId | quote }}
    objects: |
      array:
        {{- range .Values.azure.keyVault.secrets }}
        - |
          objectName: {{ .keyVaultKey }}
          objectType: secret
        {{- end }}
  secretObjects:
    - secretName: {{ include "myapp.fullname" . }}-kv-secrets
      type: Opaque
      data:
        {{- range .Values.azure.keyVault.secrets }}
        - objectName: {{ .keyVaultKey }}
          key: {{ .secretName }}
        {{- end }}
{{- end }}
```

### hpa.yaml

```yaml
{{- if .Values.autoscaling.enabled }}
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: {{ include "myapp.fullname" . }}
  labels:
    {{- include "myapp.labels" . | nindent 4 }}
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: {{ include "myapp.fullname" . }}
  minReplicas: {{ .Values.autoscaling.minReplicas }}
  maxReplicas: {{ .Values.autoscaling.maxReplicas }}
  metrics:
    {{- if .Values.autoscaling.targetCPUUtilizationPercentage }}
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: {{ .Values.autoscaling.targetCPUUtilizationPercentage }}
    {{- end }}
    {{- if .Values.autoscaling.targetMemoryUtilizationPercentage }}
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: {{ .Values.autoscaling.targetMemoryUtilizationPercentage }}
    {{- end }}
{{- end }}
```

## Deployment Commands

```bash
# Add Helm repo for dependencies
helm dependency update ./myapp

# Install to development
helm install myapp ./myapp \
  --namespace dev \
  --create-namespace \
  -f ./myapp/values-dev.yaml \
  --set image.tag=1.0.0

# Upgrade production
helm upgrade myapp ./myapp \
  --namespace prod \
  -f ./myapp/values-prod.yaml \
  --set image.tag=1.0.1 \
  --atomic \
  --timeout 10m

# Rollback if needed
helm rollback myapp 1 --namespace prod

# Template for debugging
helm template myapp ./myapp -f ./myapp/values-prod.yaml > output.yaml
```

## Azure DevOps Pipeline

```yaml
trigger:
  - main

variables:
  chartPath: './charts/myapp'
  acrName: 'myacr'
  aksClusterName: 'aks-prod'
  aksResourceGroup: 'rg-aks-prod'

stages:
  - stage: Build
    jobs:
      - job: BuildAndPush
        steps:
          - task: Docker@2
            inputs:
              containerRegistry: 'ACR'
              repository: 'myapp'
              command: 'buildAndPush'
              Dockerfile: '**/Dockerfile'
              tags: '$(Build.BuildId)'

  - stage: Deploy
    jobs:
      - deployment: DeployToAKS
        environment: 'production'
        strategy:
          runOnce:
            deploy:
              steps:
                - task: HelmDeploy@0
                  inputs:
                    connectionType: 'Azure Resource Manager'
                    azureSubscription: 'Azure-Prod'
                    azureResourceGroup: '$(aksResourceGroup)'
                    kubernetesCluster: '$(aksClusterName)'
                    namespace: 'prod'
                    command: 'upgrade'
                    chartType: 'FilePath'
                    chartPath: '$(chartPath)'
                    releaseName: 'myapp'
                    valueFile: '$(chartPath)/values-prod.yaml'
                    overrideValues: 'image.tag=$(Build.BuildId)'
                    arguments: '--atomic --timeout 10m'
```

## Conclusion

Helm charts provide a powerful way to package and deploy applications to AKS with Azure-specific integrations. By leveraging values files for environment-specific configurations, Azure Key Vault for secrets, and managed identities for authentication, you create secure, maintainable deployments. Combined with CI/CD pipelines, Helm enables reliable, repeatable deployments across environments.

## References

- [Helm Documentation](https://helm.sh/docs/)
- [AKS Helm Best Practices](https://docs.microsoft.com/en-us/azure/aks/kubernetes-helm)

