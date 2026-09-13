/*
  给智搜从表补 tenant_id 并完成行级隔离（修复跨租户读取检索快照）。

  背景：search_retrievals / search_reports / search_sources / search_report_segments
  此前无 tenant_id 列，隔离仅靠「会话链 + sessionId 不可枚举」兜底，
  且 search_reports / search_sources 虽登记在 TENANT_MODELS 却无该列（注入即报错）。
  其中 GET /search/retrievals/:sessionId 未带租户过滤，可跨租户读到他人问题与来源正文。

  历史数据非空，故分三步：先加可空列 → 从会话链回填 → 收紧为 NOT NULL。
  外键约束保证不存在孤儿行；若回填后仍有 NULL，下面的 SET NOT NULL 会直接失败（不静默丢数据）。
*/

-- 1) 加列（先可空）
ALTER TABLE "search_retrievals" ADD COLUMN "tenant_id" VARCHAR(32);
ALTER TABLE "search_reports" ADD COLUMN "tenant_id" VARCHAR(32);
ALTER TABLE "search_report_segments" ADD COLUMN "tenant_id" VARCHAR(32);
ALTER TABLE "search_sources" ADD COLUMN "tenant_id" VARCHAR(32);

-- 2) 从会话链回填：检索快照/报告直接取所属会话的租户；章节/来源取所属报告的租户
UPDATE "search_retrievals" c
   SET "tenant_id" = s."tenant_id"
  FROM "search_sessions" s
 WHERE c."session_id" = s."id";

UPDATE "search_reports" c
   SET "tenant_id" = s."tenant_id"
  FROM "search_sessions" s
 WHERE c."session_id" = s."id";

UPDATE "search_report_segments" c
   SET "tenant_id" = r."tenant_id"
  FROM "search_reports" r
 WHERE c."report_id" = r."id";

UPDATE "search_sources" c
   SET "tenant_id" = r."tenant_id"
  FROM "search_reports" r
 WHERE c."report_id" = r."id";

-- 3) 收紧为非空
ALTER TABLE "search_retrievals" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "search_reports" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "search_report_segments" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "search_sources" ALTER COLUMN "tenant_id" SET NOT NULL;

-- 4) 索引（租户维度过滤/清理用）
CREATE INDEX "search_retrievals_tenant_id_idx" ON "search_retrievals"("tenant_id");
CREATE INDEX "search_reports_tenant_id_idx" ON "search_reports"("tenant_id");
CREATE INDEX "search_report_segments_tenant_id_idx" ON "search_report_segments"("tenant_id");
CREATE INDEX "search_sources_tenant_id_idx" ON "search_sources"("tenant_id");
