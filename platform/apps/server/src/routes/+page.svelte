<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import Home from '$lib/components/home.svelte'

  let { data, form } = $props()
</script>

<Home {data} {form} />
