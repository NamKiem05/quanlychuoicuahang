const basicFeatures = [
  "Website riêng",
  "Thống kê doanh thu",
  "Quản lý đơn hàng",
  "Quản lý thực đơn",
  "Xem đánh giá",
];

export const merchantPlans = [
  { id: "basic", name: "Gói Cơ bản", amount: 49000, features: basicFeatures },
  {
    id: "plus",
    name: "Gói Nâng cao",
    amount: 99000,
    features: [...basicFeatures, "Tạo mã khuyến mãi", "Kết nối tên miền riêng", "Chỉnh sửa giao diện"],
  },
] as const;

export function findMerchantPlan(id: unknown) {
  return merchantPlans.find((plan) => plan.id === id);
}

export function formatPlanAmount(amount: number) {
  return `${amount.toLocaleString("vi-VN")}₫`;
}
