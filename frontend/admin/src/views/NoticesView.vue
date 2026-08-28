<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import PageHead from '@/components/PageHead.vue';
import { ApiError } from '@/api/http';
import { fetchNotices, createNotice, updateNotice, publishNotice, withdrawNotice } from '@/api/admin';
import type { AdminNoticeRow } from '@/api/admin';

const SCOPE_LABEL: Record<string, string> = {
  ALL: '全部用户',
  ROLE: '指定角色',
  ORG: '指定组织',
};
const STATUS_TAG: Record<string, 'success' | 'warning' | 'info'> = {
  PUBLISHED: 'success',
  DRAFT: 'warning',
  WITHDRAWN: 'info',
};
const STATUS_LABEL: Record<string, string> = {
  PUBLISHED: '已发布',
  DRAFT: '草稿',
  WITHDRAWN: '已撤回',
};

const loading = ref(false);
const list = ref<AdminNoticeRow[]>([]);
const total = ref(0);
const query = reactive({ status: '', page: 1, pageSize: 20 });

async function load() {
  loading.value = true;
  try {
    const res = await fetchNotices(query);
    list.value = res.list;
    total.value = res.total;
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : '加载失败');
  } finally {
    loading.value = false;
  }
}

function onPageChange(p: number) {
  query.page = p;
  void load();
}

// ===== 编辑表单 =====
const editingId = ref('');
const saving = ref(false);
const form = reactive({ title: '', content: '', scope: 'ALL', scopeValue: '' });

function resetForm() {
  editingId.value = '';
  Object.assign(form, { title: '', content: '', scope: 'ALL', scopeValue: '' });
}

function openEdit(row: AdminNoticeRow) {
  editingId.value = row.id;
  Object.assign(form, { title: row.title, content: row.content, scope: row.scope, scopeValue: row.scopeValue ?? '' });
}

async function persist(): Promise<string> {
  const body = { title: form.title, content: form.content, scope: form.scope, scopeValue: form.scopeValue || undefined };
  if (editingId.value) {
    await updateNotice(editingId.value, body);
    return editingId.value;
  }
  const row = await createNotice(body);
  editingId.value = row.id;
  return row.id;
}

async function onSaveDraft() {
  if (!form.title || !form.content) {
    ElMessage.warning('请填写标题与内容');
    return;
  }
  saving.value = true;
  try {
    await persist();
    ElMessage.success('草稿已保存');
    resetForm();
    void load();
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : '保存失败');
  } finally {
    saving.value = false;
  }
}

async function onPublish() {
  if (!form.title || !form.content) {
    ElMessage.warning('请填写标题与内容');
    return;
  }
  saving.value = true;
  try {
    const id = await persist();
    await publishNotice(id);
    ElMessage.success('公告已发布');
    resetForm();
    void load();
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : '发布失败');
  } finally {
    saving.value = false;
  }
}

async function onWithdraw(row: AdminNoticeRow) {
  try {
    await ElMessageBox.confirm(`确认撤回公告「${row.title}」？撤回后用户端不再展示。`, '撤回公告', {
      type: 'warning',
      confirmButtonText: '撤回',
      cancelButtonText: '取消',
    });
  } catch {
    return;
  }
  try {
    await withdrawNotice(row.id);
    ElMessage.success('已撤回');
    void load();
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : '撤回失败');
  }
}

onMounted(() => void load());
</script>

