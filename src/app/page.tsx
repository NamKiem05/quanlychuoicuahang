import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Gần Đây | Website bán hàng riêng cho quán ăn",
  description: "Tạo website riêng cho cửa hàng đồ ăn, quản lý thực đơn và đơn hàng. Khách mua hàng qua link của cửa hàng.",
};

const features = [
  {
    icon: "↗",
    title: "Website riêng cho cửa hàng",
    description: "Tạo trang bán hàng mang tên, logo và phong cách riêng. Chia sẻ một đường link để khách vào xem thực đơn và đặt món.",
  },
  {
    icon: "☷",
    title: "Quản lý gọn trong một nơi",
    description: "Cập nhật món ăn, danh mục, khuyến mãi, đơn hàng và doanh thu từ khu vực quản lý dành cho chủ cửa hàng.",
  },
  {
    icon: "↗",
    title: "Chia sẻ trực tiếp tới khách",
    description: "Gửi link website riêng của quán qua Zalo, mạng xã hội hoặc mã QR để khách mở thực đơn và đặt hàng.",
  },
];

const steps = [
  { number: "01", title: "Tạo tài khoản", description: "Đăng ký tài khoản chủ cửa hàng và nhập thông tin cơ bản của quán." },
  { number: "02", title: "Dựng gian hàng", description: "Thêm thực đơn, hình ảnh, phương thức thanh toán và cách giao nhận." },
  { number: "03", title: "Chia sẻ link", description: "Gửi đường link cửa hàng cho khách để họ xem món và đặt hàng trực tiếp." },
];

