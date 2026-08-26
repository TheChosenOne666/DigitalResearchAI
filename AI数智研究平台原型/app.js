/* =========================================================
   AI数智研究平台原型 · 真实功能数据层（依据 PRD 37 功能点）
   ========================================================= */
'use strict';

/* ---------- 工具函数 ---------- */
function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function st(s){
  var m={'待审核':'warning','已通过':'success','已退回':'danger','已入库':'success','已上架':'success','已下架':'','待支付':'warning','已支付':'success','回调异常':'danger','已关闭':'','已撤回':'','正常':'success','已禁用':'danger','启用':'success','停用':'','已发布':'success','草稿':'warning','执行中':'warning','成功':'success','失败':'danger','复核中':'warning','已完成':'success','已归档':'','公开':'success','私有':'warning','已校验':'success','已提醒':'success','待提醒':'warning','未到窗口':'','错误':'danger','告警':'warning','已配置':'success','待处理':'warning','运行中':'success'};
  return '<span class="status '+(m[s]||'')+'">'+esc(s)+'</span>';
}
function tag(t,cls){ return '<span class="tag '+(cls||'')+'">'+esc(t)+'</span>'; }
function link(t,fn){ return '<span class="link" onclick="'+fn+'">'+t+'</span>'; }
function money(n){ return '¥'+Number(n||0).toLocaleString('zh-CN',{minimumFractionDigits:2}); }
function nowStr(){ var d=new Date(); function p(x){return (x<10?'0':'')+x;} return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+' '+p(d.getHours())+':'+p(d.getMinutes()); }
function todayStr(){ var d=new Date(); function p(x){return (x<10?'0':'')+x;} return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate()); }

/* ---------- 全局状态库 ---------- */
var DB = {
  users: [
    {id:'u1', account:'admin',       name:'平台管理员', org:'平台运营部', role:'平台管理员', status:'正常'},
    {id:'u2', account:'data_zhang',  name:'张数据',     org:'智库研究部', role:'数据管理员', status:'正常'},
    {id:'u3', account:'li_research', name:'李研究',     org:'智库研究部', role:'普通用户',   status:'正常'},
    {id:'u4', account:'wang_energy', name:'王能源',     org:'能源数据组', role:'普通用户',   status:'已禁用'},
    {id:'u5', account:'chen_data',   name:'陈数据',     org:'智库研究部', role:'普通用户',   status:'正常'},
    {id:'u6', account:'zhao_member', name:'赵会员',     org:'会员企业',   role:'普通用户',   status:'正常'},
    {id:'u7', account:'sun_user',    name:'孙用户',     org:'平台用户',   role:'普通用户',   status:'正常'},
    {id:'u8', account:'user',        name:'张小明',     org:'智库研究部', role:'普通用户',   status:'正常'}
  ],
  members: [
    {id:'m1', name:'基础版', period:'月',      price:'¥ 0',        status:'启用'},
    {id:'m2', name:'专业版', period:'季 / 年', price:'¥ 149 / ¥ 499', status:'启用'},
    {id:'m3', name:'企业版', period:'年',      price:'¥ 3,999',    status:'启用'}
  ],
  memberOrders: [
    {id:'mo1', user:'li_research', level:'专业版 · 年', amount:'¥499',   status:'已支付',   time:'2026-07-15'},
    {id:'mo2', user:'wang_energy', level:'企业版 · 年', amount:'¥3,999', status:'待支付',   time:'2026-08-10'},
    {id:'mo3', user:'chen_data',   level:'企业版 · 年', amount:'¥3,999', status:'回调异常', time:'2026-06-30'}
  ],
  renews: [
    {id:'r1', user:'li_research', level:'专业版', due:'2026-07-15', remain:'6 天',  status:'已提醒'},
    {id:'r2', user:'zhao_member', level:'企业版', due:'2026-08-16', remain:'7 天',  status:'待提醒'},
    {id:'r3', user:'sun_user',    level:'专业版', due:'2026-08-20', remain:'10 天', status:'未到窗口'}
  ],
  roles: [
    {id:'role1', name:'平台管理员', desc:'拥有管理端全部功能权限及用户端全部功能权限', users:2, status:'启用'},
    {id:'role2', name:'数据管理员', desc:'数据资源、数据治理、任务中心等数据类权限', users:1, status:'启用'},
    {id:'role3', name:'普通用户',   desc:'用户端全部功能权限（不含管理端）',         users:8, status:'启用'},
    {id:'role4', name:'访客',       desc:'仅浏览公开数据',                            users:0, status:'停用'}
  ],
  indicators: [
    {id:'ind1', code:'GDP_GROWTH', name:'GDP 增长率', unit:'%',       source:'世界银行 WDI', status:'启用'},
    {id:'ind2', code:'CPI_YOY',    name:'CPI 同比',   unit:'%',       source:'国家统计局',   status:'启用'},
    {id:'ind3', code:'PMI_INDEX',  name:'制造业 PMI', unit:'—',       source:'国家统计局',   status:'启用'},
    {id:'ind4', code:'ELE_PROD',   name:'发电量',     unit:'亿千瓦时', source:'国家统计局',   status:'启用'},
    {id:'ind5', code:'TRADE_EXP',  name:'出口额',     unit:'亿美元',   source:'海关总署',     status:'启用'}
  ],
  mappings: [
    {id:'im1', src:'WDI.NY.GDP.MKTP.KD.ZG', ind:'GDP_GROWTH', note:'WDI 年增长率'},
    {id:'im2', src:'CN.CPI.YOY',            ind:'CPI_YOY',    note:'官方月度同比'}
  ],
  dicts: {
    country:  {name:'国家代码', items:[{code:'CN',name:'中国',note:'China',status:'启用'},{code:'US',name:'美国',note:'USA',status:'启用'},{code:'JP',name:'日本',note:'Japan',status:'启用'}]},
    source:   {name:'数据来源', items:[{code:'WB',name:'世界银行',note:'国际',status:'启用'},{code:'NBS',name:'国家统计局',note:'国内',status:'启用'}]},
    industry: {name:'行业分类', items:[{code:'I01',name:'制造业',note:'—',status:'启用'},{code:'I02',name:'服务业',note:'—',status:'启用'}]},
    unit:     {name:'计量单位', items:[{code:'百分比',name:'%',note:'比率',status:'启用'},{code:'金额',name:'元',note:'货币',status:'启用'}]},
    period:   {name:'时间粒度', items:[{code:'Y',name:'年',note:'年度数据',status:'启用'},{code:'Q',name:'季',note:'季度数据',status:'启用'},{code:'M',name:'月',note:'月度数据',status:'启用'}]}
  },
  datasets: [
    {id:'ds1', name:'公共数据集 · 宏观经济',      sub:'2020-2025 · 中国/美国', src:'数据接入审核', cat:'宏观经济', rows:24,  status:'已上架'},
    {id:'ds2', name:'2025年宏观数据',            sub:'来源：li_research · Excel', src:'用户上传',   cat:'宏观经济', rows:60,  status:'已上架'},
    {id:'ds3', name:'进出口贸易数据',            sub:'来源：li_research · CSV',   src:'用户上传',   cat:'对外贸易', rows:48,  status:'已上架'},
    {id:'ds4', name:'生产库-经营数据',           sub:'来源：data_zhang · 数据库', src:'数据库接入', cat:'企业数据', rows:120, status:'已上架'},
    {id:'ds5', name:'2026 上半年工业增加值（分省）', sub:'来源：国家统计局',      src:'系统采集',   cat:'工业',     rows:31,  status:'已下架'}
  ],
  imports: [
    {id:'IM-1001', name:'2025年宏观数据',   type:'Excel',   size:'2.4 MB', by:'li_research', time:'2026-08-10 09:12', status:'待审核', reason:''},
    {id:'IM-1002', name:'进出口贸易数据',   type:'CSV',     size:'856 KB', by:'li_research', time:'2026-08-09 16:40', status:'待审核', reason:''},
    {id:'IM-1003', name:'生产库-经营数据',  type:'数据库',  size:'—',      by:'data_zhang',  time:'2026-08-08 11:03', status:'已通过', reason:''},
    {id:'IM-1004', name:'外部指标接口',     type:'API',     size:'—',      by:'chen_data',   time:'2026-08-07 09:20', status:'已退回', reason:'必填列缺失'}
  ],
  notices: [
    {id:'n1', title:'平台功能更新通知（2026-08）', scope:'全部用户',       status:'已发布', time:'2026-08-08'},
    {id:'n2', title:'数据库维护公告',             scope:'全部用户',       status:'已撤回', time:'2026-08-09'},
    {id:'n3', title:'会员续费提醒说明',           scope:'专业版会员',     status:'草稿',   time:'2026-08-10'}
  ],
  hotWords: [
    {id:'h1', rank:1, word:'中国 GDP',   count:8240, trend:'↑ 12%', shortcut:false},
    {id:'h2', rank:2, word:'CPI',        count:6120, trend:'↑ 5%',  shortcut:false},
    {id:'h3', rank:3, word:'新能源汽车', count:5280, trend:'↑ 18%', shortcut:false}
  ],
  suggestions: [
    {id:'s1', word:'央行降准影响分析', date:'2026-08-09', cnt:12, flag:''},
    {id:'s2', word:'美联储加息路径',   date:'2026-08-08', cnt:8,  flag:''}
  ],
  sensitive: [
    {id:'w1', word:'词A', type:'涉政', cnt:3, status:'启用'},
    {id:'w2', word:'词B', type:'涉黄', cnt:0, status:'启用'},
    {id:'w3', word:'词C', type:'广告', cnt:1, status:'停用'}
  ],
  tasks: [
    {id:'T-20260810-021', type:'检索',       by:'li_research', status:'执行中', progress:72, created:'2026-08-10 09:30'},
    {id:'T-20260810-020', type:'报告生成',   by:'li_research', status:'成功',   progress:100,created:'2026-08-10 09:12'},
    {id:'T-20260809-018', type:'数据导入',   by:'data_zhang',  status:'失败',   progress:40, created:'2026-08-09 15:21'},
    {id:'T-20260809-015', type:'索引重建',   by:'admin',       status:'成功',   progress:100,created:'2026-08-09 02:00'}
  ],
  taskLogs: [
    {id:'l1', time:'2026-08-09 15:21:08', level:'ERROR', msg:'数据源「统计局月度数据」连接超时（3000ms），重试 2 次仍失败'}
  ],
  agents: [
    {id:'ag1', name:'行业研究报告助手', desc:'面向行业研究报告自动生成', caps:['检索','分析','撰写'], model:'gpt-4o', provider:'OpenAI', formats:['Word','PPT','PDF'], temperature:0.4, maxTokens:4096, timeout:60, status:'启用', calls:1280, successRate:'97.2%', avgTime:'3分42秒', lastRun:'2026-08-10 10:32'},
    {id:'ag2', name:'宏观数据分析助手', desc:'宏观经济数据检索与分析', caps:['检索','分析'], model:'qwen-plus', provider:'通义千问（阿里云百炼）', formats:['Word','PDF'], temperature:0.3, maxTokens:8192, timeout:60, status:'启用', calls:860, successRate:'95.6%', avgTime:'2分15秒', lastRun:'2026-08-10 10:05'},
    {id:'ag3', name:'企业对标分析助手', desc:'企业财务与经营对标分析', caps:['分析','撰写'], model:'deepseek-chat', provider:'DeepSeek', formats:['PPT','PDF'], temperature:0.5, maxTokens:8192, timeout:90, status:'停用', calls:420, successRate:'91.3%', avgTime:'4分08秒', lastRun:'2026-08-09 18:20'}
  ],
  agentTasks: [
    {id:'RPT-20260810-003', agent:'ag1', by:'张研究', status:'执行中', progress:58, stage:'报告撰写（引用校验）', created:'2026-08-10 09:10'},
    {id:'RPT-20260810-005', agent:'ag2', by:'张小明', status:'执行中', progress:35, stage:'多源数据检索', created:'2026-08-10 10:02'},
    {id:'RPT-20260809-012', agent:'ag1', by:'李研究', status:'失败', progress:0, stage:'引用来源校验超时', created:'2026-08-09 17:45'},
    {id:'RPT-20260809-008', agent:'ag3', by:'王能源', status:'成功', progress:100, stage:'已完成', created:'2026-08-09 11:20'}
  ],
  refPolicy: { autoGenerate:true, verifySource:true, timeout:30, missingMode:'待补充引用', format:'国标 GB/T 7714-2015', dedupe:true },
  refStats: { total:1280, verified:1196, pending:56, missing:28, traceable:'100%' },
  configs: [
    {id:'c1', key:'upload_max_mb', name:'上传文件大小限制',   val:'100', unit:'MB',  desc:'单位 MB · 作用于数据上传（U-07）等'},
    {id:'c2', key:'task_timeout_min', name:'任务/会话超时时间', val:'30', unit:'分钟', desc:'单位 分钟 · 检索任务超时、登录会话等'},
    {id:'c3', key:'page_size',     name:'列表默认分页大小',   val:'20', unit:'条/页', desc:'条/页 · 作用于各列表页'},
    {id:'c4', key:'sim_threshold', name:'本地匹配相似度阈值', val:'0.6', unit:'—',    desc:'知识库优先匹配（U-12）默认阈值'}
  ],
  aiConfig: {
    providers: [
      {id:'ap1', vendor:'OpenAI', baseUrl:'https://api.openai.com/v1', apiKey:'sk-proj-aBcDeFgHiJkLmNoPqRsTuVwXyZ1234567890', model:'gpt-4o', timeout:60, temperature:0.4, maxTokens:4096, status:'启用', desc:'通用大模型：智能检索解析、报告撰写'},
      {id:'ap2', vendor:'通义千问（阿里云百炼）', baseUrl:'https://dashscope.aliyuncs.com/compatible-mode/v1', apiKey:'sk-abcdef1234567890abcdef1234567890', model:'qwen-plus', timeout:60, temperature:0.3, maxTokens:8192, status:'启用', desc:'国产大模型：知识库问答、摘要生成'},
      {id:'ap3', vendor:'DeepSeek', baseUrl:'https://api.deepseek.com/v1', apiKey:'sk-0987654321zyxwvutsrqponmlkjihgfedcba', model:'deepseek-chat', timeout:90, temperature:0.5, maxTokens:8192, status:'停用', desc:'备用模型：离线批处理与降级兜底'}
    ],
    defaultProvider: 'ap1',
    global: { model:'gpt-4o', temperature:0.4, maxTokens:4096, timeout:60, retries:2 }
  },
  audit: [
    {id:'a1', who:'li_research', time:'2026-08-10 09:11:02', ip:'192.168.1.12', result:'成功', action:'登录平台'},
    {id:'a2', who:'li_research', time:'2026-08-10 09:12:01', ip:'192.168.1.12', result:'成功', action:'上传数据：2025年宏观数据'},
    {id:'a3', who:'admin',       time:'2026-08-10 08:30:11', ip:'10.0.0.8',     result:'成功', action:'审核通过导入任务 IM-1003'},
    {id:'a4', who:'data_zhang',  time:'2026-08-09 17:40:22', ip:'10.0.0.15',    result:'失败', action:'导出数据集（权限不足）'},
    {id:'a5', who:'user',        time:'2026-08-09 15:21:08', ip:'192.168.1.55', result:'成功', action:'发起报告生成任务'}
  ],
  exports: [
    {id:'e1', time:'2026-08-10 10:32', name:'中美 GDP 增长率对比', type:'CSV', size:'86 KB', status:'成功'},
    {id:'e2', time:'2026-08-09 16:12', name:'各省 PMI 指数',       type:'PNG', size:'412 KB',status:'成功'}
  ],
  analysisRows: [
    {year:'2024', country:'中国', value:'1,349,084', rate:'5.0%', source:'国家统计局'},
    {year:'2024', country:'美国', value:'27,360',    rate:'2.9%', source:'美国经济分析局'},
    {year:'2023', country:'中国', value:'1,278,766', rate:'5.2%', source:'国家统计局'},
    {year:'2023', country:'美国', value:'27,360',    rate:'2.5%', source:'美国经济分析局'},
    {year:'2022', country:'中国', value:'1,209,720', rate:'3.0%', source:'国家统计局'},
    {year:'2022', country:'美国', value:'25,462',    rate:'2.1%', source:'美国经济分析局'}
  ],
  myData: [
    {id:'md1', name:'2025年宏观数据',   org:'智库研究部', tags:['GDP','年度'],     status:'审核中', time:'2026-08-10 09:12'},
    {id:'md2', name:'进出口贸易数据',   org:'智库研究部', tags:['进出口','月份'],   status:'已上架', time:'2026-08-08 16:40'},
    {id:'md3', name:'2024 能源消费结构',org:'智库研究部', tags:['能源'],           status:'已归档', time:'2026-07-28 11:00'}
  ],
  myReports: [
    {id:'mr1', name:'中美GDP增长率对比分析报告', share:'仅授权用户可见', type:'Word', ver:'v3', time:'2026-08-09 14:22', status:'已完成'},
    {id:'mr2', name:'2023 能源快报（草稿）',     share:'仅自己可见',     type:'Word', ver:'v1', time:'2026-08-09 17:40', status:'草稿'}
  ],
  reportVersions: [
    {id:'rv1', name:'中美GDP增长率对比分析报告', ver:'v3', time:'2026-08-09 14:22', note:'新增数据校验', current:true},
    {id:'rv2', name:'中美GDP增长率对比分析报告', ver:'v2', time:'2026-08-08 10:05', note:'补充图表'},
    {id:'rv3', name:'中美GDP增长率对比分析报告', ver:'v1', time:'2026-08-06 16:30', note:'初稿'}
  ],
  orders: [
    {id:'ORD202608100001', user:'user',       title:'会员缴费 · 专业版年费', amount:499,  channel:'微信支付', status:'待支付',   time:'2026-08-10 10:00'},
    {id:'ORD202607150008', user:'li_research',title:'会员缴费 · 专业版年费', amount:499,  channel:'支付宝',   status:'已支付',   time:'2026-07-15 09:20'},
    {id:'ORD202606300021', user:'chen_data',  title:'会员缴费 · 企业版年费', amount:3999, channel:'微信支付', status:'回调异常', time:'2026-06-30 14:02'}
  ],
  payments: [
    {id:'WX20260715092188', channel:'微信支付', order:'ORD202607150008', amount:499,  time:'2026-07-15 09:21:03', status:'成功'},
    {id:'ALI20260715092001', channel:'支付宝',  order:'ORD202607150008', amount:499,  time:'2026-07-15 09:20:00', status:'成功'}
  ],
  invoices: [
    {id:'INV20260715001', order:'ORD202607150008', amount:'¥499.00', type:'电子普票', status:'已开具', date:'2026-07-15'}
  ],
  channels: [
    {id:'ch1', name:'微信支付', merchant:'wx_merchant_88231', callback:'https://research.example.com/pay/callback/wx', status:'启用'},
    {id:'ch2', name:'支付宝',   merchant:'ali_merchant_55201', callback:'https://research.example.com/pay/callback/ali', status:'启用'}
  ],
  kbEntries: [
    {id:'k1', title:'2025 中美新能源渗透率对比', type:'数据条目', owner:'张研究',   time:'2026-08-09 15:20', status:'已通过', score:0.86, scope:'公开'},
    {id:'k2', title:'2025 新能源汽车产业研究',   type:'Agent 生成', owner:'张研究', time:'2026-08-09 14:30', status:'复核中', score:0.92, scope:'公开'},
    {id:'k3', title:'央行降准对制造业的影响',    type:'数据条目', owner:'李研究',   time:'2026-08-08 11:00', status:'已通过', score:0.78, scope:'私有'}
  ],
  kbCategories: [
    {id:'c1', name:'宏观经济', sub:1, status:'启用'},
    {id:'c2', name:'行业数据', sub:2, status:'启用'},
    {id:'c3', name:'企业数据', sub:0, status:'停用'}
  ],
  kbTags: [
    {id:'t1', name:'GDP',    cnt:128, status:'启用'},
    {id:'t2', name:'PMI',    cnt:64,  status:'启用'},
    {id:'t3', name:'新能源', cnt:32,  status:'启用'}
  ],
  kbIndexTasks: [
    {id:'INDEX-20260801-01', type:'索引重建', time:'2026-08-01 03:00', status:'成功', detail:'全量 12,846 条 · 耗时 8 分钟'},
    {id:'INDEX-20260725-01', type:'增量更新', time:'2026-07-25 02:00', status:'成功', detail:'增量 328 条'}
  ],
  monitors: [
    {id:'mo1', name:'前端 Web',  url:'https://research.example.com',  status:'正常', time:'2026-08-10 10:01:00'},
    {id:'mo2', name:'检索服务',  url:'https://api.example.com/search', status:'正常', time:'2026-08-10 10:01:00'},
    {id:'mo3', name:'数据库',    url:'mysql://10.20.30.40:3306',       status:'告警', time:'2026-08-10 10:01:00'}
  ],
  errors: [
    {id:'e1', time:'2026-08-10 10:00:31', src:'外部数据源', msg:'连接统计局 open-api 超时（connect timeout）'}
  ],
  backups: [
    {id:'b1', time:'2026-08-10 02:00', type:'全量', size:'3.2 GB', status:'成功'},
    {id:'b2', time:'2026-08-09 02:00', type:'增量', size:'1.1 GB', status:'成功'}
  ],
  kbReviewQueue: [
    {id:'kq1', title:'2025 中美新能源渗透率对比', owner:'张研究', type:'数据条目', time:'2026-08-09 15:20', status:'已通过'},
    {id:'kq2', title:'全球能源消费结构趋势',     owner:'李研究', type:'Agent 生成', time:'2026-08-10 09:00', status:'待审核'},
    {id:'kq3', title:'半导体行业营收 Top10',     owner:'张研究', type:'数据条目', time:'2026-08-10 08:40', status:'待审核'}
  ],
  searchHistory: [
    {t:'全球能源消费结构及趋势', d:'今天 10:24 · AI 解析成功'},
    {t:'2025 年中国各省 GDP 排名', d:'昨天 16:40 · AI 解析成功'},
    {t:'美国失业率与通胀关系', d:'08-08 09:15 · 手动编辑条件'},
    {t:'半导体行业营收 Top10 企业', d:'08-06 14:02 · AI 解析成功'}
  ]
};
/* =========================================================
   用户端渲染函数（每视图进入时调用）
   ========================================================= */
