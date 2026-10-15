# DevTalk — Fase 2B.1: achar pessoas (lista de membros, perfis, seguir, curtir)

Data: 2026-10-15. Aprovado em conversa, parte por parte, com o dono do projeto.

## 1. Objetivo

Os membros da comunidade passam a se encontrar: uma lista de membros com filtros, o perfil completo de outra
pessoa, seguir e curtir perfis. É a primeira metade da fase 2B; a segunda (2B.2) traz parceiros e chat.

### Decisões confirmadas com o usuário

- A 2B foi dividida: **2B.1 = pessoas** (esta), **2B.2 = parceiros e chat**.
- **Curtidas:** qualquer membro curte o perfil de outro; o **número é público** ("♥ 12"). O PRODUCT.md troca
  "sem placar" por "curtidas e seguidores visíveis, sem ranking".
- **Seguir:** aba "Following" para achar a pessoa rápido; a pessoa recebe o aviso "Sam followed you."; contagens
  de seguidores e de seguidos públicas; **as listas de seguidores e de seguidos são visíveis para todos** os membros.
- **Lista de membros:** filtros por **nível**, **área e stack** e **busca por nome** (sem filtro de horário).
- **Aparecer na lista:** todos aparecem por padrão; em Edit profile, "Show me in the member list" pode ser
  desligado. Quem se esconde continua com perfil acessível (por link ou pelas listas de seguidores).
- Curtir **não** gera aviso (o número já aparece no perfil).
- Abordagem: contagens e listas **calculadas na leitura** por funções do banco, que já tiram bloqueados e suspensos.

### Anotado para a 2B.2 (fora desta fase)

- Chat **privado**: só quem começou a conversa e quem recebe veem as mensagens.
- Botão **"Send message"** no perfil de outra pessoa. Na 2B.1 o espaço fica reservado, sem botão desativado.
- A decidir na 2B.2: quem pode mandar mensagem para quem (qualquer membro, só quem se segue, ou pedido aceito).

### Fora do escopo

Chat, parceiros, "Send message" (2B.2); salas de voz (2C); selo Diff master (2B.2); feed, ranking ou sugestões
automáticas; aviso de curtida.

### Pronto quando

1. A aba Members lista os membros (30 por página), filtra por nível, área, stack e nome, e abre o perfil de cada um.
2. O perfil de outra pessoa mostra banner, foto/mascote, selos, ficha, gráfico (se ela mostra), Follow, ♥ com
   número, "N followers" e "N following" clicáveis, Report e Block.
3. Seguir e curtir funcionam e se desfazem; o aviso de seguir chega no máximo uma vez a cada 7 dias por pessoa.
4. Bloqueados (nos dois sentidos) e suspensos nunca aparecem em listas nem em contagens; quem desligou "Show me in
   the member list" some só da lista de membros.
5. "Export my data" inclui quem você segue, seus seguidores e suas curtidas; excluir a conta apaga tudo isso.
6. Testes de banco (PGlite), unidade e e2e verdes; prints nos dois temas; revisão de design e revisão final.
7. 0006 colada no Supabase; documentos legais com nova versão aceita de novo.

## 2. Banco — migração `0006_people.sql`

O `setup.sql` e as migrações 0001–0005 estão no ar; a 0006 é colada sozinha no SQL Editor (e entra no `setup.sql`
gerado, para projetos novos).

### Tabelas e colunas

- `follows (follower uuid, followee uuid, created_at)`: chave `(follower, followee)`, `follower <> followee`, as
  duas colunas referenciam `auth.users` com `on delete cascade`.
- `profile_likes (liker uuid, profile uuid, created_at)`: chave `(liker, profile)`, `liker <> profile`, cascade.
- `profiles.listed boolean not null default true`, com grants de coluna de select/insert/update como as outras.
- `notices` ganha `kind text not null default 'moderation'` (`'moderation' | 'follow'`) e
  `actor uuid references auth.users on delete set null`. Os avisos que já existem ficam `'moderation'`.

### Regras (RLS e gatilhos)

- **Inserir** em `follows`/`profile_likes`: só a própria linha (`follower`/`liker = auth.uid()`), quem insere é
  membro ativo (`viewer_is_member()`) e pode ver o alvo (`can_see_profile(alvo)`: ativo e sem bloqueio).
  **Apagar**: só a própria linha. **Sem select direto** para o cliente: tudo se lê pelas funções abaixo.
- **Limite diário:** um gatilho recusa a 201ª linha criada nas últimas 24 h pela mesma pessoa em cada tabela
  (mensagens `follow limit reached` / `like limit reached`).
- **Aviso de seguir:** gatilho `after insert` em `follows` cria em `notices`
  `{user_id: followee, kind: 'follow', actor: follower, message: '<nome> followed you.'}` — só se não houver aviso
  `follow` do mesmo `actor` para a mesma pessoa nos últimos 7 dias.
- **Bloquear desfaz:** ao inserir em `blocks`, um gatilho apaga `follows` e `profile_likes` entre os dois, nos
  dois sentidos.
- **Suspensos:** não aparecem nem contam enquanto durar a suspensão (filtro `is_active`), sem apagar nada.

### Funções (security definer, só para `authenticated`, revogadas de `anon`)

