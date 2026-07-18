/**
 * Compatibility shim — the design references useToast() but this project
 * uses Sonner for toasts. This shim wraps Sonner's imperative API so all
 * existing call sites work without changes.
 */
import { toast as sonnerToast } from "sonner";

type ToastVariant = "default" | "destructive" | "success";

interface ToastOptions {
  title?: string;
  description?: string;
  variant?: ToastVariant;
}

function toast({ title, description, variant }: ToastOptions) {
  const message = title ?? description ?? "";
  const details = title && description ? description : undefined;

  if (variant === "destructive") {
    sonnerToast.error(message, details ? { description: details } : undefined);
  } else if (variant === "success") {
    sonnerToast.success(message, details ? { description: details } : undefined);
  } else {
    sonnerToast(message, details ? { description: details } : undefined);
  }
}

export function useToast() {
  return { toast };
}

export { toast };
