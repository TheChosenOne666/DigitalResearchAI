import { describe, it, expect } from 'vitest';
import { parseTimeseries, UPLOAD_EXTS } from '../src/modules/workspace/upload-parser';
import { BizException } from '../src/common/exceptions/biz.exception';

describe('parseTimeseries（上传补充解析）', () => {
  it('宽表 CSV 正常解析（首列实体名、表头年份、数值）', async () => {
    const csv = '地区,2020,2021,2022\n中国,5.2,8.1,3.0\n美国,-3.4,5.9,2.1';
    const res = await parseTimeseries('csv', Buffer.from(csv, 'utf8'));
    expect(res.years).toEqual(['2020', '2021', '2022']);
    expect(res.rows).toHaveLength(2);
    expect(res.rows[0]).toEqual({ name: '中国', values: { '2020': 5.2, '2021': 8.1, '2022': 3 } });
    expect(res.rows[1]).toEqual({ name: '美国', values: { '2020': -3.4, '2021': 5.9, '2022': 2.1 } });
  });

  it('缺失值（- / .. / 空）跳过、不生成年份键', async () => {
    const csv = '地区,2020,2021,2022\n中国,5.2,-,..\n美国,,9.8,1.2';
    const res = await parseTimeseries('csv', Buffer.from(csv, 'utf8'));
    expect(res.rows[0].values).toEqual({ '2020': 5.2 });
    expect(res.rows[1].values).toEqual({ '2021': 9.8, '2022': 1.2 });
  });

  it('CSV 剥离 UTF-8 BOM', async () => {
    const csv = '\ufeff地区,2020\n中国,5.2';
    const res = await parseTimeseries('csv', Buffer.from(csv, 'utf8'));
    expect(res.rows[0].name).toBe('中国');
    expect(res.rows[0].values).toEqual({ '2020': 5.2 });
  });

  it('表头含非年份 → 抛业务异常', async () => {
    const csv = '地区,指标值,2021\n中国,5.2,8.1';
    await expect(parseTimeseries('csv', Buffer.from(csv, 'utf8'))).rejects.toThrow(
      BizException,
    );
  });

  it('空内容 → 抛业务异常', async () => {
    await expect(parseTimeseries('csv', Buffer.from('', 'utf8'))).rejects.toThrow(BizException);
  });

  it('无有效数据行 → 抛业务异常', async () => {
    const csv = '地区,2020,2021\n,,';
    await expect(parseTimeseries('csv', Buffer.from(csv, 'utf8'))).rejects.toThrow(BizException);
  });

  it('Excel（xlsx）宽表往返解析', async () => {
    const XLSX = await import('xlsx');
    const ws = XLSX.utils.aoa_to_sheet([
      ['国家', 2020, 2021],
      ['中国', 5.2, 8.1],
      ['美国', -3.4, 5.9],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

    const res = await parseTimeseries('xlsx', buf);
    expect(res.years).toEqual(['2020', '2021']);
    expect(res.rows[0]).toEqual({ name: '中国', values: { '2020': 5.2, '2021': 8.1 } });
    expect(res.rows[1]).toEqual({ name: '美国', values: { '2020': -3.4, '2021': 5.9 } });
  });

  it('支持扩展名白名单含 .xlsx/.xls/.csv', () => {
    expect(UPLOAD_EXTS).toEqual(expect.arrayContaining(['.xlsx', '.xls', '.csv']));
  });
});
