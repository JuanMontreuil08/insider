export interface EnvAccess {
	DB: D1Database;
	CF_ACCESS_TEAM_DOMAIN?: string;
	CF_ACCESS_AUD?: string;
}

export interface CurrentUser {
	id: string;
	email: string;
}

interface AccessClaims {
	sub?: string;
	email?: string;
	aud?: string | string[];
	iss?: string;
	exp?: number;
	nbf?: number;
}

interface JwkSet {
	keys: AccessJwk[];
}

type AccessJwk = JsonWebKey & { kid?: string };

let cachedKeys: { expiresAt: number; keys: AccessJwk[] } | null = null;

export async function requireCurrentUser(request: Request, env: EnvAccess): Promise<CurrentUser | null> {
	if (!env.CF_ACCESS_TEAM_DOMAIN || !env.CF_ACCESS_AUD) return null;
	const assertion = request.headers.get('Cf-Access-Jwt-Assertion');
	if (!assertion) return null;
	const claims = await verifyAccessJwt(assertion, env.CF_ACCESS_TEAM_DOMAIN, env.CF_ACCESS_AUD);
	if (!claims?.sub || !claims.email) return null;

	const id = crypto.randomUUID();
	const row = await env.DB.prepare(
		`INSERT INTO users (id, access_subject, email) VALUES (?, ?, ?)
		 ON CONFLICT(access_subject) DO UPDATE SET email = excluded.email
		 RETURNING id, email`,
	).bind(id, claims.sub, claims.email).first<CurrentUser>();
	return row ?? null;
}

export function createPersonalToken() {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	return base64Url(bytes);
}

export async function hashToken(token: string) {
	const bytes = new TextEncoder().encode(token);
	const digest = await crypto.subtle.digest('SHA-256', bytes);
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function verifyAccessJwt(token: string, teamDomain: string, audience: string): Promise<AccessClaims | null> {
	const parts = token.split('.');
	if (parts.length !== 3) return null;
	try {
		const header = JSON.parse(new TextDecoder().decode(base64UrlBytes(parts[0]))) as { alg?: string; kid?: string };
		const claims = JSON.parse(new TextDecoder().decode(base64UrlBytes(parts[1]))) as AccessClaims;
		if (header.alg !== 'RS256' || !header.kid || !validClaims(claims, teamDomain, audience)) return null;
		const key = await getKey(teamDomain, header.kid);
		if (!key) return null;
		const signature = base64UrlBytes(parts[2]);
		const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
		const cryptoKey = await crypto.subtle.importKey('jwk', key, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
		return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, signature, signed) ? claims : null;
	} catch {
		return null;
	}
}

function validClaims(claims: AccessClaims, teamDomain: string, audience: string) {
	const now = Math.floor(Date.now() / 1000);
	const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
	return claims.iss === `https://${teamDomain}` && audiences.includes(audience) && typeof claims.exp === 'number' && claims.exp > now && (typeof claims.nbf !== 'number' || claims.nbf <= now);
}

async function getKey(teamDomain: string, kid: string) {
	if (!cachedKeys || cachedKeys.expiresAt < Date.now()) {
		const response = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
		if (!response.ok) return null;
		const jwks = await response.json<JwkSet>();
		cachedKeys = { keys: jwks.keys, expiresAt: Date.now() + 60 * 60 * 1000 };
	}
	return cachedKeys.keys.find((key) => key.kid === kid) ?? null;
}

function base64Url(bytes: Uint8Array) {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function base64UrlBytes(value: string) {
	const normalized = value.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
	const binary = atob(normalized);
	return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
