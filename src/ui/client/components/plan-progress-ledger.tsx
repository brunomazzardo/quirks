import type { UiPlanProgressV1 } from "../../ports/campaign-read.js";

export function PlanProgressUnavailable() {
  return (
    <section aria-labelledby="plan-progress-heading" className="plan-progress-ledger">
      <h2 id="plan-progress-heading">Plan progress</h2>
      <p role="note">No plan progress recorded for this campaign.</p>
    </section>
  );
}

export function PlanProgressLedger({ projection }: { projection: UiPlanProgressV1 }) {
  return (
    <section aria-labelledby="plan-progress-heading" className="plan-progress-ledger">
      <h2 id="plan-progress-heading">Plan progress</h2>
      <p>
        <strong>{projection.plan.taskTitle}</strong> ({projection.plan.path})
      </p>
      <p>
        Agent {projection.execution.agentLabel} · {projection.execution.runnerKind} · {projection.execution.model}
      </p>
      <p>
        Stage {projection.execution.stage}
        {projection.execution.tddPhase ? ` · TDD ${projection.execution.tddPhase}` : ""}
      </p>
      <p>Worker reported: {projection.execution.workerReportedAt ?? "not yet"}</p>
      <p>Controller observed: {projection.execution.controllerObservedAt}</p>
      <p>Age: {projection.execution.progressAgeSeconds}s · Source: {projection.source}</p>
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
    </section>
  );
}
