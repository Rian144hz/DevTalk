# DevTalk — Fase 2A: Base social (design)

Data: 2026-10-14 · Status: aguardando revisão · Depende de: fase 1 (na `main`)

## 1. Objetivo

Criar a base da parte social: contas, perfil público, aceite de documentos, segurança (bloquear, denunciar,
moderação) e direitos LGPD (exportar e apagar). É a fundação que a 2B (parceiros e chat) e a 2C (salas de voz)
vão usar.

### Decisões confirmadas com o usuário
- A fase 2 foi dividida em 2A (esta), depois 2B (parceiros e chat), depois 2C (salas de voz). Cada uma tem a sua
  própria spec, plano e implementação.
- No começo, o usuário testa com amigos, mas o produto deve estar pronto para ser aberto depois.
- Login por e-mail + código de 6 dígitos (OTP). Sem senha e sem abrir navegador.
- Tela de moderação dentro do app, visível só para moderadores.
- Foto de perfil opcional.
- Logos das stacks numa cor só, com Simple Icons (CC0). Isso é uma **exceção** à regra do brief "não usar marca
  de terceiros", a ser registrada no PRODUCT.md. O uso é só para identificar a tecnologia.
- Abordagem A: o cliente Supabase roda **só no processo principal**. A janela continua sem acesso à rede e o
  token de sessão fica cifrado.
- Os serviços usados são gratuitos e não pedem cartão (Supabase Free).

### Fora do escopo da 2A
- Busca e sugestão de parceiros, pedidos de conexão, chat (2B).
- Salas de voz e LiveKit (2C).
- Nesta fase, o usuário não consegue encontrar o perfil de outra pessoa. Por isso, bloquear e denunciar existem
  como banco + IPC + componentes de interface e são testados, mas só aparecem em telas de outras pessoas a partir
  da 2B.

### Pronto quando
1. A pessoa entra com e-mail + código, aceita os documentos, confirma ter 18+ e cria o perfil (com foto e logos
   de stack opcionais).
2. Ela vê e edita o próprio perfil na aba People e sai da conta em Settings › Account.
3. Ela exporta os dados (JSON) e apaga a conta. O apagamento remove tudo no servidor e, opcionalmente, os dados
   locais de estudo.
4. Um moderador vê as denúncias abertas na tela Moderation e consegue descartar, avisar e suspender. Uma conta
   suspensa some das leituras dos outros e não consegue criar denúncias nem editar o perfil.
5. As regras RLS estão cobertas por testes que rodam offline (PGlite). O app tem e2e com um backend social falso.
   Todas as telas novas passaram pela conferência por screenshot nos dois temas.

## 2. Arquitetura

```
renderer (React)  ──IPC (zod)──▶  main: SocialService  ──▶  SocialBackend (porta)
                                                          ├─ SupabaseBackend (supabase-js, sessão no keyring)
                                                          └─ FakeSocialBackend (e2e; só sem app.isPackaged)
```

- `src/core/social/`: tipos de domínio (Profile, Report…), validação zod dos campos de perfil e regras puras
  (por exemplo, normalização de tags de stack). Segue sem dependências de Electron/React.
- `src/main/social/`:
  - `SocialBackend`: interface (porta);
  - `SupabaseBackend`;
  - `FakeSocialBackend`;
  - armazenamento de sessão cifrado (adaptador `storage` do supabase-js sobre `safeStorage`, arquivo
    `social-session.bin`);
  - handlers IPC `social:*`, `safety:*` e `moderation:*`.
- **Configuração:** URL do projeto e **chave publicável** em variáveis de build `MAIN_VITE_SUPABASE_URL` e
  `MAIN_VITE_SUPABASE_PUBLISHABLE_KEY`, num `.env` local fora do git, com um `.env.example` versionado. A chave
  secreta (service_role) **nunca** vai para o app: ela vive só nas Edge Functions.
- **Sem configuração:** sem essas variáveis, a aba People mostra "Community is not set up in this build".
- **Avatares:** bucket privado. O main baixa a imagem com a sessão e entrega à janela como `data:` URL. A CSP
  continua `img-src 'self' data:`.

