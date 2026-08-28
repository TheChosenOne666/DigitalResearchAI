-- CreateTable
CREATE TABLE "workspace_datasets" (
    "id" VARCHAR(32) NOT NULL,
    "tenant_id" VARCHAR(32) NOT NULL,
    "user_id" VARCHAR(32) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "data" JSONB NOT NULL,
    "tags" JSONB,
    "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    "source_type" VARCHAR(16) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_datasets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workspace_datasets_tenant_id_created_at_idx" ON "workspace_datasets"("tenant_id", "created_at");
