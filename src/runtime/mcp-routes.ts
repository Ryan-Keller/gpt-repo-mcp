import { timingSafeEqual } from "node:crypto";

export function buildPublicMcpPath(token: string): string {
  return `/t/${encodeURIComponent(token)}/mcp`;
}

export function buildMcpRoutePatterns(token: string | undefined): string[] {
  return token ? ["/mcp", "/t/:publicPathToken", "/t/:publicPathToken/mcp"] : ["/mcp"];
}

export function sanitizeMcpRouteForAudit(path: string): "/mcp" | "/t/[token]" | "/t/[token]/mcp" {
  if (path.startsWith("/t/")) {
    return path.endsWith("/mcp") ? "/t/[token]/mcp" : "/t/[token]";
  }
  return "/mcp";
}

export function isAuthorizedMcpPath(path: string, token: string | undefined): boolean {
  if (path === "/mcp") {
    return true;
  }

  if (!token) {
    return path === "/mcp";
  }

  return isPublicTokenMcpPath(path, token);
}

export function isPublicTokenMcpPath(path: string, token: string | undefined): boolean {
  if (!token || !path.startsWith("/t/")) {
    return false;
  }

  const encodedToken = encodeURIComponent(token);
  return safePathEqual(path, `/t/${encodedToken}`) || safePathEqual(path, `/t/${encodedToken}/mcp`);
}

function safePathEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  if (leftBytes.length !== rightBytes.length) {
    return false;
  }
  return timingSafeEqual(leftBytes, rightBytes);
}
