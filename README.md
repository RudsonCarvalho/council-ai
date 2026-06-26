# AI Debate Platform

Turn complex decisions into structured multi-AI debates.

AI Debate Platform is a web app that lets multiple AI models reason over the same problem, challenge each other across rounds, converge through a moderator, and produce a final decision document you can actually use.

> Nota em portugues: este projeto cria uma sala de debate entre varias IAs para comparar argumentos, chegar a consenso e gerar uma decisao ou especificacao final.

## Why It Exists

Most AI tools give you one answer from one model. That is useful, but fragile when the decision is strategic, technical, expensive, or full of trade-offs.

AI Debate Platform is built for the moments where you want more than a single response. It creates a deliberation room where different models bring different strengths, disagree constructively, refine their positions, and help you see the problem from several angles before committing to a direction.

## What It Does

- Runs structured debates between Claude, GPT, Gemini, Perplexity, DeepSeek, Grok, Mistral, and other provider-compatible agents.
- Lets you choose participants, moderator, debate tone, room rules, models, rounds, and synthesis objective.
- Streams each AI response in real time so you can inspect how the debate evolves.
- Supports private briefings per agent, letting each model receive a different role, bias, constraint, or expertise.
- Accepts files, URLs, previous sessions, and research notes as decision context.
- Lets a human pause the debate, inject guidance, ask for clarification, or redirect the room.
- Produces a final synthesis such as a decision memo, technical spec, research analysis, article outline, or business plan.
- Can hand the final spec to local execution tools such as Claude Code or Aider.

## Product Positioning

Use it when the cost of being wrong is higher than the cost of thinking harder.

AI Debate Platform is useful for:

- software architecture decisions;
- product and business strategy;
- market and competitor analysis;
- technical specification drafting;
- high-stakes implementation planning;
- research synthesis;
- validating ideas before spending engineering time;
- comparing model reasoning side by side.

## How It Works

```text
User
  -> Problem, context, rules, and constraints
  -> Multiple AI agents debate across rounds
  -> Moderator evaluates alignment and disagreement
  -> Human can pause, clarify, or steer the debate
  -> Synthesizer creates the final decision artifact
  -> Optional executor turns the output into implementation work
```

## Core Concepts

**Agents**

Each agent has a provider, model, persona, token limit, temperature, cost metadata, and optional private briefing.

**Moderator**

The moderator evaluates progress, identifies consensus, highlights unresolved disagreements, and can decide when the debate is ready for synthesis.

**Room Rules**

Debates can be configured with constraints such as tone, word limits, evidence requirements, challenger behavior, or scenario-specific instructions.

**Synthesis**

At the end, one selected AI reads the debate and creates a structured final artifact for the chosen goal.

## Tech Stack

- Node.js and Express backend.
- React, Vite, and Zustand frontend.
- MongoDB for session persistence.
- Server-Sent Events for streaming debate responses.
- Official SDKs and OpenAI-compatible APIs for model providers.

## Requirements

- Node.js 18 or newer.
- MongoDB, local or remote.
- API keys for the providers you want to enable.
- Optional: Claude Code CLI or Aider for implementation handoff.

## Installation

```bash
git clone https://github.com/YOUR_USERNAME/ai-debate-platform.git
cd ai-debate-platform
npm run install:all
cp .env.example .env
```

Edit `.env` with your real credentials. The public repository should only contain symbolic placeholder values.

```env
ANTHROPIC_API_KEY=your-anthropic-api-key
OPENAI_API_KEY=your-openai-api-key
GEMINI_API_KEY=your-gemini-api-key
PERPLEXITY_API_KEY=your-perplexity-api-key
DEEPSEEK_API_KEY=your-deepseek-api-key
GROK_API_KEY=your-grok-api-key
MISTRAL_API_KEY=your-mistral-api-key
MONGODB_URI=mongodb://localhost:27017/ai-debate-platform
```

## Development

```bash
npm run dev
```

- Frontend: `http://localhost:3000`
- Backend: `http://localhost:3001`

## Agent Configuration

Agents are configured in `config/agents.config.js`.

Each agent can define:

- default provider and model;
- alternative models shown in the UI;
- persona and debate style;
- token limit, temperature, and estimated cost;
- environment variable used for its API key.

To disable a provider in a public demo, set `enabled` to `false`.

## Security

This public version is prepared without real credentials.

- Never commit `.env`.
- Never hardcode provider keys in source files.
- Keep `.env.example` symbolic.
- Do not commit saved sessions, private prompts, customer data, or local research artifacts.
- Publish from a fresh Git history if the private project ever contained secrets.

See [SECURITY.md](SECURITY.md) for the publishing checklist.

## Project Structure

```text
backend/       API routes, model adapters, orchestration, storage, synthesis
config/        agents, provider endpoints, debate rules, UI constants
frontend/      React application and debate interface
storage/       local runtime directories; public commits keep placeholders only
```

## License

MIT
