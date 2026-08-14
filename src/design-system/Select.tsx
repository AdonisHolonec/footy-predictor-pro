import type { SelectHTMLAttributes } from "react";
import {
  FIELD_CONTROL_CLASS,
  FIELD_ERROR_CLASS,
  FieldDescription,
  FieldError,
  FieldLabel,
  useFieldIds,
  type FieldProps
} from "./formField";

export type SelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

type Props = Omit<SelectHTMLAttributes<HTMLSelectElement>, "className" | "children"> &
  FieldProps & {
    options: SelectOption[];
    /** Shown first, disabled and unselectable — for "choose a category" prompts. */
    placeholder?: string;
  };

/**
 * Native `<select>` with the app's field styling.
 *
 * Deliberately not a custom listbox: the native control already gives keyboard
 * navigation, type-ahead, screen-reader semantics and the platform picker that
 * mobile users expect. A hand-rolled replacement would have to re-earn all of
 * that, and this project ships no headless UI library to borrow it from.
 */
export default function Select({
  label,
  description,
  error,
  required,
  className = "",
  id,
  options,
  placeholder,
  ...rest
}: Props) {
  const { fieldId, descriptionId, errorId, describedBy } = useFieldIds(id, Boolean(description), Boolean(error));

  return (
    <div className={className}>
      <FieldLabel htmlFor={fieldId} required={required}>
        {label}
      </FieldLabel>
      <select
        id={fieldId}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={`mt-1.5 ${FIELD_CONTROL_CLASS} ${error ? FIELD_ERROR_CLASS : ""}`}
        {...rest}
      >
        {placeholder ? (
          <option value="" disabled>
            {placeholder}
          </option>
        ) : null}
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
      {description ? <FieldDescription id={descriptionId as string}>{description}</FieldDescription> : null}
      {error ? <FieldError id={errorId as string}>{error}</FieldError> : null}
    </div>
  );
}
