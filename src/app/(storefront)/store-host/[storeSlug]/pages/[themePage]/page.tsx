import StorePage, { generateMetadata } from "../../../../[storeSlug]/store-page";
export { generateMetadata };
export default function HostThemePage(props: Omit<Parameters<typeof StorePage>[0], "hosted">) { return <StorePage {...props} hosted />; }
