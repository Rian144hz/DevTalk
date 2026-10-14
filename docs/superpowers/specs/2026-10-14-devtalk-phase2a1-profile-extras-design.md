# DevTalk — Fase 2A.1: Selos, gráfico de prática, banner e mascotes (design)

Data: 2026-10-14 · Status: aguardando revisão · Depende de: fase 2A (na `main` e no ar no Supabase)

## 1. Objetivo

Deixar o perfil com a cara de quem o usa: **selos** (como no Discord), um **gráfico de prática** (como o de
contribuições do GitHub), um **banner animado** (como no Discord) e **mascotes** como foto padrão para quem não pôs
foto. Tudo aparece no próprio perfil agora; os outros
membros passam a ver quando a 2B trouxer o diretório de pessoas.

### Decisões confirmadas com o usuário
- Selos de papel/identidade **e** de evolução. Os de evolução são **públicos** (decisão do usuário), com um
  interruptor para quem quiser esconder (ligado por padrão).
- Quem concede: automáticos (a partir de fatos) + manuais (moderadores).
- Membro fundador: quem criar o perfil até **31/12/2026** (horário de São Paulo).
- Linguagens: a pessoa marca **até 2 stacks principais**, que viram selos.
- Linux native: **detectado pelo app**.
- Aparência: **cor por grupo** — comunidade em violeta, técnicos neutros, linguagens na **cor real da marca**,
  evolução em cobre. Ícones em SVG (nada de emoji).
- Sequência: o selo de 7/30 dias aparece **enquanto a sequência atual dura** e some quando ela quebra.
- Atividade que conta: **respostas a desafios + cartões revisados** (na 2B/2C entram correções no chat e minutos em
  salas). Um dia conta para a sequência com pelo menos 1 atividade.
- Gráfico de prática: **verde, como no GitHub** (um verde próprio do gráfico, diferente do verde das correções).
- Banner: **animado**, posição **estilo Discord** (banner alto 3:1 no topo, foto sobreposta na borda de baixo).
  Anima sozinho; para com "reduzir movimento" do sistema e com a opção "Play animated banners" em Settings.
- Mascotes: quem não pôs foto ganha **um de 9 mascotes** — **pato, urso e axolote, 3 versões de cada** — sorteado
  pelo id da conta (sempre o mesmo), e pode **trocar** no Edit profile. As imagens vêm da biblioteca grátis
  **ipaslogo.com** ("Free to download and use commercially"), feita com o `ip-as-logo-skill` (MIT). A skill foi
  instalada em `~/.claude/skills/ip-as-logo`, mas não gera aqui: exige um modelo de imagem pago e a conta Higgsfield
  tem só 1,4 crédito (plano grátis). Arquivos e origem em `docs/design/mascots/` (`SOURCE.md`).
- Abordagem A: o servidor guarda os fatos (dias, marcos, selos manuais) e calcula os selos; gráfico e selos nunca
  discordam.

### Fora do escopo
- Seguir pessoas, likes em perfis, diretório e perfis de outras pessoas (abrem a 2B).
- Salas de voz criadas por qualquer membro (2C); selos Diff master (2B), Room host e Active speaker (2C) ficam no
  catálogo como "coming", sem como ganhar ainda.
- Bordas animadas na foto (avatar decorations): descartadas pelo usuário em 2026-10-14.
- APNG animado (PNG é sempre tratado como imagem parada).

### Pronto quando
1. O perfil mostra os selos certos (automáticos, manuais e de evolução) no estilo aprovado, nos dois temas.
2. O gráfico do último ano aparece no People (dados do servidor) e no Progress (dados locais), com dica por dia.
3. Edit profile permite marcar até 2 linguagens principais, esconder gráfico/selos de evolução e pôr/tirar o banner.
4. Um moderador encontra um membro pelo nome e dá/tira Beta tester, Mentor e Open source contributor; quem recebe vê
   um aviso.
5. Banner animado (GIF/WebP) e parado (JPEG/PNG/WebP) funcionam; metadados são removidos; reduzir movimento e a
   opção de Settings param a animação.
6. Quem não tem foto aparece com o seu mascote (um dos 9) em todo lugar onde há avatar; dá para trocar.
7. As regras novas têm testes no PGlite; o app tem e2e com o backend falso; as telas passaram pela conferência
   visual e pelas revisões de design e de código.

## 2. Catálogo de selos

Rótulos em inglês (a interface é em inglês). Ordem no perfil: comunidade → técnicos → evolução.

