import { describe, it, expect, vi } from 'vitest';
import { tenantAls } from '../src/common/auth/tenant-context';
import {
  SearchUploadService,
  MAX_UPLOAD_FILES,
  MAX_CONTENT_CHARS,
  MAX_UPLOAD_BYTES,
} from '../src/modules/search/upload/search-upload.service';

/** 在租户上下文内执行（模拟受保护路由的拦截器注入） */
function withTenant<T>(fn: () => T | Promise<T>): Promise<T> {
  return tenantAls.run({ tenantId: 't1', userId: 'u1', roles: ['USER'] }, fn);
}

function mockDeps() {
  const upload = { create: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn().mockResolvedValue({ count: 0 }) };
  const prisma = { forTenant: { searchUpload: upload } };
  const parser = { parse: vi.fn() };
  return { prisma, parser, upload, svc: new SearchUploadService(prisma as any, parser as any) };
}

/** 构造 multer 形态的上传文件（可指定实际字节数以验证大小上限） */
function file(name: string, content = '文件内容', bytes?: number) {
  return {
    originalname: name,
    buffer: bytes ? Buffer.alloc(bytes, 0x61) : Buffer.from(content, 'utf8'),
  };
}

describe('SearchUploadService.save（上传解析与落库）', () => {
  it('正常解析并落库：返回 parsed + id，正文写入 contentMd', async () => {
    const d = mockDeps();
    d.parser.parse.mockResolvedValue('解析出的正文');
    d.upload.create.mockResolvedValue({ id: 'up1' });

    const res = await withTenant(() => d.svc.save([file('行业研报.pdf')]));

    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({ name: '行业研报.pdf', status: 'parsed', id: 'up1' });
    expect(d.upload.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: '行业研报.pdf',
        mimeType: 'pdf',
        contentMd: '解析出的正文',
      }),
    });
  });

  it('不支持的扩展名 → failed 且不解析、不落库', async () => {
    const d = mockDeps();
    const res = await withTenant(() => d.svc.save([file('archive.zip')]));

    expect(res[0].status).toBe('failed');
    expect(res[0].error).toContain('不支持的格式');
    expect(d.parser.parse).not.toHaveBeenCalled();
    expect(d.upload.create).not.toHaveBeenCalled();
  });

  it('空文件 → failed', async () => {
    const d = mockDeps();
    const res = await withTenant(() => d.svc.save([file('empty.txt', '', 0)]));

    expect(res[0].status).toBe('failed');
    expect(res[0].error).toContain('为空');
  });

  it(`超过 ${MAX_UPLOAD_BYTES / 1024 / 1024}MB → failed 且不解析`, async () => {
    const d = mockDeps();
    const res = await withTenant(() => d.svc.save([file('huge.xlsx', '', MAX_UPLOAD_BYTES + 1)]));

    expect(res[0].status).toBe('failed');
    expect(res[0].error).toContain('20MB');
    expect(d.parser.parse).not.toHaveBeenCalled();
  });

  it('单文件解析失败不阻断其它文件（逐条返回结果）', async () => {
    const d = mockDeps();
    d.parser.parse
      .mockResolvedValueOnce('成功正文')
      .mockRejectedValueOnce(new Error('PDF 文件已损坏'));
    d.upload.create.mockResolvedValue({ id: 'up1' });

    const res = await withTenant(() => d.svc.save([file('ok.txt'), file('bad.pdf')]));

    expect(res).toHaveLength(2);
    expect(res[0].status).toBe('parsed');
    expect(res[1].status).toBe('failed');
    expect(res[1].error).toContain('PDF 文件已损坏');
  });

  it('解析结果为空 → failed（不作为空来源污染报告）', async () => {
    const d = mockDeps();
    d.parser.parse.mockResolvedValue('   \n  ');

    const res = await withTenant(() => d.svc.save([file('blank.txt')]));

    expect(res[0].status).toBe('failed');
    expect(res[0].error).toContain('为空');
  });

  it('解析文本超长 → 截断并标注（防撑爆生成上下文）', async () => {
    const d = mockDeps();
    d.parser.parse.mockResolvedValue('a'.repeat(MAX_CONTENT_CHARS + 5000));
    d.upload.create.mockResolvedValue({ id: 'up1' });

    await withTenant(() => d.svc.save([file('long.txt')]));

    const data = d.upload.create.mock.calls[0][0].data;
    expect(data.contentMd.length).toBeLessThan(MAX_CONTENT_CHARS + 100);
    expect(data.contentMd).toContain('已截断');
  });

  it(`单次文件数超过 ${MAX_UPLOAD_FILES} → 抛 400 业务异常`, async () => {
    const d = mockDeps();
    const files = Array.from({ length: MAX_UPLOAD_FILES + 1 }, (_, i) => file(`f${i}.txt`));

    await expect(withTenant(() => d.svc.save(files))).rejects.toThrow(
      new RegExp(`最多上传 ${MAX_UPLOAD_FILES}`),
    );
    expect(d.upload.create).not.toHaveBeenCalled();
  });

  it('空文件数组 → 抛缺少参数', async () => {
    const d = mockDeps();
    await expect(withTenant(() => d.svc.save([]))).rejects.toThrow(/缺少上传文件/);
  });

  it('上传时顺手清理该用户已过期资料（懒删除）', async () => {
    const d = mockDeps();
    d.parser.parse.mockResolvedValue('正文');
    d.upload.create.mockResolvedValue({ id: 'up1' });

    await withTenant(() => d.svc.save([file('a.txt')]));

    expect(d.upload.deleteMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ userId: 'u1' }),
    });
  });

  it('无租户上下文 → 抛未授权（受保护路由语义）', async () => {
    const d = mockDeps();
    await expect(d.svc.save([file('a.txt')])).rejects.toThrow(/租户上下文/);
  });
});

