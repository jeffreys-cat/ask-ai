# Ask Docs Evaluation

This project evaluates documentation Q&A with Litefuse/Langfuse datasets and experiments.

## Dataset Shape

Use the Litefuse dataset `ask-ai-docs-eval`. Each item should follow this shape:

```json
{
  "input": {
    "question": "Which config keys are required?",
    "projectId": "project-id",
    "tags": ["config", "critical"]
  },
  "expectedOutput": {
    "expectedAnswer": "OPENAI_API_KEY and CHAT_MODEL are required.",
    "expectedCitationDocIds": ["document-id"],
    "mustInclude": ["OPENAI_API_KEY", "CHAT_MODEL"],
    "shouldRefuse": false
  },
  "metadata": {
    "critical": true
  }
}
```

Keep at least 30 active items in the dataset before using the regression gate. Include configuration, setup steps, comparison questions, and no-context refusal cases.

## Commands

Seed or update a dataset from JSON:

```sh
pnpm eval:ask-docs:seed -- --file eval/ask-docs.samples.example.json --dataset ask-ai-docs-eval
```

Run the Litefuse dataset experiment:

```sh
LITEFUSE_PROMPT_LABEL=staging pnpm eval:ask-docs -- --dataset ask-ai-docs-eval
```

Run against a local JSON file while building the dataset:

```sh
pnpm eval:ask-docs -- --local eval/ask-docs.samples.example.json --min-items 0 --include-items true
```

## Litefuse Prompts

Create these prompts as Chat Prompts in Litefuse:

- `ask-ai-doc-answer`
- `ask-ai-no-context`

Both prompts receive the same variables:

- `instructions`
- `question`
- `context`
- `citations`

Use `LITEFUSE_PROMPT_LABEL=staging` for prompt experiments. Promote the prompt label to `production` only after the dataset run passes the regression gate.

## Scores

The v1 evaluator writes deterministic scores for:

- `retrieval_recall`
- `groundedness`
- `citation_correctness`
- `answer_helpfulness`
- `refusal_correctness`

The default regression gate fails when average `groundedness < 0.9`, `citation_correctness < 0.85`, or `refusal_correctness < 0.9`.
