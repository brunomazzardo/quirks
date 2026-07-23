import type { UiPlanProgressV1 } from "../../ports/campaign-read.js";

export function PlanProgressUnavailable() {
  return (
    <section aria-labelledby="plan-progress-heading" className="workspace-panel plan-progress-ledger">
      <div className="workspace-panel-body">
        <h2 id="plan-progress-heading">Plan progress</h2>
        <p role="note">No plan progress recorded for this campaign.</p>
      </div>
    </section>
  );
}

/**
 * Spec §22 vertical execution ledger styled with the approved step grammar.
 * Worker-reported and controller-reviewed states keep their distinct text
 * labels — the trust boundary is text plus tone, never color alone.
 */
export function PlanProgressLedger({ projection }: { projection: UiPlanProgressV1 }) {
  return (
    <section aria-labelledby="plan-progress-heading" className="workspace-panel plan-progress-ledger">
      <div className="workspace-panel-body">
        <h2 id="plan-progress-heading">Plan progress</h2>
        {projection.plan.taskTitle !== null ? (
          <p>
            <strong>{projection.plan.taskTitle}</strong> ({projection.plan.path})
          </p>
        ) : (
          <p>
            <strong>{projection.plan.path}</strong>
          </p>
        )}
        {projection.plan.taskNumber !== null ? (
          <p className="cell-note">{`Plan task ${projection.plan.taskNumber} at ${projection.plan.commit}`}</p>
        ) : (
          <p className="cell-note">{`Plan at ${projection.plan.commit}`}</p>
        )}
        <p>
          Agent {projection.execution.agentLabel} · {projection.execution.runnerKind} · {projection.execution.model}
        </p>
        <p>
          Stage {projection.execution.stage}
          {projection.execution.tddPhase ? ` · TDD ${projection.execution.tddPhase}` : ""}
        </p>
        <p className="cell-note">Worker reported: {projection.execution.workerReportedAt ?? "not yet"}</p>
        <p className="cell-note">Controller observed: {projection.execution.controllerObservedAt}</p>
        <p className="cell-note">Age: {projection.execution.progressAgeSeconds}s · Source: {projection.source}</p>
        <ol>
          {projection.steps.map((step) => (
            <li key={step.key} data-status={step.status}>
              <span>
                {step.number}. {step.label}
              </span>{" "}
              <span>
                {step.status === "reported_complete" ? "Worker reported" : step.status === "reviewed" ? "Controller reviewed" : step.status}
              </span>
            </li>
          ))}
        </ol>
        <p>Completion authority: {projection.completionAuthority}</p>
      </div>
    </section>
  );
}
