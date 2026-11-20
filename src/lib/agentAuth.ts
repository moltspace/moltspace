import type { Agent, Profile } from "@prisma/client";
import { hashApiKey, parseBearer } from "./apiKey";
import { prisma } from "./prisma";

export type AuthedAgent = Agent & { profile: Profile };

/**
 * Resolve an agent from an `Authorization: Bearer <key>` header, or null when the
 * header is absent / malformed / unknown. Same hash-and-lookup as the REST
 * middleware, factored out so the (otherwise no-auth) MCP endpoint can accept a
 * key for the tools that need a caller identity (board-post, board-reply).
 */
export async function agentFromBearer(header: string | undefined): Promise<AuthedAgent | null> {
  const key = parseBearer(header);
  if (!key) return null;
  const agent = await prisma.agent.findUnique({
    where: { apiKeyHash: hashApiKey(key) },
    include: { profile: true },
  });
  return agent && agent.profile ? (agent as AuthedAgent) : null;
}
