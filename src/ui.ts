const modalRoot = document.querySelector<HTMLDivElement>("#modal-root")!;
const toastRoot = document.querySelector<HTMLDivElement>("#toast-root")!;

export function esc(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export function spinner(label = ""): string {
  return `<span class="spinner"></span>${label ? `<span>${esc(label)}</span>` : ""}`;
}

export function toast(
  message: string,
  kind: "info" | "success" | "error" = "info",
): void {
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.textContent = message;
  toastRoot.appendChild(el);

  window.setTimeout(() => {
    el.classList.add("leaving");
    window.setTimeout(() => el.remove(), 180);
  }, kind === "error" ? 6000 : 3500);
}

export function openModal(html: string): HTMLDivElement {
  modalRoot.innerHTML = `<div class="modal-backdrop" data-close="true">${html}</div>`;
  document.body.classList.add("modal-open");
  const backdrop = modalRoot.firstElementChild as HTMLDivElement | null;
  if (backdrop) {
    window.setTimeout(() => {
      const focusable = backdrop.querySelector<HTMLElement>(
        "input:not([type=hidden]), select, textarea, button.primary",
      );
      focusable?.focus();
    }, 20);
  }
  return backdrop ?? modalRoot;
}

export function closeModal(): void {
  modalRoot.innerHTML = "";
  document.body.classList.remove("modal-open");
}

export function confirmDialog(
  title: string,
  message: string,
  confirmLabel = "Delete",
): Promise<boolean> {
  return new Promise((resolve) => {
    const backdrop = openModal(`
      <div class="modal small">
        <div class="modal-head">
          <h2>${esc(title)}</h2>
          <button type="button" class="icon-btn" data-close="true" aria-label="Close">✕</button>
        </div>
        <div class="modal-body">
          <p class="confirm-text">${esc(message)}</p>
        </div>
        <div class="modal-foot">
          <button type="button" class="btn ghost" data-confirm="no">Cancel</button>
          <span class="spacer"></span>
          <button type="button" class="btn danger" data-confirm="yes">${esc(confirmLabel)}</button>
        </div>
      </div>
    `);

    const finish = (value: boolean) => {
      closeModal();
      resolve(value);
    };

    backdrop.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      if (target.closest("[data-confirm='yes']")) finish(true);
      else if (target.closest("[data-confirm='no']")) finish(false);
      else if (target.closest("[data-close]")) finish(false);
    });
  });
}

document.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  const closer = target.closest("[data-close]");
  if (closer && !target.closest("[data-confirm]")) {
    if (
      closer.classList.contains("modal-backdrop") &&
      event.target !== closer
    ) {
      return;
    }
    closeModal();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && modalRoot.innerHTML !== "") {
    closeModal();
  }
});
