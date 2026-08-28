-- CreateEnum
CREATE TYPE "DictType" AS ENUM ('COUNTRY', 'ORG', 'INDUSTRY', 'UNIT', 'TIME');

-- CreateEnum
CREATE TYPE "DatasetSource" AS ENUM ('IMPORT', 'UPLOAD', 'COLLECT');

-- CreateEnum
CREATE TYPE "ImportTaskType" AS ENUM ('EXCEL', 'CSV', 'DATABASE', 'API');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "NoticeScope" AS ENUM ('ALL', 'ROLE', 'ORG');

-- CreateEnum
CREATE TYPE "NoticeStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "MessageType" AS ENUM ('IMPORT', 'KB', 'RENEWAL', 'SYSTEM');

-- CreateEnum
CREATE TYPE "SysTaskType" AS ENUM ('SEARCH', 'COLLECT', 'ANALYZE', 'REPORT', 'INDEX', 'BACKUP');

-- CreateEnum
CREATE TYPE "SysTaskStatus" AS ENUM ('WAITING', 'RUNNING', 'SUCCESS', 'FAILED', 'STOPPED');

-- CreateEnum
CREATE TYPE "BackupScope" AS ENUM ('FULL', 'DATA', 'CONFIG');

-- AlterEnum
ALTER TYPE "OrderStatus" ADD VALUE 'REFUNDED';

