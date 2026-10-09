---
title: "Hugging Face + Azure: Running Open Source Models in the Cloud"
description: "Hugging Face and Microsoft's partnership has made the model hub directly accessible from Azure ML, and in August 2023 this is meaningfully useful for Llama…"
author: Michael John Peña
draft: false
date: 2023-08-05
tags:
  - Hugging Face
  - Azure
  - Machine Learning
  - Cloud
---

Hugging Face and Microsoft's partnership has made the model hub directly accessible from Azure ML, and in August 2023 this is meaningfully useful for Llama 2 workflows. Llama 2 requires a Meta licence acceptance, and the Azure ML model catalogue handles that with a one-click acceptance flow — the model downloads from Hugging Face Hub to your Azure ML workspace storage without you setting up credentials or dealing with the Hugging Face Hub authentication manually. The practical pattern I use: accept the licence in Azure ML model catalogue, deploy the model to an Azure ML online endpoint or use it in a training job on an NC-series or ND-series GPU instance, and serve predictions via the managed endpoint API. For inference at scale, the managed endpoint autoscaling is convenient; for fine-tuning, a spot-instance training compute cluster is the cost-effective choice.

## Integration Options

```python
# Ways to use Hugging Face models on Azure
integration_options = {
    "azure_ml": {
        "description": "Full ML platform with Hugging Face integration",
        "use_case": "Production deployments, team collaboration"
    },
    "azure_container_instances": {
        "description": "Simple container deployment",
        "use_case": "Quick prototypes, APIs"
    },
    "azure_kubernetes": {
        "description": "Scalable container orchestration",
        "use_case": "High-traffic production"
    },
    "azure_vm": {
        "description": "Direct GPU VM access",
        "use_case": "Fine-tuning, experimentation"
    }
}
```

## Azure ML with Hugging Face

### Environment Setup

```python
from azure.ai.ml import MLClient
from azure.identity import DefaultAzureCredential
from azure.ai.ml.entities import Environment, BuildContext

# Connect to workspace
ml_client = MLClient(
    DefaultAzureCredential(),
    subscription_id="your-subscription-id",
    resource_group_name="your-rg",
    workspace_name="your-workspace"
)

# Create environment with Hugging Face libraries
env = Environment(
    name="huggingface-transformers",
    description="Environment for Hugging Face models",
    conda_file={
        "name": "transformers",
        "channels": ["conda-forge", "pytorch"],
        "dependencies": [
            "python=3.10",
            "pip",
            {"pip": [
                "transformers>=4.30.0",
                "torch>=2.0.0",
                "accelerate",
                "peft",
                "bitsandbytes",
                "datasets",
                "evaluate",
                "huggingface_hub"
            ]}
        ]
    },
    image="mcr.microsoft.com/azureml/curated/acpt-pytorch-2.0-cuda11.7:latest"
)

ml_client.environments.create_or_update(env)
```

### Training Script

```python
# train_hf_model.py
import argparse
from transformers import (
    AutoModelForCausalLM,
    AutoTokenizer,
    TrainingArguments,
    Trainer
)
from peft import LoraConfig, get_peft_model
from datasets import load_dataset
import mlflow

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model_name", type=str, required=True)
    parser.add_argument("--output_dir", type=str, required=True)
    parser.add_argument("--data_path", type=str, required=True)
    parser.add_argument("--epochs", type=int, default=3)
    parser.add_argument("--batch_size", type=int, default=4)
    parser.add_argument("--learning_rate", type=float, default=2e-4)
    args = parser.parse_args()

    # Enable MLflow tracking
    mlflow.transformers.autolog()

    # Load model and tokenizer
    model = AutoModelForCausalLM.from_pretrained(args.model_name)
    tokenizer = AutoTokenizer.from_pretrained(args.model_name)

    # Apply LoRA
    lora_config = LoraConfig(
        r=8,
        lora_alpha=32,
        target_modules=["q_proj", "v_proj"],
        lora_dropout=0.05,
        task_type="CAUSAL_LM"
    )
    model = get_peft_model(model, lora_config)

    # Load dataset
    dataset = load_dataset("json", data_files=args.data_path)

    # Tokenize
    def tokenize(examples):
        return tokenizer(
            examples["text"],
            truncation=True,
            max_length=512,
            padding="max_length"
        )

    tokenized = dataset.map(tokenize, batched=True)

    # Training
    training_args = TrainingArguments(
        output_dir=args.output_dir,
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.batch_size,
        learning_rate=args.learning_rate,
        logging_steps=10,
        save_strategy="epoch"
    )

    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=tokenized["train"]
    )

    trainer.train()
    trainer.save_model()

if __name__ == "__main__":
    main()
```