| Id | Rótulo | Grupo / cor | Como se ganha |
|---|---|---|---|
| `creator` | Creator | comunidade / violeta | Inserido uma vez no SQL Editor para a conta do dono. Nenhum caminho pelo app. |
| `moderator` | Moderator | comunidade | Automático: estar em `moderators`. |
| `founding_member` | Founding member | comunidade | Automático: `profiles.created_at` < 2027-01-01 00:00 em America/Sao_Paulo. |
| `beta_tester` | Beta tester | comunidade | Manual (moderador). |
| `mentor` | Mentor | comunidade | Manual (moderador). |
| `open_source` | Open source contributor | comunidade | Manual (moderador). |
| `diff_master`, `room_host`, `active_speaker` | — | comunidade | Reservados ("coming"); ligam na 2B/2C. |
| `area:<area>` | Back end, Front end, Mobile, Data, DevOps | técnico / neutro | Automático pelo campo `area`; `other` não gera selo. |
| `lang:<tag>` | Rótulo da stack (ex.: Python, Java) | técnico / cor da marca | As até 2 stacks em `main_stack`; logo do Simple Icons. |
| `linux` | Linux native | técnico / neutro | Automático: `uses_linux`, preenchido pelo app. |
| `streak_7` / `streak_30` | 7-day streak / 30-day streak | evolução / cobre | Calculado pelo servidor a partir de `practice_days`; mostra só o maior que a sequência **atual** alcança. |
| `level_up` | B1 → B2 (o último salto) | evolução | Marco enviado pelo app quando o nível atual local sobe em Settings. |
| `vocabulary` | Vocabulary hunter 50+ / 100+ | evolução | Marco enviado pelo app quando o banco local chega a 50 / 100 expressões salvas. |

Selos de evolução e o gráfico respeitam `show_progress`: desligado, os outros não os veem (o dono sempre vê).

### Cores
- **Violeta** (comunidade) e **cobre** (evolução) entram como tokens novos nos dois temas, com contraste ≥ 3:1 para o
  ícone; o rótulo usa a cor do texto (AA).
- **Linguagens:** a cor da marca vem de um mapa curado gerado em build a partir do `hex` do Simple Icons, com
  substituições para logos pretos/ausentes (Java = `#ED8B00`, mostrado com o logo do OpenJDK). Em cada tema a cor é
  clareada/escurecida o mínimo necessário para ≥ 3:1 contra o fundo.
- O azul continua só do coach e da ação principal; o âmbar só de problemas do app; rosa/sálvia só do diff.

## 3. Gráfico de prática

- Uma célula por dia, **últimas 53 semanas**, semanas começando na segunda; rótulos de mês em cima, Mon/Wed/Fri ao
  lado; legenda "Less … More".
- Intensidade: `pontos = respostas × 5 + revisões`; níveis 0 · 1–9 · 10–24 · 25–49 · 50+ (5 tons de um **verde do
  gráfico**, distinto do verde de inserção do diff; nunca aparece perto de um diff).
- Linha de fatos: "N days practised in the last year. Current streak: X days. Longest: Y days."
- Dica ao passar o mouse/focar: "14 Oct: 2 answers, 15 reviews" / "14 Oct: no practice". Navegável por teclado
  (a grade é um único controle com setas; a dica é lida por leitores de tela).
- Janela estreita: o gráfico rola na horizontal, começando no fim (hoje).
- **People:** dados do servidor (`practice_days`). **Progress:** dados locais, funciona sem conta.
- Sequência atual: dias consecutivos com atividade terminando **hoje ou ontem**, no fuso do perfil.

## 4. Banner

- Entrada: GIF, WebP (animado ou parado), JPEG, PNG; até 8 MB no arquivo escolhido.
- **Parado** (JPEG, PNG, WebP sem animação): a janela recorta no centro em 3:1, reduz para 1500×500 e reencoda em
  WebP 0,8 (0,6 se passar de 2 MB) — o que remove metadados.
- **Animado** (GIF; WebP com `ANIM`): enviado como está, **até 2 MB**, com dimensões entre 600×200 e 4096×4096. O main
  remove metadados sem reencodar: no GIF, extensões de comentário, texto e aplicação (exceto o laço
  `NETSCAPE2.0`/`ANIMEXTS1.0`); no WebP, blocos `EXIF` e `XMP ` (ajustando as flags do `VP8X` e o tamanho do RIFF).
- Armazenamento: bucket privado `banners`, arquivo `{uid}/banner.gif` ou `{uid}/banner.webp`; o bucket aceita só
  `image/gif`/`image/webp` até 2 MB. Mesmas regras de leitura das fotos (dono sempre; membros, sem bloqueio e com o
  dono ativo).
