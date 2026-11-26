import "../components/platform/platform-home.css";
import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { connection } from "next/server";
import { defaultPlatformSettings, getPlatformSettings } from "@/lib/platform-settings";
import { LandingPreviewTilt, LandingTheme, LandingThemeButton } from "@/components/platform/landing-interactions";

const signupHref = "/login?mode=signup";

const features = [
  { title: "Website bán hàng riêng", description: "Chọn mẫu giao diện, thêm logo và chia sẻ đường dẫn để khách đặt hàng trực tiếp.", icon: "M3 5h18v14H3zM3 9h18m-13 0v10" },
  { title: "Quản lý đơn hàng", description: "Xem đơn mới và cập nhật trạng thái từ lúc xác nhận đến khi giao hoặc hoàn tất.", icon: "M2 3h3l3 12h11l2-8H6m3 13h.01M18 20h.01" },
  { title: "Thống kê doanh thu", description: "Theo dõi doanh thu và tình hình bán hàng trong khu vực quản lý cửa hàng.", icon: "M4 20V10m6 10V4m6 16v-7m6 7H2" },
  { title: "Quản lý sản phẩm và tồn kho", description: "Cập nhật danh mục, giá, hình ảnh và số lượng tồn cho các sản phẩm cần theo dõi.", icon: "m3 8 9-5 9 5v8l-9 5-9-5zm0 0 9 5 9-5m-9 5v8" },
  { title: "Thanh toán và giao nhận", description: "Thiết lập chuyển khoản QR và phương thức giao hoặc nhận tại cửa hàng.", icon: "M2 5h20v14H2zm0 5h20" },
  { title: "Khuyến mãi và đánh giá", description: "Xem phản hồi của khách và tạo mã khuyến mãi với Gói Nâng cao.", icon: "M3 4h18v13H8l-5 4zM7 9h10m-10 4h6" },
];

const steps = [
  { title: "Chọn mẫu giao diện", description: "Sau khi đăng ký và chọn gói, chọn mẫu phù hợp với cửa hàng của bạn." },
  { title: "Tùy chỉnh theo thương hiệu", description: "Thêm logo, sản phẩm và thiết lập phương thức thanh toán, giao nhận." },
  { title: "Xuất bản và nhận đơn", description: "Chia sẻ link website cho khách và theo dõi đơn trong bảng điều khiển." },
];

const sampleStats = [
  { label: "Website đã được tạo", text: "10.000+", value: 10000, decimals: 0, suffix: "+" },
  { label: "Khách hàng hài lòng", text: "98%", value: 98, decimals: 0, suffix: "%" },
  { label: "Thời gian hoạt động", text: "99,9%", value: 99.9, decimals: 1, suffix: "%" },
  { label: "Mẫu giao diện có sẵn", text: "150+", value: 150, decimals: 0, suffix: "+" },
];

const samplePlans = [
  { name: "Khởi đầu", price: "[GIÁ]", monthly: true, description: "Dành cho cá nhân và doanh nghiệp nhỏ mới bắt đầu.", features: ["1 website", "Mẫu giao diện cơ bản", "Tên miền phụ miễn phí"], action: "Bắt đầu" },
  { name: "Doanh nghiệp", price: "[GIÁ]", monthly: true, featured: true, description: "Dành cho doanh nghiệp cần tên miền riêng và bán hàng.", features: ["Nhiều website", "Tên miền riêng và SSL", "Cửa hàng và thanh toán", "Làm việc nhóm"], action: "Dùng thử miễn phí" },
  { name: "Tập đoàn", price: "Liên hệ", monthly: false, description: "Dành cho tổ chức lớn cần hỗ trợ và tích hợp riêng.", features: ["Phân quyền nâng cao", "Hỗ trợ ưu tiên", "Tích hợp theo yêu cầu"], action: "Nói chuyện với chúng tôi" },
];

export async function generateMetadata(): Promise<Metadata> {
  await connection();
  const { settings } = await getPlatformSettings();
  const current = settings ?? defaultPlatformSettings;
  return {
    title: `${current.platform_name} | Nền tảng bán hàng`,
    description: current.description || defaultPlatformSettings.description,
  };
}

function WebsitePreview() {
  return (
    <LandingPreviewTilt>
      <div className="landing-preview">
        <div className="landing-preview-top"><span /><span /><span /><small>tencuaban.vn</small></div>
        <div className="landing-preview-body">
          <div className="landing-preview-sidebar">
            {["Khối tiêu đề", "Sản phẩm", "Giới thiệu", "Liên hệ"].map((block) => <span key={block}>{block}</span>)}
          </div>
          <div className="landing-preview-content">
            <span className="landing-preview-title" />
            <div className="landing-preview-banner"><span /><span /><span /><span /></div>
            <div className="landing-preview-products"><span /><span /><span /></div>
          </div>
        </div>
      </div>
      <div className="landing-preview-published"><span>✓</span><div><strong>Đã xuất bản</strong><small>tencuaban.vn</small></div></div>
      <div className="landing-preview-palette"><strong>Màu thương hiệu</strong><div><span /><span /><span /><span /></div></div>
      <span className="landing-preview-orb" />
    </LandingPreviewTilt>
  );
}

