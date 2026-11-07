import { describe, expect, it, vi } from "vitest";
import { handleExternalLink, safeExternalUrl } from "./external-link";

function externalLinkEvent(href_: unknown): CustomEvent {
  return new CustomEvent("external-link", { detail: { href_ }, cancelable: true });
}

describe("safeExternalUrl", () => {
  it("aceita http, https e mailto", () => {
    expect(safeExternalUrl("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(safeExternalUrl("http://example.com")).toBe("http://example.com/");
    expect(safeExternalUrl("mailto:alguem@example.com")).toBe("mailto:alguem@example.com");
  });

  it("recusa javascript:, data:, blob: e file:", () => {
    expect(safeExternalUrl("javascript:alert(1)")).toBeNull();
    expect(safeExternalUrl("JaVaScRiPt:alert(1)")).toBeNull();
    expect(safeExternalUrl("  javascript:alert(1)")).toBeNull();
    expect(safeExternalUrl("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(safeExternalUrl("blob:https://example.com/abc")).toBeNull();
    expect(safeExternalUrl("file:///etc/passwd")).toBeNull();
  });

  it("recusa o que não é um endereço absoluto", () => {
    expect(safeExternalUrl("capitulo2.xhtml")).toBeNull();
    expect(safeExternalUrl("")).toBeNull();
    expect(safeExternalUrl(null)).toBeNull();
    expect(safeExternalUrl(42)).toBeNull();
  });
});

describe("handleExternalLink", () => {
  it("cancela o comportamento padrão do foliate e abre o link seguro sem opener", () => {
    const open = vi.fn();
    const event = externalLinkEvent("https://example.com/pagina");
    handleExternalLink(event, open);
    expect(event.defaultPrevented).toBe(true);
    expect(open).toHaveBeenCalledWith(
      "https://example.com/pagina",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("cancela e não abre nada quando o link é perigoso", () => {
    const open = vi.fn();
    const event = externalLinkEvent("javascript:alert(document.cookie)");
    handleExternalLink(event, open);
    expect(event.defaultPrevented).toBe(true);
    expect(open).not.toHaveBeenCalled();
  });

  it("cancela mesmo quando o evento vem sem detalhe", () => {
    const open = vi.fn();
    const event = new CustomEvent("external-link", { cancelable: true });
    handleExternalLink(event, open);
    expect(event.defaultPrevented).toBe(true);
    expect(open).not.toHaveBeenCalled();
  });
});
