-- CreateTable
CREATE TABLE "workspace_reports" (
    "id" VARCHAR(32) NOT NULL,
    "tenant_id" VARCHAR(32) NOT NULL,
    "user_id" VARCHAR(32) NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "content_md" TEXT NOT NULL,
    "params_snapshot" JSONB,
    "sources" JSONB,
    "token_usage" INTEGER NOT NULL DEFAULT 0,
    "status" VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workspace_reports_tenant_id_created_at_idx" ON "workspace_reports"("tenant_id", "created_at");