<template>
  <div class="notices-page">
    <PageHead title="消息管理" desc="发布系统公告和业务通知（PRD A-09）" :tags="['公告编辑', '接收范围', '发布', '撤回']" />

    <el-row :gutter="16">
      <el-col :span="11">
        <div class="panel">
          <div class="panel-head"><h2>公告编辑</h2><span class="sub">{{ editingId ? '编辑中' : '新建' }}</span></div>
          <div class="panel-body">
            <div class="field">
              <label>公告标题</label>
              <el-input v-model="form.title" maxlength="255" placeholder="公告标题" />
            </div>
            <div class="field">
              <label>公告内容</label>
              <el-input v-model="form.content" type="textarea" :rows="7" maxlength="10000" show-word-limit placeholder="公告正文（支持富文本）" />
            </div>
            <div class="field">
              <label>接收范围</label>
              <el-select v-model="form.scope" style="width: 100%">
                <el-option label="全部用户" value="ALL" />
                <el-option label="指定角色" value="ROLE" />
                <el-option label="指定组织" value="ORG" />
              </el-select>
            </div>
            <div v-if="form.scope !== 'ALL'" class="field">
              <label>{{ form.scope === 'ROLE' ? '角色编码' : '组织/租户' }}</label>
              <el-input v-model="form.scopeValue" maxlength="64" :placeholder="form.scope === 'ROLE' ? '如 PRO（会员角色）' : '如 组织标识'" />
            </div>
            <div class="alert-info">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M4 6h16v11H4z" stroke="currentColor" stroke-width="1.6" /><path d="M4 7l8 6 8-6" stroke="currentColor" stroke-width="1.6" /></svg>
              业务通知（审核结果、续费提醒等）复用消息通道；公告展示于公告区，业务通知进入站内信。
            </div>
            <div class="flex">
              <el-button type="primary" :loading="saving" @click="onPublish">发布</el-button>
              <el-button :loading="saving" @click="onSaveDraft">存草稿</el-button>
              <el-button v-if="editingId" link @click="resetForm">清空重写</el-button>
            </div>
          </div>
        </div>
      </el-col>

      <el-col :span="13">
        <div class="panel">
          <div class="panel-head">
            <h2>公告列表</h2>
            <span class="sub">草稿 / 已发布 / 已撤回</span>
            <el-select v-model="query.status" placeholder="全部状态" clearable size="small" style="width: 120px" @change="load">
              <el-option label="草稿" value="DRAFT" />
              <el-option label="已发布" value="PUBLISHED" />
              <el-option label="已撤回" value="WITHDRAWN" />
            </el-select>
          </div>
          <div class="panel-body">
            <el-table v-loading="loading" :data="list" style="width: 100%">
              <el-table-column label="标题" min-width="180">
                <template #default="{ row }"><span class="cell-strong">{{ row.title }}</span></template>
              </el-table-column>
              <el-table-column label="接收范围" width="110">
                <template #default="{ row }">
                  <el-tag effect="plain" size="small">{{ SCOPE_LABEL[row.scope] ?? row.scope }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="状态" width="90">
                <template #default="{ row }">
                  <el-tag :type="STATUS_TAG[row.status] ?? 'info'" effect="light" size="small">{{ STATUS_LABEL[row.status] ?? row.status }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="操作" width="150" fixed="right">
                <template #default="{ row }">
                  <template v-if="row.status === 'DRAFT'">
                    <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
                    <el-button link type="success" @click="publishNotice(row.id).then(() => { ElMessage.success('已发布'); load(); })">发布</el-button>
                  </template>
                  <template v-else-if="row.status === 'PUBLISHED'">
                    <el-button link type="danger" @click="onWithdraw(row)">撤回</el-button>
                  </template>
                  <template v-else>
                    <el-button link type="primary" @click="openEdit(row)">重新编辑</el-button>
                  </template>
                </template>
              </el-table-column>
              <template #empty><div class="empty-state">暂无公告</div></template>
            </el-table>

            <div class="pager">
              <el-pagination background layout="total, prev, pager, next" :total="total" :page-size="query.pageSize" :current-page="query.page" @current-change="onPageChange" />
            </div>
          </div>
        </div>
      </el-col>
    </el-row>
  </div>
</template>

<style scoped>
.panel { background: #fff; border: 1px solid #eef2f7; border-radius: 14px; overflow: hidden; margin-bottom: 16px; }
.panel-head { display: flex; align-items: center; gap: 8px; padding: 16px 20px 0; }
.panel-head h2 { margin: 0; font-size: 15px; font-weight: 600; color: #0f172a; }
.panel-head .sub { font-size: 12px; color: #94a3b8; flex: 1; }
.panel-body { padding: 16px 20px 20px; }
.field { margin-bottom: 14px; }
.field label { display: block; margin-bottom: 6px; font-size: 13px; color: #475569; font-weight: 500; }
.flex { display: flex; gap: 10px; align-items: center; }
.cell-strong { font-weight: 600; color: #1e293b; }
.alert-info { display: flex; align-items: flex-start; gap: 6px; margin-bottom: 14px; padding: 10px 14px; border-radius: 8px; background: #f4f8ff; color: #5a7aa8; font-size: 12px; line-height: 1.6; }
.alert-info svg { color: #409eff; flex-shrink: 0; margin-top: 2px; }
.pager { display: flex; justify-content: flex-end; margin-top: 16px; }
.empty-state { padding: 32px 0; color: #94a3b8; font-size: 13px; }
</style>
