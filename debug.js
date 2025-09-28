const template = `
  <div class="debug-panel">
    <header>Debug IA</header>
    <dl>
      <div><dt>Inferência (ms)</dt><dd data-field="infer">--</dd></div>
      <div><dt>IA fps</dt><dd data-field="fps">--</dd></div>
      <div><dt>ROIs</dt><dd data-field="rois">--</dd></div>
      <div><dt>Drops</dt><dd data-field="drops">0</dd></div>
    </dl>
    <footer>
      <small>IA roda off-main-thread. Ajuste N se necessário.</small>
    </footer>
  </div>
`;

let styleInjected = false;

export function createDebugPanel() {
  if (!styleInjected) {
    injectStyle();
    styleInjected = true;
  }
  const host = document.createElement('div');
  host.className = 'debug-host';
  host.innerHTML = template;
  document.body.appendChild(host);
  const fields = host.querySelectorAll('[data-field]');
  const map = {};
  fields.forEach((el) => {
    map[el.dataset.field] = el;
  });

  return {
    update(values) {
      if (!values) return;
      if (values.inferMs != null) map.infer.textContent = values.inferMs.toFixed?.(1) ?? values.inferMs;
      if (values.fps != null) map.fps.textContent = values.fps.toFixed?.(1) ?? values.fps;
      if (values.rois != null) map.rois.textContent = values.rois;
      if (values.drops != null) map.drops.textContent = values.drops;
    },
    destroy() {
      host.remove();
    }
  };
}

function injectStyle() {
  const style = document.createElement('style');
  style.textContent = `
    .debug-host {
      position: fixed;
      top: 72px;
      right: 16px;
      z-index: 999;
      color: #0f172a;
    }
    .debug-panel {
      background: rgba(255, 255, 255, 0.92);
      border-radius: 12px;
      padding: 0.75rem 1rem;
      min-width: 200px;
      font-family: 'SFMono-Regular', 'Roboto Mono', monospace;
      box-shadow: 0 12px 24px rgba(0,0,0,0.35);
    }
    .debug-panel header {
      font-weight: 600;
      margin-bottom: 0.5rem;
      color: #0e0e10;
    }
    .debug-panel dl {
      display: grid;
      gap: 0.3rem;
      margin: 0;
    }
    .debug-panel dt {
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #475569;
    }
    .debug-panel dd {
      margin: 0;
      font-size: 1rem;
      color: #111827;
    }
    .debug-panel footer {
      font-size: 0.7rem;
      color: #475569;
      margin-top: 0.6rem;
    }
  `;
  document.head.appendChild(style);
}
