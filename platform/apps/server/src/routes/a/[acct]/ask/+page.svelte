<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import AskPage from '$lib/components/ask/ask-page.svelte'

  let { data, form } = $props()
</script>

<AskPage {data} {form} />