## 3. Conta e login

1. Settings › Account ou a aba People leva a "Join the community". A pessoa digita o e-mail e o app chama
   `signInWithOtp({ email, options: { shouldCreateUser: true } })`.
2. A tela pede o código de 6 dígitos. O app chama `verifyOtp({ email, token, type: 'email' })`. Há botão
   "Send a new code" com espera de 60 s.
3. Na primeira entrada (sem linha em `profiles`), vem o fluxo **Join**:
   - aceitar Terms, Privacy Policy e Code of Conduct (cada um abre o texto completo);
   - marcar "I am 18 or older";
   - preencher o perfil.

   Nada é gravado no perfil antes dos aceites.
4. A sessão é renovada automaticamente no main. "Sign out" apaga a sessão local.

Mensagens de erro (inglês simples, com a próxima ação):

| Situação | Mensagem |
|---|---|
| Código errado ou expirado | "That code did not work. Check it or send a new one." |
| Limite de e-mails do Supabase | "Too many codes were sent. Wait a few minutes and try again." |
| Sem internet | "You are offline. Your practice still works; the community needs a connection." |
| Projeto pausado por inatividade | "The community server is asleep. Try again in a minute." |
| Conta suspensa | "Your account is suspended until {data}." |

## 4. Perfil público

Visível só para pessoas logadas, e nunca para contas bloqueadas (nos dois sentidos) nem para contas suspensas.

| Campo | Regra |
|---|---|
| `display_name` | 2–40 caracteres |
| `native_language` | uma da lista do app (a mesma da fase 1) |
| `level` | A2, B1, B2, C1 ou C2 |
| `timezone` | IANA, detectado do sistema e editável |
| `area` | `backend`, `frontend`, `mobile`, `data`, `devops` ou `other` |
| `stack` | até 10 tags, cada uma com até 30 caracteres, normalizadas (minúsculas, sem espaços duplicados); autocompletar com a lista de stacks conhecidas |
| `availability` | até 14 faixas `{ day: 0–6, from: "HH:MM", to: "HH:MM" }` no fuso da pessoa |
| `bio` | opcional, até 160 caracteres |
| `avatar_path` | opcional |

- O e-mail não faz parte do perfil e nunca é lido por outras pessoas.
- O nível e o idioma vêm preenchidos a partir do perfil local da fase 1.

### Foto
- A pessoa escolhe a imagem. A janela recorta no centro, redimensiona para 256×256 e reencoda em WebP (qualidade
  0,8) via canvas, o que **remove o EXIF e o GPS**. Envia os bytes ao main.
- O main valida: WebP, no máximo 200 KB. Então grava em `avatars/{uid}/avatar.webp`.
- Arquivo de entrada até 8 MB; tipos aceitos: JPEG, PNG e WebP.
- Ações: "Change photo" e "Remove photo". Sem foto, a inicial do nome aparece num círculo.

### Logos das stacks
- `simple-icons` (CC0) com um mapa curado de cerca de 150 stacks comuns (tag → ícone), gerado em build. Só
  esses ícones entram no bundle.
- O ícone é desenhado em `currentColor` (tom do texto), 14 px, ao lado do nome. Tags sem ícone ficam só como
  texto.

## 5. Banco (Supabase Postgres)

Migrations em `supabase/migrations/*.sql`, com **RLS em todas as tabelas** e **GRANTs explícitos** para
`authenticated` (projetos novos do Supabase exigem isso). O papel `anon` não recebe acesso a nada.

