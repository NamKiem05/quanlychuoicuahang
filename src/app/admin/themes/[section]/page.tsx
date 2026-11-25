import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requirePlatformAdminAccess } from "@/lib/platform-account";
import { themeAdminMenu } from "@/lib/theme-admin-menu";
import SidebarIcon from "@/components/ui/sidebar-icon";
import ThemesCatalog from "../theme-catalog";
import { ThemeOverview, ThemePolicy, ThemeVersions, ThemeLicenses, ThemeSupport, type Query } from "../theme-admin-sections";

const descriptions = {
  overview:"Theo dõi danh mục, lượt sử dụng, giấy phép và doanh thu.",
  components:"Tra cứu các component hiện có và cấu hình quyền dùng khi phát hành.",
  versions:"Xem lịch sử phát hành, so sánh và khôi phục vào bản nháp.",
  licenses:"Tra cứu giấy phép, đối soát đơn mua và quản lý thu hồi.",
  support:"Theo dõi yêu cầu về website cửa hàng.",
  settings:"Quản lý chính sách phát hành và phân phối.",
};

export default async function Page({params,searchParams}: {params:Promise<{section:string}>;searchParams:Promise<Query>}) {
  const {section}=await params;
  const menu=themeAdminMenu.find(item=>item.slug===section && item.slug!=="");
  if (!menu) notFound();
  if (section==="studio" || section==="pages" || section==="marketplace") {
    const query = await searchParams;
    const normalized = Object.fromEntries(Object.entries(query).map(([key,value]) => [key,typeof value==="string" ? value : undefined]));
    return <ThemesCatalog mode={section} searchParams={Promise.resolve(normalized)} />;
  }
  const [supabase,query]=await Promise.all([createClient(),searchParams]);
  await requirePlatformAdminAccess(supabase);
  const input={supabase,query};
  return <main className="admin-content themes-page">
    <header className="themes-heading"><span className="theme-heading-icon"><SidebarIcon name={menu.icon} /></span><div><h1 className="admin-page-title">{menu.label}</h1><p>{descriptions[section as keyof typeof descriptions]}</p></div><Link className="theme-primary" href="/admin/themes">Kho giao diện</Link></header>
    {query.message==="saved" && <p role="status" className="theme-feedback">Đã lưu thay đổi.</p>}
    {(query.message==="failed" || query.message==="invalid") && <p role="alert" className="theme-feedback is-error">Chưa thực hiện được. Kiểm tra dữ liệu và thử lại.</p>}
    {section==="overview" ? <ThemeOverview {...input} /> : section==="components" ? <ThemePolicy {...input} components /> :
      section==="versions" ? <ThemeVersions {...input} /> : section==="licenses" ? <ThemeLicenses {...input} /> :
      section==="support" ? <ThemeSupport {...input} /> : <ThemePolicy {...input} />}
  </main>;
}
