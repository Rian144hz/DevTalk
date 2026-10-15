# DevTalk — Fase 2B.2: chat privado com correções

Data: 2026-10-15. Aprovado em conversa, parte por parte, com o dono do projeto.

## 1. Objetivo

Dois membros conversam em particular, em inglês, e corrigem um ao outro como o coach faz (diff). O coach pode
checar a sua mensagem antes de enviar.

### Decisões do dono

- **Abrir conversa:** pedido com uma primeira mensagem curta, pelo botão **"Send message"** no perfil. A conversa só
  abre se a outra pessoa aceitar. Recusar é silencioso.
- **Privado:** só as duas pessoas leem. Numa denúncia de mensagem, o moderador vê a mensagem e as 10 anteriores.
- **Correções:** "Suggest a correction" numa mensagem do outro → diff embaixo dela; o autor pode marcar **Thanks**.
- **Coach:** "Check with the coach" mostra o diff da sua mensagem antes de enviar; só o seu texto vai ao seu LLM;
  nada é salvo em Review.
- **Guardar:** mensagens ficam; cada um apaga as suas ("Message deleted"); excluir a conta apaga tudo da pessoa;
  bloquear fecha a conversa para os dois.
- **Lugar:** item **Messages** no menu lateral, com o número de não lidas.
- **Ao vivo:** Supabase Realtime no processo principal.
- **Diff master** (selo de comunidade, violeta): 25 correções dadas que receberam Thanks.
- Correções dadas contam no gráfico de prática da comunidade.

### Fora do escopo

Salas de voz (2C); grupos; anexos, imagens, emojis próprios, reações; mensagens editáveis; notificações do sistema
operacional; busca nas conversas.

### Pronto quando

1. Pedir conversa pelo perfil, aceitar/recusar, conversar ao vivo, ver não lidas no menu.
2. Corrigir mensagem do outro (diff), receber Thanks; Diff master aos 25 Thanks.
3. Checar a própria mensagem com o coach antes de enviar.
4. Apagar a própria mensagem; bloquear fecha; denunciar mensagem com contexto só para moderadores.
5. Testes de banco, unidade e e2e verdes; prints nos dois temas; revisão de design e revisão final.
6. 0008 colada no Supabase; documentos legais com nova versão.

## 2. Banco — migração `0008_chat.sql`

0001–0007 estão no ar; a 0008 é colada sozinha.

### Tabelas

- `conversations (id uuid, a uuid, b uuid, requested_by uuid, status, created_at, responded_at, last_message_at)`:
  `a < b` (par ordenado, único), `status in ('pending','accepted','declined')`, cascade de `auth.users`.
- `messages (id bigint, conversation_id, sender, body, created_at, deleted_at)`: `body` 1–2 000 caracteres;
  apagada = `body` vazio e `deleted_at` preenchido. Cascade da conversa e do remetente.
- `corrections (id bigint, message_id, author, corrected, created_at, thanked_at)`: `corrected` 1–2 000; única por
  `(message_id, author)`; o autor nunca é o remetente da mensagem. Cascade da mensagem e do autor.
- `conversation_reads (conversation_id, user_id, last_read_at)`: para não lidas.
- `report_messages (report_id, message_id, sender, body, created_at)`: cópia da mensagem denunciada e das 10
  anteriores, feita no momento da denúncia (sobrevive se a mensagem for apagada depois); sem acesso de cliente.
- `practice_days.corrections int not null default 0` (0–2 000).

### Regras

- **Ler** conversa, mensagens, correções: só os dois participantes, membros ativos, sem bloqueio entre eles. Nem
  moderadores leem conversas.
- **Pedido** — função `request_conversation(target, body)`: membro ativo com perfil; alvo visível
  (`can_see_profile`) e com perfil; não a si mesmo; no máximo 10 pedidos novos por dia; se já existe conversa
  `accepted`, devolve a mesma; `pending` de quem pediu, devolve a mesma; `declined` há menos de 30 dias → mesma
  resposta de sucesso, sem nada novo (silencioso); depois de 30 dias, volta a `pending` com a nova mensagem.
  A primeira mensagem fica em `messages`; só os dois a veem.
