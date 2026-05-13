# commercetools Skills

NOTE: This is NOT an official commercetools code and NOT production ready. Use it at your own risk


A collection of [Claude Code skills](https://docs.anthropic.com/en/docs/claude-code/skills) that encode patterns for building on the commercetools platform. Each skill is a structured knowledge base that Claude Code loads on demand, giving it the context it needs to write correct, idiomatic code for commercetools projects without repeated prompting.

## Available Skills

| Skill | Description |
|-------|-------------|
| `commercetools-b2c-storefront` | Patterns for building a B2C storefront on commercetools with Next.js 14 App Router, TypeScript, Tailwind v4, and JWT sessions |
| `commercetools-b2b-storefront` | Patterns for building a B2B storefront on commercetools — coming soon |

## Installing a Skill

Use the `npx skills` CLI to add a skill to your Claude Code project:

```bash
npx skills add https://github.com/commercetools-demo/skills --skill <skill-name>
```

This command downloads the skill and registers it in your project's `.claude/` configuration so Claude Code can load it during conversations.

### Install all skills

```bash
npx skills add https://github.com/commercetools-demo/skills 
```

## How Skills Work

Each skill lives in its own directory under `skills/` and contains:

- **`SKILL.md`** — The entry point. Defines the skill name, description, key takeaways, and an index of reference documents.
- **`references/`** — Detailed reference files covering specific topics (architecture patterns, API usage, deployment, etc.).

When you install a skill, Claude Code can pull in these documents as context when you're working on a relevant task — without you having to paste documentation manually.
