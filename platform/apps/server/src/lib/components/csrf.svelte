<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  /** The session's CSRF token, which every mutating form carries (§8.1). */
  let { token }: { token: string | null } = $props()
</script>

<input type="hidden" name="csrf" value={token ?? ''} />
