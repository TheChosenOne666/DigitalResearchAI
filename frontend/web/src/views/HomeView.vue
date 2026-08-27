<script setup lang="ts">
import TopNav from '@/components/TopNav.vue';
import SearchView from '@/views/SearchView.vue';
</script>

<template>
  <div class="home-shell">
    <TopNav />
    <SearchView />
  </div>
</template>

<style scoped>
.home-shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}
</style>
