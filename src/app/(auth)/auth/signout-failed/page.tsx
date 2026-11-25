import Link from "next/link";
import { signOut } from "@/app/(merchant)/dashboard/actions";
import "../../login/login.css";

export default function SignOutFailedPage() {
  return <main className="store-auth">
    <section className="store-auth-content">
      <div className="store-auth-card">
        <h1>Chưa xác nhận được việc đăng xuất</h1>
        <p className="store-auth-intro">Anh có thể thử đăng xuất lại.</p>
        <form className="store-auth-form" action={signOut}>
          <button className="store-auth-submit" type="submit">Thử đăng xuất lại</button>
          <Link className="store-auth-text-button" href="/login">Quay lại GrowDesk</Link>
        </form>
      </div>
    </section>
  </main>;
}
