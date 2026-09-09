import { X } from "lucide-react";
import type { ReactNode } from "react";

interface ModalProps {
  title: string;
  eyebrow?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

export function Modal({ title, eyebrow, onClose, children, footer }: ModalProps) {
  return (
    <div className="modal-layer" role="presentation">
      <button className="modal-backdrop" onClick={onClose} aria-label="Close modal" type="button" />
      <section className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-header">
          <div className="modal-title-row">
            {eyebrow}
            <h2>{title}</h2>
          </div>
          {/* `aria-label` as well as `title`, and the label is what §7 asks for:
              an icon-only button carries one. `title` is the weakest source in
              the accessible-name order — it is what a name falls back to, and it
              is dropped outright by some assistive technology — so it stays for
              the pointer tooltip and stops being the only name. The string is
              unchanged, so nothing that addresses this button by name moves. */}
          <button aria-label="Close" className="icon-button" onClick={onClose} title="Close" type="button">
            <X size={16} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer ? <footer className="modal-footer">{footer}</footer> : null}
      </section>
    </div>
  );
}
