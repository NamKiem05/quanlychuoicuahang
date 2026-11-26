type Result = { revision?: number; error?: string };
export type DraftSaveStatus = "idle" | "saving" | "saved" | "conflict" | "invalid" | "unavailable";

export function createDraftSave(initial: string, initialRevision: number) {
  let saved = initial;
  let revision = initialRevision;
  let status: DraftSaveStatus = "idle";
  return {
    dirty: (snapshot: string) => saved !== snapshot,
    status: () => status,
    revision: () => revision,
    async save(snapshot: string, request: (revision: number) => Promise<Result>): Promise<DraftSaveStatus> {
      if (status === "saving" || status === "conflict" || snapshot === saved) return status;
      status = "saving";
      try {
        const result = await request(revision);
        if (Number.isSafeInteger(result.revision) && result.revision! > revision) {
          saved = snapshot;
          revision = result.revision!;
          status = "saved";
        } else {
          status = result.error === "conflict" ? "conflict" : result.error === "invalid" ? "invalid" : "unavailable";
        }
      } catch {
        status = "unavailable";
      }
      return status;
    },
  };
}
