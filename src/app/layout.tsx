import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bếp Nhà Mơ | Món ngon nhà làm",
  description: "Món ngon nhà làm, nấu bằng nguyên liệu tươi và cả tấm lòng.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="vi" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
