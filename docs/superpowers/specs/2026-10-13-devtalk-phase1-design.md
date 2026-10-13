# DevTalk — Fase 1: Coach solo (design)

Data: 2026-10-13 · Status: aguardando revisão

## 1. Objetivo

App desktop para desenvolvedores praticarem inglês por **produção ativa** (escrever e, depois, falar).
O primeiro usuário é um estudante de Ciência da Computação de nível B1, travado no platô intermediário: lê
documentação sem esforço, mas repete o mesmo vocabulário simples e demora a montar frases complexas.
Meta: chegar a B2 na escrita e na fala em situações reais de trabalho.

A fase 1 é o **coach solo**: local, sem conta, útil sem nenhum outro usuário.

### Princípios
- Produzir, não consumir. Sem flashcards de vocabulário técnico nem exercícios de leitura.
- Errar precisa ser seguro: correções aparecem como diff, sem rótulos de "errado".
- Ferramenta de dev, não app infantil: sem mascotes, sem gamificação.

### Fora do escopo da fase 1
Contas, Supabase, parceiros, chat, salas de voz, LiveKit, voz e transcrição, atalho global. As fases 2 a 4 só
influenciam as **interfaces** da fase 1 (ver §4.3).

### Pronto quando
1. Abro o app, recebo um desafio, respondo e vejo correções, reescrita, expressões novas e checagem das obrigatórias.
2. As expressões novas voltam na revisão nas datas definidas pelo FSRS.
3. Os desafios seguintes cobram expressões vencidas, e o feedback confere o uso.
4. Todas as telas passaram pela conferência por screenshot nos temas claro e escuro, em janela pequena e grande.
5. Os testes do `core` passam sem acesso à rede.

## 2. Ciclo do coach

1. **Desafio.** O app escolhe a categoria e as expressões obrigatórias; o LLM escreve a situação.
   Categorias (`CHALLENGE_CATEGORIES`): `daily_update`, `code_review`, `bug_explanation`, `tech_interview`.
2. **Resposta.** O usuário escreve de 3 a 5 frases (o app avisa abaixo de 2 ou acima de 7 frases, mas não bloqueia).
3. **Feedback.** Correções diretas (cada uma com categoria fixa), reescrita natural de nível B2,
   2 ou 3 expressões novas e a checagem das obrigatórias.
4. **Revisão.** As expressões novas viram cartões FSRS. Os desafios seguintes exigem 1 ou 2 expressões com revisão
   vencida, e o feedback confere se foram usadas corretamente.

### Regras de domínio
- **Escolha da categoria (no core, determinística):** a categoria menos usada nos últimos 8 desafios; empate
  decidido por um gerador aleatório injetável (testável com seed).
- **Expressões obrigatórias:** de 1 a 2 cartões **já revisados ao menos uma vez** (estado FSRS `Learning`,
  `Review` ou `Relearning`) com `due <= agora`, começando pelos mais atrasados. Cartões novos, nunca revisados, não
  são exigidos. Se nenhum estiver elegível, o desafio vem sem obrigatórias.
- **O uso num desafio não altera o FSRS.** O agendamento só muda na tela Review. O uso correto conta para a métrica
  "expressões reutilizadas".
- **Expressões duplicadas:** comparadas pelo `normalized_text` (minúsculas, espaços colapsados, sem pontuação nas
  pontas). Se já existir, não é criada de novo; o feedback só registra a ligação.
- **Cartão novo:** criado com `createEmptyCard(agora)` do `ts-fsrs`, portanto já aparece na fila de Review.
- **Categorias de erro (`MISTAKE_CATEGORIES`, lista fixa):** `articles`, `verb_tense`, `prepositions`,
  `word_order`, `word_choice`, `collocation`, `subject_verb_agreement`, `plurals`, `missing_word`, `register`,
  `off_task` (a resposta não atende ao desafio).

## 3. Stack

- Electron + TypeScript (strict) + React, com `electron-vite` (dev/build) e `electron-builder` (pacote e rebuild
  do módulo nativo).
