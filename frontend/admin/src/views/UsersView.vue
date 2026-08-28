<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import PageHead from '@/components/PageHead.vue';
import { ApiError } from '@/api/http';
import {
  fetchUsers,
  createUser,
  updateUser,
  setUserStatus,
  resetUserPassword,
  setUserRoles,
} from '@/api/admin';
import type { AdminUserRow } from '@/api/admin';

const ROLE_OPTIONS = [
  { value: 'PLATFORM_ADMIN', label: '平台管理员' },
  { value: 'DATA_ADMIN', label: '数据管理员' },
  { value: 'USER', label: '普通用户' },
];
const ROLE_LABEL: Record<string, string> = {
  PLATFORM_ADMIN: '平台管理员',
  DATA_ADMIN: '数据管理员',
  USER: '普通用户',
};

const loading = ref(false);
const list = ref<AdminUserRow[]>([]);
const total = ref(0);
const query = reactive({ keyword: '', role: '', status: '', page: 1, pageSize: 20 });

async function load() {
  loading.value = true;
  try {
    const res = await fetchUsers(query);
    list.value = res.list;
    total.value = res.total;
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : '加载失败');
  } finally {
    loading.value = false;
  }
}

function onSearch() {
  query.page = 1;
  void load();
}

function onPageChange(p: number) {
  query.page = p;
  void load();
}

// ===== 新增 / 编辑弹窗 =====
const dialogVisible = ref(false);
const dialogMode = ref<'create' | 'edit'>('create');
const editId = ref('');
const saving = ref(false);
const form = reactive({ username: '', realName: '', phone: '', organization: '', role: 'USER', password: '' });

function openCreate() {
  dialogMode.value = 'create';
  editId.value = '';
  Object.assign(form, { username: '', realName: '', phone: '', organization: '', role: 'USER', password: '' });
  dialogVisible.value = true;
}

function openEdit(row: AdminUserRow) {
  dialogMode.value = 'edit';
  editId.value = row.id;
  Object.assign(form, {
    username: row.username ?? '',
    realName: row.realName ?? row.nickname,
    phone: row.phone,
    organization: row.organization ?? '',
    role: row.roles[0] ?? 'USER',
    password: '',
  });
  dialogVisible.value = true;
}

async function onSave() {
  if (!form.username || !form.realName || !form.phone) {
    ElMessage.warning('请填写用户名、姓名与手机号');
    return;
  }
  if (!/^1[3-9]\d{9}$/.test(form.phone)) {
    ElMessage.warning('手机号格式不正确');
    return;
  }
  if (dialogMode.value === 'create' && !form.password) {
    ElMessage.warning('请填写初始密码');
    return;
  }
  saving.value = true;
  try {
    if (dialogMode.value === 'create') {
      await createUser({
        username: form.username,
        realName: form.realName,
        phone: form.phone,
        organization: form.organization,
        role: form.role,
        password: form.password,
      });
      ElMessage.success('用户已创建');
    } else {
      await updateUser(editId.value, {
        username: form.username,
        realName: form.realName,
        phone: form.phone,
        organization: form.organization,
      });
      await setUserRoles(editId.value, [form.role]);
      ElMessage.success('用户已更新');
    }
    dialogVisible.value = false;
    void load();
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : '保存失败');
  } finally {
    saving.value = false;
  }
}

// ===== 禁用 / 启用 =====
async function onToggleStatus(row: AdminUserRow) {
  const target = row.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
  const actionText = target === 'DISABLED' ? '禁用' : '启用';
  try {
    await ElMessageBox.confirm(`确认${actionText}用户「${row.username ?? row.phone}」？${target === 'DISABLED' ? '禁用后该用户不可登录。' : ''}`, `${actionText}用户`, {
      type: 'warning',
      confirmButtonText: actionText,
      cancelButtonText: '取消',
    });
  } catch {
    return;
  }
  try {
    await setUserStatus(row.id, target);
    ElMessage.success(`已${actionText}`);
    void load();
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : `${actionText}失败`);
  }
}

// ===== 重置密码 =====
const pwdVisible = ref(false);
const pwdUserId = ref('');
const pwdForm = reactive({ username: '', newPassword: '' });

function openResetPwd(row: AdminUserRow) {
  pwdUserId.value = row.id;
  pwdForm.username = row.username ?? row.phone;
  pwdForm.newPassword = '';
  pwdVisible.value = true;
}

async function onResetPwd() {
  if (pwdForm.newPassword.length < 6) {
    ElMessage.warning('密码至少 6 位');
    return;
  }
  try {
    await resetUserPassword(pwdUserId.value, pwdForm.newPassword);
    ElMessage.success('密码已重置，并已通知用户');
    pwdVisible.value = false;
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : '重置失败');
  }
}

onMounted(() => void load());
</script>

