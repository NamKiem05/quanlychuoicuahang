import ThemesCatalog from "./theme-catalog";
export default function Page(props: Pick<Parameters<typeof ThemesCatalog>[0], "searchParams">) { return <ThemesCatalog {...props} />; }
