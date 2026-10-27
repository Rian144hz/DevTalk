# DevTalk — Cores azul-céu e botões em pílula

Data: 2026-10-27. Aprovado em conversa com o dono ("sim, aprova, pode fazer").

## 1. Objetivo

O app fica com cara mais leve e alegre, no estilo do site do AbacatePay, mas em azul. Mudam só as **cores** de tudo e o
**formato e a animação dos botões**. Layout, telas, textos, fontes, tamanhos e espaços continuam iguais.

### Decisões do dono

- Cor principal **azul-céu** (opção A): botão azul claro com texto azul-marinho.
- Os dois temas continuam e **seguem o sistema**, como hoje. Os dois ganham as cores novas.
- Inspiração no AbacatePay sem copiar código, marca, fonte ou imagens deles.

### Fora do escopo

Layout, fonte (Public Sans e JetBrains Mono ficam), raios de cartões e campos, textos, ícones, sombras em cartões,
animação de cartões ou linhas, a abertura animada (só herda as cores).

### Pronto quando

1. Os tokens dos dois temas usam a paleta da §2, e todo par de texto passa o contraste da §4.
2. Os botões são pílulas com o movimento da §3, e com "reduzir movimento" só a cor muda.
3. Nenhuma cor fixa sobra fora dos tokens, exceto os grounds espelhados em `stack-icons.ts`, que passam a seguir os
   novos valores. O fundo atrás dos diálogos e da paleta (o "scrim") agora é o token `--scrim`, marinho nos dois temas
   (escuro `rgb(2 8 20 / 0.5)`, claro `rgb(11 42 79 / 0.24)`), e não mais um preto fixo.
4. Os testes de unidade e e2e passam, há prints nos dois temas e uma revisão de design, e o DESIGN.md é atualizado.

## 2. Paleta

`--pencil` hoje faz duas coisas: preenche o botão principal e pinta texto e marcas (links, notas, passos, tally,
lápis). O azul-céu não lê como texto em fundo claro, então o token se divide:

- `--accent`, `--accent-hover` e `--on-accent`: o preenchimento do botão principal e o texto em cima dele.
- `--pencil`: texto e marcas azuis, legível no fundo de cada tema.
- `--pencil-ink` sai. `--pencil-wash` continua e passa a ser a lavagem azul-céu, usada na seleção de texto e no hover
  do botão discreto.

Os valores abaixo são o alvo. Se algum não passar o teste de contraste, o implementador ajusta o mínimo e registra a
mudança.

| Token | Claro | Escuro |
|---|---|---|
| `--bg` | `#f5f9ff` | `#0f1726` |
| `--bg-rail` | `#edf3fc` | `#0c1320` |
| `--sheet` | `#ffffff` | `#162033` |
| `--sheet-hover` | `#f2f7fe` | `#1c2840` |
| `--rule` | `#e0e8f3` | `#24324a` |
| `--rule-strong` | `#c7d4e6` | `#33445f` |
| `--ink` | `#0b2a4f` | `#e6eef9` |
| `--ink-2` | `#3a5274` | `#afc0d8` |
| `--ink-3` | `#5a6f8c` | `#8799b4` |
| `--accent` | `#8ec5ff` | `#8ec5ff` |
| `--accent-hover` | `#74b6ff` | `#a6d2ff` |
| `--on-accent` | `#0b2a4f` | `#0b2a4f` |
| `--pencil` | `#1f63b8` | `#8ec5ff` |
| `--pencil-wash` | `rgb(142 197 255 / 0.22)` | `rgb(142 197 255 / 0.14)` |
| `--del` | `#a3294b` | `#f0a3b6` |
| `--del-wash` | `rgb(240 120 150 / 0.16)` | `rgb(240 163 182 / 0.14)` |
| `--ins` | `#1d6b3e` | `#8fd9ac` |
| `--ins-wash` | `rgb(70 190 120 / 0.16)` | `rgb(143 217 172 / 0.14)` |
| `--warn` | `#7a5200` | `#e8c27a` |
| `--focus` | `#2f7de1` | `#a6d2ff` |
| `--graph-0` | `#e3eaf4` | `#1a2436` |

- As outras cores do gráfico continuam verdes. As cores de selo ficam, desde que passem o teste.
- `--shadow-float` usa sombra tingida de marinho (`rgb(11 42 79 / …)`) nos dois temas.
- `theme-boot.js` não muda: ele só põe `data-theme`, e as cores vêm dos tokens.
- `THEME_GROUNDS` e `NEUTRAL` em `src/renderer/lib/stack-icons.ts` espelham `--bg`, `--sheet` e `--ink-2`.

## 3. Botões

- **Formato:** todo `.btn` vira pílula, com um novo token `--r-pill: 999px`. O preenchimento passa a 9px por 18px. As
  regras de tamanho que já existem (largura total na boas-vindas, botões pequenos no chat) continuam valendo.
- **Primário:** fundo `--accent` e texto `--on-accent`. No hover, `--accent-hover` e sobe 1px (`translateY(-1px)`).
- **Secundário:** fundo `--sheet` com borda de 1px `--rule-strong`. No hover, `--sheet-hover` e sobe 1px.
- **Discreto:** sem fundo. No hover, a pílula ganha `--pencil-wash` e o texto vira `--ink`. Não sobe.
- **Clique:** todos apertam para `scale(0.98)`.
- **Ícone que vem depois do texto** (o último filho, quando não é o primeiro): anda 4px para a direita no hover. O
  ícone que vem antes do texto, como o do GitHub, fica parado.
- **Tempos:** fundo e transform em 200ms. O ícone anda em 300ms, na curva `--ease-out`.
- **Desabilitado e ocupado:** sem hover nem movimento. A opacidade continua como hoje.
- **Reduzir movimento:** nada sobe, aperta ou anda, só a cor muda.
- **Foco visível:** o contorno de foco segue a pílula.

## 4. Contraste (teste de unidade)

`tests/renderer/colour.test.ts` ganha um teste que lê `tokens.css` e confere, nos dois temas, estes mínimos:

| Pares | Mínimo |
|---|---|
| `--ink`, `--ink-2` e `--ink-3` sobre `--bg`, `--bg-rail`, `--sheet` e `--sheet-hover` | 4,5:1 |
| `--pencil` sobre `--bg` e `--sheet` | 4,5:1 |
| `--on-accent` sobre `--accent` e sobre `--accent-hover` | 4,5:1 |
| `--del` sobre `--del-wash`, e `--ins` sobre `--ins-wash`, cada lavagem composta sobre `--sheet` | 4,5:1 |
| `--warn` sobre `--sheet` | 4,5:1 |
| `--focus` sobre `--bg` e `--sheet` | 3:1 |

## 5. Testes e entrega

- **Unidade:** contraste (§4); o teste de `stack-icons` com os novos grounds.
- **E2E:**
  - Os dois testes de `start.spec.ts` que fixam a cor de fundo da abertura passam a usar o novo `--bg` claro.
  - Um teste de botão confere o formato de pílula, a subida de 1px no hover do primário e que, com reduzir movimento,
    não há transform.
- **Prints:** todas as telas nos dois temas, em 1440 e 960 (o `screenshots.spec.ts` que já existe), com folhas de
  contato.
- **Revisão:** revisão de design (impeccable), DESIGN.md atualizado e revisão final.
- Testes de unidade com `--maxWorkers=2`.