-- CreateTable
CREATE TABLE "sys_configs" (
    "key" VARCHAR(64) NOT NULL,
    "value" VARCHAR(512) NOT NULL,
    "label" VARCHAR(128) NOT NULL,
    "remark" VARCHAR(512),
    "updated_by" VARCHAR(32),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sys_configs_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "indicators" (
    "id" VARCHAR(32) NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "category" VARCHAR(64) NOT NULL,
    "unit" VARCHAR(32) NOT NULL,
    "definition" VARCHAR(512),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "indicators_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "indicator_mappings" (
    "id" VARCHAR(32) NOT NULL,
    "indicator_id" VARCHAR(32) NOT NULL,
    "source_name" VARCHAR(128) NOT NULL,
    "source_field" VARCHAR(128) NOT NULL,
    "transform" VARCHAR(128),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "indicator_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dict_items" (
    "id" VARCHAR(32) NOT NULL,
    "type" "DictType" NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "name_en" VARCHAR(128),
    "parent_code" VARCHAR(64),
    "remark" VARCHAR(255),
    "sort" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dict_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "datasets" (
    "id" VARCHAR(32) NOT NULL,
    "tenant_id" VARCHAR(32),
    "name" VARCHAR(255) NOT NULL,
    "source" "DatasetSource" NOT NULL,
    "category" VARCHAR(64),
    "field_count" INTEGER NOT NULL DEFAULT 0,
    "status" VARCHAR(16) NOT NULL DEFAULT 'ONLINE',
    "meta" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "datasets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_tasks" (
    "id" VARCHAR(32) NOT NULL,
    "tenant_id" VARCHAR(32) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "type" "ImportTaskType" NOT NULL,
    "size_bytes" INTEGER,
    "submitter_id" VARCHAR(32) NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'PENDING',
    "preview" JSONB,
    "reject_reason" VARCHAR(512),
    "reviewed_by" VARCHAR(32),
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notices" (
    "id" VARCHAR(32) NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "content" TEXT NOT NULL,
    "scope" "NoticeScope" NOT NULL DEFAULT 'ALL',
    "scope_value" VARCHAR(64),
    "status" "NoticeStatus" NOT NULL DEFAULT 'DRAFT',
    "published_at" TIMESTAMP(3),
    "created_by" VARCHAR(32),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" VARCHAR(32) NOT NULL,
    "user_id" VARCHAR(32) NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "content" TEXT NOT NULL,
    "type" "MessageType" NOT NULL,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "search_terms" (
    "id" VARCHAR(32) NOT NULL,
    "term" VARCHAR(255) NOT NULL,
    "total_count" INTEGER NOT NULL DEFAULT 0,
    "empty_count" INTEGER NOT NULL DEFAULT 0,
    "last_searched_at" TIMESTAMP(3),
    "is_quick" BOOLEAN NOT NULL DEFAULT false,
    "is_suggest" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "search_terms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sensitive_words" (
    "id" VARCHAR(32) NOT NULL,
    "word" VARCHAR(128) NOT NULL,
    "type" VARCHAR(32) NOT NULL,
    "hit_count" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sensitive_words_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sys_tasks" (
    "id" VARCHAR(32) NOT NULL,
    "task_no" VARCHAR(64) NOT NULL,
    "type" "SysTaskType" NOT NULL,
    "user_id" VARCHAR(32),
    "status" "SysTaskStatus" NOT NULL DEFAULT 'WAITING',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "stage" VARCHAR(64),
    "error_log" TEXT,
    "payload" JSONB,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sys_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_logs" (
    "id" VARCHAR(32) NOT NULL,
    "task_id" VARCHAR(32) NOT NULL,
    "level" VARCHAR(16) NOT NULL,
    "message" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backup_records" (
    "id" VARCHAR(32) NOT NULL,
    "scope" "BackupScope" NOT NULL DEFAULT 'FULL',
    "size_bytes" INTEGER,
    "status" VARCHAR(16) NOT NULL DEFAULT 'SUCCESS',
    "message" VARCHAR(512),
    "operator_id" VARCHAR(32),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "backup_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kb_categories" (
    "id" VARCHAR(32) NOT NULL,
    "parent_id" VARCHAR(32),
    "name" VARCHAR(128) NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "kb_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kb_tags" (
    "id" VARCHAR(32) NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "use_count" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kb_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pay_channel_configs" (
    "id" VARCHAR(32) NOT NULL,
    "channel" "PayChannel" NOT NULL,
    "merchant_id" VARCHAR(128),
    "notify_url" VARCHAR(255),
    "secret_enc" VARCHAR(1024),
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "key_updated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pay_channel_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "indicators_code_key" ON "indicators"("code");

-- CreateIndex
CREATE INDEX "indicator_mappings_indicator_id_idx" ON "indicator_mappings"("indicator_id");

-- CreateIndex
CREATE UNIQUE INDEX "dict_items_type_code_key" ON "dict_items"("type", "code");

-- CreateIndex
CREATE INDEX "datasets_status_created_at_idx" ON "datasets"("status", "created_at");

-- CreateIndex
CREATE INDEX "import_tasks_status_created_at_idx" ON "import_tasks"("status", "created_at");

-- CreateIndex
CREATE INDEX "notices_status_created_at_idx" ON "notices"("status", "created_at");

-- CreateIndex
CREATE INDEX "messages_user_id_created_at_idx" ON "messages"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "messages_type_user_id_idx" ON "messages"("type", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "search_terms_term_key" ON "search_terms"("term");

-- CreateIndex
CREATE INDEX "search_terms_total_count_idx" ON "search_terms"("total_count");

-- CreateIndex
CREATE INDEX "search_terms_empty_count_idx" ON "search_terms"("empty_count");

-- CreateIndex
CREATE UNIQUE INDEX "sensitive_words_word_key" ON "sensitive_words"("word");

-- CreateIndex
CREATE INDEX "sensitive_words_enabled_idx" ON "sensitive_words"("enabled");

-- CreateIndex
CREATE UNIQUE INDEX "sys_tasks_task_no_key" ON "sys_tasks"("task_no");

-- CreateIndex
CREATE INDEX "sys_tasks_type_status_created_at_idx" ON "sys_tasks"("type", "status", "created_at");

-- CreateIndex
CREATE INDEX "task_logs_task_id_created_at_idx" ON "task_logs"("task_id", "created_at");

-- CreateIndex
CREATE INDEX "backup_records_created_at_idx" ON "backup_records"("created_at");

-- CreateIndex
CREATE INDEX "kb_categories_parent_id_idx" ON "kb_categories"("parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "kb_tags_name_key" ON "kb_tags"("name");

-- CreateIndex
CREATE UNIQUE INDEX "pay_channel_configs_channel_key" ON "pay_channel_configs"("channel");

-- AddForeignKey
ALTER TABLE "indicator_mappings" ADD CONSTRAINT "indicator_mappings_indicator_id_fkey" FOREIGN KEY ("indicator_id") REFERENCES "indicators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_logs" ADD CONSTRAINT "task_logs_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "sys_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kb_categories" ADD CONSTRAINT "kb_categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "kb_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
