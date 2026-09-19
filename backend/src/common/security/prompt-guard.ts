/**
 * Agent 提示词注入防护（纯函数、零依赖、可单测）。
 *
 * 对应四层防御中的 L1/L3/L4（L2 来源隔离在 generate.service.ts 的 prompt 构建层实现）：
 * - L1 归一化：normalizeText —— NFKC 统一编码 + 移除 Unicode 隐形/控制字符；
 * - L3 检测分级：detectInjection —— 规则引擎扫描注入模板，返回 high/medium/low；
 * - L4 输出兜底：checkOutput —— 扫描 LLM 生成正文，检测 system prompt 泄露与注入回显。
 *
 * 设计原则：宁缺毋滥。规则只命中「明确攻击意图的完整句式」，
 * 不把「忽略」「指令」等单字当关键词，避免误伤正常检索问题（误伤比漏检代价更高）。
 */

/** 风险等级：low 放行 / medium 标记观测 / high 阻断 */
export type RiskLevel = 'low' | 'medium' | 'high';

/** 检测结果（L3 输入检测与 L4 输出兜底共用） */
export interface GuardCheck {
  /** 命中的最高风险等级 */
  level: RiskLevel;
  /** 命中的规则 id（供日志/审计/命中统计） */
  reasons: string[];
}

/** 单条注入检测规则 */
interface InjectionRule {
  /** 规则唯一标识 */
  id: string;
  /** 命中后的风险等级（low 不参与规则，命中至少 medium） */
  level: Exclude<RiskLevel, 'low'>;
  /** 匹配正则（不带 g/y 标志，由检测器统一 .test） */
  pattern: RegExp;
}

/** 注入模板规则清单（中英双语，聚焦强攻击信号） */
const INJECTION_RULES: InjectionRule[] = [
  // ── HIGH：明确要求违背/无视系统指令 ──
  {
    id: 'override-zh',
    level: 'high',
    pattern: /忽略(?:掉)?(?:以上|上面|之前|先前|前面|所有|全部|一切)?(?:的)?(?:所有|全部)?(?:指令|命令|指示|规则|约束|设定|人格|角色设定)/i,
  },
  {
    id: 'override-en',
    level: 'high',
    pattern: /(?:ignore|disregard)\s+(?:all\s+)?(?:previous|prior|preceding|above|your)?\s*(?:instructions|directives|commands|rules|guidelines|constraints)/i,
  },
  // ── HIGH：要求泄露系统提示词 ──
  {
    id: 'reveal-zh',
    level: 'high',
    pattern: /(?:泄露|泄漏|透露|复述|重复)(?:你的)?(?:系统)?(?:提示词|system\s*prompt|系统指令)/i,
  },
  {
    id: 'reveal-en',
    level: 'high',
    pattern: /(?:reveal|disclose|leak|repeat)\s+(?:your|the)?\s*(?:system\s*prompt|instructions)/i,
  },
  // ── HIGH：越狱/角色劫持标记（DAN 为 AI 越狱专有名词，几乎零误伤） ──
  {
    id: 'jailbreak-dan',
    level: 'high',
    pattern: /\bDAN\b/i,
  },
  // ── MEDIUM：冒充权威 ──
  {
    id: 'impersonate-zh',
    level: 'medium',
    pattern: /我是你的(?:开发者|管理员|创建者|老板|上司|主人)/i,
  },
  {
    id: 'impersonate-en',
    level: 'medium',
    pattern: /I\s+am\s+your\s+(?:developer|admin|administrator|creator|owner|boss)/i,
  },
  // ── MEDIUM：要求绕过安全约束 ──
  {
    id: 'bypass-zh',
    level: 'medium',
    pattern: /(?:不要|无需|不必|不用)遵守(?:你的)?(?:规则|限制|约束|伦理|道德)|绕过(?:你的)?(?:规则|限制|约束|审查|安全|内容审核)/i,
  },
  {
    id: 'bypass-en',
    level: 'medium',
    pattern: /\b(?:bypass|circumvent)\s+(?:your|the)?\s*(?:rules|guidelines|safety|restrictions|filters)/i,
  },
];

/** L1 归一化：Unicode 隐形字符（零宽/双向控制/连字/BOM） */
const INVISIBLE_RE = /[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g;
/** L1 归一化：控制字符（保留换行 \n 与制表 \t） */
// 命中控制字符码位是本清洗器的设计意图而非疏漏，故关闭 no-control-regex
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

/**
 * L1 归一化：NFKC 统一全角/兼容字符变体，移除 Unicode 隐形字符（零宽、双向控制、BOM）
 * 与除换行/制表外的控制字符，输出合规纯文本。
 * 消除攻击者利用编码变体绕过敏感词/注入检测的可能性。
 * @param input 原始输入（用户问题或来源文本）
 */
export function normalizeText(input: string): string {
  if (!input) return '';
  return input.normalize('NFKC').replace(INVISIBLE_RE, '').replace(CONTROL_RE, '');
}

/** 用规则清单扫描文本，返回命中的最高风险等级与命中规则 id 列表 */
function scanRules(text: string): GuardCheck {
  const reasons: string[] = [];
  let level: RiskLevel = 'low';
  for (const rule of INJECTION_RULES) {
    if (rule.pattern.test(text)) {
      reasons.push(rule.id);
      if (rule.level === 'high') level = 'high';
      else if (level === 'low') level = 'medium';
    }
  }
  return { level, reasons };
}

/**
 * L3 检测分级：对用户输入做注入检测（应在归一化后调用）。
 * high 由调用方阻断，medium 记观测日志放行，low 放行。
 * @param text 归一化后的用户输入
 */
export function detectInjection(text: string): GuardCheck {
  return scanRules(text);
}

/** L4 输出兜底：system prompt 泄露特征（与 generate.service.ts 的 GENERATE_SYSTEM 身份原文对齐） */
const SYSTEM_PROMPT_LEAK_RE =
  /你是「AI 数智研究平台」|AI 数智研究平台」的资深数据分析师|资深数据分析师，负责把多来源数据整合/;

/**
 * L4 输出行为兜底：对 LLM 生成正文做规则扫描。
 * - 命中 system prompt 泄露特征 → high（调用方替换报告）；
 * - 命中注入规则 high → high；命中 medium → medium（标记观测）；
 * - 否则 low 放行。
 * 注意：生成是流式的，已推送 chunk 无法撤回；本检测保证「落库报告」安全。
 * @param text LLM 生成的完整正文
 */
export function checkOutput(text: string): GuardCheck {
  if (SYSTEM_PROMPT_LEAK_RE.test(text)) {
    return { level: 'high', reasons: ['system-prompt-leak'] };
  }
  return scanRules(text);
}