- SQLite com `better-sqlite3`; `ts-fsrs` para o agendamento.
- `zod` para todos os contratos (JSON do LLM e entrada do IPC).
- LLM: `@anthropic-ai/sdk` no processo principal. Modelo padrão `claude-opus-5-5`, editável em Settings.
  Ollama entra no último passo da fase 1.
- Testes: `vitest` no core; Playwright (`_electron`) para e2e e screenshots.

## 4. Arquitetura

### 4.1 Pastas

```
DevTalk/
├─ prompts/                  # editáveis; lidos pelo main em runtime
│  ├─ coach.md
│  └─ challenge.md
├─ src/
│  ├─ core/                  # TS puro: sem Electron, React, fs ou rede
│  │  ├─ domain/             # tipos, MISTAKE_CATEGORIES, CHALLENGE_CATEGORIES, normalizeExpression
│  │  ├─ llm/                # LLMProvider, generateStructured (zod + 1 nova tentativa), erros tipados
│  │  ├─ feedback/           # FeedbackEngine, FeedbackSchema
│  │  ├─ challenges/         # ChallengeGenerator, pickCategory, pickRequiredExpressions, ChallengeSchema
│  │  ├─ srs/                # wrapper do ts-fsrs
│  │  ├─ progress/           # agregações de progresso
│  │  ├─ prompts/            # renderTemplate({campo})
│  │  └─ ports.ts            # interfaces de repositório e Clock
│  ├─ main/
│  │  ├─ db/                 # migrations SQL versionadas + repositórios
│  │  ├─ llm/                # AnthropicProvider, FakeProvider (só fora do app empacotado)
│  │  ├─ vault/              # chave da API via safeStorage
│  │  ├─ ipc/                # handlers; entrada validada com zod; cancelamento por requestId
│  │  └─ index.ts
│  ├─ preload/index.ts       # window.devtalk
│  ├─ shared/ipc-contract.ts # tipos comuns a main, preload e renderer
│  └─ renderer/
│     ├─ design-system/      # tokens, temas, componentes base
│     └─ screens/
├─ tests/core/  tests/main/  tests/e2e/
├─ supabase/                 # vazio até a fase 2
└─ README.md
```

### 4.2 Fronteiras

- `core/` só depende de `zod` e `ts-fsrs`. Recebe repositórios, relógio, provedor de LLM e os textos dos prompts
  por injeção. Nunca lê arquivos.
- `main/` implementa as portas: SQLite, `safeStorage`, provedores de LLM, leitura de `prompts/`.
- `renderer/` só fala com o main via `window.devtalk`. Nunca recebe a chave da API, só `hasKey: boolean`.

### 4.3 Interfaces centrais

```ts
interface LLMProvider {
  id: 'anthropic' | 'ollama' | 'fake';
  generateJson(req: {
    system: string;
    user: string;
    jsonSchema: object;          // gerado a partir do schema zod
    signal: AbortSignal;
  }): Promise<string>;           // texto bruto; a validação fica no core
}

type TextSource = 'typed' | 'chat' | 'transcript' | 'selection';

interface FeedbackInput {
  text: string;
  source: TextSource;            // guardado só para estatística; o motor não o usa
  context:
    | { kind: 'challenge'; challenge: Challenge; required: Expression[] }
    | { kind: 'free'; situation?: string };   // revisão de mensagem de chat (fase 2), seleção (fase 4)
  learner: LearnerProfile;
}

class FeedbackEngine { review(input: FeedbackInput, signal: AbortSignal): Promise<Feedback> }
class ChallengeGenerator { next(learner: LearnerProfile, signal: AbortSignal): Promise<Challenge> }
```

`generateStructured(provider, schema, req)`: chama o provedor, faz `JSON.parse` e `schema.safeParse`. Se falhar,
tenta **uma** vez mais, anexando ao prompt do usuário o erro de validação resumido. Se falhar de novo, lança
`LLMInvalidOutputError`.

### 4.4 Fluxo de um feedback

1. Renderer chama `devtalk.feedback.submit({ requestId, challengeId, text })`.
2. Main valida a entrada com zod, monta o `FeedbackInput`, cria um `AbortController` guardado por `requestId` e chama
   `FeedbackEngine.review`.
