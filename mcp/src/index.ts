import OAuthProvider, { AuthorizationError, getOAuthApi } from '@cloudflare/workers-oauth-provider';
import { McpServer } from '@modelcontextprotocol/server';
import { createMcpHandler } from 'agents/mcp/server';
import { z } from 'zod';

interface Env {
	INSIDER: Fetcher;
	OAUTH_KV: KVNamespace;
	ACCESS_CLIENT_ID: string;
	ACCESS_CLIENT_SECRET: string;
	ACCESS_TOKEN_URL: string;
	ACCESS_AUTHORIZATION_URL: string;
	ACCESS_USERINFO_URL: string;
	MCP_INTERNAL_SECRET: string;
	PUBLIC_ORIGIN: string;
}

interface AccessIdentity { sub: string; email?: string; name?: string }
const scope = 'insider:reels';

const providerOptions = {
	apiRoute: '/mcp',
	apiHandler: {
		async fetch(request, env, ctx) {
			const userId = (ctx as unknown as { props?: { userId?: string } }).props?.userId;
			if (!userId) return new Response('Unauthorized', { status: 401 });
			return createMcpHandler(() => createInsiderMcpServer(env, userId))(request, env, ctx);
		},
	},
	defaultHandler: { fetch: handleBrowserRequest },
	authorizeEndpoint: '/authorize',
	tokenEndpoint: '/oauth/token',
	clientRegistrationEndpoint: '/oauth/register',
	scopesSupported: [scope],
	resourceMetadata: {
		resource: 'https://insider-mcp.juanmontreuil71.workers.dev/mcp',
		authorization_servers: ['https://insider-mcp.juanmontreuil71.workers.dev'],
		scopes_supported: [scope],
		resource_name: 'Insider reels for Hermes',
	},
} satisfies ConstructorParameters<typeof OAuthProvider<Env>>[0];

const provider = new OAuthProvider<Env>(providerOptions);

async function handleBrowserRequest(request: Request, env: Env): Promise<Response> {
	const pathname = new URL(request.url).pathname;
	if (pathname === '/authorize') return authorize(request, env);
	if (pathname === '/callback') return callback(request, env);
	return new Response('Not found', { status: 404 });
}

async function authorize(request: Request, env: Env): Promise<Response> {
	const oauth = getOAuthApi(providerOptions, env);
	if (request.method === 'GET') {
		try {
			const authRequest = await oauth.parseAuthRequest(request);
			const client = await oauth.lookupClient(authRequest.clientId);
			if (!client) return new Response('Unknown OAuth client.', { status: 400 });
			const consent = await oauth.beginConsent(authRequest);
			consent.headers.set('Content-Type', 'text/html; charset=utf-8');
			return new Response(consentPage(client.clientName ?? 'Hermes', authRequest.redirectUri, consent.handle), { headers: consent.headers });
		} catch (error) { return authorizationErrorResponse(error); }
	}
	if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
	try {
		const form = await request.formData();
		const handle = String(form.get('handle') ?? '');
		if (form.get('decision') !== 'approve') {
			const denied = await oauth.denyConsent(request, handle);
			return new Response(null, { status: 302, headers: denied.headers });
		}
		const approved = await oauth.approveConsent(request, handle, { scope: [scope] });
		const upstream = await oauth.beginUpstream(approved.request, { headers: approved.headers });
		const accessUrl = new URL(env.ACCESS_AUTHORIZATION_URL);
		accessUrl.search = new URLSearchParams({ response_type: 'code', client_id: env.ACCESS_CLIENT_ID, redirect_uri: `${env.PUBLIC_ORIGIN}/callback`, scope: 'openid email profile', state: upstream.state }).toString();
		upstream.headers.set('Location', accessUrl.toString());
		return new Response(null, { status: 302, headers: upstream.headers });
	} catch (error) { return authorizationErrorResponse(error); }
}

