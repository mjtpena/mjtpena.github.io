---
title: "Llama 2 on Azure: Meta's Open-Source Models in Production"
description: "Llama 2 on Azure arrived through the Azure Model Catalog as a managed deployment option, making Meta's open-source family — 7B, 13B, 70B, and their Chat…"
author: "Michael John Peña"
draft: false
date: 2023-11-21
tags: ["Azure", "Llama 2", "Meta", "AI", "Open Source"]
---

Llama 2 on Azure arrived through the Azure Model Catalog as a managed deployment option, making Meta's open-source family — 7B, 13B, 70B, and their Chat variants — accessible through Azure's deployment infrastructure with VNET integration, RBAC, and managed compute rather than requiring you to provision your own GPU VMs and manage the model serving stack. The Llama 2 licensing situation is worth understanding: the model is available under Meta's custom Llama 2 Community Licence, which is open for most uses but has restrictions for organisations with more than 700 million monthly active users and requires a request from Meta if you're in that category. For enterprise use cases, the licence terms are permissive enough; the compliance concern for regulated industries is more about data handling during inference than the licence itself. The 70B Chat model offers the strongest capability; 7B Chat is the practical choice for latency-sensitive applications where inference speed matters more than maximum quality.

## Llama 2 Model Family

```python
from dataclasses import dataclass
from typing import List, Dict

@dataclass
class Llama2Model:
    name: str
    parameters: str
    context_window: int
    variants: List[str]
    license: str
    training_tokens: str
    benchmark_scores: Dict[str, float]

llama2_models = {
    "llama-2-7b": Llama2Model(
        name="Llama 2 7B",
        parameters="7B",
        context_window=4096,
        variants=["base", "chat"],
        license="Llama 2 Community License",
        training_tokens="2T",
        benchmark_scores={
            "MMLU": 45.3,
            "HellaSwag": 77.2,
            "ARC": 53.0,
            "HumanEval": 12.8
        }
    ),
    "llama-2-13b": Llama2Model(
        name="Llama 2 13B",
        parameters="13B",
        context_window=4096,
        variants=["base", "chat"],
        license="Llama 2 Community License",
        training_tokens="2T",
        benchmark_scores={
            "MMLU": 54.8,
            "HellaSwag": 80.7,
            "ARC": 59.4,
            "HumanEval": 18.3
        }
    ),
    "llama-2-70b": Llama2Model(
        name="Llama 2 70B",
        parameters="70B",
        context_window=4096,
        variants=["base", "chat"],
        license="Llama 2 Community License",
        training_tokens="2T",
        benchmark_scores={
            "MMLU": 68.9,
            "HellaSwag": 85.3,
            "ARC": 67.3,
            "HumanEval": 29.9
        }
    )
}

def select_llama_model(requirements: dict) -> str:
    """Select appropriate Llama 2 model based on requirements."""
    if requirements.get("quality_priority") == "highest":
        return "llama-2-70b-chat"
    elif requirements.get("cost_priority") == "lowest":
        return "llama-2-7b-chat"
    elif requirements.get("balance"):
        return "llama-2-13b-chat"

    # Default based on task complexity
    complexity = requirements.get("task_complexity", "medium")
    mapping = {
        "low": "llama-2-7b-chat",
        "medium": "llama-2-13b-chat",
        "high": "llama-2-70b-chat"
    }
    return mapping.get(complexity, "llama-2-13b-chat")
```

## Deploying Llama 2 on Azure

