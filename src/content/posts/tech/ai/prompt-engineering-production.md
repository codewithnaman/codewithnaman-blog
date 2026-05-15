---
title: 'Prompt Engineering in Production'
description: 'Lessons learned from building production LLM applications with proper prompt management.'
pubDate: 2026-03-05
author: 'john-smith'
tags: [ai, llm, prompt-engineering]
categories: [AI, Engineering]
draft: false
toc: true
---

When you have one LLM-powered feature, prompt engineering is a notebook exercise. When you have 500+ prompts across 12 microservices, it's an infrastructure problem.

We learned this the hard way. After a model upgrade from GPT-3.5 to GPT-4, 47 prompts broke in production. Some produced garbled output. Others silently changed behavior. We had no way to test prompts before deploying them, and no versioning to roll back.

Here's how we built a prompt management system that prevents those failures.

## The Prompt Registry

We moved all prompts out of application code and into a centralized registry stored in PostgreSQL with a Git-backed version control layer:

```sql
CREATE TABLE prompts (
    id UUID PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    service VARCHAR(100) NOT NULL,
    version INTEGER NOT NULL,
    template TEXT NOT NULL,
    model VARCHAR(50) NOT NULL,
    parameters JSONB,
    created_at TIMESTAMP DEFAULT NOW(),
    created_by VARCHAR(100),
    UNIQUE(name, service, version)
);

CREATE TABLE prompt_tests (
    id UUID PRIMARY KEY,
    prompt_id UUID REFERENCES prompts(id),
    test_input TEXT NOT NULL,
    expected_output TEXT,
    evaluation_criteria JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);
```

Each prompt has a name, service owner, version, template, model specification, and parameters. The version is auto-incremented on every change.

```python
class PromptRegistry:
    def get_prompt(self, name: str, service: str, version: str = "latest") -> Prompt:
        if version == "latest":
            query = """
                SELECT * FROM prompts
                WHERE name = $1 AND service = $2
                ORDER BY version DESC LIMIT 1
            """
        else:
            query = """
                SELECT * FROM prompts
                WHERE name = $1 AND service = $2 AND version = $3
            """
        return self.db.fetch(query, name, service, version)

    def deploy_prompt(self, prompt: Prompt) -> Prompt:
        """Deploy only after passing all tests."""
        results = self.run_tests(prompt)
        if not results.passed:
            raise PromptTestFailed(f"Prompt '{prompt.name}' failed tests: {results.failures}")

        return self.db.insert(prompt)
```

## Prompt Testing Framework

Every prompt in the registry must have associated test cases. We evaluate outputs on three dimensions:

```python
from dataclasses import dataclass
from enum import Enum

class TestType(Enum):
    EXACT_MATCH = "exact_match"
    SEMANTIC_SIMILARITY = "semantic_similarity"
    STRUCTURE_VALIDATION = "structure_validation"
    SAFETY_CHECK = "security_check"

@dataclass
class PromptTest:
    prompt_id: str
    input: str
    expected: str
    test_type: TestType
    threshold: float  # 0.0 to 1.0

def evaluate_output(actual: str, test: PromptTest) -> TestResult:
    if test.test_type == TestType.EXACT_MATCH:
        score = 1.0 if actual.strip() == test.expected.strip() else 0.0

    elif test.test_type == TestType.SEMANTIC_SIMILARITY:
        score = cosine_similarity(
            embed(actual), embed(test.expected)
        )

    elif test.test_type == TestType.STRUCTURE_VALIDATION:
        try:
            json.loads(actual)
            score = 1.0
        except json.JSONDecodeError:
            score = 0.0

    elif test.test_type == TestType.SAFETY_CHECK:
        score = 1.0 if not contains_pii(actual) else 0.0

    return TestResult(score=score, passed=score >= test.threshold)
```

Our CI pipeline runs all prompt tests on every PR. If a prompt change causes any test to fail, the PR is blocked.

## Versioning and Rollback

Every prompt change creates a new version. We can roll back any prompt to any previous version instantly:

```python
def rollback_prompt(name: str, service: str, target_version: int):
    """Roll back a prompt to a previous version."""
    current = registry.get_prompt(name, service)
    target = registry.get_prompt(name, service, version=target_version)

    # Deploy the old version as a new version number
    new_version = Prompt(
        name=name,
        service=service,
        version=current.version + 1,
        template=target.template,
        model=target.model,
        parameters=target.parameters,
        created_by="rollback-system",
    )

    return registry.deploy_prompt(new_version)
```

This means rollbacks are just another deployment — they go through the same test pipeline and audit trail.

## Model Abstraction

Prompts are tied to specific models, but our services reference prompts by name, not model. This lets us swap models without changing application code:

```yaml
# prompt-config.yaml
prompts:
  code_review_agent:
    production:
      model: gpt-4o
      version: 23
    staging:
      model: gpt-4o-mini
      version: 23
    canary:
      model: claude-sonnet-4-2026
      version: 1
```

We route traffic to different model versions using a simple proxy layer:

```python
class ModelRouter:
    def __init__(self, config: dict):
        self.routes = config['prompts']

    def get_model(self, prompt_name: str, environment: str) -> str:
        return self.routes[prompt_name][environment]['model']

    async def execute(self, prompt_name: str, input_data: dict, environment: str = "production"):
        prompt = registry.get_prompt(prompt_name, service=self.service)
        model = self.get_model(prompt_name, environment)

        return await self.llm_client.chat(
            model=model,
            messages=format_messages(prompt.template, input_data),
            **prompt.parameters
        )
```

## Monitoring and Alerting

We track prompt performance in production with three key metrics:

1. **Output quality score** — running a subset of test cases against production traffic
2. **Token cost per prompt** — tracking cost trends as models and prompts evolve
3. **Latency distribution** — per-prompt P50, P95, P99 latencies

```python
def monitor_prompt_execution(prompt_name: str, result: LLMResponse):
    metrics.gauge(
        "prompt.token_cost",
        result.cost,
        tags={"prompt": prompt_name, "model": result.model}
    )
    metrics.histogram(
        "prompt.latency_ms",
        result.latency_ms,
        tags={"prompt": prompt_name}
    )

    # Sample 1% of responses for quality evaluation
    if random.random() < 0.01:
        quality = evaluate_quality(result.output, prompt_name)
        metrics.gauge("prompt.quality_score", quality, tags={"prompt": prompt_name})
```

## Results

| Metric                     | Before Registry | After Registry |
| -------------------------- | --------------- | -------------- |
| Prompt-related incidents   | 12/month        | 1/month        |
| Time to rollback           | 45 minutes      | 30 seconds     |
| Model swap time            | 2 days          | 5 minutes      |
| Test coverage              | 0%              | 94%            |
| Avg prompt iteration speed | 3 days          | 4 hours        |

## Lessons Learned

1. **Prompts are code** — treat them with the same rigor: versioning, testing, code review
2. **Test before deploy** — never let a prompt reach production without automated tests
3. **Abstract the model** — your services shouldn't care which model runs the prompt
4. **Monitor in production** — prompt quality drifts as models update and data changes
5. **Start small** — begin with your most critical prompts, then expand coverage incrementally

---

_Want to learn more about MLOps for LLMs? Check out our other posts on [AI Engineering](/categories/ai)._
