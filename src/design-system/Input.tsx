import type { InputHTMLAttributes } from "react";
import {
  FIELD_CONTROL_CLASS,
  FIELD_ERROR_CLASS,
  FieldDescription,
  FieldError,
  FieldLabel,
  useFieldIds,
  type FieldProps
} from "./formField";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "className"> & FieldProps;

/** Single-line text field. Label, description and error are wired to the input for assistive tech. */
export default function Input({
  label,
  description,
  error,
  required,
  className = "",
  id,
  ...rest
}: Props) {
  const { fieldId, descriptionId, errorId, describedBy } = useFieldIds(id, Boolean(description), Boolean(error));

  return (
    <div className={className}>
      <FieldLabel htmlFor={fieldId} required={required}>
        {label}
      </FieldLabel>
      <input
        id={fieldId}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={`mt-1.5 ${FIELD_CONTROL_CLASS} ${error ? FIELD_ERROR_CLASS : ""}`}
        {...rest}
      />
      {description ? <FieldDescription id={descriptionId as string}>{description}</FieldDescription> : null}
      {error ? <FieldError id={errorId as string}>{error}</FieldError> : null}
    </div>
  );
}
