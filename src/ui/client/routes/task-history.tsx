import { useParams } from "@tanstack/react-router";

export function TaskHistoryRoute() {
  const { taskId } = useParams({ strict: false }) as { taskId?: string };
  return (
    <section>
      <h1>Task history</h1>
      <p>Task: {taskId ?? "unknown"}</p>
    </section>
  );
}
