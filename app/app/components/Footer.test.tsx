import { render } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";

describe("Footer", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the version from __APP_VERSION__", async () => {
    vi.stubGlobal("__APP_VERSION__", "1.5.0");
    // Dynamic import so the stubbed global is picked up
    const { Footer } = await import("./Footer");
    const { container } = render(<Footer />);
    expect(container.textContent).toContain("v1.5.0");
    expect(container.textContent).toContain("Dapanoskop");
  });
});
