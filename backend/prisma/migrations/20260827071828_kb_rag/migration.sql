-- CreateEnum
CREATE TYPE "KbVisibility" AS ENUM ('PRIVATE', 'PUBLIC');

-- CreateEnum
CREATE TYPE "KbChunkMode" AS ENUM ('FIXED', 'SMART');

-- CreateEnum
CREATE TYPE "KbDocumentStatus" AS ENUM ('PENDING', 'LEARNING', 'READY', 'FAILED', 'INTERRUPTED');

-- CreateTable
CREATE TABLE "kb_libraries" (
    "id" VARCHAR(32) NOT NULL,
    "tenant_id" VARCHAR(32) NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "visibility" "KbVisibility" NOT NULL DEFAULT 'PRIVATE',
    "color" VARCHAR(16) NOT NULL DEFAULT '#16675f',
    "description" VARCHAR(512),
    "topK" INTEGER NOT NULL DEFAULT 10,
    "threshold" DOUBLE PRECISION NOT NULL DEFAULT 0.4,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1.2,
    "chunkMode" "KbChunkMode" NOT NULL DEFAULT 'FIXED',
    "chunkSize" INTEGER NOT NULL DEFAULT 800,
    "chunkOverlap" INTEGER NOT NULL DEFAULT 80,
    "embedModel" VARCHAR(128) NOT NULL DEFAULT 'doubao-embedding-large',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kb_libraries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kb_groups" (
    "id" VARCHAR(32) NOT NULL,
    "tenant_id" VARCHAR(32) NOT NULL,
    "library_id" VARCHAR(32) NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kb_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kb_documents" (
    "id" VARCHAR(32) NOT NULL,
    "tenant_id" VARCHAR(32) NOT NULL,
    "group_id" VARCHAR(32),
    "library_id" VARCHAR(32) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(32) NOT NULL,
    "size" INTEGER NOT NULL,
    "status" "KbDocumentStatus" NOT NULL DEFAULT 'PENDING',
    "fail_reason" VARCHAR(512),
    "chunk_count" INTEGER NOT NULL DEFAULT 0,
    "tags" JSONB,
    "source_session_id" VARCHAR(32),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kb_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kb_chunks" (
    "id" VARCHAR(32) NOT NULL,
    "tenant_id" VARCHAR(32) NOT NULL,
    "document_id" VARCHAR(32) NOT NULL,
    "group_id" VARCHAR(32),
    "library_id" VARCHAR(32) NOT NULL,
    "index" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "keywords" VARCHAR(512),
    "vector_id" VARCHAR(64),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kb_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "kb_libraries_tenant_id_idx" ON "kb_libraries"("tenant_id");

-- CreateIndex
CREATE INDEX "kb_groups_tenant_id_idx" ON "kb_groups"("tenant_id");

-- CreateIndex
CREATE INDEX "kb_groups_library_id_idx" ON "kb_groups"("library_id");

-- CreateIndex
CREATE INDEX "kb_documents_tenant_id_idx" ON "kb_documents"("tenant_id");

-- CreateIndex
CREATE INDEX "kb_documents_library_id_idx" ON "kb_documents"("library_id");

-- CreateIndex
CREATE INDEX "kb_documents_group_id_idx" ON "kb_documents"("group_id");

-- CreateIndex
CREATE INDEX "kb_chunks_tenant_id_idx" ON "kb_chunks"("tenant_id");

-- CreateIndex
CREATE INDEX "kb_chunks_library_id_idx" ON "kb_chunks"("library_id");

-- CreateIndex
CREATE INDEX "kb_chunks_document_id_idx" ON "kb_chunks"("document_id");

-- AddForeignKey
ALTER TABLE "kb_groups" ADD CONSTRAINT "kb_groups_library_id_fkey" FOREIGN KEY ("library_id") REFERENCES "kb_libraries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kb_documents" ADD CONSTRAINT "kb_documents_library_id_fkey" FOREIGN KEY ("library_id") REFERENCES "kb_libraries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kb_documents" ADD CONSTRAINT "kb_documents_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "kb_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kb_chunks" ADD CONSTRAINT "kb_chunks_library_id_fkey" FOREIGN KEY ("library_id") REFERENCES "kb_libraries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kb_chunks" ADD CONSTRAINT "kb_chunks_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "kb_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kb_chunks" ADD CONSTRAINT "kb_chunks_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "kb_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
