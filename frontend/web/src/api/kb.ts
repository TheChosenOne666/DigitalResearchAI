import { request } from '@/api/http';

const BASE = '/api/v1/kb';

// ===== 类型定义（与后端 kb 模块响应对齐）=====

/** 知识库（含检索/向量化配置与统计） */
export interface KbLibrary {
  id: string;
  name: string;
  visibility: 'PRIVATE' | 'PUBLIC';
  color: string;
  description: string | null;
  topK: number;
  threshold: number;
  weight: number;
  chunkMode: 'FIXED' | 'SMART';
  chunkSize: number;
  chunkOverlap: number;
  embedModel: string;
  createdAt: string;
  docCount: number;
  readyCount: number;
}

/** 知识库分组 */
export interface KbGroup {
  id: string;
  name: string;
  createdAt: string;
  docCount: number;
}

/** 文档学习状态 */
export type KbDocStatus = 'PENDING' | 'LEARNING' | 'READY' | 'FAILED' | 'INTERRUPTED';

/** 文档列表项 */
export interface KbDocumentItem {
  id: string;
  groupId: string | null;
  libraryId: string;
  name: string;
  mimeType: string;
  size: number;
  status: KbDocStatus;
  visibility: string;
  tags: string[] | null;
  failReason: string | null;
  chunkCount: number;
  createdAt: string;
}

/** 文档切片 */
export interface KbChunk {
  id: string;
  index: number;
  content: string;
  vectorId: string | null;
}

/** 文档详情（含切片） */
export interface KbDocumentDetail extends KbDocumentItem {
  chunks: KbChunk[];
}

/** 待审核文档（审核队列项） */
export interface KbPendingReview {
  id: string;
  libraryId: string;
  groupId: string | null;
  libraryName: string;
  groupName: string | null;
  name: string;
  mimeType: string;
  size: number;
  visibility: string;
  tags: string[] | null;
  sourceSessionId: string | null;
  createdAt: string;
}

/** 相似度分级 */
export type RecallGrade = 'HIGH' | 'MID' | 'LOW';

/** 召回测试命中片段 */
export interface RecallHit {
  order: number;
  title: string;
  snippet: string;
  contentMd: string;
  similarity: number;
  grade: RecallGrade;
  libraryId: string | null;
  groupId: string | null;
  documentId: string | null;
  chunkIndex: number | null;
}

/** 召回测试结果 */
export interface RecallTestResult {
  question: string;
  tookMs: number;
  total: number;
  hits: RecallHit[];
}

// ===== 库 =====

/** 库列表（含统计） */
export function listLibraries(): Promise<KbLibrary[]> {
  return request(`${BASE}/libraries`);
}

/** 创建库 */
export function createLibrary(input: {
  name: string;
  visibility?: string;
  color?: string;
  description?: string | null;
}): Promise<{ id: string }> {
  return request(`${BASE}/libraries`, { method: 'POST', body: JSON.stringify(input) });
}

