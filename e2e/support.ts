import { expect, type Page } from "@playwright/test";

import type { ScriptStep } from "./mock-server.ts";

const MOCK = "http://127.0.0.1:4010";

const post = (path: string, body?: unknown) =>
	fetch(`${MOCK}${path}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: body === undefined ? undefined : JSON.stringify(body),
	});

/** Control surface for the mock model and Slack server. */
export const mock = {
	reset: () => post("/__reset"),
	/** Queue the model's replies, one step per round of the agent loop. */
	script: (steps: ScriptStep[]) => post("/__script", steps),
	/** Every chat-completions request the app made, as parsed JSON. */
	requests: async () =>
		(await (await fetch(`${MOCK}/__requests`)).json()) as {
			messages: { role: string; content: string | null }[];
		}[],
	/** Every Slack webhook payload the app posted. */
	slack: async () =>
		(await (await fetch(`${MOCK}/__slack`)).json()) as { text: string }[],
};

/** Scripts a tool call followed by a closing message, the shape of most agent turns. */
export const fillTurn = (args: unknown, reply: string): ScriptStep[] => [
	{ tools: [{ name: "update_form", args }] },
	{ text: reply },
];

/** Form inputs by label. Anchored, because "Year" also appears inside "...5 years)". */
export const field = (page: Page, label: string) =>
	page.getByLabel(new RegExp(`^${label}`));

export const say = async (page: Page, message: string) => {
	await page.getByPlaceholder("Message the assistant…").fill(message);
	await page.getByRole("button", { name: "Send" }).click();
};

/** Waits for the agent's turn to finish (the Send button stops loading). */
export const turnDone = (page: Page, timeout?: number) =>
	expect(page.getByRole("button", { name: "Send" })).toBeEnabled({ timeout });
