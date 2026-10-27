# DevTalk — Abertura animada, boas-vindas e login com GitHub

Data: 2026-10-23. Aprovado em conversa com o dono do projeto ("cria tu, tudo").

## 1. Objetivo

O app abre sempre com uma animação curta da marca. Na primeira vez, uma tela de boas-vindas oferece entrar com
GitHub, entrar com e-mail ou praticar sem conta. Entrar com GitHub não pede código por e-mail e sugere nome e foto do
GitHub no perfil.

### Decisões do dono

- **Abertura animada em toda abertura do app**, com ou sem conta: o lápis azul escreve "DevTalk", risca uma letra e
  escreve a correção (marcas de prova); ~1,5 s; clique ou tecla pula; com "reduzir movimento", o nome aparece parado
  por 0,3 s; não espera a rede.
- **Boas-vindas só na primeira vez** (sem configuração local): **Continue with GitHub** (principal), **Continue with
  e-mail**, **Practise without an account** (discreto).
- **GitHub abre no navegador do sistema** e volta ao app por um endereço local (127.0.0.1); a senha do GitHub só é
  digitada no site do GitHub.
- **Perfil sugerido**: nome e foto do GitHub preenchidos na criação do perfil; dá para trocar ou tirar. Nada do GitHub
  aparece sozinho no perfil.

### Fora do escopo

Outros provedores (Google etc.); mostrar o @ do GitHub no perfil; commits do GitHub no gráfico; login dentro de uma
janela do app; link `devtalk://`.

### Pronto quando

1. A abertura animada aparece em toda abertura (pula com clique/tecla; parada com reduzir movimento), nos dois temas.
2. Primeira vez: boas-vindas → (GitHub ou e-mail) → regras + 18+ → perfil (sugerido pelo GitHub) → coach → Home;
   ou → sem conta → coach → Home. Quem já configurou vai direto ao Home.
3. People › Join também tem **Continue with GitHub**.
4. Login com GitHub real funciona (teste manual depois que o dono configura GitHub e Supabase).
5. Testes de unidade e e2e verdes; prints nos dois temas; revisão de design e revisão final.
6. Documentos legais com nova versão.

## 2. Fluxo

- **Abertura** (renderer, por cima de tudo): fundo do tema; SVG com o nome revelado da esquerda para a direita
  enquanto o lápis acompanha; uma letra recebe o risco (rosa) e a correção (verde) em cima, como as marcas do galley;
  some com fade. Clique, Enter, Espaço ou Esc pulam. Termina mesmo se os dados ainda carregam (mostra a tela seguinte
  quando estiverem prontos). Sem rede, nada muda.
- **Primeira vez** = não há perfil local do coach (`profile:get` → null), como hoje decide o onboarding.
  - Boas-vindas (frase: "Practise the English you use at work. A coach marks your writing, and other developers talk
    with you.").
  - **Continue with GitHub** → "Finish signing in with GitHub in your browser." (e, numa segunda linha, "Then come
    back here.") com **Cancel** logo depois do texto; Esc também cancela; sucesso → passos da comunidade (regras + 18+,
    perfil com sugestão; "Step 2 of 3" e "Step 3 of 3", pois não há passo de código) → configuração do coach → Home.
    Falha/tempo (5 min)/Cancel → volta às boas-vindas com "Sign-in was not finished. Try again." (ou, para outro erro,
    o título "Sign-in was not finished." com a mensagem do erro embaixo).
  - **Continue with e-mail** → os passos de código por e-mail que já existem ("Step n of 4"; sem botão do GitHub, e
    "Send code" é o botão principal) → regras → perfil → coach → Home.
  - **Practise without an account** → coach → Home (como hoje).
  - Comunidade não configurada nesta build (`configured: false`): só "Practise without an account" aparece.
- **Já configurado**: abertura → Home. Sessão com documentos pendentes continua sendo resolvida em People, como hoje.
- **People › Join, passo 1**: ganha **Continue with GitHub** acima do campo de e-mail.

## 3. Login com GitHub (técnico)

- **Configuração do dono (uma vez, guiada por uma página)**: OAuth App no GitHub (callback
  `https://<projeto>.supabase.co/auth/v1/callback`); Client ID e Client Secret em Supabase › Authentication › Providers ›
  GitHub (o Secret fica só no Supabase); em URL Configuration, as voltas `http://127.0.0.1:53682/callback`,
  `http://127.0.0.1:53683/callback`, `http://127.0.0.1:53684/callback`.
- **Processo principal** (o cliente Supabase continua só lá): `flowType: 'pkce'`;
  `signInWithOAuth({ provider: 'github', options: { redirectTo, skipBrowserRedirect: true, scopes: 'read:user user:email' } })`;
  o app só abre (`shell.openExternal`) uma URL `https:` da origem do projeto Supabase.
- **Ouvinte local**: servidor HTTP só em `127.0.0.1`, primeira porta livre de 53682–53684, uma única resposta em
  `/callback`; com `code` → `exchangeCodeForSession(code)`; com `error` → falha com a descrição; a página devolvida diz
  "You can go back to DevTalk." (ou o erro, em texto simples); depois fecha e traz a janela para a frente. Cancel, 5
  minutos ou fechar o app fecham o ouvinte. Outras rotas → 404, sem encerrar.
- **Sessão** guardada criptografada como hoje.
- **Sugestão de perfil**: dos metadados do usuário (`full_name`/`name`, `user_name`, `avatar_url`); a foto só é baixada
  de `https://avatars.githubusercontent.com/`, até 2 MB, e passa pelo mesmo preparo das fotos (WebP, limpa) antes de
  ir para o perfil; nada é salvo até o membro salvar o perfil.
- **Mesmo e-mail**: o Supabase junta a identidade GitHub à conta de e-mail existente (e-mail verificado).
- **Backend falso**: "GitHub" entra na hora como um membro de teste com nome e foto sugeridos (e2e), com falhas
  injetáveis.
- Canais com zod; mensagens simples em inglês (B1).

## 4. Telas e design

- Abertura: centrada, nome em Public Sans grande, lápis azul (a marca), marcas de correção do galley; sem sombras.
- Boas-vindas: uma coluna como o onboarding; um botão azul (GitHub) por tela; ícone do GitHub (Simple Icons, CC0,
  na cor do texto) no botão.
- Espera do navegador: texto + spinner discreto + Cancel.
- Perfil: foto e nome sugeridos já preenchidos, com "From your GitHub account" discreto e Remove photo.

## 5. Documentos

- Privacidade: entrar com GitHub; o que o GitHub envia (nome, usuário, foto, e-mail); o que guardamos (e-mail na
  conta; nome e foto só se mantidos no perfil); o código de volta passa pelo endereço local do seu computador.
- Termos: formas de entrar. Nova versão datada → todos aceitam de novo.
- README: página passo a passo da configuração do GitHub e do Supabase.

## 6. Testes

- Unidade: ouvinte local (código, erro, rota errada, porta ocupada → próxima, tempo, cancelar), backend Supabase
  (pkce, URL aberta só da origem certa, troca do código, sugestão), backend falso, canais, fluxo da primeira vez,
  abertura (pular, reduzir movimento).
- E2E (backend falso): abertura aparece e some; boas-vindas → GitHub → regras → perfil sugerido → coach → Home;
  e-mail; sem conta; quem já configurou vai ao Home; Join com GitHub. Prints nos dois temas; revisão de design;
  revisão final. Testes de unidade com `--maxWorkers=2`.
- Manual (dono): login real com GitHub depois da configuração.
