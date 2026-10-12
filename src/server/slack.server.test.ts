import { afterEach, describe, expect, it, vi } from "vitest";

const mockEnv = vi.hoisted(() => ({ SLACK_WEBHOOK_URL: "" }));

vi.mock("cloudflare:workers", () => ({ env: mockEnv }));

import { formatHandoffMessage, sendHandoffToSlack } from "./slack.server";

const payload = {
	reason: "wants a person",
	messages: [
		{ role: "user" as const, content: "Can I talk to a human?" },
		{ role: "assistant" as const, content: "" },
	],
	form: { applicant: { fullName: "Ada Lovelace" } },
};

describe("slack handoff", () => {
	it("formats reason, transcript, form and open issues", () => {
		const text = formatHandoffMessage(payload);

		expect(text).toContain("wants a person");
		expect(text).toContain("user: Can I talk to a human?");
		expect(text).toContain("Ada Lovelace");
		expect(text).toContain("• `applicant.dateOfBirth`");
		expect(text).toContain("```json\n{");
	});

	it("escapes Slack control characters and stray code fences", () => {
		const text = formatHandoffMessage({
			...payload,
			messages: [{ role: "user", content: "<!channel> ``` hi & bye" }],
		});

		expect(text).toContain("&lt;!channel&gt;");
		expect(text).toContain("&amp;");
		expect(text).not.toContain("<!channel>");
		expect(text.match(/```/g)).toHaveLength(4);
	});

	it("posts the message to the webhook", async () => {
		mockEnv.SLACK_WEBHOOK_URL = "https://hooks.slack.test/x";

		const fetchMock = vi.fn().mockResolvedValue(new Response("ok"));

		vi.stubGlobal("fetch", fetchMock);

		const result = await sendHandoffToSlack(payload);
		const [url, init] = fetchMock.mock.calls[0] ?? [];

		expect(url).toBe("https://hooks.slack.test/x");
		expect(JSON.parse(init.body).text).toContain("wants a person");
		expect(result.ok).toBe(true);
		expect(result.ref).toBeTruthy();
	});

	it("reports failure on a non-2xx response", async () => {
		mockEnv.SLACK_WEBHOOK_URL = "https://hooks.slack.test/x";
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(new Response("no", { status: 500 })),
		);
		vi.spyOn(console, "error").mockImplementation(() => undefined);

		expect((await sendHandoffToSlack(payload)).ok).toBe(false);
	});

	it("logs instead of posting when the webhook is unset", async () => {
		mockEnv.SLACK_WEBHOOK_URL = "";

		const fetchMock = vi.fn();

		vi.stubGlobal("fetch", fetchMock);
		vi.spyOn(console, "warn").mockImplementation(() => undefined);
		vi.spyOn(console, "log").mockImplementation(() => undefined);

		expect((await sendHandoffToSlack(payload)).ok).toBe(true);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});

describe("slack handoff in production", () => {
	it("reports failure instead of pretending when the webhook is unset", async () => {
		mockEnv.SLACK_WEBHOOK_URL = "";
		vi.stubEnv("PROD", true);

		const fetchMock = vi.fn();

		vi.stubGlobal("fetch", fetchMock);
		vi.spyOn(console, "error").mockImplementation(() => undefined);

		expect((await sendHandoffToSlack(payload)).ok).toBe(false);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});

afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});
