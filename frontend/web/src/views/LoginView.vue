<script setup lang="ts">
import { useRouter } from 'vue-router';
import LoginDialog from '@/components/LoginDialog.vue';

/**
 * 登录独立页（/login）：复用 LoginDialog 弹窗组件（对齐原型 9.4 登录弹窗）。
 * - 弹窗组件本身为 fixed 全屏遮罩 + 居中卡片，任意页面可直接渲染
 * - 登录成功：有 redirect 参数跳回原路径，否则回首页
 * - 点遮罩关闭：放弃登录，回首页
 * - 访客访问受保护路由被守卫拦截时跳转至此
 */
const router = useRouter();

/** 登录成功：优先跳回守卫传来的 redirect 路径，否则回首页 */
function onSuccess(): void {
  const redirect = router.currentRoute.value.query.redirect;
  router.push(typeof redirect === 'string' ? redirect : '/');
}

/** 关闭弹窗：放弃登录，回首页 */
function onClose(): void {
  router.push('/');
}
</script>

<template>
  <LoginDialog @success="onSuccess" @close="onClose" />
</template>
