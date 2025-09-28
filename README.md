# WALLY//FINDER

Aplicativo web mobile "Onde está Wally" construído com HTML/CSS/JS puro. O foco é captura de vídeo fluida (60 fps), inferência off-main-thread, cache offline e um modo Preset Builder para montar datasets de partes dos personagens.

## Rodando localmente

1. Instale qualquer servidor HTTP estático (ex.: `npm install -g serve`).
2. Na raiz do projeto, execute `serve .` (ou `python -m http.server`).
3. Acesse `http://localhost:3000/index.html` (ou porta equivalente) usando um navegador mobile/desktop.
4. Autorize o acesso à câmera quando solicitado.

> ⚠️ Safari iOS exige HTTPS para acessar a câmera. Utilize `npx http-server --ssl` ou publique via localhost com certificado.

## Estrutura principal

- `index.html` – Tela principal com vídeo, HUD e bottom sheet de achados.
- `main.js` – Loop de captura (mailbox 1 frame), integração com o `detector.worker.js`, desenho das caixas e persistência dos achados.
- `detector.worker.js` – Worker modular com pré-filtro HSV+listras, inferência via ONNX Runtime Web (wasm+SIMD) ou fallback TFLite, NMS e histerese temporal.
- `color.js` – Funções puras para HSV, contagem de cores e gates positivo/negativo.
- `db.js` – Wrapper leve de IndexedDB (stores: achados, banks, presetSamples).
- `service-worker.js` – Cache offline de assets, modelos e bancos.
- `preset-builder.html/js/css` – Ferramenta embutida para capturar/importar imagens, anotar ROIs e exportar `.zip` compatível com os scripts offline.
- `scripts_offline/` – Automação para gerar bancos INT8 (`make_banks.py`) e exportar/quantizar o detector (`export_onnx_int8.py`).

## UI e tema alegre

- O visual foi redesenhado com base em pastéis ensolarados (creme, pêssego e magenta leve) e bordas rosadas translúcidas — nenhum painel usa cinza ou preto.
- `styles.css` centraliza os tokens compartilhados; ajuste tonalidades alterando `--bg`, `--surface`, `--surface-elevated` e `--line` para experimentar outras combinações vibrantes.
- O wordmark "WALLY FINDER" convive com chips e botões em gradiente suave, e o Preset Builder replica a mesma linguagem para manter a experiência coesa.
- Componentes interativos (chips, botões, sheets) usam feedbacks luminosos e continuam garantindo contraste AA e respeito a `prefers-reduced-motion`.

## Modelos e bancos

- Substitua `models/nanodet_int8.onnx` pelo modelo real (NanoDet-Tiny ou SSD-Lite MobileNet) quantizado em INT8.
- Substitua `tflite/nanodet_int8.tflite` pelo fallback WASM equivalente.
- Gere bancos INT8 com `python scripts_offline/make_banks.py --dataset ./dataset` (dataset estruturado conforme indicado no prompt). Os arquivos resultantes (`banks/*.i8.bin` + `index.json`) devem ser copiados para a pasta `banks/`.
- Para exportar o modelo ONNX INT8 a partir de um checkpoint PyTorch, use `python scripts_offline/export_onnx_int8.py --checkpoint path/to/model.pth --output models/nanodet_int8.onnx --calibration ./calibration_npys`.

## Preset Builder

- Acesse `preset-builder.html` (link direto no modal de configurações).
- Capture uma foto da câmera ou importe imagem local.
- Desenhe uma ROI retangular (160×160 será gerado automaticamente).
- Selecione personagem e parte com os chips dedicados.
- Clique em **Salvar amostra** para persistir na IndexedDB (`presetSamples`).
- Utilize **Exportar .zip** para gerar `dataset/<personagem>/<parte>/*.jpg` e negativos difíceis (`dataset/negatives_hard/*.jpg`).

## Debug e auto-tuning

- Abra o painel de debug via configurações. Métricas em tempo real: `inferMs`, `IA fps`, ROIs e drops por deadline.
- O campo "Processar 1 a cada N frames" permite ajustar o orçamento de IA (default N=6).

## Offline e compartilhamento

- O Service Worker mantém assets críticos e modelos no cache. Limpe via DevTools se necessário.
- Achados ficam na IndexedDB (`achados`) como Blob JPEG + metadados. Ao clicar em "Revelar achado", o frame capturado é reproduzido com overlay sutil.
- O botão de compartilhar (Web Share API) pode ser adicionado facilmente na CTA — consulte comentários em `main.js`.

## Licença e material visual

Nenhum asset protegido por copyright acompanha o projeto. Forneça suas próprias imagens/modelos e respeite direitos autorais ao utilizar o Preset Builder.
