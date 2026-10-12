import {
	Badge,
	Button,
	Field,
	Flex,
	Input,
	NativeSelect,
	Switch,
} from "@chakra-ui/react";
import { useStore } from "@tanstack/react-store";

import {
	confirmField,
	intakeStore,
	type Provenance,
} from "#/features/intake/store";

type BaseProps = {
	/** `section.field`, the key into provenance and rejected proposals. */
	path: string;
	label: string;
	error?: string;
	required?: boolean;
};

const PROVENANCE_BADGE: Record<
	Provenance,
	{ label: string; colorPalette: "purple" | "blue" | "green" }
> = {
	agent: { label: "Suggested", colorPalette: "purple" },
	user: { label: "Edited by you", colorPalette: "blue" },
	confirmed: { label: "Confirmed", colorPalette: "green" },
};

/** Empty, proposed, edited, confirmed or invalid: what the user sees for one field. */
const useFieldState = (path: string, error: string | undefined) => {
	const source = useStore(intakeStore, (s) => s.provenance[path]);
	const rejected = useStore(intakeStore, (s) => s.rejected[path]);

	return {
		source,
		error: error ?? (rejected && `Suggestion not saved: ${rejected}`),
		inputBg: source === "agent" ? "purple.subtle" : undefined,
	};
};

function FieldStatus({
	path,
	source,
}: {
	path: string;
	source: Provenance | undefined;
}) {
	if (!source) {
		return null;
	}

	const { label, colorPalette } = PROVENANCE_BADGE[source];

	return (
		<Flex align="center" gap="1">
			<Badge colorPalette={colorPalette}>{label}</Badge>
			{source === "agent" && (
				<Button
					size="2xs"
					variant="plain"
					colorPalette="purple"
					onClick={() => confirmField(path)}
				>
					Confirm
				</Button>
			)}
		</Flex>
	);
}

function FieldShell({
	path,
	label,
	required,
	error,
	disabled,
	children,
}: BaseProps & {
	disabled?: boolean;
	children: (inputBg: string | undefined) => React.ReactNode;
}) {
	const state = useFieldState(path, error);

	return (
		<Field.Root invalid={!!state.error} required={required} disabled={disabled}>
			<Flex align="center" justify="space-between" gap="2" w="full">
				<Field.Label>
					{label}
					<Field.RequiredIndicator />
				</Field.Label>
				<FieldStatus path={path} source={state.source} />
			</Flex>
			{children(state.inputBg)}
			<Field.ErrorText>{state.error}</Field.ErrorText>
		</Field.Root>
	);
}

export function TextField({
	value,
	onChange,
	type = "text",
	...shell
}: BaseProps & {
	value: string | undefined;
	onChange: (value: string | undefined) => void;
	type?: "text" | "date" | "email";
	disabled?: boolean;
}) {
	return (
		<FieldShell {...shell}>
			{(bg) => (
				<Input
					type={type}
					bg={bg}
					value={value ?? ""}
					onChange={(e) => onChange(e.target.value || undefined)}
				/>
			)}
		</FieldShell>
	);
}

export function NumberField({
	value,
	onChange,
	...shell
}: BaseProps & {
	value: number | undefined;
	onChange: (value: number | undefined) => void;
}) {
	return (
		<FieldShell {...shell}>
			{(bg) => (
				<Input
					type="number"
					bg={bg}
					value={value ?? ""}
					onChange={(e) =>
						onChange(e.target.value === "" ? undefined : Number(e.target.value))
					}
				/>
			)}
		</FieldShell>
	);
}

export function SelectField<T extends string>({
	value,
	options,
	onChange,
	...shell
}: BaseProps & {
	value: T | undefined;
	options: readonly T[];
	onChange: (value: T | undefined) => void;
}) {
	return (
		<FieldShell {...shell}>
			{(bg) => (
				<NativeSelect.Root>
					<NativeSelect.Field
						bg={bg}
						value={value ?? ""}
						onChange={(e) => onChange((e.target.value || undefined) as T)}
					>
						<option value="">Select…</option>
						{options.map((option) => (
							<option key={option} value={option}>
								{option}
							</option>
						))}
					</NativeSelect.Field>
					<NativeSelect.Indicator />
				</NativeSelect.Root>
			)}
		</FieldShell>
	);
}

export function SwitchField({
	path,
	label,
	checked,
	onChange,
}: {
	path: string;
	label: string;
	checked: boolean;
	onChange: (checked: boolean) => void;
}) {
	const { source } = useFieldState(path, undefined);

	return (
		<Flex align="center" gap="3">
			<Switch.Root
				checked={checked}
				onCheckedChange={(e) => onChange(e.checked)}
			>
				<Switch.HiddenInput />
				<Switch.Control />
				<Switch.Label>{label}</Switch.Label>
			</Switch.Root>
			<FieldStatus path={path} source={source} />
		</Flex>
	);
}