async function callback(request: Request, env: Env): Promise<Response> {
	const oauth = getOAuthApi(providerOptions, env);
	try {
		const upstream = await oauth.finishUpstream(request);
		const callbackUrl = new URL(request.url);
		if (callbackUrl.searchParams.get('error')) return accessDenied(upstream.request, upstream.headers);
		const code = callbackUrl.searchParams.get('code');
		if (!code) return accessDenied(upstream.request, upstream.headers);
		const identity = await fetchAccessIdentity(await exchangeAccessCode(code, env), env);
		if (!identity.sub || !identity.email) return new Response('Your Access identity did not include an email.', { status: 403 });
		const userId = await activateInsiderUser(identity, env);
		const { redirectTo } = await oauth.completeAuthorization({ request: upstream.request, userId, metadata: { email: identity.email }, scope: [scope], props: { userId } });
		if (isLoopbackCallback(redirectTo)) {
			upstream.headers.set('Content-Type', 'text/html; charset=utf-8');
			upstream.headers.set('Cache-Control', 'no-store');
			upstream.headers.set('Referrer-Policy', 'no-referrer');
			upstream.headers.set('Content-Security-Policy', `default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-src ${new URL(redirectTo).origin}; base-uri 'none'; form-action 'none'`);
			return new Response(loopbackCompletionPage(redirectTo), { headers: upstream.headers });
		}
		upstream.headers.set('Location', redirectTo);
		return new Response(null, { status: 302, headers: upstream.headers });
	} catch (error) { return authorizationErrorResponse(error); }
}