```python
from azure.ai.ml import MLClient
from azure.ai.ml.entities import (
    ManagedOnlineEndpoint,
    ManagedOnlineDeployment,
    Model,
    Environment
)
from azure.identity import DefaultAzureCredential

class Llama2Deployer:
    def __init__(self, subscription_id: str, resource_group: str, workspace: str):
        self.client = MLClient(
            DefaultAzureCredential(),
            subscription_id,
            resource_group,
            workspace
        )

    def get_gpu_requirements(self, model_size: str) -> dict:
        """Get GPU requirements for each model size."""
        requirements = {
            "7b": {
                "instance_type": "Standard_NC24ads_A100_v4",
                "gpu_count": 1,
                "memory_gb": 16,
                "estimated_tps": 50
            },
            "13b": {
                "instance_type": "Standard_NC24ads_A100_v4",
                "gpu_count": 1,
                "memory_gb": 32,
                "estimated_tps": 30
            },
            "70b": {
                "instance_type": "Standard_NC48ads_A100_v4",
                "gpu_count": 2,  # Requires tensor parallelism
                "memory_gb": 140,
                "estimated_tps": 10
            }
        }
        return requirements.get(model_size, requirements["13b"])

    def deploy_llama2(
        self,
        model_variant: str,
        endpoint_name: str
    ) -> dict:
        """Deploy Llama 2 model as managed endpoint."""

        # Parse model size from variant
        size = model_variant.split("-")[2].replace("b", "")
        gpu_req = self.get_gpu_requirements(size + "b")

        # Create endpoint configuration
        endpoint = ManagedOnlineEndpoint(
            name=endpoint_name,
            description=f"Llama 2 {model_variant} deployment",
            auth_mode="key",
            tags={"model": model_variant, "framework": "llama"}
        )

        # Model from registry
        model = Model(
            path=f"azureml://registries/azureml-meta/models/{model_variant}/latest"
        )

        # Deployment configuration
        deployment = ManagedOnlineDeployment(
            name="main",
            endpoint_name=endpoint_name,
            model=model,
            instance_type=gpu_req["instance_type"],
            instance_count=1,
            environment_variables={
                "TENSOR_PARALLEL_SIZE": str(gpu_req["gpu_count"]),
                "MAX_TOTAL_TOKENS": "4096",
                "MAX_INPUT_LENGTH": "4000"
            },
            request_settings={
                "request_timeout_ms": 90000,
                "max_concurrent_requests_per_instance": 10
            }
        )

        return {
            "endpoint": endpoint,
            "deployment": deployment,
            "gpu_requirements": gpu_req
        }

# Usage
deployer = Llama2Deployer("sub-id", "rg", "workspace")
config = deployer.deploy_llama2("llama-2-70b-chat", "llama70b-endpoint")
print(f"GPU requirement: {config['gpu_requirements']}")
```

## Using Llama 2 Chat

```python
import requests
from typing import List, Dict, Optional

class Llama2ChatClient:
    def __init__(self, endpoint_url: str, api_key: str):
        self.endpoint_url = endpoint_url
        self.api_key = api_key

    def format_prompt(self, messages: List[Dict]) -> str:
        """Format messages using Llama 2 chat template."""
        B_INST, E_INST = "[INST]", "[/INST]"
        B_SYS, E_SYS = "<<SYS>>\n", "\n<</SYS>>\n\n"

        formatted = ""

        for i, message in enumerate(messages):
            role = message["role"]
            content = message["content"]

            if role == "system":
                formatted += f"{B_SYS}{content}{E_SYS}"
            elif role == "user":
                if i == 0 or (i == 1 and messages[0]["role"] == "system"):
                    formatted += f"{B_INST} {content} {E_INST}"
                else:
                    formatted += f"{B_INST} {content} {E_INST}"
            elif role == "assistant":
                formatted += f" {content} "

        return formatted

    def generate(
        self,
        messages: List[Dict],
        temperature: float = 0.7,
        max_tokens: int = 512,
        top_p: float = 0.9
    ) -> str:
        """Generate completion from Llama 2."""
        prompt = self.format_prompt(messages)

        payload = {
            "input_data": {
                "input_string": [prompt],
                "parameters": {
                    "temperature": temperature,
                    "max_new_tokens": max_tokens,
                    "top_p": top_p,
                    "do_sample": True
                }
            }
        }

        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}"
        }

        response = requests.post(
            f"{self.endpoint_url}/score",
            headers=headers,
            json=payload
        )

        result = response.json()
        return result[0] if isinstance(result, list) else result

# Example usage
client = Llama2ChatClient(
    "https://llama70b-endpoint.inference.ml.azure.com",
    "your-api-key"
)

response = client.generate([
    {"role": "system", "content": "You are a helpful AI assistant specialized in Python programming."},
    {"role": "user", "content": "Explain the difference between lists and tuples in Python."}
])

print(response)
```

