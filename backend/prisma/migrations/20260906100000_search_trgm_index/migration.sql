-- 检索优化（优化 A）：pg_trgm 扩展 + GIN trigram 索引
-- 目的：kb_chunks 全文路 ILIKE '%词%' 前缀通配无法走 B-tree，改为 trigram GIN 索引覆盖，消除全表扫描
-- 说明：Prisma 迁移在 PG 上以事务执行，CONCURRENTLY 不可用；当前表规模小，普通建索引瞬时完成
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_kb_chunks_content_trgm ON kb_chunks USING gin (content gin_trgm_ops);
