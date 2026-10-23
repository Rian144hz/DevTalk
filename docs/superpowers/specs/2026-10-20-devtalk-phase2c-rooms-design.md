# DevTalk — Fase 2C: salas de voz

Data: 2026-10-20. Aprovado em conversa, parte por parte, com o dono do projeto.

## 1. Objetivo

Membros conversam em inglês por voz, em salas de até 6 pessoas, criadas na hora por qualquer membro. A conversa é
livre; um timer compartilhado e um cartão de ideia ajudam a praticar. A voz vai direto entre os computadores e nunca é
gravada nem transcrita.

### Decisões do dono

- **Fala:** conversa livre. Qualquer pessoa da sala inicia um timer de 60 ou 90 s que todos veem (só um guia).
- **Quando:** só na hora. Criou, entrou, falou. A sala termina quando fica vazia.
- **Acesso:** qualquer membro entra pela lista de Rooms, até 6. Quem tem bloqueio com alguém de dentro não vê nem entra.
- **Tema:** título, tema (Stand-up, Code review, Interview, Free talk) e nível sugerido; um cartão de ideia igual para
  todos, com "Next card".
- **Cargos:** o anfitrião dá "Room moderator" a quem está dentro; anfitrião e moderador da sala removem e mutam os
  outros; quem foi mutado pode desmutar quando quiser; o anfitrião passa o cargo; se sair sem passar, o cargo vai a um
  moderador da sala, senão a quem está há mais tempo. Moderadores do app não têm poder dentro das salas (agem por
  denúncia).
- **Segurança:** cada um silencia alguém só para si, bloqueia e denuncia. Removido não volta àquela sala.
- **Selos:** Room host = criou 5 salas em que mais alguém entrou. Active speaker = 10 vezes 5+ min numa sala junto com
  outra pessoa. Sem medir a voz.
- **Áudio:** WebRTC direto entre cada par (malha, no máximo 5 conexões por pessoa); STUN gratuito da Cloudflare; sem
  TURN, sem serviço pago. Os outros da sala veem o seu IP.
- **Mute/Unmute** do seu microfone sempre visível (Ctrl+M).

### Fora do escopo

Salas agendadas; vídeo e tela; turnos automáticos; gravação ou transcrição de qualquer voz; chat de texto na sala;
relé TURN; poderes de moderadores do app dentro das salas; escolha de dispositivo de áudio (usa o padrão do sistema).

### Pronto quando

1. Criar uma sala, outros entrarem pela lista, falar e ouvir ao vivo; Mute/Unmute; quem fala aparece marcado.
2. Timer de 60/90 s e cartão de ideia compartilhados.
3. Cargos: Room moderator, mutar e remover outros, passar o anfitrião, herança automática do cargo.
4. Silenciar para si, bloquear, denunciar com contexto da sala para moderadores; removido não volta.
5. Selos Room host e Active speaker.
6. Testes de banco, unidade e e2e verdes; prints nos dois temas; revisão de design e revisão final.
7. 0009 colada no Supabase; documentos legais com nova versão.

## 2. Banco — migração `0009_rooms.sql`

0001–0008 estão no ar; a 0009 é colada sozinha.

### Tabelas

- `rooms (id uuid, created_by, host, title, theme, level, created_at, ended_at, timer_started_at, timer_seconds, card)`:
  `title` 3–60 caracteres; `theme in ('standup','code_review','interview','free')`; `level` A2–C2 ou nulo (qualquer);
  `timer_seconds in (60, 90)` ou nulo; `card` ≥ 0. `created_by` e `host` apontam para `auth.users` (cascade).
- `room_sessions (id bigint, room_id, user_id, role, joined_at, left_at, removed, muted, mute_requested_at)` (o `last_seen`
  fica em `room_presence`, fora do Realtime): uma linha
  por entrada; `role in ('member','moderator')`; viva = `left_at is null and last_seen > now() - 90 s`. Cascade da sala e
  da pessoa.
- `room_signals (id bigint, room_id, sender, recipient, kind, payload jsonb, created_at)`: `kind in
  ('offer','answer','candidate','bye')`; `payload` até 16 KB. Contém endereços de rede: só o destinatário lê; apagadas
  depois de 5 min.