## Fine-Tuning Llama 2

```python
from azure.ai.ml import command, Input
from azure.ai.ml.entities import AmlCompute

class Llama2FineTuner:
    def __init__(self, ml_client: MLClient):
        self.client = ml_client

    def prepare_training_data(self, data_path: str) -> dict:
        """Prepare data in the expected format for fine-tuning."""
        # Llama 2 expects data in specific format
        format_spec = {
            "format": "jsonl",
            "schema": {
                "text": "Full formatted prompt with response",
                # OR
                "messages": [
                    {"role": "system", "content": "..."},
                    {"role": "user", "content": "..."},
                    {"role": "assistant", "content": "..."}
                ]
            },
            "example": {
                "text": "[INST] <<SYS>>\nYou are helpful.\n<</SYS>>\n\nQuestion [/INST] Answer"
            }
        }
        return format_spec

    def create_fine_tune_job(
        self,
        base_model: str,
        training_data: str,
        output_model_name: str,
        epochs: int = 3,
        learning_rate: float = 2e-5,
        batch_size: int = 4
    ):
        """Create a fine-tuning job for Llama 2."""

        fine_tune_job = command(
            code="./fine_tune_scripts",
            command="""
            python fine_tune_llama.py \
                --model_name ${{inputs.base_model}} \
                --train_data ${{inputs.training_data}} \
                --output_dir ${{outputs.model}} \
                --epochs ${{inputs.epochs}} \
                --learning_rate ${{inputs.learning_rate}} \
                --batch_size ${{inputs.batch_size}} \
                --use_lora True \
                --lora_r 8 \
                --lora_alpha 32
            """,
            inputs={
                "base_model": base_model,
                "training_data": Input(type="uri_file", path=training_data),
                "epochs": epochs,
                "learning_rate": learning_rate,
                "batch_size": batch_size
            },
            outputs={
                "model": {"type": "uri_folder"}
            },
            compute="gpu-cluster",
            environment="llama-fine-tune-env:1"
        )

        return fine_tune_job

# Fine-tuning script example
fine_tune_script = """
import torch
from transformers import (
    AutoModelForCausalLM,
    AutoTokenizer,
    TrainingArguments,
    Trainer
)
from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
from datasets import load_dataset

def fine_tune_llama(
    model_name: str,
    train_data: str,
    output_dir: str,
    epochs: int = 3,
    learning_rate: float = 2e-5
):
    # Load model with quantization
    model = AutoModelForCausalLM.from_pretrained(
        model_name,
        load_in_4bit=True,
        device_map="auto",
        torch_dtype=torch.float16
    )

    # Prepare for LoRA training
    model = prepare_model_for_kbit_training(model)

    # LoRA configuration
    lora_config = LoraConfig(
        r=8,
        lora_alpha=32,
        target_modules=["q_proj", "v_proj"],
        lora_dropout=0.05,
        bias="none",
        task_type="CAUSAL_LM"
    )

    model = get_peft_model(model, lora_config)

    # Load tokenizer and data
    tokenizer = AutoTokenizer.from_pretrained(model_name)
    dataset = load_dataset("json", data_files=train_data)

    # Training arguments
    training_args = TrainingArguments(
        output_dir=output_dir,
        num_train_epochs=epochs,
        learning_rate=learning_rate,
        per_device_train_batch_size=4,
        gradient_accumulation_steps=4,
        warmup_steps=100,
        logging_steps=10,
        save_strategy="epoch",
        fp16=True
    )

    # Train
    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=dataset["train"],
        tokenizer=tokenizer
    )

    trainer.train()
    model.save_pretrained(output_dir)
"""
```

## Best Practices

1. **Use chat variants** for conversational applications
2. **Start with 13B** for balanced cost/performance
3. **Consider LoRA fine-tuning** to reduce compute costs
4. **Test thoroughly** - open models may need more guardrails
5. **Monitor for hallucinations** - implement fact-checking

Tomorrow, we'll explore open-source models more broadly and how to benchmark them!