- Entregue à janela como `data:` URL (a CSP não muda), com cache em memória no main.
- Exibição: 3:1 com `object-fit: cover` (enquadramento pelo centro). Sem banner: faixa lisa 6:1 na cor do trilho; a
  foto sobrepõe igual. Com "reduzir movimento" ou "Play animated banners" desligado: mostra o 1º quadro (decodificado
  com `ImageDecoder`), parado.
- Ações no Edit profile: "Add banner" / "Change banner" / "Remove banner". Banner ofensivo entra na denúncia de
  perfil existente.

## 4b. Mascotes (foto padrão)

- **Conjunto (9):** `duck-1` Rubber Duck, `duck-2` Duck, `duck-3` Yellow Duckling, `bear-1` Brown Bear, `bear-2` Cream
  Brown Bear, `bear-3` Giant Panda Bear, `axolotl-1` Axolotl, `axolotl-2` Baby Axolotl, `axolotl-3` Axolotl — WebP
  512 × 512 (6–9 KB cada), escolhidos pelo dono do projeto. Origem registrada em `docs/design/mascots/SOURCE.md`.
- **Onde vivem:** copiados para `src/renderer/assets/mascots/` e empacotados no app (sem upload, servidor ou rede;
  a CSP `img-src 'self' data:` já permite). Mostrados em círculo, como as fotos.
- **Qual aparece:** `profiles.mascot` quando escolhido; senão o sorteio estável `fnv1a(user id) mod 9`. A foto, quando
  existe, sempre ganha do mascote.
- **Onde aparecem:** em todo `Avatar` sem foto (perfil, Edit profile, fila de moderação, busca de membros), no lugar da
  inicial — que fica só para quando não há id.
- **Edit profile:** uma fileira com os 9 para escolher (o atual marcado); a foto continua aparecendo enquanto existir
  ("Remove photo" para usar o mascote).

## 5. Banco — migration `0004_profile_extras.sql`

O `setup.sql` já foi aplicado; a 0004 é colada sozinha no SQL Editor (e entra no `setup.sql` gerado, para projetos
novos).

- `profiles`: `main_stack text[] not null default '{}'` (≤ 2, `main_stack <@ stack`), `uses_linux boolean not null
  default false`, `show_progress boolean not null default true`, `banner_path text` (só `{id}/banner.gif|webp`),
  `mascot text` (nulo ou um dos 9 ids).
  Grants de select/insert/update para essas colunas.
- `practice_days (user_id, day date, answers int 0–500, reviews int 0–2000, updated_at)`, pk (`user_id`, `day`).
  O dono insere/atualiza só as próprias linhas, com `day` entre hoje−400 e hoje+1. Leitura: o dono; outros, se
  `can_see_profile(user_id)` e `show_progress` do dono.
- `milestones (user_id, kind, value, achieved_at)`, pk (`user_id`, `kind`, `value`): `level_up` aceita só
  `<de>><para>` com dois níveis de A2–C2 em que o segundo é maior (ex.: `B1>B2`, `B1>C1`); `vocabulary` aceita `50` ou `100`. O dono insere; sem update.
  Leitura igual a `practice_days`.
- `badge_grants (user_id, badge, granted_by, granted_at)`, pk (`user_id`, `badge`): `badge` ∈ {`creator`,
  `beta_tester`, `mentor`, `open_source`}. Nenhum insert/delete direto pelo app.
- `moderation_actions`: novas ações `grant_badge` e `revoke_badge` com a coluna `badge` (∈ {`beta_tester`, `mentor`,
  `open_source`}); o trigger aplica em `badge_grants` e, ao conceder, cria o aviso "You received the {label} badge."
  As regras atuais continuam: moderador ativo, nunca sobre si mesmo.
- `profile_badges(target uuid)` (security definer, só sobre quem o chamador pode ver; senão vazio) → linhas
  `(id, grp, label, detail)` já ordenadas, calculando automáticos, manuais, sequência atual e marcos (respeitando
  `show_progress`).
- `practice_streaks(target uuid)` → `(current, longest)` com as mesmas regras de visibilidade.
- `can_see_banner(name)` análoga a `can_see_avatar`. Storage policies do bucket `banners` iguais às de `avatars`.
- Testes PGlite cobrem cada regra: quem lê/escreve, valores inválidos, sequência nas viradas de dia e de fuso,
  esconder evolução, concessão por moderador (e recusa para não moderador, para si mesmo e para `creator`).