3. Durante a espera, o main emite eventos de progresso (`sending`, `waiting`, `validating`, `retrying`) para a tela
   mostrar o estágio e o tempo decorrido.
4. `devtalk.feedback.cancel(requestId)` aborta a chamada; a tela volta ao editor com o texto intacto.
5. Com sucesso, numa única transação: grava `attempts`, `feedbacks`, `corrections`, `expression_checks`,
   novas `expressions` e seus `review_cards`.

### 4.5 API do preload (`window.devtalk`)

```
profile.get() / profile.save(p)
keys.status() -> { hasKey } / keys.set(key) / keys.clear()
challenges.next({ requestId }) / challenges.cancel(requestId)
feedback.submit({ requestId, challengeId, text }) / feedback.cancel(requestId)
feedback.onProgress(cb) -> unsubscribe
review.queue() / review.rate({ expressionId, rating })
progress.summary() / progress.history({ cursor })
settings.get() / settings.set(partial)
```

Nada além disso é exposto. Cada canal tem schema zod no `shared/ipc-contract.ts`, validado no main.

## 5. Modelo de dados (SQLite)

Migrations SQL versionadas (`PRAGMA user_version`). `foreign_keys = ON`, WAL ativo. Datas em ISO-8601 UTC.

| Tabela | Campos |
|---|---|
| `profile` (linha única, `id = 1`) | native_language, current_level, target_level, explanation_language, provider, model, theme (`system`/`dark`/`light`), onboarded_at |
| `challenges` | id, category, situation, interlocutor, task, summary, created_at |
| `challenge_required` | challenge_id, expression_id, hint — PK (challenge_id, expression_id) |
| `attempts` | id, challenge_id (nulo quando `context.kind = 'free'`), text, source, created_at |
| `feedbacks` | id, attempt_id, natural_rewrite, provider, model, latency_ms, raw_json, created_at |
| `corrections` | id, feedback_id, position, original, corrected, explanation, category (CHECK na lista fixa) |
| `expression_checks` | feedback_id, expression_id, used, used_correctly, note |
| `expressions` | id, text, normalized_text (UNIQUE), type (`chunk`/`phrasal_verb`/`collocation`), meaning, example, origin_feedback_id, created_at |
| `feedback_expressions` | feedback_id, expression_id — liga as expressões sugeridas num feedback, inclusive as que já existiam |
| `review_cards` | expression_id (PK), due, stability, difficulty, elapsed_days, scheduled_days, learning_steps, reps, lapses, state, last_review |
| `review_logs` | id, expression_id, rating, state, due, stability, difficulty, elapsed_days, scheduled_days, review (data), created_at |

A chave da API fica fora do banco, num arquivo cifrado com `safeStorage` no diretório de dados do app.

### Progresso (consultas)
- **Histórico:** tentativas com desafio, data, número de correções; paginado.
- **Erros recorrentes:** contagem por categoria, nos últimos 30 dias e no total.
- **Expressões reutilizadas:** número de expressões distintas com ao menos um `used_correctly = true`.
- **Revisão:** cartões vencidos hoje e total de expressões.

## 6. Prompts

Ficam em `prompts/*.md`, lidos pelo main a cada uso (editar não exige rebuild em dev). Campos `{nome}` são
preenchidos por `renderTemplate`; campo ausente lança erro (testado).

### 6.1 `prompts/coach.md`
O prompt do coach do enunciado, **sem alterações**, com os campos `{native_language}`, `{current_level}`,
`{target_level}`, `{explanation_language}`, `{mistake_categories}` e `{feedback_schema}`.
`{feedback_schema}` recebe o exemplo de JSON do enunciado; o formato também é imposto pela saída estruturada do
provedor. A mensagem do usuário é montada assim:

```
Challenge category: {category}
Situation: {situation}
Interlocutor: {interlocutor}
Task: {task}
Required expressions: {required_expressions | "none"}

Learner's answer:
"""
{text}
"""
```

No modo `free` (fase 2 em diante), as linhas do desafio são trocadas por `Context: {situation | "a chat message to
another developer"}` e `Required expressions: none`.

