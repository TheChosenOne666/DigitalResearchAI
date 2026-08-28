/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * 管理端种子脚本（M6.1）：创建管理员账号 + 平台级公共数据种子。
 * 运行方式：`pnpm seed:admin`（等价于 `node prisma/seed-admin.ts`，Node ≥22.18 原生 TS 剥离，不引入 tsx）。
 * 幂等设计：重复执行不产生重复数据，已存在的管理员只补角色与密码（D6）。
 *
 * 采用 CJS require 风格：脚本以 CJS 运行可正常解析生成的 Prisma client（client.js 为 CJS），
 * 避免 ESM 相对路径必须显式扩展名的坑；该文件是独立工具脚本，禁用 require 规则。
 */
require('node:fs');
const fs = require('node:fs');
const path = require('node:path');

// 极简 .env 加载：种子脚本独立运行，不依赖 Nest 的 ConfigModule（dotenv 为传递依赖，未直接声明）
(function loadEnv() {
  const file = path.join(__dirname, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_.]+)\s*=\s*(.*)\s*$/i);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
})();

const { PrismaClient } = require('../src/generated/prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString:
      process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5433/ai_research',
  }),
});

/** 内置三角色（M1 已约定，幂等补齐） */
const ROLES = [
  { code: 'USER', name: '普通用户', description: '普通注册用户' },
  { code: 'DATA_ADMIN', name: '数据管理员', description: '可管理数据资源 / 数据治理 / 任务中心' },
  { code: 'PLATFORM_ADMIN', name: '平台管理员', description: '平台最高权限，可访问管理端全部功能' },
];

/** 系统参数种子（A-12 / A-15 / A-18） */
const SYS_CONFIGS = [
  { key: 'upload.maxSizeMb', value: '100', label: '上传文件大小上限(MB)' },
  { key: 'task.timeoutMinutes', value: '30', label: '任务超时时间(分钟)' },
  { key: 'list.pageSize', value: '20', label: '列表默认分页大小' },
  { key: 'kb.matchThreshold', value: '0.6', label: '知识库检索相似度阈值' },
  { key: 'backup.scope', value: 'full', label: '备份范围' },
  { key: 'backup.schedule', value: 'daily', label: '备份计划' },
  { key: 'backup.keep', value: '30', label: '备份保留天数' },
  { key: 'kb.defaultVisibility', value: 'PRIVATE', label: '知识库默认可见性' },
  { key: 'kb.privateScope', value: 'SUBMITTER', label: '私有条目可见范围' },
];

/** 字典种子（A-06，五类：国家地区 / 机构 / 行业 / 单位 / 时间粒度） */
const DICT_ITEMS = [
  { type: 'COUNTRY', code: 'CN', name: '中国', nameEn: 'China', sort: 1 },
  { type: 'COUNTRY', code: 'US', name: '美国', nameEn: 'United States', sort: 2 },
  { type: 'COUNTRY', code: 'JP', name: '日本', nameEn: 'Japan', sort: 3 },
  { type: 'COUNTRY', code: 'DE', name: '德国', nameEn: 'Germany', sort: 4 },
  { type: 'COUNTRY', code: 'GB', name: '英国', nameEn: 'United Kingdom', sort: 5 },
  { type: 'COUNTRY', code: 'EU', name: '欧盟', nameEn: 'European Union', sort: 6 },
  { type: 'ORG', code: 'WB', name: '世界银行', nameEn: 'World Bank', sort: 1 },
  { type: 'ORG', code: 'IMF', name: '国际货币基金组织', nameEn: 'IMF', sort: 2 },
  { type: 'ORG', code: 'NBS', name: '国家统计局', nameEn: 'National Bureau of Statistics', sort: 3 },
  { type: 'INDUSTRY', code: 'I01', name: '制造业', nameEn: 'Manufacturing', sort: 1 },
  { type: 'INDUSTRY', code: 'I0101', name: '汽车制造', nameEn: 'Automobile', parentCode: 'I01', sort: 1 },
  { type: 'INDUSTRY', code: 'I02', name: '能源', nameEn: 'Energy', sort: 2 },
  { type: 'UNIT', code: 'PCT', name: '百分比', nameEn: '%', sort: 1 },
  { type: 'UNIT', code: 'USD', name: '美元', nameEn: 'USD', sort: 2 },
  { type: 'UNIT', code: 'TCE', name: '万吨标准煤', nameEn: '10k tce', sort: 3 },
  { type: 'TIME', code: 'Y', name: '年', nameEn: 'Year', sort: 1 },
  { type: 'TIME', code: 'Q', name: '季度', nameEn: 'Quarter', sort: 2 },
  { type: 'TIME', code: 'M', name: '月', nameEn: 'Month', sort: 3 },
  { type: 'TIME', code: 'D', name: '日', nameEn: 'Day', sort: 4 },
];

