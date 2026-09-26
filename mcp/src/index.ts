interface Env {
	INSIDER: Fetcher;
}

/**
 * Public bearer-authenticated edge for Hermes.
 * Browser traffic is protected by Access on insider-ingest; this Worker exposes
 * only /mcp and dispatches internally, so R2 and D1 remain bound to one Worker.
 */
export default {
	async fetch(request: Request, env: Env) {
		if (new URL(request.url).pathname !== '/mcp') return new Response('Not found', { status: 404 });
		return env.INSIDER.fetch(request);
	},
};