export default function HomePage() {
  return (
    <div id="platform-home">
      <header className="header">
        <div className="container headerInner">
          <Link className="brand" href="/" aria-label="Gần Đây - trang giới thiệu">
            <span className="brandMark">G</span>
            <span className="brandCopy"><b>gần đây<span>.</span></b><small>Nền tảng cho quán ăn</small></span>
          </Link>
          <nav className="nav" aria-label="Điều hướng chính">
            <a href="#loi-ich">Lợi ích</a>
            <a href="#cach-hoat-dong">Cách hoạt động</a>
          </nav>
          <div className="headerActions">
            <Link className="loginLink" href="/login">Đăng nhập</Link>
            <Link className="headerButton" href="/login?mode=signup">Tạo gian hàng <span aria-hidden="true">→</span></Link>
          </div>
        </div>
      </header>

      <main>
        <section className="hero">
          <div className="container heroGrid">
            <div className="heroCopy">
              <div className="eyebrow"><span /> CÔNG CỤ BÁN HÀNG DÀNH CHO QUÁN ĂN</div>
              <h1>Website riêng cho quán ăn.<br /><span>Khách đặt qua link của bạn.</span></h1>
              <p className="heroText">Tạo gian hàng online, quản lý thực đơn và nhận đơn trong một nơi. Khách mua món trực tiếp trên trang riêng của cửa hàng.</p>
              <div className="heroActions">
                <Link className="primaryButton" href="/login?mode=signup">Bắt đầu tạo gian hàng <span aria-hidden="true">→</span></Link>
                <a className="secondaryButton" href="#cach-hoat-dong">Tìm hiểu cách hoạt động</a>
              </div>
              <div className="heroBenefits">
                <span><i>✓</i> Trang bán hàng riêng</span>
                <span><i>✓</i> Quản lý đơn dễ dàng</span>
                <span><i>✓</i> Chia sẻ link cho khách</span>
              </div>
            </div>

            <div className="heroVisual" aria-label="Minh họa trang quản lý cửa hàng và website bán hàng">
              <div className="visualGlow" />
              <div className="dashboardCard">
                <div className="dashboardTop"><span className="dashboardLogo">G</span><div><b>Khu vực cửa hàng</b><small>Xin chào, Bếp Nhà Mơ</small></div><span className="onlineDot">Đang hoạt động</span></div>
                <div className="dashboardStats">
                  <div><small>ĐƠN MỚI HÔM NAY</small><b>12</b><span>+3 đơn mới</span></div>
                  <div><small>MÓN ĐANG BÁN</small><b>24</b><span>Thực đơn của quán</span></div>
                </div>
                <div className="dashboardListHead"><b>Đơn hàng gần đây</b><span>Hôm nay</span></div>
                <div className="orderLine"><span className="orderIcon">🍜</span><span><b>#DH-2048</b><small>Phở bò · 2 món</small></span><strong>Đang chuẩn bị</strong></div>
                <div className="orderLine"><span className="orderIcon">🍚</span><span><b>#DH-2047</b><small>Cơm gà · 1 món</small></span><strong className="orderReady">Đã xác nhận</strong></div>
              </div>
              <div className="storeCard">
                <div className="storeCover"><span>🍲</span><small>TRANG CỬA HÀNG</small></div>
                <div className="storeInfo"><span className="storeAvatar">B</span><div><b>Bếp Nhà Mơ</b><small>gan-day.vn/bep-nha-mo</small></div></div>
                <div className="storeMenu"><span>Phở bò</span><b>45.000₫</b><span>Burger bò</span><b>55.000₫</b></div>
                <div className="storeCta">Xem thực đơn <span>→</span></div>
              </div>
              <div className="floatNote"><span>↗</span><div><b>Link cửa hàng của bạn</b><small>Dễ chia sẻ cho khách</small></div></div>
            </div>
          </div>
        </section>

        <section className="trustStrip">
          <div className="container trustInner">
            <span>ĐƯỢC THIẾT KẾ CHO VIỆC BÁN HÀNG HẰNG NGÀY</span>
            <b>Thực đơn</b><i /> <b>Đơn hàng</b><i /> <b>Thanh toán</b><i /> <b>Giao nhận</b>
          </div>
        </section>

        <section className="featuresSection" id="loi-ich">
          <div className="container">
            <div className="sectionHeading">
              <div className="eyebrow">MỌI THỨ CHO QUÁN TRÊN MỘT NỀN TẢNG</div>
              <h2>Tập trung vào món ngon,<br /><span>Gần Đây lo phần bán hàng.</span></h2>
              <p>Từ trang giới thiệu cửa hàng đến lúc đơn được hoàn tất, các công cụ cần thiết đều ở ngay trong tay bạn.</p>
            </div>
            <div className="featureGrid">
              {features.map((feature) => <article className="featureCard" key={feature.title}>
                <span className="featureIcon" aria-hidden="true">{feature.icon}</span>
                <h3>{feature.title}</h3>
                <p>{feature.description}</p>
              </article>)}
            </div>
          </div>
        </section>

        <section className="stepsSection" id="cach-hoat-dong">
          <div className="container stepsGrid">
            <div className="stepsIntro">
              <div className="eyebrow">BẮT ĐẦU THẬT ĐƠN GIẢN</div>
              <h2>Ba bước để quán<br /><span>có website riêng.</span></h2>
              <p>Không cần tự xây dựng website. Bạn có thể thiết lập gian hàng và bắt đầu chia sẻ với khách ngay sau khi hoàn tất thông tin.</p>
              <Link className="textLink" href="/login?mode=signup">Tạo tài khoản chủ quán <span aria-hidden="true">→</span></Link>
            </div>
            <div className="stepList">
              {steps.map((step) => <article className="step" key={step.number}>
                <span className="stepNumber">{step.number}</span>
                <div><h3>{step.title}</h3><p>{step.description}</p></div>
                <span className="stepArrow" aria-hidden="true">↗</span>
              </article>)}
            </div>
          </div>
        </section>

        <section className="customerNote">
          <div className="container customerNoteInner">
            <span className="customerNoteIcon" aria-hidden="true">↗</span>
            <div><h2>Khách mua món qua link cửa hàng</h2><p>Gần Đây không có trang danh sách món tổng hợp. Mỗi cửa hàng chia sẻ link riêng để khách vào xem thực đơn và đặt món trực tiếp.</p></div>
            <Link href="/login?mode=signup">Mở gian hàng <span aria-hidden="true">→</span></Link>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="container footerInner">
          <Link className="brand" href="/">
            <span className="brandMark">G</span>
            <span className="brandCopy"><b>gần đây<span>.</span></b><small>Nền tảng cho quán ăn</small></span>
          </Link>
          <p>Website bán hàng riêng cho cửa hàng đồ ăn địa phương.</p>
          <div><Link href="/login">Đăng nhập</Link><Link href="/login?mode=signup">Tạo gian hàng</Link></div>
          <small className="copyright">© 2026 Gần Đây</small>
        </div>
      </footer>
    </div>
  );
}
