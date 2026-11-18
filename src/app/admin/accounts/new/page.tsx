import Link from "next/link";
import { requirePlatformAdminAccess } from "@/lib/platform-account";
import { createClient } from "@/lib/supabase/server";
import { createMerchantAccount } from "../actions";
import "../account-detail.css";

export default async function NewAccount({ searchParams }: { searchParams: Promise<{ message?: string }> }) {
  await requirePlatformAdminAccess(await createClient());
  const query = await searchParams;
  return <main className="admin-content account-detail"><Link className="account-detail-back" href="/admin/accounts">← Danh sách tài khoản</Link>
    <section className="account-detail-card"><h1>Tạo tài khoản chủ cửa hàng</h1><p>Tạo tài khoản để người dùng tiếp tục đăng ký gói và cửa hàng. Quyền chủ cửa hàng được gắn khi cửa hàng được tạo.</p>
      <p>Email và số điện thoại chưa được đánh dấu xác minh khi tạo. Hệ thống chưa gửi email xác minh tự động cho tài khoản tạo từ trang này; tài khoản có thể chưa đăng nhập được nếu Supabase yêu cầu xác minh email.</p>
      {query.message && <p className="admin-error" role="alert">{query.message === "invalid" ? "Thông tin chưa hợp lệ. Hãy kiểm tra các trường." : "Không tạo được tài khoản. Email có thể đã tồn tại hoặc cấu hình quản trị chưa sẵn sàng."}</p>}
      <form className="dashboard-form account-detail-form" action={createMerchantAccount}>
        <label>Họ và tên<input name="name" required minLength={2} maxLength={120} autoComplete="name" /></label>
        <label>Email<input name="email" type="email" required maxLength={254} autoComplete="email" /></label>
        <label>Số điện thoại<input name="phone" type="tel" maxLength={30} autoComplete="tel" /></label>
        <label>Mật khẩu ban đầu<input name="password" type="password" required minLength={8} maxLength={128} autoComplete="new-password" /></label>
        <button className="secondary-submit" type="submit">Tạo tài khoản</button>
      </form>
    </section>
  </main>;
}