/** 更新库（含检索/向量化配置） */
export function updateLibrary(
  id: string,
  input: Partial<{
    name: string;
    visibility: string;
    color: string;
    description: string | null;
    topK: number;
    threshold: number;
    weight: number;
    chunkMode: string;
    chunkSize: number;
    chunkOverlap: number;
    embedModel: string;
  }>,
): Promise<{ id: string }> {
  return request(`${BASE}/libraries/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

/** 删除库（级联文档/切片/向量清理） */
export function deleteLibrary(id: string): Promise<void> {
  return request(`${BASE}/libraries/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// ===== 分组 =====

/** 分组列表（含文档数） */
export function listGroups(libraryId: string): Promise<KbGroup[]> {
  return request(`${BASE}/libraries/${encodeURIComponent(libraryId)}/groups`);
}

/** 创建分组 */
export function createGroup(libraryId: string, name: string): Promise<{ id: string }> {
  return request(`${BASE}/libraries/${encodeURIComponent(libraryId)}/groups`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

/** 更新分组名 */
export function updateGroup(libraryId: string, groupId: string, name: string): Promise<{ id: string }> {
  return request(
    `${BASE}/libraries/${encodeURIComponent(libraryId)}/groups/${encodeURIComponent(groupId)}`,
    { method: 'PUT', body: JSON.stringify({ name }) },
  );
}

/** 删除分组 */
export function deleteGroup(libraryId: string, groupId: string): Promise<void> {
  return request(
    `${BASE}/libraries/${encodeURIComponent(libraryId)}/groups/${encodeURIComponent(groupId)}`,
    { method: 'DELETE' },
  );
}

// ===== 文档 =====

/** 文档列表（分组/状态筛选 + 分页） */
export function listDocuments(
  libraryId: string,
  filter?: { groupId?: string; status?: string },
  page = 1,
  pageSize = 20,
): Promise<{ items: KbDocumentItem[]; total: number }> {
  const q = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (filter?.groupId) q.set('groupId', filter.groupId);
  if (filter?.status) q.set('status', filter.status);
  return request(`${BASE}/libraries/${encodeURIComponent(libraryId)}/documents?${q.toString()}`);
}

/** 文档详情（含切片） */
export function getDocument(id: string): Promise<KbDocumentDetail> {
  return request(`${BASE}/documents/${encodeURIComponent(id)}`);
}

/** 上传文档触发学习（multipart；groupId 可空） */
export function uploadDocument(libraryId: string, file: File, groupId?: string): Promise<{ id: string; status: string }> {
  const fd = new FormData();
  fd.append('file', file);
  const q = groupId ? `?groupId=${encodeURIComponent(groupId)}` : '';
  return request(`${BASE}/libraries/${encodeURIComponent(libraryId)}/documents${q}`, {
    method: 'POST',
    body: fd,
  });
}

/** 重新/继续学习 */
export function relearnDocument(libraryId: string, documentId: string): Promise<{ id: string; status: string }> {
  return request(
    `${BASE}/libraries/${encodeURIComponent(libraryId)}/documents/${encodeURIComponent(documentId)}/relearn`,
    { method: 'POST' },
  );
}

/** 删除文档 */
export function deleteDocument(id: string): Promise<void> {
  return request(`${BASE}/documents/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// ===== 召回测试 / 审核 / 入库（M3.4）=====

/** 召回测试：单库混合检索，返回命中片段与相似度分级 */
export function recallTest(
  libraryId: string,
  question: string,
  topN = 8,
): Promise<RecallTestResult> {
  return request(`${BASE}/libraries/${encodeURIComponent(libraryId)}/recall-test`, {
    method: 'POST',
    body: JSON.stringify({ question, topN }),
  });
}

/** 待审核文档列表（管理端雏形接口） */
export function listReviews(page = 1, pageSize = 20): Promise<{ items: KbPendingReview[]; total: number }> {
  return request(`${BASE}/reviews?page=${page}&pageSize=${pageSize}`);
}

/** 审核通过：触发自动学习 */
export function approveReview(documentId: string): Promise<{ id: string; status: string }> {
  return request(`${BASE}/documents/${encodeURIComponent(documentId)}/approve`, { method: 'POST' });
}

/** 审核拒绝：移除待审核文档 */
export function rejectReview(documentId: string): Promise<{ id: string; rejected: boolean }> {
  return request(`${BASE}/documents/${encodeURIComponent(documentId)}/reject`, { method: 'POST' });
}

/** 智搜勾选来源存入知识库（每条来源独立成档，待审核） */
export function saveSourcesToKb(
  sessionId: string,
  input: {
    idxs: number[];
    libraryId: string;
    groupId?: string | null;
    visibility?: string;
    tags?: string[];
  },
): Promise<{ created: number; documents: Array<{ id: string; name: string }> }> {
  return request(`/api/v1/search/reports/${encodeURIComponent(sessionId)}/save-kb`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
