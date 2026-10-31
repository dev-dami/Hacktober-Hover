import { ApiError, streamEvents, type AgentEvent } from "./api";
import type { ScanSession } from "./stores";

export interface ReaderStep {
  message: string;
  done: boolean;
}

/**
 * Runs the label-reading agent (first read or close-up) and folds its event stream into the session.
 * Never throws: a failed or interrupted run is reported in `aiError` so the user can still type the details.
 */
export async function runReader(
  path: string,
  init: RequestInit,
  start: ScanSession,
  onSteps: (steps: ReaderStep[]) => void,
): Promise<ScanSession> {
  let session: ScanSession = { ...start, needPhoto: null, aiError: null };
  let steps: ReaderStep[] = [];

  function apply(event: AgentEvent) {
    switch (event.type) {
      case "step":
        steps = [...steps.map((step) => ({ ...step, done: true })), { message: event.message, done: false }];
        onSteps(steps);
        break;
      case "fields":
        session = { ...session, fields: event.fields, agentFields: event.fields, confidence: event.confidence };
        break;
      case "check":
        session = { ...session, result: event.result };
        break;
      case "need_photo":
        session = { ...session, needPhoto: { fields: event.fields, hint: event.hint } };
        break;
      case "done":
        session = { ...session, notes: event.summary.notes };
        steps = steps.map((step) => ({ ...step, done: true }));
        onSteps(steps);
        break;
      case "error":
        session = { ...session, aiError: event.message };
        break;
    }
  }

  try {
    await streamEvents(path, init, apply);
  } catch (error) {
    session = { ...session, aiError: error instanceof ApiError ? error.message : "The check was interrupted." };
  }
  return session;
}
