// SPDX-License-Identifier: AGPL-3.0-only
// The repo side of the fake GitHub: an in-memory git (blobs with real git
// SHAs, trees, commits, refs), the GitHub App's installations and tokens, the
// REST calls repo sync and export make, and test controls to push commits,
// merge PRs and send signed webhooks.
//
// Every route answers only what docket-cloud calls; anything else is a 404.
import { createHash, createHmac, createPublicKey, randomBytes, verify } from 'node:crypto'

const sha1 = (text) => createHash('sha1').update(text).digest('hex')
const gitBlobSha = (content) => sha1(Buffer.concat([Buffer.from(`blob ${Buffer.byteLength(content)}\0`), Buffer.from(content)]))

/** A stable numeric id per name, like GitHub's. */
const idOf = (text) => createHash('sha256').update(text).digest().readUInt32BE(0) % 2_000_000_000

export function createFakeGit({ app = null, webhook = null } = {}) {
  /** sha -> { type: 'blob', content } | { type: 'tree', entries: [{ path, mode, type, sha }] } | { type: 'commit', tree, parents, message } */
  const objects = new Map()
  /** 'owner/name' -> { id, fullName, defaultBranch, private, refs: Map<branch, sha>, pulls: [] } */
  const repos = new Map()
  /** id -> { id, account, repos: Set<fullName>, users: Set<login> } */
  const installations = new Map()
  const tokens = new Map()
  const deliveries = []
  let hook = webhook

  function putBlob(content) {
    const sha = gitBlobSha(content)
    objects.set(sha, { type: 'blob', content })
    return sha
  }

  /** Builds the tree objects for a flat map of path -> blob sha, returning the root tree's sha. */
  function putTree(files) {
    const children = new Map()
    for (const [path, sha] of files) {
      const [head, ...rest] = path.split('/')
      if (!rest.length) children.set(head, { mode: '100644', type: 'blob', sha })
      else {
        const sub = children.get(head)?.files ?? new Map()
        sub.set(rest.join('/'), sha)
        children.set(head, { files: sub })
      }
    }
    const entries = [...children.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([path, child]) => (child.files ? { path, mode: '040000', type: 'tree', sha: putTree(child.files) } : { path, ...child }))
    const sha = sha1(`tree ${JSON.stringify(entries)}`)
    objects.set(sha, { type: 'tree', entries })
    return sha
  }

  /** Every file of a tree, path -> blob sha. */
  function flatten(treeSha, prefix = '', into = new Map()) {
    const tree = objects.get(treeSha)
    for (const entry of tree?.entries ?? []) {
      const path = prefix ? `${prefix}/${entry.path}` : entry.path
      if (entry.type === 'tree') flatten(entry.sha, path, into)
      else into.set(path, entry.sha)
    }
    return into
  }

  function putCommit(tree, parents, message) {
    const sha = sha1(`commit ${tree} ${parents.join(',')} ${message} ${randomBytes(4).toString('hex')}`)
    objects.set(sha, { type: 'commit', tree, parents, message })
    return sha
  }

  function filesAt(repo, branch) {
    const head = repo.refs.get(branch)
    return head ? flatten(objects.get(head).tree) : new Map()
  }

  async function sendWebhook(event, payload) {
    if (!hook) return null
    const body = JSON.stringify(payload)
    const signature = `sha256=${createHmac('sha256', hook.secret).update(body).digest('hex')}`
    const delivery = randomBytes(8).toString('hex')
    const response = await fetch(hook.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-github-event': event, 'x-github-delivery': delivery, 'x-hub-signature-256': signature },
      body,
    }).catch((error) => ({ status: 0, text: async () => String(error) }))
    const record = { event, delivery, status: response.status, body: await response.text() }
    deliveries.push(record)
    return record
  }

  function installationOf(fullName) {
    return [...installations.values()].find((installation) => installation.repos.has(fullName)) ?? null
  }

  /** Commits file changes (content, or null to delete) on a branch and sends the push webhook. */
  async function push(fullName, { branch, files = {}, message = 'update', webhook: send = true }) {
    const repo = repos.get(fullName)
    if (!repo) throw new Error(`no repo ${fullName}`)
    const target = branch ?? repo.defaultBranch
    const current = filesAt(repo, target)
    for (const [path, content] of Object.entries(files)) {
      if (content === null) {
        for (const existing of [...current.keys()]) if (existing === path || existing.startsWith(`${path}/`)) current.delete(existing)
      } else current.set(path, putBlob(content))
    }
    const before = repo.refs.get(target) ?? '0'.repeat(40)
    const sha = putCommit(putTree(current), repo.refs.has(target) ? [before] : [], message)
    repo.refs.set(target, sha)
    const installation = installationOf(fullName)
    const delivery =
      send && installation
        ? await sendWebhook('push', {
            ref: `refs/heads/${target}`,
            before,
            after: sha,
            deleted: false,
            repository: { id: repo.id, full_name: fullName, default_branch: repo.defaultBranch },
            installation: { id: installation.id },
          })
        : null
    return { sha, delivery }
  }

  function createRepo({ fullName, defaultBranch = 'main', files = {}, private: isPrivate = true, protectedBranches = [] }) {
    const repo = { id: idOf(fullName), fullName, defaultBranch, private: isPrivate, protectedBranches: new Set(protectedBranches), refs: new Map(), pulls: [] }
    repos.set(fullName, repo)
    const tree = new Map(Object.entries(files).map(([path, content]) => [path, putBlob(content)]))
    repo.refs.set(defaultBranch, putCommit(putTree(tree), [], 'initial commit'))
    return { id: repo.id, sha: repo.refs.get(defaultBranch) }
  }

  function createInstallation({ account, repos: names = [], users = [account] }) {
    const id = idOf(`installation:${account}`) % 90_000_000 + 10_000_000
    installations.set(id, { id, account, repos: new Set(names), users: new Set(users.map((user) => user.toLowerCase())) })
    return { id }
  }

  /** Merges a PR: the head commit's changes against its parent, applied on the base, then a push webhook. */
  async function mergePull(fullName, number) {
    const repo = repos.get(fullName)
    const pull = repo?.pulls.find((candidate) => candidate.number === number)
    if (!pull || pull.state !== 'open') throw new Error(`no open PR ${fullName}#${number}`)
    const head = objects.get(repo.refs.get(pull.head))
    const parent = objects.get(head.parents[0])
    const after = flatten(head.tree)
    const before = parent ? flatten(parent.tree) : new Map()
    const files = {}
    for (const [path, sha] of after) if (before.get(path) !== sha) files[path] = objects.get(sha).content
    for (const path of before.keys()) if (!after.has(path)) files[path] = null
    pull.state = 'merged'
    return push(fullName, { branch: pull.base, files, message: `Merge pull request #${number} from ${pull.head}` })
  }

  function verifyAppJwt(authorization) {
    if (!app) return false
    const token = (authorization ?? '').replace(/^Bearer /, '')
    const [header, payload, signature] = token.split('.')
    if (!header || !payload || !signature) return false
    const ok = verify('RSA-SHA256', Buffer.from(`${header}.${payload}`), createPublicKey(app.publicKey), Buffer.from(signature, 'base64url'))
    if (!ok) return false
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    const now = Math.floor(Date.now() / 1000)
    return String(claims.iss) === String(app.id) && claims.exp > now && claims.iat <= now
  }

  const installationBody = (installation) => ({
    id: installation.id,
    account: { login: installation.account, type: 'User' },
    repository_selection: 'selected',
    suspended_at: null,
  })
  const repoBody = (repo) => ({ id: repo.id, full_name: repo.fullName, default_branch: repo.defaultBranch, private: repo.private })

  /**
   * Handles a request if it is one of the repo or App routes. `who(authorization)`
   * answers the user behind an OAuth token, for `/user/installations`.
   */
  async function handle({ method, url, headers, body, send, redirect, who }) {
    const path = url.pathname
    let match

    // ---- test controls ----
    if (method === 'POST' && path === '/_fake/repos') return send(201, createRepo(body))
    if (method === 'POST' && path === '/_fake/installations') return send(201, createInstallation(body))
    if (method === 'POST' && path === '/_fake/webhook') {
      hook = body.url ? { url: body.url, secret: body.secret } : null
      return send(200, {})
    }
    if ((match = path.match(/^\/_fake\/repos\/([^/]+)\/([^/]+)\/push$/)) && method === 'POST') {
      return send(200, await push(`${match[1]}/${match[2]}`, body))
    }
    if ((match = path.match(/^\/_fake\/repos\/([^/]+)\/([^/]+)\/settings$/)) && method === 'POST') {
      const repo = repos.get(`${match[1]}/${match[2]}`)
      if (!repo) return send(404, { message: 'Not Found' })
      if (typeof body.private === 'boolean') repo.private = body.private
      if (Array.isArray(body.protectedBranches)) repo.protectedBranches = new Set(body.protectedBranches)
      return send(200, { private: repo.private, protectedBranches: [...repo.protectedBranches] })
    }
    if ((match = path.match(/^\/_fake\/repos\/([^/]+)\/([^/]+)\/pulls\/(\d+)\/merge$/)) && method === 'POST') {
      return send(200, await mergePull(`${match[1]}/${match[2]}`, Number(match[3])))
    }
    if ((match = path.match(/^\/_fake\/repos\/([^/]+)\/([^/]+)$/)) && method === 'GET') {
      const repo = repos.get(`${match[1]}/${match[2]}`)
      if (!repo) return send(404, { message: 'Not Found' })
      const branch = url.searchParams.get('branch') ?? repo.defaultBranch
      const files = Object.fromEntries([...filesAt(repo, branch)].map(([file, sha]) => [file, objects.get(sha).content]))
      return send(200, { refs: Object.fromEntries(repo.refs), pulls: repo.pulls, files })
    }
    if (method === 'GET' && path === '/_fake/deliveries') return send(200, deliveries)

    // ---- installing the app ----
    if ((match = path.match(/^\/apps\/([^/]+)\/installations\/new$/)) && method === 'GET' && app) {
      const state = url.searchParams.get('state') ?? ''
      const choices = [...installations.values()]
        .map(
          (installation) =>
            `<li><a href="/apps/${match[1]}/installations/${installation.id}/done?state=${encodeURIComponent(state)}">Install on ${installation.account}</a> (${[...installation.repos].join(', ') || 'no repos'})</li>`,
        )
        .join('')
      return send(200, `<!doctype html><title>Fake GitHub</title><h1>Install ${match[1]}</h1><ul>${choices}</ul>`, 'text/html; charset=utf-8')
    }
    if ((match = path.match(/^\/apps\/([^/]+)\/installations\/(\d+)\/done$/)) && method === 'GET' && app) {
      const back = new URL(app.setupUrl)
      back.searchParams.set('installation_id', match[2])
      back.searchParams.set('setup_action', 'install')
      back.searchParams.set('state', url.searchParams.get('state') ?? '')
      return redirect(back.toString())
    }

    // ---- the App's own API (JWT) ----
    if ((match = path.match(/^\/app\/installations\/(\d+)(\/access_tokens)?$/))) {
      if (!verifyAppJwt(headers.authorization)) return send(401, { message: 'A JSON web token could not be decoded' })
      const installation = installations.get(Number(match[1]))
      if (!installation) return send(404, { message: 'Not Found' })
      if (match[2] && method === 'POST') {
        const token = `ghs_${randomBytes(16).toString('hex')}`
        tokens.set(token, installation.id)
        return send(201, { token, expires_at: new Date(Date.now() + 3_600_000).toISOString() })
      }
      if (!match[2] && method === 'GET') return send(200, installationBody(installation))
    }

    if (method === 'GET' && path === '/user/installations') {
      const user = who(headers.authorization)
      if (!user) return send(401, { message: 'Bad credentials' })
      const mine = [...installations.values()].filter((installation) => installation.users.has(user.login.toLowerCase()))
      return send(200, { total_count: mine.length, installations: mine.map(installationBody) })
    }

    // ---- as an installation ----
    const tokenInstallation = tokens.get((headers.authorization ?? '').replace(/^token /, ''))
    if (method === 'GET' && path === '/installation/repositories') {
      if (!tokenInstallation) return send(401, { message: 'Bad credentials' })
      const page = Number(url.searchParams.get('page') ?? 1)
      const list = [...installations.get(tokenInstallation).repos].map((name) => repos.get(name)).filter(Boolean)
      return send(200, { total_count: list.length, repositories: page === 1 ? list.map(repoBody) : [] })
    }
    if ((match = path.match(/^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/))) {
      const fullName = `${decodeURIComponent(match[1])}/${decodeURIComponent(match[2])}`
      const repo = repos.get(fullName)
      if (!tokenInstallation) return send(401, { message: 'Bad credentials' })
      if (!repo || !installations.get(tokenInstallation)?.repos.has(fullName)) return send(404, { message: 'Not Found' })
      const rest = match[3] ?? ''
      let sub
      if (method === 'GET' && rest === '') return send(200, repoBody(repo))
      if (method === 'GET' && (sub = rest.match(/^\/branches\/(.+)$/))) {
        const branch = decodeURIComponent(sub[1])
        const sha = repo.refs.get(branch)
        return sha ? send(200, { name: branch, commit: { sha }, protected: repo.protectedBranches.has(branch) }) : send(404, { message: 'Branch not found' })
      }
      if (method === 'GET' && (sub = rest.match(/^\/git\/ref\/heads\/(.+)$/))) {
        const sha = repo.refs.get(decodeURIComponent(sub[1]))
        return sha ? send(200, { ref: `refs/heads/${sub[1]}`, object: { type: 'commit', sha } }) : send(404, { message: 'Not Found' })
      }
      if (method === 'GET' && (sub = rest.match(/^\/git\/commits\/([0-9a-f]{40})$/))) {
        const commit = objects.get(sub[1])
        if (commit?.type !== 'commit') return send(404, { message: 'Not Found' })
        return send(200, { sha: sub[1], tree: { sha: commit.tree }, parents: commit.parents.map((sha) => ({ sha })), message: commit.message })
      }
      if (method === 'GET' && (sub = rest.match(/^\/git\/trees\/([0-9a-f]{40})$/))) {
        const tree = objects.get(sub[1])
        if (tree?.type !== 'tree') return send(404, { message: 'Not Found' })
        if (url.searchParams.get('recursive')) {
          const entries = []
          const walk = (sha, prefix) => {
            for (const entry of objects.get(sha).entries) {
              const full = prefix ? `${prefix}/${entry.path}` : entry.path
              entries.push({ ...entry, path: full })
              if (entry.type === 'tree') walk(entry.sha, full)
            }
          }
          walk(sub[1], '')
          return send(200, { sha: sub[1], tree: entries, truncated: false })
        }
        return send(200, { sha: sub[1], tree: tree.entries, truncated: false })
      }
      if (method === 'GET' && (sub = rest.match(/^\/git\/blobs\/([0-9a-f]{40})$/))) {
        const blob = objects.get(sub[1])
        if (blob?.type !== 'blob') return send(404, { message: 'Not Found' })
        return send(200, { sha: sub[1], encoding: 'base64', content: Buffer.from(blob.content).toString('base64') })
      }
      if (method === 'POST' && rest === '/git/trees') {
        const files = body.base_tree ? flatten(body.base_tree) : new Map()
        for (const entry of body.tree) files.set(entry.path, entry.sha ?? putBlob(entry.content))
        return send(201, { sha: putTree(files) })
      }
      if (method === 'POST' && rest === '/git/commits') {
        return send(201, { sha: putCommit(body.tree, body.parents ?? [], body.message ?? '') })
      }
      if (method === 'POST' && rest === '/git/refs') {
        const branch = String(body.ref).replace(/^refs\/heads\//, '')
        if (repo.refs.has(branch)) return send(422, { message: 'Reference already exists' })
        repo.refs.set(branch, body.sha)
        return send(201, { ref: body.ref, object: { sha: body.sha } })
      }
      if (method === 'POST' && rest === '/pulls') {
        if (!repo.refs.has(body.head) || !repo.refs.has(body.base)) return send(422, { message: 'Validation Failed' })
        const number = repo.pulls.length + 1
        const pull = { number, title: body.title, body: body.body, head: body.head, base: body.base, state: 'open' }
        repo.pulls.push(pull)
        return send(201, { number, html_url: `https://github.com/${fullName}/pull/${number}`, state: 'open' })
      }
      return send(404, { message: 'Not Found' })
    }
    return null
  }

  return { handle, createRepo, createInstallation, push, mergePull, repos, installations, deliveries, filesAt: (name, branch) => filesAt(repos.get(name), branch ?? repos.get(name).defaultBranch) }
}
