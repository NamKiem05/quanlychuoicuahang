import Link from "next/link";
import { notFound } from "next/navigation";
import ThemeBuilder from "@/components/ui/theme-builder";
import SidebarIcon from "@/components/ui/sidebar-icon";
import { readThemeManifest, themeIdPattern, type ThemeProduct } from "@/lib/theme-studio";
import { getMerchantContext } from "../../data";
import "../../../../admin/themes/themes.css";

export default async function Preview({ searchParams }: { searchParams: Promise<{theme?:string}> }) {
  const [{supabase,store,membership},query] = await Promise.all([getMerchantContext(),searchParams]);
  if (!store || membership?.role !== "owner" || typeof query.theme !== "string" || !themeIdPattern.test(query.theme)) notFound();
  const { data, error } = await supabase.rpc("list_store_themes", {shop:store.id});
  const item = (data as ThemeProduct[] | null)?.find(theme => theme.id === query.theme);
  const manifest = readThemeManifest(item?.manifest);
  if (error || !item || !manifest) notFound();
  return <main className="admin-content themes-page">
    <header className="themes-heading"><span className="theme-heading-icon"><SidebarIcon name="appearance" /></span><div><h1 className="admin-page-title">{item.name}</h1><p>Phiên bản {item.version} · Xem trước với dữ liệu minh họa</p></div><Link className="theme-primary" href="/dashboard/themes">← Thư viện giao diện</Link></header>
    <section className="themes-create"><ThemeBuilder initial={manifest} readOnly /></section>
  </main>;
}
