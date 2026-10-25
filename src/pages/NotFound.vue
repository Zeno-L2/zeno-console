<script setup lang="ts">
import { RouterLink } from 'vue-router'
import { Button, Heading, Text } from 'nom-ui'
</script>

<template>
  <div class="flex flex-col items-center gap-4 py-24 text-center">
    <Heading as="h1" :level="2">Not found</Heading>
    <Text class="text-muted-foreground">Nothing here. Check the address, hash, or contract id.</Text>
    <RouterLink to="/">
      <Button variant="outline">Back to dashboard</Button>
    </RouterLink>
  </div>
</template>
