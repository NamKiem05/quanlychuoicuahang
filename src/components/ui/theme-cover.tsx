import Image from "next/image";
import SidebarIcon from "./sidebar-icon";

export default function ThemeCover({ image, family }: { image?: string | null; family: string }) {
  return <div className="theme-preview theme-gallery-cover" data-family={family}>
    {image ? <Image src={image} alt="" width={640} height={360} unoptimized /> :
      <div className="theme-cover-browser" aria-hidden="true">
        <div className="theme-cover-bar"><i /><i /><i /></div>
        <div className="theme-cover-feature"><span /><SidebarIcon name={family === "food" ? "menu" : "store"} /></div>
        <div className="theme-cover-tiles"><i /><i /><i /></div>
      </div>}
  </div>;
}
