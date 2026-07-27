---
title: "Sandboxing AI Agents: Isolation and Containment Strategies"
author: "Michael John Peña"
draft: false
date: 2024-10-08
tags: ["Sandboxing", "AI Agents", "Security", "Containers", "Isolation"]

---

I wrote "Sandboxing AI Agents: Isolation and Containment Strategies" to share practical, production-minded guidance on this topic.

## Sandboxing Fundamentals

```python
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Dict, List, Any, Optional
import subprocess
import tempfile
import os

@dataclass
class SandboxConfig:
    """Configuration for agent sandbox"""
    max_memory_mb: int = 512
    max_cpu_percent: float = 50.0
    max_execution_time_seconds: int = 60
    allowed_network: bool = False
    allowed_filesystem_paths: List[str] = None
    allowed_commands: List[str] = None
    environment_variables: Dict[str, str] = None

class Sandbox(ABC):
    """Abstract base for sandbox implementations"""

    def __init__(self, config: SandboxConfig):
        self.config = config

    @abstractmethod
    def execute(self, code: str) -> Dict[str, Any]:
        """Execute code in sandbox"""
        pass

    @abstractmethod
    def cleanup(self):
        """Clean up sandbox resources"""
        pass

class ProcessSandbox(Sandbox):
    """Sandbox using subprocess with restrictions"""

    def execute(self, code: str) -> Dict[str, Any]:
        """Execute Python code in isolated subprocess"""

        # Create temporary file for code
        with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False) as f:
            f.write(code)
            code_file = f.name

        try:
            # Build command with resource limits
            cmd = self._build_command(code_file)

            # Execute with timeout
            result = subprocess.run(
                cmd,
                capture_output=True,
                timeout=self.config.max_execution_time_seconds,
                text=True,
                env=self._build_environment()
            )

            return {
                "success": result.returncode == 0,
                "stdout": result.stdout,
                "stderr": result.stderr,
                "return_code": result.returncode
            }

        except subprocess.TimeoutExpired:
            return {
                "success": False,
                "error": "Execution timeout exceeded",
                "timeout": True
            }

        finally:
            os.unlink(code_file)

    def _build_command(self, code_file: str) -> List[str]:
        """Build execution command with limits"""
        import sys

        # Basic Python execution
        cmd = [sys.executable, code_file]

        # On Linux, use cgroups for resource limits
        if os.name == 'posix':
            # Memory limit
            cmd = ['systemd-run', '--scope', '-p',
                   f'MemoryMax={self.config.max_memory_mb}M'] + cmd

        return cmd

    def _build_environment(self) -> Dict[str, str]:
        """Build restricted environment"""
        env = os.environ.copy()

        # Remove sensitive variables
        sensitive = ['AWS_SECRET', 'API_KEY', 'PASSWORD', 'TOKEN']
        for key in list(env.keys()):
            if any(s in key.upper() for s in sensitive):
                del env[key]

        # Add custom variables
        if self.config.environment_variables:
            env.update(self.config.environment_variables)

        return env

    def cleanup(self):
        pass
```

## Docker-Based Sandboxing

```python
import docker
from docker.types import Mount
import json

class DockerSandbox(Sandbox):
    """Sandbox using Docker containers"""

    def __init__(self, config: SandboxConfig, image: str = "python:3.11-slim"):
        super().__init__(config)
        self.image = image
        self.client = docker.from_env()
        self.container = None

    def execute(self, code: str) -> Dict[str, Any]:
        """Execute code in Docker container"""

        try:
            # Create container
            self.container = self.client.containers.run(
                self.image,
                command=["python", "-c", code],
                detach=True,
                mem_limit=f"{self.config.max_memory_mb}m",
                cpu_period=100000,
                cpu_quota=int(self.config.max_cpu_percent * 1000),
                network_mode="none" if not self.config.allowed_network else "bridge",
                read_only=True,
                security_opt=["no-new-privileges"],
                cap_drop=["ALL"],
                mounts=self._build_mounts()
            )

            # Wait for completion
            result = self.container.wait(
                timeout=self.config.max_execution_time_seconds
            )

            # Get output
            stdout = self.container.logs(stdout=True, stderr=False).decode()
            stderr = self.container.logs(stdout=False, stderr=True).decode()

            return {
                "success": result["StatusCode"] == 0,
                "stdout": stdout,
                "stderr": stderr,
                "return_code": result["StatusCode"]
            }

        except docker.errors.APIError as e:
            return {
                "success": False,
                "error": str(e)
            }

        finally:
            self.cleanup()

    def _build_mounts(self) -> List[Mount]:
        """Build allowed filesystem mounts"""
        mounts = []

        if self.config.allowed_filesystem_paths:
            for path in self.config.allowed_filesystem_paths:
                mounts.append(Mount(
                    target=path,
                    source=path,
                    type="bind",
                    read_only=True
                ))

        return mounts

    def cleanup(self):
        """Remove container"""
        if self.container:
            try:
                self.container.remove(force=True)
            except:
                pass
            self.container = None
```

## Network Isolation

