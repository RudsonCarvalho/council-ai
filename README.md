# AI Debate Platform

Uma plataforma web para colocar modelos de IA em debate estruturado, comparar argumentos em tempo real e transformar consenso em decisao acionavel.

Em vez de pedir uma resposta unica para um unico modelo, a plataforma organiza uma sala de deliberacao com agentes especializados. Cada IA defende uma perspectiva, le as respostas das demais, revisa suas posicoes e converge para uma sintese final.

## Proposta

AI Debate Platform ajuda equipes a tomar decisoes melhores quando o problema e complexo, caro ou cheio de trade-offs.

- Compare respostas de Claude, GPT, Gemini, Perplexity, DeepSeek, Grok e Mistral no mesmo fluxo.
- Defina moderador, participantes, tom do debate, regras da sala e contexto privado por agente.
- Injete arquivos, URLs, sessoes anteriores e briefings como memoria de decisao.
- Pause o debate para revisao humana, peca esclarecimentos e continue com mais contexto.
- Gere um documento final: decisao fundamentada, especificacao tecnica, artigo, pesquisa ou plano de negocio.
- Encaminhe a especificacao para executores locais, como Claude Code ou Aider, quando quiser transformar consenso em implementacao.

## Casos de uso

- Arquitetura de software e revisao de trade-offs.
- Analise de produto, mercado ou estrategia.
- Preparacao de decisoes executivas.
- Pesquisa comparativa com modelos que pensam de formas diferentes.
- Validacao de ideias antes de investir tempo de engenharia.
- Geracao de especificacoes tecnicas a partir de debate multiagente.

## Como funciona

```text
Usuario
  -> Problema, contexto e regras
  -> Agentes de IA debatem em rounds
  -> Moderador avalia progresso e consenso
  -> Humano pode pausar, orientar e adicionar contexto
  -> Sintetizador gera o documento final
  -> Executor opcional transforma a decisao em trabalho
```

## Stack

- Node.js e Express no backend.
- React, Vite e Zustand no frontend.
- MongoDB para persistencia de sessoes.
- SDKs oficiais ou APIs OpenAI-compatible para provedores de IA.
- Server-Sent Events para acompanhar respostas em streaming.

## Requisitos

- Node.js 18 ou superior.
- MongoDB acessivel localmente ou via URI.
- Chaves de API apenas dos provedores que voce deseja usar.
- Opcional: Claude Code CLI ou Aider para execucao de especificacoes.

## Instalacao

```bash
git clone https://github.com/SEU_USUARIO/ai-debate-platform.git
cd ai-debate-platform
npm run install:all
cp .env.example .env
```

Edite o arquivo `.env` com suas credenciais reais. O repositorio publico deve manter apenas valores simbolicos.

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

## Rodando em desenvolvimento

```bash
npm run dev
```

- Frontend: `http://localhost:3000`
- Backend: `http://localhost:3001`

## Configuracao dos agentes

Os agentes ficam em `config/agents.config.js`.

Cada agente pode definir:

- provedor e modelo padrao;
- modelos alternativos exibidos na UI;
- persona e estilo de argumentacao;
- limite de tokens, temperatura e custos estimados;
- variavel de ambiente usada como API key.

Para desabilitar um provedor no demo publico, altere `enabled` para `false`.

## Seguranca

Este repositorio foi preparado para publicacao sem credenciais reais.

- Nunca versionar `.env`.
- Nunca colocar chaves diretamente em arquivos de configuracao.
- Usar placeholders em `.env.example`.
- Revisar historico antes de publicar qualquer fork derivado de repositorio privado.
- Publicar com historico novo quando o projeto original ja conteve segredos.

Veja tambem [SECURITY.md](SECURITY.md).

## Estrutura

```text
backend/       API, rotas, adaptadores de IA e servicos
config/        configuracao de agentes, debate, UI e provedores
frontend/      interface React
storage/       diretorios locais de runtime, nao dados sensiveis
```

## Licenca

MIT