Schema zod do feedback: `corrections` (0 ou mais; `category` no enum fixo), `natural_rewrite` (não vazio),
`new_expressions` (2 a 3; `type` no enum), `required_expressions_check` (um item para cada obrigatória enviada; o
core confere que os nomes batem e ignora itens extras).

### 6.2 `prompts/challenge.md` (rascunho para revisão)

```
You write short, realistic workplace scenarios for an English coach used by software developers.

Learner: native language {native_language}, current level {current_level}, target level {target_level}.

Write one challenge for the category "{category}":
- daily_update: the learner gives a stand-up update (done, next, blockers).
- code_review: the learner disagrees politely, asks for changes, or justifies a choice in a review.
- bug_explanation: the learner explains the cause of a bug and the fix to someone.
- tech_interview: the learner answers an interview question such as "tell me about a hard project".

Rules:
- situation: 2 to 3 sentences, concrete and believable (a real stack, a real problem, a real constraint). Write it
  in plain B1-B2 English. Do not write the learner's answer for them.
- interlocutor: who the learner is talking to and the relationship (e.g. "Priya, a senior backend engineer
  reviewing your PR").
- task: one sentence saying exactly what the learner must say or write, answerable in 3 to 5 sentences.
- Required expressions: {required_expressions}. Build the situation so each one fits naturally in a good answer.
  For each, add a short hint (in {explanation_language}) about where it fits, without giving away the full
  sentence. If the list is "none", return an empty list.
- Do not repeat or closely paraphrase any of these recent situations: {recent_situations}.
- summary: a 3 to 8 word label of the situation, used to avoid repeats.

Return only valid JSON that matches {challenge_schema}.
```

Schema do desafio:

```json
{
  "category": "daily_update | code_review | bug_explanation | tech_interview",
  "situation": "...",
  "interlocutor": "...",
  "task": "...",
  "required_expressions": [{"expression": "...", "hint": "..."}],
  "summary": "..."
}
```

O core confere que `category` e as expressões devolvidas batem com as pedidas; divergência conta como saída
inválida (dispara a nova tentativa). `{recent_situations}` recebe os `summary` dos últimos 10 desafios. **Cartões de tema das salas de voz (fase 2):**
o mesmo arquivo ganha uma segunda seção com seu próprio schema (`theme`, `prompt_for_each_speaker`,
`suggested_expressions`); na fase 1 só o modo desafio é implementado.

## 7. Provedor Anthropic

- Chamadas só no main, com `output_config.format` (JSON Schema gerado do zod) e validação zod em seguida.
- `effort` explícito (`medium` por padrão) e `max_tokens` suficiente para não truncar.
- `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`) ligado, para recusas indevidas.
- `stop_reason` conferido antes de ler o conteúdo (`refusal` e `max_tokens` viram erros tipados).
- Cancelamento com `AbortSignal`. As novas tentativas automáticas do SDK (429/5xx) continuam ligadas.
- A API exata do SDK é conferida na documentação no momento da implementação.

## 8. Erros (todos com mensagem amigável e o texto do usuário preservado)

| Situação | Comportamento |
|---|---|
| Sem chave | A tela leva a Settings › API key |
| 401 | "Your API key was rejected." + link para Settings |
| 429 / 5xx / rede (após as tentativas do SDK) | "The coach is unavailable right now." + botão Try again |
| JSON inválido duas vezes | "The coach returned something unexpected." + Try again |
| Recusa ou `max_tokens` | Mensagem específica + Try again |
| Cancelado pelo usuário | Volta ao editor, sem mensagem de erro |
| Prompt com campo ausente | Erro de desenvolvimento, aparece nos testes |

## 9. Telas da fase 1

Barra lateral: Home, Practice, Review, People, Rooms, Progress, Settings. People e Rooms aparecem com um estado
vazio honesto ("Coming in a later version"), sem funcionalidade.

- **Onboarding** (3 passos): idioma nativo, nível atual e alvo, idioma das explicações; chave da API, com uma linha
  explicando que o texto praticado só sai da máquina para o provedor de LLM escolhido.