describe('SearchUploadService.loadHits（加载为来源）', () => {
  it('按传入顺序返回命中，sourceType=upload', async () => {
    const d = mockDeps();
    d.upload.findMany.mockResolvedValue([
      { id: 'b', name: 'B 表.xlsx', contentMd: 'bbb', size: 10, mimeType: 'xlsx' },
      { id: 'a', name: 'A 报告.pdf', contentMd: 'aaa', size: 20, mimeType: 'pdf' },
    ]);

    const hits = await withTenant(() => d.svc.loadHits(['a', 'b']));

    expect(hits.map((h) => h.title)).toEqual(['A 报告.pdf', 'B 表.xlsx']);
    expect(hits[0].sourceType).toBe('upload');
    expect(hits[0].contentMd).toBe('aaa');
    expect(hits[0].meta).toMatchObject({ uploadId: 'a', mimeType: 'pdf' });
  });

  it('越权/已过期的 id 静默忽略（不暴露存在性）', async () => {
    const d = mockDeps();
    d.upload.findMany.mockResolvedValue([
      { id: 'a', name: 'A.txt', contentMd: 'x', size: 1, mimeType: 'txt' },
    ]);

    const hits = await withTenant(() => d.svc.loadHits(['a', 'someone-else-id']));

    expect(hits).toHaveLength(1);
    expect(hits[0].title).toBe('A.txt');
  });

  it('重复 id 去重，空入参不查库', async () => {
    const d = mockDeps();
    const empty = await withTenant(() => d.svc.loadHits([]));
    expect(empty).toEqual([]);
    expect(d.upload.findMany).not.toHaveBeenCalled();

    d.upload.findMany.mockResolvedValue([
      { id: 'a', name: 'A.txt', contentMd: 'x', size: 1, mimeType: 'txt' },
    ]);
    const hits = await withTenant(() => d.svc.loadHits(['a', 'a']));
    expect(hits).toHaveLength(1);
    expect(d.upload.findMany.mock.calls[0][0].where.id.in).toEqual(['a']);
  });

  it('查询条件包含未过期过滤（expiresAt > now）', async () => {
    const d = mockDeps();
    d.upload.findMany.mockResolvedValue([]);

    await withTenant(() => d.svc.loadHits(['a']));

    const where = d.upload.findMany.mock.calls[0][0].where;
    expect(where.userId).toBe('u1');
    expect(where.expiresAt.gt).toBeInstanceOf(Date);
  });
});
