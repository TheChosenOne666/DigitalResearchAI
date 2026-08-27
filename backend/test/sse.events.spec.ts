import { describe, it, expect } from 'vitest';
import { serializeSse } from '../src/modules/search/sse/sse.events';

describe('serializeSse', () => {
  it('输出标准 SSE 帧：event:/data: JSON + 双换行', () => {
    expect(serializeSse('stage', { stage: 'done' })).toBe('event: stage\ndata: {"stage":"done"}\n\n');
  });

  it('data 为合法 JSON 且包含原始字段', () => {
    const frame = serializeSse('source', {
      idx: 0,
      title: 't',
      url: 'https://x',
      snippet: 's',
      sourceType: 'web',
      isCited: true,
    });
    expect(frame.startsWith('event: source\ndata: ')).toBe(true);
    expect(frame.endsWith('\n\n')).toBe(true);
    const json = frame.slice(frame.indexOf('data: ') + 6, frame.lastIndexOf('\n\n'));
    const data = JSON.parse(json);
    expect(data.idx).toBe(0);
    expect(data.isCited).toBe(true);
  });
});