### Regras

- **Criar** — `create_room(title, theme, level)`: membro ativo com perfil; no máximo 10 salas criadas por dia; quem já
  está viva em outra sala sai dela; cria e já entra como anfitrião.
- **Entrar** — `join_room(room)`: membro ativo com perfil; sala não terminada; menos de 6 sessões vivas; não removido
  daquela sala; sem bloqueio com ninguém vivo dentro; uma sala por vez (sai da anterior). Sala terminada, sem ninguém
  vivo ou que não existe mais responde `room has ended` ("This room has ended."); as outras recusas, `not allowed`.
- **Sair** — `leave_room(room)`: fecha a sessão. Se era o anfitrião e há gente viva, o cargo passa a um moderador da sala
  (o mais antigo), senão a quem entrou primeiro. Sala sem ninguém vivo termina (`ended_at`).
- **Sinal de vida** — `room_heartbeat(room)` a cada 30 s: atualiza `last_seen`; aplica a herança do anfitrião se ele
  sumiu; termina a sala vazia; apaga sinais com mais de 5 min daquela sala.
- **Cargos** — `make_room_moderator(room, user)` / `remove_room_moderator(room, user)`: só o anfitrião, sobre pessoa viva.
  `pass_host(room, user)`: só o anfitrião, para pessoa viva. `mute_member(room, user)`: anfitrião ou moderador da sala,
  nunca contra o anfitrião. `remove_from_room(room, user)`: anfitrião ou moderador da sala, nunca contra o anfitrião nem
  (para o moderador) contra outro moderador; marca `removed` e fecha a sessão. `end_room(room)`: só o anfitrião.
- **Mutado** — `set_room_muted(room, muted)`: cada um informa o próprio estado; todos veem o ícone de mutado.
- **Timer e cartão** — `start_timer(room, seconds)` (60 ou 90) e `stop_timer(room)`, `next_card(room)`: qualquer pessoa
  viva na sala.
- **Limite de ações** — `set_room_muted` (só quando muda), `next_card`, `start_timer`, `stop_timer` (só quando muda),
  `mute_member`, `make_room_moderator`, `remove_room_moderator`, `pass_host` e `remove_from_room`: no máximo 30 por pessoa
  por minuto, contadas em `room_actions` (fora do Realtime, sem acesso de clientes); acima disso `room action limit
  reached` ("Too many room actions. Wait a moment.").
- **Ler** — `live_rooms()`: salas não terminadas com pelo menos uma sessão viva, sem bloqueio entre quem pede e quem está
  dentro, e sem as salas de onde quem pede foi removido; título, tema, nível, anfitrião e as pessoas vivas (id, nome, foto?, mascote). Tabelas: `rooms` e
  `room_sessions` legíveis por quem está vivo na sala (para o Realtime), sem as sessões, também as antigas, de quem tem
  bloqueio com quem lê; `room_signals` só pelo destinatário.
- **Sinais** — insert direto: `sender` = eu; eu e o destinatário vivos na mesma sala; sem bloqueio entre os dois; no
  máximo 600 sinais por minuto e 5 000 em 24 h por pessoa (`signal limit reached`). O dia é contado por hora em
  `room_signal_counts` (só números), fora da tabela de sinais, para a limpeza de 5 min e o fim da sala não zerarem.
- **Denúncia** — `reports` com `context_type = 'room'` e `context_id` = id da sala.
  `room_report_context(report_id)` só para moderadores: título, tema, anfitrião, quem esteve e os horários.
- **Selos** — `profile_badges` passa a incluir `room_host` (5+ salas criadas em que outra pessoa teve sessão) e
  `active_speaker` (10+ sessões de 5+ min que se sobrepõem 5+ min com a sessão de outra pessoa), grupo comunidade.
- **Realtime** — `rooms`, `room_sessions` e `room_signals` na publicação `supabase_realtime`; o app assina só INSERT e
  UPDATE (DELETE não passa pela RLS).
- Excluir a conta apaga salas criadas, sessões e sinais da pessoa (cascade).

