import { Router, type Request, type Response } from "express";
import { agentFromBearer } from "../lib/agentAuth";
import { MCP_PROTOCOL_VERSIONS } from "../lib/constants";
import { env } from "../lib/env";
import { wrap } from "../lib/asyncHandler";
import { dispatchRpc, type RpcContext } from "../lib/mcpServer";

/**
 * MCP Streamable HTTP endpoint. Mounted before session/passport/csrf - it never
 * touches cookies. Stateless: POST in, one JSON response out (no SSE, no sessions).
 */
export const mcpRouter = Router();

const SUPPORTED = new Set<string>(MCP_PROTOCOL_VERSIONS);

function originAllowed(origin: string | undefined): boolean {
  if (!origin) return true; // non-browser MCP clients omit Origin
  try {
    const host = new URL(origin).hostname;
    return host === new URL(env.PUBLIC_BASE_URL).hostname || host === "localhost" || host === "127.0.0.1";
  } catch {
    return false;
  }
}

/**
 * `readOnly` = the `/mcp/read` endpoint: same server, only the tools that change nothing.
 * That's the one to list in connector directories (Claude, etc.), where a chat user connects.
 */
const handleRpc = (readOnly: boolean) =>
  wrap(async (req: Request, res: Response) => {
    if (!originAllowed(req.get("origin"))) {
      res.status(403).json({ error: "Origin not allowed" });
      return;
    }
    // Reject only malformed versions. A newer, well-formed one is fine: version negotiation in
    // `initialize` settles what both sides use, and a hard 400 here locks out newer clients.
    const protocolVersion = req.get("mcp-protocol-version");
    if (protocolVersion && !SUPPORTED.has(protocolVersion) && !/^\d{4}-\d{2}-\d{2}$/.test(protocolVersion)) {
      res.status(400).json({ error: `Unsupported MCP-Protocol-Version: ${protocolVersion}` });
      return;
    }

    const body: unknown = req.body;
    if (!body || typeof body !== "object") {
      res
        .status(400)
        .json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
      return;
    }

    // Optional: an agent may send its Bearer key so the board-post / board-reply
    // tools know who it is. Absent/unknown keys just leave ctx.agent undefined -
    // every read tool is unauthenticated and unaffected. No cookies are read here.
    const agent = readOnly ? null : await agentFromBearer(req.get("authorization")).catch(() => null);
    const ctx: RpcContext = {
      ip: req.ip ?? "unknown",
      agent: agent ?? undefined,
      registrationToken: readOnly ? undefined : (req.get("x-registration-token") ?? undefined),
      readOnly,
    };

    if (Array.isArray(body)) {
      if (body.length === 0) {
        res
          .status(400)
          .json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Empty batch" } });
        return;
      }
      const out = (await Promise.all(body.map((m) => dispatchRpc(m, ctx)))).filter(
        (r): r is object => r !== null,
      );
      if (out.length === 0) {
        res.status(202).end();
        return;
      }
      res.json(out);
      return;
    }

    const result = await dispatchRpc(body, ctx);
    if (result === null) {
      res.status(202).end();
      return;
    }
    res.json(result);
  });

mcpRouter.post("/", handleRpc(false));
mcpRouter.post("/read", handleRpc(true));

function methodNotAllowed(_req: Request, res: Response): void {
  res.status(405).set("Allow", "POST").json({ error: "Use POST for the MCP endpoint" });
}

for (const path of ["/", "/read"]) {
  mcpRouter.get(path, methodNotAllowed);
  mcpRouter.delete(path, methodNotAllowed);
}