```python
from dataclasses import dataclass
from typing import Set
import socket

@dataclass
class NetworkPolicy:
    """Network access policy"""
    allow_outbound: bool = False
    allowed_hosts: Set[str] = None
    allowed_ports: Set[int] = None
    blocked_hosts: Set[str] = None
    max_connections: int = 10

class NetworkSandbox:
    """Control network access for agents"""

    def __init__(self, policy: NetworkPolicy):
        self.policy = policy
        self.active_connections = 0

    def check_connection(self, host: str, port: int) -> bool:
        """Check if connection is allowed"""

        if not self.policy.allow_outbound:
            return False

        # Check against blocked hosts
        if self.policy.blocked_hosts:
            if host in self.policy.blocked_hosts:
                return False

            # Also check IP addresses
            try:
                ip = socket.gethostbyname(host)
                if ip in self.policy.blocked_hosts:
                    return False
            except:
                pass

        # Check allowed hosts
        if self.policy.allowed_hosts:
            if host not in self.policy.allowed_hosts:
                return False

        # Check allowed ports
        if self.policy.allowed_ports:
            if port not in self.policy.allowed_ports:
                return False

        # Check connection limit
        if self.active_connections >= self.policy.max_connections:
            return False

        return True

    def open_connection(self, host: str, port: int):
        """Track connection opening"""
        if self.check_connection(host, port):
            self.active_connections += 1
            return True
        return False

    def close_connection(self):
        """Track connection closing"""
        if self.active_connections > 0:
            self.active_connections -= 1

class ProxiedNetworkSandbox(NetworkSandbox):
    """Network sandbox with proxy for logging"""

    def __init__(self, policy: NetworkPolicy, proxy_port: int = 8080):
        super().__init__(policy)
        self.proxy_port = proxy_port
        self.request_log = []

    def log_request(self, method: str, url: str, response_status: int):
        """Log network request"""
        self.request_log.append({
            "timestamp": time.time(),
            "method": method,
            "url": url,
            "status": response_status
        })

    def get_request_summary(self) -> Dict:
        """Get summary of network requests"""
        return {
            "total_requests": len(self.request_log),
            "by_method": self._count_by_field("method"),
            "by_status": self._count_by_field("status"),
            "recent": self.request_log[-10:]
        }

    def _count_by_field(self, field: str) -> Dict:
        counts = {}
        for req in self.request_log:
            value = str(req.get(field))
            counts[value] = counts.get(value, 0) + 1
        return counts
```

## Filesystem Sandboxing

```python
import os
import shutil
from pathlib import Path

class FilesystemSandbox:
    """Sandbox filesystem access"""

    def __init__(self, base_path: str = None, max_size_mb: int = 100):
        self.base_path = Path(base_path or tempfile.mkdtemp())
        self.max_size_mb = max_size_mb
        self.total_written = 0

    def get_path(self, relative_path: str) -> Path:
        """Get sandboxed path"""
        # Prevent path traversal
        clean_path = Path(relative_path).resolve()
        full_path = (self.base_path / relative_path).resolve()

        if not str(full_path).startswith(str(self.base_path)):
            raise SecurityError(f"Path traversal attempt: {relative_path}")

        return full_path

    def read_file(self, path: str) -> str:
        """Read file from sandbox"""
        full_path = self.get_path(path)

        if not full_path.exists():
            raise FileNotFoundError(path)

        return full_path.read_text()

    def write_file(self, path: str, content: str) -> bool:
        """Write file to sandbox"""
        full_path = self.get_path(path)

        # Check size limit
        new_size = len(content.encode())
        if (self.total_written + new_size) / (1024 * 1024) > self.max_size_mb:
            raise ResourceExhaustedError("Filesystem quota exceeded")

        # Create parent directories
        full_path.parent.mkdir(parents=True, exist_ok=True)

        # Write file
        full_path.write_text(content)
        self.total_written += new_size

        return True

    def list_directory(self, path: str = ".") -> List[str]:
        """List directory contents"""
        full_path = self.get_path(path)

        if not full_path.is_dir():
            raise NotADirectoryError(path)

        return [p.name for p in full_path.iterdir()]

    def delete_file(self, path: str) -> bool:
        """Delete file from sandbox"""
        full_path = self.get_path(path)

        if not full_path.exists():
            return False

        if full_path.is_dir():
            shutil.rmtree(full_path)
        else:
            full_path.unlink()

        return True

    def cleanup(self):
        """Clean up sandbox directory"""
        if self.base_path.exists():
            shutil.rmtree(self.base_path)

class SecurityError(Exception):
    pass

class ResourceExhaustedError(Exception):
    pass
```

## Integrated Sandbox Manager

```python
class SandboxManager:
    """Manage complete agent sandboxing"""

    def __init__(self, config: SandboxConfig):
        self.config = config
        self.process_sandbox = ProcessSandbox(config)
        self.network_sandbox = NetworkSandbox(NetworkPolicy(
            allow_outbound=config.allowed_network
        ))
        self.filesystem_sandbox = FilesystemSandbox()

    def create_agent_environment(self, agent_id: str) -> Dict:
        """Create isolated environment for an agent"""

        # Create dedicated filesystem area
        agent_fs = FilesystemSandbox(
            base_path=f"/tmp/agent_{agent_id}",
            max_size_mb=self.config.max_memory_mb
        )

        return {
            "agent_id": agent_id,
            "filesystem": agent_fs,
            "working_directory": str(agent_fs.base_path)
        }

    def execute_in_sandbox(self, agent_id: str, code: str,
                          network_required: bool = False) -> Dict:
        """Execute code in sandboxed environment"""

        if network_required and not self.config.allowed_network:
            return {
                "success": False,
                "error": "Network access not allowed"
            }

        return self.process_sandbox.execute(code)

    def cleanup_agent(self, agent_id: str):
        """Clean up agent resources"""
        self.filesystem_sandbox.cleanup()
        self.process_sandbox.cleanup()
```

Sandboxing is your last line of defense. Even trusted agents can behave unexpectedly - proper isolation ensures that unexpected behavior doesn't become a catastrophe.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
