import type { TextareaHTMLAttributes } from "react";
import {
  FIELD_CONTROL_CLASS,
  FIELD_ERROR_CLASS,
  FieldDescription,
  FieldError,
  FieldLabel,
  useFieldIds,
  type FieldProps
} from "./formField";

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "className"> & FieldProps;

/**
 * Multi-line text field. Same contract as Input, plus `rows` and `maxLength`.
 *
 * `resize-y`: a long support message needs room, but horizontal resize would let
 * the control push past its container and break the 390px layout.
 */
export default function Textarea({
  label,
  description,
  error,
  required,
  className = "",
  id,
  rows = 4,
  ...rest
}: Props) {
  const { fieldId, descriptionId, errorId, describedBy } = useFieldIds(id, Boolean(description), Boolean(error));

  return (
    <div className={className}>
      <FieldLabel htmlFor={fieldId} required={required}>
        {label}
      </FieldLabel>
      <textarea
        id={fieldId}
        rows={rows}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={`mt-1.5 resize-y ${FIELD_CONTROL_CLASS} ${error ? FIELD_ERROR_CLASS : ""}`}
        {...rest}
      />
      {description ? <FieldDescription id={descriptionId as string}>{description}</FieldDescription> : null}
      {error ? <FieldError id={errorId as string}>{error}</FieldError> : null}
    </div>
  );
}
