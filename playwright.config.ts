import { existsSync } from "node:fs";

import { defineConfig, devices } from "@playwright/test";

const APP_PORT = 3100;
const MOCK_PORT = 4010;
const LIVE_ENV_FILE = ".dev.vars.live";

/**
 * Two modes, picked by `E2E_LIVE`:
 * - mock (default): scripted model and fake Slack from `e2e/mock-server.ts`, env from
 *   `.dev.vars.e2e`. Deterministic, free, safe for CI.
 * - live: the real Together model and Slack webhook from `.dev.vars.live`. Costs tokens
 *   and posts to Slack, so it is opt-in (`pnpm test:e2e:live`).
 */
const live = !!process.env.E2E_LIVE;

if (live && !existsSync(LIVE_ENV_FILE)) {
	throw new Error(
		`Live e2e needs ${LIVE_ENV_FILE}. Copy ${LIVE_ENV_FILE}.example and fill it in.`,
	);
}

const appServer = {
	// CLOUDFLARE_ENV picks which .dev.vars.<env> file wrangler loads, and so whether the
	// app talks to the mock or to real services.
	command: `pnpm exec vite dev --port ${APP_PORT} --strictPort`,
	port: APP_PORT,
	env: { CLOUDFLARE_ENV: live ? "live" : "e2e" },
	reuseExistingServer: false,
	timeout: 120_000,
};

export default defineConfig({
	testDir: "e2e",
	// The mock holds shared state, and live runs share one Slack channel and API key.
	workers: 1,
	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	reporter: [["list"], ["html", { open: "never" }]],
	use: {
		baseURL: `http://localhost:${APP_PORT}`,
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
	},
	...(live
		? {
				projects: [
					{
						name: "live",
						testMatch: ["form.spec.ts", "live/**/*.spec.ts"],
						// A real model is slow and occasionally flaky.
						retries: 1,
						timeout: 120_000,
						use: { ...devices["Desktop Chrome"] },
					},
				],
				webServer: [appServer],
			}
		: {
				projects: [
					{
						name: "mock",
						testMatch: ["form.spec.ts", "mock/**/*.spec.ts"],
						retries: process.env.CI ? 1 : 0,
						timeout: 30_000,
						expect: { timeout: 10_000 },
						use: { ...devices["Desktop Chrome"] },
					},
				],
				webServer: [
					{
						command: "node e2e/mock-server.ts",
						port: MOCK_PORT,
						reuseExistingServer: !process.env.CI,
					},
					appServer,
				],
			}),
});
