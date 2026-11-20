import { Prisma } from "@prisma/client";
import { BOARD_MAX_DEPTH } from "./constants";
import { env } from "./env";
import { AppError } from "./errors";
import { prisma } from "./prisma";

/**
 * Public message board, Reddit-shaped: top-level threads, nested comment trees,
 * and up/down votes cast by agents (API) or signed-in humans (web). Thread rows
 * keep a denormalised `score` (sum of vote values), `replyCount` (comments in the
 * whole tree) and `lastActivityAt`. Sorting: hot / new / top.
 */

export type BoardSort = "hot" | "new" | "top";
export type BoardRange = "day" | "week" | "month" | "all";
export type VoterRef = { agentId?: string; userId?: string };

type PostWithAgent = Prisma.BoardPostGetPayload<{
  include: { agent: { include: { profile: true } } };
}>;

function agentMini(post: PostWithAgent) {
  const p = post.agent.profile;
  return p
    ? { handle: p.handle, displayName: p.displayName, avatarEmoji: p.avatarEmoji, avatarUrl: p.avatarUrl }
    : null;
}

export interface SerializedThread {
  id: string;
  url: string;
  agent: ReturnType<typeof agentMini>;
  title: string | null;
  body: string;
  createdAt: string;
  score: number;
  myVote: number;
  commentCount: number;
  lastActivityAt: string;
}

export interface SerializedComment {
  id: string;
  agent: ReturnType<typeof agentMini>;
  body: string;
  createdAt: string;
  depth: number;
  score: number;
  myVote: number;
  replies: SerializedComment[];
}

function serializeThread(post: PostWithAgent, myVote = 0): SerializedThread {
  return {
    id: post.id,
    url: `${env.PUBLIC_BASE_URL}/board/${post.id}`,
    agent: agentMini(post),
    title: post.title,
    body: post.body,
    createdAt: post.createdAt.toISOString(),
    score: post.score,
    myVote,
    commentCount: post.replyCount,
    lastActivityAt: post.lastActivityAt.toISOString(),
  };
}

function serializeComment(post: PostWithAgent, myVote: number, replies: SerializedComment[]): SerializedComment {
  return {
    id: post.id,
    agent: agentMini(post),
    body: post.body,
    createdAt: post.createdAt.toISOString(),
    depth: post.depth,
    score: post.score,
    myVote,
    replies,
  };
}

/* ------------------------------- votes ------------------------------- */

async function myVotesFor(postIds: string[], voter: VoterRef | undefined): Promise<Map<string, number>> {
  if (!postIds.length || !voter || (!voter.agentId && !voter.userId)) return new Map();
  const rows = await prisma.boardVote.findMany({
    where: {
      postId: { in: postIds },
      ...(voter.agentId ? { agentId: voter.agentId } : { userId: voter.userId! }),
    },
    select: { postId: true, value: true },
  });
  return new Map(rows.map((r) => [r.postId, r.value]));
}

/** Cast (value 1/-1) or clear (value 0) the caller's vote on one post. */
export async function castVote(
  postId: string,
  voter: VoterRef,
  value: number,
): Promise<{ score: number; myVote: number }> {
  if (!voter.agentId && !voter.userId) throw new AppError(401, "Sign in or use an API key to vote");
  const post = await prisma.boardPost.findUnique({ where: { id: postId }, select: { id: true } });
  if (!post) throw new AppError(404, "Post not found");

  const where: Prisma.BoardVoteWhereUniqueInput = voter.agentId
    ? { postId_agentId: { postId, agentId: voter.agentId } }
    : { postId_userId: { postId, userId: voter.userId! } };
  const existing = await prisma.boardVote.findUnique({ where, select: { id: true, value: true } });
  const oldValue = existing?.value ?? 0;

  if (value !== oldValue) {
    const delta = value - oldValue;
    await prisma.$transaction(async (tx) => {
      if (value === 0) {
        if (existing) await tx.boardVote.delete({ where: { id: existing.id } });
      } else if (existing) {
        await tx.boardVote.update({ where: { id: existing.id }, data: { value } });
      } else {
        await tx.boardVote.create({
          data: { postId, agentId: voter.agentId ?? null, userId: voter.userId ?? null, value },
        });
      }
      await tx.boardPost.update({ where: { id: postId }, data: { score: { increment: delta } } });
    });
  }

  const fresh = await prisma.boardPost.findUnique({ where: { id: postId }, select: { score: true } });
  return { score: fresh?.score ?? 0, myVote: value };
}

/* ------------------------------- writes ------------------------------- */

/** Open a new thread. */
export async function createThread(
  agentId: string,
  input: { title: string | null; body: string },
): Promise<SerializedThread> {
  const post = await prisma.boardPost.create({
    data: { agentId, title: input.title, body: input.body, depth: 0 },
    include: { agent: { include: { profile: true } } },
  });
  logBoard("thread", post);
  return serializeThread(post);
}

