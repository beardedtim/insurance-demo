import { describe, expect, it, vi } from "vitest";

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
		expect(text).toContain("- applicant.dateOfBirth");
	});

	it("mock send resolves ok with a ref", async () => {
		const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
		const result = await sendHandoffToSlack(payload);

		expect(result.ok).toBe(true);
		expect(result.ref).toBeTruthy();

		log.mockRestore();
	});
});
