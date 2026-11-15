import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Gần Đây | Website bán hàng riêng cho quán ăn",
  description: "Nền tảng giúp quán ăn tạo website riêng, quản lý thực đơn và đơn hàng. Khách đặt món qua link do cửa hàng chia sẻ.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="vi" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
