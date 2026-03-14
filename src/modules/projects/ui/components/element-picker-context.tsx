"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

export interface PickedElement {
  selector: string;
  tagName?: string;
  text?: string;
  label: string;
  previewUrl?: string | null;
}

interface PreviewTarget {
  window: Window | null;
  origin: string | null;
  url?: string | null;
}

interface ElementPickerContextValue {
  isPicking: boolean;
  selectedElement: PickedElement | null;
  startPicking: () => void;
  stopPicking: () => void;
  clearSelection: () => void;
  setPreviewTarget: (target: PreviewTarget) => void;
}

const ElementPickerContext = createContext<ElementPickerContextValue | null>(null);

const buildLabel = (input: { selector?: string; tagName?: string; text?: string }) => {
  const labelParts: string[] = [];
  const tag = input.tagName?.trim();
  if (tag) {
    labelParts.push(`<${tag.toLowerCase()}>`);
  }
  const text = input.text?.trim();
  if (text) {
    const trimmed = text.length > 80 ? `${text.slice(0, 77)}...` : text;
    labelParts.push(`"${trimmed}"`);
  }
  if (labelParts.length > 0) {
    return labelParts.join(" ");
  }
  const selector = input.selector?.trim();
  if (selector) {
    return selector;
  }
  return "Selected element";
};

export const ElementPickerProvider = ({ children }: { children: React.ReactNode }) => {
  const [isPicking, setIsPicking] = useState(false);
  const [selectedElement, setSelectedElement] = useState<PickedElement | null>(null);
  const previewWindowRef = useRef<Window | null>(null);
  const previewOriginRef = useRef<string | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  const setPreviewTarget = useCallback((target: PreviewTarget) => {
    previewWindowRef.current = target.window;
    previewOriginRef.current = target.origin;
    previewUrlRef.current = target.url ?? null;
  }, []);

  const postToPreview = useCallback((payload: Record<string, unknown>) => {
    const previewWindow = previewWindowRef.current;
    if (!previewWindow) {
      return false;
    }
    const origin = previewOriginRef.current ?? "*";
    try {
      previewWindow.postMessage(payload, origin);
      return true;
    } catch {
      return false;
    }
  }, []);

  const startPicking = useCallback(() => {
    const sent = postToPreview({ type: "ALBERT_ELEMENT_PICKER_START" });
    if (!sent) {
      toast.error("Preview isn't ready for element picking.");
      return;
    }
    setIsPicking(true);
  }, [postToPreview]);

  const stopPicking = useCallback(() => {
    postToPreview({ type: "ALBERT_ELEMENT_PICKER_STOP" });
    setIsPicking(false);
  }, [postToPreview]);

  const clearSelection = useCallback(() => {
    setSelectedElement(null);
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const previewWindow = previewWindowRef.current;
      if (previewWindow && event.source !== previewWindow) {
        return;
      }
      const previewOrigin = previewOriginRef.current;
      if (previewOrigin && event.origin !== previewOrigin) {
        return;
      }
      const data = event.data;
      if (!data || typeof data !== "object") {
        return;
      }
      const payload = data as Record<string, unknown>;
      const type = payload.type;
      if (type === "ALBERT_ELEMENT_PICKED") {
        const selector = typeof payload.selector === "string" ? payload.selector : "";
        const tagName = typeof payload.tagName === "string" ? payload.tagName : undefined;
        const text = typeof payload.text === "string" ? payload.text : undefined;
        const label = buildLabel({ selector, tagName, text });
        setSelectedElement({
          selector,
          tagName,
          text,
          label,
          previewUrl: previewUrlRef.current,
        });
        setIsPicking(false);
        return;
      }
      if (type === "ALBERT_ELEMENT_PICKER_UNSUPPORTED") {
        setIsPicking(false);
        toast.error("This preview doesn't support live element picking.");
      }
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    if (!isPicking) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        stopPicking();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isPicking, stopPicking]);

  const value = useMemo(() => ({
    isPicking,
    selectedElement,
    startPicking,
    stopPicking,
    clearSelection,
    setPreviewTarget,
  }), [isPicking, selectedElement, startPicking, stopPicking, clearSelection, setPreviewTarget]);

  return (
    <ElementPickerContext.Provider value={value}>
      {children}
    </ElementPickerContext.Provider>
  );
};

export const useElementPicker = () => {
  const context = useContext(ElementPickerContext);
  if (!context) {
    throw new Error("useElementPicker must be used within ElementPickerProvider");
  }
  return context;
};