## 6. App

- **Sincronização (main):** ao abrir o app e alguns segundos depois de cada resposta ou revisão, conta por dia (fuso
  da máquina) as respostas (`feedbacks`) e revisões (`review_logs`) dos últimos 400 dias e envia só os dias que
  mudaram. Também envia `uses_linux` e os marcos novos (vocabulário 50/100 a partir de `expressions`; `level_up`
  quando o nível atual local sobe em Settings). Só para membros (aceites + perfil, ativo). Sem rede: tenta de novo
  depois; nunca trava a prática.
- **IPC novos** (zod, mesmo padrão): `social:badges {userId}`, `social:practiceGraph {userId}`,
  `social:setBanner {bytes}` (o main detecta o tipo pelos bytes), `social:removeBanner`, `social:banner {userId}`,
  `moderation:searchMembers {query}`, `moderation:grantBadge {userId, badge, reason}`,
  `moderation:revokeBadge {userId, badge, reason}`. `social:saveProfile` passa a aceitar `mainStack`, `showProgress` e `mascot`.
  `progress:graph` (local) para o Progress.
- **Telas:**
  - **People:** banner + foto sobreposta + nome, selos, ficha, gráfico.
  - **Edit profile:** banner; fileira de mascotes; botão "Main" em cada stack (máx. 2); caixa "Show my practice graph
    and progress badges to other members".
  - **Progress:** gráfico local acima do que já existe.
  - **Settings:** "Play animated banners" (preferência local, ligada).
  - **Moderation:** área "Badges": busca por nome (só moderadores), selos da pessoa, dar/tirar com motivo.
- **Backend falso:** paridade com tudo acima (para e2e).

## 7. Documentos e sistema visual

- **PRODUCT.md:** "sem gamificação" passa a "marcos públicos de evolução, sem pontos, ranking ou placar"; "sem
  mascotes" passa a "mascotes só como foto padrão de quem não pôs foto; o app em si não tem mascote"; nova exceção a
  "não usar assets de terceiros": os 9 mascotes da biblioteca ipaslogo.com (uso comercial livre, origem registrada); a exceção dos
  logos passa a permitir as cores reais das linguagens nos selos.
- **DESIGN.md / design.json:** tokens violeta, cobre e a rampa verde do gráfico (dois temas); regras de uso (nunca
  perto de um diff; azul/âmbar/rosa/sálvia mantêm o sentido); componentes Badge, Practice graph, Banner.
- **Privacidade:** nova seção sobre contagem diária (só números), marcos, selos e banner; o que é público e como
  esconder. **Termos:** banner entra em "o que você compartilha". Nova versão datada do dia da implementação → todos
  aceitam os documentos de novo (como a política promete).

## 8. Testes

- `tests/supabase/` (PGlite): tudo da §5.
- `tests/core/` ou `tests/renderer/`: níveis do gráfico, cálculo de sequência local, mapa de cores das linguagens
  (contraste ≥ 3:1 nos dois temas), preparo do banner parado, sorteio estável do mascote (mesmo id → mesmo mascote;
  os 9 aparecem numa amostra de ids) e escolha explícita ganhando do sorteio.
- `tests/main/`: limpeza de metadados de GIF/WebP com arquivos montados byte a byte (comentário removido, laço mantido,
  EXIF/XMP removidos, flags e tamanho corretos), detecção animado/parado, limites de tamanho e dimensão, contagem
  diária a partir do SQLite, envio só dos dias alterados, marcos, IPC.
- `tests/e2e/` (`DEVTALK_FAKE_SOCIAL`): mascote aparece sem foto e troca no Edit profile; foto ganha do mascote; selos
  no perfil, gráfico e dica, esconder evolução, linguagens principais,
  moderador dando e tirando selo (e o aviso), banner animado e parado, "Play animated banners" desligado.
- Conferência visual nos dois temas e tamanhos; revisão de design; revisão de código da branch inteira.

## 9. Implantação (guiada, pelo navegador)

1. Colar `supabase/migrations/0004_profile_extras.sql` no SQL Editor → Run.
2. Dar o selo Creator para a sua conta:
   `insert into badge_grants (user_id, badge, granted_by) values ('362f7b40-f2e3-4623-9d92-7146cf81ef62', 'creator', '362f7b40-f2e3-4623-9d92-7146cf81ef62');`
   (é o id da sua conta, o mesmo usado para virar moderador).
3. Abrir o app, aceitar a nova versão dos documentos e conferir o perfil.
