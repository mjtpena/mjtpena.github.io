---
title: "Seccomp by Default: Kubernetes Container Security"
description: "Seccomp (Secure Computing Mode) limits which system calls a process can make, reducing the attack surface."
author: Michael John Peña
draft: false
date: 2022-06-06
tags:
  - Kubernetes
  - Security
  - seccomp
  - Containers
---

## Understanding Seccomp

Seccomp (Secure Computing Mode) limits which system calls a process can make, reducing the attack surface.

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: secure-pod
spec:
  securityContext:
    seccompProfile:
      type: RuntimeDefault  # Now default in 1.24
  containers:
  - name: app
    image: nginx
```

## Profile Types

```yaml
# RuntimeDefault - uses container runtime's default profile
seccompProfile:
  type: RuntimeDefault

# Localhost - custom profile from node
seccompProfile:
  type: Localhost
  localhostProfile: profiles/audit.json

# Unconfined - no restrictions (not recommended)
seccompProfile:
  type: Unconfined
```

## Custom Seccomp Profiles

```json
{
  "defaultAction": "SCMP_ACT_ERRNO",
  "architectures": ["SCMP_ARCH_X86_64"],
  "syscalls": [
    {
      "names": ["read", "write", "exit", "exit_group", "mmap", "close"],
      "action": "SCMP_ACT_ALLOW"
    }
  ]
}
```

Deploy custom profile:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: custom-seccomp
spec:
  securityContext:
    seccompProfile:
      type: Localhost
      localhostProfile: my-profile.json
  containers:
  - name: app
    image: myapp
```

## Auditing System Calls

Create an audit profile to discover required syscalls:

```json
{
  "defaultAction": "SCMP_ACT_LOG",
  "architectures": ["SCMP_ARCH_X86_64"]
}
```

Check audit logs:

```bash
# View seccomp violations
journalctl -k | grep "seccomp"
dmesg | grep "seccomp"
```

## Summary

Seccomp profiles restrict system calls, limiting container capabilities and reducing security risks. The default profile in Kubernetes 1.24 provides baseline protection.