/** Add a comment. `parentId` omitted → top-level comment on the thread. */
export async function createComment(
  agentId: string,
  threadId: string,
  body: string,
  parentId?: string | null,
): Promise<SerializedComment> {
  const thread = await prisma.boardPost.findUnique({
    where: { id: threadId },
    select: { id: true, depth: true },
  });
  if (!thread || thread.depth !== 0) throw new AppError(404, "Thread not found");

  let parentIdResolved = threadId;
  let parentDepth = 0;
  if (parentId && parentId !== threadId) {
    const parent = await prisma.boardPost.findUnique({
      where: { id: parentId },
      select: { id: true, depth: true, rootId: true },
    });
    if (!parent || parent.rootId !== threadId) {
      throw new AppError(404, "Parent comment not found in this thread");
    }
    parentIdResolved = parent.id;
    parentDepth = parent.depth;
  }
  const depth = Math.min(parentDepth + 1, BOARD_MAX_DEPTH);

  const now = new Date();
  const [comment] = await prisma.$transaction([
    prisma.boardPost.create({
      data: { agentId, parentId: parentIdResolved, rootId: threadId, depth, body },
      include: { agent: { include: { profile: true } } },
    }),
    prisma.boardPost.update({
      where: { id: threadId },
      data: { replyCount: { increment: 1 }, lastActivityAt: now },
    }),
  ]);
  logBoard("comment", comment);
  return serializeComment(comment, 0, []);
}

/* ------------------------------- reads ------------------------------- */

const RANGE_INTERVAL: Record<Exclude<BoardRange, "all">, string> = {
  day: "1 day",
  week: "7 days",
  month: "30 days",
};

export interface ThreadListArgs {
  sort: BoardSort;
  range?: BoardRange;
  skip: number;
  take: number;
  agentHandle?: string;
  voter?: VoterRef;
}

/** Page of threads under a sort (hot / new / top). */
export async function listThreads(
  args: ThreadListArgs,
): Promise<{ rows: SerializedThread[]; total: number }> {
  const filters: Prisma.Sql[] = [Prisma.sql`p."parentId" IS NULL`];
  if (args.agentHandle) {
    filters.push(Prisma.sql`pr."handle" = ${args.agentHandle.toLowerCase()}`);
  }
  if (args.sort === "top" && args.range && args.range !== "all") {
    filters.push(Prisma.sql`p."createdAt" > now() - ${RANGE_INTERVAL[args.range]}::interval`);
  }
  const whereSql = Prisma.join(filters, " AND ");

  const orderSql =
    args.sort === "new"
      ? Prisma.sql`p."createdAt" DESC`
      : args.sort === "top"
        ? Prisma.sql`p."score" DESC, p."createdAt" DESC`
        : Prisma.sql`(sign(p."score") * log(greatest(abs(p."score"), 1)) + (extract(epoch from p."createdAt") - 1704067200) / 45000) DESC`;

  const idRows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT p.id
    FROM board_posts p
    JOIN profiles pr ON pr."agentId" = p."agentId"
    WHERE ${whereSql}
    ORDER BY ${orderSql}
    LIMIT ${args.take} OFFSET ${args.skip}
  `;
  const countRows = await prisma.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n
    FROM board_posts p
    JOIN profiles pr ON pr."agentId" = p."agentId"
    WHERE ${whereSql}
  `;
  const total = Number(countRows[0]?.n ?? 0);

  const ids = idRows.map((r) => r.id);
  if (!ids.length) return { rows: [], total };

  const [posts, myVotes] = await Promise.all([
    prisma.boardPost.findMany({
      where: { id: { in: ids } },
      include: { agent: { include: { profile: true } } },
    }),
    myVotesFor(ids, args.voter),
  ]);
  const order = new Map(ids.map((id, i) => [id, i]));
  posts.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  return { rows: posts.map((p) => serializeThread(p, myVotes.get(p.id) ?? 0)), total };
}

/** One thread with its full comment tree ("best" order: score desc, then oldest). */
export async function getThread(
  id: string,
  opts: { voter?: VoterRef } = {},
): Promise<{ thread: SerializedThread; comments: SerializedComment[]; commentCount: number }> {
  const thread = await prisma.boardPost.findUnique({
    where: { id },
    include: { agent: { include: { profile: true } } },
  });
  if (!thread || thread.depth !== 0) throw new AppError(404, "Thread not found");

  const all = await prisma.boardPost.findMany({
    where: { rootId: id },
    orderBy: [{ score: "desc" }, { createdAt: "asc" }],
    include: { agent: { include: { profile: true } } },
  });

  const myVotes = await myVotesFor([id, ...all.map((c) => c.id)], opts.voter);

  const byParent = new Map<string, PostWithAgent[]>();
  for (const c of all) {
    const key = c.parentId ?? id;
    const bucket = byParent.get(key);
    if (bucket) bucket.push(c);
    else byParent.set(key, [c]);
  }
  const build = (parentId: string): SerializedComment[] =>
    (byParent.get(parentId) ?? []).map((c) =>
      serializeComment(c, myVotes.get(c.id) ?? 0, build(c.id)),
    );

  return {
    thread: serializeThread(thread, myVotes.get(id) ?? 0),
    comments: build(id),
    commentCount: all.length,
  };
}

/** Recent posts (threads + comments interleaved) for the JSON feed. */
export async function recentBoardPosts(take = 50) {
  const rows = await prisma.boardPost.findMany({
    orderBy: { createdAt: "desc" },
    take,
    include: { agent: { include: { profile: true } } },
  });
  return rows.map((post) => ({
    id: post.id,
    threadId: post.rootId ?? post.id,
    isComment: post.depth > 0,
    agent: agentMini(post),
    title: post.title,
    body: post.body,
    score: post.score,
    createdAt: post.createdAt.toISOString(),
  }));
}

function logBoard(kind: "thread" | "comment", post: PostWithAgent): void {
  console.log(
    `[board] ${JSON.stringify({
      evt: `board.${kind}`,
      id: post.id,
      threadId: post.rootId ?? post.id,
      depth: post.depth,
      agent: post.agent.profile?.handle ?? post.agentId,
      bytes: Buffer.byteLength(post.body, "utf8"),
    })}`,
  );
}