### Submit Training Job

```python
from azure.ai.ml import command, Input

# Define the job
job = command(
    code="./src",
    command="python train_hf_model.py --model_name ${{inputs.model_name}} --output_dir ${{outputs.model}} --data_path ${{inputs.data}} --epochs 3",
    environment="huggingface-transformers@latest",
    compute="gpu-cluster",
    inputs={
        "model_name": "meta-llama/Llama-2-7b-hf",
        "data": Input(type="uri_file", path="azureml://datastores/workspaceblobstore/paths/training_data.jsonl")
    },
    outputs={
        "model": Output(type="uri_folder", path="azureml://datastores/workspaceblobstore/paths/models/llama-finetuned")
    },
    environment_variables={
        "HF_TOKEN": "your-hf-token"  # For gated models
    }
)

# Submit
submitted_job = ml_client.jobs.create_or_update(job)
print(f"Job submitted: {submitted_job.name}")
```

## Deploying Models

### Managed Online Endpoint

```python
from azure.ai.ml.entities import (
    ManagedOnlineEndpoint,
    ManagedOnlineDeployment,
    Model,
    CodeConfiguration
)

# Create endpoint
endpoint = ManagedOnlineEndpoint(
    name="hf-llm-endpoint",
    description="Hugging Face LLM endpoint",
    auth_mode="key"
)
ml_client.online_endpoints.begin_create_or_update(endpoint).result()

# Create deployment
deployment = ManagedOnlineDeployment(
    name="main",
    endpoint_name="hf-llm-endpoint",
    model=Model(path="./model"),
    code_configuration=CodeConfiguration(
        code="./score",
        scoring_script="score.py"
    ),
    environment="huggingface-transformers@latest",
    instance_type="Standard_NC6s_v3",
    instance_count=1
)
ml_client.online_deployments.begin_create_or_update(deployment).result()
```

### Scoring Script

```python
# score.py
import json
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

def init():
    global model, tokenizer

    model_path = os.environ.get("AZUREML_MODEL_DIR", "./model")
    model = AutoModelForCausalLM.from_pretrained(model_path)
    tokenizer = AutoTokenizer.from_pretrained(model_path)

    if torch.cuda.is_available():
        model = model.to("cuda")

def run(raw_data):
    data = json.loads(raw_data)
    prompt = data.get("prompt", "")
    max_length = data.get("max_length", 100)

    inputs = tokenizer(prompt, return_tensors="pt")
    if torch.cuda.is_available():
        inputs = {k: v.to("cuda") for k, v in inputs.items()}

    with torch.no_grad():
        outputs = model.generate(**inputs, max_length=max_length)

    response = tokenizer.decode(outputs[0], skip_special_tokens=True)

    return {"response": response}
```

## Using Azure VMs Directly

```bash
# Create GPU VM
az vm create \
    --resource-group myResourceGroup \
    --name hf-training-vm \
    --image microsoft-dsvm:ubuntu-hpc:2004:latest \
    --size Standard_NC6s_v3 \
    --admin-username azureuser \
    --generate-ssh-keys

# SSH and install
ssh azureuser@<vm-ip>
pip install transformers peft accelerate bitsandbytes

# Login to Hugging Face
huggingface-cli login --token $HF_TOKEN
```

## Cost Optimization

```python
cost_optimization = {
    "spot_instances": {
        "description": "Use spot VMs for training",
        "savings": "Up to 90% cheaper",
        "risk": "May be preempted"
    },
    "right_sizing": {
        "description": "Choose appropriate GPU",
        "nc6s_v3": "T4 - Good for inference, fine-tuning small models",
        "nc12s_v3": "2x T4 - Larger models",
        "nd40rs_v2": "8x V100 - Large-scale training"
    },
    "auto_shutdown": {
        "description": "Stop VMs when not in use",
        "implementation": "Azure Automation or DevTest Labs"
    },
    "quantization": {
        "description": "Use 4-bit/8-bit models",
        "benefit": "Smaller GPU requirements"
    }
}
```

Tomorrow we'll explore the Hugging Face Model Hub.

## Resources

- [Azure ML + Hugging Face](https://learn.microsoft.com/en-us/azure/machine-learning/how-to-use-hugging-face)
- [Hugging Face on Azure](https://huggingface.co/docs/hub/spaces-sdks-docker-azure)
- [Azure ML Documentation](https://learn.microsoft.com/en-us/azure/machine-learning/)
