import type { ChatRequest, IntakeEvent } from "#/features/intake/events";
import { validateComplete } from "#/features/intake/schema";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const words = (text: string): string[] => text.match(/\S+\s*/g) ?? [];

/**
 * STUB. Echoes the user and reports form validity, plus one demo form patch.
 * Replace the body with the Together.AI call (tools -> `form.patch` events);
 * the event contract in `events.ts` stays the same.
 */
export async function* runChat({
	messages,
	form,
}: ChatRequest): AsyncGenerator<IntakeEvent> {
	const last = messages.filter((m) => m.role === "user").at(-1)?.content ?? "";
	const errors = Object.entries(validateComplete(form));
	const status = errors.length
		? `The form has ${errors.length} open issue(s): ${errors.map(([path]) => path).join(", ")}.`
		: "The form is complete and valid.";

	for (const word of words(
		`You said: "${last}". ${status} I also set the vehicle make to Toyota.`,
	)) {
		yield { type: "message.delta", text: word };

		await sleep(40);
	}

	yield { type: "form.patch", patch: { vehicle: { make: "Toyota" } } };
	yield { type: "message.done" };
	yield { type: "done" };
}
