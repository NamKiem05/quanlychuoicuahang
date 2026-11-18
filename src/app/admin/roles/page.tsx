import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requirePlatformAdminAccess } from "@/lib/platform-account";
import GrantAdminForm from "../admins/grant-admin-form";
import SupportRoleForm from "./support-role-form";
import "./roles.css";

export const metadata = { title: "Vai trò và phân quyền | Quản trị" };
export default async function PlatformRolesPage({ searchParams }: { searchParams: Promise<{ message?: string }> }) {
  const [supabase, query] = await Promise.all([createClient(), searchParams]);
  await requirePlatformAdminAccess(supabase);
  const [result, permissionCheck] = await Promise.all([supabase.from("platform_role_catalog").select("code, name, display_name, responsibilities").order("sort_order"), supabase.rpc("has_support_ticket_permission")]);
  const supportAvailable = !permissionCheck.error && permissionCheck.data === true;
  const messages: Record<string, string> = { "admin-invalid-email": "Email hoặc thao tác chưa hợp lệ.", "admin-list-failed": "Chưa tra cứu được nhân viên.", "admin-user-not-found": "Chưa tìm thấy nhân viên theo email.", "admin-merchant-account-invalid": "Email không thuộc tài khoản nhân viên quản trị riêng.", "admin-already-admin": "Nhân viên đã có quyền admin.", "admin-grant-failed": "Chưa cấp được quyền quản trị.", "admin-granted": "Đã cấp quyền admin toàn nền tảng.", "support-granted": "Đã cấp quyền xử lý ticket hỗ trợ.", "support-revoked": "Đã thu hồi quyền hỗ trợ.", "scoped-failed": "Không cập nhật được quyền hỗ trợ. Kiểm tra migration và quyền truy cập.", "full-admin-first": "Tài khoản đang có quyền admin toàn nền tảng. Cần thu hồi quyền đó trước khi cấp quyền hỗ trợ giới hạn.", "remove-scoped-first": "Cần thu hồi quyền hỗ trợ giới hạn trước khi cấp quyền admin toàn nền tảng." };
  return <main className="admin-content roles-page"><header className="roles-heading"><span aria-hidden="true">◇</span><div><div className="dashboard-kicker">NHÂN VIÊN & PHÂN QUYỀN</div><h1 className="admin-page-title">Vai trò và phân quyền</h1><p>Danh mục vai trò dự kiến dành cho nhân viên quản trị.</p></div><Link href="/admin/admins">Quản lý nhân viên →</Link></header>
    <div className="roles-notice"><strong>Phân quyền theo từng giai đoạn</strong><p>{supportAvailable ? "Có thể cấp quyền hỗ trợ ticket giới hạn hoặc quyền admin toàn nền tảng." : "Quyền hỗ trợ ticket chưa sẵn sàng cho đến khi cập nhật cơ sở dữ liệu."} Các vai trò còn lại chưa được áp dụng. Quyền hỗ trợ chưa bao gồm Live Chat và thông tin cửa hàng ngoài danh sách ticket.</p></div>
    {query.message && messages[query.message] && <p className={["admin-granted", "support-granted", "support-revoked"].includes(query.message) ? "roles-success" : "admin-error"} role="status">{messages[query.message]}</p>}
    <section className="roles-panel roles-grant"><div className="roles-panel-heading"><div><h2>Nhân viên hỗ trợ · ticket</h2><p>Được xem, tạo, phân loại, phân công và trả lời ticket; không có quyền admin toàn nền tảng.</p></div></div>{supportAvailable ? <SupportRoleForm /> : <p className="roles-empty" role="alert">Cần chạy migration 202611180016_support_role_permissions.sql trước khi cấp quyền hỗ trợ.</p>}</section>
    <section className="roles-panel roles-grant"><div className="roles-panel-heading"><div><h2>Cấp quyền admin toàn nền tảng</h2><p>Chỉ cấp quyền sau khi tạo nhân viên. Thao tác này cho phép truy cập toàn bộ khu vực admin, không giới hạn theo bảy vai trò dự kiến.</p></div></div><GrantAdminForm /></section>
    <section className="roles-panel"><div className="roles-panel-heading"><div><h2>Danh sách vai trò</h2><p>{result.error ? "Không tải được danh mục" : `${result.data?.length ?? 0} vai trò dự kiến`}</p></div></div>
      {result.error ? <p className="roles-empty" role="alert">Chưa tải được danh mục. Cần chạy migration 202611180015_platform_role_catalog.sql.</p> : result.data?.length ? <div className="roles-table-wrap"><table><thead><tr><th>Vai trò</th><th>Tên hiển thị</th><th>Nhiệm vụ dự kiến</th><th>Trạng thái</th></tr></thead><tbody>{result.data.map((role) => <tr key={role.code}><td><b>{role.name}</b></td><td>{role.display_name}</td><td>{role.responsibilities}</td><td><span>{role.code === "support_admin" && supportAvailable ? "Áp dụng cho ticket" : role.code === "super_admin" ? "Quyền admin toàn nền tảng" : "Chưa áp dụng"}</span></td></tr>)}</tbody></table></div> : <p className="roles-empty">Chưa có vai trò trong danh mục.</p>}
    </section>
  </main>;
}
