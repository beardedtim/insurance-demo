import { Field, Input, NativeSelect, Switch } from "@chakra-ui/react";

type BaseProps = {
	label: string;
	error?: string;
	required?: boolean;
};

export function TextField({
	label,
	error,
	required,
	value,
	onChange,
	type = "text",
	disabled,
}: BaseProps & {
	value: string | undefined;
	onChange: (value: string | undefined) => void;
	type?: "text" | "date";
	disabled?: boolean;
}) {
	return (
		<Field.Root invalid={!!error} required={required} disabled={disabled}>
			<Field.Label>
				{label}
				<Field.RequiredIndicator />
			</Field.Label>
			<Input
				type={type}
				value={value ?? ""}
				onChange={(e) => onChange(e.target.value || undefined)}
			/>
			<Field.ErrorText>{error}</Field.ErrorText>
		</Field.Root>
	);
}

export function NumberField({
	label,
	error,
	required,
	value,
	onChange,
}: BaseProps & {
	value: number | undefined;
	onChange: (value: number | undefined) => void;
}) {
	return (
		<Field.Root invalid={!!error} required={required}>
			<Field.Label>
				{label}
				<Field.RequiredIndicator />
			</Field.Label>
			<Input
				type="number"
				value={value ?? ""}
				onChange={(e) =>
					onChange(e.target.value === "" ? undefined : Number(e.target.value))
				}
			/>
			<Field.ErrorText>{error}</Field.ErrorText>
		</Field.Root>
	);
}

export function SelectField<T extends string>({
	label,
	error,
	required,
	value,
	options,
	onChange,
}: BaseProps & {
	value: T | undefined;
	options: readonly T[];
	onChange: (value: T | undefined) => void;
}) {
	return (
		<Field.Root invalid={!!error} required={required}>
			<Field.Label>
				{label}
				<Field.RequiredIndicator />
			</Field.Label>
			<NativeSelect.Root>
				<NativeSelect.Field
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
			<Field.ErrorText>{error}</Field.ErrorText>
		</Field.Root>
	);
}

export function SwitchField({
	label,
	checked,
	onChange,
}: {
	label: string;
	checked: boolean;
	onChange: (checked: boolean) => void;
}) {
	return (
		<Switch.Root checked={checked} onCheckedChange={(e) => onChange(e.checked)}>
			<Switch.HiddenInput />
			<Switch.Control />
			<Switch.Label>{label}</Switch.Label>
		</Switch.Root>
	);
}
