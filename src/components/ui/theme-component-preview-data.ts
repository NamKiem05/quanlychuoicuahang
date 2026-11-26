export const themeComponentPreviewData = {
  store: { name: "Cửa hàng mẫu", description: "Nội dung giới thiệu mẫu.", address: "Địa chỉ minh họa", phone: null },
  products: [1, 2, 3, 4].map(index => ({ id: `sample-${index}`, name: `Sản phẩm mẫu ${index}`, price: index * 35000, image: "" })),
  categories: [1, 2, 3].map(index => ({ id: `sample-${index}`, name: `Danh mục mẫu ${index}` })),
  reviews: [{ id: "sample", displayName: "Khách hàng mẫu", rating: 5, body: "Nội dung đánh giá minh họa." }],
};
