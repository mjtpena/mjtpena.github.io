---
title: "Batch Processing AI Workloads with Azure Batch and OpenAI"
author: Michael John Peña
draft: false
date: 2025-10-30
tags:
  - Azure Batch
  - Batch Processing
  - Azure OpenAI
  - Scalability
  - Data Processing

---

I wrote "Batch Processing AI Workloads with Azure Batch and OpenAI" to share practical, production-minded guidance on this topic.

## Designing a Batch AI Pipeline

Create a scalable batch processing architecture:

```python
from azure.batch import BatchServiceClient
from azure.batch.models import (
    PoolAddParameter, VirtualMachineConfiguration, ImageReference,
    TaskAddParameter, JobAddParameter, ResourceFile, OutputFile
)
from azure.identity import DefaultAzureCredential
import json

class BatchAIProcessor:
    def __init__(self, batch_account_url: str, storage_connection: str):
        self.batch_client = BatchServiceClient(
            credential=DefaultAzureCredential(),
            batch_url=batch_account_url
        )
        self.storage_connection = storage_connection

    def create_processing_pool(self, pool_id: str, node_count: int = 10):
        """Create a pool of VMs for AI processing."""

        pool = PoolAddParameter(
            id=pool_id,
            vm_size="Standard_D4s_v3",
            virtual_machine_configuration=VirtualMachineConfiguration(
                image_reference=ImageReference(
                    publisher="microsoft-azure-batch",
                    offer="ubuntu-server-container",
                    sku="20-04-lts",
                    version="latest"
                ),
                node_agent_sku_id="batch.node.ubuntu 20.04"
            ),
            target_dedicated_nodes=node_count,
            start_task={
                "command_line": "/bin/bash -c 'pip install openai azure-storage-blob'",
                "wait_for_success": True,
                "user_identity": {"auto_user": {"elevation_level": "admin"}}
            }
        )

        self.batch_client.pool.add(pool)

    def submit_processing_job(
        self,
        job_id: str,
        pool_id: str,
        input_files: list[str],
        processing_script: str
    ):
        """Submit a batch job with AI processing tasks."""

        # Create job
        job = JobAddParameter(
            id=job_id,
            pool_info={"pool_id": pool_id}
        )
        self.batch_client.job.add(job)

        # Create tasks for each input file
        tasks = []
        for i, input_file in enumerate(input_files):
            task = TaskAddParameter(
                id=f"task_{i}",
                command_line=f"python process.py --input {input_file}",
                resource_files=[
                    ResourceFile(
                        auto_storage_container_name="scripts",
                        blob_prefix="process.py"
                    ),
                    ResourceFile(
                        auto_storage_container_name="inputs",
                        blob_prefix=input_file
                    )
                ],
                output_files=[
                    OutputFile(
                        file_pattern="output_*.json",
                        destination={"container": {"container_url": self.storage_connection}},
                        upload_options={"upload_condition": "taskSuccess"}
                    )
                ],
                environment_settings=[
                    {"name": "AZURE_OPENAI_ENDPOINT", "value": "$(OPENAI_ENDPOINT)"},
                    {"name": "AZURE_OPENAI_KEY", "value": "$(OPENAI_KEY)"}
                ]
            )
            tasks.append(task)

        self.batch_client.task.add_collection(job_id, tasks)
```

## Rate-Limited AI Processing

Handle API rate limits gracefully:

```python
import asyncio
from openai import AzureOpenAI
from typing import List
import json

class RateLimitedProcessor:
    def __init__(self, client: AzureOpenAI, requests_per_minute: int = 60):
        self.client = client
        self.rpm = requests_per_minute
        self.semaphore = asyncio.Semaphore(requests_per_minute)

    async def process_batch(self, items: List[dict], prompt_template: str) -> List[dict]:
        """Process items with rate limiting."""

        async def process_item(item: dict) -> dict:
            async with self.semaphore:
                prompt = prompt_template.format(**item)

                response = self.client.chat.completions.create(
                    model="gpt-4",
                    messages=[{"role": "user", "content": prompt}]
                )

                await asyncio.sleep(60 / self.rpm)  # Rate limit spacing

                return {
                    "input_id": item.get("id"),
                    "result": response.choices[0].message.content
                }

        tasks = [process_item(item) for item in items]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        return [r for r in results if not isinstance(r, Exception)]

    def process_file(self, input_path: str, output_path: str, prompt_template: str):
        """Process a file of items."""

        with open(input_path) as f:
            items = json.load(f)

        results = asyncio.run(self.process_batch(items, prompt_template))

        with open(output_path, 'w') as f:
            json.dump(results, f)
```

## Monitoring Batch Progress

Track job progress and handle failures with proper retry logic for robust batch AI processing at scale.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
