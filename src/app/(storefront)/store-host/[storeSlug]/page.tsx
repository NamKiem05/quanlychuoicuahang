import StorePage, { generateMetadata } from "../../[storeSlug]/store-page";
export { generateMetadata };
export const instant = false;
export default function HostStorePage(props: Omit<Parameters<typeof StorePage>[0], "hosted">) { return <StorePage {...props} hosted />; }
