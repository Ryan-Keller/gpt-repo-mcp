import { describe, expect, it } from "vitest";
import { portfolioConsoleWidgetHtml } from "../src/apps/portfolio-console-widget.js";

describe("portfolio console widget template", () => {
  it("emits valid executable JavaScript", () => {
    const html = portfolioConsoleWidgetHtml();
    const marker = '<script type="module">';
    const start = html.indexOf(marker);
    const end = html.lastIndexOf("</script>");

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(() => new Function(html.slice(start + marker.length, end))).not.toThrow();
  });

  it("keeps phone-first project and action navigation inside the widget", () => {
    const html = portfolioConsoleWidgetHtml();

    expect(html).toContain(".group.collapsed .groupbody");
    expect(html).toContain("data-toggle");
    expect(html).toContain("Copy for new thread");
    expect(html).toContain("Route batch");
    expect(html).toContain("bottomnav");
    expect(html).not.toContain("document.body.innerHTML");
  });

  it("keeps selection state actionable through the decision tray", () => {
    const html = portfolioConsoleWidgetHtml();

    expect(html).toContain("expanded:new Set()");
    expect(html).toContain("data-open-project");
    expect(html).toContain("data-remove");
    expect(html).toContain("data-note");
    expect(html).toContain("data-status");
    expect(html).toContain("sendFollowUpMessage");
    expect(html).toContain("operator_instruction");
    expect(html).toContain("Actions and console preferences are recorded before ChatGPT receives them");
    expect(html).toContain("Expand all");
    expect(html).toContain("Collapse all");
    expect(html).toContain("repo_portfolio_action_command");
    expect(html).toContain("reentry_prompt");
    expect(html).toContain("Snooze 1 day");
    expect(html).toContain("sync_console");
    expect(html).toContain("Delete selected");
    expect(html).toContain("Artifacts ·");
    expect(html).toContain("data-open-artifact");
  });
});