| Tabela | Colunas principais |
|---|---|
| `profiles` | `id uuid pk → auth.users on delete cascade`, campos da §4, `suspended_until timestamptz`, `created_at`, `updated_at` |
| `consents` | `user_id`, `document` (`terms`/`privacy`/`conduct`/`age_18`), `version`, `accepted_at`; pk (`user_id`, `document`, `version`) |
| `blocks` | `blocker`, `blocked`, `created_at`; pk dupla; check `blocker <> blocked` |
| `reports` | `id`, `reporter`, `reported`, `context_type` (`profile`/`message`/`room`), `context_id`, `reason` (`harassment`/`hate`/`sexual`/`spam`/`impersonation`/`minor`/`other`), `details` (≤1000), `status` (`open`/`dismissed`/`actioned`), `resolved_by`, `resolved_at`, `created_at` |
| `moderators` | `user_id pk`. Preenchida manualmente pelo dono no SQL editor |
| `moderation_actions` | `id`, `target`, `moderator`, `action` (`warn`/`suspend`/`unsuspend`), `reason`, `until`, `report_id`, `created_at` |
| `notices` | `id`, `user_id`, `message`, `created_at`, `read_at` (avisos de moderação para a pessoa) |

### Funções (`security definer`, `search_path` fixo)
- `is_moderator()`
- `is_blocked_between(a, b)`
- `is_active(uid)`: não suspenso agora.

### RLS
- **`profiles`**
  - select: a própria linha; ou, para outras pessoas, linhas ativas sem bloqueio entre as duas; moderador vê tudo.
  - insert/update: só a própria linha e só se `is_active`; `suspended_until` não é editável pelo dono (trigger).
- **`consents`**: select e insert da própria pessoa; sem update e sem delete (o histórico é imutável).
- **`blocks`**: select, insert e delete onde `blocker = auth.uid()`.
- **`reports`**
  - insert: `reporter = auth.uid()`, pessoa ativa, `reported <> reporter`, no máximo 20 por dia (trigger).
  - select: o próprio autor (só as suas) ou moderador.
  - update: só moderador, e só os campos de status.
- **`moderation_actions`**: insert e select só para moderador. Um trigger aplica `suspend`/`unsuspend` em
  `profiles.suspended_until` e cria a `notice` do `warn`.
- **`notices`**: select e update (`read_at`) da própria pessoa.
- **Storage `avatars`** (bucket privado):
  - leitura: `authenticated` ativo;
  - escrita e remoção: só no prefixo `{auth.uid()}/`.

## 6. Edge Function `delete-account` (Deno)

1. Valida o JWT.
2. Apaga `avatars/{uid}/*`.
3. Chama `auth.admin.deleteUser(uid)` com a chave secreta (variável de ambiente da função). As linhas em cascata
   saem junto.

Antes de apagar, o app confirma: a pessoa digita o próprio e-mail. A opção "Also delete my practice data on this
computer" apaga `devtalk.sqlite` e as chaves locais. Os relatórios que outras pessoas fizeram sobre ela
permanecem para a moderação, sem o perfil (o `reported` vira nulo).

## 7. Exportar dados

O main lê, com a sessão da própria pessoa:
- o perfil;
- os aceites;
- os bloqueios feitos;
- as denúncias feitas;
- os avisos recebidos;
- a URL assinada da foto.

Opcionalmente inclui o banco local de estudo (como JSON). Grava tudo num arquivo escolhido em "Save as…"
(`dialog.showSaveDialog`).

## 8. Telas

- **People**:
  - deslogado: "Join the community", com o texto do que é a comunidade;
  - logado: o próprio perfil (foto ou inicial, nome, nível, idioma, fuso, área, stack com logos, horários, bio)
    com "Edit profile";
  - com avisos não lidos: aviso no topo.
- **Join / Sign in**: e-mail → código → documentos + 18+ → perfil, com indicador de passos ("Step 2 of 4").
- **Edit profile**: o mesmo formulário do Join.
- **Settings › Account**: e-mail da conta, Sign out, Export my data, Delete my account.
- **Moderation** (no menu só para moderadores; atalho na paleta):
  - lista de denúncias abertas (data, motivo, contexto, quem foi denunciado com nome e foto);
  - detalhe com histórico de ações sobre a pessoa;
  - ações: Dismiss, Warn (mensagem), Suspend (1, 7 ou 30 dias, ou permanente) e Unsuspend.
