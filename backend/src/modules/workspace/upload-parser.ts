import { HttpStatus } from '@nestjs/common';
import { BizException } from '../../common/exceptions/biz.exception';
import { ErrorCode } from '@app/shared';

/** 上传文件解析出的单行时序（某实体在若干年份下的值） */
export interface UploadedRow {
  /** 实体名（国家/地区/城市/公司等，取自首列） */
  name: string;
  /** 年份 → 值（缺失年份无键） */
  values: Record<string, number>;
}

/** 上传文件解析结果 */
export interface UploadedDataset {
  /** 实体时序行（按文件顺序） */
  rows: UploadedRow[];
  /** 升序年份列表（表头年份并集） */
  years: string[];
}

/** 支持上传补充的文件扩展名（小写，含点） */
export const UPLOAD_EXTS = ['.xlsx', '.xls', '.csv'];

/** 视为缺失值的原始单元格内容（大小写/全半角空格归一化后比较） */
const MISSING_TOKENS = new Set(['', '-', '..', '—', '--', 'null', 'na', 'n/a', '无', '缺失']);

/** 归一化单元格文本：去首尾空白，全角空格转半角 */
function normToken(raw: unknown): string {
  return String(raw ?? '').trim().replace(/\u3000/g, ' ').toLowerCase();
}

/** 判断原始单元格是否为缺失值 */
function isMissing(raw: unknown): boolean {
  return MISSING_TOKENS.has(normToken(raw));
}

/** 判断年份表头是否合法（1900–2100 的整数，允许字符串数字） */
function isYearHead(raw: unknown): raw is string | number {
  if (raw == null) return false;
  if (typeof raw === 'number') return Number.isInteger(raw) && raw >= 1900 && raw <= 2100;
  const s = String(raw).trim();
  if (!/^\d{4}$/.test(s)) return false;
  const n = Number(s);
  return Number.isInteger(n) && n >= 1900 && n <= 2100;
}

/** 解析单元格数值：非法/缺失返回 null，否则返回有限数字 */
function toValue(raw: unknown): number | null {
  if (isMissing(raw)) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const s = String(raw).trim().replace(/,/g, '');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * 按「宽表」约定把表头行 + 数据行组装为时序行。
 * 表头首个单元格为实体列标题（忽略），其余为年份；首列为实体名，其余为逐年数值。
 * @param header 表头行（首元素为实体列标签）
 * @param dataRows 数据行（首元素为实体名）
 */
function assemble(
  header: unknown[],
  dataRows: unknown[][],
): UploadedDataset {
  // 年份表头 = 表头第 2 列起；首个单元格是「实体列」标题，不计入年份
  const yearHeads = header.slice(1);
  const yearsRaw: (string | number)[] = [];
  for (const h of yearHeads) {
    if (!isYearHead(h)) {
      throw new BizException(
        ErrorCode.VALIDATION_FAILED,
        `表头非年份格式（应为 1900–2100 的年份，如 2020）：${String(h ?? '空')}`,
        HttpStatus.BAD_REQUEST,
      );
    }
    yearsRaw.push(typeof h === 'number' ? h : Number(String(h).trim()));
  }

  const rows: UploadedRow[] = [];
  for (const r of dataRows) {
    const name = String(r[0] ?? '').trim();
    if (!name) continue;
    const values: Record<string, number> = {};
    yearsRaw.forEach((y, i) => {
      const v = toValue(r[i + 1]);
      if (v != null) values[String(y)] = v;
    });
    rows.push({ name, values });
  }

  if (!rows.length) {
    throw new BizException(
      ErrorCode.VALIDATION_FAILED,
      '文件未解析出有效数据行（首列为实体名、表头为年份）',
      HttpStatus.BAD_REQUEST,
    );
  }

  return { rows, years: [...new Set(yearsRaw.map(String))].sort() };
}

/**
 * 解析上传的 Excel/CSV 字节为时序数据集（M4.2 上传补充）。
 * 约定宽表：首列=实体名、表头=年份、单元格=数值；空值/-/.. 记缺失（不生成年份键）。
 * @param mimeType 文件 mime 类型（xlsx / csv）
 * @param buffer 文件原始字节
 * @returns 实体时序行 + 年份列表
 * @throws BizException mime 不支持 / 表头非年份 / 无有效数据
 */
export async function parseTimeseries(
  mimeType: 'xlsx' | 'csv',
  buffer: Buffer,
): Promise<UploadedDataset> {
  if (mimeType === 'csv') {
    return assemble(...parseCsv(buffer));
  }
  if (mimeType === 'xlsx') {
    return assemble(...(await parseXlsx(buffer)));
  }
  throw new BizException(
    ErrorCode.VALIDATION_FAILED,
    `不支持的文件类型: ${mimeType}`,
    HttpStatus.BAD_REQUEST,
  );
}

/** 解析 CSV 为 [表头行, 数据行[]]（utf8 + BOM 剥离） */
function parseCsv(buffer: Buffer): [unknown[], unknown[][]] {
  let text = buffer.toString('utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (!lines.length) {
    throw new BizException(ErrorCode.VALIDATION_FAILED, 'CSV 内容为空', HttpStatus.BAD_REQUEST);
  }
  const split = (line: string): unknown[] =>
    line
      .split(',')
      .map((c) => c.trim())
      .map((c) => (c.startsWith('"') && c.endsWith('"') ? c.slice(1, -1) : c));
  const header = split(lines[0]);
  const rows = lines.slice(1).map(split);
  return [header, rows];
}

/** 解析 Excel 首个 sheet 为 [表头行, 数据行[]] */
async function parseXlsx(buffer: Buffer): Promise<[unknown[], unknown[][]]> {
  let XLSX: typeof import('xlsx');
  try {
    XLSX = await import('xlsx');
  } catch (e) {
    throw new BizException(
      ErrorCode.VALIDATION_FAILED,
      `Excel 解析组件不可用：${e instanceof Error ? e.message : e}`,
      HttpStatus.BAD_REQUEST,
    );
  }
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) {
    throw new BizException(ErrorCode.VALIDATION_FAILED, 'Excel 无有效工作表', HttpStatus.BAD_REQUEST);
  }
  // raw:false → 单元格按格式化文本读出（年份列可能为数字，需能识别 4 位年份）
  const grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' }) as unknown[][];
  const clean = grid.filter((r) => Array.isArray(r) && r.some((c) => String(c ?? '').trim() !== ''));
  if (!clean.length) {
    throw new BizException(ErrorCode.VALIDATION_FAILED, 'Excel 内容为空', HttpStatus.BAD_REQUEST);
  }
  return [clean[0], clean.slice(1)];
}
