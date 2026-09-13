-- AlterTable
ALTER TABLE "search_reports" ADD COLUMN     "segment_idx" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "status" VARCHAR(16) NOT NULL DEFAULT 'COMPLETE';

-- CreateTable
CREATE TABLE "search_report_segments" (
    "id" VARCHAR(32) NOT NULL,
    "report_id" VARCHAR(32) NOT NULL,
    "idx" INTEGER NOT NULL,
    "heading" VARCHAR(128) NOT NULL,
    "content_md" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "search_report_segments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "search_tasks" (
    "id" VARCHAR(32) NOT NULL,
    "tenant_id" VARCHAR(32) NOT NULL,
    "user_id" VARCHAR(32) NOT NULL,
    "session_id" VARCHAR(32) NOT NULL,
    "type" VARCHAR(16) NOT NULL,
    "status" VARCHAR(24) NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "error_msg" VARCHAR(512),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "search_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "search_report_segments_report_id_idx_key" ON "search_report_segments"("report_id", "idx");

-- CreateIndex
CREATE INDEX "search_tasks_tenant_id_user_id_created_at_idx" ON "search_tasks"("tenant_id", "user_id", "created_at");

-- CreateIndex
CREATE INDEX "search_tasks_user_id_status_idx" ON "search_tasks"("user_id", "status");

-- AddForeignKey
ALTER TABLE "search_report_segments" ADD CONSTRAINT "search_report_segments_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "search_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
