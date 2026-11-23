import Link from "next/link";
import Simulation from "./simulation";
import "../shipping.css";

export const metadata = { title: "Mô phỏng vận chuyển GHN | GrowDesk" };

export default function ShippingSimulationPage() {
  return (
    <main className="admin-content shipping-page">
      <header>
        <Link href="/dashboard/shipping">← Quay lại vận chuyển</Link>
        <h1>Mô phỏng vận chuyển GHN</h1>
        <p>Dùng thông tin mẫu để thử quy trình. Dữ liệu tồn tại trong tab và được xóa khi tải lại trang.</p>
      </header>
      <Simulation />
    </main>
  );
}
