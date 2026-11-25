import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { defaultPlatformSettings, getPlatformSettings } from "@/lib/platform-settings";
import { AuthIcon } from "./auth-icon";
import "./login/login.css";
import "./password-recovery.css";

export async function RecoveryFrame({ children }: { children: ReactNode }) {
  const { settings } = await getPlatformSettings({ anonymous: true });
  const branding = settings ?? defaultPlatformSettings;

  return <main className="store-auth">
    <div className="store-auth-panel">
      <aside className="store-auth-brand-panel">
        <Link className="store-auth-brand" href="/" aria-label={`Trở về trang giới thiệu ${branding.platform_name}`}>
          {branding.logo_url
            ? <Image src={branding.logo_url} width={104} height={36} alt="" unoptimized />
            : <span className="store-auth-brand-mark"><AuthIcon name="box" /></span>}
          <span>{branding.platform_name}</span>
        </Link>
        <div className="store-auth-brand-copy">
          <p>Khôi phục quyền truy cập an toàn.</p>
          <span>Chỉ người có quyền truy cập email đăng ký mới có thể tạo mật khẩu mới cho tài khoản.</span>
        </div>
      </aside>
      <section className="store-auth-content" aria-label="Khôi phục tài khoản">
        <div className="store-auth-card">{children}</div>
      </section>
    </div>
  </main>;
}

