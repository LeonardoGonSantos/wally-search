# Guia de UX / UI

## Tom visual
- Paleta alegre sem cinza ou preto: planos em creme/pêssego (`--bg`) com superfícies translúcidas rosa-claro (`--surface`) e detalhes em magenta, turquesa e amarelo ensolarado.
- Tipografia `Inter/SF/Roboto` com títulos 18–20px e corpo 14–16px; wordmark "WALLY FINDER" mantém letter-spacing e recebe brilho suave.
- `backdrop-filter: blur(12px)` sustenta o efeito de vidro colorido nos painéis, sempre com gradientes pastéis.
- Feedbacks de foco/hover usam variações luminosas (aumento de saturação/gradiente) ao invés de contrastes cinzentos.

## Layout principal
- Vídeo full-bleed (`object-fit: cover`) ocupando todo o viewport.
- Canvas de overlay com boxes arredondados, stroke animado e faixa de label com contraste.
- HUD compacto no canto superior esquerdo com métricas de IA, em gradiente rosa-branco.
- Bottom bar fixa contendo chips de personagens (rolagem horizontal) e CTA principal com gradiente turquesa.
- Bottom sheet "Achados" com cards 72×72 px, título/horário e botão limpar sobre vidro pastel.

## Interações
- Processamento de IA roda off-main-thread; manter UI responsiva (<16ms).
- Mailbox: máximo 1 frame pendente. Drops por deadline exibidos no HUD e no painel debug.
- Ao encontrar personagem: vibrar levemente (`navigator.vibrate(120)`), mostrar toast radiante, habilitar CTA "Revelar achado".
- Animações curtas (200–300 ms) com easing `cubic-bezier(.2,.8,.2,1)`; bottom sheet/toasts 400–600 ms com suavização colorida.
- Respeitar `prefers-reduced-motion`: remover transições e animações.

## Acessibilidade
- Alvos mínimos 44×44 px, especialmente para chips/CTA.
- Contraste AA com texto púrpura sobre superfícies claras; `text-shadow` suave para legibilidade sobre o vídeo.
- HUD e toasts com `aria-live` configurado (`polite`/`assertive`).
- Painel de configurações via `<dialog>` com navegação por teclado.

## Preset Builder
- Layout em três áreas: captura/import, painel de chips (personagem/parte) e galeria local, todos com painéis translúcidos pastéis e bordas rosadas.
- ROI desenhável (retângulo com handles) e geração automática de crop 160×160.
- Galeria mostra miniaturas com label e timestamp, botões para excluir com feedback em magenta.
- Export `.zip` monta estrutura `dataset/<personagem>/<parte>/*.jpg` + `dataset/negatives_hard/*.jpg`.
- Microcopy reforça boas práticas (variedade de ângulos/iluminação) e alerta legal. O subtítulo da barra fixa lembra que é um laboratório criativo.

## Debug oculto
- Painel flutuante ativado em configurações exibindo `inferMs`, `IA fps`, ROIs e drops.
- Auto-tuning manual via campo "Processar 1 a cada N frames".

## Offline
- Service Worker pré-cache de HTML/CSS/JS e armazenamento de modelos/bancos sob demanda.
- IndexedDB guarda achados, bancos e amostras do Preset Builder.
