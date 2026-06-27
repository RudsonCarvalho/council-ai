# Council AI

Your AI decision council for high-stakes technical and product calls.

Council AI is a web platform that turns one hard question into a structured debate between multiple AI models. Instead of trusting a single model's first answer, you can bring Claude, GPT, Gemini, Perplexity, DeepSeek, Grok, Mistral, and other agents into the same room, let them challenge each other, score their contributions, detect consensus, and synthesize the result into a decision document or executable spec.

> Nota em portugues: o Council AI cria uma sala de debate entre varias IAs para comparar argumentos, identificar consenso e gerar uma decisao ou especificacao final.

## The Pitch

Most AI products optimize for fast answers. Council AI optimizes for better decisions.

When you are choosing an architecture, validating a product direction, comparing vendors, planning an implementation, or exploring a strategic trade-off, a single answer can be too smooth. Council AI introduces productive friction: different models, different priors, different personas, an independent judge, human moderation, adversarial critique, fact-checking, and final synthesis.

Use it when the cost of being wrong is higher than the cost of thinking harder.

## Why Multi-AI Debate

A single model tends to converge on its own most likely answer. Asking it five times often reproduces the same blind spots five times.

Council AI uses a multi-agent debate pattern:

- Different providers bring different priors, training histories, and failure modes.
- Personas force useful disagreement instead of polite averaging.
- Rounds let agents update their positions after seeing each other's arguments.
- A judge model evaluates consensus without being one of the debaters.
- An adversary can attack weak reasoning without defending its own previous answer.
- A fact-checker can inspect factual claims and contradictions.
- A synthesizer turns the discussion into a useful artifact, not just a transcript.

The result is slower and more expensive than one prompt, on purpose. It is designed for decisions that deserve deliberation.

## What You Can Do

- Run live structured debates between multiple AI providers.
- Choose participants, moderator, debate tone, room rules, models, round limits, and synthesis objective.
- Stream responses token by token in a real-time debate room.
- Pause, resume, redirect, whisper privately to an agent, or inject your own view mid-debate.
- Kick or restore agents during the discussion.
- Add private briefings so each model receives a different role, constraint, or expertise.
- Attach files, fetch URLs, reuse previous sessions, and build a lightweight decision memory.
- Enable clarification rounds before the debate starts.
- Add adversary and fact-checker roles.
- Detect impasse and ask the human to break the tie.
- Track token usage, cost, novelty, practicality, and robustness per agent.
- Generate final outputs such as a decision memo, technical spec, research brief, article, or business plan.
- Hand off the final spec to local execution tools such as Claude Code or Aider.

## Best Use Cases

- Software architecture decisions.
- Product and roadmap prioritization.
- Vendor and tool selection.
- Technical specification drafting.
- Research synthesis.
- Market and competitor analysis.
- Business strategy exploration.
- Pre-implementation review before spending engineering time.

## How It Works

```text
User
  -> Problem, files, URLs, previous sessions, rules, and constraints
  -> Multiple AI agents debate across rounds
  -> Judge scores progress, novelty, practicality, robustness, and consensus
  -> Human can pause, steer, whisper, kick agents, or break impasses
  -> Synthesizer creates the final decision artifact
  -> Optional executor turns the spec into implementation work
```

## Multi-Provider by Design

Council AI ships with adapters for seven providers, each independently toggleable and model-selectable in `config/agents.config.js`.

The table below is the default model catalog included in this public release, not a locked list. Users can edit `config/agents.config.js` to change default models, add more model options to an existing provider, disable providers they do not use, or register new agents/adapters for additional model vendors.

| Agent | Company | Default model | Persona angle |
| --- | --- | --- | --- |
| Claude | Anthropic | `claude-sonnet-4-5` | safety, correctness, maintainability |
| GPT-4 | OpenAI | `gpt-4o` | pragmatism, ecosystem, developer experience |
| Gemini | Google | `gemini-3-flash-preview` | scalability, cloud-native, data at scale |
| Perplexity | Perplexity AI | `llama-3.1-sonar-large-128k-online` | real-time research, trade-offs |
| DeepSeek | DeepSeek | `deepseek-chat` | efficiency, reasoning, cost-conscious engineering |
| Grok | xAI | `grok-4.20-non-reasoning` | first principles, contrarian critique |
| Mistral | Mistral AI | `mistral-large-latest` | open-source, interoperability, vendor neutrality |

You only need API keys for the providers you enable. Claude is required by default because the judge and moderator use Anthropic models, but that behavior can also be customized in configuration if you want to use a different judging strategy.

## Main Screens

### Setup

Configure the debate before it starts:

- problem statement and file attachments;
- participant picker and per-agent model selection;
- moderator selection;
- URL research and optional researcher agent;
- debate constitution, tone, and room rules;
- private briefings per agent;
- previous sessions as knowledge-base context;
- clarification round;
- adversary and fact-checker roles;
- final document objective and synthesizer;
- provider connection test before spending tokens.

### Debate Room

Run the live debate:

- real-time streaming responses per agent and round;
- pause/resume and step-by-step pacing;
- human moderator input;
- private whispers;
- kick/un-kick agents;
- live moderator swap;
- clarification flow;
- adversary and fact-checker activity;
- impasse analysis;
- consensus and judge verdict bar;
- force synthesis;
- token and cost tracking;
- final session tagging and report download.

### Execution

Turn the final spec into action:

- edit/download the generated spec;
- choose executor agents configured in `config/executors.config.js`;
- provide per-executor private instructions;
- set a working directory;
- run executors and inspect stdout/stderr/results.

### History

Reuse and learn from previous sessions:

- search/filter by theme, tags, or problem text;
- inspect full transcripts grouped by round;
- edit tags and knowledge-base status;
- add lessons learned after acting on a decision;
- reopen past configurations as the starting point for new debates.

## Tech Stack

- Node.js and Express backend.
- React, Vite, and Zustand frontend.
- MongoDB for session persistence.
- Server-Sent Events for streaming.
- Official SDKs and OpenAI-compatible APIs for model providers.

## Installation

```bash
git clone https://github.com/RudsonCarvalho/council-ai.git
cd council-ai
npm run install:all
cp .env.example .env
```

Edit `.env` with your own provider keys:

```env
ANTHROPIC_API_KEY=your-anthropic-api-key
OPENAI_API_KEY=your-openai-api-key
GEMINI_API_KEY=your-gemini-api-key
PERPLEXITY_API_KEY=your-perplexity-api-key
DEEPSEEK_API_KEY=your-deepseek-api-key
GROK_API_KEY=your-grok-api-key
MISTRAL_API_KEY=your-mistral-api-key
MONGODB_URI=mongodb://localhost:27017/council-ai
```

Run the app:

```bash
npm run dev
```

- Frontend: `http://localhost:3000`
- Backend: `http://localhost:3001`

## Project Structure

```text
config/          agents, executors, UI constants, debate constitution
backend/
  adapters/       provider adapters
  services/       debate loop, consensus, scoring, synthesis, storage
  routes/         Express routes
frontend/        React + Vite interface
storage/         local runtime data; public commits keep placeholders only
```

## Security

This public version is prepared without real credentials.

- Never commit `.env`.
- Never hardcode provider keys in source files.
- Keep `.env.example` symbolic.
- Do not commit saved sessions, private prompts, customer data, or local research artifacts.
- Publish from a fresh Git history if the private project ever contained secrets.

See [SECURITY.md](SECURITY.md) for the publishing checklist.

## License

MIT