/** 指标种子 + 来源映射（A-05） */
const INDICATORS = [
  {
    code: 'GDP_YOY',
    name: 'GDP 同比增速',
    category: '宏观经济',
    unit: '%',
    definition: '国内生产总值同比增速',
    mappings: [
      { sourceName: '世界银行 WDI', sourceField: 'NY.GDP.MKTP.KD.ZG', transform: '直接映射' },
      { sourceName: '国际货币基金组织 IMF', sourceField: 'NGDP_R', transform: '直接映射' },
      { sourceName: '国家统计局', sourceField: 'A020101', transform: '直接映射' },
    ],
  },
  {
    code: 'EXP_AMT',
    name: '出口金额',
    category: '对外贸易',
    unit: '亿美元',
    definition: '货物出口金额',
    mappings: [{ sourceName: '世界银行 WDI', sourceField: 'TX.VAL.MRCH.CD.WT', transform: '直接映射' }],
  },
  {
    code: 'EV_PENET',
    name: '新能源汽车渗透率',
    category: '行业数据',
    unit: '%',
    definition: '新能源汽车销量占汽车总销量比例',
    mappings: [{ sourceName: '国家统计局', sourceField: 'EV_PENET_RATE', transform: '直接映射' }],
  },
  {
    code: 'ENER_CONSUME',
    name: '能源消费总量',
    category: '能源',
    unit: '万吨标准煤',
    definition: '全社会能源消费总量',
    mappings: [{ sourceName: '国家统计局', sourceField: 'ENERGY_CONSUME', transform: '直接映射' }],
  },
];

/** 支付渠道配置种子（A-20，默认仅 MOCK 启用） */
const PAY_CHANNELS = [
  { channel: 'MOCK', merchantId: 'MOCK_MERCHANT', notifyUrl: '', enabled: true },
  { channel: 'WECHAT', merchantId: null, notifyUrl: '', enabled: false },
  { channel: 'ALIPAY', merchantId: null, notifyUrl: '', enabled: false },
];

/** 确保内置角色存在（按 code 幂等） */
async function seedRoles() {
  for (const r of ROLES) {
    await prisma.role.upsert({
      where: { code: r.code },
      create: r,
      update: { name: r.name, description: r.description },
    });
  }
}

/** 创建/补齐管理员账号（独立个人租户 + PLATFORM_ADMIN 角色 + 初始密码） */
async function seedAdmin() {
  const role = await prisma.role.findUniqueOrThrow({ where: { code: 'PLATFORM_ADMIN' } });
  const hash = bcrypt.hashSync('admin123', 10);
  let user = await prisma.user.findUnique({ where: { phone: '13800000000' } });
  if (!user) {
    const tenant = await prisma.tenant.create({ data: { name: '平台管理空间' } });
    user = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        phone: '13800000000',
        nickname: '平台管理员',
        username: 'admin',
        realName: '平台管理员',
        organization: '平台运营部',
        passwordHash: hash,
        roles: { create: [{ roleId: role.id }] },
      },
    });
    console.log(`[seed] 已创建管理员账号: 13800000000 / admin123`);
  } else {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: hash,
        username: 'admin',
        realName: '平台管理员',
        organization: '平台运营部',
      },
    });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
      create: { userId: user.id, roleId: role.id },
      update: {},
    });
    console.log(`[seed] 管理员账号已存在，已补角色与密码: 13800000000`);
  }
}

/** 系统参数（按 key 幂等，缺失补齐、不覆盖既有值） */
async function seedConfigs() {
  for (const c of SYS_CONFIGS) {
    await prisma.sysConfig.upsert({
      where: { key: c.key },
      create: { key: c.key, value: c.value, label: c.label },
      update: { label: c.label },
    });
  }
  console.log(`[seed] 系统参数已同步：${SYS_CONFIGS.length} 条`);
}

/** 基础字典（按 type+code 幂等） */
async function seedDicts() {
  for (const d of DICT_ITEMS) {
    const data = { name: d.name, nameEn: d.nameEn, parentCode: d.parentCode ?? null, sort: d.sort };
    await prisma.dictItem.upsert({
      where: { type_code: { type: d.type, code: d.code } },
      create: { type: d.type, code: d.code, ...data },
      update: data,
    });
  }
  console.log(`[seed] 字典项已同步：${DICT_ITEMS.length} 条`);
}

/** 指标 + 来源映射（指标按 code 幂等，映射按 sourceName+sourceField 去重） */
async function seedIndicators() {
  for (const ind of INDICATORS) {
    const indicator = await prisma.indicator.upsert({
      where: { code: ind.code },
      create: {
        code: ind.code,
        name: ind.name,
        category: ind.category,
        unit: ind.unit,
        definition: ind.definition,
      },
      update: { name: ind.name, category: ind.category, unit: ind.unit, definition: ind.definition },
    });
    for (const m of ind.mappings) {
      const exists = await prisma.indicatorMapping.findFirst({
        where: { indicatorId: indicator.id, sourceName: m.sourceName, sourceField: m.sourceField },
      });
      if (!exists) {
        await prisma.indicatorMapping.create({
          data: {
            indicatorId: indicator.id,
            sourceName: m.sourceName,
            sourceField: m.sourceField,
            transform: m.transform,
          },
        });
      }
    }
  }
  console.log(`[seed] 指标已同步：${INDICATORS.length} 个`);
}

/** 支付渠道配置（按 channel 幂等，不覆盖既有密钥） */
async function seedPayChannels() {
  for (const c of PAY_CHANNELS) {
    await prisma.payChannelConfig.upsert({
      where: { channel: c.channel },
      create: { channel: c.channel, merchantId: c.merchantId, notifyUrl: c.notifyUrl, enabled: c.enabled },
      update: {},
    });
  }
  console.log(`[seed] 支付渠道配置已同步：${PAY_CHANNELS.length} 条`);
}

async function main() {
  await seedRoles();
  await seedAdmin();
  await seedConfigs();
  await seedDicts();
  await seedIndicators();
  await seedPayChannels();
  console.log('[seed] 管理端种子初始化完成');
}

main()
  .catch((e) => {
    console.error('[seed] 初始化失败：', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
