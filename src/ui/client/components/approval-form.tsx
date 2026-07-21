import { useForm } from "@tanstack/react-form";
import { useId } from "react";

export type ApprovalFormValues = {
  acknowledged: boolean;
};

export type ApprovalFormProps = {
  digestVisible: boolean;
  disabled: boolean;
  isSubmitting: boolean;
  submitLabel?: string;
  digestDescriptionId?: string;
  onApprove: () => Promise<void>;
};

export function ApprovalForm({
  digestVisible,
  disabled,
  isSubmitting,
  submitLabel = "Approve campaign",
  digestDescriptionId = "envelope-digest",
  onApprove,
}: ApprovalFormProps) {
  const acknowledgementId = useId();
  const form = useForm({
    defaultValues: { acknowledged: false } as ApprovalFormValues,
    onSubmit: async () => {
      await onApprove();
    },
  });

  const canApprove = digestVisible && !disabled && !isSubmitting;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void form.handleSubmit();
      }}
    >
      <form.Field name="acknowledged">
        {(field) => (
          <label htmlFor={acknowledgementId}>
            <input
              id={acknowledgementId}
              type="checkbox"
              aria-describedby={digestDescriptionId}
              checked={field.state.value}
              disabled={disabled || isSubmitting}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.checked)}
            />
            I have reviewed the preflight proposal and approve the displayed campaign digest.
          </label>
        )}
      </form.Field>
      <form.Subscribe selector={(state) => state.values.acknowledged}>
        {(acknowledged) => (
          <button type="submit" disabled={!canApprove || !acknowledged}>
            {isSubmitting ? "Submitting approval…" : submitLabel}
          </button>
        )}
      </form.Subscribe>
    </form>
  );
}
