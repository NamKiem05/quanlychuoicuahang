import type { Metadata } from "next";
import FoodDiscovery from "./food-discovery";

export const metadata: Metadata = {
  title: "Gần Đây | Món ngon quanh bạn",
  description: "Khám phá món ngon từ các cửa hàng địa phương trong bán kính 5 km.",
};

export default function HomePage() {
  return <FoodDiscovery />;
}