- **Responder** — `respond_conversation(id, accept)`: só quem recebeu, só se `pending`.
- **Enviar** — insert direto em `messages`: remetente = eu, conversa `accepted`, membro ativo, sem bloqueio;
  no máximo 500 mensagens por dia por pessoa.
- **Apagar** — `delete_message(id)`: só o remetente; esvazia o texto e apaga as correções dela.
- **Corrigir** — insert direto em `corrections`: participante, não o remetente, mensagem não apagada, conversa
  `accepted`; até 200 por dia. **Thanks** — `thank_correction(id)`: só o remetente da mensagem.
- **Lido** — `mark_read(conversation_id)`.
- **Listar** — `my_conversations()` → id, a outra pessoa (id, nome, foto?, mascote), estado, quem pediu, prévia da
  última mensagem (ou "Message deleted"), hora, não lidas. Pedidos recusados aparecem para quem pediu como
  `pending` (silencioso).
- **Denúncia** — gatilho em `reports` com `context_type = 'message'`: se quem denuncia participa da conversa, copia
  a mensagem e as 10 anteriores para `report_messages`. `report_context(report_id)` só para moderadores.
- **Diff master** — `profile_badges` passa a incluir `diff_master` com 25+ correções com Thanks.
- **Gráfico** — gatilho em `corrections` soma 1 em `practice_days.corrections` do autor, no dia do fuso do perfil;
  pontos do dia = respostas × 5 + revisões + correções × 5; dia ativo para a sequência se qualquer um > 0.
- **Realtime** — `messages`, `corrections` e `conversations` entram na publicação `supabase_realtime`.
- Excluir conta apaga conversas, mensagens e correções da pessoa (cascade); cópias em denúncias ficam sem remetente.

## 3. Processo principal e IPC

- `SocialBackend`: `conversations()`, `messages(conversationId, before?)`, `requestConversation(userId, body)`,
  `respondConversation(id, accept)`, `sendMessage(conversationId, body)`, `deleteMessage(id)`,
  `suggestCorrection(messageId, corrected)`, `thankCorrection(id)`, `markRead(conversationId)`,
  `reportContext(reportId)` (moderadores). Backend falso com paridade e semente com conversas.
- **Ao vivo:** o main assina o Realtime depois de entrar na comunidade e envia `chat:event` para a janela
  (`message`, `correction`, `conversation`); reconecta e manda a janela buscar de novo ao voltar a rede.
- `chat:check {text}` → coach em modo livre ("a chat message to another developer"), devolve reescrita e correções;
  nada é salvo no banco local.
- Canais com zod, mesmo padrão; mensagens de limite em inglês simples.

## 4. Telas

- Menu: **Messages** com contador de não lidas.
- **Messages:** à esquerda conversas e pedidos (foto/mascote, nome, prévia, hora, não lidas); à direita a conversa:
  mensagens agrupadas, correção em diff embaixo da mensagem, **Thanks**; menu da mensagem: **Suggest a correction**
  (só nas do outro), **Delete** (só nas suas), **Report**.
- **Pedido recebido:** a primeira mensagem + **Accept** / **Decline**. **Pedido enviado:** "Waiting for <name>".
- **Campo:** texto (2 000), **Check with the coach** (diff + "Use this version" / "Keep mine"), **Send**.
- **Perfil:** botão **Send message** (abre a conversa ou o formulário do pedido).
- **Moderação:** denúncia de mensagem mostra o contexto copiado.
- Estados vazio, carregando, erro e sem rede; textos em inglês simples (B1).

## 5. Documentos

- Privacidade: mensagens no servidor, só os dois leem, contexto em denúncias, coach só com o seu texto.
- Termos: chat em "What you share". Nova versão datada → todos aceitam de novo.
- DESIGN.md: lista de conversas, balões, correção em diff, campo com coach.

## 6. Testes e no ar

- Banco (PGlite): leitura só dos dois; pedido, recusa silenciosa e 30 dias; limites; bloqueio; apagar; correção
  (não a própria, não apagada); Thanks só do remetente; denúncia copia 11 mensagens e só moderador lê; exclusão de
  conta; Diff master; gráfico.
- Unidade (backend falso e Supabase, canais), e2e com conversa semeada, prints nos dois temas, revisão de design,
  revisão final (Opus). Testes de unidade com `--maxWorkers=2`.
- No ar: colar `0008_chat.sql` sozinho; testar com uma segunda conta.
