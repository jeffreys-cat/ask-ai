# Ask Docs Evaluation

This project evaluates documentation Q&A with Litefuse/Langfuse datasets and experiments.

## Dataset Shape

Use the Litefuse dataset `ask-ai-docs-eval`. Start with the smallest dataset shape:

```json
{
  "input": {
    "question": "Which config keys are required?",
    "projectId": "project-id"
  },
  "expectedOutput": {},
  "metadata": {}
}
```

The initial regression gate only checks that the answer language matches the question language. Add both English and Chinese questions before using it as a prompt regression signal.

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

The default evaluator writes one deterministic score:

- `language_consistency`

The default regression gate fails when average `language_consistency < 1`.
