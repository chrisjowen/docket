// SPDX-License-Identifier: AGPL-3.0-only
// A stand-in for GitHub's OAuth web flow and the two API calls sign-in makes,
// for end-to-end tests and local previews. It implements just enough:
//
//   GET  /login/oauth/authorize        a page to pick who signs in
//   GET  /login/oauth/authorize/as     approve as a login, back to redirect_uri with a code
//   POST /login/oauth/access_token     code + PKCE verifier + client secret -> token
//   GET  /user, GET /user/emails       the identity behind the token
//
// and, through git.mjs, the GitHub App's installations, the Git Trees and Git
// Data calls repo sync and export make, and test controls under /_fake/.
//
//   node tests/fake-github/server.mjs   (FAKE_GITHUB_PORT, FAKE_GITHUB_CLIENT_ID, FAKE_GITHUB_CLIENT_SECRET)
import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'

import { createFakeGit } from './git.mjs'

const escape = (text) =>
  String(text).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])

/** A stable numeric GitHub id per login, so a returning user is the same user. */
function idOf(login) {
  return createHash('sha256').update(login.toLowerCase()).digest().readUInt32BE(0)
}

async function readBody(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const text = Buffer.concat(chunks).toString('utf8')
  if ((request.headers['content-type'] ?? '').includes('application/json')) return JSON.parse(text || '{}')
  return Object.fromEntries(new URLSearchParams(text))
}

/**
 * `demoLogin` (a local preview's demo user) is filled in on the sign-in page,
 * which says that it is the login to use: anyone else needs an invite.
 * `app` ({ id, publicKey, setupUrl }) turns on the GitHub App routes; `webhook`
 * ({ url, secret }) is where pushes are delivered, signed.
 */
export function startFakeGitHub({ port = 0, clientId = 'fake-client', clientSecret = 'fake-secret', demoLogin = '', app = null, webhook = null } = {}) {
  const codes = new Map()
  const tokens = new Map()
  const git = createFakeGit({ app, webhook })

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://fake-github')
    const send = (status, body, type = 'application/json') => {
      response.writeHead(status, { 'content-type': type })
      response.end(type === 'application/json' ? JSON.stringify(body) : body)
    }

    if (request.method === 'GET' && url.pathname === '/login/oauth/authorize') {
      const params = url.searchParams
      if (params.get('client_id') !== clientId) return send(400, 'unknown client_id', 'text/plain')
      const hidden = ['redirect_uri', 'state', 'code_challenge', 'code_challenge_method']
        .map((name) => `<input type="hidden" name="${name}" value="${escape(params.get(name) ?? '')}">`)
        .join('')
      return send(
        200,
        `<!doctype html><title>Fake GitHub</title>
        <style>body{font:15px system-ui;max-width:28rem;margin:4rem auto;padding:0 1rem}input,button{font:inherit;padding:.4rem .6rem}</style>
        <h1>Fake GitHub</h1><p>Sign in to <b>Docket Cloud</b> as any login. Scope: ${escape(params.get('scope') ?? '')}</p>
        ${demoLogin ? `<p><b>Local preview:</b> sign in as <code>${escape(demoLogin)}</code>, the demo user, who owns the seeded organisation. Any other login is not invited and lands on the invite-only page.</p>` : ''}
        <form method="get" action="/login/oauth/authorize/as">${hidden}
          <p><label>Login <input name="login" value="${escape(demoLogin)}" required autofocus></label></p>
          <p><label>Name <input name="name"></label></p>
          <p><label>Email <input name="email" type="email"></label></p>
          <button type="submit">Authorize</button>
        </form>`,
        'text/html; charset=utf-8',
      )
    }

    if (request.method === 'GET' && url.pathname === '/login/oauth/authorize/as') {
      const params = url.searchParams
      const login = (params.get('login') ?? '').trim().replace(/^@/, '')
      const redirectUri = params.get('redirect_uri')
      if (!login || !redirectUri) return send(400, 'login and redirect_uri are required', 'text/plain')
      const code = randomBytes(12).toString('hex')
      codes.set(code, {
        login,
        name: params.get('name') || null,
        email: params.get('email') || `${login.toLowerCase()}@users.fake-github.test`,
        challenge: params.get('code_challenge'),
        redirectUri,
      })
      const back = new URL(redirectUri)
      back.searchParams.set('code', code)
      back.searchParams.set('state', params.get('state') ?? '')
      response.writeHead(302, { location: back.toString() })
      return response.end()
    }

    if (request.method === 'POST' && url.pathname === '/login/oauth/access_token') {
      const body = await readBody(request)
      const grant = codes.get(body.code)
      codes.delete(body.code)
      if (body.client_id !== clientId || body.client_secret !== clientSecret) return send(200, { error: 'incorrect_client_credentials' })
      if (!grant || grant.redirectUri !== body.redirect_uri) return send(200, { error: 'bad_verification_code' })
      const verified = createHash('sha256').update(String(body.code_verifier ?? '')).digest('base64url')
      if (grant.challenge && verified !== grant.challenge) return send(200, { error: 'bad_verification_code' })
      const token = `gho_${randomBytes(16).toString('hex')}`
      tokens.set(token, grant)
      return send(200, { access_token: token, token_type: 'bearer', scope: 'read:user,user:email' })
    }

    const auth = request.headers.authorization ?? ''
    const who = tokens.get(auth.replace(/^Bearer /, ''))
    if (request.method === 'GET' && url.pathname === '/user') {
      if (!who) return send(401, { message: 'Bad credentials' })
      return send(200, { id: idOf(who.login), login: who.login, name: who.name, avatar_url: null })
    }
    if (request.method === 'GET' && url.pathname === '/user/emails') {
      if (!who) return send(401, { message: 'Bad credentials' })
      return send(200, [{ email: who.email, verified: true, primary: true, visibility: 'public' }])
    }
    const handled = await git.handle({
      method: request.method,
      url,
      headers: request.headers,
      body: request.method === 'POST' ? await readBody(request) : undefined,
      send,
      redirect: (location) => {
        response.writeHead(302, { location })
        response.end()
      },
      who: (authorization) => tokens.get((authorization ?? '').replace(/^Bearer /, '')) ?? null,
    })
    if (handled === null) send(404, { message: 'Not Found' })
  })

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const address = server.address()
      resolve({ server, url: `http://127.0.0.1:${address.port}`, git })
    })
  })
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { url } = await startFakeGitHub({
    port: Number(process.env.FAKE_GITHUB_PORT ?? 4471),
    clientId: process.env.FAKE_GITHUB_CLIENT_ID,
    clientSecret: process.env.FAKE_GITHUB_CLIENT_SECRET,
  })
  console.log(`fake GitHub at ${url}`)
}