## 3. Processo principal e IPC

- `SocialBackend`: `liveRooms()`, `createRoom(input)`, `joinRoom(id)`, `leaveRoom(id)`, `heartbeat(id)`,
  `roomPeople(id)`, `sendSignal(roomId, to, kind, payload)`, `makeRoomModerator`, `removeRoomModerator`, `passHost`,
  `muteMember`, `removeFromRoom`, `endRoom`, `startTimer`, `stopTimer`, `nextCard`, `roomReportContext(reportId)`,
  `subscribeRoom(roomId, onEvent)`. Backend falso com paridade e semente.
- **Ponte da sala** (`room-live`): enquanto você está numa sala, o main envia o sinal de vida a cada 30 s (falhou: nova
  tentativa a cada 5 s até passar; cada uma desiste após 10 s; o canal voltou: sinal de vida na hora), assina o
  Realtime da sala e manda para a janela `room:event` (pessoas, cargos, mute pedido, timer, cartão, fim, removido) e
  `room:signal` (oferta, resposta, rota, bye endereçados a você). Sai da sala ao fechar o app, ao sair da conta e quando a
  janela pede; um create ou join ainda a caminho nessa hora sai da sala quando responde, sem segui-la.
- **Permissões do Electron:** só `media` com áudio, só para a página do app; câmera, tela, localização, notificações e o
  resto negados.
- Canais com zod; mensagens de limite e de erro em inglês simples.

## 4. Telas

- **Rooms** (menu, Ctrl 6; sai o "Later"): **Create a room** e a lista ao vivo (título, tema, nível, fotos, "3 / 6",
  **Join** ou "Full"). Vazio: "No rooms right now. Create one and others can join."
- **Criar:** título, tema, nível sugerido → **Create** → entra.
- **Antes de entrar:** pede o microfone, mostra o medidor de volume, **Join room** / **Cancel**. Sem microfone ou negado:
  explica como resolver.
- **Na sala:** pessoas (foto/mascote, nome, nível, "Host" / "Room moderator", anel de quem fala, ícone de mutado); menu
  de cada pessoa (Mute for me, Report; Mute, Remove, Make moderator para anfitrião/mod; Make host para o anfitrião);
  cartão de ideia com **Next card**; timer **60 s** / **90 s** / **Stop**; barra **Mute/Unmute**, **Leave**,
  **End room** (anfitrião). Avisos: entrou/saiu, "You were removed from this room", "The host muted you. You can unmute
  when you are ready.", "Could not connect to <name>. Your network may block calls.", "Reconnecting…".
- **Moderação:** denúncia de sala mostra o contexto da sala.
- Estados vazio, carregando, erro e sem rede; textos em inglês simples (B1).

## 5. Documentos

- Privacidade: a voz nunca é gravada, transcrita nem passa por servidor; os outros da sala veem seu IP; os sinais de
  conexão ficam no máximo 5 min; guardamos quem esteve em cada sala e quando (denúncias e selos); STUN da Cloudflare.
- Termos e conduta: salas, cargos, remover e mutar. Nova versão datada → todos aceitam de novo.
- DESIGN.md: lista de salas, sala, pessoas, cartão, timer, barra de controles.

## 6. Testes e no ar

- Banco (PGlite): vaga de 6, removido não volta, bloqueio esconde e impede, cargos, passar e herdar o anfitrião, sinal de
  vida e sessões mortas, sinais só para o destinatário e limpeza, limites, selos, contexto de denúncia só para
  moderadores, exclusão de conta.
- Unidade: backend falso e Supabase (canal falso), ponte da sala, permissões, lógica da malha (quem chama quem, sem
  áudio real), timer e cartão.
- E2E: microfone falso do Chromium, dois membros (um pelo gancho de teste), conectar, Mute/Unmute, mutar e remover,
  timer, cartão. Prints nos dois temas, revisão de design, revisão final (Opus). Testes de unidade com `--maxWorkers=2`.
- No ar: colar `0009_rooms.sql` sozinho; conferir a publicação do Realtime; testar com duas contas em dois computadores,
  de preferência em redes diferentes.
