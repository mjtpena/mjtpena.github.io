---
title: "Kubernetes 1.24 Features: Deep Dive into New Capabilities"
author: Michael John Peña
draft: false
date: 2022-06-02
tags:
  - Kubernetes
  - Containers
  - DevOps
  - Cloud
---

## Non-Graceful Node Shutdown

Handle node failures gracefully:

```yaml
apiVersion: v1
kind: Node
metadata:
  name: worker-1
  labels:
    node.kubernetes.io/out-of-service: nodeshutdown
```

Configure node shutdown behavior:

```yaml
# kubelet configuration
apiVersion: kubelet.config.k8s.io/v1beta1
kind: KubeletConfiguration
shutdownGracePeriod: 60s
shutdownGracePeriodCriticalPods: 20s
```

## Service Internal Traffic Policy

Control traffic routing for services:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: my-service
spec:
  selector:
    app: myapp
  ports:
  - port: 80
    targetPort: 8080
  # Route traffic only to local node endpoints
  internalTrafficPolicy: Local
```

## IndexedJob Completion

Track batch job progress:

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: indexed-job
spec:
  completions: 10
  parallelism: 3
  completionMode: Indexed
  template:
    spec:
      restartPolicy: Never
      containers:
      - name: worker
        image: busybox
        command:
        - /bin/sh
        - -c
        - |
          echo "Processing index $JOB_COMPLETION_INDEX"
          # Each pod gets unique index 0-9
          process_item $JOB_COMPLETION_INDEX
```

## Server-Side Field Validation

Stricter API validation:

```bash
# Enable strict validation
kubectl apply --validate=strict -f deployment.yaml

# Server-side validation rejects unknown fields
kubectl apply -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: test
spec:
  unknownField: "will be rejected"  # Error!
  replicas: 1
  selector:
    matchLabels:
      app: test
  template:
    metadata:
      labels:
        app: test
    spec:
      containers:
      - name: nginx
        image: nginx
EOF
```

## OpenAPI v3 Support

Access OpenAPI v3 schemas:

```bash
# Get OpenAPI v3 spec
kubectl get --raw /openapi/v3

# Get specific API group
kubectl get --raw /openapi/v3/apis/apps/v1
```

## gRPC Health Probes

Native gRPC health checks:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: grpc-service
spec:
  containers:
  - name: grpc
    image: mygrpc:latest
    ports:
    - containerPort: 50051
    livenessProbe:
      grpc:
        port: 50051
        service: "my.health.v1.Health"
      initialDelaySeconds: 10
      periodSeconds: 10
    readinessProbe:
      grpc:
        port: 50051
      initialDelaySeconds: 5
      periodSeconds: 5
```

Implement gRPC health check:

```go
package main

import (
    "context"
    "log"
    "net"

    "google.golang.org/grpc"
    "google.golang.org/grpc/health"
    "google.golang.org/grpc/health/grpc_health_v1"
)

func main() {
    lis, err := net.Listen("tcp", ":50051")
    if err != nil {
        log.Fatalf("Failed to listen: %v", err)
    }

    s := grpc.NewServer()

    // Register health check service
    healthServer := health.NewServer()
    grpc_health_v1.RegisterHealthServer(s, healthServer)

    // Set service status
    healthServer.SetServingStatus("my.health.v1.Health", grpc_health_v1.HealthCheckResponse_SERVING)

    // Register your services
    // pb.RegisterMyServiceServer(s, &myService{})

    log.Printf("Server listening at %v", lis.Addr())
    if err := s.Serve(lis); err != nil {
        log.Fatalf("Failed to serve: %v", err)
    }
}
```

## Container Resource Metrics API

Access container metrics:

```go
package main

import (
    "context"
    "fmt"

    metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
    "k8s.io/client-go/kubernetes"
    "k8s.io/metrics/pkg/client/clientset/versioned"
)

func getContainerMetrics(clientset *kubernetes.Clientset, metricsClient *versioned.Clientset) {
    // Get pod metrics
    podMetrics, err := metricsClient.MetricsV1beta1().
        PodMetricses("default").
        Get(context.TODO(), "my-pod", metav1.GetOptions{})

    if err != nil {
        panic(err)
    }

    for _, container := range podMetrics.Containers {
        fmt.Printf("Container: %s\n", container.Name)
        fmt.Printf("  CPU: %s\n", container.Usage.Cpu().String())
        fmt.Printf("  Memory: %s\n", container.Usage.Memory().String())
    }
}
```

## VolumeSnapshot Improvements

Enhanced snapshot management:

```yaml
apiVersion: snapshot.storage.k8s.io/v1
kind: VolumeSnapshot
metadata:
  name: my-snapshot
spec:
  volumeSnapshotClassName: azure-disk-snapshot
  source:
    persistentVolumeClaimName: my-pvc
```
