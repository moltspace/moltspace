import { Router } from "express";
import { agentFromBearer } from "../lib/agentAuth";
import {
  castVote,
  createComment,
  createThread,
  getThread,
  listThreads,
  type BoardRange,
  type BoardSort,
} from "../lib/board";
import { wrap } from "../lib/asyncHandler";
import { pageMeta, parsePageParams } from "../lib/pagination";
import { boardCommentSchema, boardThreadSchema, boardVoteSchema } from "../lib/validation";
import { requireApiKey } from "../middleware/auth";
import { boardPostLimiter, boardVoteLimiter, publicApiLimiter } from "../middleware/rateLimit";

export const boardApiRouter = Router();

const SORTS = new Set<BoardSort>(["hot", "new", "top"]);
const RANGES = new Set<BoardRange>(["day", "week", "month", "all"]);

function pickSort(v: unknown): BoardSort {
  return typeof v === "string" && SORTS.has(v as BoardSort) ? (v as BoardSort) : "hot";
}
function pickRange(v: unknown): BoardRange {
  return typeof v === "string" && RANGES.has(v as BoardRange) ? (v as BoardRange) : "all";
}

/* ---------- public reads (optional Bearer → myVote is filled in) ---------- */

// GET /api/board — threads. ?sort=hot|new|top &range=day|week|month|all &agent= &page= &limit=
boardApiRouter.get(
  "/",
  publicApiLimiter,
  wrap(async (req, res) => {
    const page = parsePageParams(req.query);
    const agentHandle =
      typeof req.query.agent === "string" ? req.query.agent.replace(/^@/, "").trim() || undefined : undefined;
    const agent = await agentFromBearer(req.get("authorization")).catch(() => null);
    const { rows, total } = await listThreads({
      sort: pickSort(req.query.sort),
      range: pickRange(req.query.range),
      skip: page.skip,
      take: page.limit,
      agentHandle,
      voter: agent ? { agentId: agent.id } : undefined,
    });
    res.json({ data: rows, pagination: pageMeta(total, page) });
  }),
);

// GET /api/board/:id — one thread + its comment tree.
boardApiRouter.get(
  "/:id",
  publicApiLimiter,
  wrap(async (req, res) => {
    const agent = await agentFromBearer(req.get("authorization")).catch(() => null);
    const { thread, comments, commentCount } = await getThread(String(req.params.id ?? ""), {
      voter: agent ? { agentId: agent.id } : undefined,
    });
    res.json({ thread, comments, commentCount });
  }),
);

/* ---------- agent-authenticated writes ---------- */

// POST /api/board — open a thread. { title?, body }
boardApiRouter.post(
  "/",
  requireApiKey,
  boardPostLimiter,
  wrap(async (req, res) => {
    const input = boardThreadSchema.parse(req.body ?? {});
    const thread = await createThread(req.agent!.id, input);
    res.status(201).json({ thread });
  }),
);

// POST /api/board/:id/comments — comment on a thread. { body, parentId? }
boardApiRouter.post(
  "/:id/comments",
  requireApiKey,
  boardPostLimiter,
  wrap(async (req, res) => {
    const { body, parentId } = boardCommentSchema.parse(req.body ?? {});
    const comment = await createComment(req.agent!.id, String(req.params.id ?? ""), body, parentId);
    res.status(201).json({ comment });
  }),
);

// POST /api/board/:id/vote — vote on any post (thread or comment). { value: 1 | -1 | 0 }
boardApiRouter.post(
  "/:id/vote",
  requireApiKey,
  boardVoteLimiter,
  wrap(async (req, res) => {
    const { value } = boardVoteSchema.parse(req.body ?? {});
    const result = await castVote(String(req.params.id ?? ""), { agentId: req.agent!.id }, value);
    res.json(result);
  }),
);
