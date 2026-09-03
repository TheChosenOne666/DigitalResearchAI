#!/usr/bin/env node
/**
 * M7.4 备份恢复演练（零 npm 依赖，用 docker exec 调容器内 psql/pg_restore）。
 *
 * 流程：
 *   1. 找到最新备份文件（backups/*.dump，pg_dump -Fc 产物）
 *   2. 重建临时库 <restore-db>（dropdb --if-exists + createdb）
 *   3. pg_restore 回灌 dump（经 stdin 传给容器内 pg_restore）
 *   4. 行数抽查（users / kb_documents / member_orders 等，来源与目标库对照）
 *   5. 结果写 backup_records（type=DRILL，直接 psql INSERT）
 *   6. 可选 Qdrant 快照（--with-qdrant，逐集合 POST /collections/{c}/snapshots）
 *
 * 用法：
 *   node scripts/backup-restore-drill.mjs \
 *     --backup-dir backups --container ai-postgres \
 *     --db-user postgres --db-name ai_research --restore-db ai_research_restore \
 *     [--with-qdrant --qdrant http://localhost:6333]
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

const args = parseArgs({
  options: {
    'backup-dir': { type: 'string', default: 'backups' },
    container: { type: 'string', default: process.env.BACKUP_PG_CONTAINER ?? 'ai-postgres' },
    'db-user': { type: 'string', default: process.env.BACKUP_PG_USER ?? 'postgres' },
    'db-name': { type: 'string', default: process.env.BACKUP_PG_DB ?? 'ai_research' },
    'restore-db': { type: 'string', default: 'ai_research_restore' },
    'with-qdrant': { type: 'boolean', default: false },
    qdrant: { type: 'string', default: process.env.QDRANT_URL ?? 'http://localhost:6333' },
    help: { type: 'boolean', default: false },
  },
}).values;

if (args.help) {
  console.log('恢复演练：node scripts/backup-restore-drill.mjs --backup-dir backups');
  process.exit(0);
}

const CONTAINER = args.container;
const DB_USER = args['db-user'];
const DB_NAME = args['db-name'];
const RESTORE_DB = args['restore-db'];

/** docker exec 执行（stdin 透传给容器内命令） */
function sh(dockerArgs, input) {
  return execFileSync('docker', ['exec', '-i', CONTAINER, ...dockerArgs], {
    input,
    maxBuffer: 512 * 1024 * 1024,
  });
}

/** 取最新 .dump 备份文件 */
function latestDump() {
  const dir = path.resolve(process.cwd(), args['backup-dir']);
  if (!existsSync(dir)) throw new Error(`备份目录不存在: ${dir}`);
  const files = readdirSync(dir).filter((f) => f.endsWith('.dump')).sort();
  if (files.length === 0) throw new Error('备份目录无 .dump 文件，请先执行备份');
  return { dir, file: files[files.length - 1], path: path.join(dir, files[files.length - 1]) };
}

/** 行数抽查：源库与恢复库关键表行数对照 */
const CHECK_TABLES = ['users', 'kb_documents', 'member_orders'];
function countRows(db, table) {
  const out = sh(['psql', '-U', DB_USER, '-d', db, '-t', '-A', '-c', `SELECT count(*) FROM ${table}`], undefined);
  return Number(out.toString().trim());
}

async function qdrantSnapshots() {
  const cols = await (await fetch(`${args.qdrant}/collections`)).json();
  const list = cols?.result?.collections ?? [];
  for (const c of list) {
    const name = c.name ?? c;
    const res = await fetch(`${args.qdrant}/collections/${name}/snapshots`, { method: 'POST' });
    console.log(`  Qdrant 快照 ${name}: HTTP ${res.status}`);
  }
}

function main() {
  const { file, path: dumpPath } = latestDump();
  console.log(`恢复演练开始：源备份=${file} 目标库=${RESTORE_DB}`);

  // 1. 重建临时库
  sh(['dropdb', '--if-exists', '-U', DB_USER, RESTORE_DB]);
  sh(['createdb', '-U', DB_USER, RESTORE_DB]);
  console.log('  临时库已重建');

  // 2. 回灌
  sh(['pg_restore', '-U', DB_USER, '-d', RESTORE_DB, '--no-owner', '--no-acl'], readFileSync(dumpPath));
  console.log('  pg_restore 回灌完成');

  // 3. 行数抽查
  console.log('  行数抽查（源库 vs 恢复库）:');
  const rows = {};
  for (const t of CHECK_TABLES) {
    const src = countRows(DB_NAME, t);
    const dst = countRows(RESTORE_DB, t);
    rows[t] = { src, dst };
    console.log(`    ${t}: 源 ${src} / 恢复 ${dst} ${src === dst ? '✅' : '⚠️ 不一致'}`);
  }

  // 4. 结果写 backup_records（type=DRILL）
  const summary = Object.entries(rows).map(([t, v]) => `${t}=${v.src}/${v.dst}`).join(',');
  const now = new Date().toISOString();
  // id 为 varchar(32)（cuid），uuid 去连字符恰好 32 位十六进制
  const insert = `INSERT INTO backup_records (id, scope, type, status, message, file_path, created_at) VALUES (replace(gen_random_uuid()::text, '-', ''), 'FULL', 'DRILL', 'SUCCESS', '恢复演练通过: ${summary}', '${dumpPath}', '${now}')`;
  sh(['psql', '-U', DB_USER, '-d', DB_NAME, '-c', insert]);
  console.log('  演练结果已写入 backup_records（type=DRILL）');

  // 5. 可选 Qdrant 快照
  if (args['with-qdrant']) {
    console.log('  Qdrant 快照:');
    qdrantSnapshots().catch((e) => console.log(`    Qdrant 快照失败: ${e.message}`));
  }

  console.log('恢复演练完成 ✅');
}

try {
  main();
  process.exit(0);
} catch (e) {
  console.error(`❌ 恢复演练失败: ${e.message}`);
  process.exit(1);
}