<template>
  <div class="users-page">
    <PageHead title="用户账号管理" desc="管理平台用户及账号状态（PRD A-02）" :tags="['新增', '编辑', '禁用', '重置密码']" />

    <div class="panel filter-panel">
      <div class="toolbar">
        <el-input v-model="query.keyword" class="search-input" placeholder="用户名 / 姓名 / 手机号" clearable @keyup.enter="onSearch" @clear="onSearch">
          <template #prefix>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" stroke-width="1.8" /><path d="m16 16 4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>
          </template>
        </el-input>
        <el-select v-model="query.role" placeholder="全部角色" clearable class="filter-select" @change="onSearch">
          <el-option v-for="r in ROLE_OPTIONS" :key="r.value" :label="r.label" :value="r.value" />
        </el-select>
        <el-select v-model="query.status" placeholder="全部状态" clearable class="filter-select" @change="onSearch">
          <el-option label="正常" value="ACTIVE" />
          <el-option label="已禁用" value="DISABLED" />
        </el-select>
        <span class="spacer"></span>
        <el-button type="primary" @click="openCreate">新增用户</el-button>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head"><h2>用户列表</h2><span class="sub">用户名唯一 · 角色来源于角色权限配置（A-04）</span></div>
      <div class="panel-body">
        <el-table v-loading="loading" :data="list" style="width: 100%">
          <el-table-column label="用户名" min-width="120">
            <template #default="{ row }">
              <span class="cell-strong">{{ row.username ?? '—' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="姓名" min-width="110">
            <template #default="{ row }">{{ row.realName ?? row.nickname }}</template>
          </el-table-column>
          <el-table-column label="所属组织" min-width="150">
            <template #default="{ row }">
              <span :class="row.organization ? '' : 'muted'">{{ row.organization ?? '—' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="角色" min-width="120">
            <template #default="{ row }">
              <el-tag v-if="row.roles[0] === 'PLATFORM_ADMIN'" type="primary" effect="light" size="small">平台管理员</el-tag>
              <el-tag v-else-if="row.roles[0] === 'DATA_ADMIN'" type="warning" effect="light" size="small">数据管理员</el-tag>
              <el-tag v-else type="info" effect="plain" size="small">普通用户</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="90">
            <template #default="{ row }">
              <span class="status-dot" :class="row.status === 'ACTIVE' ? 'on' : 'off'"></span>
              {{ row.status === 'ACTIVE' ? '正常' : '已禁用' }}
            </template>
          </el-table-column>
          <el-table-column label="操作" width="230" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
              <el-button link :type="row.status === 'ACTIVE' ? 'danger' : 'success'" @click="onToggleStatus(row)">
                {{ row.status === 'ACTIVE' ? '禁用' : '启用' }}
              </el-button>
              <el-button link type="primary" @click="openResetPwd(row)">重置密码</el-button>
            </template>
          </el-table-column>
          <template #empty>
            <div class="empty-state">暂无用户数据</div>
          </template>
        </el-table>

        <div class="pager">
          <el-pagination
            background
            layout="total, prev, pager, next"
            :total="total"
            :page-size="query.pageSize"
            :current-page="query.page"
            @current-change="onPageChange"
          />
        </div>

        <div class="alert-info">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3z" stroke="currentColor" stroke-width="1.6" /></svg>
          不能禁用自己的账号；禁用不影响已生成的数据/报告；操作记录计入审计日志（A-13）。
        </div>
      </div>
    </div>

    <!-- 新增 / 编辑弹窗 -->
    <el-dialog v-model="dialogVisible" :title="dialogMode === 'create' ? '新增用户' : '编辑用户'" width="460px" :close-on-click-modal="false">
      <el-form label-width="80px" label-position="left">
        <el-form-item label="用户名" required>
          <el-input v-model="form.username" maxlength="32" placeholder="登录名，全局唯一" />
        </el-form-item>
        <el-form-item label="姓名" required>
          <el-input v-model="form.realName" maxlength="64" placeholder="真实姓名" />
        </el-form-item>
        <el-form-item label="手机号" required>
          <el-input v-model="form.phone" maxlength="11" placeholder="11 位手机号" />
        </el-form-item>
        <el-form-item label="所属组织">
          <el-input v-model="form.organization" maxlength="128" placeholder="如：智库研究部（可空）" />
        </el-form-item>
        <el-form-item label="角色">
          <el-select v-model="form.role" style="width: 100%">
            <el-option v-for="r in ROLE_OPTIONS" :key="r.value" :label="r.label" :value="r.value" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="dialogMode === 'create'" label="初始密码" required>
          <el-input v-model="form.password" type="password" show-password maxlength="64" placeholder="至少 6 位" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="onSave">保存</el-button>
      </template>
    </el-dialog>

    <!-- 重置密码弹窗 -->
    <el-dialog v-model="pwdVisible" title="重置密码" width="420px" :close-on-click-modal="false">
      <p class="pwd-hint">为「{{ pwdForm.username }}」设置新密码，重置后将以站内信通知该用户。</p>
      <el-input v-model="pwdForm.newPassword" type="password" show-password maxlength="64" placeholder="新密码（至少 6 位）" />
      <template #footer>
        <el-button @click="pwdVisible = false">取消</el-button>
        <el-button type="primary" @click="onResetPwd">确认重置</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.panel {
  background: #fff;
  border: 1px solid #eef2f7;
  border-radius: 14px;
  overflow: hidden;
  margin-bottom: 16px;
}
.panel-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 16px 20px 0;
}
.panel-head h2 { margin: 0; font-size: 15px; font-weight: 600; color: #0f172a; }
.panel-head .sub { font-size: 12px; color: #94a3b8; }
.panel-body { padding: 16px 20px 20px; }

.filter-panel .toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 16px 20px;
}
.search-input { width: 240px; }
.filter-select { width: 140px; }
.spacer { flex: 1; }

.cell-strong { font-weight: 600; color: #1e293b; }
.muted { color: #94a3b8; }

.status-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  margin-right: 6px;
  vertical-align: 1px;
}
.status-dot.on { background: #67c23a; }
.status-dot.off { background: #f56c6c; }

.pager { display: flex; justify-content: flex-end; margin-top: 16px; }

.alert-info {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 14px;
  padding: 10px 14px;
  border-radius: 8px;
  background: #f4f8ff;
  color: #5a7aa8;
  font-size: 12px;
}
.alert-info svg { color: #409eff; flex-shrink: 0; }

.empty-state { padding: 32px 0; color: #94a3b8; font-size: 13px; }
.pwd-hint { margin: 0 0 14px; font-size: 13px; color: #64748b; }
</style>
