/**
 * 报告导出 · PDF 中文字体定位。
 *
 * PDF 标准字体（Helvetica 等）不含中文字形，直接输出中文会变方框/乱码，
 * 因此必须嵌入一个中文字体。本模块只负责**解析出可用字体文件路径**，
 * 不引入仓库内字体资源文件：
 *
 * 1. 配置优先：`PDF_FONT_PATH` 指定字体文件（生产建议显式配置）；
 * 2. 平台兜底：按当前操作系统查找常见中文字体（Windows 微软雅黑/黑体、
 *    Linux 思源黑体/文泉驿、macOS 苹方）；
 * 3. 全部缺失：返回空列表，由调用方抛出明确业务异常（不静默输出乱码）。
 *
 * 注意：pdfkit 的 `registerFont(name, src, family)` 第三参数实际透传给 fontkit，
 * 对 TTC 字体集合需要的是 **PostScript 名**（如 `MicrosoftYaHei`），
 * 而非字体的 family 展示名（`Microsoft YaHei`）——传错会报
 * "Not a supported font format or standard PDF font"。
 */

import { existsSync } from 'node:fs';

/** 一个候选字体（TTC 字体集合需附带 PostScript 名以选中具体字重） */
export interface PdfFontCandidate {
  /** 字体文件绝对路径 */
  path: string;
  /** TTC 字体集合内的 PostScript 名（TTF/OTF 单字体文件无需指定） */
  postscriptName?: string;
}

/**
 * 平台中文字体候选（按优先级）。
 * Windows 首选微软雅黑（正文观感好），失败自动降级到黑体（单一 TTF，无集合选择问题）。
 */
function platformCandidates(): PdfFontCandidate[] {
  switch (process.platform) {
    case 'win32':
      return [
        { path: 'C:/Windows/Fonts/msyh.ttc', postscriptName: 'MicrosoftYaHei' },
        { path: 'C:/Windows/Fonts/simhei.ttf' },
        { path: 'C:/Windows/Fonts/simsun.ttc', postscriptName: 'SimSun' },
      ];
    case 'darwin':
      return [
        { path: '/System/Library/Fonts/PingFang.ttc', postscriptName: 'PingFangSC-Regular' },
        { path: '/Library/Fonts/Arial Unicode.ttf' },
      ];
    default:
      return [
        {
          path: '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
          postscriptName: 'NotoSansCJKsc-Regular',
        },
        {
          path: '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
          postscriptName: 'NotoSansCJKsc-Regular',
        },
        {
          path: '/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc',
          postscriptName: 'NotoSansCJKsc-Regular',
        },
        { path: '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc', postscriptName: 'WenQuanYiZenHei' },
        { path: '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc', postscriptName: 'WenQuanYiMicroHei' },
      ];
  }
}

/**
 * 解析可用中文字体候选列表（配置优先，其后为平台兜底）。
 * 仅做存在性检查，不做字体加载——加载失败由调用方依次降级重试。
 * @param configuredPath 环境变量 PDF_FONT_PATH 的值（可空）
 * @returns 存在的候选字体列表；全部不存在时为空数组
 */
export function resolveCjkFonts(configuredPath?: string): PdfFontCandidate[] {
  const out: PdfFontCandidate[] = [];
  const configured = configuredPath?.trim();
  if (configured && existsSync(configured)) {
    out.push({ path: configured });
  }
  for (const c of platformCandidates()) {
    if (existsSync(c.path)) out.push(c);
  }
  return out;
}
