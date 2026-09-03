-- M7.4 备份真实执行：备份记录补充「类型」与「文件路径」字段
-- type: BACKUP=备份 / DRILL=恢复演练；file_path: 备份文件落盘路径（真实执行后写入）
ALTER TABLE "backup_records"
  ADD COLUMN "type" VARCHAR(16) NOT NULL DEFAULT 'BACKUP',
  ADD COLUMN "file_path" VARCHAR(512);
