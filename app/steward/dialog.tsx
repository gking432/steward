"use client";
import { useEffect, useRef, type ReactNode } from 'react';

/** Native modal supplies focus containment, inert background and Escape. */
export function Modal({ children, onClose, label, className = '', open=true }: { children: ReactNode; onClose: () => void; label: string; className?: string; open?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if(!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    dialog?.showModal();
    return () => { dialog?.close(); opener?.focus(); };
  }, [open]);
  return <dialog ref={ref} className={className} aria-label={label} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>{children}</dialog>;
}
