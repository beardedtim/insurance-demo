/**
 * Runs against the real model and the real Slack webhook (`pnpm test:e2e:live`).
 *
 * A real model is not scriptable, so these assert outcomes that must hold whatever the
 * wording: fields eventually fill in, a hand edit survives, the handoff banner appears.
 * Nothing here checks exact assistant text.
 */
import { expect, test } from "@playwright/test";

import { field, say, turnDone } from "../support.ts";

const MODEL_WAIT = 60_000;

test.beforeEach(async ({ page }) => {
	await page.goto("/", { waitUntil: "networkidle" });
});

test("the agent turns a free-text message into form fields", async ({ page }) => {
	await say(
		page,
		"Hi, I'm Ada Lovelace, my email is ada@example.com and I drive a 2020 Toyota Corolla.",
	);

	await expect(field(page, "Full name")).toHaveValue(/ada/i, {
		timeout: MODEL_WAIT,
	});
	await expect(field(page, "Email")).toHaveValue("ada@example.com", {
		timeout: MODEL_WAIT,
	});
	await expect(field(page, "Year")).toHaveValue("2020", { timeout: MODEL_WAIT });
	await expect(field(page, "Make")).toHaveValue(/toyota/i, {
		timeout: MODEL_WAIT,
	});
	await expect(field(page, "Model")).toHaveValue(/corolla/i, {
		timeout: MODEL_WAIT,
	});
	await expect(page.getByText("Suggested").first()).toBeVisible();
});

test("a hand edit is not overwritten on the next turn", async ({ page }) => {
	await say(page, "I keep my car in California.");
	await expect(field(page, "Garaging state")).toHaveValue("CA", {
		timeout: MODEL_WAIT,
	});
	await turnDone(page, MODEL_WAIT);

	await field(page, "Garaging state").selectOption("NY");
	await say(page, "Ok, what else do you still need from me?");
	await turnDone(page, MODEL_WAIT);

	await expect(field(page, "Garaging state")).toHaveValue("NY");
});

// Posts a real message to the webhook in .dev.vars.live: point it at a test channel.
test("asking for a human notifies the customer-service team", async ({ page }) => {
	await say(page, "My name is Ada Lovelace.");
	await turnDone(page, MODEL_WAIT);

	await say(page, "I'd like to speak to a human agent, please.");

	await expect(
		page.getByText("The customer-service team has been notified"),
	).toBeVisible({ timeout: MODEL_WAIT });
	// The reference is shown in the banner and again in the action timeline.
	await expect(page.getByText(/Reference [0-9a-f-]{36}/).first()).toBeVisible();
});
