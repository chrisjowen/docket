<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import Proposals from '$lib/components/trust/proposals.svelte'

  let { data, form } = $props()
</script>

<Proposals {data} {form} />
