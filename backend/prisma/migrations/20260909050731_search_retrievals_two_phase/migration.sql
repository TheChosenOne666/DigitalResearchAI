-- DropIndex
DROP INDEX "idx_kb_chunks_content_trgm";

-- CreateTable
CREATE TABLE "search_retrievals" (
    "id" VARCHAR(32) NOT NULL,
    "session_id" VARCHAR(32) NOT NULL,
    "question" VARCHAR(512) NOT NULL,
    "mode" VARCHAR(16) NOT NULL,
    "sources" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "search_retrievals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "search_retrievals_session_id_key" ON "search_retrievals"("session_id");

-- AddForeignKey
ALTER TABLE "search_retrievals" ADD CONSTRAINT "search_retrievals_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "search_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
