# DevTalk — guia da logo (compacto)

## 1. A logo

**Pato-lápis:** um pato de borracha cujo bico é um lápis apontado. Você explica, ele corrige. Rubber duck
debugging é como devs explicam um problema em voz alta, e o DevTalk é isso em inglês. O bico de lápis traz as marcas
de revisão do coach.

| Versão | Arquivo | Quando usar |
|---|---|---|
| Horizontal (principal) | `kit/devtalk-horizontal.svg` | cabeçalhos, README, site |
| Empilhada | `kit/devtalk-stacked.svg` | espaços quadrados, adesivos, slides |
| Só o símbolo | `kit/devtalk-symbol.svg` | avatar, abertura, onde o nome já aparece |
| Símbolo pequeno | `kit/devtalk-symbol-small.svg` | 16–40 px: bico inteiro, olho maior, sem a ponta solta |
| Só o nome | `kit/devtalk-wordmark.svg` | quando o pato já aparece perto |
| Fundo escuro | `kit/*-on-dark.svg` | tema escuro, fundos marinho ou preto |
| Uma cor | `kit/export/**/*-mono-0b2a4f*`, `*-black*`, `*-white*` | impressão de uma cor, carimbo, gravação |
| Ícone do app | `kit/export/icons/` | Linux, Windows, Mac, favicon e web |

## 2. Área de proteção

Deixe livre em volta da logo pelo menos **x**, a altura da base do bico (≈ 20 % da altura do pato). Nada de texto,
borda ou outra imagem dentro dessa área.

## 3. Tamanho mínimo

- **Símbolo completo** (com a ponta de grafite solta): 48 px ou 12 mm.
- **Símbolo pequeno:** 16 px (favicon).
- **Horizontal:** 120 px ou 30 mm de largura.
- **Empilhada:** 80 px de largura.

## 4. Cores

| Nome | HEX | RGB | CMYK (aprox.) | Uso |
|---|---|---|---|---|
| Azul pato | `#2F7DE1` | 47 125 225 | 79 44 0 12 | o pato em fundos claros (4,1:1 no branco) |
| Azul-céu | `#8EC5FF` | 142 197 255 | 44 23 0 0 | o pato em fundos escuros; o botão principal do app |
| Marinho | `#0B2A4F` | 11 42 79 | 86 47 0 69 | o nome, a ponta de grafite, a versão de uma cor, o fundo do ícone |
| Bico | `#FFA23F` | 255 162 63 | 0 36 75 0 | o bico (a madeira do lápis) |
| Tinta clara | `#E6EEF9` | 230 238 249 | 8 4 0 2 | o nome e a ponta em fundo escuro |

Os valores CMYK são uma conversão direta e o Pantone não foi definido. Antes de imprimir, confirme as cores com a
gráfica e com um guia físico. As cores vêm dos tokens do app (`src/renderer/design-system/tokens.css`).

**Fundos aprovados:**
- Claros: branco ou `#F5F9FF`, com a versão colorida.
- Escuros: marinho `#0B2A4F`, `#0F1726` ou preto, com a versão "on dark".
- Fotos: só a versão de uma cor, numa área calma da imagem.

## 5. Tipografia

O nome é **Public Sans Bold** (licença SIL OFL), já convertido em contornos no arquivo, com o kerning da própria fonte.
O app usa Public Sans na interface e JetBrains Mono para as palavras de quem pratica.

## 6. Não faça

- Não troque a cor do pato (por exemplo, amarelo ou verde) nem a do bico.
- Não estique, não gire e não espelhe a logo.
- Não ponha contorno, sombra, gradiente ou brilho.
- Não ponha o pato azul em fundo azul-céu ou azul médio, porque ele some. Use marinho ou branco.
- Não junte a ponta de grafite ao bico no tamanho grande, nem separe no pequeno.
- Não troque a fonte do nome nem reescreva "DevTalk" à mão.
- Não use os mascotes do app (patos, ursos e axolotes de terceiros) como logo nem junto da logo.

## 7. Entrega e pendências

- **Testes feitos:**
  - `svg_audit` com nota 100/100 no símbolo;
  - folha de testes da skill: 16/32/48 px, uma cor, invertida, desfoque, espelhada, girada 180° e contextos;
  - comparação com logos de educação e com o Disqus/Expo, sem parecido forte.
  - O DuckDuckGo também é um pato, mas é uma cabeça de frente com gravata dentro de um anel, bem diferente.
- **Pendências:**
  - Unir as formas sobrepostas (casco + cabeça) num editor vetorial se a gráfica pedir um contorno único.
  - Fazer uma busca de marca registrada antes de registrar o nome ou a logo (a skill não garante isso).
  - Colocar a logo no app: ícone do Electron, marca do menu lateral, abertura, favicon e README.
