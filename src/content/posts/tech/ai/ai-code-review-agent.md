---
title: 'Building an AI Code Review Agent'
description: 'A practical guide to building an autonomous code review system using LLMs.'
pubDate: 2026-04-10
author: 'john-smith'
tags: [ai, llm, code-review, automation]
categories: [AI, Engineering]
draft: false
toc: true
---

Code review is one of the highest-leverage activities in software engineering, but it's also one of the biggest bottlenecks. Our team was spending an average of 4 hours per developer per week on reviews, and PRs sat waiting for 6+ hours before the first comment.

We built an AI code review agent that runs in CI/CD, providing automated feedback on every pull request. After three months in production, it catches 40% of issues before a human reviewer sees the PR, reducing average review time by 60%.

## Architecture

The agent runs as a GitHub App triggered by the `pull_request` event. It processes diffs through a multi-stage pipeline:

```
PR Event → Diff Extraction → Context Enrichment → LLM Analysis → Comment Generation → GitHub API
```

```python
from github import Github
import openai

class CodeReviewAgent:
    def __init__(self, gh_token: str, openai_key: str):
        self.gh = Github(gh_token)
        self.llm = openai.AsyncOpenAI(api_key=openai_key)

    async def review_pr(self, owner: str, repo: str, pr_number: int):
        repo_obj = self.gh.get_repo(f"{owner}/{repo}")
        pr = repo_obj.get_pull(pr_number)

        diff = self.extract_diff(pr)
        context = self.enrich_with_context(repo_obj, diff)
        findings = await self.analyze(diff, context)

        for finding in findings:
            if finding.severity >= FindingSeverity.MEDIUM:
                await pr.create_review_comment(
                    body=finding.comment,
                    commit=pr.get_commits().reversed[0],
                    path=finding.file,
                    line=finding.line,
                )
```

## Context Enrichment

The biggest mistake in AI code review is analyzing diffs in isolation. A change that looks wrong might be perfectly valid given the surrounding codebase context.

```python
def enrich_with_context(repo, diff: DiffHunk) -> ReviewContext:
    """Gather surrounding code, related files, and project conventions."""
    context = ReviewContext()

    for hunk in diff.hunks:
        # Get 20 lines of surrounding context
        context.surrounding[hunk.file] = repo.get_file_content(
            hunk.file,
            start_line=max(0, hunk.start_line - 20),
            end_line=hunk.end_line + 20
        )

        # Find related test files
        test_file = find_test_file(hunk.file)
        if test_file:
            context.tests[test_file] = repo.get_file_content(test_file)

        # Load project lint rules
        context.lint_config = repo.get_file_content('.eslintrc.json')

    return context
```

This context enrichment step was the single biggest factor in reducing false positives. Without it, the agent flagged 60% of suggestions as irrelevant. With context, that dropped to 12%.

## Prompt Engineering

Our prompt evolved through 15 iterations. The current version uses a structured format with explicit rules:

````python
REVIEW_PROMPT = """You are a senior engineer reviewing a pull request.

## Rules
1. Only flag issues that are **actual bugs**, **security vulnerabilities**, or **significant performance problems**
2. Do NOT comment on style preferences (formatting, naming conventions) — the linter handles those
3. Do NOT suggest changes that would require modifying more than 10 lines
4. Always provide a code example showing the fix
5. Rate severity: CRITICAL, HIGH, MEDIUM, LOW

## Codebase Context
{context}

## Diff
```diff
{diff}
````

## Review Format

For each finding, output:

- **File**: path/to/file.py:line
- **Severity**: CRITICAL|HIGH|MEDIUM|LOW
- **Issue**: One-line description
- **Fix**: Suggested code change
  """

````

Key lessons from prompt iteration:

- **Explicit negative constraints** ("do NOT comment on style") reduced noise by 45%
- **Requiring code examples** forced the model to ground its suggestions in reality
- **Severity classification** let us filter which comments actually get posted to the PR

## Filtering and Noise Reduction

Not every LLM suggestion should reach the developer. We apply a multi-layer filter:

```python
def filter_findings(findings: list[Finding]) -> list[Finding]:
    """Remove low-value findings before posting to PR."""
    filtered = []

    for f in findings:
        # Skip low severity
        if f.severity < FindingSeverity.MEDIUM:
            continue

        # Skip if it's a known pattern (e.g., intentional performance trade-off)
        if is_known_pattern(f.file, f.line):
            continue

        # Skip if a human already commented on this
        if already_commented(f.file, f.line):
            continue

        # Deduplicate similar findings
        if is_duplicate(f, filtered):
            continue

        filtered.append(f)

    return filtered
````

We also implemented a feedback loop: developers can react with 👍 or 👎 on AI comments, and we use this signal to fine-tune our filtering thresholds.

## Results

| Metric                 | Before AI | With AI   |
| ---------------------- | --------- | --------- |
| Avg review time        | 6.2 hours | 2.4 hours |
| Bugs caught in review  | 68%       | 89%       |
| Review comments per PR | 4.2       | 7.8       |
| Developer satisfaction | 3.2/5     | 4.1/5     |
| False positive rate    | —         | 12%       |

The AI agent doesn't replace human reviewers — it handles the first pass, catching obvious issues so humans can focus on architecture, design, and business logic.

## Lessons Learned

1. **Context is everything** — reviewing diffs without surrounding code produces garbage
2. **Be aggressive with filtering** — one false positive erodes trust faster than ten good catches build it
3. **Start with high severity only** — we began posting only CRITICAL findings, then gradually lowered the threshold
4. **Measure developer sentiment** — if your team hates the bot, you're doing it wrong
5. **The linter is your friend** — let static analysis handle style; save the LLM for semantic issues

---

_Want to see the full implementation? Check out our [GitHub repository](https://github.com)._
