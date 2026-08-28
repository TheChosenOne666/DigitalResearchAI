<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import PageHead from '@/components/PageHead.vue';
import { ApiError } from '@/api/http';
import { fetchRoles } from '@/api/admin';
import type { AdminRoleInfo, AdminPermissionRow } from '@/api/admin';

const roles = ref<AdminRoleInfo[]>([]);
const matrix = ref<AdminPermissionRow[]>([]);
const loading = ref(false);

const ROLE_META: Record<string, { icon: string; tags: string[]; cls: string }> = {
  PLATFORM_ADMIN: { icon: 'shield', tags: ['用户端全部', '管理端全部', '系统管理', '支付配置'], cls: 'brand' },
  DATA_ADMIN: { icon: 'database', tags: ['数据资源', '数据治理', '任务中心'], cls: '' },
  USER: { icon: 'user', tags: ['用户端全部'], cls: '' },
};

const MATRIX_ROLES = [
  { key: 'PLATFORM_ADMIN', label: '平台管理员' },
  { key: 'DATA_ADMIN', label: '数据管理员' },
  { key: 'USER', label: '普通用户' },
];

async function load() {
  loading.value = true;
  try {
    const res = await fetchRoles();
    roles.value = res.roles;
    matrix.value = res.matrix;
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : '加载失败');
  } finally {
    loading.value = false;
  }
}

onMounted(() => void load());
</script>

<template>
  <div class="roles-page">
    <PageHead title="角色与权限配置" desc="内置角色，控制功能访问（PRD A-04）" :tags="['平台管理员', '数据管理员', '普通用户']" />

    <div v-loading="loading" class="roles-body">
      <div class="role-grid">
        <div v-for="r in roles" :key="r.code" class="panel role-card">
          <div class="panel-head">
            <h2 class="role-title">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" class="role-ic">
                <template v-if="r.code === 'PLATFORM_ADMIN'">
                  <path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3z" stroke="currentColor" stroke-width="1.6" />
                </template>
                <template v-else-if="r.code === 'DATA_ADMIN'">
                  <ellipse cx="12" cy="5" rx="7" ry="3" stroke="currentColor" stroke-width="1.6" />
                  <path d="M5 5v7c0 1.7 3 3 7 3s7-1.3 7-3V5M5 12v7c0 1.7 3 3 7 3s7-1.3 7-3v-7" stroke="currentColor" stroke-width="1.6" />
                </template>
                <template v-else>
                  <circle cx="12" cy="8" r="3.5" stroke="currentColor" stroke-width="1.6" />
                  <path d="M5 20a7 7 0 0 1 14 0" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
                </template>
              </svg>
              {{ r.name }}
            </h2>
            <span class="status-pill">内置</span>
          </div>
          <div class="panel-body">
            <div class="role-desc">{{ r.description }}</div>
            <div class="tag-wrap">
              <span
                v-for="t in ROLE_META[r.code]?.tags ?? []"
                :key="t"
                class="perm-tag"
                :class="ROLE_META[r.code]?.cls"
              >{{ t }}</span>
              <span v-if="r.code !== 'PLATFORM_ADMIN'" class="perm-tag muted-tag">
                {{ r.code === 'DATA_ADMIN' ? '系统管理不可见' : '管理端不可见' }}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head"><h2>权限矩阵</h2><span class="sub">菜单/功能级控制 · 一期不开放自定义角色</span></div>
        <div class="panel-body">
          <el-table :data="matrix" style="width: 100%">
            <el-table-column label="模块" min-width="340">
              <template #default="{ row }">{{ row.module }}</template>
            </el-table-column>
            <el-table-column v-for="c in MATRIX_ROLES" :key="c.key" :label="c.label" align="center" width="120">
              <template #default="{ row }">
                <span class="matrix-mark" :class="row[c.key as keyof AdminPermissionRow] ? 'yes' : 'no'">
                  {{ row[c.key as keyof AdminPermissionRow] ? '√' : '×' }}
                </span>
              </template>
            </el-table-column>
          </el-table>
          <div class="small muted mt12">三个角色为系统内置不可删除；平台管理员至少保留 1 名；用户与角色绑定在 A-02 完成，权限变更在下次登录时生效。</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.panel { background: #fff; border: 1px solid #eef2f7; border-radius: 14px; overflow: hidden; margin-bottom: 16px; }
.panel-head { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px 0; }
.panel-head h2 { margin: 0; font-size: 15px; font-weight: 600; color: #0f172a; }
.panel-head .sub { font-size: 12px; color: #94a3b8; }
.panel-body { padding: 16px 20px 20px; }

.role-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 16px; }
@media (max-width: 900px) { .role-grid { grid-template-columns: 1fr; } }

.role-card .panel-head { align-items: center; }
.role-title { display: flex; align-items: center; gap: 8px; }
.role-ic { color: #409eff; }
.status-pill { padding: 1px 10px; border-radius: 10px; background: #f0f9eb; color: #67c23a; font-size: 12px; }
.role-desc { font-size: 13px; line-height: 1.8; color: #475569; }
.tag-wrap { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 14px; }
.perm-tag { padding: 2px 10px; border-radius: 6px; background: #ecf5ff; color: #409eff; font-size: 12px; }
.perm-tag.brand { background: #ecf5ff; color: #409eff; }
.perm-tag.muted-tag { background: #f1f5f9; color: #94a3b8; }

.matrix-mark { font-weight: 700; font-size: 15px; }
.matrix-mark.yes { color: #67c23a; }
.matrix-mark.no { color: #f56c6c; }

.small { font-size: 12px; }
.muted { color: #94a3b8; }
.mt12 { margin-top: 12px; }
</style>
