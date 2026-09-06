import { computed, ref, type Ref } from 'vue';
import type { DatasetSeries } from '@/api/workspace';

/** 已上传并并入的本地文件（会话态，不落库） */
export interface UploadedFileData {
  filename: string;
  rows: Array<{ name: string; values: Record<string, number> }>;
  years: string[];
}

/**
 * 本地文件上传补充组合式函数（M4.2）：管理会话内已并入的上传文件，
 * 提供上传结果并入与「WDI 序列 + 上传行」的合并计算（同名实体合并填充、新实体追加）。
 *
 * @param selectedCountries 国家筛选选中项（上传引入的新实体自动追加选中）
 */
export function useLocalUpload(selectedCountries: Ref<string[]>) {
  const uploadedFiles = ref<UploadedFileData[]>([]);

  /** 上传引入的实体名（追加到国家筛选列表） */
  const uploadedEntities = computed(() => {
    const names: string[] = [];
    for (const uf of uploadedFiles.value) {
      for (const r of uf.rows) {
        if (!names.includes(r.name)) names.push(r.name);
      }
    }
    return names;
  });

  /** 并入一次上传解析结果：记录文件 + 新实体自动加入国家筛选 */
  function addUploaded(payload: UploadedFileData): void {
    uploadedFiles.value.push(payload);
    for (const r of payload.rows) {
      if (!selectedCountries.value.includes(r.name)) selectedCountries.value.push(r.name);
    }
  }

  /** 合并时序序列：WDI 序列 + 上传文件行（上传仅并入当前指标视图，切换指标后以 WDI 数据为准） */
  function mergeSeries(base: DatasetSeries[]): DatasetSeries[] {
    const merged = base.map((s) => ({ ...s }));
    for (const uf of uploadedFiles.value) {
      for (const row of uf.rows) {
        const hit = merged.find((s) => s.country === row.name);
        if (hit) {
          hit.values = { ...hit.values, ...row.values };
          hit.source = hit.source ?? `本地文件 · ${uf.filename}`;
        } else {
          merged.push({ country: row.name, iso3: '', values: { ...row.values }, source: `本地文件 · ${uf.filename}` });
        }
      }
    }
    return merged;
  }

  /** 合并年份 = WDI 年份 ∪ 上传年份（升序） */
  function mergeYears(base: string[]): string[] {
    const set = new Set<string>(base);
    for (const uf of uploadedFiles.value) {
      for (const y of uf.years) set.add(y);
    }
    return [...set].sort((a, b) => Number(a) - Number(b));
  }

  return { uploadedFiles, uploadedEntities, addUploaded, mergeSeries, mergeYears };
}
