export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/**
 * Os eventos dos capítulos vêm de iframes, cujos `Element` e `Document` são de outro realm:
 * `instanceof Element` dá falso lá. Por isso a checagem é pelo `nodeType`.
 */
function isElementLike(value: unknown): value is Element {
  return (
    typeof value === "object" &&
    value !== null &&
    "nodeType" in value &&
    value.nodeType === Node.ELEMENT_NODE &&
    "closest" in value
  );
}

function asElement(target: EventTarget | null): Element | null {
  return isElementLike(target) ? target : null;
}

export function isDocumentLike(value: unknown): value is Document {
  return (
    typeof value === "object" &&
    value !== null &&
    "nodeType" in value &&
    value.nodeType === Node.DOCUMENT_NODE
  );
}

export function isTypingTarget(target: EventTarget | null): boolean {
  const element = asElement(target);
  if (!element) return false;
  const editable = "isContentEditable" in element && element.isContentEditable === true;
  return editable || /^(input|textarea|select)$/i.test(element.tagName);
}

export function isInteractive(target: EventTarget | null): boolean {
  return asElement(target)?.closest("a[href], button, input, select, textarea") != null;
}
