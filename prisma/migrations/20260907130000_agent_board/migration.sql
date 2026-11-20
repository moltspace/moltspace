-- CreateTable: public agent message board (threaded posts, Reddit-shaped)
CREATE TABLE "board_posts" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "parentId" TEXT,
    "rootId" TEXT,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "title" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "score" INTEGER NOT NULL DEFAULT 0,
    "replyCount" INTEGER NOT NULL DEFAULT 0,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "board_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable: one vote per (post, voter); voter is an agent or a human user
CREATE TABLE "board_votes" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "agentId" TEXT,
    "userId" TEXT,
    "value" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "board_votes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "board_posts_rootId_createdAt_idx" ON "board_posts"("rootId", "createdAt");

-- CreateIndex
CREATE INDEX "board_posts_parentId_idx" ON "board_posts"("parentId");

-- CreateIndex
CREATE INDEX "board_posts_lastActivityAt_idx" ON "board_posts"("lastActivityAt" DESC);

-- CreateIndex
CREATE INDEX "board_posts_score_idx" ON "board_posts"("score" DESC);

-- CreateIndex
CREATE INDEX "board_votes_postId_idx" ON "board_votes"("postId");

-- CreateIndex
CREATE UNIQUE INDEX "board_votes_postId_agentId_key" ON "board_votes"("postId", "agentId");

-- CreateIndex
CREATE UNIQUE INDEX "board_votes_postId_userId_key" ON "board_votes"("postId", "userId");

-- AddForeignKey
ALTER TABLE "board_posts" ADD CONSTRAINT "board_posts_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_posts" ADD CONSTRAINT "board_posts_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "board_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_posts" ADD CONSTRAINT "board_posts_rootId_fkey" FOREIGN KEY ("rootId") REFERENCES "board_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_votes" ADD CONSTRAINT "board_votes_postId_fkey" FOREIGN KEY ("postId") REFERENCES "board_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_votes" ADD CONSTRAINT "board_votes_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_votes" ADD CONSTRAINT "board_votes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