export default async function HomePage() {
  await connection();
  const { settings } = await getPlatformSettings();
  const current = settings ?? defaultPlatformSettings;

  return (
    <LandingTheme>
      <header className="landing-header">
        <div className="landing-container landing-header-inner">
          <Link className="landing-brand" href="/" aria-label={current.platform_name}>
            {current.logo_url
              ? <Image src={current.logo_url} width={180} height={72} alt={current.platform_name} unoptimized />
              : <><span aria-hidden="true" />{current.platform_name}</>}
          </Link>
          <nav aria-label="Điều hướng chính">
            <a href="#tinh-nang">Tính năng</a>
            <a href="#cach-hoat-dong">Cách hoạt động</a>
            <a href="#bang-gia">Bảng giá</a>
          </nav>
          <div className="landing-header-actions">
            <LandingThemeButton />
            <Link className="landing-button landing-primary" href="/login">Đăng nhập</Link>
          </div>
        </div>
      </header>

      <main>
        <section className="landing-container landing-hero">
          <div className="landing-hero-copy">
            <span className="landing-label">Nền tảng tạo website bán hàng</span>
            <h1>Website của riêng bạn, <span>sẵn sàng bán hàng online.</span></h1>
            <p>Chọn mẫu, tùy chỉnh theo thương hiệu và quản lý sản phẩm, đơn hàng, doanh thu ngay trên một nền tảng.</p>
            <div className="landing-actions">
              <Link id="bat-dau" className="landing-button landing-primary" href={signupHref}>Tạo gian hàng</Link>
              <a className="landing-button" href="#cach-hoat-dong">Xem cách hoạt động</a>
            </div>
            <Link className="landing-text-link" href="/demo">Thử dashboard mẫu →</Link>
          </div>
          <WebsitePreview />
          <div className="landing-stats" data-landing-reveal>
            <dl className="landing-highlights">
              {sampleStats.map(({ label, text, value, decimals, suffix }) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>
                    <span className="sr-only">{text}</span>
                    <span aria-hidden="true" data-landing-stat={value} data-decimals={decimals} data-suffix={suffix}>{text}</span>
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section id="tinh-nang" className="landing-panel">
          <div className="landing-container landing-section">
            <div className="landing-heading">
              <h2 data-landing-reveal>Mọi thứ cửa hàng cần để bán hàng online</h2>
              <p>Thiết kế website và quản lý việc bán hàng trong cùng một bảng điều khiển.</p>
            </div>
            <div className="landing-grid">
              {features.map(({ title, description, icon }) => (
                <article className="landing-card" data-landing-reveal key={title}>
                  <span className="landing-icon">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={icon} /></svg>
                  </span>
                  <h3>{title}</h3>
                  <p>{description}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="cach-hoat-dong">
          <div className="landing-container landing-section">
            <div className="landing-heading">
              <h2 data-landing-reveal>Ba bước để có website</h2>
            </div>
            <ol className="landing-grid landing-step-list">
              {steps.map(({ title, description }, index) => (
                <li className="landing-card landing-step" data-landing-reveal key={title}>
                  <span className="landing-step-number" aria-hidden="true">0{index + 1}</span>
                  <h3>{title}</h3>
                  <p>{description}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="bang-gia" className="landing-panel">
          <div className="landing-container landing-section">
            <div className="landing-heading">
              <h2 data-landing-reveal>Bảng giá linh hoạt</h2>
              <p>Bắt đầu miễn phí, nâng cấp khi doanh nghiệp lớn lên.</p>
            </div>
            <div className="landing-grid landing-price-grid">
              {samplePlans.map((plan) => (
                <article className={`landing-card landing-plan${plan.featured ? " landing-plan-highlight" : ""}`} data-landing-reveal key={plan.name}>
                  <h3>{plan.name}</h3>
                  <p className="landing-price"><strong>{plan.price}</strong>{plan.monthly && " / tháng"}</p>
                  <p>{plan.description}</p>
                  <ul>{plan.features.map((feature) => <li key={feature}>{feature}</li>)}</ul>
                  <a className={`landing-button${plan.featured ? " landing-primary" : ""}`} href={plan.monthly ? "#bat-dau" : "#lien-he"}>{plan.action}</a>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="lien-he" className="landing-container landing-section">
          <div className="landing-contact" data-landing-reveal>
            <h2>Sẵn sàng đưa cửa hàng lên mạng?</h2>
            <p>Tạo tài khoản để bắt đầu thiết lập website bán hàng của bạn.</p>
            <Link className="landing-button" href={signupHref}>Tạo gian hàng</Link>
          </div>
        </section>
      </main>

      <footer className="landing-container landing-footer">
        <small>© {new Date().getFullYear()} {current.platform_name}</small>
        <nav aria-label="Điều hướng cuối trang">
          <a href="#tinh-nang">Tính năng</a>
          <a href="#bang-gia">Bảng giá</a>
          {current.contact_email && <a href={`mailto:${current.contact_email}`}>Email hỗ trợ</a>}
          {current.support_phone && <a href={`tel:${current.support_phone}`}>Gọi hỗ trợ</a>}
        </nav>
      </footer>
    </LandingTheme>
  );
}
