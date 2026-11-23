"use client";
import { useEffect } from "react";

// Bind submissions to the store rendered in this tab, even if another tab switches stores.
export default function ActiveStoreFormGuard({ storeId }: { storeId: string }) {
  useEffect(() => {
    const bindStore = (event: Event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      let input = form.querySelector<HTMLInputElement>('input[name="__active_store_id"]');
      if (!input) { input = document.createElement("input"); input.type = "hidden"; input.name = "__active_store_id"; form.appendChild(input); }
      input.value = storeId;
    };
    document.addEventListener("submit", bindStore, true);
    return () => document.removeEventListener("submit", bindStore, true);
  }, [storeId]);
  return null;
}
