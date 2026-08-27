-- CreateTable
CREATE TABLE "search_sessions" (
    "id" VARCHAR(32) NOT NULL,
    "tenant_id" VARCHAR(32) NOT NULL,
    "user_id" VARCHAR(32) NOT NULL,
    "question" VARCHAR(512) NOT NULL,
    "mode" VARCHAR(16) NOT NULL DEFAULT 'hybrid',
    "conditions" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "search_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "search_reports" (
    "id" VARCHAR(32) NOT NULL,
    "session_id" VARCHAR(32) NOT NULL,
    "content_md" TEXT NOT NULL,
    "params_snapshot" JSONB,
    "token_usage" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "search_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "search_sources" (
    "id" VARCHAR(32) NOT NULL,
    "report_id" VARCHAR(32) NOT NULL,
    "idx" INTEGER NOT NULL,
    "title" VARCHAR(512) NOT NULL,
    "url" VARCHAR(1024),
    "snippet" TEXT NOT NULL,
    "source_type" VARCHAR(16) NOT NULL,
    "is_cited" BOOLEAN NOT NULL DEFAULT false,
    "meta" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "search_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "search_usage" (
    "tenant_id" VARCHAR(32) NOT NULL,
    "user_id" VARCHAR(32) NOT NULL,
    "day" DATE NOT NULL,
    "search_count" INTEGER NOT NULL DEFAULT 0,
    "token_usage" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "search_usage_pkey" PRIMARY KEY ("tenant_id","user_id","day")
);

-- CreateIndex
CREATE INDEX "search_sessions_tenant_id_created_at_idx" ON "search_sessions"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "search_reports_session_id_idx" ON "search_reports"("session_id");

-- CreateIndex
CREATE INDEX "search_sources_report_id_idx" ON "search_sources"("report_id");

-- AddForeignKey
ALTER TABLE "search_reports" ADD CONSTRAINT "search_reports_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "search_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "search_sources" ADD CONSTRAINT "search_sources_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "search_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
