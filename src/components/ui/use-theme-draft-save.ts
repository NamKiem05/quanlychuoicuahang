"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createDraftSave, type DraftSaveStatus } from "@/lib/theme-draft-save";
import type { ThemeManifest } from "@/lib/theme-studio";

export type ThemeAutosave = {
  id: string; revision: number;
  save: (id: string, revision: number, draft: ThemeManifest) => Promise<{ revision?: number; error?: string }>;
};

export function useThemeDraftSave(initial: ThemeManifest, draft: ThemeManifest, autosave?: ThemeAutosave, guard = false) {
  const snapshot = JSON.stringify(draft);
  const [initialSnapshot] = useState(() => JSON.stringify(initial));
  const [machine] = useState(() => createDraftSave(initialSnapshot, autosave?.revision ?? 0));
  const [status, setStatus] = useState<DraftSaveStatus>("idle");
  const editor = useRef<HTMLElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attempted = useRef("");
  const dirty = machine.dirty(snapshot);
  const persist = useCallback(async () => {
    if (!autosave || machine.status() === "saving" || machine.status() === "conflict" || !machine.dirty(snapshot)) return;
    if (timer.current) clearTimeout(timer.current);
    attempted.current = snapshot;
    const result = machine.save(snapshot, revision => autosave.save(autosave.id, revision, draft));
    setStatus("saving");
    const next = await result;
    if (next === "saved") {
      const section = editor.current?.closest(".themes-create");
      section?.querySelectorAll<HTMLInputElement>("[data-theme-revision]").forEach(input => { input.value = String(machine.revision()); });
      section?.querySelectorAll<HTMLButtonElement>("[data-theme-publish]").forEach(button => { button.disabled = false; });
    }
    setStatus(next);
  }, [autosave, machine, snapshot, draft, setStatus]);

  useEffect(() => {
    if (!autosave || !dirty || status === "saving" || status === "conflict" || attempted.current === snapshot) return;
    const scheduled = setTimeout(persist, 900);
    timer.current = scheduled;
    return () => clearTimeout(scheduled);
  }, [autosave, dirty, status, snapshot, persist]);

  useEffect(() => {
    if (!autosave || !dirty || status !== "unavailable") return;
    window.addEventListener("online", persist);
    return () => window.removeEventListener("online", persist);
  }, [autosave, dirty, status, persist]);

  useEffect(() => {
    const section = editor.current?.closest(".themes-create");
    function submit(event: Event) {
      const target = (event as SubmitEvent).submitter as HTMLButtonElement | null;
      if (machine.status() === "saving" || machine.status() === "conflict" ||
        (guard && machine.dirty(snapshot) && (target?.name === "operation" && target.value !== "save" || target?.hasAttribute("data-theme-publish")))) {
        event.preventDefault();
        return;
      }
      if (timer.current) clearTimeout(timer.current);
    }
    section?.addEventListener("submit", submit, true);
    return () => section?.removeEventListener("submit", submit, true);
  }, [machine, guard, snapshot]);

  useEffect(() => {
    if (!guard || (!dirty && status !== "saving")) return;
    function leave(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    function follow(event: MouseEvent) {
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(link instanceof HTMLAnchorElement) || event.defaultPrevented || event.button !== 0
        || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || link.target === "_blank"
        || (link.pathname === location.pathname && link.search === location.search && link.hash)) return;
      if ((machine.dirty(snapshot) || machine.status() === "saving") && !window.confirm("Bản nháp còn thay đổi chưa lưu. Anh muốn rời trang?")) {
        event.preventDefault();
        event.stopPropagation();
      }
    }
    window.addEventListener("beforeunload", leave);
    document.addEventListener("click", follow, true);
    return () => {
      window.removeEventListener("beforeunload", leave);
      document.removeEventListener("click", follow, true);
    };
  }, [guard, dirty, machine, snapshot, status]);

  return { editor, persist, dirty, status };
}
