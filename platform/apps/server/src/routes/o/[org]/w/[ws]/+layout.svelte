<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import DocketFrame from '$lib/components/shell/docket-frame.svelte'

  let { data, children } = $props()
</script>

<DocketFrame {data}>
  {@render children()}
</DocketFrame>