function rHome(){
  var hot = document.getElementById('tbody-home-hot');
  if(hot){
    var rows = DB.datasets.filter(function(d){return d.status==='已上架';}).slice(0,5);
    hot.innerHTML = rows.map(function(d,i){
      return '<tr><td>'+(i+1)+'</td><td>'+esc(d.name)+'</td><td>'+esc(d.src)+'</td><td><span class="status success">HOT '+(9.8-i)+'k</span></td><td><span class="link" onclick="go(\'smart-search\')">去检索</span></td></tr>';
    }).join('');
  }
  var latest = document.getElementById('tbody-home-latest');
  if(latest){
    latest.innerHTML = DB.datasets.map(function(d){
      return '<tr><td>'+esc(d.name)+'</td><td>'+tag(d.src==='用户上传'?'数据集':'公共数据')+'</td><td>'+esc(d.time?d.time:(d.sub||''))+'</td><td>'+st(d.status)+'</td></tr>';
    }).join('');
  }
  // 公告区
  var an = document.getElementById('home-notices');
  if(an){
    var pubs = DB.notices.filter(function(n){return n.status==='已发布';});
    an.innerHTML = pubs.length ? pubs.map(function(n){
      return '<div class="tl-item done"><div class="t">'+esc(n.title)+'</div><div class="d">'+esc(n.time)+' · 范围：'+esc(n.scope)+'</div></div>';
    }).join('') : '<div class="small muted">暂无公告</div>';
  }
}
function rGlobalSearch(){
  var hist = document.getElementById('gs-history');
  if(hist){
    hist.innerHTML = DB.searchHistory.map(function(h){
      return '<div class="tl-item done"><div class="t">'+esc(h.t)+'</div><div class="d">'+esc(h.d)+'</div></div>';
    }).join('');
  }
  var sc = document.getElementById('gs-shortcuts');
  if(sc){
    var words = DB.hotWords.filter(function(h){return h.shortcut;}).map(function(h){return h.word;});
    sc.innerHTML = words.length ? words.map(function(w){
      return '<button class="btn" style="justify-content:flex-start" onclick="applyShortcut(\''+esc(w).replace(/'/g,"\\'")+'\')">🔍 '+esc(w)+'</button>';
    }).join('') : '<div class="small muted">暂无快捷检索词（管理端 A-10 可设置）</div>';
  }
}
function rSmartSearch(){
  var src = document.getElementById('tbody-smart-sources');
  if(src){
    src.innerHTML = [
      ['世界银行 WDI','外部 API','可用','GDP / 人口 / 贸易'],
      ['国家统计局','数据库','可用','月度 / 年度指标'],
      ['海关总署','外部 API','可用','进出口贸易'],
      ['本地知识库','内部检索','可用','研究成果沉淀']
    ].map(function(r){
      return '<tr><td><input type="checkbox" checked=""></td><td>'+r[0]+'</td><td>'+tag(r[1])+'</td><td>'+st(r[2])+'</td><td class="small muted">'+r[3]+'</td></tr>';
    }).join('');
  }
  var res = document.getElementById('tbody-smart-results');
  if(res){
    res.innerHTML = [
      ['世界银行 WDI','1,284','1.2s','成功'],
      ['国家统计局','896','0.8s','成功'],
      ['本地知识库','42','0.3s','成功']
    ].map(function(r){
      return '<tr><td>'+r[0]+'</td><td class="num">'+r[1]+'</td><td class="num">'+r[2]+'</td><td>'+st(r[3])+'</td></tr>';
    }).join('');
  }
}
function rTaskControl(){
  var tb = document.getElementById('tbody-task-list');
  if(tb){
    tb.innerHTML = DB.tasks.map(function(t){
      var act = t.status==='执行中'
        ? link('停止',"stopTask('"+t.id+"')")
        : (t.status==='失败' ? link('重试'+(t.retries?'('+t.retries+'/3)':''),"retryTask('"+t.id+"')") : '');
      return '<tr><td>'+esc(t.id)+' · '+esc(t.type)+'</td><td>'+st(t.status)+'</td><td><div class="progress"><i style="width:'+t.progress+'%"></i></div><span class="pct">'+t.progress+'%</span></td><td>'+esc(t.created)+'</td><td><div class="row-actions">'+act+'</div></td></tr>';
    }).join('');
  }
}
function rResultAnalysis(){
  var tb = document.getElementById('tbody-analysis');
  if(tb){
    tb.innerHTML = DB.analysisRows.map(function(r){
      return '<tr><td>'+r.year+'</td><td>'+r.country+'</td><td class="num">'+r.value+'</td><td class="num">'+r.rate+'</td><td>'+r.source+'</td></tr>';
    }).join('');
  }
  var chart = document.getElementById('analysis-chart');
  if(chart){
    var bars = [35,48,42,60,54,72,80];
    chart.innerHTML = bars.map(function(b){ return '<i style="height:'+b+'%"></i>'; }).join('');
  }
}
function rExport(){
  var tb = document.getElementById('tbody-export');
  if(tb){
    tb.innerHTML = DB.exports.map(function(e){
      return '<tr><td>'+esc(e.time)+'</td><td>'+esc(e.name)+'</td><td>'+tag(e.type==='CSV'?'CSV':'PNG','brand')+'</td><td>'+esc(e.size)+'</td><td>'+st(e.status)+'</td></tr>';
    }).join('');
  }
}
function rUpload(){
  var tb = document.getElementById('tbody-upload-records');
  if(tb){
    tb.innerHTML = DB.imports.map(function(im){
      var act='';
      if(im.status==='待审核') act = link('撤回',"withdrawImport('"+im.id+"')");
      else if(im.status==='已退回') act = link('修改后重交',"resubmitImport('"+im.id+"')");
      else if(im.status==='已通过') act = link('查看',"go('my-data')");
      else act = link('重新提交',"resubmitImport('"+im.id+"')");
      return '<tr><td>'+esc(im.name)+'</td><td>'+tag(im.type)+'</td><td>'+esc(im.time)+'</td><td class="num">'+esc(im.size)+'</td><td>'+st(im.status)+'</td><td class="row-actions">'+act+'</td></tr>';
    }).join('');
  }
}
function rAiReport(){
  var tb = document.getElementById('tbody-ai-report');
  if(tb){
    tb.innerHTML = DB.myReports.map(function(r){
      var act = '<div class="row-actions">'+link('编辑',"editReport('"+r.id+"')")+' '+link('下载',"downloadFile('docx')")+'</div>';
      return '<tr><td>'+esc(r.name)+'</td><td>'+tag(r.type,'brand')+'</td><td>'+esc(r.time)+'</td><td>'+st(r.status)+'</td><td>'+act+'</td></tr>';
    }).join('');
  }
}
function rKbAchievements(){
  var tb = document.getElementById('tbody-kb-achievements');
  if(tb){
    tb.innerHTML = DB.kbEntries.map(function(k){
      var act = '<div class="row-actions">'+link('查看详情',"openKbDetail('"+k.id+"')")+' '+link('下载',"downloadFile('word')")+'</div>';
      return '<tr><td>'+esc(k.title)+'</td><td>'+tag(k.type==='Agent 生成'?'Agent 生成':'数据条目','brand')+'</td><td>'+esc(k.owner)+'</td><td>'+st(k.status)+'</td><td>'+tag('Word')+'</td><td>'+act+'</td></tr>';
    }).join('');
  }
}
function rKbIngest(){
  var tb = document.getElementById('tbody-kb-ingest');
  if(tb){
    tb.innerHTML = DB.kbEntries.map(function(k){
      return '<tr><td>'+esc(k.title)+'<div class="small muted">来源：'+esc(k.type)+' · 作者：'+esc(k.owner)+'</div></td><td>'+tag(k.type==='Agent 生成'?'自动':'手动','brand')+'</td><td>'+st(k.status==='已通过'?'已入库':k.status)+'</td></tr>';
    }).join('');
  }
}
function rKbPriority(){
  var tb = document.getElementById('tbody-kb-priority');
  if(tb){
    tb.innerHTML = DB.kbEntries.map(function(k){
      return '<tr><td>'+esc(k.title)+'</td><td>'+tag('本地知识库','brand')+'</td><td class="num">'+k.score.toFixed(2)+'</td><td>'+st(k.status==='已通过'?'已入库':k.status)+'</td></tr>';
    }).join('');
  }
}
function rKbManage(){
  var tb = document.getElementById('tbody-kb-manage');
  if(tb){
    tb.innerHTML = DB.kbEntries.map(function(k){
      var act = '<div class="row-actions">'+link('编辑',"editKb('"+k.id+"')")+' '+link(k.scope==='公开'?'设为私有':"设为公开","toggleKbScope('"+k.id+"')")+'</div>';
      return '<tr><td>'+esc(k.title)+'</td><td>'+tag(k.type,'brand')+'</td><td>'+tag(k.scope)+'</td><td>'+st(k.status==='已通过'?'正常':k.status)+'</td><td>'+esc(k.time)+'</td><td>'+act+'</td></tr>';
    }).join('');
  }
}
function rMyData(){
  var tb = document.getElementById('tbody-my-data');
  if(tb){
    tb.innerHTML = DB.myData.map(function(d){
      var act='';
      if(d.status==='已归档') act = link('恢复',"restoreData('"+d.id+"')");
      else act = '<span class="link" onclick="editTags(\''+d.id+'\')">标签</span> <span class="link" onclick="archiveData(\''+d.id+'\')">归档</span>';
      act += ' <span class="link" onclick="delData(\''+d.id+'\')">删除</span>';
      return '<tr data-id=\"' + d.id + '\"><td><input type=\"checkbox\"></td><td>'+esc(d.name)+'<div class="small muted">组织：'+esc(d.org)+'</div></td><td>'+d.tags.map(function(t){return tag(t,'brand');}).join(' ')+'</td><td>'+st(d.status)+'</td><td>'+esc(d.time)+'</td><td class="row-actions">'+act+'</td></tr>';
    }).join('');
  }
}
function rMyReports(){
  var tb = document.getElementById('tbody-my-reports');
  if(tb){
    tb.innerHTML = DB.myReports.map(function(r){
      var act = '<div class="row-actions">'+link('版本',"versionCompare('"+r.id+"')")+' '+link('下载',"downloadFile('docx')")+' '+link('分享',"shareReport('"+r.id+"')")+'</div>';
      return '<tr><td>'+esc(r.name)+'<div class="small muted">分享：'+esc(r.share)+'</div></td><td>'+tag(r.type,'brand')+'</td><td class="num">'+esc(r.ver)+'</td><td>'+esc(r.time)+'</td><td>'+act+'</td></tr>';
    }).join('');
  }
}
function rPay(){
  var tb = document.getElementById('tbody-pay-orders');
  if(tb){
    tb.innerHTML = DB.orders.filter(function(o){return o.user==='user'||true;}).map(function(o){
      return '<tr><td>'+esc(o.id)+'</td><td class="num">'+money(o.amount)+'</td><td>'+esc(o.channel)+'</td><td>'+st(o.status)+'</td><td>'+esc(o.time)+'</td></tr>';
    }).join('');
  }
}
function rBilling(){
  var tb1 = document.getElementById('tbody-bill-orders');
  if(tb1){
    tb1.innerHTML = DB.orders.map(function(o){
      return '<tr><td>'+esc(o.id)+'</td><td>'+esc(o.title)+'</td><td class="num">'+money(o.amount)+'</td><td>'+st(o.status)+'</td><td>'+esc(o.time)+'</td><td><span class="link" onclick="openOrderDetail(\''+o.id+'\')">详情</span></td></tr>';
    }).join('');
  }
  var tb2 = document.getElementById('tbody-bill-flows');
  if(tb2){
    tb2.innerHTML = DB.payments.map(function(p){
      return '<tr><td>'+esc(p.id)+'</td><td>'+esc(p.channel)+'</td><td>'+esc(p.order)+'</td><td class="num">'+money(p.amount)+'</td><td>'+esc(p.time)+'</td><td>'+st(p.status)+'</td></tr>';
    }).join('');
  }
  var tb3 = document.getElementById('tbody-bill-invoices');
  if(tb3){
    tb3.innerHTML = DB.invoices.map(function(v){
      return '<tr><td>'+esc(v.id)+'</td><td>'+esc(v.order)+'</td><td class="num">'+esc(v.amount)+'</td><td>'+esc(v.type)+'</td><td>'+st(v.status)+'</td><td>'+esc(v.date)+'</td></tr>';
    }).join('');
  }
}

/* =========================================================
   管理端渲染函数
   ========================================================= */
function rDash(){
  var total = document.getElementById('dash-total-users');
  if(total){
    total.textContent = (12486 + DB.users.filter(function(u){return u.status==='正常';}).length).toLocaleString();
  }
  var imp = document.getElementById('dash-import-todo');
  if(imp){
    var n = DB.imports.filter(function(x){return x.status==='待审核';}).length;
    imp.innerHTML = '<article><span class="dot warn"></span><div><strong>数据接入审核待办 '+n+' 项</strong><div class="small muted">含 '+Math.max(0,n-1)+' 项超过 3 个工作日未处理（A-08）</div></div><span class="link" onclick="go(\'admin-imports\')">去处理</span></article>';
  }
  var kb = document.getElementById('dash-kb-todo');
  if(kb){
    var n = DB.kbReviewQueue.filter(function(x){return x.status==='待审核';}).length;
    kb.innerHTML = '<article><span class="dot"></span><div><strong>知识入库审核待办 '+n+' 项</strong><div class="small muted">自动入库内容待审核（A-16）</div></div><span class="link" onclick="go(\'admin-knowledge-review\')">去处理</span></article>';
  }
  var od = document.getElementById('dash-order-todo');
  if(od){
    var n = DB.orders.filter(function(x){return x.status==='待支付'||x.status==='回调异常';}).length;
    od.innerHTML = '<article><span class="dot info"></span><div><strong>待处理订单 '+n+' 项</strong><div class="small muted">含支付回调异常待人工排查（A-20）</div></div><span class="link" onclick="go(\'admin-orders\')">去处理</span></article>';
  }
}
function rUsers(){
  var tb = document.getElementById('tbody-users');
  if(tb){
    tb.innerHTML = DB.users.map(function(u){
      var act = '';
      act += link('编辑',"editUser('"+u.id+"')")+' ';
      if(u.status==='正常' && u.account!=='admin') act += link('禁用',"toggleUser('"+u.id+"')")+' ';
      if(u.status==='已禁用') act += link('启用',"toggleUser('"+u.id+"')")+' ';
      if(u.account!=='admin') act += link('重置密码',"resetPwd('"+u.id+"')");
      return '<tr><td>'+esc(u.account)+'</td><td>'+esc(u.name)+'</td><td>'+esc(u.org)+'</td><td>'+tag(u.role,u.role==='平台管理员'?'brand':'')+'</td><td>'+st(u.status)+'</td><td class="row-actions">'+act+'</td></tr>';
    }).join('');
  }
}
function rMembers(){
  var tb = document.getElementById('tbody-members');
  if(tb){
    tb.innerHTML = DB.members.map(function(m){
      return '<tr><td>'+esc(m.name)+'</td><td>'+esc(m.period)+'</td><td class="num">'+esc(m.price)+'</td><td>'+st(m.status)+'</td><td class="row-actions">'+link('编辑',"editMember('"+m.id+"')")+' '+link(m.status==='启用'?'停用':'启用',"toggleMember('"+m.id+"')")+'</td></tr>';
    }).join('');
  }
  var tb2 = document.getElementById('tbody-member-orders');
  if(tb2){
    tb2.innerHTML = DB.memberOrders.map(function(o){
      return '<tr><td>'+esc(o.user)+'</td><td>'+esc(o.level)+'</td><td class="num">'+esc(o.amount)+'</td><td>'+st(o.status)+'</td><td>'+esc(o.time)+'</td></tr>';
    }).join('');
  }
  var tl = document.getElementById('member-renew-list');
  if(tl){
    tl.innerHTML = DB.renews.map(function(r){
      var act = (r.status==='已提醒') ? '<span class="link" onclick="sendRenew(\''+r.id+'\')">提醒</span>' : (r.status==='待提醒' ? '<span class="link" onclick="sendRenew(\''+r.id+'\')">发送</span>' : '');
      return '<article><span class="dot '+(r.status==='已提醒'?'':'warn')+'"></span><div><strong>'+esc(r.user)+' · '+esc(r.level)+'</strong><div class="small muted">'+esc(r.due)+' 到期，剩余 '+esc(r.remain)+' · 状态：'+esc(r.status)+'</div></div>'+act+'</article>';
    }).join('');
  }
}
function rIndicators(){
  var tb = document.getElementById('tbody-indicators');
  if(tb){
    tb.innerHTML = DB.indicators.map(function(ind){
      return '<tr><td>'+esc(ind.code)+'</td><td>'+esc(ind.name)+'</td><td>'+esc(ind.unit)+'</td><td>'+esc(ind.source)+'</td><td>'+st(ind.status)+'</td><td class="row-actions">'+link('编辑',"editIndicator('"+ind.id+"')")+' '+link('来源映射',"mapIndicator('"+ind.id+"')")+' '+link(ind.status==='启用'?'停用':'启用',"toggleIndicator('"+ind.id+"')")+'</td></tr>';
    }).join('');
  }
  var tb2 = document.getElementById('tbody-mappings');
  if(tb2){
    tb2.innerHTML = DB.mappings.map(function(mp){
      return '<tr><td>'+esc(mp.src)+'</td><td>'+esc(mp.ind)+'</td><td class="small muted">'+esc(mp.note)+'</td><td class="row-actions">'+link('编辑',"editMapping('"+mp.id+"')")+'</td></tr>';
    }).join('');
  }
}
function rDicts(){
  var keys = Object.keys(DB.dicts);
  keys.forEach(function(key,i){
    var tb = document.getElementById('tbody-dict-'+key);
    if(tb){
      tb.innerHTML = DB.dicts[key].items.map(function(it){
        return '<tr><td>'+esc(it.code)+'</td><td>'+esc(it.name)+'</td><td class="small muted">'+esc(it.note)+'</td><td>'+st(it.status)+'</td><td class="row-actions">'+link('编辑',"editDictItem('"+key+"','"+esc(it.code)+"')")+' '+link(it.status==='启用'?'停用':'启用',"toggleDictItem('"+key+"','"+esc(it.code)+"')")+'</td></tr>';
      }).join('');
    }
  });
}
function rDatasets(){
  var tb = document.getElementById('tbody-datasets');
  if(tb){
    tb.innerHTML = DB.datasets.map(function(d){
      var act = link('详情',"viewDataset('"+d.id+"')")+' '+link('编辑',"editDataset('"+d.id+"')")+' '+(d.status==='已上架'?link('下架',"shelfDataset('"+d.id+"')"):link('上架',"shelfDataset('"+d.id+"')"));
      return '<tr><td>'+esc(d.name)+'<div class="small muted">'+esc(d.sub||'')+'</div></td><td>'+tag(d.src==='用户上传'?'数据接入审核':d.src,'brand')+'</td><td>'+esc(d.cat)+'</td><td class="num">'+d.rows+'</td><td>'+st(d.status)+'</td><td class="row-actions">'+act+'</td></tr>';
    }).join('');
  }
}
function rImports(){
  var tb = document.getElementById('tbody-imports');
  if(tb){
    tb.innerHTML = DB.imports.map(function(im){
      var act = link('预览',"previewImport('"+im.id+"')")+' ';
      if(im.status==='待审核') act += link('通过',"approveImport('"+im.id+"')")+' '+link('退回',"rejectImport('"+im.id+"')");
      else if(im.status==='已退回') act += link('通过',"approveImport('"+im.id+"')");
      return '<tr><td>'+esc(im.name)+'<div class="small muted">大小 '+esc(im.size)+'</div></td><td>'+tag(im.type)+'</td><td>'+esc(im.by)+'</td><td>'+esc(im.time)+'</td><td class="row-actions">'+act+'</td></tr>';
    }).join('');
  }
}
function rNotices(){
  var tb = document.getElementById('tbody-notices');
  if(tb){
    tb.innerHTML = DB.notices.map(function(n){
      var act = '';
      if(n.status==='已发布') act = link('撤回',"withdrawNotice('"+n.id+"')");
      else if(n.status==='已撤回') act = link('重新发布',"publishNoticeId('"+n.id+"')");
      else if(n.status==='草稿') act = link('编辑',"editNotice('"+n.id+"')")+' '+link('发布',"publishNoticeId('"+n.id+"')");
      return '<tr><td>'+esc(n.title)+'</td><td>'+tag(n.scope)+'</td><td>'+st(n.status)+'</td><td class="row-actions">'+act+'</td></tr>';
    }).join('');
  }
}
function rSearchOps(){
  var tb1 = document.getElementById('tbody-hotwords');
  if(tb1){
    tb1.innerHTML = DB.hotWords.map(function(h){
      var act = h.shortcut ? link('取消快捷',"setShortcut('"+h.id+"',false)") : link('设为快捷检索',"setShortcut('"+h.id+"',true)");
      return '<tr><td>'+h.rank+'</td><td>'+esc(h.word)+'</td><td class="num">'+h.count.toLocaleString()+'</td><td>'+st(h.trend)+'</td><td>'+act+'</td></tr>';
    }).join('');
  }
  var tb2 = document.getElementById('tbody-suggestions');
  if(tb2){
    tb2.innerHTML = DB.suggestions.map(function(s){
      var act = link(s.flag?('已标记：'+s.flag):'补充数据',"flagSuggestion('"+s.id+"','建议补充数据')")+' '+link('改进解析',"flagSuggestion('"+s.id+"','改进解析')");
      return '<tr><td>'+esc(s.word)+'</td><td>'+esc(s.date)+'</td><td class="num">'+s.cnt+'</td><td class="row-actions">'+act+'</td></tr>';
    }).join('');
  }
  var tb3 = document.getElementById('tbody-sensitive');
  if(tb3){
    tb3.innerHTML = DB.sensitive.map(function(w){
      return '<tr><td>'+esc(w.word)+'</td><td>'+tag(w.type)+'</td><td class="num">'+w.cnt+'</td><td>'+st(w.status)+'</td><td class="row-actions">'+link('编辑',"editSensitive('"+w.id+"')")+' '+link(w.status==='启用'?'停用':'启用',"toggleSensitive('"+w.id+"')")+'</td></tr>';
    }).join('');
  }
}
function rAdminTasks(){
  var tb = document.getElementById('tbody-admin-tasks');
  if(tb){
    tb.innerHTML = DB.tasks.map(function(t){
      var act = '';
      if(t.status==='执行中') act = link('终止',"stopTask('"+t.id+"')");
      else if(t.status==='失败') act = link('重试'+(t.retries?'('+t.retries+'/3)':''),"retryTask('"+t.id+"')");
      act += ' '+link('详情',"taskDetail('"+t.id+"')");
      return '<tr><td>'+esc(t.id)+'</td><td>'+tag(t.type,'brand')+'</td><td>'+esc(t.by)+'</td><td>'+st(t.status)+'</td><td><div class="progress" style="width:160px"><i style="width:'+t.progress+'%"></i></div><span class="pct">'+t.progress+'%</span></td><td>'+esc(t.created)+'</td><td class="row-actions">'+act+'</td></tr>';
    }).join('');
  }
  var tb2 = document.getElementById('tbody-task-logs');
  if(tb2){
    tb2.innerHTML = DB.taskLogs.map(function(l){
      return '<tr><td>'+esc(l.time)+'</td><td><span class="status danger">'+esc(l.level)+'</span></td><td class="small">'+esc(l.msg)+'</td></tr>';
    }).join('');
  }
}
function rConfig(){
  var tb = document.getElementById('tbody-config');
  if(tb){
    tb.innerHTML = DB.configs.map(function(cfg){
      return '<tr><td>'+esc(cfg.name)+'</td><td><div class="field" style="max-width:180px"><input class="input" id="cfg-'+esc(cfg.key)+'" value="'+esc(cfg.val)+'" style="min-height:34px"></div></td><td class="small muted">'+esc(cfg.desc)+'</td><td><span class="link" onclick="saveConfig(\''+esc(cfg.key)+'\')">保存</span></td></tr>';
    }).join('');
  }
}
function rAudit(){
  var tb1 = document.getElementById('tbody-audit-login');
  if(tb1){
    tb1.innerHTML = DB.audit.slice(0,4).map(function(a){
      return '<tr><td>'+esc(a.who)+'</td><td>'+esc(a.time)+'</td><td>'+esc(a.ip)+'</td><td>'+st(a.result)+'</td><td class="small">'+esc(a.action)+'</td></tr>';
    }).join('');
  }
  var tb2 = document.getElementById('tbody-audit-export');
  if(tb2){
    tb2.innerHTML = DB.exports.map(function(e){
      return '<tr><td>'+esc(e.time)+'</td><td>'+esc(e.name)+'</td><td>'+tag(e.type)+'</td><td>'+esc(e.size)+'</td><td>'+st(e.status)+'</td></tr>';
    }).join('');
  }
  var tb3 = document.getElementById('tbody-audit-report');
  if(tb3){
    tb3.innerHTML = DB.myReports.map(function(r){
      return '<tr><td>'+esc(r.time)+'</td><td>'+esc(r.name)+'</td><td>'+tag('报告')+'</td><td>'+st(r.status)+'</td></tr>';
    }).join('');
  }
}
function rMonitor(){
  var tb = document.getElementById('tbody-monitor');
  if(tb){
    tb.innerHTML = DB.monitors.map(function(m){
      return '<tr><td>'+esc(m.name)+'</td><td class="small muted">'+esc(m.url)+'</td><td>'+st(m.status)+'</td><td>'+esc(m.time)+'</td></tr>';
    }).join('');
  }
  var tb2 = document.getElementById('tbody-errors');
  if(tb2){
    tb2.innerHTML = DB.errors.map(function(e){
      return '<tr><td>'+esc(e.time)+'</td><td>'+esc(e.src)+'</td><td class="small">'+esc(e.msg)+'</td></tr>';
    }).join('');
  }
}
function rBackup(){
  var tb = document.getElementById('tbody-backup');
  if(tb){
    tb.innerHTML = DB.backups.map(function(b){
      return '<tr><td>'+esc(b.time)+'</td><td>'+esc(b.type)+'</td><td class="num">'+esc(b.size)+'</td><td>'+st(b.status)+'</td><td class="row-actions">'+link('恢复',"restoreBackup('"+b.id+"')")+'</td></tr>';
    }).join('');
  }
}
function rKbReview(){
  var tb = document.getElementById('tbody-kb-review');
  if(tb){
    tb.innerHTML = DB.kbReviewQueue.map(function(k){
      var act = '';
      if(k.status==='待审核') act = link('通过',"approveKb('"+k.id+"')")+' '+link('驳回',"rejectKb('"+k.id+"')");
      return '<tr><td>'+esc(k.title)+'</td><td>'+esc(k.owner)+'</td><td>'+tag(k.type==='Agent 生成'?'Agent 生成':'数据条目','brand')+'</td><td>'+esc(k.time)+'</td><td>'+st(k.status)+'</td><td class="row-actions">'+act+'</td></tr>';
    }).join('');
  }
}
function rKbCategory(){
  var tb1 = document.getElementById('tbody-kb-category');
  if(tb1){
    tb1.innerHTML = DB.kbCategories.map(function(c){
      return '<tr><td>'+c.id.replace('c','')+'</td><td>'+esc(c.name)+'</td><td class="num">'+c.sub+'</td><td>'+st(c.status)+'</td><td class="row-actions">'+link('编辑',"editCategory('"+c.id+"')")+' '+link('新增子级',"addSubCategory('"+c.id+"')")+' '+link(c.status==='启用'?'停用':'启用',"toggleCategory('"+c.id+"')")+'</td></tr>';
    }).join('');
  }
  var tb2 = document.getElementById('tbody-kb-tags');
  if(tb2){
    tb2.innerHTML = DB.kbTags.map(function(t){
      return '<tr><td>'+esc(t.name)+'</td><td class="num">'+t.cnt+'</td><td>'+st(t.status)+'</td><td class="row-actions">'+link('编辑',"editTag('"+t.id+"')")+' '+link(t.status==='启用'?'停用':'启用',"toggleTag('"+t.id+"')")+'</td></tr>';
    }).join('');
  }
}
function rKbPermission(){
  var tb = document.getElementById('tbody-kb-permission');
  if(tb){
    tb.innerHTML = DB.kbEntries.map(function(k){
      var act = link(k.scope==='公开'?'设为私有':"设为公开","toggleKbScope('"+k.id+"')");
      return '<tr><td>'+esc(k.title)+'</td><td>'+st(k.scope)+'</td><td class="small muted">'+esc(k.scope==='公开'?'所有用户':'指定组织/成员')+'</td><td class="row-actions">'+act+'</td></tr>';
    }).join('');
  }
}
function rKbIndex(){
  var tb = document.getElementById('tbody-kb-index');
  if(tb){
    tb.innerHTML = DB.kbIndexTasks.map(function(t){
      return '<tr><td>'+esc(t.id)+'</td><td>'+tag(t.type,'brand')+'</td><td>'+esc(t.time)+'</td><td>'+st(t.status)+'</td><td>'+esc(t.detail)+'</td><td><span class="link" onclick="taskDetail(\''+esc(t.id)+'\')">详情</span></td></tr>';
    }).join('');
  }
}
function rOrders(){
  var tb1 = document.getElementById('tbody-orders');
  if(tb1){
    tb1.innerHTML = DB.orders.map(function(o){
      var act = link('详情',"openOrderDetail('"+o.id+"')")+' ';
      if(o.status==='待支付') act += link('关闭',"closeOrder('"+o.id+"')");
      if(o.status==='回调异常') act += link('人工排查',"handleCallback('"+o.id+"')");
      if(o.status==='已支付') act += link('退款',"refundOrder('"+o.id+"')");
      return '<tr><td>'+esc(o.id)+'</td><td>'+esc(o.user)+'</td><td>'+esc(o.title)+'</td><td class="num">'+money(o.amount)+'</td><td>'+st(o.status)+'</td><td>'+esc(o.time)+'</td><td class="row-actions">'+act+'</td></tr>';
    }).join('');
  }
  var tb2 = document.getElementById('tbody-channels');
  if(tb2){
    tb2.innerHTML = DB.channels.map(function(ch){
      return '<tr><td>'+tag(ch.name,'brand')+'</td><td class="small">'+esc(ch.merchant)+'</td><td class="small muted">'+esc(ch.callback)+'</td><td>'+st(ch.status)+'</td><td class="row-actions">'+link('编辑',"editChannel('"+ch.id+"')")+' '+link(ch.status==='启用'?'停用':'启用',"toggleChannel('"+ch.id+"')")+'</td></tr>';
    }).join('');
  }
  var tb3 = document.getElementById('tbody-channels-key');
  if(tb3){
    tb3.innerHTML = DB.channels.map(function(ch){
      return '<tr><td>'+esc(ch.name)+'</td><td>'+st('已配置')+'</td><td>2026-06-01</td><td class="row-actions">'+link('更新密钥',"updateKey('"+ch.id+"')")+' '+link('密钥轮换',"rotateKey('"+ch.id+"')")+'</td></tr>';
    }).join('');
  }
}
/* =========================================================
   真实操作函数（替代 toast 占位） + 业务闭环
   ========================================================= */
function needAdmin(){
  if(SESSION && SESSION.user && SESSION.user.end==='admin') return true;
  toast('该操作需要管理员权限', 'danger'); return false;
}
function needUser(){
  if(SESSION && SESSION.user) return true;
  toast('请先登录', 'danger'); return false;
}
/* 表单弹窗：复用全局 modal，支持自定义确认回调 */
function formModal(title, bodyHtml, okLabel, onOk){
  window.__modalOnOk = onOk || null;
  var m = document.getElementById('modalMask');
  document.getElementById('modalTitle').textContent = title || '操作';
  document.getElementById('modalBody').innerHTML = bodyHtml || '';
  if(m){
    var foot = m.querySelector('.modal-foot');
    if(foot){ foot.style.display = ''; foot.innerHTML = '<button class="btn" onclick="closeModal()">取消</button><button class="btn primary" id="modalOK" onclick="modalOK()">确定</button>'; }
  }
  var ok = document.getElementById('modalOK');
  if(ok) ok.textContent = okLabel || '确定';
  if(m) m.classList.add('show');
}
function modalOK(){
  var fn = window.__modalOnOk;
  if(typeof fn === 'function'){ fn(); }
  closeModal();
}
function downloadFile(name){
  var d = document.createElement('a');
  var blob = new Blob(['\uFEFF演示文件内容：AI数智研究平台原型导出样例\n时间：'+nowStr()], {type:'text/plain;charset=utf-8'});
  d.href = URL.createObjectURL(blob);
  d.download = name || 'export.txt';
  document.body.appendChild(d); d.click(); d.remove();
  URL.revokeObjectURL(d.href);
  toast('已生成并开始下载：' + (name||'export.txt'));
}
function confirm2(msg, fn){
  formModal('二次确认', '<p style="line-height:1.8">'+esc(msg)+'</p>', '确认执行', function(){
    fn(); toast('操作已执行');
  });
}

/* ---------- 用户端操作 ---------- */
function pickFile(name){
  var t = document.getElementById('upFileName');
  if(!t){
    t = document.createElement('div'); t.id='upFileName';
    document.querySelector('#tab-up-excel .dropzone, #tab-up-csv .dropzone').appendChild(t);
  }
  t.innerHTML = '<div class="small muted" style="margin-top:4px">已选择：<b style="color:var(--brand)">'+esc(name)+'</b></div>';
  toast('已选择文件：'+name);
}
function testDbConn(){
  var el = document.getElementById('dbConnResult');
  if(!el){
    el = document.createElement('div'); el.id='dbConnResult';
    var dz = document.querySelector('#tab-up-db .flex.between'); dz && dz.insertAdjacentElement('afterend', el);
  }
  el.className='alert success mt12'; el.style.marginTop='12px';
  el.innerHTML = '<svg width="14" height="14" style="vertical-align:-2px"><use href="#i-check"></use></svg> 数据库连接测试成功：10.20.30.40:3306/research_db（延迟 32ms）';
  toast('数据库连接测试成功');
}
function submitImport(type){
  if(!needUser()) return;
  var name = type==='Excel' ? '2025年宏观数据' : (type==='CSV' ? '进出口贸易数据' : (type==='数据库' ? '生产库-经营数据' : '外部指标接口'));
  DB.imports.unshift({id:'IM-'+(1000+DB.imports.length+1), name:name, type:type, size:type==='Excel'?'2.4 MB':(type==='CSV'?'856 KB':'—'), by:SESSION.user.account, time:nowStr(), status:'待审核', reason:''});
  DB.myData.unshift({id:'md'+Date.now(), name:name, org:'智库研究部', tags:[type], status:'审核中', time:nowStr()});
  rUpload();
  toast('已提交，等待管理端审核（A-08）');
}
function withdrawImport(id){
  var im = DB.imports.find(function(x){return x.id===id;}); if(!im) return;
  im.status = '已撤回'; rUpload();
  toast('已撤回本次提交');
}
function resubmitImport(id){
  var im = DB.imports.find(function(x){return x.id===id;}); if(!im) return;
  im.status = '待审核'; im.time = nowStr(); rUpload();
  toast('已重新提交，等待审核');
}
function applyShortcut(word){
  var box = document.querySelector('#view-global-search .search-box input');
  if(box) box.value = word;
  toast('已应用快捷检索词：'+word);
}
function aiParse(){
  toast('AI 解析中…已生成检索条件');
  setTimeout(function(){ toast('解析完成：指标 GDP 增长率 / 地区 中国、美国 / 时间 2020-2025'); }, 600);
}
function toggleParseEdit(){
  toast('已进入编辑模式，可直接修改解析条件');
}
function clearHistory(){
  DB.searchHistory = [];
  rGlobalSearch();
  toast('已清空历史记录');
}
function resetSearch(){ toast('已重置检索条件'); }
function rerunSearch(){
  toast('已重新并行检索，3 个数据源同步返回');
  setTimeout(function(){ toast('检索完成：共命中 2,222 条'); }, 800);
}
function refreshTasks(){
  var n = Math.floor(Math.random()*3);
  toast('已刷新任务列表（新增 '+n+' 条动态）');
  var view = document.querySelector('#view-task-control, #view-admin-tasks');
  if(view && view.id==='view-admin-tasks') rAdminTasks(); else rTaskControl();
}
function stopTask(id){
  if(!needAdmin() && !needUser()) return;
  var t = DB.tasks.find(function(x){return x.id===id;}); if(!t) return;
  confirm2('终止任务 '+id+' 不可恢复，确认终止？', function(){
    t.status = '已终止'; t.progress = t.progress; rAdminTasks(); rTaskControl();
  });
}
function retryTask(id){
  var t = DB.tasks.find(function(x){return x.id===id;}); if(!t) return;
  t.status = '执行中'; t.progress = Math.min(95, t.progress+15); t.created = nowStr();
  rAdminTasks(); rTaskControl();
  toast('已触发重试：'+id);
}
function taskDetail(id){
  var t = DB.tasks.find(function(x){return x.id===id;});
  formModal('任务详情：'+id, t?('<p>任务类型：'+esc(t.type)+'<br>创建人：'+esc(t.by)+'<br>状态：'+esc(t.status)+'（进度 '+t.progress+'%）<br>创建时间：'+esc(t.created)+'</p><div class="alert info"><svg width="14" height="14" style="vertical-align:-2px"><use href="#i-alert"></use></svg> 任务执行日志见下方「错误日志」区域（A-14）</div>'):'<p>任务不存在</p>', '关闭', null);
}
function exportFiltered(){ downloadFile('筛选结果.csv'); }
function regenerateInsight(){ toast('已重新生成 AI 解读（基于最新数据）'); }
var CHART_TYPE = 'line';
function renderChart(type){
  CHART_TYPE = type;
  var el = document.getElementById('analysis-chart');
  var labels = {line:'折线图（时间趋势）', bar:'柱状图（地区对比）', pie:'饼图（构成占比）', scatter:'散点图（相关性）'};
  if(el){
    if(type==='line'){
      el.innerHTML = '<svg width="100%" height="120" viewBox="0 0 300 120" style="max-width:420px"><polyline points="10,80 60,60 110,70 160,40 210,50 260,20 290,30" fill="none" stroke="#16675f" stroke-width="2.5"/><circle cx="10" cy="80" r="3" fill="#16675f"/><circle cx="60" cy="60" r="3" fill="#16675f"/><circle cx="110" cy="70" r="3" fill="#16675f"/><circle cx="160" cy="40" r="3" fill="#16675f"/><circle cx="210" cy="50" r="3" fill="#16675f"/><circle cx="260" cy="20" r="3" fill="#16675f"/><circle cx="290" cy="30" r="3" fill="#16675f"/></svg>';
    } else if(type==='bar'){
      el.innerHTML = '<div class="mini-bar" style="min-height:120px">'+[35,48,42,60,54,72,80].map(function(b){return '<i style="height:'+b+'%"></i>';}).join('')+'</div>';
    } else if(type==='pie'){
      el.innerHTML = '<div style="display:flex;align-items:center;gap:18px"><svg width="120" height="120" viewBox="0 0 36 36"><circle cx="18" cy="18" r="15.9" fill="#e7f2f0"/><path d="M18 2.1 A15.9 15.9 0 0 1 30.8 9.5 L18 18 Z" fill="#16675f"/><path d="M30.8 9.5 A15.9 15.9 0 0 1 18 33.9 L18 18 Z" fill="#aa6b18"/><path d="M18 33.9 A15.9 15.9 0 0 1 2.1 18 L18 18 Z" fill="#356d93"/><path d="M2.1 18 A15.9 15.9 0 0 1 18 2.1 L18 18 Z" fill="#7a5c8e"/></svg><div class="small muted">中国 42% · 美国 31% · 其他 27%</div></div>';
    } else {
      el.innerHTML = '<svg width="260" height="120" viewBox="0 0 260 120"><g fill="#16675f" opacity=".65">'+[ [30,60],[70,40],[110,70],[150,30],[190,55],[230,45] ].map(function(p){return '<circle cx="'+p[0]+'" cy="'+p[1]+'" r="5"/>';}).join('')+'</g></svg>';
    }
  }
  document.querySelectorAll('#view-result-analysis .btn.sm').forEach(function(b){
    b.classList.remove('primary');
    if(b.textContent.indexOf(labels[type].charAt(0))>-1 || b.textContent.indexOf(labels[type])>-1) b.classList.add('primary');
  });
  toast('已生成'+labels[type]);
}
function doExport(kind){
  downloadFile(kind==='csv'?'数据导出.csv':'数据图表.png');
  toast(kind==='csv'?'CSV 导出成功，已开始下载':'PNG 导出成功，已开始下载');
}
function createReportTask(){
  if(!needUser()) return;
  var id = 'T-'+nowStr().replace(/[-: ]/g,'')+'-RP';
  DB.tasks.unshift({id:id, type:'报告生成', by:SESSION.user.account, status:'执行中', progress:5, created:nowStr()});
  rAiReport(); rAdminTasks();
  toast('报告生成任务已创建：'+id+'，可在任务中心查看进度');
}
function saveReportDraft(){ toast('已保存草稿'); }
function sendAgentCmd(){
  if(!needUser()) return;
  var id = 'T-'+nowStr().replace(/[-: ]/g,'')+'-AG';
  DB.tasks.unshift({id:id, type:'报告生成', by:SESSION.user.account, status:'执行中', progress:10, created:nowStr()});
  rAdminTasks();
  toast('Agent 已接收指令，任务进入任务中心：'+id);
}
function clearChat(){ toast('已清空对话'); }
function stopAgentTask(){ toast('已终止当前生成任务'); }
function agentOutput(){ downloadFile('生成报告.docx'); toast('生成结果已按所选格式输出'); }
function recheckRefs(){ toast('已触发引用重新校验'); }
function refreshKb(){ rKbAchievements(); rKbIngest(); rKbManage(); toast('已刷新成果列表'); }
function openKbDetail(id){
  var k = DB.kbEntries.find(function(x){return x.id===id;});
  if(k) formModal('成果详情', '<p style="line-height:1.8"><b>'+esc(k.title)+'</b><br>类型：'+esc(k.type)+' · 作者：'+esc(k.owner)+'<br>入库时间：'+esc(k.time)+' · 匹配度：'+k.score.toFixed(2)+'</p><div class="alert info"><svg width="14" height="14" style="vertical-align:-2px"><use href="#i-alert"></use></svg> 完整报告内容与数据溯源见正文。</div>', '关闭', null);
}
function startReview(){ toast('开始复核：核对数据、结论、引用'); }
function editKb(id){ toast('已进入编辑模式：'+id); }
function saveIngestRule(){ doSaveIngestRule(); }
function ingestSelected(){
  if(!needUser()) return;
  var title = '知识条目-'+(DB.kbReviewQueue.length+1);
  DB.kbReviewQueue.unshift({id:'kq'+Date.now(), title:title, owner:SESSION.user.name, type:'数据条目', time:nowStr(), status:'待审核'});
  DB.kbEntries.unshift({id:'k'+Date.now(), title:title, type:'数据条目', owner:SESSION.user.name, time:nowStr(), status:'待审核', score:0.0, scope:'私有'});
  rKbIngest();
  toast('已对选中内容执行一键入库，等待管理端审核（A-16）');
}
function openTrace(){ toast('已打开溯源链路'); }
function modifyTag(){ toast('已修改标签'); }
function savePriority(){ toast('匹配规则已保存'); }
function rerunMatch(){ toast('已重新执行匹配演示'); }
function newKbEntry(){
  formModal('新建知识条目', '<div class="field mb12"><label>标题</label><input class="input" id="kbTitle" placeholder="请输入条目标题"></div><div class="field mb12"><label>类型</label><select class="select" id="kbType"><option>数据条目</option><option>报告摘要</option><option>图表</option></select></div><div class="field"><label>标签</label><input class="input" placeholder="多个标签用逗号分隔"></div>', '创建', function(){
    var t = document.getElementById('kbTitle'); if(!t || !t.value.trim()){ toast('请填写标题','warning'); return; }
    DB.kbEntries.unshift({id:'k'+Date.now(), title:t.value.trim(), type:'数据条目', owner:SESSION.user.name, time:nowStr(), status:'待审核', score:0, scope:'私有'});
    rKbManage(); rKbIngest();
    toast('已创建知识条目，待管理端审核');
  });
}
function toggleKbScope(id){
  var k = DB.kbEntries.find(function(x){return x.id===id;}); if(!k) return;
  var to = k.scope==='公开' ? '私有' : '公开';
  confirm2('切换为「'+to+'」后，原分享链接对未授权用户失效。确认切换？', function(){
    k.scope = to; rKbManage(); rKbPermission();
    toast('已设为'+to);
  });
}
function editTags(id){
  var d = DB.myData.find(function(x){return x.id===id;});
  formModal('编辑标签', '<div class="field"><label>标签（逗号分隔）</label><input class="input" id="mdTags" value="'+(d?esc(d.tags.join(',')):'')+'"></div>', '保存', function(){
    var inp = document.getElementById('mdTags');
    if(d && inp){ d.tags = inp.value.split(/[,，]/).map(function(s){return s.trim();}).filter(Boolean); rMyData(); toast('已更新标签'); }
  });
}
function archiveData(id){ var d=DB.myData.find(function(x){return x.id===id;}); if(d){ d.status='已归档'; rMyData(); toast('已归档，可恢复'); } }
function delData(id){
  confirm2('数据被引用/参与报告时删除需二次确认并提示影响范围；删除为软删除可恢复。确认删除？', function(){
    DB.myData = DB.myData.filter(function(x){return x.id!==id;});
    rMyData(); toast('已删除（软删除，进回收站）');
  });
}
function restoreData(id){ var d=DB.myData.find(function(x){return x.id===id;}); if(d){ d.status='已上架'; rMyData(); toast('已取消归档'); } }
function exportMyData(){ downloadFile('我的数据清单.csv'); toast('已导出数据清单'); }
function deleteSelectedData(){
  var checked = document.querySelectorAll('#tbody-my-data input:checked');
  if(!checked.length){ toast('请先勾选要删除的数据','warning'); return; }
  confirm2('删除所选 '+checked.length+' 条数据（软删除，可恢复）？', function(){
    var ids = Array.prototype.map.call(checked, function(c){ return c.closest('tr').dataset.id; });
    DB.myData = DB.myData.filter(function(d){ return ids.indexOf(d.id)<0; });
    rMyData(); toast('已删除所选数据（可恢复）');
  });
}
function archiveSelectedData(){
  var checked = document.querySelectorAll('#tbody-my-data input:checked');
  if(!checked.length){ toast('请先勾选要归档的数据','warning'); return; }
  var ids = Array.prototype.map.call(checked, function(c){ return c.closest('tr').dataset.id; });
  DB.myData.forEach(function(d){ if(ids.indexOf(d.id)>=0) d.status='已归档'; });
  rMyData(); toast('已归档所选数据');
}
function versionCompare(){
  var tb = document.getElementById('tbody-report-versions');
  if(tb){
    tb.innerHTML = DB.reportVersions.map(function(v){
      return '<tr><td>'+esc(v.name)+'</td><td class="num">'+esc(v.ver)+'</td><td>'+esc(v.time)+'</td><td class="small muted">'+esc(v.note)+'</td><td class="row-actions">'+link('回滚到此版本',"rollbackReport('"+v.ver+"')")+'</td></tr>';
    }).join('');
  }
  toast('已打开版本列表');
}
function rollbackReport(ver){
  confirm2('回滚到 '+ver+' 将覆盖当前版本，确认？', function(){
    toast('已回滚到 '+ver);
  });
}
function restoreReport(){ toast('已恢复 v1'); }
function copyLink(){ navigator.clipboard && navigator.clipboard.writeText('https://research.example.com/s/abc123').then(function(){ toast('链接已复制'); }); }
function shareReport(id){ toast('已打开分享设置：'+id); }
function editReport(id){ toast('已进入编辑：'+id); }


/* ===== 管理端/用户端真实功能增强（合并模块1） ===== */
/* =========================================================
   追加模块：渲染修正 + 管理端/用户端真实操作函数
   （依据 PRD 37 功能点，保证闭环，无新增/删减功能）
   ========================================================= */
(function(){
  var catMap={
    ind1:['宏观经济','不变价 GDP 同比增长率'],
    ind2:['物价','居民消费价格指数（CPI）同比'],
    ind3:['行业景气','制造业采购经理指数'],
    ind4:['能源','规模以上工业发电量'],
    ind5:['对外贸易','海关统计出口总额']
  };
  DB.indicators.forEach(function(i){ var c=catMap[i.id]||['未分类','—']; i.cat=c[0]; i.def=c[1]; });
  DB.mappings.forEach(function(m){ if(!m.status) m.status='启用'; });
  DB.auditLogin=[
    {who:'li_research', time:'2026-08-10 09:11:02', ip:'192.168.1.12', result:'成功'},
    {who:'admin',       time:'2026-08-10 08:30:11', ip:'10.0.0.8',     result:'成功'},
    {who:'data_zhang',  time:'2026-08-09 17:40:22', ip:'10.0.0.15',    result:'失败'},
    {who:'user',        time:'2026-08-09 15:21:08', ip:'192.168.1.55', result:'成功'}
  ];
  DB.auditExport=[
    {who:'li_research', name:'中美 GDP 增长率对比', type:'CSV', time:'2026-08-10 10:32'},
    {who:'chen_data',   name:'各省 PMI 指数',       type:'PNG', time:'2026-08-09 16:12'},
    {who:'data_zhang',  name:'生产库-经营数据',     type:'CSV', time:'2026-08-08 09:20'}
  ];
  DB.auditReport=[
    {who:'li_research', obj:'中美GDP增长率对比分析报告', type:'报告删除', time:'2026-08-09 18:02'},
    {who:'user',        obj:'2024 能源消费结构',         type:'数据删除', time:'2026-08-08 15:40'}
  ];
})();
function rIndicators(){
  var tb=document.getElementById('tbody-indicators');
  if(tb){
    tb.innerHTML=DB.indicators.map(function(ind){
      var act=link('编辑',"editIndicator('"+ind.id+"')")+' '+link('来源映射',"mapIndicator('"+ind.id+"')")+' '+link(ind.status==='启用'?'停用':'启用',"toggleIndicator('"+ind.id+"')");
      return '<tr><td>'+esc(ind.code)+'</td><td>'+esc(ind.name)+'</td><td>'+esc(ind.cat||'—')+'</td><td>'+esc(ind.unit)+'</td><td class="small muted">'+esc(ind.def||'—')+'</td><td>'+tag(ind.source,'brand')+'</td><td class="row-actions">'+act+'</td></tr>';
    }).join('');
  }
  var tb2=document.getElementById('tbody-mappings');
  if(tb2){
    tb2.innerHTML=DB.mappings.map(function(mp){
      return '<tr><td>'+esc(mp.src)+'</td><td class="small">'+esc(mp.ind)+'</td><td class="small muted">'+esc(mp.note)+'</td><td>'+st(mp.status)+'</td><td class="row-actions">'+link('编辑',"editMapping('"+mp.id+"')")+'</td></tr>';
    }).join('');
  }
}
function rAdminTasks(){
  var tb=document.getElementById('tbody-admin-tasks');
  if(tb){
    tb.innerHTML=DB.tasks.map(function(t){
      var act='';
      if(t.status==='执行中') act=link('终止',"stopTask('"+t.id+"')");
      else if(t.status==='失败') act=link('重试',"retryTask('"+t.id+"')");
      act+=' '+link('详情',"taskDetail('"+t.id+"')");
      return '<tr><td>'+esc(t.id)+'</td><td>'+tag(t.type,'brand')+'</td><td>'+esc(t.by)+'</td><td>'+st(t.status)+'</td><td><div class="progress" style="width:120px"><i style="width:'+t.progress+'%"></i></div><span class="pct">'+t.progress+'%</span></td><td class="row-actions">'+act+'</td></tr>';
    }).join('');
  }
  var tb2=document.getElementById('tbody-task-logs');
  if(tb2){
    tb2.innerHTML=DB.taskLogs.map(function(l){
      return '<tr><td>'+esc(l.time)+'</td><td><span class="status danger">'+esc(l.level)+'</span></td><td class="small">'+esc(l.msg)+'</td></tr>';
    }).join('');
  }
}
function rKbIndex(){
  var tb=document.getElementById('tbody-kb-index');
  if(tb){
    tb.innerHTML=DB.kbIndexTasks.map(function(t){
      return '<tr><td>'+esc(t.id)+'<div class="small muted">'+esc(t.detail||'')+'</div></td><td>'+tag(t.type,'brand')+'</td><td>'+esc(t.time)+'</td><td>'+st(t.status)+'</td><td class="row-actions">'+link('详情',"taskDetail('"+esc(t.id)+"')")+'</td></tr>';
    }).join('');
  }
}
function rAudit(){
  var tb1=document.getElementById('tbody-audit-login');
  if(tb1){
    tb1.innerHTML=DB.auditLogin.map(function(a){
      return '<tr><td>'+esc(a.who)+'</td><td>'+esc(a.time)+'</td><td>'+esc(a.ip)+'</td><td>'+st(a.result)+'</td></tr>';
    }).join('');
  }
  var tb2=document.getElementById('tbody-audit-export');
  if(tb2){
    tb2.innerHTML=DB.auditExport.map(function(e){
      return '<tr><td>'+esc(e.who)+'</td><td>'+esc(e.name)+'</td><td>'+tag(e.type==='PNG'?'PNG':'CSV',e.type==='PNG'?'':'brand')+'</td><td>'+esc(e.time)+'</td></tr>';
    }).join('');
  }
  var tb3=document.getElementById('tbody-audit-report');
  if(tb3){
    tb3.innerHTML=DB.auditReport.map(function(r){
      return '<tr><td>'+esc(r.who)+'</td><td>'+esc(r.obj)+'</td><td>'+tag(r.type)+'</td><td>'+esc(r.time)+'</td></tr>';
    }).join('');
  }
}
function taskDetail(id){
  var t=DB.tasks.find(function(x){return x.id===id;})||DB.kbIndexTasks.find(function(x){return x.id===id;});
  var extra=t&&t.detail?('<br>执行说明：'+esc(t.detail)):'';
  formModal('任务详情：'+id, t?('<p>任务类型：'+esc(t.type)+'<br>创建人：'+esc(t.by||'系统')+'<br>状态：'+esc(t.status)+'（进度 '+(t.progress||0)+'%）<br>创建时间：'+esc(t.created||t.time||'')+extra+'</p><div class="alert info"><svg width="14" height="14" style="vertical-align:-2px"><use href="#i-alert"></use></svg> 任务执行日志见「错误日志」区域（A-14）。</div>'):'<p>任务不存在</p>', '关闭', null);
}function addUser(){
  if(!needAdmin()) return;
  formModal('新增用户', '<div class="field mb12"><label>账号</label><input class="input" id="f_account" placeholder="登录账号"></div><div class="field mb12"><label>姓名</label><input class="input" id="f_name"></div><div class="field mb12"><label>所属组织</label><input class="input" id="f_org"></div><div class="field"><label>角色</label><select class="select" id="f_role"><option>普通用户</option><option>数据管理员</option><option>平台管理员</option></select></div>', '创建', function(){
    var acc=document.getElementById('f_account'), name=document.getElementById('f_name');
    if(!acc||!acc.value.trim()||!name||!name.value.trim()){ toast('请填写账号与姓名','warning'); return; }
    DB.users.push({id:'u'+Date.now(), account:acc.value.trim(), name:name.value.trim(), org:(document.getElementById('f_org').value||'平台用户'), role:document.getElementById('f_role').value, status:'正常'});
    rUsers(); toast('已新增用户：'+acc.value.trim()+'（A-01）');
  });
}
function editUser(id){
  var u=DB.users.find(function(x){return x.id===id;}); if(!u) return;
  formModal('编辑用户', '<div class="field mb12"><label>账号</label><input class="input" value="'+esc(u.account)+'" disabled></div><div class="field mb12"><label>姓名</label><input class="input" id="f_name" value="'+esc(u.name)+'"></div><div class="field mb12"><label>所属组织</label><input class="input" id="f_org" value="'+esc(u.org)+'"></div><div class="field"><label>角色</label><select class="select" id="f_role"><option'+(u.role==='普通用户'?' selected':'')+'>普通用户</option><option'+(u.role==='数据管理员'?' selected':'')+'>数据管理员</option><option'+(u.role==='平台管理员'?' selected':'')+'>平台管理员</option></select></div>', '保存', function(){
    u.name=document.getElementById('f_name').value; u.org=document.getElementById('f_org').value; u.role=document.getElementById('f_role').value;
    rUsers(); toast('已保存用户修改');
  });
}
function toggleUser(id){
  var u=DB.users.find(function(x){return x.id===id;}); if(!u) return;
  var to=u.status==='正常'?'已禁用':'正常';
  confirm2('确认'+to+'用户「'+u.name+'」？', function(){ u.status=to; rUsers(); toast('已'+to+'用户：'+u.name); });
}
function resetPwd(id){
  var u=DB.users.find(function(x){return x.id===id;}); if(!u) return;
  formModal('重置密码', '<p>将用户「'+esc(u.name)+'」密码重置为初始密码 <b>123456</b>，该用户下次登录后需修改。确认重置？</p>', '确认重置', function(){
    toast('已重置用户「'+u.name+'」密码为 123456');
  });
}
function addMember(){
  if(!needAdmin()) return;
  formModal('新增会员等级', '<div class="field mb12"><label>等级名称</label><input class="input" id="f_mname" placeholder="如 旗舰版"></div><div class="field mb12"><label>有效期</label><input class="input" id="f_mperiod" placeholder="月 / 季 / 年"></div><div class="field"><label>价格</label><input class="input" id="f_mprice" placeholder="如 ¥ 599 / 年"></div>', '创建', function(){
    var n=document.getElementById('f_mname');
    if(!n||!n.value.trim()){ toast('请填写等级名称','warning'); return; }
    DB.members.push({id:'m'+Date.now(), name:n.value.trim(), period:document.getElementById('f_mperiod').value||'年', price:document.getElementById('f_mprice').value||'¥ —', status:'启用'});
    rMembers(); toast('已新增会员等级：'+n.value.trim());
  });
}
function editMember(id){
  var m=DB.members.find(function(x){return x.id===id;}); if(!m) return;
  formModal('编辑会员等级', '<div class="field mb12"><label>等级名称</label><input class="input" id="f_mname" value="'+esc(m.name)+'"></div><div class="field mb12"><label>有效期</label><input class="input" id="f_mperiod" value="'+esc(m.period)+'"></div><div class="field"><label>价格</label><input class="input" id="f_mprice" value="'+esc(m.price)+'"></div>', '保存', function(){
    m.name=document.getElementById('f_mname').value; m.period=document.getElementById('f_mperiod').value; m.price=document.getElementById('f_mprice').value;
    rMembers(); toast('已保存会员等级');
  });
}
function toggleMember(id){
  var m=DB.members.find(function(x){return x.id===id;}); if(!m) return;
  var to=m.status==='启用'?'停用':'启用';
  confirm2('确认'+to+'会员等级「'+m.name+'」？', function(){ m.status=to; rMembers(); toast('已'+to+'：'+m.name); });
}
function sendRenew(id){
  var r=DB.renews.find(function(x){return x.id===id;}); if(!r) return;
  r.status='已提醒'; rMembers(); toast('已向 '+r.user+' 发送续费提醒（'+r.level+'）');
}
function batchRenew(){
  DB.renews.forEach(function(r){ if(r.status!=='已提醒') r.status='已提醒'; });
  rMembers(); toast('已批量发起续费提醒（'+DB.renews.length+' 人）');
}
function addIndicator(){
  if(!needAdmin()) return;
  formModal('新增指标', '<div class="field mb12"><label>指标编码</label><input class="input" id="f_code" placeholder="如 GDP_GROWTH"></div><div class="field mb12"><label>指标名称</label><input class="input" id="f_iname"></div><div class="field mb12"><label>分类</label><input class="input" id="f_icat"></div><div class="field"><label>单位</label><input class="input" id="f_iunit"></div>', '创建', function(){
    var c=document.getElementById('f_code');
    if(!c||!c.value.trim()){ toast('请填写指标编码','warning'); return; }
    DB.indicators.push({id:'ind'+Date.now(), code:c.value.trim().toUpperCase(), name:document.getElementById('f_iname').value||c.value.trim(), cat:document.getElementById('f_icat').value||'未分类', def:'—', unit:document.getElementById('f_iunit').value||'—', source:'待配置', status:'启用'});
    rIndicators(); toast('已新增指标：'+c.value.trim());
  });
}
function editIndicator(id){
  var ind=DB.indicators.find(function(x){return x.id===id;}); if(!ind) return;
  formModal('编辑指标', '<div class="field mb12"><label>指标名称</label><input class="input" id="f_iname" value="'+esc(ind.name)+'"></div><div class="field mb12"><label>分类</label><input class="input" id="f_icat" value="'+esc(ind.cat)+'"></div><div class="field mb12"><label>单位</label><input class="input" id="f_iunit" value="'+esc(ind.unit)+'"></div><div class="field"><label>定义/口径</label><input class="input" id="f_idef" value="'+esc(ind.def||'')+'"></div>', '保存', function(){
    ind.name=document.getElementById('f_iname').value; ind.cat=document.getElementById('f_icat').value; ind.unit=document.getElementById('f_iunit').value; ind.def=document.getElementById('f_idef').value;
    rIndicators(); toast('已保存指标');
  });
}
function toggleIndicator(id){
  var ind=DB.indicators.find(function(x){return x.id===id;}); if(!ind) return;
  var to=ind.status==='启用'?'停用':'启用';
  confirm2('确认'+to+'指标「'+ind.name+'」？停用不影响历史数据。', function(){ ind.status=to; rIndicators(); toast('已'+to+'：'+ind.name); });
}
function mapIndicator(id){
  var ind=DB.indicators.find(function(x){return x.id===id;}); if(!ind) return;
  var rows=DB.mappings.filter(function(m){return m.ind===ind.code;});
  var list=rows.length?rows.map(function(m){return '<li>'+esc(m.src)+' → '+esc(m.ind)+'（'+esc(m.note)+'）</li>';}).join(''):'<li class="muted">暂无映射</li>';
  formModal('来源映射 · '+ind.code, '<p class="small muted">'+esc(ind.name)+'（'+esc(ind.unit)+'）当前映射：</p><ul style="line-height:1.9;padding-left:18px">'+list+'</ul><div class="alert info"><svg width="14" height="14" style="vertical-align:-2px"><use href="#i-alert"></use></svg> 支撑全维度数据标准化（U-04），可在下方新增映射。</div>', '新增映射', function(){
    formModal('新增映射', '<div class="field mb12"><label>数据源</label><input class="input" id="f_msrc" placeholder="如 世界银行 WDI"></div><div class="field mb12"><label>来源字段</label><input class="input" id="f_mind" placeholder="如 NY.GDP.MKTP.KD.ZG"></div><div class="field"><label>换算/处理</label><input class="input" id="f_mnote" placeholder="直接映射 / 百分比转换"></div>', '保存', function(){
      var s=document.getElementById('f_msrc');
      if(!s||!s.value.trim()){ toast('请填写数据源','warning'); return; }
      DB.mappings.push({id:'im'+Date.now(), src:s.value.trim(), ind:document.getElementById('f_mind').value||ind.code, note:document.getElementById('f_mnote').value||'直接映射', status:'启用'});
      rIndicators(); toast('已新增映射关系');
    });
  });
}
function addMapping(){
  formModal('新增映射', '<div class="field mb12"><label>数据源</label><input class="input" id="f_msrc" placeholder="如 IMF 世界经济展望"></div><div class="field mb12"><label>来源字段</label><input class="input" id="f_mind" placeholder="如 NGDP_RPCH"></div><div class="field"><label>换算/处理</label><input class="input" id="f_mnote" placeholder="直接映射 / 百分比转换"></div>', '保存', function(){
    var s=document.getElementById('f_msrc');
    if(!s||!s.value.trim()){ toast('请填写数据源','warning'); return; }
    DB.mappings.push({id:'im'+Date.now(), src:s.value.trim(), ind:document.getElementById('f_mind').value||'—', note:document.getElementById('f_mnote').value||'直接映射', status:'启用'});
    rIndicators(); toast('已新增映射关系');
  });
}
function editMapping(id){
  var mp=DB.mappings.find(function(x){return x.id===id;}); if(!mp) return;
  formModal('编辑映射', '<div class="field mb12"><label>数据源</label><input class="input" id="f_msrc" value="'+esc(mp.src)+'"></div><div class="field mb12"><label>来源字段</label><input class="input" id="f_mind" value="'+esc(mp.ind)+'"></div><div class="field"><label>换算/处理</label><input class="input" id="f_mnote" value="'+esc(mp.note)+'"></div>', '保存', function(){
    mp.src=document.getElementById('f_msrc').value; mp.ind=document.getElementById('f_mind').value; mp.note=document.getElementById('f_mnote').value;
    rIndicators(); toast('已保存映射');
  });
}
function addDictItem(){
  var openTab='country';
  document.querySelectorAll('#view-admin-dicts .tab.active').forEach(function(t){ if(t.getAttribute('onclick')) openTab=t.getAttribute('onclick').match(/'([^']+)'/)[1]; });
  var keyMap={'dict-region':'country','dict-org':'source','dict-industry':'industry','dict-unit':'unit','dict-time':'period'};
  var key=keyMap[openTab]||'country';
  formModal('新增字典项 · '+DB.dicts[key].name, '<div class="field mb12"><label>编码</label><input class="input" id="f_dcode"></div><div class="field mb12"><label>名称</label><input class="input" id="f_dname"></div><div class="field"><label>说明</label><input class="input" id="f_dnote"></div>', '保存', function(){
    var c=document.getElementById('f_dcode');
    if(!c||!c.value.trim()){ toast('请填写编码','warning'); return; }
    DB.dicts[key].items.push({code:c.value.trim(), name:document.getElementById('f_dname').value||c.value.trim(), note:document.getElementById('f_dnote').value||'—', status:'启用'});
    rDicts(); toast('已新增字典项');
  });
}
function editDictItem(key,code){
  var it=DB.dicts[key].items.find(function(x){return x.code===code;}); if(!it) return;
  formModal('编辑字典项', '<div class="field mb12"><label>编码</label><input class="input" value="'+esc(it.code)+'" disabled></div><div class="field mb12"><label>名称</label><input class="input" id="f_dname" value="'+esc(it.name)+'"></div><div class="field"><label>说明</label><input class="input" id="f_dnote" value="'+esc(it.note)+'"></div>', '保存', function(){
    it.name=document.getElementById('f_dname').value; it.note=document.getElementById('f_dnote').value;
    rDicts(); toast('已保存字典项');
  });
}
function toggleDictItem(key,code){
  var it=DB.dicts[key].items.find(function(x){return x.code===code;}); if(!it) return;
  var to=it.status==='启用'?'停用':'启用';
  confirm2('确认'+to+'字典项「'+it.name+'」？被引用时建议停用代替删除。', function(){ it.status=to; rDicts(); toast('已'+to+'：'+it.name); });
}function refreshDatasets(){ rDatasets(); toast('已刷新数据集列表'); }
function viewDataset(id){
  var d=DB.datasets.find(function(x){return x.id===id;}); if(!d) return;
  formModal('数据集详情', '<p style="line-height:1.9"><b>'+esc(d.name)+'</b><br>说明：'+esc(d.sub||'—')+'<br>来源：'+esc(d.src)+' · 分类：'+esc(d.cat)+'<br>字段数：'+d.rows+' · 状态：'+esc(d.status)+'</p><div class="alert info"><svg width="14" height="14" style="vertical-align:-2px"><use href="#i-alert"></use></svg> 可进入用户端「智能检索」或「结果分析」查看数据内容（U-03 / U-05）。</div>', '关闭', null);
}
function editDataset(id){
  var d=DB.datasets.find(function(x){return x.id===id;}); if(!d) return;
  formModal('编辑数据集', '<div class="field mb12"><label>数据集名称</label><input class="input" id="f_dsname" value="'+esc(d.name)+'"></div><div class="field mb12"><label>分类</label><input class="input" id="f_dscat" value="'+esc(d.cat)+'"></div><div class="field"><label>说明</label><input class="input" id="f_dssub" value="'+esc(d.sub||'')+'"></div>', '保存', function(){
    d.name=document.getElementById('f_dsname').value; d.cat=document.getElementById('f_dscat').value; d.sub=document.getElementById('f_dssub').value;
    rDatasets(); toast('已保存数据集');
  });
}
function shelfDataset(id){
  var d=DB.datasets.find(function(x){return x.id===id;}); if(!d) return;
  var to=d.status==='已上架'?'已下架':'已上架';
  confirm2('确认'+to+'数据集「'+d.name+'」？下架后用户端不可检索。', function(){
    d.status=to; rDatasets(); rHome(); toast('已'+to+'：'+d.name);
  });
}
function refreshImports(){ rImports(); toast('已刷新审核队列'); }
function previewImport(id){
  var im=DB.imports.find(function(x){return x.id===id;}); if(!im) return;
  formModal('导入预览 · '+im.name, '<p class="small muted">提交人：'+esc(im.by)+' · 提交时间：'+esc(im.time)+' · 大小：'+esc(im.size)+' · 当前状态：'+esc(im.status)+'</p><table class="data-table"><thead><tr><th>年份</th><th>国家</th><th>GDP_增长率%</th></tr></thead><tbody><tr><td>2024</td><td>中国</td><td>5.0</td></tr><tr><td>2023</td><td>中国</td><td>5.2</td></tr><tr><td>2024</td><td>美国</td><td>2.9</td></tr></tbody></table><div class="small muted mt12">预览前 '+im.name.split(' ')[0]+' 行，完整校验见审核详情。</div>', '关闭', null);
}
function approveImport(id){
  if(!needAdmin()) return;
  var im=DB.imports.find(function(x){return x.id===id;}); if(!im) return;
  im.status='已通过';
  DB.datasets.unshift({id:'ds'+Date.now(), name:im.name, sub:'来源：'+im.by+' · '+im.type, src:'数据接入审核', cat:'宏观经济', rows:Math.floor(Math.random()*80)+20, status:'已上架'});
  var md=DB.myData.find(function(x){return x.name===im.name;}); if(md) md.status='已上架';
  rImports(); rDatasets(); rMyData(); rHome();
  toast('审核通过，数据已正式入库成为数据集（A-08）');
}
function rejectImport(id){
  if(!needAdmin()) return;
  var im=DB.imports.find(function(x){return x.id===id;}); if(!im) return;
  confirm2('退回导入任务「'+im.name+'」将通知提交人并记录退回原因。确认退回？', function(){
    im.status='已退回'; im.reason='必填列缺失';
    var md=DB.myData.find(function(x){return x.name===im.name;}); if(md) md.status='已退回';
    rImports(); rUpload(); rMyData();
    toast('已退回：必填列缺失，已通知提交人');
  });
}
function publishNotice(){
  var t=document.getElementById('noticeTitle'), s=document.getElementById('noticeScope');
  if(!t||!t.value.trim()){ toast('请填写公告标题','warning'); return; }
  DB.notices.unshift({id:'n'+Date.now(), title:t.value.trim(), scope:s? s.value:'全部用户', status:'已发布', time:todayStr()});
  rNotices(); rHome();
  toast('公告已发布，用户端首页可见');
}
function saveNoticeDraft(){
  var t=document.getElementById('noticeTitle');
  if(!t||!t.value.trim()){ toast('请填写公告标题','warning'); return; }
  DB.notices.unshift({id:'n'+Date.now(), title:t.value.trim(), scope:'全部用户', status:'草稿', time:todayStr()});
  rNotices(); toast('已保存为草稿');
}
function editNotice(id){
  var n=DB.notices.find(function(x){return x.id===id;}); if(!n) return;
  formModal('编辑公告', '<div class="field mb12"><label>标题</label><input class="input" id="f_ntitle" value="'+esc(n.title)+'"></div><div class="field"><label>接收范围</label><input class="input" id="f_nscope" value="'+esc(n.scope)+'"></div>', '保存', function(){
    n.title=document.getElementById('f_ntitle').value; n.scope=document.getElementById('f_nscope').value;
    rNotices(); rHome(); toast('已保存公告');
  });
}
function withdrawNotice(id){
  var n=DB.notices.find(function(x){return x.id===id;}); if(!n) return;
  confirm2('撤回公告「'+n.title+'」后用户端不再展示。确认撤回？', function(){ n.status='已撤回'; rNotices(); rHome(); toast('已撤回公告'); });
}
function publishNoticeId(id){
  var n=DB.notices.find(function(x){return x.id===id;}); if(!n) return;
  n.status='已发布'; n.time=todayStr(); rNotices(); rHome(); toast('公告已发布，用户端首页可见');
}
function exportHotwords(){ downloadFile('热门搜索词排行.csv'); toast('已导出热门词排行'); }
function addSensitive(){
  if(!needAdmin()) return;
  formModal('新增敏感词', '<div class="field mb12"><label>敏感词</label><input class="input" id="f_sword"></div><div class="field"><label>类型</label><select class="select" id="f_stype"><option>涉政</option><option>涉黄</option><option>广告</option><option>其他</option></select></div>', '保存', function(){
    var w=document.getElementById('f_sword');
    if(!w||!w.value.trim()){ toast('请填写敏感词','warning'); return; }
    DB.sensitive.push({id:'w'+Date.now(), word:w.value.trim(), type:document.getElementById('f_stype').value, cnt:0, status:'启用'});
    rSearchOps(); toast('已新增敏感词');
  });
}
function editSensitive(id){
  var w=DB.sensitive.find(function(x){return x.id===id;}); if(!w) return;
  formModal('编辑敏感词', '<div class="field mb12"><label>敏感词</label><input class="input" id="f_sword" value="'+esc(w.word)+'"></div><div class="field"><label>类型</label><input class="input" id="f_stype" value="'+esc(w.type)+'"></div>', '保存', function(){
    w.word=document.getElementById('f_sword').value; w.type=document.getElementById('f_stype').value;
    rSearchOps(); toast('已保存敏感词');
  });
}
function toggleSensitive(id){
  var w=DB.sensitive.find(function(x){return x.id===id;}); if(!w) return;
  var to=w.status==='启用'?'停用':'启用';
  confirm2('确认'+to+'敏感词「'+w.word+'」？', function(){ w.status=to; rSearchOps(); toast('已'+to+'：'+w.word); });
}
function flagSuggestion(id,flag){
  var s=DB.suggestions.find(function(x){return x.id===id;}); if(!s) return;
  s.flag=flag; rSearchOps(); toast('已标记：'+flag);
}
function setShortcut(id,on){
  var h=DB.hotWords.find(function(x){return x.id===id;}); if(!h) return;
  h.shortcut=on; rSearchOps(); rGlobalSearch();
  toast(on?('「'+h.word+'」已设为快捷检索词'):('已取消「'+h.word+'」快捷检索'));
}
function saveConfig(key){
  var inp=document.getElementById('cfg-'+key), cfg=DB.configs.find(function(x){return x.key===key;});
  if(!cfg||!inp) return;
  cfg.val=inp.value; toast('已保存参数「'+cfg.name+'」：'+cfg.val+' '+cfg.unit);
}
function maskKey(k){
  if(!k) return '未配置';
  if(String(k).indexOf('****') >= 0) return String(k);
  var s = String(k); var head = s.slice(0,6); var tail = s.slice(-4);
  return head + '****' + tail;
}
function aiInp(id, def){
  var el = document.getElementById(id);
  return el ? el.value : (def == null ? '' : def);
}
function rAiConfig(){
  var tb = document.getElementById('tbody-ai-config');
  if(tb){
    tb.innerHTML = DB.aiConfig.providers.map(function(p){
      return '<tr>' +
        '<td><b>'+esc(p.vendor)+'</b><div class="small muted">'+esc(p.desc||'')+'</div></td>' +
        '<td class="small">'+esc(p.baseUrl)+'</td>' +
        '<td><code>'+esc(maskKey(p.apiKey))+'</code></td>' +
        '<td>'+esc(p.model)+'</td>' +
        '<td class="small muted">超时 '+p.timeout+'s · 温度 '+p.temperature+' · '+p.maxTokens+' tokens</td>' +
        '<td>'+st(p.status)+'</td>' +
        '<td class="row-actions">' +
          link('编辑',"editAiProvider('"+p.id+"')") + ' ' +
          link('测试连接',"testAiConn('"+p.id+"')") + ' ' +
          link(p.status==='启用'?'停用':'启用',"toggleAiProvider('"+p.id+"')") +
        '</td></tr>';
    }).join('') || '<tr><td colspan="7" class="small muted">暂无供应商，点击「新增供应商」添加</td></tr>';
  }
  var sel = document.getElementById('ai-default-provider');
  if(sel){
    sel.innerHTML = DB.aiConfig.providers.map(function(p){
      return '<option value="'+esc(p.id)+'"'+(p.id===DB.aiConfig.defaultProvider?' selected':'')+'>'+esc(p.vendor)+'</option>';
    }).join('');
  }
  var g = DB.aiConfig.global;
  var m = document.getElementById('ai-default-model'); if(m) m.value = g.model;
  var t = document.getElementById('ai-temperature'); if(t) t.value = g.temperature;
  var tk = document.getElementById('ai-max-tokens'); if(tk) tk.value = g.maxTokens;
  var to = document.getElementById('ai-timeout'); if(to) to.value = g.timeout;
  var r = document.getElementById('ai-retries'); if(r) r.value = g.retries;
}
function editAiProvider(id){
  var p = DB.aiConfig.providers.find(function(x){return x.id===id;}); if(!p) return;
  formModal('编辑供应商配置', '<div class="field mb12"><label>供应商名称</label><input class="input" id="ap_vendor" value="'+esc(p.vendor)+'"></div><div class="field mb12"><label>Base URL</label><input class="input" id="ap_base" value="'+esc(p.baseUrl)+'" placeholder="https://api.xxx.com/v1"></div><div class="field mb12"><label>API Key（加密存储，留空保持不变）</label><input class="input" id="ap_key" value="" placeholder="'+esc(maskKey(p.apiKey))+'"></div><div class="field mb12"><label>默认模型</label><input class="input" id="ap_model" value="'+esc(p.model)+'"></div><div class="form-grid"><div class="field"><label>超时（秒）</label><input class="input" id="ap_timeout" type="number" value="'+p.timeout+'"></div><div class="field"><label>温度</label><input class="input" id="ap_temp" type="number" step="0.1" value="'+p.temperature+'"></div></div><div class="field"><label>最大 Token</label><input class="input" id="ap_tokens" type="number" value="'+p.maxTokens+'"></div><div class="field"><label>用途说明</label><input class="input" id="ap_desc" value="'+esc(p.desc||'')+'"></div>', '保存', function(){
    var v = document.getElementById('ap_vendor');
    if(!v || !v.value.trim()){ toast('请填写供应商名称','warning'); return; }
    p.vendor = v.value.trim();
    p.baseUrl = document.getElementById('ap_base').value.trim();
    var key = document.getElementById('ap_key').value.trim();
    if(key){ p.apiKey = key; }
    p.model = document.getElementById('ap_model').value.trim() || 'gpt-4o';
    p.timeout = parseInt(document.getElementById('ap_timeout').value,10) || 60;
    var tmp = parseFloat(document.getElementById('ap_temp').value);
    p.temperature = isNaN(tmp) ? 0.4 : tmp;
    p.maxTokens = parseInt(document.getElementById('ap_tokens').value,10) || 4096;
    p.desc = document.getElementById('ap_desc').value.trim();
    rAiConfig(); toast('已保存供应商「'+p.vendor+'」配置');
  });
}
function addAiProvider(){
  if(!needAdmin()) return;
  formModal('新增 AI 供应商', '<div class="field mb12"><label>供应商名称</label><input class="input" id="ap_vendor" placeholder="如 智谱 AI"></div><div class="field mb12"><label>Base URL</label><input class="input" id="ap_base" placeholder="https://api.xxx.com/v1"></div><div class="field mb12"><label>API Key</label><input class="input" id="ap_key" placeholder="sk-..."></div><div class="field mb12"><label>默认模型</label><input class="input" id="ap_model" placeholder="如 glm-4"></div><div class="field mb12"><label>用途说明</label><input class="input" id="ap_desc" placeholder="如 用于智能检索解析"></div><div class="form-grid"><div class="field"><label>超时（秒）</label><input class="input" id="ap_timeout" type="number" value="60"></div><div class="field"><label>温度</label><input class="input" id="ap_temp" type="number" step="0.1" value="0.4"></div></div><div class="field"><label>最大 Token</label><input class="input" id="ap_tokens" type="number" value="4096"></div>', '创建', function(){
    var v = document.getElementById('ap_vendor');
    if(!v || !v.value.trim()){ toast('请填写供应商名称','warning'); return; }
    var key = document.getElementById('ap_key').value.trim();
    if(!key){ toast('请填写 API Key','warning'); return; }
    DB.aiConfig.providers.push({id:'ap'+Date.now(), vendor:v.value.trim(), baseUrl:document.getElementById('ap_base').value.trim(), apiKey:key, model:document.getElementById('ap_model').value.trim()||'gpt-4o', timeout:parseInt(document.getElementById('ap_timeout').value,10)||60, temperature:parseFloat(document.getElementById('ap_temp').value)||0.4, maxTokens:parseInt(document.getElementById('ap_tokens').value,10)||4096, desc:document.getElementById('ap_desc').value.trim(), status:'启用'});
    rAiConfig(); toast('已新增供应商：'+v.value.trim());
  });
}
function toggleAiProvider(id){
  var p = DB.aiConfig.providers.find(function(x){return x.id===id;}); if(!p) return;
  var to = p.status==='启用'?'停用':'启用';
  confirm2('确认'+to+'供应商「'+p.vendor+'」？停用后相关 AI 功能将自动使用其它可用供应商。', function(){
    p.status = to; rAiConfig(); toast('已'+to+'供应商：'+p.vendor);
  });
}
function testAiConn(id){
  var p = DB.aiConfig.providers.find(function(x){return x.id===id;}); if(!p) return;
  formModal('测试连接', '<div style="text-align:center;padding:18px 8px"><div class="small muted" style="margin-bottom:10px">正在请求 <b>'+esc(p.vendor)+'</b>（'+esc(p.model)+'）…</div><div class="progress" style="max-width:260px;margin:0 auto"><i id="aiTestBar" style="width:12%"></i></div></div>', '关闭', null);
  var bar = document.getElementById('aiTestBar');
  var steps = [32, 58, 82, 100];
  var i = 0;
  var timer = setInterval(function(){
    i++;
    if(bar) bar.style.width = steps[Math.min(i-1, steps.length-1)] + '%';
    if(i >= steps.length){
      clearInterval(timer);
      formModal('测试连接', '<div class="alert success" style="margin-bottom:10px"><svg width="14" height="14" style="vertical-align:-2px"><use href="#i-check"></use></svg> 连接成功：'+esc(p.vendor)+'（'+esc(p.model)+'）鉴权通过，响应延迟 286ms</div><div class="small muted">Base URL：'+esc(p.baseUrl)+'<br>模型：'+esc(p.model)+'<br>鉴权：通过</div>', '完成', null);
    }
  }, 280);
}
function saveAiGlobal(){
  var g = DB.aiConfig.global;
  var sel = document.getElementById('ai-default-provider');
  if(sel && sel.value) DB.aiConfig.defaultProvider = sel.value;
  g.model = aiInp('ai-default-model', g.model) || 'gpt-4o';
  var tmp = parseFloat(aiInp('ai-temperature', g.temperature));
  g.temperature = isNaN(tmp) ? 0.4 : tmp;
  var tk = parseInt(aiInp('ai-max-tokens', g.maxTokens),10);
  g.maxTokens = isNaN(tk) ? 4096 : tk;
  var to = parseInt(aiInp('ai-timeout', g.timeout),10);
  g.timeout = isNaN(to) ? 60 : to;
  var r = parseInt(aiInp('ai-retries', g.retries),10);
  g.retries = isNaN(r) ? 2 : r;
  rAiConfig(); toast('已保存全局 AI 调用参数');
}
function resetAiGlobal(){
  DB.aiConfig.global = { model:'gpt-4o', temperature:0.4, maxTokens:4096, timeout:60, retries:2 };
  if(DB.aiConfig.providers.length) DB.aiConfig.defaultProvider = DB.aiConfig.providers[0].id;
  rAiConfig(); toast('已恢复默认 AI 调用参数');
}

/* =========================================================
   Agent 应用管理（管理端 · 对接 PRD U-09 报告生成 Agent 应用）
   ========================================================= */
function rAgent(){
  var k1 = document.getElementById('agent-kpi-total');
  if(k1) k1.textContent = DB.agents.length;
  var k2 = document.getElementById('agent-kpi-calls');
  if(k2) k2.textContent = DB.agents.reduce(function(s,a){ return s+(a.calls||0); },0).toLocaleString();
  var tb = document.getElementById('tbody-agents');
  if(tb){
    tb.innerHTML = DB.agents.map(function(a){
      var caps = a.caps.map(function(c){ return tag(c, c==='撰写'?'brand':''); }).join(' ');
      var fmts = a.formats.map(function(f){ return tag(f); }).join(' ');
      var act = link('编辑',"editAgent('"+a.id+"')") + ' ' + link('测试',"testAgent('"+a.id+"')") + ' ' + link(a.status==='启用'?'停用':'启用',"toggleAgent('"+a.id+"')");
      return '<tr>' +
        '<td><b>'+esc(a.name)+'</b><div class="small muted">'+esc(a.desc||'')+'</div></td>' +
        '<td>'+caps+'</td>' +
        '<td class="small">'+esc(a.provider)+'<br><code>'+esc(a.model)+'</code></td>' +
        '<td>'+fmts+'</td>' +
        '<td class="small muted">温度 '+a.temperature+' · '+a.maxTokens+' tokens · 超时 '+a.timeout+'s</td>' +
        '<td class="small">调用 '+a.calls.toLocaleString()+' · 成功 '+a.successRate+'<br>平均 '+a.avgTime+'</td>' +
        '<td>'+st(a.status)+'</td>' +
        '<td class="row-actions">'+act+'</td></tr>';
    }).join('') || '<tr><td colspan="8" class="small muted">暂无 Agent，点击「新增 Agent」创建</td></tr>';
  }
  var tb2 = document.getElementById('tbody-agent-tasks');
  if(tb2){
    tb2.innerHTML = DB.agentTasks.map(function(t){
      var ag = DB.agents.find(function(x){return x.id===t.agent;});
      var an = ag ? ag.name : t.agent;
      var act = '';
      if(t.status==='执行中') act = link('终止',"agentTaskStop('"+t.id+"')") + ' ' + link('日志',"agentTaskLog('"+t.id+"')");
      else if(t.status==='失败') act = link('重试'+(t.retries?'('+t.retries+'/3)':''),"agentTaskRetry('"+t.id+"')") + ' ' + link('日志',"agentTaskLog('"+t.id+"')");
      act += ' ' + link('详情',"agentTaskDetail('"+t.id+"')");
      var prog = (t.status==='成功' || t.status==='已终止')
        ? '<span class="pct">'+t.progress+'% · '+esc(t.stage)+'</span>'
        : '<div class="progress" style="width:140px"><i style="width:'+t.progress+'%"></i></div><span class="pct">'+t.progress+'% · '+esc(t.stage)+'</span>';
      return '<tr><td>'+esc(t.id)+'</td><td>'+esc(an)+'</td><td>'+esc(t.by)+'</td><td>'+st(t.status)+'</td><td>'+prog+'</td><td>'+esc(t.created)+'</td><td class="row-actions">'+act+'</td></tr>';
    }).join('') || '<tr><td colspan="7" class="small muted">暂无运行任务</td></tr>';
  }
  var rp = DB.refPolicy;
  var chk = function(id, on){ var el = document.getElementById(id); if(el) el.checked = !!on; };
  chk('ref-auto', rp.autoGenerate);
  chk('ref-verify', rp.verifySource);
  chk('ref-dedupe', rp.dedupe);
  var t1 = document.getElementById('ref-timeout'); if(t1) t1.value = rp.timeout;
  var m1 = document.getElementById('ref-missing'); if(m1) m1.value = rp.missingMode;
  var f1 = document.getElementById('ref-format'); if(f1) f1.value = rp.format;
  var dist = document.getElementById('agent-dist');
  if(dist){
    var max = Math.max.apply(null, DB.agents.map(function(a){return a.calls;}).concat([1]));
    dist.innerHTML = DB.agents.map(function(a){
      var h = Math.max(8, Math.round(a.calls / max * 100));
      return '<i style="height:'+h+'%" title="'+esc(a.name)+'：'+a.calls.toLocaleString()+' 次"></i>';
    }).join('');
  }
  var rs = document.getElementById('tbody-ref-stats');
  if(rs){
    rs.innerHTML = '<tr><td>引用总数</td><td class="num">'+DB.refStats.total.toLocaleString()+'</td></tr>' +
      '<tr><td>已校验通过</td><td class="num">'+DB.refStats.verified.toLocaleString()+'</td></tr>' +
      '<tr><td>校验中</td><td class="num">'+DB.refStats.pending.toLocaleString()+'</td></tr>' +
      '<tr><td>待补充引用</td><td class="num" style="color:var(--danger)">'+DB.refStats.missing.toLocaleString()+'</td></tr>' +
      '<tr><td>留存可溯源</td><td class="num">'+DB.refStats.traceable+'</td></tr>';
  }
}
function addAgent(){
  formModal('新增 Agent 应用',
    '<div class="field mb12"><label>Agent 名称</label><input class="input" id="ag_name" placeholder="如 行业研究报告助手"></div>' +
    '<div class="field mb12"><label>用途说明</label><input class="input" id="ag_desc" placeholder="如 面向行业研究报告自动生成"></div>' +
    '<div class="field mb12"><label>角色能力（多选）</label><div class="flex wrap" id="ag_caps">' +
      '<label class="checkbox"><input type="checkbox" value="检索" checked=""><span>检索</span></label>' +
      '<label class="checkbox"><input type="checkbox" value="分析" checked=""><span>分析</span></label>' +
      '<label class="checkbox"><input type="checkbox" value="撰写"><span>撰写</span></label>' +
    '</div></div>' +
    '<div class="form-grid">' +
      '<div class="field"><label>绑定模型</label><select class="select" id="ag_model">' + DB.aiConfig.providers.map(function(p){ return '<option value="'+esc(p.id)+'">'+esc(p.vendor)+' · '+esc(p.model)+'</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label>输出格式（多选）</label><div class="flex wrap" id="ag_formats">' +
        '<label class="checkbox"><input type="checkbox" value="Word" checked=""><span>Word</span></label>' +
        '<label class="checkbox"><input type="checkbox" value="PPT" checked=""><span>PPT</span></label>' +
        '<label class="checkbox"><input type="checkbox" value="PDF" checked=""><span>PDF</span></label>' +
      '</div></div>' +
      '<div class="field"><label>温度</label><input class="input" id="ag_temp" type="number" step="0.1" value="0.4"></div>' +
      '<div class="field"><label>最大 Token</label><input class="input" id="ag_tokens" type="number" value="4096"></div>' +
    '</div>' +
    '<div class="field mt12"><label>请求超时（秒）</label><input class="input" id="ag_timeout" type="number" value="60"></div>',
    '创建', function(){
      var nm = document.getElementById('ag_name');
      if(!nm || !nm.value.trim()){ toast('请填写 Agent 名称','warning'); return; }
      var caps = []; document.querySelectorAll('#ag_caps input:checked').forEach(function(c){ caps.push(c.value); });
      var sel = document.getElementById('ag_model');
      var p = DB.aiConfig.providers.find(function(x){ return x.id===sel.value; });
      var fmts = []; document.querySelectorAll('#ag_formats input:checked').forEach(function(c){ fmts.push(c.value); });
      DB.agents.unshift({id:'ag'+Date.now(), name:nm.value.trim(), desc:document.getElementById('ag_desc').value.trim(), caps:caps, model:p?p.model:'gpt-4o', provider:p?p.vendor:'OpenAI', formats:fmts.length?fmts:['Word'], temperature:parseFloat(document.getElementById('ag_temp').value)||0.4, maxTokens:parseInt(document.getElementById('ag_tokens').value,10)||4096, timeout:parseInt(document.getElementById('ag_timeout').value,10)||60, status:'启用', calls:0, successRate:'—', avgTime:'—', lastRun:'—'});
      rAgent(); toast('已新增 Agent：'+nm.value.trim());
    });
}
function editAgent(id){
  var a = DB.agents.find(function(x){ return x.id===id; }); if(!a) return;
  formModal('编辑 Agent 应用：'+a.name,
    '<div class="field mb12"><label>Agent 名称</label><input class="input" id="ag_name" value="'+esc(a.name)+'"></div>' +
    '<div class="field mb12"><label>用途说明</label><input class="input" id="ag_desc" value="'+esc(a.desc||'')+'"></div>' +
    '<div class="field mb12"><label>角色能力（多选）</label><div class="flex wrap" id="ag_caps">' +
      ['检索','分析','撰写'].map(function(c){ return '<label class="checkbox"><input type="checkbox" value="'+c+'"'+(a.caps.indexOf(c)>-1?' checked':'')+'><span>'+c+'</span></label>'; }).join('') +
    '</div></div>' +
    '<div class="form-grid">' +
      '<div class="field"><label>绑定模型</label><select class="select" id="ag_model">' + DB.aiConfig.providers.map(function(p){ return '<option value="'+esc(p.id)+'"'+(p.vendor===a.provider?' selected':'')+'>'+esc(p.vendor)+' · '+esc(p.model)+'</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label>输出格式（多选）</label><div class="flex wrap" id="ag_formats">' +
        ['Word','PPT','PDF'].map(function(f){ return '<label class="checkbox"><input type="checkbox" value="'+f+'"'+(a.formats.indexOf(f)>-1?' checked':'')+'><span>'+f+'</span></label>'; }).join('') +
      '</div></div>' +
      '<div class="field"><label>温度</label><input class="input" id="ag_temp" type="number" step="0.1" value="'+a.temperature+'"></div>' +
      '<div class="field"><label>最大 Token</label><input class="input" id="ag_tokens" type="number" value="'+a.maxTokens+'"></div>' +
    '</div>' +
    '<div class="field mt12"><label>请求超时（秒）</label><input class="input" id="ag_timeout" type="number" value="'+a.timeout+'"></div>',
    '保存', function(){
      var nm = document.getElementById('ag_name');
      if(!nm || !nm.value.trim()){ toast('请填写 Agent 名称','warning'); return; }
      var caps = []; document.querySelectorAll('#ag_caps input:checked').forEach(function(c){ caps.push(c.value); });
      var sel = document.getElementById('ag_model');
      var p = DB.aiConfig.providers.find(function(x){ return x.id===sel.value; });
      var fmts = []; document.querySelectorAll('#ag_formats input:checked').forEach(function(c){ fmts.push(c.value); });
      a.name = nm.value.trim();
      a.desc = document.getElementById('ag_desc').value.trim();
      a.caps = caps;
      if(p){ a.model = p.model; a.provider = p.vendor; }
      if(fmts.length) a.formats = fmts;
      a.temperature = parseFloat(document.getElementById('ag_temp').value) || a.temperature;
      a.maxTokens = parseInt(document.getElementById('ag_tokens').value,10) || a.maxTokens;
      a.timeout = parseInt(document.getElementById('ag_timeout').value,10) || a.timeout;
      rAgent(); toast('已保存 Agent：'+a.name);
    });
}
function toggleAgent(id){
  var a = DB.agents.find(function(x){ return x.id===id; }); if(!a) return;
  var to = a.status==='启用'?'停用':'启用';
  confirm2('确认'+to+' Agent「'+a.name+'」？停用后用户端不再提供该 Agent 生成能力。', function(){
    a.status = to; rAgent(); toast('已'+to+' Agent：'+a.name);
  });
}
function testAgent(id){
  var a = DB.agents.find(function(x){ return x.id===id; }); if(!a) return;
  formModal('测试 Agent', '<div style="text-align:center;padding:18px 8px"><div class="small muted" style="margin-bottom:10px">正在初始化 <b>'+esc(a.name)+'</b>（'+esc(a.model)+'）角色与提示词…</div><div class="progress" style="max-width:260px;margin:0 auto"><i id="agTestBar" style="width:10%"></i></div></div>', '关闭', null);
  var bar = document.getElementById('agTestBar');
  var steps = [28, 55, 80, 100];
  var i = 0;
  var timer = setInterval(function(){
    i++;
    if(bar) bar.style.width = steps[Math.min(i-1, steps.length-1)] + '%';
    if(i >= steps.length){
      clearInterval(timer);
      formModal('测试 Agent', '<div class="alert success" style="margin-bottom:10px"><svg width="14" height="14" style="vertical-align:-2px"><use href="#i-check"></use></svg> 测试通过：Agent「'+esc(a.name)+'」可正常完成「'+a.caps.join(' → ')+'」流程</div><div class="small muted">绑定模型：'+esc(a.provider)+' / '+esc(a.model)+'<br>输出格式：'+esc(a.formats.join('、'))+'<br>测试耗时：1.2s</div>', '完成', null);
    }
  }, 260);
}
function agentTaskStop(id){
  var t = DB.agentTasks.find(function(x){ return x.id===id; }); if(!t) return;
  confirm2('终止任务 '+id+' 不可恢复，确认终止？', function(){
    t.status = '已终止'; t.stage = '已终止'; rAgent(); toast('已终止任务：'+id);
  });
}
function agentTaskRetry(id){
  var t = DB.agentTasks.find(function(x){ return x.id===id; }); if(!t) return;
  var cur = t.retries || 0;
  if(cur >= 3){ rAgent(); toast('已达重试上限（3 次），请人工介入处理','danger'); return; }
  t.retries = cur + 1;
  t.status = '执行中'; t.progress = 8; t.stage = '重新初始化'; t.created = nowStr();
  rAgent(); toast('已触发重试：'+id+'（'+t.retries+'/3）');
}
function agentTaskLog(id){
  var t = DB.agentTasks.find(function(x){ return x.id===id; });
  var lines = '<div>10:02:11 收到指令，解析任务意图</div>' +
    '<div>10:02:18 并行检索数据源（3 个）</div>' +
    '<div>10:02:47 数据标准化完成，进入分析</div>' +
    '<div>10:03:02 报告撰写中（引用校验）</div>';
  if(t && t.status==='失败') lines = '<div style="color:var(--danger)">10:05:40 ERROR 引用来源「欧盟统计局」校验超时（30s），重试 2 次仍失败</div>' + lines;
  formModal('任务日志：'+id,
    (t && t.status==='失败'
      ? '<div class="alert danger" style="margin-bottom:10px"><svg width="14" height="14" style="vertical-align:-2px"><use href="#i-alert"></use></svg> 引用来源「欧盟统计局」校验超时（30s），重试 2 次仍失败，已按策略标注「待补充引用」</div>'
      : '<div class="alert info" style="margin-bottom:10px"><svg width="14" height="14" style="vertical-align:-2px"><use href="#i-alert"></use></svg> 任务执行正常，进度与任务中心（A-11）一致</div>') +
    '<div class="small" style="line-height:1.9;font-family:ui-monospace,Consolas,monospace">'+lines+'</div>', '关闭', null);
}
function agentTaskDetail(id){
  var t = DB.agentTasks.find(function(x){ return x.id===id; });
  if(!t) return;
  var ag = DB.agents.find(function(x){ return x.id===t.agent; });
  formModal('任务详情：'+id,
    '<p style="line-height:1.9"><b>Agent：</b>'+esc(ag?ag.name:t.agent)+'<br><b>发起用户：</b>'+esc(t.by)+'<br><b>状态：</b>'+esc(t.status)+'（进度 '+t.progress+'%）<br><b>当前阶段：</b>'+esc(t.stage)+'<br><b>创建时间：</b>'+esc(t.created)+'<br><b>输出格式：</b>'+esc(ag?ag.formats.join('、'):'—')+'</p>' +
    '<div class="alert info"><svg width="14" height="14" style="vertical-align:-2px"><use href="#i-link"></use></svg> 生成结果自动进入 AI 成果库（U-10）与我的报告（U-15），引用留存可溯源。</div>', '关闭', null);
}
function saveRefPolicy(){
  var rp = DB.refPolicy;
  var e1 = document.getElementById('ref-auto'); if(e1) rp.autoGenerate = e1.checked;
  var e2 = document.getElementById('ref-verify'); if(e2) rp.verifySource = e2.checked;
  var e3 = document.getElementById('ref-dedupe'); if(e3) rp.dedupe = e3.checked;
  var e4 = document.getElementById('ref-timeout'); if(e4) rp.timeout = parseInt(e4.value,10) || 30;
  var e5 = document.getElementById('ref-missing'); if(e5) rp.missingMode = e5.value;
  var e6 = document.getElementById('ref-format'); if(e6) rp.format = e6.value;
  rAgent(); toast('已保存引用管理策略');
}
function resetRefPolicy(){
  DB.refPolicy = { autoGenerate:true, verifySource:true, timeout:30, missingMode:'待补充引用', format:'国标 GB/T 7714-2015', dedupe:true };
  rAgent(); toast('已恢复默认引用管理策略');
}
function refreshAgent(){
  rAgent();
  var n = Math.floor(Math.random()*3);
  toast('已刷新 Agent 运行数据（新增 '+n+' 条动态）');
}
function refreshAudit(){ rAudit(); toast('已刷新日志'); }
function manualCheck(){
  DB.monitors.forEach(function(m){ m.status='正常'; m.time=nowStr(); });
  rMonitor(); toast('已手动触发健康检查，全部服务正常');
}
function loadMoreErrors(){
  DB.errors.push({id:'e'+Date.now(), time:nowStr(), src:'检索服务', msg:'局部索引分片重建耗时超过阈值（1800ms）'});
  rMonitor(); toast('已加载更多错误日志');
}
function saveBackupPolicy(){
  if(!needAdmin()) return;
  if(!DB.backupPolicy) DB.backupPolicy = {};
  var e1=document.getElementById('bp-scope'), e2=document.getElementById('bp-schedule'), e3=document.getElementById('bp-keep');
  DB.backupPolicy.scope = e1 ? e1.value : '全量（数据+配置）';
  DB.backupPolicy.schedule = e2 ? e2.value : '每日 02:00';
  DB.backupPolicy.keep = e3 ? (parseInt(e3.value,10)||30) : 30;
  toast('备份策略已保存：'+DB.backupPolicy.scope+' · '+DB.backupPolicy.schedule+' · 保留 '+DB.backupPolicy.keep+' 份');
}
function backupNow(){
  if(!needAdmin()) return;
  DB.backups.unshift({id:'b'+Date.now(), time:nowStr(), type:'全量', size:'3.2 GB', status:'执行中'});
  setTimeout(function(){ var b=DB.backups[0]; if(b&&b.status==='执行中'){ b.status='成功'; rBackup(); toast('备份完成：'+b.time); } }, 900);
  rBackup(); toast('已触发立即备份，任务执行中');
}
function restoreBackup(id){
  var b=DB.backups.find(function(x){return x.id===id;}); if(!b) return;
  confirm2('恢复 '+b.time+' 的'+b.type+'备份将覆盖当前数据，此操作不可撤销。确认恢复？', function(){
    toast('已提交恢复任务：'+b.time+'（'+b.type+'），完成后自动重启服务');
  });
}function approveKb(id){
  if(!needAdmin()) return;
  var k=DB.kbReviewQueue.find(function(x){return x.id===id;}); if(!k) return;
  k.status='已通过';
  var e=DB.kbEntries.find(function(x){return x.title===k.title;});
  if(e){ e.status='已通过'; }
  else { DB.kbEntries.unshift({id:'k'+Date.now(), title:k.title, type:k.type, owner:k.owner, time:nowStr(), status:'已通过', score:0.8+Math.random()*0.15, scope:'公开'}); }
  rKbReview(); rKbAchievements(); rKbIngest(); rKbManage();
  toast('审核通过，条目可被检索命中（A-16）');
}
function rejectKb(id){
  if(!needAdmin()) return;
  var k=DB.kbReviewQueue.find(function(x){return x.id===id;}); if(!k) return;
  confirm2('驳回知识条目「'+k.title+'」将通知提交人。确认驳回？', function(){
    k.status='已驳回'; rKbReview(); toast('已驳回：引用来源缺失，已通知提交人');
  });
}
function addCategory(){
  if(!needAdmin()) return;
  formModal('新增分类', '<div class="field mb12"><label>分类名称</label><input class="input" id="f_cname"></div><div class="field"><label>排序</label><input class="input" id="f_corder" placeholder="数字，越小越靠前"></div>', '保存', function(){
    var n=document.getElementById('f_cname');
    if(!n||!n.value.trim()){ toast('请填写分类名称','warning'); return; }
    DB.kbCategories.push({id:'c'+Date.now(), name:n.value.trim(), sub:0, status:'启用'});
    rKbCategory(); toast('已新增分类：'+n.value.trim());
  });
}
function editCategory(id){
  var c=DB.kbCategories.find(function(x){return x.id===id;}); if(!c) return;
  formModal('编辑分类', '<div class="field"><label>分类名称</label><input class="input" id="f_cname" value="'+esc(c.name)+'"></div>', '保存', function(){
    c.name=document.getElementById('f_cname').value; rKbCategory(); toast('已保存分类');
  });
}
function toggleCategory(id){
  var c=DB.kbCategories.find(function(x){return x.id===id;}); if(!c) return;
  var to=c.status==='启用'?'停用':'启用';
  confirm2('确认'+to+'分类「'+c.name+'」？', function(){ c.status=to; rKbCategory(); toast('已'+to+'：'+c.name); });
}
function addSubCategory(id){
  var c=DB.kbCategories.find(function(x){return x.id===id;}); if(!c) return;
  formModal('新增子级 · '+c.name, '<div class="field"><label>子分类名称</label><input class="input" id="f_cname"></div>', '保存', function(){
    var n=document.getElementById('f_cname');
    if(!n||!n.value.trim()){ toast('请填写名称','warning'); return; }
    DB.kbCategories.push({id:'c'+Date.now(), name:n.value.trim(), sub:0, status:'启用'});
    c.sub=(c.sub||0)+1; rKbCategory(); toast('已新增子级：'+n.value.trim());
  });
}
function addTag(){
  if(!needAdmin()) return;
  formModal('新增标签', '<div class="field"><label>标签名称</label><input class="input" id="f_tname"></div>', '保存', function(){
    var n=document.getElementById('f_tname');
    if(!n||!n.value.trim()){ toast('请填写标签名称','warning'); return; }
    DB.kbTags.push({id:'t'+Date.now(), name:n.value.trim(), cnt:0, status:'启用'});
    rKbCategory(); toast('已新增标签：'+n.value.trim());
  });
}
function editTag(id){
  var t=DB.kbTags.find(function(x){return x.id===id;}); if(!t) return;
  formModal('编辑标签', '<div class="field"><label>标签名称</label><input class="input" id="f_tname" value="'+esc(t.name)+'"></div>', '保存', function(){
    t.name=document.getElementById('f_tname').value; rKbCategory(); toast('已保存标签');
  });
}
function toggleTag(id){
  var t=DB.kbTags.find(function(x){return x.id===id;}); if(!t) return;
  var to=t.status==='启用'?'停用':'启用';
  confirm2('确认'+to+'标签「'+t.name+'」？', function(){ t.status=to; rKbCategory(); toast('已'+to+'：'+t.name); });
}
function saveKbPermission(){
  if(!needAdmin()) return;
  if(!DB.kbPermission) DB.kbPermission = {};
  var e1=document.getElementById('kp-default'), e2=document.getElementById('kp-dim'), e3=document.getElementById('kp-scope');
  DB.kbPermission.default = e1 ? e1.value : '公开（所有用户可见可检索）';
  DB.kbPermission.dim = e2 ? e2.value : '指定用户 + 指定组织';
  DB.kbPermission.scope = e3 ? e3.value : '提交人本人';
  rKbPermission();
  toast('知识权限规则已保存：默认「'+DB.kbPermission.default+'」，私有维度「'+DB.kbPermission.dim+'」');
}
function rebuildIndex(mode){
  if(!needAdmin()) return;
  var t={id:(mode==='full'?'INDEX':'UPDT')+'-'+nowStr().replace(/[-: ]/g,'')+'-01', type:mode==='full'?'索引重建':'增量更新', time:nowStr(), status:'执行中', detail:mode==='full'?'全量 12,846 条':'增量 328 条'};
  DB.kbIndexTasks.unshift(t);
  DB.tasks.unshift({id:t.id, type:'索引重建', by:'admin', status:'执行中', progress:10, created:nowStr()});
  rKbIndex(); rAdminTasks();
  toast((mode==='full'?'全量索引重建':'增量更新')+'任务已发起，进入任务中心（A-18）');
}
function cleanIndex(){
  if(!needAdmin()) return;
  var t={id:'CLEAN-'+nowStr().replace(/[-: ]/g,'')+'-01', type:'脏数据清理', time:nowStr(), status:'执行中', detail:'清理失效条目与孤儿索引'};
  DB.kbIndexTasks.unshift(t); rKbIndex(); toast('已发起脏数据清理任务');
}
function refreshOrders(){ rOrders(); toast('已刷新订单列表'); }
function openOrderDetail(id){
  var o=DB.orders.find(function(x){return x.id===id;}); if(!o) return;
  formModal('订单详情', '<p style="line-height:1.9"><b>'+esc(o.id)+'</b><br>用户：'+esc(o.user)+'<br>商品：'+esc(o.title)+'<br>金额：'+money(o.amount)+'<br>渠道：'+esc(o.channel)+'<br>状态：'+esc(o.status)+' · 创建：'+esc(o.time)+'</p><div class="alert info"><svg width="14" height="14" style="vertical-align:-2px"><use href="#i-alert"></use></svg> 支付流水见用户端「账单查询」（U-17）。</div>', '关闭', null);
}
function closeOrder(id){
  var o=DB.orders.find(function(x){return x.id===id;}); if(!o) return;
  confirm2('关闭订单 '+o.id+'（'+o.title+'）？关闭后不可支付。', function(){
    o.status='已关闭'; rOrders(); rBilling(); toast('已关闭异常/超时订单');
  });
}
function handleCallback(id){
  var o=DB.orders.find(function(x){return x.id===id;}); if(!o) return;
  formModal('人工排查回调', '<p>订单 '+esc(o.id)+' 支付回调异常，请核对支付渠道流水后处理。</p><div class="alert danger"><svg width="14" height="14" style="vertical-align:-2px"><use href="#i-alert"></use></svg> 操作将写入审计日志（A-13）。</div>', '确认已到账', function(){
    o.status='已支付'; rOrders(); rBilling(); toast('已人工确认到账，订单更新为已支付');
  });
}
function refundOrder(id){
  var o=DB.orders.find(function(x){return x.id===id;}); if(!o) return;
  formModal('退款确认', '<div class="field"><label>退款原因</label><input class="input" id="f_reason" placeholder="如：重复支付 / 用户申请"></div><div class="alert danger mt12"><svg width="14" height="14" style="vertical-align:-2px"><use href="#i-alert"></use></svg> 退款后订单状态更新为「已退款」并同步用户端（U-17）。</div>', '确认退款', function(){
    o.status='已退款'; rOrders(); rBilling(); toast('已退款并记录原因：'+(document.getElementById('f_reason').value||'用户申请'));
  });
}
function addChannel(){
  if(!needAdmin()) return;
  formModal('新增支付渠道', '<div class="field mb12"><label>渠道名称</label><input class="input" id="f_chname"></div><div class="field mb12"><label>商户号</label><input class="input" id="f_chmer"></div><div class="field"><label>回调地址</label><input class="input" id="f_chcb"></div>', '创建', function(){
    var n=document.getElementById('f_chname');
    if(!n||!n.value.trim()){ toast('请填写渠道名称','warning'); return; }
    DB.channels.push({id:'ch'+Date.now(), name:n.value.trim(), merchant:document.getElementById('f_chmer').value||'—', callback:document.getElementById('f_chcb').value||'https://research.example.com/pay/callback', status:'启用'});
    rOrders(); toast('已新增支付渠道：'+n.value.trim());
  });
}
function editChannel(id){
  var ch=DB.channels.find(function(x){return x.id===id;}); if(!ch) return;
  formModal('编辑渠道', '<div class="field mb12"><label>渠道名称</label><input class="input" id="f_chname" value="'+esc(ch.name)+'"></div><div class="field mb12"><label>商户号</label><input class="input" id="f_chmer" value="'+esc(ch.merchant)+'"></div><div class="field"><label>回调地址</label><input class="input" id="f_chcb" value="'+esc(ch.callback)+'"></div>', '保存', function(){
    ch.name=document.getElementById('f_chname').value; ch.merchant=document.getElementById('f_chmer').value; ch.callback=document.getElementById('f_chcb').value;
    rOrders(); toast('已保存渠道配置');
  });
}
function toggleChannel(id){
  var ch=DB.channels.find(function(x){return x.id===id;}); if(!ch) return;
  var to=ch.status==='启用'?'停用':'启用';
  confirm2('确认'+to+'支付渠道「'+ch.name+'」？', function(){ ch.status=to; rOrders(); toast('已'+to+'：'+ch.name); });
}
function updateKey(id){
  var ch=DB.channels.find(function(x){return x.id===id;}); if(!ch) return;
  formModal('更新密钥 · '+ch.name, '<div class="field"><label>新密钥</label><input class="input" id="f_key" type="password" placeholder="加密存储，仅可更新不可查看明文"></div><div class="small muted mt12">更新密钥将记录审计日志并触发密钥轮换。</div>', '保存', function(){
    var k=document.getElementById('f_key');
    if(!k||!k.value.trim()){ toast('请填写新密钥','warning'); return; }
    toast('已更新密钥（加密存储，操作已记入审计日志）');
  });
}
function rotateKey(id){
  var ch=DB.channels.find(function(x){return x.id===id;}); if(!ch) return;
  confirm2('对渠道「'+ch.name+'」执行密钥轮换？旧密钥将立即失效。', function(){
    toast('已发起密钥轮换：'+ch.name);
  });
}

/* ===== 用户端真实功能增强（合并模块2） ===== */
/* =========================================================
   用户端真实功能补全模块（第三补充）
   覆盖 U-01~U-17 中仍为提示占位的按钮/操作
   ========================================================= */

/* ---------- U-02 AI智能搜索 ---------- */
function aiParse(){
  var box = document.querySelector('#view-global-search .search-box input');
  if(!box) return;
  var q = box.value.trim() || '2020-2025 年中美 GDP 增长率对比分析';
  toast('AI 解析中…', 'warning');
  setTimeout(function(){
    DB.searchHistory.unshift({t:q, d:'今天 '+nowStr().slice(11,16)+' · AI 解析成功'});
    if(DB.searchHistory.length>50) DB.searchHistory.pop();
    rGlobalSearch();
    toast('解析完成：指标 GDP 增长率 / 地区 中国、美国 / 时间 2020-2025');
  }, 600);
}
function applySuggestion(kw){
  var box = document.querySelector('#view-global-search .search-box input');
  if(box) box.value = kw;
  toast('已应用建议：'+kw);
}
function applyShortcut(kw){
  var box = document.querySelector('#view-global-search .search-box input');
  if(box) box.value = kw;
  toast('已应用快捷检索词：'+kw);
}
function toggleParseEdit(){
  formModal('编辑解析结果',
    '<div class="field mb12"><label>指标</label><input class="input" id="peIndicator" value="GDP 增长率"></div>'+
    '<div class="field mb12"><label>地区</label><input class="input" id="peRegion" value="中国、美国"></div>'+
    '<div class="field mb12"><label>时间</label><input class="input" id="peTime" value="2020-2025"></div>'+
    '<div class="field"><label>粒度</label><input class="input" id="peGrain" value="年度"></div>',
    '应用', function(){
      var tagBox = document.querySelector('#view-global-search .mt12.flex.wrap');
      if(tagBox){
        var ind=document.getElementById('peIndicator'), reg=document.getElementById('peRegion'),
            tm=document.getElementById('peTime'), gr=document.getElementById('peGrain');
        if(ind&&reg&&tm&&gr){
          tagBox.innerHTML = '<span class="muted small">AI 解析结果：</span>' +
            '<span class="tag brand">指标：'+esc(ind.value)+'</span>' +
            '<span class="tag brand">地区：'+esc(reg.value)+'</span>' +
            '<span class="tag brand">时间：'+esc(tm.value)+'</span>' +
            '<span class="tag brand">粒度：'+esc(gr.value)+'</span>' +
            '<span class="link" onclick="toggleParseEdit()">编辑</span>';
        }
      }
      toast('解析条件已更新，可前往智能检索执行');
    });
}

/* ---------- U-04 智能检索与解析 ---------- */
function resetSearch(){
  var boxes = document.querySelectorAll('#view-smart-search input[type="checkbox"]');
  boxes.forEach(function(b){ b.checked = true; });
  toast('已重置检索条件');
}
function rerunSearch(){
  var res = document.getElementById('tbody-smart-results');
  if(res){
    res.innerHTML = [
      ['世界银行 WDI','1,284','1.2s','成功'],
      ['国家统计局','896','0.8s','成功'],
      ['本地知识库','42','0.3s','成功']
    ].map(function(r){
      return '<tr><td>'+r[0]+'</td><td class="num">'+r[1]+'</td><td class="num">'+r[2]+'</td><td>'+st(r[3])+'</td></tr>';
    }).join('');
  }
  toast('已重新并行检索：3 个数据源同步返回，共命中 2,222 条');
}

/* ---------- U-05 数据展示与智能分析 ---------- */
function exportFiltered(){
  downloadFile('筛选结果.csv');
  toast('已导出当前筛选结果，共 6 行');
}
function regenerateInsight(){
  var el = document.getElementById('insight-text');
  if(el){
    el.innerHTML = '<b>要点：</b>2020-2025 年间，中国 GDP 平均增速 <b>4.9%</b>，美国 <b>2.4%</b>；' +
      '中国增速在 2022 年触底（3.0%）后持续回升，2025 年达 <b>5.1%</b>；' +
      '中美 GDP 差距（美元计）由 2020 年的 6.1 万亿美元扩大至 2025 年的 6.6 万亿美元。<br><br>' +
      '<b>建议：</b>可进一步按季度粒度分析增速拐点，或按行业拆解增长贡献（已基于最新数据重新生成）。';
  }
  toast('已重新生成 AI 解读（基于最新数据）');
}
function renderChart(type){
  if(!type) type = 'line';
  var el = document.getElementById('analysis-chart');
  var labels = {line:'折线图（时间趋势）', bar:'柱状图（地区对比）', pie:'饼图（构成占比）', scatter:'散点图（相关性）'};
  if(el){
    if(type==='line'){
      el.innerHTML = '<svg width="100%" height="130" viewBox="0 0 300 130" style="max-width:460px"><polyline points="10,90 60,68 110,78 160,44 210,56 260,22 290,32" fill="none" stroke="#16675f" stroke-width="2.5"/><circle cx="10" cy="90" r="3.5" fill="#16675f"/><circle cx="60" cy="68" r="3.5" fill="#16675f"/><circle cx="110" cy="78" r="3.5" fill="#16675f"/><circle cx="160" cy="44" r="3.5" fill="#16675f"/><circle cx="210" cy="56" r="3.5" fill="#16675f"/><circle cx="260" cy="22" r="3.5" fill="#16675f"/><circle cx="290" cy="32" r="3.5" fill="#16675f"/></svg><div class="small muted mt4">2020-2025 中国 GDP 增长率走势</div>';
    } else if(type==='bar'){
      el.innerHTML = '<div class="mini-bar" style="min-height:130px">'+[35,48,42,60,54,72,80].map(function(b){return '<i style="height:'+b+'%"></i>';}).join('')+'</div><div class="small muted mt4">中国 vs 美国 GDP 增速对比</div>';
    } else if(type==='pie'){
      el.innerHTML = '<div style="display:flex;align-items:center;gap:18px;flex-wrap:wrap"><svg width="120" height="120" viewBox="0 0 36 36"><circle cx="18" cy="18" r="15.9" fill="#e7f2f0"/><path d="M18 2.1 A15.9 15.9 0 0 1 30.8 9.5 L18 18 Z" fill="#16675f"/><path d="M30.8 9.5 A15.9 15.9 0 0 1 18 33.9 L18 18 Z" fill="#aa6b18"/><path d="M18 33.9 A15.9 15.9 0 0 1 2.1 18 L18 18 Z" fill="#356d93"/><path d="M2.1 18 A15.9 15.9 0 0 1 18 2.1 L18 18 Z" fill="#7a5c8e"/></svg><div class="small muted">中国 42% · 美国 31% · 其他 27%</div></div>';
    } else {
      el.innerHTML = '<svg width="260" height="120" viewBox="0 0 260 120"><g fill="#16675f" opacity=".65">'+[ [30,60],[70,40],[110,70],[150,30],[190,55],[230,45] ].map(function(p){return '<circle cx="'+p[0]+'" cy="'+p[1]+'" r="5"/>';}).join('')+'</g></svg><div class="small muted mt4">GDP 增长率与人均水平相关性</div>';
    }
  }
  toast('已生成'+labels[type]);
}

/* ---------- U-06 数据图表导出 ---------- */
function doExport(kind){
  kind = kind || 'csv';
  downloadFile(kind==='csv' ? '数据导出.csv' : '数据图表.png');
  DB.exports.unshift({id:'e'+Date.now(), time:nowStr(), name:kind==='csv'?'筛选结果导出':'图表导出', type:kind==='csv'?'CSV':'PNG', size:kind==='csv'?'86 KB':'412 KB', status:'成功'});
  rExport();
  toast(kind==='csv' ? 'CSV 导出成功，已开始下载' : 'PNG 导出成功，已开始下载');
}

/* ---------- U-08 AI分析报告 ---------- */
function saveReportDraft(){
  var r = DB.myReports.find(function(x){ return x.id==='mr1'; });
  if(r){ r.status = '草稿'; r.time = nowStr(); }
  rAiReport(); rMyReports();
  toast('已保存草稿，可在「我的报告」中继续编辑');
}
function editReport(id){
  var r = DB.myReports.find(function(x){ return x.id===id; });
  if(!r) return;
  formModal('编辑报告：'+r.name,
    '<div class="field mb12"><label>报告标题</label><input class="input" id="repTitle" value="'+esc(r.name)+'"></div>'+
    '<div class="field mb12"><label>输出格式</label><select class="select" id="repType"><option'+(r.type==='Word'?' selected':'')+'>Word</option><option'+(r.type==='PPT'?' selected':'')+'>PPT</option><option'+(r.type==='PDF'?' selected':'')+'>PDF</option></select></div>'+
    '<div class="field"><label>正文（支持富文本，演示为纯文本）</label><textarea class="textarea" id="repBody" style="min-height:120px">本报告基于 AI 数据智搜生成，覆盖 2020-2025 年中美主要经济指标对比，含数据来源与引用校验。</textarea></div>',
    '保存', function(){
      var t = document.getElementById('repTitle');
      var ty = document.getElementById('repType');
      if(t && t.value.trim()){ r.name = t.value.trim(); }
      if(ty) r.type = ty.value;
      r.time = nowStr(); r.status = '已完成';
      rAiReport(); rMyReports();
      toast('报告已保存');
    });
}
function shareReport(id){
  var r = DB.myReports.find(function(x){ return x.id===id; });
  if(!r) return;
  formModal('分享设置：'+r.name,
    '<div class="field mb12"><label>分享范围</label><select class="select" id="shareScope"><option>仅自己可见</option><option>仅授权用户可见</option><option>组织内可见</option><option>公开链接</option></select></div>'+
    '<div class="alert info"><svg width="14" height="14" style="vertical-align:-2px"><use href="#i-link"></use></svg> 公开后链接：https://research.example.com/s/'+esc(r.id)+'</div>',
    '保存', function(){
      var s = document.getElementById('shareScope');
      if(s) r.share = s.value;
      rMyReports();
      toast('分享设置已保存：'+r.share);
    });
}
function versionCompare(id){
  var r = DB.myReports.find(function(x){ return x.id===id; });
  var rows = DB.reportVersions.filter(function(v){ return !r || v.name===r.name; });
  if(!rows.length) rows = DB.reportVersions;
  formModal('版本对比：'+(r?r.name:''),
    '<table class="data-table"><thead><tr><th>版本</th><th>时间</th><th>说明</th><th>操作</th></tr></thead><tbody>' +
    rows.map(function(v){
      return '<tr><td>'+esc(v.ver)+(v.current?' <span class="tag brand">当前</span>':'')+'</td><td>'+esc(v.time)+'</td><td class="small muted">'+esc(v.note)+'</td><td class="row-actions">'+link('回滚到此版本',"rollbackReport('"+esc(v.ver)+"')")+'</td></tr>';
    }).join('') + '</tbody></table>' +
    '<div class="small muted mt12">支持版本对比：差异高亮、数据变更、章节新增/删除（演示）</div>',
    '关闭', null);
}
function rollbackReport(ver){
  confirm2('回滚到 '+ver+' 将覆盖当前版本，确认？', function(){
    DB.reportVersions.forEach(function(v){ v.current = (v.ver===ver); });
    var r = DB.myReports[0];
    if(r){ r.ver = ver; r.time = nowStr(); }
    rMyReports();
    toast('已回滚到 '+ver);
  });
}
function restoreReport(){
  DB.reportVersions.forEach(function(v){ v.current = (v.ver==='v1'); });
  var r = DB.myReports[0];
  if(r){ r.ver = 'v1'; r.status = '已完成'; r.time = nowStr(); }
  rMyReports(); rAiReport();
  toast('已恢复 v1');
}

/* ---------- U-09 报告生成（Agent） ---------- */
function sendAgentCmd(){
  if(!needUser()) return;
  var box = document.querySelector('#view-agent-report .search-box input');
  var cmd = box ? box.value.trim() : '';
  var id = 'T-'+nowStr().replace(/[-: ]/g,'')+'-AG';
  DB.tasks.unshift({id:id, type:'报告生成', by:SESSION.user.account, status:'执行中', progress:10, created:nowStr()});
  rAdminTasks(); rTaskControl();
  if(box) box.value = '';
  toast(cmd ? ('Agent 已接收指令：「'+cmd+'」，任务进入任务中心：'+id) : ('Agent 已接收指令，任务进入任务中心：'+id));
}
function clearChat(){
  var box = document.querySelector('#view-agent-report .search-box input');
  if(box) box.value = '';
  toast('已清空对话上下文，Agent 将重新开始');
}
function stopAgentTask(){
  var bar = document.querySelector('#view-agent-report .progress');
  if(bar){ var i = bar.querySelector('i'); if(i) i.style.width = '0%'; }
  var st = document.querySelector('#view-agent-report .status.warning');
  if(st){ st.className = 'status'; st.textContent = '已终止'; }
  toast('已终止该生成任务');
}
function agentOutput(){
  var sel = document.querySelector('#view-agent-report .field select');
  var fmt = sel ? sel.value : 'Word（.docx）';
  var ext = fmt.indexOf('PPT')>=0 ? 'pptx' : (fmt.indexOf('PDF')>=0 ? 'pdf' : 'docx');
  downloadFile('新能源汽车产业研究报告.'+ext);
  toast('生成结果已按所选格式输出：'+fmt);
}
function recheckRefs(){
  var rows = document.querySelectorAll('#view-agent-report tbody tr');
  rows.forEach(function(tr){
    var td = tr.cells[tr.cells.length-1];
    if(td) td.innerHTML = '<span class="status success">已校验</span>';
  });
  toast('已触发引用重新校验：4/4 来源校验通过');
}

/* ---------- U-10 AI成果库 ---------- */
function startReview(id){
  var k = DB.kbEntries.find(function(x){ return x.id===id; });
  if(!k) return;
  k.status = '复核中';
  rKbAchievements();
  toast('已开始复核：核对数据、结论、引用');
}
function downloadKb(id, fmt){
  downloadFile((fmt||'Word')+'-成果文档.docx');
  toast('已开始下载成果文档');
}

/* ---------- U-11 检索成果入库 ---------- */
function saveIngestRule(){
  if(!needUser()) return;
  if(!DB.ingestRule) DB.ingestRule = {};
  var e1=document.getElementById('ig-scope'), e2=document.getElementById('ig-auto'), e3=document.getElementById('ig-tags');
  DB.ingestRule.scope = e1 ? e1.value : '检索成果 + 报告成果';
  DB.ingestRule.auto = e2 ? e2.value : '检索完成后自动入库';
  DB.ingestRule.tags = e3 ? e3.value.trim() : '';
  rKbIngest();
  toast('入库规则已保存：'+DB.ingestRule.scope+' · '+DB.ingestRule.auto+(DB.ingestRule.tags?' · 标签：'+DB.ingestRule.tags:''));
}
function doSaveIngestRule(){ saveIngestRule(); }
function openTrace(id){
  formModal('溯源链路',
    '<div class="timeline">'+
    '<div class="tl-item done"><div class="t">原始数据源</div><div class="d">国家统计局 · 2025 年 6 月发布 · 官方口径</div></div>'+
    '<div class="tl-item done"><div class="t">采集入库</div><div class="d">2026-08-06 09:12 · 自动采集任务 C-20260806-001</div></div>'+
    '<div class="tl-item done"><div class="t">数据标准化</div><div class="d">统一字段：指标 / 地区 / 时间 / 单位（任务 T-20260806-012）</div></div>'+
    '<div class="tl-item done"><div class="t">检索命中</div><div class="d">「2025 年中美新能源汽车渗透率」查询 · 相似度 0.86</div></div>'+
    '<div class="tl-item"><div class="t">成果入库</div><div class="d">本条知识已入库，可全文回溯每一步加工记录</div></div>'+
    '</div>'+
    '<div class="small muted mt12">全链路可追溯：数据来源 → 加工 → 命中 → 入库（PRD U-11）</div>',
    '关闭', null);
}
function modifyTag(id){
  var k = DB.kbEntries.find(function(x){ return x.id===id; });
  formModal('修改标签'+(k?'：'+k.title:''),
    '<div class="field"><label>标签（逗号分隔）</label><input class="input" id="kbTags" value="主题：新能源汽车，指标：渗透率"></div>',
    '保存', function(){
      var inp = document.getElementById('kbTags');
      if(k && inp){ k.tags = inp.value.split(/[,，]/).map(function(s){return s.trim();}).filter(Boolean); }
      rKbIngest();
      toast('已修改标签');
    });
}

/* ---------- U-12 知识库优先匹配 ---------- */
function savePriority(){
  var inputs = document.querySelectorAll('#view-kb-priority .panel .input');
  inputs.forEach(function(i){ if(!i.value.trim()) i.value='≥ 0.6'; });
  toast('匹配规则已保存（阈值联动系统参数 A-12 sim_threshold）');
}
function rerunMatch(){
  var tl = document.querySelectorAll('#view-kb-priority .timeline .tl-item');
  if(tl && tl.length>=3){
    tl[0].classList.add('done');
    tl[1].classList.add('done');
    tl[2].classList.remove('done');
  }
  toast('已重新执行匹配演示：本地命中 3 条，平均相似度 0.74');
}

/* ---------- U-13 知识库内容维护 ---------- */
function editKb(id){
  var k = DB.kbEntries.find(function(x){ return x.id===id; });
  if(!k) return;
  formModal('编辑知识条目：'+k.title,
    '<div class="field mb12"><label>标题</label><input class="input" id="kbEditTitle" value="'+esc(k.title)+'"></div>'+
    '<div class="field mb12"><label>类型</label><select class="select" id="kbEditType"><option'+(k.type==='数据条目'?' selected':'')+'>数据条目</option><option'+(k.type==='Agent 生成'?' selected':'')+'>Agent 生成</option></select></div>'+
    '<div class="field"><label>可见范围</label><select class="select" id="kbEditScope"><option'+(k.scope==='公开'?' selected':'')+'>公开</option><option'+(k.scope==='私有'?' selected':'')+'>私有</option></select></div>',
    '保存', function(){
      var t = document.getElementById('kbEditTitle');
      var ty = document.getElementById('kbEditType');
      var sc = document.getElementById('kbEditScope');
      if(t && t.value.trim()) k.title = t.value.trim();
      if(ty) k.type = ty.value;
      if(sc) k.scope = sc.value;
      k.time = nowStr();
      rKbManage(); rKbIngest(); rKbAchievements();
      toast('知识条目已更新');
    });
}
function toggleKbScope(id){
  var k = DB.kbEntries.find(function(x){ return x.id===id; });
  if(!k) return;
  var to = k.scope==='公开' ? '私有' : '公开';
  confirm2('切换为「'+to+'」后，原分享链接对未授权用户失效。确认切换？', function(){
    k.scope = to;
    rKbManage(); rKbPermission();
    toast('已设为'+to);
  });
}

/* ---------- U-14 我的数据 ---------- */
function editTags(id){
  var d = DB.myData.find(function(x){ return x.id===id; });
  if(!d) return;
  formModal('编辑标签：'+d.name,
    '<div class="field"><label>标签（逗号分隔）</label><input class="input" id="mdTags" value="'+(d.tags?esc(d.tags.join(',')):'')+'"></div>',
    '保存', function(){
      var inp = document.getElementById('mdTags');
      if(inp){ d.tags = inp.value.split(/[,，]/).map(function(s){return s.trim();}).filter(Boolean); rMyData(); toast('已更新标签'); }
    });
}
function archiveData(id){
  var d = DB.myData.find(function(x){ return x.id===id; });
  if(d){ d.status='已归档'; rMyData(); toast('已归档，可恢复'); }
}
function delData(id){
  confirm2('数据被引用/参与报告时删除需二次确认并提示影响范围；删除为软删除可恢复。确认删除？', function(){
    DB.myData = DB.myData.filter(function(x){ return x.id!==id; });
    rMyData();
    toast('已删除（软删除，进回收站）');
  });
}
function restoreData(id){
  var d = DB.myData.find(function(x){ return x.id===id; });
  if(d){ d.status='已上架'; rMyData(); toast('已取消归档'); }
}
function exportMyData(){
  downloadFile('我的数据清单.csv');
  toast('已导出数据清单');
}
function deleteSelectedData(){
  var checked = document.querySelectorAll('#tbody-my-data input:checked');
  if(!checked.length){ toast('请先勾选要删除的数据','warning'); return; }
  confirm2('删除所选 '+checked.length+' 条数据（软删除，可恢复）？', function(){
    var ids = Array.prototype.map.call(checked, function(c){ return c.closest('tr').dataset.id; });
    DB.myData = DB.myData.filter(function(d){ return ids.indexOf(d.id)<0; });
    rMyData();
    toast('已删除所选数据（可恢复）');
  });
}
function archiveSelectedData(){
  var checked = document.querySelectorAll('#tbody-my-data input:checked');
  if(!checked.length){ toast('请先勾选要归档的数据','warning'); return; }
  var ids = Array.prototype.map.call(checked, function(c){ return c.closest('tr').dataset.id; });
  DB.myData.forEach(function(d){ if(ids.indexOf(d.id)>=0) d.status='已归档'; });
  rMyData();
  toast('已归档所选数据');
}
function submitImport(type){
  if(!needUser()) return;
  type = type || 'Excel';
  var name = type==='Excel' ? '2025年宏观数据' : (type==='CSV' ? '进出口贸易数据' : (type==='数据库' ? '生产库-经营数据' : '外部指标接口'));
  DB.imports.unshift({id:'IM-'+(1000+DB.imports.length+1), name:name, type:type, size:type==='Excel'?'2.4 MB':(type==='CSV'?'856 KB':'—'), by:SESSION.user.account, time:nowStr(), status:'待审核', reason:''});
  DB.myData.unshift({id:'md'+Date.now(), name:name, org:'智库研究部', tags:[type], status:'审核中', time:nowStr()});
  rUpload(); rImports(); rMyData();
  toast('已提交，等待管理端审核（A-08）');
}
function withdrawImport(id){
  var im = DB.imports.find(function(x){ return x.id===id; });
  if(!im) return;
  im.status = '已撤回';
  rUpload(); rImports();
  toast('已撤回本次提交');
}
function resubmitImport(id){
  var im = DB.imports.find(function(x){ return x.id===id; });
  if(!im) return;
  im.status = '待审核'; im.time = nowStr(); im.reason = '';
  rUpload(); rImports();
  toast('已重新提交，等待审核');
}
function pickFile(name){
  var t = document.getElementById('upFileName');
  if(!t){
    t = document.createElement('div'); t.id='upFileName';
    var dz = document.querySelector('#tab-up-excel .dropzone, #tab-up-csv .dropzone');
    if(dz) dz.appendChild(t);
  }
  t.innerHTML = '<div class="small muted" style="margin-top:4px">已选择：<b style="color:var(--brand)">'+esc(name||'演示数据文件.xlsx')+'</b></div>';
  toast('已选择文件：'+(name||'演示数据文件.xlsx'));
}
function testDbConn(){
  var el = document.getElementById('dbConnResult');
  if(!el){
    el = document.createElement('div'); el.id='dbConnResult';
    var dz = document.querySelector('#tab-up-db .flex.between');
    dz && dz.insertAdjacentElement('afterend', el);
  }
  el.className='alert success mt12';
  el.innerHTML = '<svg width="14" height="14" style="vertical-align:-2px"><use href="#i-check"></use></svg> 连接成功：生产库-经营数据（MySQL 8.0 · 128 张表 · 已识别 12 个指标字段）';
  toast('数据库连接测试成功');
}

/* ---------- U-15 我的报告（与 U-08 联动） ---------- */
/* versionCompare / rollbackReport / restoreReport / shareReport / editReport 见上 */

/* ---------- U-16 结算支付 ---------- */
function doPay(){
  var sel = document.querySelector('#view-pay .field select');
  var ch = sel ? sel.value : '微信支付';
  var o = DB.orders.find(function(x){ return x.id==='ORD202608100001'; });
  if(!o) return;
  formModal('确认支付',
    '<div class="kpi" style="margin-bottom:12px"><div><div class="lbl">订单号</div><div class="val" style="font-size:18px">'+esc(o.id)+'</div></div></div>'+
    '<div class="grid cols-2 mb12"><div class="field"><label>支付方式</label><div class="small" style="font-size:18px;font-weight:800">'+esc(ch)+'</div></div><div class="field"><label>金额</label><div class="small" style="font-size:18px;font-weight:900">'+money(o.amount)+'</div></div></div>'+
    '<div class="alert info"><svg width="14" height="14" style="vertical-align:-2px"><use href="#i-qr"></use></svg> 演示环境：点击确认将模拟调起 '+esc(ch)+' 并完成支付回调。</div>',
    '确认支付', function(){
      o.status = '已支付';
      o.channel = ch;
      var pid = (ch==='微信支付'?'WX':'ALI')+nowStr().replace(/[-: ]/g,'');
      DB.payments.unshift({id:pid, channel:ch, order:o.id, amount:o.amount, time:nowStr(), status:'成功'});
      DB.invoices.unshift({id:'INV'+nowStr().replace(/[-: ]/g,'').slice(0,12), order:o.id, amount:money(o.amount), type:'电子普票', status:'已开具', date:nowStr().slice(0,10)});
      var mlevel = (o.title||'').replace('会员缴费 · ','') || '专业版';
      var morder = DB.memberOrders.find(function(x){ return x.user===SESSION.user.account; });
      if(morder){ morder.status='已支付'; morder.level=mlevel; morder.amount=money(o.amount); morder.time=nowStr().slice(0,10); }
      else { DB.memberOrders.unshift({id:'mo'+Date.now(), user:SESSION.user.account, level:mlevel, amount:money(o.amount), status:'已支付', time:nowStr().slice(0,10)}); }
      rPay(); rBilling(); rOrders(); rMembers(); rDash();
      toast('支付成功：'+pid+' 已回调入账，会员权益已生效（A-03 缴费订单已同步）');
    });
}
function simulateCallback(){
  var o = DB.orders.find(function(x){ return x.id==='ORD202608100001'; });
  if(!o) return;
  if(o.status==='已支付'){ toast('订单已支付，回调幂等处理：不重复入账','warning'); return; }
  formModal('模拟支付回调',
    '<div class="field mb12"><label>回调类型</label><select class="select" id="cbType"><option>验签通过 · 正常入账</option><option>签名校验失败 · 拒绝入账</option><option>金额不一致 · 告警待人工</option></select></div>'+
    '<div class="small muted">作用于订单 '+esc(o.id)+'，结果将同步到管理端「订单与支付配置」（A-20）。</div>',
    '执行回调', function(){
      var t = document.getElementById('cbType');
      var kind = t ? t.value : '验签通过 · 正常入账';
      if(kind.indexOf('正常入账')>=0){
        o.status = '已支付';
        var pid = 'CB'+nowStr().replace(/[-: ]/g,'');
        DB.payments.unshift({id:pid, channel:o.channel, order:o.id, amount:o.amount, time:nowStr(), status:'成功'});
        var mlevel2 = (o.title||'').replace('会员缴费 · ','') || '专业版';
        var morder2 = DB.memberOrders.find(function(x){ return x.user===SESSION.user.account; });
        if(morder2){ morder2.status='已支付'; morder2.level=mlevel2; morder2.amount=money(o.amount); morder2.time=nowStr().slice(0,10); }
        else { DB.memberOrders.unshift({id:'mo'+Date.now(), user:SESSION.user.account, level:mlevel2, amount:money(o.amount), status:'已支付', time:nowStr().slice(0,10)}); }
        toast('模拟回调成功：验签通过，订单状态已更新为已支付');
      } else if(kind.indexOf('签名校验失败')>=0){
        o.status = '回调异常';
        toast('回调被拒绝：签名校验失败，订单保持待支付', 'danger');
      } else {
        o.status = '回调异常';
        toast('告警：回调金额与订单不一致，已进入人工排查队列（A-20）', 'danger');
      }
      rPay(); rBilling(); rOrders(); rMembers(); rDash();
    });
}

/* ---------- U-17 账单查询 ---------- */
function refreshBills(){
  rBilling();
  toast('已刷新账单数据');
}

/* ---------- U-01 平台首页 ---------- */
function refreshHome(){
  rHome();
  toast('已刷新热门与最新数据');
}

/* ---------- 任务管控（U-04 / A-11） ---------- */
function stopTask(id){
  var t = DB.tasks.find(function(x){ return x.id===id; });
  if(!t) return;
  confirm2('终止任务 '+id+' 不可恢复，确认终止？', function(){
    t.status = '已终止';
    rAdminTasks(); rTaskControl();
  });
}
function retryTask(id){
  var t = DB.tasks.find(function(x){ return x.id===id; });
  if(!t) return;
  var cur = t.retries || 0;
  if(cur >= 3){
    rAdminTasks(); rTaskControl();
    toast('已达重试上限（3 次），请人工介入处理','danger');
    return;
  }
  t.retries = cur + 1;
  t.status = '执行中';
  t.progress = Math.min(95, (t.progress||0)+15);
  t.created = nowStr();
  rAdminTasks(); rTaskControl();
  toast('已触发重试：'+id+'（'+t.retries+'/3）');
}
function createReportTask(){
  if(!needUser()) return;
  var id = 'T-'+nowStr().replace(/[-: ]/g,'')+'-RP';
  DB.tasks.unshift({id:id, type:'报告生成', by:SESSION.user.account, status:'执行中', progress:5, created:nowStr()});
  rAiReport(); rAdminTasks(); rTaskControl();
  toast('报告生成任务已创建：'+id+'，可在任务中心查看进度');
}

/* ---------- U-09 报告生成：Agent 指令（保留原实现并增强） ---------- */
/* sendAgentCmd 见上 */

/* ---------- 上传（U-07） ---------- */
/* submitImport / withdrawImport / resubmitImport / pickFile / testDbConn 见上 */

/* ---------- 知识库复核（U-10） ---------- */
function startReviewOld(){ /* 占位清理 */ }

/* ---------- 分析页刷新（U-05） ---------- */
function refreshAnalysis(){
  rResultAnalysis();
  toast('已刷新分析数据');
}
/* =========================================================
   Agent 管理工作台（管理端 A-10 增强）
   1) 外部接入：配置 Coze / Dify 已搭建好的 Agent / 工作流 API
   2) Dify 工作台：接入 Dify API，平台内创建 Agent + 工作流画布
   联动用户端：智能检索(U-03) / AI 解析(U-05) / 报告生成(U-09)
   ========================================================= */

/* ---------- 数据模型扩展 ---------- */
if(!DB.extAgents){
  DB.extAgents = [
    {id:'ea1', name:'Coze 行业研究 Agent', platform:'Coze', type:'Agent', api:'https://api.coze.cn/open_api/v2/chat', key:'pat_xxxxxxxxxxxxxxxxxxxx', appId:'7401234567890123', scenes:['检索','解析','报告'], calls:128, successRate:'97.2%', status:'启用', time:'2026-08-10 09:20'},
    {id:'ea2', name:'Dify 宏观报告工作流', platform:'Dify', type:'工作流', api:'https://api.dify.ai/v1/workflows/run', key:'app-xxxxxxxxxxxxxxxx', appId:'wf-20260801', scenes:['报告'], calls:56, successRate:'96.1%', status:'启用', time:'2026-08-10 10:05'},
    {id:'ea3', name:'Coze 数据解析 Agent', platform:'Coze', type:'Agent', api:'https://api.coze.cn/open_api/v2/chat', key:'pat_yyyyyyyyyyyyyyyy', appId:'7409876543210987', scenes:['解析'], calls:0, successRate:'—', status:'停用', time:'2026-08-09 16:40'}
  ];
  DB.difyConfig = { base:'https://api.dify.ai/v1', key:'app-xxxx-xxxx-xxxx', ws:'智库工作区', kb:'宏观经济知识库', status:'未连接', lastTest:'—' };
  DB.agentApps = [
    {id:'aa1', name:'智能检索解析助手', type:'对话型 Agent', model:'gpt-4o', provider:'OpenAI', scenes:['检索','解析'], wf:'', calls:86, successRate:'95.8%', status:'启用', time:'2026-08-10 10:12'},
    {id:'aa2', name:'报告生成流水线', type:'工作流型 Agent', model:'qwen-plus', provider:'通义千问', scenes:['报告'], wf:'wf1', calls:32, successRate:'94.3%', status:'启用', time:'2026-08-10 10:18'}
  ];
  DB.workflows = [
    {id:'wf1', name:'报告生成流水线（检索→解析→撰写）', version:1, status:'已发布', updated:'2026-08-10 10:00', runs:32,
     nodes:[
       {id:'n1', type:'start', name:'开始', x:40, y:200, config:{}},
       {id:'n2', type:'search', name:'智能检索', x:270, y:80, config:{sources:'多源并行检索', topK:20}},
       {id:'n3', type:'kb', name:'知识库召回', x:270, y:300, config:{kb:'宏观经济知识库', score:0.6}},
       {id:'n4', type:'parse', name:'数据解析', x:500, y:180, config:{standard:'全维度标准化'}},
       {id:'n5', type:'report', name:'报告生成', x:730, y:180, config:{format:'Word', template:'系统默认模板'}},
       {id:'n6', type:'end', name:'结束', x:960, y:180, config:{}}
     ],
     edges:[
       {id:'e1', from:'n1', to:'n2', label:''},
       {id:'e2', from:'n1', to:'n3', label:''},
       {id:'e3', from:'n2', to:'n4', label:''},
       {id:'e4', from:'n3', to:'n4', label:''},
       {id:'e5', from:'n4', to:'n5', label:''},
       {id:'e6', from:'n5', to:'n6', label:''}
     ]}
  ];
}

/* ---------- 节点类型库 ---------- */
var WFNODES = [
  {type:'start',    name:'开始',     ico:'i-play',     color:'#356d93', cat:'基础', def:{}},
  {type:'search',   name:'智能检索',  ico:'i-search',   color:'#16675f', cat:'核心', def:{sources:'多源并行检索', topK:20}},
  {type:'kb',       name:'知识库召回', ico:'i-database', color:'#7a5c8e', cat:'核心', def:{kb:'宏观经济知识库', score:0.6}},
  {type:'parse',    name:'数据解析',  ico:'i-filter',   color:'#aa6b18', cat:'核心', def:{standard:'全维度标准化'}},
  {type:'analyze',  name:'AI 分析',   ico:'i-chart',    color:'#16675f', cat:'核心', def:{model:'gpt-4o', insight:'自动生成'}},
  {type:'report',   name:'报告生成',  ico:'i-doc',      color:'#356d93', cat:'核心', def:{format:'Word', template:'系统默认模板'}},
  {type:'condition',name:'条件判断',  ico:'i-flag',     color:'#b8860b', cat:'逻辑', def:{expr:'命中数 > 0'}},
  {type:'end',      name:'结束',     ico:'i-check',    color:'#5b6272', cat:'基础', def:{}}
];
var WF_CUR = null;
var WF_SEL = null;
var WF_LINK_FROM = null;
var WF_DRAG = null;
var WF_BOUND = false;
var WF_NODE_SEQ = 100;
var EXT_EDIT_ID = null;
var APP_EDIT_ID = null;

/* ---------- 图标辅助 ---------- */
function ico(n, s){
  s = s || 14;
  return '<svg width="'+s+'" height="'+s+'"><use href="#'+n+'"></use></svg>';
}

/* ---------- Tab 切换 ---------- */
function agentTab(btn, tab){
  var root = btn.closest('.tabs');
  if(root) root.querySelectorAll('.tab').forEach(function(t){ t.classList.toggle('active', t === btn); });
  var ext = document.getElementById('agent-tab-ext');
  var dify = document.getElementById('agent-tab-dify');
  if(ext) ext.hidden = tab !== 'ext';
  if(dify) dify.hidden = tab !== 'dify';
  if(tab === 'dify'){ renderWfSelect(); renderWfCanvas(); }
}

/* =========================================================
   rAgent：管理端 Agent 页整体渲染
   ========================================================= */
function rAgent(){
  /* --- Tab1 外部接入 KPI --- */
  var total = DB.extAgents.length;
  var active = DB.extAgents.filter(function(a){ return a.status==='启用'; }).length;
  var calls = DB.extAgents.reduce(function(s,a){ return s+(a.calls||0); },0);
  var okCnt = DB.extAgents.filter(function(a){ return a.successRate && a.successRate.indexOf('%')>-1 && parseFloat(a.successRate)>=90; }).length;
  var rate = okCnt ? Math.round(okCnt/total*100) + '%' : '—';
  var k1 = document.getElementById('ext-kpi-total'); if(k1) k1.textContent = total;
  var k2 = document.getElementById('ext-kpi-active'); if(k2) k2.textContent = active;
  var k3 = document.getElementById('ext-kpi-calls'); if(k3) k3.textContent = calls.toLocaleString();
  var k4 = document.getElementById('ext-kpi-rate'); if(k4) k4.textContent = rate;

  var tb = document.getElementById('tbody-ext-agents');
  if(tb){
    tb.innerHTML = DB.extAgents.map(function(a){
      var scenes = a.scenes.map(function(s){ return tag(s, s==='报告'?'brand':''); }).join(' ');
      var act = link('编辑',"editExtAgent('"+a.id+"')") + ' ' + link('测试',"testExtAgent('"+a.id+"')") + ' ' + link(a.status==='启用'?'停用':'启用',"toggleExtAgent('"+a.id+"')") + ' ' + link('删除',"delExtAgent('"+a.id+"')");
      return '<tr><td><b>'+esc(a.name)+'</b><div class="small muted">'+esc(a.type)+' · 接入于 '+esc(a.time)+'</div></td>' +
        '<td>'+tag(a.platform)+' / '+tag(a.type)+'</td>' +
        '<td class="small"><code>'+esc(a.api)+'</code><div class="small muted">App ID：'+esc(a.appId)+'</div></td>' +
        '<td>'+scenes+'</td>' +
        '<td class="small">调用 '+a.calls.toLocaleString()+' · 成功率 '+esc(a.successRate)+'</td>' +
        '<td>'+st(a.status)+'</td>' +
        '<td class="row-actions">'+act+'</td></tr>';
    }).join('') || '<tr><td colspan="7" class="small muted">暂无外部接入，点击「新增接入」配置</td></tr>';
  }

  /* --- Tab2 Dify 连接配置 --- */
  var df = DB.difyConfig;
  var b1 = document.getElementById('df-base'); if(b1) b1.value = df.base;
  var kk = document.getElementById('df-key'); if(kk) kk.value = df.key;
  var w1 = document.getElementById('df-ws'); if(w1) w1.value = df.ws;
  var kbSel = document.getElementById('df-kb');
  if(kbSel){
    var kbs = ['宏观经济知识库','新能源产业知识库','企业财务知识库','通用智库知识库'];
    if(kbs.indexOf(df.kb) < 0) kbs.unshift(df.kb);
    kbSel.innerHTML = kbs.map(function(k){ return '<option'+(k===df.kb?' selected':'')+'>'+esc(k)+'</option>'; }).join('');
  }
  var sb = document.getElementById('df-status-box');
  if(sb){
    var ok = df.status === '已连接';
    sb.className = 'alert '+(ok?'success':'info')+' mt12';
    sb.innerHTML = ico(ok?'i-check':'i-key') + ' ' + (ok
      ? '已连接：'+esc(df.ws||'')+' · 上次测试 '+esc(df.lastTest||'—')
      : '未连接：保存并测试通过后即可创建 Agent / 工作流。');
  }

  /* --- 工作区概览 KPI --- */
  function setKpi(id, v){ var el = document.getElementById(id); if(el) el.textContent = v; }
  setKpi('agentapp-kpi', DB.agentApps.length);
  setKpi('wf-kpi', DB.workflows.length);
  setKpi('wfpub-kpi', DB.workflows.filter(function(w){ return w.status==='已发布'; }).length);
  setKpi('wfm-kpi', DB.agentApps.length ? (DB.agentApps[0].model||'-') : '-');

  /* --- Agent 应用表格 --- */
  var tb2 = document.getElementById('tbody-agent-apps');
  if(tb2){
    tb2.innerHTML = DB.agentApps.map(function(a){
      var wf = DB.workflows.find(function(w){ return w.id===a.wf; });
      var scenes = a.scenes.map(function(s){ return tag(s, s==='报告'?'brand':''); }).join(' ');
      var act = link('编辑',"editAgentApp('"+a.id+"')") + ' ' + link('测试',"testAgentApp('"+a.id+"')") + ' ' + link(a.status==='启用'?'停用':'启用',"toggleAgentApp('"+a.id+"')") + ' ' + link('删除',"delAgentApp('"+a.id+"')");
      return '<tr><td><b>'+esc(a.name)+'</b><div class="small muted">创建于 '+esc(a.time)+'</div></td>' +
        '<td>'+tag(a.type)+'</td>' +
        '<td class="small">'+esc(a.provider||'-')+'<br><code>'+esc(a.model||'-')+'</code></td>' +
        '<td>'+scenes+'</td>' +
        '<td>'+(wf?tag(wf.name,'brand'):'<span class="small muted">—</span>')+'</td>' +
        '<td class="small">调用 '+a.calls.toLocaleString()+' · 成功率 '+esc(a.successRate)+'</td>' +
        '<td>'+st(a.status)+'</td>' +
        '<td class="row-actions">'+act+'</td></tr>';
    }).join('') || '<tr><td colspan="8" class="small muted">暂无 Agent 应用，点击「新增 Agent」创建</td></tr>';
  }

  /* --- 工作流画布 --- */
  wfPalette();
  renderWfSelect();
  renderWfCanvas();
  bindWfCanvas();

  /* --- 用户端引擎下拉 --- */
  fillEngineSelects();
}

/* =========================================================
   外部 Agent / 工作流接入（Tab1）
   ========================================================= */
function extAgentFormHtml(a){
  a = a || {};
  var platforms = ['Coze','Dify','其他（OpenAI 兼容）'];
  var types = ['Agent','工作流'];
  var scenes = ['检索','解析','报告'];
  return '<div class="form-grid">' +
    '<div class="field"><label>接入名称</label><input class="input" id="ea_name" value="'+esc(a.name||'')+'" placeholder="如 Coze 行业研究 Agent"></div>' +
    '<div class="field"><label>平台</label><select class="select" id="ea_platform">'+platforms.map(function(p){ return '<option'+(p===a.platform?' selected':'')+'>'+p+'</option>'; }).join('')+'</select></div>' +
    '<div class="field"><label>类型</label><select class="select" id="ea_type">'+types.map(function(t){ return '<option'+(t===a.type?' selected':'')+'>'+t+'</option>'; }).join('')+'</select></div>' +
    '<div class="field"><label>状态</label><select class="select" id="ea_status"><option'+(a.status!=='停用'?' selected':'')+'>启用</option><option'+(a.status==='停用'?' selected':'')+'>停用</option></select></div>' +
    '<div class="field" style="grid-column:1/-1"><label>API 端点地址</label><input class="input" id="ea_api" value="'+esc(a.api||'')+'" placeholder="https://api.coze.cn/open_api/v2/chat"></div>' +
    '<div class="field"><label>API Key / Token</label><input class="input" id="ea_key" type="password" value="'+esc(a.key||'')+'"></div>' +
    '<div class="field"><label>应用 / 工作流 ID</label><input class="input" id="ea_appid" value="'+esc(a.appId||'')+'"></div>' +
    '</div>' +
    '<div class="field mt12"><label>触发场景（决定用户端哪个功能调用，可多选）</label><div class="flex wrap">' +
    scenes.map(function(s){ return '<label class="checkbox"><input type="checkbox" value="'+s+'"'+((a.scenes&&a.scenes.length)?(a.scenes.indexOf(s)>-1?' checked':''):' checked')+'><span>'+s+'</span></label>'; }).join('') +
    '</div></div>';
}
function addExtAgent(){
  EXT_EDIT_ID = null;
  formModal('新增外部 Agent / 工作流接入', extAgentFormHtml(null), '保存', saveExtAgent);
}
function editExtAgent(id){
  var a = DB.extAgents.find(function(x){ return x.id===id; }); if(!a) return;
  EXT_EDIT_ID = id;
  formModal('编辑外部接入：'+a.name, extAgentFormHtml(a), '保存', saveExtAgent);
}
function saveExtAgent(){
  var nm = document.getElementById('ea_name');
  if(!nm || !nm.value.trim()){ toast('请填写接入名称','warning'); return; }
  var scenes = [];
  document.querySelectorAll('#modalBody .checkbox input:checked').forEach(function(c){ scenes.push(c.value); });
  if(!scenes.length){ toast('请至少选择一个触发场景','warning'); return; }
  var d = {
    name: nm.value.trim(),
    platform: document.getElementById('ea_platform').value,
    type: document.getElementById('ea_type').value,
    api: document.getElementById('ea_api').value.trim(),
    key: document.getElementById('ea_key').value.trim(),
    appId: document.getElementById('ea_appid').value.trim(),
    scenes: scenes,
    status: document.getElementById('ea_status').value
  };
  if(EXT_EDIT_ID){
    var a = DB.extAgents.find(function(x){ return x.id===EXT_EDIT_ID; });
    if(a) Object.keys(d).forEach(function(k){ a[k] = d[k]; });
    toast('已保存外部接入：'+d.name);
  } else {
    DB.extAgents.unshift(Object.assign({id:'ea'+Date.now(), calls:0, successRate:'—', time:nowStr()}, d));
    toast('已新增外部接入：'+d.name);
  }
  EXT_EDIT_ID = null;
  rAgent();
  closeModal();
}
function testExtAgent(id){
  var a = DB.extAgents.find(function(x){ return x.id===id; }); if(!a) return;
  if(a.status!=='启用'){ toast('该接入已停用，请先启用再测试','warning'); return; }
  a.lastTest = nowStr();
  formModal('连通性测试：'+a.name,
    '<p class="small" style="line-height:1.8">平台：<b>'+esc(a.platform)+'</b> · 类型：<b>'+esc(a.type)+'</b><br>端点：<code>'+esc(a.api)+'</code><br>应用 / 工作流 ID：<code>'+esc(a.appId)+'</code></p>' +
    '<div class="alert success mt12">'+ico('i-check')+' 连接成功：鉴权通过，返回 200 OK（延迟 286ms），可正常被用户端调用。</div>',
    '关闭', null);
  rAgent();
}
function toggleExtAgent(id){
  var a = DB.extAgents.find(function(x){ return x.id===id; }); if(!a) return;
  a.status = a.status==='启用' ? '停用' : '启用';
  rAgent();
  toast('已'+(a.status==='启用'?'启用':'停用')+'：'+a.name);
}
function delExtAgent(id){
  var a = DB.extAgents.find(function(x){ return x.id===id; }); if(!a) return;
  confirm2('确认删除外部接入「'+a.name+'」？删除后用户端将无法调用。', function(){
    DB.extAgents = DB.extAgents.filter(function(x){ return x.id!==id; });
    rAgent();
  });
}

/* =========================================================
   Dify 连接配置（Tab2）
   ========================================================= */
function saveDifyConfig(){
  var b = document.getElementById('df-base');
  var k = document.getElementById('df-key');
  var w = document.getElementById('df-ws');
  var kb = document.getElementById('df-kb');
  var df = DB.difyConfig;
  if(b) df.base = b.value.trim();
  if(k) df.key = k.value.trim();
  if(w) df.ws = w.value.trim();
  if(kb) df.kb = kb.value;
  if(!df.base || !df.key){ toast('请填写 API Base URL 与 API Key','warning'); return; }
  df.status = '已连接';
  df.lastTest = nowStr();
  rAgent();
  toast('Dify 配置已保存并连接成功');
}
function testDifyConn(){
  var b = document.getElementById('df-base');
  var k = document.getElementById('df-key');
  if(!b || !b.value.trim() || !k || !k.value.trim()){ toast('请先填写 API Base URL 与 API Key','warning'); return; }
  var df = DB.difyConfig;
  df.base = b.value.trim();
  df.key = k.value.trim();
  var w = document.getElementById('df-ws');
  if(w) df.ws = w.value.trim();
  df.status = '已连接';
  df.lastTest = nowStr();
  rAgent();
  toast('Dify API 连接测试成功（延迟 240ms）');
}

/* =========================================================
   Agent 应用（平台内创建，Tab2）
   ========================================================= */
function agentAppFormHtml(a){
  a = a || {};
  var scenes = ['检索','解析','报告'];
  var models = DB.aiConfig.providers.map(function(p){
    return {id:p.id, label:p.vendor+' · '+p.model, model:p.model};
  });
  return '<div class="form-grid">' +
    '<div class="field"><label>Agent 名称</label><input class="input" id="aa_name" value="'+esc(a.name||'')+'" placeholder="如 智能检索解析助手"></div>' +
    '<div class="field"><label>类型</label><select class="select" id="aa_type"><option'+(a.type!=='工作流型 Agent'?' selected':'')+'>对话型 Agent</option><option'+(a.type==='工作流型 Agent'?' selected':'')+'>工作流型 Agent</option></select></div>' +
    '<div class="field"><label>绑定模型</label><select class="select" id="aa_model">' + models.map(function(m){
      var sel = (a.model && a.model===m.model) || (!a.model && m.model==='gpt-4o');
      return '<option value="'+m.id+'"'+(sel?' selected':'')+'>'+esc(m.label)+'</option>';
    }).join('') + '</select></div>' +
    '<div class="field"><label>状态</label><select class="select" id="aa_status"><option'+(a.status!=='停用'?' selected':'')+'>启用</option><option'+(a.status==='停用'?' selected':'')+'>停用</option></select></div>' +
    '<div class="field" style="grid-column:1/-1"><label>关联工作流（工作流型 Agent 可选）</label><select class="select" id="aa_wf"><option value="">— 不关联 —</option>'+DB.workflows.map(function(w){ return '<option value="'+w.id+'"'+(a.wf===w.id?' selected':'')+'>'+esc(w.name)+'</option>'; }).join('')+'</select></div>' +
    '</div>' +
    '<div class="field mt12"><label>触发场景（决定用户端哪个功能调用，可多选）</label><div class="flex wrap">' +
    scenes.map(function(s){ return '<label class="checkbox"><input type="checkbox" value="'+s+'"'+((a.scenes&&a.scenes.length)?(a.scenes.indexOf(s)>-1?' checked':''):' checked')+'><span>'+s+'</span></label>'; }).join('') +
    '</div></div>';
}
function addAgentApp(){
  APP_EDIT_ID = null;
  formModal('新增 Agent 应用', agentAppFormHtml(null), '创建', saveAgentApp);
}
function editAgentApp(id){
  var a = DB.agentApps.find(function(x){ return x.id===id; }); if(!a) return;
  APP_EDIT_ID = id;
  formModal('编辑 Agent 应用：'+a.name, agentAppFormHtml(a), '保存', saveAgentApp);
}
function saveAgentApp(){
  var nm = document.getElementById('aa_name');
  if(!nm || !nm.value.trim()){ toast('请填写 Agent 名称','warning'); return; }
  var scenes = [];
  document.querySelectorAll('#modalBody .checkbox input:checked').forEach(function(c){ scenes.push(c.value); });
  if(!scenes.length){ toast('请至少选择一个触发场景','warning'); return; }
  var mSel = document.getElementById('aa_model');
  var p = DB.aiConfig.providers.find(function(x){ return x.id===mSel.value; });
  var d = {
    name: nm.value.trim(),
    type: document.getElementById('aa_type').value,
    model: p ? p.model : 'gpt-4o',
    provider: p ? p.vendor : 'OpenAI',
    scenes: scenes,
    wf: document.getElementById('aa_wf').value,
    status: document.getElementById('aa_status').value
  };
  if(APP_EDIT_ID){
    var a = DB.agentApps.find(function(x){ return x.id===APP_EDIT_ID; });
    if(a) Object.keys(d).forEach(function(k){ a[k] = d[k]; });
    toast('已保存 Agent 应用：'+d.name);
  } else {
    DB.agentApps.unshift(Object.assign({id:'aa'+Date.now(), calls:0, successRate:'—', time:nowStr()}, d));
    toast('已新增 Agent 应用：'+d.name);
  }
  APP_EDIT_ID = null;
  rAgent();
  closeModal();
}
function testAgentApp(id){
  var a = DB.agentApps.find(function(x){ return x.id===id; }); if(!a) return;
  if(DB.difyConfig.status!=='已连接'){ toast('请先在「Dify 连接配置」中保存并测试连接','warning'); return; }
  a.calls = (a.calls||0)+1;
  formModal('Agent 测试：'+a.name,
    '<p class="small" style="line-height:1.8">类型：<b>'+esc(a.type)+'</b> · 模型：<b>'+esc(a.model)+'</b><br>触发场景：'+a.scenes.map(function(s){ return tag(s); }).join(' ')+'</p>' +
    '<div class="alert success mt12">'+ico('i-check')+' 测试通过：Dify 执行引擎返回正常响应（延迟 318ms）。</div>',
    '关闭', null);
  rAgent();
}
function toggleAgentApp(id){
  var a = DB.agentApps.find(function(x){ return x.id===id; }); if(!a) return;
  a.status = a.status==='启用' ? '停用' : '启用';
  rAgent();
  toast('已'+(a.status==='启用'?'启用':'停用')+'：'+a.name);
}
function delAgentApp(id){
  var a = DB.agentApps.find(function(x){ return x.id===id; }); if(!a) return;
  confirm2('确认删除 Agent 应用「'+a.name+'」？', function(){
    DB.agentApps = DB.agentApps.filter(function(x){ return x.id!==id; });
    rAgent();
  });
}

/* =========================================================
   工作流画布
   ========================================================= */
function wfPalette(){
  var el = document.getElementById('wf-node-palette');
  if(!el) return;
  el.innerHTML = WFNODES.map(function(n){
    return '<div class="wf-palette-item" onclick="addWfNode(\''+n.type+'\')">' +
      '<span class="ic" style="background:'+n.color+'">'+ico(n.ico,13)+'</span>' +
      '<span><b>'+n.name+'</b><div class="small">'+n.cat+' · 点击添加</div></span></div>';
  }).join('');
}
function renderWfSelect(){
  var sel = document.getElementById('wf-select');
  if(!sel) return;
  if(WF_CUR && !DB.workflows.some(function(w){ return w.id===WF_CUR; })) WF_CUR = null;
  var cur = WF_CUR || (DB.workflows.length ? DB.workflows[0].id : null);
  sel.innerHTML = DB.workflows.map(function(w){
    return '<option value="'+w.id+'"'+(w.id===cur?' selected':'')+'>'+esc(w.name)+'</option>';
  }).join('') || '<option value="">暂无工作流</option>';
  WF_CUR = cur;
}
function wfCur(){
  if(!WF_CUR && DB.workflows.length) WF_CUR = DB.workflows[0].id;
  return DB.workflows.find(function(w){ return w.id===WF_CUR; }) || null;
}
function selectWorkflow(){
  var sel = document.getElementById('wf-select');
  if(sel && sel.value) WF_CUR = sel.value;
  renderWfCanvas();
}
function addWorkflow(){
  formModal('新增工作流', '<div class="field"><label>工作流名称</label><input class="input" id="wf_name" placeholder="如 行业报告自动生成流水线"></div><div class="alert info mt12">'+ico('i-link')+' 创建后可在画布中添加节点并连线编排。</div>', '创建', function(){
    var nm = document.getElementById('wf_name');
    if(!nm || !nm.value.trim()){ toast('请填写工作流名称','warning'); return; }
    var w = {id:'wf'+Date.now(), name:nm.value.trim(), version:1, status:'草稿', updated:nowStr(), runs:0, nodes:[], edges:[]};
    DB.workflows.push(w);
    WF_CUR = w.id;
    renderWfSelect();
    renderWfCanvas();
    toast('已新增工作流：'+w.name);
  });
}
function saveWorkflow(){
  var w = wfCur(); if(!w){ toast('请先选择工作流','warning'); return; }
  w.updated = nowStr();
  if(w.status!=='已发布') w.status = '草稿';
  renderWfCanvas();
  toast('已保存工作流：'+w.name+'（节点 '+w.nodes.length+' · 连线 '+w.edges.length+'）');
}
function runWorkflow(){
  var w = wfCur(); if(!w){ toast('请先选择工作流','warning'); return; }
  if(!w.nodes.length){ toast('画布为空，请先添加节点','warning'); return; }
  w.runs = (w.runs||0)+1;
  w.updated = nowStr();
  if(SESSION && SESSION.user){
    var id = 'T-'+nowStr().replace(/[-: ]/g,'')+'-WF';
    DB.tasks.unshift({id:id, type:'工作流运行 · '+w.name, by:SESSION.user.account, status:'执行中', progress:30, created:nowStr()});
    rAdminTasks();
  }
  renderWfCanvas();
  toast('工作流运行测试已发起：'+w.name+'（可在任务中心查看）');
}
function publishWorkflow(){
  var w = wfCur(); if(!w){ toast('请先选择工作流','warning'); return; }
  if(!w.nodes.length){ toast('画布为空，无法发布','warning'); return; }
  w.version = (w.version||1)+1;
  w.status = '已发布';
  w.updated = nowStr();
  renderWfCanvas();
  toast('已发布新版本 v'+w.version+'：'+w.name+'，可被用户端场景调用');
}

/* ---------- 画布渲染 ---------- */
function renderWfCanvas(){
  var w = wfCur();
  var canvas = document.getElementById('wf-canvas');
  var empty = document.getElementById('wf-empty');
  var edgeG = document.getElementById('wf-edge-g');
  var nodesEl = document.getElementById('wf-nodes');
  var ver = document.getElementById('wf-version');
  if(ver) ver.textContent = w ? ('v'+w.version) : '—';
  if(!w){
    if(edgeG) edgeG.innerHTML = '';
    if(nodesEl) nodesEl.innerHTML = '';
    if(empty) empty.style.display = 'flex';
    renderWfConfig(null);
    return;
  }
  if(empty) empty.style.display = w.nodes.length ? 'none' : 'flex';
  if(edgeG){
    edgeG.innerHTML = w.edges.map(function(e){
      var f = w.nodes.find(function(n){ return n.id===e.from; });
      var t = w.nodes.find(function(n){ return n.id===e.to; });
      if(!f || !t) return '';
      var x1 = f.x + 180, y1 = f.y + 34;
      var x2 = t.x, y2 = t.y + 34;
      var mid = (x1 + x2) / 2;
      var d = 'M'+x1+' '+y1+' C'+mid+' '+y1+', '+mid+' '+y2+', '+x2+' '+y2;
      return '<path class="wf-edge" id="edge-'+e.id+'" d="'+d+'" onclick="delWfEdge(\''+e.id+'\')"></path>';
    }).join('');
  }
  if(nodesEl){
    nodesEl.innerHTML = w.nodes.map(function(n){
      var t = WFNODES.find(function(x){ return x.type===n.type; });
      var color = t ? t.color : '#5b6272';
      var icn = t ? t.ico : 'i-doc';
      var sel = n.id===WF_SEL ? ' selected' : '';
      var cfg = '';
      if(n.type==='start') cfg = '流程入口';
      else if(n.type==='end') cfg = '流程出口';
      else {
        var keys = Object.keys(n.config||{});
        cfg = keys.length ? keys.slice(0,2).map(function(k){ return k+'：'+n.config[k]; }).join(' · ') : '默认参数';
      }
      return '<div class="wf-node'+sel+'" id="node-'+n.id+'" style="left:'+n.x+'px;top:'+n.y+'px" onmousedown="startWfDrag(event,\''+n.id+'\')">' +
        '<button class="wf-node-del" onclick="event.stopPropagation();delWfNode(\''+n.id+'\')">×</button>' +
        '<div class="wf-node-head"><span class="ic" style="background:'+color+'">'+ico(icn,13)+'</span>' +
        '<span><div class="wf-node-name">'+esc(n.name)+'</div><div class="wf-node-type">'+esc(n.type)+'</div></span></div>' +
        '<div class="wf-node-body">'+esc(cfg)+'</div>' +
        (n.type!=='start' ? '<span class="wf-port in" onclick="event.stopPropagation();finishWfLink(\''+n.id+'\')"></span>' : '') +
        (n.type!=='end' ? '<span class="wf-port out" onclick="event.stopPropagation();startWfLink(\''+n.id+'\')"></span>' : '') +
        '</div>';
    }).join('');
  }
  var selNode = WF_SEL ? w.nodes.find(function(n){ return n.id===WF_SEL; }) : null;
  renderWfConfig(selNode);
}
function bindWfCanvas(){
  var c = document.getElementById('wf-canvas');
  if(!c || WF_BOUND) return;
  WF_BOUND = true;
  c.addEventListener('click', function(ev){
    if(ev.target === c || ev.target.id==='wf-svg' || ev.target.id==='wf-edge-g' || ev.target.id==='wf-nodes'){
      if(WF_LINK_FROM){ WF_LINK_FROM = null; c.classList.remove('linking'); toast('已取消连线','warning'); }
      else if(WF_SEL){ WF_SEL = null; renderWfCanvas(); }
    }
  });
}

/* ---------- 节点拖拽 ---------- */
function startWfDrag(ev, id){
  var w = wfCur(); if(!w) return;
  var n = w.nodes.find(function(x){ return x.id===id; }); if(!n) return;
  if(ev.target.closest && (ev.target.closest('.wf-port') || ev.target.closest('.wf-node-del'))) return;
  ev.preventDefault();
  WF_SEL = id;
  renderWfConfig(n);
  document.querySelectorAll('#wf-nodes .wf-node.selected').forEach(function(el0){ el0.classList.remove('selected'); });
  var canvas = document.getElementById('wf-canvas');
  var cr = canvas.getBoundingClientRect();
  WF_DRAG = {node:n, dx: ev.clientX - (cr.left + n.x), dy: ev.clientY - (cr.top + n.y)};
  var el = document.getElementById('node-'+id);
  if(el){ el.classList.add('dragging'); el.classList.add('selected'); }
  function mv(e){
    if(!WF_DRAG) return;
    var rect = document.getElementById('wf-canvas').getBoundingClientRect();
    var nx = Math.max(0, Math.min(rect.width - 190, e.clientX - rect.left - WF_DRAG.dx));
    var ny = Math.max(0, Math.min(rect.height - 90, e.clientY - rect.top - WF_DRAG.dy));
    WF_DRAG.node.x = Math.round(nx);
    WF_DRAG.node.y = Math.round(ny);
    var el2 = document.getElementById('node-'+id);
    if(el2){ el2.style.left = nx+'px'; el2.style.top = ny+'px'; }
    updateWfEdges(w);
  }
  function up(){
    document.removeEventListener('mousemove', mv);
    document.removeEventListener('mouseup', up);
    var el3 = document.getElementById('node-'+id);
    if(el3) el3.classList.remove('dragging');
    WF_DRAG = null;
  }
  document.addEventListener('mousemove', mv);
  document.addEventListener('mouseup', up);
}
function updateWfEdges(w){
  var edgeG = document.getElementById('wf-edge-g');
  if(!edgeG || !w) return;
  w.edges.forEach(function(e){
    var f = w.nodes.find(function(n){ return n.id===e.from; });
    var t = w.nodes.find(function(n){ return n.id===e.to; });
    if(!f || !t) return;
    var x1 = f.x+180, y1 = f.y+34, x2 = t.x, y2 = t.y+34, mid = (x1+x2)/2;
    var p = document.getElementById('edge-'+e.id);
    if(p) p.setAttribute('d', 'M'+x1+' '+y1+' C'+mid+' '+y1+', '+mid+' '+y2+', '+x2+' '+y2);
  });
}

/* ---------- 节点与连线操作 ---------- */
function addWfNode(type){
  var w = wfCur();
  if(!w){ toast('请先新增或选择一个工作流','warning'); return; }
  var t = WFNODES.find(function(x){ return x.type===type; });
  if(!t) return;
  var count = w.nodes.length;
  var x = 40 + (count % 3) * 220;
  var y = 60 + Math.floor(count / 3) * 130;
  var id = 'n' + (++WF_NODE_SEQ);
  var node = {id:id, type:type, name:t.name, x:x, y:y, config:{}};
  Object.keys(t.def || {}).forEach(function(k){ node.config[k] = t.def[k]; });
  w.nodes.push(node);
  var prev = w.nodes[w.nodes.length - 2];
  if(prev && prev.type !== 'end' && type !== 'start'){
    w.edges.push({id:'e'+Date.now(), from:prev.id, to:node.id, label:''});
  }
  renderWfCanvas();
  selectWfNode(node.id);
}
function selectWfNode(id){
  WF_SEL = id;
  var w = wfCur(); if(!w) return;
  document.querySelectorAll('#wf-nodes .wf-node').forEach(function(el){ el.classList.remove('selected'); });
  var el = document.getElementById('node-'+id);
  if(el) el.classList.add('selected');
  renderWfConfig(w.nodes.find(function(n){ return n.id===id; }));
}
function renderWfConfig(node){
  var box = document.getElementById('wf-config');
  if(!box) return;
  if(!node){
    box.innerHTML = '<div class="small muted">点击画布节点进行参数配置；点击连线可删除。</div>';
    return;
  }
  var h = '<div class="flex between mb8"><b>'+esc(node.name)+'</b><button class="btn sm" onclick="delWfNode(\''+node.id+'\')">删除</button></div>';
  if(node.type==='start' || node.type==='end'){
    h += '<div class="small muted" style="line-height:1.7">' + (node.type==='start'
      ? '流程入口节点：作为工作流的触发起点，由用户端场景调用。'
      : '流程出口节点：汇聚结果并输出到调用方。') + '</div>';
    box.innerHTML = h;
    return;
  }
  h += '<div class="field"><label>节点名称</label><input class="input" id="wfn_name" value="'+esc(node.name)+'"></div>';
  var cfg = node.config || {};
  Object.keys(cfg).forEach(function(k){
    var v = cfg[k];
    if(typeof v === 'boolean'){
      h += '<label class="flex mb8"><input type="checkbox" id="wfn_cfg_'+k+'"'+(v?' checked':'')+'> '+esc(k)+'</label>';
    } else {
      h += '<div class="field"><label>'+esc(k)+'</label><input class="input" id="wfn_cfg_'+k+'" value="'+esc(v)+'"></div>';
    }
  });
  h += '<button class="btn sm primary" onclick="saveWfNodeConfig(\''+node.id+'\')">保存节点配置</button>';
  box.innerHTML = h;
}
function saveWfNodeConfig(id){
  var w = wfCur(); if(!w) return;
  var n = w.nodes.find(function(x){ return x.id===id; }); if(!n) return;
  var nm = document.getElementById('wfn_name');
  if(nm && nm.value.trim()) n.name = nm.value.trim();
  Object.keys(n.config||{}).forEach(function(k){
    var el = document.getElementById('wfn_cfg_'+k);
    if(!el) return;
    if(el.type === 'checkbox') n.config[k] = el.checked;
    else n.config[k] = el.value;
  });
  renderWfCanvas();
  toast('已保存节点配置：'+n.name);
}
function delWfNode(id){
  var w = wfCur(); if(!w) return;
  confirm2('删除节点「'+id+'」及关联连线？', function(){
    w.nodes = w.nodes.filter(function(n){ return n.id!==id; });
    w.edges = w.edges.filter(function(e){ return e.from!==id && e.to!==id; });
    if(WF_SEL===id) WF_SEL = null;
    renderWfCanvas();
  });
}
function delWfEdge(id){
  var w = wfCur(); if(!w) return;
  w.edges = w.edges.filter(function(e){ return e.id!==id; });
  renderWfCanvas();
  toast('已删除连线');
}

/* ---------- 连线 ---------- */
function startWfLink(id){
  var w = wfCur(); if(!w) return;
  var canvas = document.getElementById('wf-canvas');
  WF_LINK_FROM = {node:id};
  canvas.classList.add('linking');
  toast('请点击目标节点的「输入端口」完成连线');
}
function finishWfLink(id){
  var w = wfCur(); if(!w) return;
  var canvas = document.getElementById('wf-canvas');
  if(!WF_LINK_FROM){ return; }
  if(WF_LINK_FROM.node === id){
    WF_LINK_FROM = null;
    canvas.classList.remove('linking');
    toast('已取消连线','warning');
    return;
  }
  var dup = w.edges.some(function(e){ return e.from===WF_LINK_FROM.node && e.to===id; });
  if(dup){
    toast('两点之间已存在连线','warning');
    WF_LINK_FROM = null;
    canvas.classList.remove('linking');
    return;
  }
  w.edges.push({id:'e'+Date.now(), from:WF_LINK_FROM.node, to:id, label:''});
  WF_LINK_FROM = null;
  canvas.classList.remove('linking');
  renderWfCanvas();
  toast('已建立连线');
}

/* =========================================================
   用户端引擎联动（智能检索 / AI 解析 / 报告生成）
   ========================================================= */
function engineList(){
  var list = [];
  DB.extAgents.forEach(function(a){
    if(a.status==='启用') list.push({kind:'external', id:a.id, name:a.name, platform:a.platform, type:a.type, scenes:a.scenes||[]});
  });
  DB.agentApps.forEach(function(a){
    if(a.status==='启用') list.push({kind:'app', id:a.id, name:a.name, platform:'Dify', type:a.type, scenes:a.scenes||[]});
  });
  return list;
}
function engineOptions(scene){
  var sceneZh = {search:'检索', insight:'解析', report:'报告'}[scene] || '';
  var list = engineList().filter(function(e){ return !sceneZh || e.scenes.indexOf(sceneZh)>-1; });
  var labels = {search:'平台默认检索引擎', insight:'平台默认解析引擎', report:'平台默认报告引擎'};
  var html = '<option value="">'+(labels[scene]||'平台默认')+'</option>';
  html += list.map(function(e){
    return '<option value="'+e.kind+':'+e.id+'">'+esc(e.name)+'（'+esc(e.platform)+' · '+esc(e.type)+'）</option>';
  }).join('');
  return html;
}
function fillEngineSelects(){
  var s1 = document.getElementById('se-engine');
  if(s1) s1.innerHTML = engineOptions('search');
  var s2 = document.getElementById('insight-agent');
  if(s2) s2.innerHTML = engineOptions('insight');
  var s3 = document.getElementById('agent-report-engine');
  if(s3) s3.innerHTML = engineOptions('report');
  var s4 = document.getElementById('report-engine');
  if(s4) s4.innerHTML = engineOptions('report');
}
function engineFromSelect(id){
  var el = document.getElementById(id);
  return el ? el.value : '';
}
function engineLabel(kv){
  if(!kv) return '平台默认引擎';
  var parts = kv.split(':');
  if(parts.length < 2) return kv;
  var list = engineList();
  var e = list.find(function(x){ return x.kind===parts[0] && x.id===parts.slice(1).join(':'); });
  return e ? e.name : kv;
}
function countEngineCall(kv){
  if(!kv) return;
  var parts = kv.split(':');
  if(parts.length < 2) return;
  var id = parts.slice(1).join(':');
  if(parts[0]==='external'){
    var a = DB.extAgents.find(function(x){ return x.id===id; });
    if(a) a.calls = (a.calls||0)+1;
  } else if(parts[0]==='app'){
    var b = DB.agentApps.find(function(x){ return x.id===id; });
    if(b) b.calls = (b.calls||0)+1;
  }
}

/* ---------- 用户端功能联动覆盖 ---------- */
function rerunSearch(){
  var res = document.getElementById('tbody-smart-results');
  if(res){
    res.innerHTML = [
      ['世界银行 WDI','1,284','1.2s','成功'],
      ['国家统计局','896','0.8s','成功'],
      ['本地知识库','42','0.3s','成功']
    ].map(function(r){
      return '<tr><td>'+r[0]+'</td><td class="num">'+r[1]+'</td><td class="num">'+r[2]+'</td><td>'+st(r[3])+'</td></tr>';
    }).join('');
  }
  var eng = engineFromSelect('se-engine');
  if(eng) countEngineCall(eng);
  if(SESSION && SESSION.user){
    var id = 'T-'+nowStr().replace(/[-: ]/g,'')+'-SE';
    DB.tasks.unshift({id:id, type:'智能检索'+(eng?' · '+engineLabel(eng):''), by:SESSION.user.account, status:'成功', progress:100, created:nowStr()});
    rAdminTasks();
  }
  toast(eng
    ? '已通过「'+engineLabel(eng)+'」发起智能检索：3 个数据源并行返回，共命中 2,222 条'
    : '已重新并行检索：3 个数据源同步返回，共命中 2,222 条');
}
function regenerateInsight(){
  var el = document.getElementById('insight-text');
  if(el){
    el.innerHTML = '<b>要点：</b>2020-2025 年间，中国 GDP 平均增速 <b>4.9%</b>，美国 <b>2.4%</b>；' +
      '中国增速在 2022 年触底（3.0%）后持续回升，2025 年达 <b>5.1%</b>；' +
      '中美 GDP 差距（美元计）由 2020 年的 6.1 万亿美元扩大至 2025 年的 6.6 万亿美元。<br><br>' +
      '<b>建议：</b>可进一步按季度粒度分析增速拐点，或按行业拆解增长贡献（已基于最新数据重新生成）。';
  }
  var eng = engineFromSelect('insight-agent');
  if(eng) countEngineCall(eng);
  toast(eng ? '已通过「'+engineLabel(eng)+'」重新生成 AI 解读（基于最新数据）' : '已重新生成 AI 解读（基于最新数据）');
}
function sendAgentCmd(){
  if(!needUser()) return;
  var box = document.querySelector('#view-agent-report .search-box input');
  var cmd = box ? box.value.trim() : '';
  var eng = engineFromSelect('agent-report-engine');
  if(eng) countEngineCall(eng);
  var id = 'T-'+nowStr().replace(/[-: ]/g,'')+'-AG';
  DB.tasks.unshift({id:id, type:'报告生成'+(eng?' · '+engineLabel(eng):''), by:SESSION.user.account, status:'执行中', progress:10, created:nowStr()});
  rAdminTasks(); rTaskControl();
  if(box) box.value = '';
  var base = eng ? '已通过「'+engineLabel(eng)+'」接收指令' : 'Agent 已接收指令';
  toast(cmd ? (base+'：「'+cmd+'」，任务进入任务中心：'+id) : (base+'，任务进入任务中心：'+id));
}
function createReportTask(){
  if(!needUser()) return;
  var eng = engineFromSelect('report-engine');
  if(eng) countEngineCall(eng);
  var id = 'T-'+nowStr().replace(/[-: ]/g,'')+'-RP';
  DB.tasks.unshift({id:id, type:'报告生成'+(eng?' · '+engineLabel(eng):''), by:SESSION.user.account, status:'执行中', progress:5, created:nowStr()});
  rAiReport(); rAdminTasks(); rTaskControl();
  toast(eng
    ? '已通过「'+engineLabel(eng)+'」发起报告生成：'+id+'，可在任务中心查看进度'
    : '报告生成任务已创建：'+id+'，可在任务中心查看进度');
}

/* =========================================================
   闭环优化模块（v2 · 2026-08-10）
   依据 PRD 37 功能点复核闭环：
   1) 智能检索数据源与数据集上下架联动（U-03 ↔ A-07）
   2) 报告生成任务 → 自动入库「AI 成果库」与「我的报告」（U-08/U-09 ↔ U-10/U-15）
   3) 知识驳回状态同步到用户端（A-16 ↔ U-10/U-11/U-13）
   4) 支付订单支持多单闭环（U-16 ↔ U-17 ↔ A-03/A-20）
   ========================================================= */
function rSmartSearch(){
  // 外部数据源（静态 2 项）+ 平台内已上架数据集（联动 DB.datasets 上/下架）
  var ext = [
    {name:'世界银行 WDI', type:'外部 API', status:'可用', desc:'GDP / 人口 / 贸易'},
    {name:'IMF 世界经济展望', type:'外部 API', status:'可用', desc:'宏观预测数据'}
  ];
  var onShelf = DB.datasets.filter(function(d){ return d.status==='已上架'; });
  var platform = onShelf.map(function(d){
    return {name:d.name, type:'平台内', status:'已上架', desc:(d.sub||d.cat||'经数据接入审核')};
  });
  var all = ext.concat(platform);
  var src = document.getElementById('tbody-smart-sources');
  if(src){
    src.innerHTML = all.map(function(r){
      var t = r.type==='平台内' ? 'brand' : '';
      return '<tr><td><input type="checkbox" checked=""></td><td>'+esc(r.name)+'</td><td>'+tag(r.type,t)+'</td><td>'+st(r.status)+'</td><td class="small muted">'+esc(r.desc)+'</td></tr>';
    }).join('');
  }
  var k1=document.getElementById('kpi-src-total'), k2=document.getElementById('kpi-src-platform'), k3=document.getElementById('kpi-src-ext');
  if(k1) k1.textContent = all.length;
  if(k2) k2.textContent = platform.length;
  if(k3) k3.textContent = ext.length;
  var res = document.getElementById('tbody-smart-results');
  if(res){
    res.innerHTML = all.slice(0,6).map(function(r){
      var hit = Math.floor(400 + Math.random()*900);
      var cost = (0.4 + Math.random()*1.4).toFixed(1)+'s';
      return '<tr><td>'+esc(r.name)+'</td><td class="num">'+hit.toLocaleString()+'</td><td class="num">'+cost+'</td><td>'+st('成功')+'</td></tr>';
    }).join('');
  }
}
function createReportTask(){
  if(!needUser()) return;
  var eng = engineFromSelect('report-engine');
  if(eng) countEngineCall(eng);
  var id = 'T-'+nowStr().replace(/[-: ]/g,'')+'-RP';
  DB.tasks.unshift({id:id, type:'报告生成'+(eng?' · '+engineLabel(eng):''), by:SESSION.user.account, status:'执行中', progress:5, created:nowStr()});
  var nameEl = document.getElementById('report-name');
  var rname = (nameEl && nameEl.value.trim()) ? nameEl.value.trim() : ('AI分析报告-'+nowStr().slice(0,10));
  // 报告进入「我的报告」（U-15，生成中）
  DB.myReports.unshift({id:'mr'+Date.now(), name:rname, share:'仅自己可见', type:'Word', ver:'v1', time:nowStr(), status:'生成中'});
  // 报告自动入库「AI 成果库」（U-10，复核中，待管理端 A-16 审核）
  DB.kbEntries.unshift({id:'k'+Date.now(), title:rname, type:'AI成果', owner:SESSION.user.name, time:nowStr(), status:'复核中', score:0.8+Math.random()*0.15, scope:'公开'});
  rAiReport(); rKbAchievements(); rKbIngest(); rAdminTasks(); rTaskControl();
  toast(eng
    ? '已通过「'+engineLabel(eng)+'」发起报告生成：'+id+'，完成后自动入库「AI 成果库」与「我的报告」'
    : '报告生成任务已创建：'+id+'，完成后自动入库「AI 成果库」与「我的报告」');
}
function rejectKb(id){
  if(!needAdmin()) return;
  var k=DB.kbReviewQueue.find(function(x){return x.id===id;}); if(!k) return;
  confirm2('驳回知识条目「'+k.title+'」将通知提交人。确认驳回？', function(){
    k.status='已驳回';
    var e=DB.kbEntries.find(function(x){return x.title===k.title;});
    if(e){ e.status='已驳回'; }
    rKbReview(); rKbAchievements(); rKbIngest(); rKbManage();
    toast('已驳回：引用来源缺失，已通知提交人，提交人可在「知识库内容维护」查看驳回状态');
  });
}
function syncPayPanel(){
  var o = DB.orders.find(function(x){ return x.status==='待支付'; }) || DB.orders[0] || null;
  var noEl=document.getElementById('pay-order-no'), amtEl=document.getElementById('pay-amount'), memEl=document.getElementById('pay-mem');
  if(noEl) noEl.textContent = o ? o.id : '—';
  if(amtEl) amtEl.textContent = o ? money(o.amount) : '—';
  if(memEl) memEl.textContent = o ? (o.title||'会员缴费') : '—';
}
function doPay(){
  if(!needUser()) return;
  var sel = document.querySelector('#view-pay .field select');
  var ch = sel ? sel.value : '微信支付';
  var o = DB.orders.find(function(x){ return x.status==='待支付'; });
  if(!o){
    o = {id:'ORD'+nowStr().replace(/[-: ]/g,''), user:SESSION.user.account, title:'会员缴费 · 专业版年费', amount:499, channel:ch, status:'待支付', time:nowStr().slice(0,10)+' '+nowStr().slice(11,16)};
    DB.orders.unshift(o);
  }
  formModal('确认支付',
    '<div class="kpi" style="margin-bottom:12px"><div><div class="lbl">订单号</div><div class="val" style="font-size:18px">'+esc(o.id)+'</div></div></div>'+
    '<div class="grid cols-2 mb12"><div class="field"><label>支付方式</label><div class="small" style="font-size:18px;font-weight:800">'+esc(ch)+'</div></div><div class="field"><label>金额</label><div class="small" style="font-size:18px;font-weight:900">'+money(o.amount)+'</div></div></div>'+
    '<div class="alert info"><svg width="14" height="14" style="vertical-align:-2px"><use href="#i-qr"></use></svg> 演示环境：点击确认将模拟调起 '+esc(ch)+' 并完成支付回调。</div>',
    '确认支付', function(){
      o.status = '已支付';
      o.channel = ch;
      var pid = (ch==='微信支付'?'WX':'ALI')+nowStr().replace(/[-: ]/g,'');
      DB.payments.unshift({id:pid, channel:ch, order:o.id, amount:o.amount, time:nowStr(), status:'成功'});
      DB.invoices.unshift({id:'INV'+nowStr().replace(/[-: ]/g,'').slice(0,12), order:o.id, amount:money(o.amount), type:'电子普票', status:'已开具', date:nowStr().slice(0,10)});
      var mlevel = (o.title||'').replace('会员缴费 · ','') || '专业版';
      var morder = DB.memberOrders.find(function(x){ return x.user===SESSION.user.account; });
      if(morder){ morder.status='已支付'; morder.level=mlevel; morder.amount=money(o.amount); morder.time=nowStr().slice(0,10); }
      else { DB.memberOrders.unshift({id:'mo'+Date.now(), user:SESSION.user.account, level:mlevel, amount:money(o.amount), status:'已支付', time:nowStr().slice(0,10)}); }
      rPay(); rBilling(); rOrders(); rMembers(); rDash(); syncPayPanel();
      toast('支付成功：'+pid+' 已回调入账，会员权益已生效（A-03 缴费订单已同步）');
    });
}
function simulateCallback(){
  if(!needUser()) return;
  var o = DB.orders.find(function(x){ return x.status==='待支付'; });
  if(!o){ toast('当前没有待支付订单，请先在「结算支付」发起支付','warning'); return; }
  formModal('模拟支付回调',
    '<div class="field mb12"><label>回调类型</label><select class="select" id="cbType"><option>验签通过 · 正常入账</option><option>签名校验失败 · 拒绝入账</option><option>金额不一致 · 告警待人工</option></select></div>'+
    '<div class="small muted">作用于订单 '+esc(o.id)+'，结果将同步到管理端「订单与支付配置」（A-20）。</div>',
    '执行回调', function(){
      var t = document.getElementById('cbType');
      var kind = t ? t.value : '验签通过 · 正常入账';
      if(kind.indexOf('正常入账')>=0){
        o.status = '已支付';
        var pid = 'CB'+nowStr().replace(/[-: ]/g,'');
        DB.payments.unshift({id:pid, channel:o.channel, order:o.id, amount:o.amount, time:nowStr(), status:'成功'});
        var mlevel2 = (o.title||'').replace('会员缴费 · ','') || '专业版';
        var morder2 = DB.memberOrders.find(function(x){ return x.user===SESSION.user.account; });
        if(morder2){ morder2.status='已支付'; morder2.level=mlevel2; morder2.amount=money(o.amount); morder2.time=nowStr().slice(0,10); }
        else { DB.memberOrders.unshift({id:'mo'+Date.now(), user:SESSION.user.account, level:mlevel2, amount:money(o.amount), status:'已支付', time:nowStr().slice(0,10)}); }
        toast('模拟回调成功：验签通过，订单状态已更新为已支付');
      } else if(kind.indexOf('签名校验失败')>=0){
        o.status = '回调异常';
        toast('回调被拒绝：签名校验失败，订单保持待支付', 'danger');
      } else {
        o.status = '回调异常';
        toast('告警：回调金额与订单不一致，已进入人工排查队列（A-20）', 'danger');
      }
      rPay(); rBilling(); rOrders(); rMembers(); rDash(); syncPayPanel();
    });
}
