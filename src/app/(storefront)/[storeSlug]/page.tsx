import StorePage, { generateMetadata } from "./store-page";
export { generateMetadata };
export const instant = false;
export default function Page(props: Omit<Parameters<typeof StorePage>[0], "hosted">) { return <StorePage {...props} />; }
