import { Suspense } from "react";
import ThemeLibrary, { ThemeLibrarySkeleton } from "./theme-library";
import type { Query } from "./theme-admin-sections";

export default function Page({ searchParams }: { searchParams: Promise<Query> }) {
  return <Suspense fallback={<main className="admin-content themes-page"><ThemeLibrarySkeleton /></main>}>
    <ThemeLibrary searchParams={searchParams} />
  </Suspense>;
}