- **Componentes para a 2B**: `ReportDialog` (um `<dialog>` modal, porque precisa de foco protegido) e
  `BlockButton` (com confirmação). Eles aparecem na galeria de componentes.
- **Documentos**: `docs/legal/terms.md`, `privacy.md` e `code-of-conduct.md`, em inglês simples, com versão
  datada. São embutidos no app e mostrados numa tela de leitura. A política de privacidade descreve:
  - os dados coletados;
  - a finalidade;
  - a base legal (consentimento e execução do serviço);
  - o operador (Supabase, região São Paulo);
  - os direitos LGPD e como exercê-los no app;
  - o contato do responsável.

  Aviso registrado: os textos não substituem revisão jurídica.

Visual: segue o DESIGN.md (Galley Proof), com os mesmos tokens e componentes.
- Logos e avatar em tons do texto.
- Nenhuma cor nova.
- A tela de moderação usa listas com linhas de 1px, não cartões.

## 9. Testes

- **`tests/supabase/` (vitest, Node, offline)**:
  - aplica as migrations num PGlite com um *stub* mínimo do esquema `auth` (`auth.users` e `auth.uid()` lendo
    `request.jwt.claim.sub`) e dos papéis `authenticated`/`anon`;
  - testa cada regra RLS da §5 trocando de usuário com `set_config`: perfis bloqueados e suspensos invisíveis,
    limite de 20 denúncias, dono não consegue se des-suspender, só moderador modera, `anon` não lê nada, cascata
    ao apagar o usuário.
- **`tests/core/`**: validação do perfil (limites, tags, faixas de horário) e o mapa de stacks.
- **`tests/main/`**: `SocialService`/handlers com o `FakeSocialBackend`. Cobre:
  - mapeamento de erros (OTP inválido, 429, offline);
  - pipeline do avatar (rejeita outros formatos e tamanhos);
  - exportação.
- **`tests/e2e/`** (`DEVTALK_FAKE_SOCIAL=1`):
  - Join completo;
  - editar perfil com foto;
  - Settings › Account (sair, exportar, apagar);
  - moderação (o fake já tem denúncias semeadas);
  - screenshots das telas novas nos dois temas e tamanhos.
- **Smoke manual** contra o projeto real: `npm run cli -- --social-smoke` pede o e-mail e o código numa janela
  zenity, cria ou atualiza o perfil e lê de volta.

## 10. Preparação do Supabase

### Já feito (2026-10-14, guiado)
1. Projeto `devtalk` criado no plano Free, região São Paulo.
2. URL e chave publicável gravadas no `.env` local (fora do git). O endpoint de saúde respondeu 200.
3. **SMTP próprio** (Gmail `noreplaydevtalk@gmail.com` com senha de app). Ele é obrigatório: sem SMTP próprio,
   o Supabase só envia e-mail para membros da equipe do projeto e não deixa editar os modelos.
4. Os modelos "Confirm sign up" e "Magic link or OTP" mostram `{{ .Token }}`. No teste, o e-mail chegou só com o
   código numérico.

Detalhes para a implementação:
- O campo de código aceita de 6 a 10 dígitos, porque o comprimento é configurável no painel.
- O limite de e-mails com SMTP próprio é 30 por hora.

### A fazer quando o código existir (guiado, pelo navegador, sem CLI)
1. **Banco:** o app gera um único `supabase/setup.sql`, com todas as migrations em ordem. A pessoa cola no SQL
   Editor e clica em Run.
2. **Função `delete-account`:** criar em Edge Functions › Deploy a new function › editor do painel, colando o
   código. `SUPABASE_SERVICE_ROLE_KEY` já existe no ambiente das funções e nunca sai do servidor.
3. **Moderador:** entrar no app uma vez e, no SQL Editor, rodar
   `insert into moderators (user_id) select id from auth.users where email = '<seu e-mail>';`.

Projetos grátis pausam após 7 dias sem uso. A reativação é no painel (Restore), e o app explica isso na mensagem
de erro.