async function exchangeAccessCode(code: string, env: Env): Promise<string> {
	const body = new URLSearchParams({ grant_type: 'authorization_code', code, client_id: env.ACCESS_CLIENT_ID, client_secret: env.ACCESS_CLIENT_SECRET, redirect_uri: `${env.PUBLIC_ORIGIN}/callback` });
	const response = await fetch(env.ACCESS_TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
	const result = await response.json<{ access_token?: string }>().catch(() => null);
	if (!response.ok || !result?.access_token) throw new Error('Cloudflare Access token exchange failed.');
	return result.access_token;
}

async function fetchAccessIdentity(accessToken: string, env: Env): Promise<AccessIdentity> {
	const response = await fetch(env.ACCESS_USERINFO_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
	const identity = await response.json<AccessIdentity>().catch(() => null);
	if (!response.ok || !identity) throw new Error('Cloudflare Access userinfo request failed.');
	return identity;
}

async function activateInsiderUser(identity: AccessIdentity, env: Env): Promise<string> {
	const response = await env.INSIDER.fetch('https://internal/internal/mcp/session', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-MCP-Internal-Secret': env.MCP_INTERNAL_SECRET }, body: JSON.stringify({ accessSubject: identity.sub, email: identity.email, name: identity.name ?? null }) });
	const result = await response.json<{ userId?: string }>().catch(() => null);
	if (!response.ok || !result?.userId) throw new Error('Could not activate the Insider connection.');
	return result.userId;
}

function createInsiderMcpServer(env: Env, userId: string) {
	const server = new McpServer({ name: 'insider-reels', version: '2.0.0' });
	server.registerTool('insider_get_my_new_reels', { description: 'Get the current user\'s newly assigned Insider TikTok reels, including private Whisper transcripts.', inputSchema: { limit: z.number().int().min(1).max(10).default(10) } }, async (input) => mcpTool(env, userId, 'new-reels', input));
	server.registerTool('insider_mark_reels_viewed', { description: 'Mark assigned Insider reels as viewed after completing the requested review.', inputSchema: { reelIds: z.array(z.string().regex(/^\d+$/)).min(1).max(10) } }, async (input) => mcpTool(env, userId, 'mark-viewed', input));
	server.registerTool('insider_get_reel', { description: 'Get an assigned TikTok reel curated by Insider, including private Whisper transcript and timestamped segments.', inputSchema: { reelId: z.string().regex(/^\d+$/, 'reelId must be numeric') } }, async (input) => mcpTool(env, userId, 'get-reel', input));
	return server;
}

async function mcpTool(env: Env, userId: string, tool: string, input: unknown) {
	const response = await env.INSIDER.fetch('https://internal/internal/mcp/tool', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-MCP-Internal-Secret': env.MCP_INTERNAL_SECRET }, body: JSON.stringify({ userId, tool, input }) });
	const result = await response.json<{ payload?: unknown; error?: string }>().catch(() => null);
	if (!response.ok) return { isError: true, content: [{ type: 'text' as const, text: result?.error ?? 'Insider could not complete this request.' }] };
	return { content: [{ type: 'text' as const, text: JSON.stringify(result?.payload ?? {}) }] };
}

function accessDenied(request: { redirectUri: string; state?: string; issuer?: string }, headers: Headers) {
	const redirect = new URL(request.redirectUri);
	redirect.searchParams.set('error', 'access_denied');
	if (request.state) redirect.searchParams.set('state', request.state);
	if (request.issuer) redirect.searchParams.set('iss', request.issuer);
	headers.set('Location', redirect.toString());
	return new Response(null, { status: 302, headers });
}

function authorizationErrorResponse(error: unknown) {
	if (error instanceof AuthorizationError && error.redirectUri) {
		const redirect = new URL(error.redirectUri);
		redirect.searchParams.set('error', error.code);
		redirect.searchParams.set('error_description', error.description);
		if (error.state) redirect.searchParams.set('state', error.state);
		if (error.issuer) redirect.searchParams.set('iss', error.issuer);
		return Response.redirect(redirect.toString(), 302);
	}
	if (error instanceof AuthorizationError) return new Response(error.description, { status: 400 });
	throw error;
}

function consentPage(clientName: string, redirectUri: string, handle: string) {
	const client = escapeHtml(clientName), host = escapeHtml(new URL(redirectUri).hostname), safeHandle = escapeHtml(handle);
	return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect Hermes · Insider</title><style>body{margin:0;background:#eef3e8;color:#13271f;font:16px system-ui,sans-serif;display:grid;min-height:100vh;place-items:center}.card{background:#fff;max-width:440px;padding:40px;border-radius:20px;box-shadow:0 14px 45px #173b2620}h1{font-size:31px;margin:12px 0}p{line-height:1.5}button{border:0;border-radius:999px;padding:12px 18px;font-weight:700;font-size:15px;cursor:pointer}.allow{background:#194e37;color:#fff}.deny{background:#edf0ec;color:#20342a;margin-left:8px}</style><main class="card"><strong>insider.</strong><h1>Connect Hermes?</h1><p><b>${client}</b> will be able to read the reels you assign in Insider, including their transcript. It will not receive your Insider password or storage access.</p><p>Access will be sent to <b>${host}</b>.</p><form method="post"><input type="hidden" name="handle" value="${safeHandle}"><button class="allow" name="decision" value="approve">Connect Hermes</button><button class="deny" name="decision" value="deny">Cancel</button></form></main>`;
}

function isLoopbackCallback(value: string) {
	const hostname = new URL(value).hostname;
	return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]';
}

function loopbackCompletionPage(callbackUrl: string) {
	const escapedCallback = escapeHtml(callbackUrl);
	return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Finish Hermes setup · Insider</title><style>body{margin:0;background:#eef3e8;color:#13271f;font:16px system-ui,sans-serif;display:grid;min-height:100vh;place-items:center}.card{background:#fff;max-width:560px;padding:40px;border-radius:20px;box-shadow:0 14px 45px #173b2620}h1{font-size:31px;margin:12px 0}p{line-height:1.5;color:#506057}.local{margin:22px 0;padding:14px 16px;border-radius:10px;background:#edf5e9;color:#245e3e}.remote{margin-top:20px;padding-top:20px;border-top:1px solid #d8ddd5}textarea{box-sizing:border-box;width:100%;min-height:90px;padding:12px;border:1px solid #c8d0c7;border-radius:8px;background:#f6f8f4;color:#18251f;font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;resize:vertical}button{margin-top:10px;border:0;border-radius:999px;padding:11px 15px;background:#194e37;color:#fff;font-weight:700;cursor:pointer}small{display:block;margin-top:10px;color:#68736c}</style><main class="card"><strong>insider.</strong><h1>Finishing Hermes setup</h1><p>Your Insider connection is approved.</p><div class="local"><b>Hermes on this computer?</b><br>It receives the authorization automatically. You can return to Hermes now.</div><section class="remote"><b>Hermes running on a VPS?</b><p>Copy this callback and paste it into the Hermes terminal that is waiting for it. This is a one-time, short-lived authorization code.</p><textarea id="callback" readonly>${escapedCallback}</textarea><button id="copy" type="button">Copy callback</button><small>After Hermes accepts it, refresh Insider to assign reels.</small></section></main><iframe src="${escapedCallback}" hidden aria-hidden="true"></iframe><script>const b=document.getElementById('copy'),t=document.getElementById('callback');b.onclick=async()=>{try{await navigator.clipboard.writeText(t.value);b.textContent='Copied'}catch{t.focus();t.select();b.textContent='Select and copy'}};</script>`;
}

function escapeHtml(value: string) { return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`); }

export default provider;