- `profile_social(target uuid)` → `followers int, following int, likes int, i_follow bool, i_like bool`. Zeros e
  falsos quando o chamador não pode ver o perfil. Contagens só com pessoas ativas e sem bloqueio com o chamador.
- `member_directory(q text, lvl text, area text, stack text, page int)` → linhas
  `id, display_name, level, area, main_stack, mascot, has_avatar`. Só membros `listed`, ativos, sem bloqueio com o
  chamador e diferentes dele. `q` por `ilike` (com `%`/`_` escapados); `stack` compara com as tags normalizadas.
  Ordem: distância de nível ao chamador (A2…C2), depois nome, depois id. 30 por página (`offset page * 30`).
- `followers_of(target uuid, page int)` e `following_of(target uuid, page int)` → as mesmas linhas, para quem pode
  ver o alvo (ou é o próprio). Sem filtro de `listed`; com filtro de ativos e bloqueio relativo ao chamador.
- `my_social_export()` → JSON com `following`, `followers` e `likesGiven` do chamador, com datas.

## 3. Processo principal e IPC

- `SocialBackend` (Supabase e falso, com paridade): `members(filters, page)`, `profileOf(userId)`,
  `socialStats(userId)`, `follow/unfollow(userId)`, `like/unlike(userId)`, `followers/following(userId, page)`.
  `saveProfile` passa a aceitar `listed`. `listNotices` traz `kind` e `actor {id, displayName} | null`.
  `exportOwnData` inclui `my_social_export()`.
- Canais novos (zod, mesmo padrão): `social:members {query?, level?, area?, stack?, page}`,
  `social:profileOf {userId}`, `social:socialStats {userId}`, `social:follow|unfollow|like|unlike {userId}`,
  `social:followers|following {userId, page}`. Seguir/curtir a si mesmo é recusado no main com mensagem clara.
- Limite atingido vira `rate_limited` com "You reached the limit of 200 follows a day. Try again tomorrow." (e o
  equivalente para curtidas).
- O backend falso ganha uma semente com ~12 membros variados (níveis, áreas, stacks, um escondido, um suspenso, um
  bloqueado) para e2e e prints.

## 4. Telas

- **People** com 3 abas: **Members** (abre primeiro, `#/people`), **Following** (`#/people/following`) e
  **Your profile** (`#/people/me`). Edit profile continua em `#/people/edit`.
- **Members:** busca por nome, nível, área e stack no topo; lista em linhas (foto ou mascote, nome,
  "Back end developer, B1", linguagens principais como selos); clicar abre o perfil; "Load more". Vazio:
  "No members match these filters."
- **Perfil de outra pessoa** (`#/people/u/{id}`): mesmo visual do próprio (banner, foto sobreposta, selos, ficha,
  gráfico se ela mostra). Abaixo do nome: **Follow / Following**, **♥ 12** (curtir/descurtir), "8 followers" e
  "5 following" (clicáveis), Report e Block. Espaço reservado para "Send message" (2B.2), sem botão.
- **Listas** `#/people/u/{id}/followers` e `/following`: mesmas linhas da lista de membros.
- **Following:** quem você segue; vazio: "You do not follow anyone yet. Find people in Members."
- **Your profile:** o que já existe, mais as contagens clicáveis.
- **Avisos:** "Sam followed you." aparece com os avisos atuais, com a foto e o link para o perfil.
- **Edit profile:** caixa "Show me in the member list".
- **Ctrl+K:** comando "Members".
- Estados vazio, carregando e erro em todas as telas novas; textos em inglês simples (B1).

## 5. Documentos e sistema visual

- **PRODUCT.md:** "sem placar" vira "curtidas e seguidores visíveis, sem ranking".
- **Privacidade:** nova seção sobre o que fica público (quem você segue, seus seguidores, curtidas dadas e
  recebidas) e como sair da lista de membros. **Termos:** seguir e curtir entram em "What you share".
  Nova versão datada do dia da implementação → todos aceitam de novo.
- **DESIGN.md:** botões Follow/Like, linha de membro e abas de People, estendidos pelo documentador.

## 6. Testes

- **Banco (PGlite):** seguir a si mesmo, bloqueado ou suspenso é recusado; o limite de 200 funciona; o aviso não
  repete em 7 dias; bloquear apaga os laços; contagens e listas ignoram bloqueados e suspensos; escondidos somem só
  da lista de membros; filtros e ordem da lista; anon não lê nada; export só do próprio.
- **Unidade:** backend Supabase (consultas), backend falso (regras), canais (validação, mensagens).
- **e2e (backend falso semeado):** filtrar e abrir um perfil; seguir/deixar de seguir com aviso; curtir/descurtir;
  listas de seguidores; esconder-se da lista; bloqueado some.
- Prints nos dois temas × 1440/960, revisão de design (impeccable) e revisão final de código (Opus).
- Testes de unidade sempre com `--maxWorkers=2` (a máquina tem 6,7 GB e travou com o paralelismo padrão).

## 7. Implantação (guiada, pelo navegador)

1. Colar `supabase/migrations/0006_people.sql` sozinha no SQL Editor (página de copiar no painel dos agentes).
2. Abrir o app, aceitar os documentos de novo, ver a lista de membros, seguir e curtir uma conta de teste.