- **Home:** próximo desafio, revisões vencidas, últimos erros recorrentes.
- **Practice:** desafio (situação, interlocutor, tarefa, obrigatórias com dica) e editor de resposta com contagem
  de frases; enviar com Ctrl+Enter.
- **Feedback:** correções como diff (removido em vermelho, adicionado em verde, fonte mono), explicação e categoria;
  reescrita natural; cartões das expressões novas com selo do tipo; checagem das obrigatórias.
- **Review:** um cartão por vez; revelar; Again / Hard / Good / Easy (teclas 1–4) com o próximo intervalo visível.
- **Progress:** histórico, erros por categoria, expressões reutilizadas.
- **Settings:** perfil, provedor e modelo, chave da API (definir, trocar, remover), tema.
- **Paleta Ctrl+K** e atalhos para navegar e agir.

Todas as telas têm estados vazio, carregando e erro.

## 10. Parte visual (processo)

1. Antes de qualquer tela, ler as skills de design disponíveis (`frontend-design`, `impeccable`,
   `design:design-system`, `design:accessibility-review`, `emil-design-eng`) e seguir as instruções delas.
2. Propor a direção visual (paleta, tipografia, componentes) e mockups de Home, Feedback e sala de voz.
   **Parar e esperar o OK.**
3. Tokens únicos (cores, espaçamentos, tipografia, raios, movimento) com tema escuro padrão e tema claro;
   depois os componentes base; só então as telas.
4. Requisitos: contraste WCAG AA, foco visível, navegação completa por teclado, `prefers-reduced-motion`
   respeitado, fonte sem serifa legível com altura de linha confortável e fonte mono nos diffs, interface em
   inglês simples, sem código, marca ou assets de terceiros.
5. Conferência: Playwright com Electron e `FakeProvider` (respostas fixas), screenshots de cada tela em
   {escuro, claro} × {960×640, 1440×900}. Corrigir o que estiver errado antes de dar o passo por concluído.

## 11. Segurança

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `webSecurity` ligado.
- CSP restritiva no renderer; navegação externa e `window.open` bloqueados; IPC aceita só o frame da janela
  principal.
- Chave da API só no main, cifrada com `safeStorage`. Se o keyring do sistema não estiver disponível
  (`safeStorage.isEncryptionAvailable()` falso), o app avisa e não grava a chave em texto puro.
- `FakeProvider` só existe quando `!app.isPackaged`.
- Antes de distribuir: script que abre o `app.asar` e procura padrões de segredo (`sk-ant-`, `service_role`, etc.) e
  confere a lista de funções expostas pelo preload.

## 12. Testes

- **`tests/core` (vitest, Node puro, sem rede):** render de prompt; `normalizeExpression`; `generateStructured`
  (válido, inválido e depois válido, inválido duas vezes, abort); `FeedbackEngine` (persistência via repositórios em
  memória, deduplicação, checagem das obrigatórias); `pickCategory` com seed; `pickRequiredExpressions` com relógio
  fixo; wrapper FSRS; agregações de progresso.
- **`tests/main`:** repositórios SQLite e migrations, rodando sob o Node do Electron (`ELECTRON_RUN_AS_NODE=1`) para
  usar o binário nativo correto.
- **`tests/e2e`:** fluxo completo com `FakeProvider` (onboarding → desafio → feedback → review) e screenshots.
- **Smoke manual:** `npm run smoke:llm` faz uma chamada real ao provedor com a chave guardada.

## 13. Passos de implementação

1. Base do projeto: electron-vite, TS estrito, vitest, flags de segurança, janela vazia.
2. Núcleo do coach: domínio, schemas, prompts, `generateStructured`, `FeedbackEngine`.
3. Revisão e desafios: SRS, seleção de vencidas, `ChallengeGenerator`, progresso.
4. Processo principal: migrations, repositórios, cofre, `AnthropicProvider`, IPC, preload, smoke.
5. Visual: leitura das skills, direção visual e mockups — **parar para o OK**.
6. Tokens e componentes base.
7. Telas, paleta Ctrl+K e atalhos.
8. Conferência por screenshot, correções e README.
9. `OllamaProvider` e seletor de provedor.

Ao fim de cada passo: como testar.
