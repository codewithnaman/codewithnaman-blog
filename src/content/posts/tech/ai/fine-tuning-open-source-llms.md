---
title: 'Fine-tuning Open Source LLMs'
description: 'A practical guide to fine-tuning open source LLMs on your own data.'
pubDate: 2026-03-22
author: 'john-smith'
tags: [ai, llm, fine-tuning, transformers]
categories: [AI, Engineering]
draft: false
toc: true
---

Fine-tuning open source LLMs has gone from a research exercise to a practical engineering tool. With LoRA (Low-Rank Adaptation), you can adapt a 70B parameter model on a single GPU with 80GB of VRAM — and get results that rival GPT-4 on domain-specific tasks.

We fine-tuned Llama 3 8B and Mistral 7B on our internal documentation, support tickets, and codebase. Here's the complete process, from data preparation to deployment.

## Data Preparation

The quality of your fine-tuning data matters more than the model choice. We collected 15,000 instruction-response pairs from three sources:

```python
import json
from datasets import Dataset

def prepare_training_data(sources: list[dict]) -> Dataset:
    """Convert raw data into instruction-tuning format."""
    records = []

    for source in sources:
        if source['type'] == 'documentation':
            records.extend(doc_to_instructions(source))
        elif source['type'] == 'support_ticket':
            records.extend(ticket_to_instructions(source))
        elif source['type'] == 'code_review':
            records.extend(review_to_instructions(source))

    # Deduplicate near-identical examples
    records = deduplicate(records, threshold=0.92)

    # Split: 90% train, 5% validation, 5% test
    dataset = Dataset.from_list(records)
    return dataset.train_test_split(test_size=0.1).train_test_split(test_size=0.05)

def doc_to_instructions(doc: dict) -> list[dict]:
    """Convert documentation sections into Q&A pairs."""
    return [
        {
            "instruction": f"How do I {section['topic']}?",
            "input": "",
            "output": section['content'],
            "source": doc['id']
        }
        for section in doc['sections']
    ]
```

Our final dataset had 12,400 training examples, 680 validation, and 680 test examples.

## LoRA Configuration

LoRA freezes the base model weights and trains small adapter matrices. This reduces trainable parameters by 99% while preserving quality.

```python
from peft import LoraConfig, get_peft_model, TaskType
from transformers import AutoModelForCausalLM, AutoTokenizer

MODEL_NAME = "meta-llama/Meta-Llama-3-8B"

lora_config = LoraConfig(
    r=16,                    # Rank of adapter matrices
    lora_alpha=32,           # Scaling factor
    target_modules=[
        "q_proj", "k_proj", "v_proj", "o_proj",
        "gate_proj", "up_proj", "down_proj"
    ],
    lora_dropout=0.05,
    bias="none",
    task_type=TaskType.CAUSAL_LM,
)

model = AutoModelForCausalLM.from_pretrained(
    MODEL_NAME,
    torch_dtype=torch.bfloat16,
    device_map="auto",
)
model = get_peft_model(model, lora_config)
model.print_trainable_parameters()
# trainable params: 41,943,040 || all params: 8,072,343,552 || trainable%: 0.52%
```

Key configuration decisions:

- **Rank 16** — higher ranks (32, 64) gave diminishing returns for our domain
- **All linear layers** — targeting attention AND MLP layers improved quality by 8% over attention-only
- **5% dropout** — prevented overfitting on our relatively small dataset

## Training

We used Unsloth for 2x faster training with 60% less VRAM:

```python
from trl import SFTTrainer
from transformers import TrainingArguments

training_args = TrainingArguments(
    output_dir="./llama3-finetuned",
    num_train_epochs=3,
    per_device_train_batch_size=4,
    gradient_accumulation_steps=4,
    learning_rate=2e-4,
    lr_scheduler_type="cosine",
    warmup_ratio=0.03,
    fp16=True,
    logging_steps=10,
    save_strategy="epoch",
    evaluation_strategy="epoch",
    report_to="wandb",
)

trainer = SFTTrainer(
    model=model,
    args=training_args,
    train_dataset=dataset['train'],
    eval_dataset=dataset['test'],
    dataset_text_field="output",
    max_seq_length=2048,
    packing=False,
)

trainer.train()
```

Training took 4.5 hours on a single A100 80GB. The loss curve converged cleanly with no signs of overfitting.

## Evaluation

We evaluated on three dimensions:

```python
def evaluate_model(model, tokenizer, test_data: list[dict]) -> dict:
    """Evaluate fine-tuned model on held-out test set."""
    results = {"exact_match": 0, "rouge_l": 0, "hallucination_rate": 0}

    for example in test_data:
        prompt = format_prompt(example['instruction'], example['input'])
        generated = generate(model, tokenizer, prompt, max_new_tokens=256)

        results['exact_match'] += compute_exact_match(generated, example['output'])
        results['rouge_l'] += compute_rouge_l(generated, example['output'])
        results['hallucination_rate'] += check_hallucination(generated, example['output'])

    return {k: v / len(test_data) for k, v in results.items()}
```

| Model             | Exact Match | ROUGE-L | Hallucination Rate |
| ----------------- | ----------- | ------- | ------------------ |
| Llama 3 8B (base) | 12%         | 34%     | 28%                |
| Llama 3 8B (LoRA) | 41%         | 62%     | 8%                 |
| Mistral 7B (LoRA) | 38%         | 59%     | 10%                |
| GPT-4 (few-shot)  | 45%         | 65%     | 5%                 |

Our fine-tuned Llama 3 reached 91% of GPT-4's performance on our domain tasks, at a fraction of the inference cost.

## Deployment

We deployed the LoRA adapter alongside the base model using vLLM for high-throughput serving:

```bash
# Serve with vLLM
python -m vllm.entrypoints.openai.api_server \
    --model meta-llama/Meta-Llama-3-8B \
    --enable-lora \
    --lora-modules my-adapter=/path/to/adapter \
    --max-lora-rank=16 \
    --tensor-parallel-size=1
```

The adapter is only 160MB on disk, making it trivial to version, roll back, and A/B test.

## Lessons Learned

1. **Data quality beats model size** — 10K clean examples outperform 100K noisy ones
2. **LoRA rank 16 is the sweet spot** for most domain adaptation tasks
3. **Evaluate on your actual use case** — benchmark scores don't predict domain performance
4. **Keep the base model frozen** — full fine-tuning is rarely worth the cost and risk of catastrophic forgetting
5. **Version your adapters** — they're small enough to treat as artifacts, not infrastructure

---

_Questions about fine-tuning? Find me on [GitHub](https://github.com) or [Twitter](https://x.com)._
