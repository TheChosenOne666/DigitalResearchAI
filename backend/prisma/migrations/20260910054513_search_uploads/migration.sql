-- CreateTable
CREATE TABLE "search_uploads" (
    "id" VARCHAR(32) NOT NULL,
    "tenant_id" VARCHAR(32) NOT NULL,
    "user_id" VARCHAR(32) NOT NULL,
    "name" VARCHAR(512) NOT NULL,
    "mime_type" VARCHAR(16) NOT NULL,
    "size" INTEGER NOT NULL,
    "content_md" TEXT NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "search_uploads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "search_uploads_tenant_id_user_id_idx" ON "search_uploads"("tenant_id", "user_id");

-- CreateIndex
CREATE INDEX "search_uploads_expires_at_idx" ON "search_uploads"("expires_at");
