import { render, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { MemoryRouter } from "react-router";
import { Header } from "./Header";

describe("Header", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders a link wrapping logo and title", () => {
    const { container } = render(
      <MemoryRouter>
        <Header />
      </MemoryRouter>,
    );
    const link = container.querySelector("a");
    expect(link).not.toBeNull();
    expect(link?.textContent).toContain("Dapanoskop");
    // Should contain an SVG (the delta logo)
    expect(link?.querySelector("svg")).not.toBeNull();
  });

  it("includes period in link href when provided", () => {
    const { container } = render(
      <MemoryRouter>
        <Header period="2026-01" />
      </MemoryRouter>,
    );
    const link = container.querySelector("a");
    expect(link?.getAttribute("href")).toBe("/?period=2026-01");
  });

  it("links to / when no period is provided", () => {
    const { container } = render(
      <MemoryRouter>
        <Header />
      </MemoryRouter>,
    );
    const link = container.querySelector("a");
    expect(link?.getAttribute("href")).toBe("/");
  });

  it("renders logout button when onLogout is provided", () => {
    const onLogout = vi.fn();
    const { getByText } = render(
      <MemoryRouter>
        <Header onLogout={onLogout} />
      </MemoryRouter>,
    );
    const button = getByText("Logout");
    expect(button).not.toBeNull();
    button.click();
    expect(onLogout).toHaveBeenCalledOnce();
  });

  it("does not render logout button when onLogout is omitted", () => {
    const { queryByText } = render(
      <MemoryRouter>
        <Header />
      </MemoryRouter>,
    );
    expect(queryByText("Logout")).toBeNull();
  });
});
