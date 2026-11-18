import Link from "next/link";
import { getMerchantContext } from "../../data";

export default async function AccountProfilePage() {
  const { supabase, userId, email, membership, store } = await getMerchantContext();
  const { data: profile, error } = await supabase.from("profiles")
    .select("display_name, phone").eq("id", userId).maybeSingle();
  const role = membership?.role === "owner" ? "Chủ cửa hàng" : membership?.role === "staff" ? "Nhân viên" : "Chưa có vai trò cửa hàng";
  const name = profile?.display_name?.trim();
  const initial = (name || email || "G").charAt(0).toLocaleUpperCase("vi-VN");

  return (
    <main className="admin-content dashboard-profile">
      <header className="dashboard-profile-heading">
        <h1 className="admin-page-title">Thông tin tài khoản</h1>
        <Link className="dashboard-profile-back" href="/dashboard">← Về tổng quan</Link>
      </header>
      <section className="dashboard-profile-card" aria-labelledby="dashboard-profile-title">
        <div className="dashboard-profile-banner">
          <span className="dashboard-profile-avatar" aria-hidden="true">{initial}</span>
          <div>
            <h2 id="dashboard-profile-title">{name || email || "Tài khoản của bạn"}</h2>
            <span className="dashboard-profile-role">{role}</span>
          </div>
        </div>
        <div className="dashboard-profile-body">
          {error && <p className="dashboard-account-error" role="alert">Chưa tải được họ tên và số điện thoại.</p>}
          <dl className="dashboard-account-details">
            <div><dt>Họ và tên</dt><dd>{name || "Chưa cập nhật"}</dd></div>
            <div><dt>Email</dt><dd>{email ?? "Chưa cập nhật"}</dd></div>
            <div><dt>Số điện thoại</dt><dd>{profile?.phone || "Chưa cập nhật"}</dd></div>
            <div><dt>Cửa hàng</dt><dd>{store?.name ?? "Chưa có cửa hàng"}</dd></div>
          </dl>
          <Link className="dashboard-profile-password-link" href="/dashboard/account">Đổi mật khẩu <span aria-hidden="true">→</span></Link>
        </div>
      </section>
    </main>
  );
}
