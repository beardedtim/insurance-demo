import * as R from "ramda";
import type { z } from "zod";

import {
	applicantSchema,
	claimsSchema,
	coverageSchema,
	crossFieldErrors,
	type FieldErrors,
	type IntakeDraft,
	vehicleSchema,
} from "./schema";

const SHAPES: Record<string, Record<string, z.ZodType>> = {
	applicant: applicantSchema.shape,
	vehicle: vehicleSchema.shape,
	coverage: coverageSchema.shape,
	claims: claimsSchema.shape,
};

const LIABILITY_PATH = "coverage.liabilityLimit";

const isRecord = (value: unknown): value is Record<string, unknown> =>
	R.is(Object, value) && !Array.isArray(value);

const isBlank = (value: unknown): boolean => R.isNil(value) || value === "";

export const mergeDraft = (
	base: IntakeDraft,
	patch: IntakeDraft,
): IntakeDraft => R.mergeDeepRight(base, patch) as IntakeDraft;

const readPath = (draft: IntakeDraft, path: string): unknown =>
	R.path(path.split("."), draft);

/** "roadsideAssistance" -> ["roadside", "assistance"] */
const fieldWords = (path: string): string[] =>
	R.pipe(
		R.split("."),
		R.nth(1),
		R.defaultTo(""),
		R.replace(/([a-z])([A-Z])/g, "$1 $2"),
		R.toLower,
		R.split(" "),
	)(path);

/**
 * Did the user's latest message actually state this value? A conservative text match:
 * a miss makes the agent ask, which is the safe failure for a field the user typed.
 */
export const userStatedValue = (
	message: string,
	path: string,
	value: unknown,
): boolean => {
	const text = message.toLowerCase().replaceAll(",", "");

	if (typeof value === "boolean") {
		return fieldWords(path).some((word) => text.includes(word));
	}

	return text.includes(String(value).toLowerCase());
};

export type SanitizedPatch = {
	patch: IntakeDraft;
	/** `section.field` -> why the proposed value was not saved. */
	rejected: Record<string, string>;
	/** Problems the saved values introduced elsewhere; not dropped, but worth asking about. */
	conflicts: string[];
};

type SanitizeInput = {
	base: IntakeDraft;
	raw: unknown;
	/** Paths the user typed or confirmed. */
	protectedPaths?: readonly string[];
	latestUserMessage?: string;
	today?: string;
};

const withoutEmptySections = (patch: IntakeDraft): IntakeDraft =>
	R.reject(R.isEmpty, patch) as IntakeDraft;

const dropField = (patch: IntakeDraft, path: string): IntakeDraft =>
	withoutEmptySections(R.dissocPath(path.split("."), patch));

/**
 * Field-level gate for agent proposals, run before anything reaches the form: schema
 * validity, user-owned fields, and the cross-field rules. The model is never the last
 * line of defence.
 */
export const sanitizePatch = ({
	base,
	raw,
	protectedPaths = [],
	latestUserMessage = "",
	today,
}: SanitizeInput): SanitizedPatch => {
	const owned = new Set(protectedPaths);
	const rejected: Record<string, string> = {};
	let patch: Record<string, Record<string, unknown>> = {};

	for (const [section, fields] of Object.entries(isRecord(raw) ? raw : {})) {
		const shape = SHAPES[section];

		if (!shape || !isRecord(fields)) {
			continue;
		}

		for (const [field, value] of Object.entries(fields)) {
			const path = `${section}.${field}`;
			const schema = shape[field];

			if (isBlank(value)) {
				continue;
			}

			if (!schema) {
				rejected[path] = "Unknown field";

				continue;
			}

			const parsed = schema.safeParse(value);

			if (!parsed.success) {
				rejected[path] = parsed.error.issues[0]?.message ?? "Invalid value";

				continue;
			}

			const current = readPath(base, path);

			if (current === parsed.data) {
				continue;
			}

			if (
				owned.has(path) &&
				current !== undefined &&
				!userStatedValue(latestUserMessage, path, parsed.data)
			) {
				rejected[path] =
					`The user set this field by hand (currently ${String(current)}); only change it if they explicitly ask in their latest message`;

				continue;
			}

			patch = R.assocPath([section, field], parsed.data, patch);
		}
	}

	const merged = mergeDraft(base, patch as IntakeDraft);

	// Liability is judged against the state minimum by `enforceLiabilityMinimum`.
	for (const [path, message] of Object.entries(
		crossFieldErrors(merged, today),
	)) {
		if (
			path !== LIABILITY_PATH &&
			readPath(patch as IntakeDraft, path) !== undefined
		) {
			rejected[path] = message;
			patch = dropField(patch as IntakeDraft, path) as typeof patch;
		}
	}

	const final = mergeDraft(base, patch as IntakeDraft);
	const before: FieldErrors = crossFieldErrors(base, today);
	const conflicts = Object.entries(crossFieldErrors(final, today))
		.filter(
			([path, message]) => path !== LIABILITY_PATH && before[path] !== message,
		)
		.map(([path, message]) => `${path}: ${message}`);

	return {
		patch: withoutEmptySections(patch as IntakeDraft),
		rejected,
		conflicts,
	};
};
