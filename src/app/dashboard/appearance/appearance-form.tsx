"use client";

import Image from "next/image";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getSupabaseEnv } from "@/lib/supabase/env";
import {
  layoutPresets,
  storeThemes,
  storefrontSections,
  type StoreThemePreset,
  type StorefrontLayoutPreset,
  type StorefrontSection,
} from "@/lib/store-appearance";
import { saveStoreAppearance } from "../actions";

const bucketName = "product-images";
const maxFileSize = 5 * 1024 * 1024;
const allowedTypes: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function describeUploadFailure(error: unknown) {
  const details = error && typeof error === "object"
    ? error as { message?: unknown; statusCode?: unknown; name?: unknown }
    : {};
  const message = typeof details.message === "string" ? details.message : String(error ?? "Lỗi không xác định");
  const normalized = message.toLocaleLowerCase("en-US");
  const statusCode = String(details.statusCode ?? "");

  if (normalized.includes("bucket not found") || statusCode === "404") {
    return "Không tìm thấy kho ảnh product-images. Hãy chạy migration 005 (202611140005_product_images.sql) trong Supabase.";
  }
  if (
    normalized.includes("row-level security") ||
    normalized.includes("permission denied") ||
    normalized.includes("not authorized") ||
    normalized.includes("unauthorized") ||
    statusCode === "403"
  ) {
    return "Supabase từ chối quyền tải ảnh. Kiểm tra migration 005 đã chạy và tài khoản đang đăng nhập là thành viên cửa hàng.";
  }
  if (normalized.includes("failed to fetch") || normalized.includes("networkerror") || normalized.includes("fetch failed")) {
    return "Không kết nối được tới Supabase Storage. Kiểm tra mạng và NEXT_PUBLIC_SUPABASE_URL trong .env.local.";
  }
  if (normalized.includes("randomuuid") || normalized.includes("crypto")) {
    return "Trình duyệt không tạo được tên tệp an toàn. Hãy cập nhật trình duyệt hoặc dùng localhost/HTTPS rồi thử lại.";
  }

  return `Supabase Storage báo lỗi${statusCode ? ` (${statusCode})` : ""}: ${message.slice(0, 150)}`;
}

function getTemporaryAppearancePath(url: string, storageUrl: string, storeId: string, kind: "logo" | "banner") {
  const prefix = storageUrl.replace(/\/$/, "") + "/storage/v1/object/public/" + bucketName + "/";
  if (!url.startsWith(prefix)) return null;

  try {
    const path = decodeURIComponent(url.slice(prefix.length));
    const parts = path.split("/");
    if (parts.length !== 2 || parts[0] !== storeId || !parts[1]?.startsWith(`branding-${kind}-`)) return null;
    return path;
  } catch {
    return null;
  }
}

function removeTemporaryImage(url: string, storeId: string, kind: "logo" | "banner") {
  const env = getSupabaseEnv();
  const path = getTemporaryAppearancePath(url, env.url, storeId, kind);
  if (!path) return;
  void (async () => {
    try {
      const supabase = createClient();
      await supabase.storage.from(bucketName).remove([path]);
    } catch {
      // A leftover draft upload is harmless; the saved store image is untouched.
    }
  })();
}

function AppearanceImageField({
  storeId,
  kind,
  label,
  hint,
  value,
  initialValue,
  onChange,
  onUploadingChange,
}: {
  storeId: string;
  kind: "logo" | "banner";
  label: string;
  hint: string;
  value: string;
  initialValue: string;
  onChange: (url: string) => void;
  onUploadingChange: (uploading: boolean) => void;
}) {
  const [previewUrl, setPreviewUrl] = useState(value);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);

  async function upload(file: File) {
    const extension = allowedTypes[file.type];
    if (!extension) {
      setMessage("Chỉ nhận ảnh JPG, PNG hoặc WebP.");
      setError(true);
      return;
    }
    if (file.size > maxFileSize) {
      setMessage("Ảnh cần nhỏ hơn 5 MB.");
      setError(true);
      return;
    }

    setUploading(true);
    onUploadingChange(true);
    setMessage("Đang tải ảnh lên...");
    setError(false);
    try {
      const supabase = createClient();
      const randomId = typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : Array.from(crypto.getRandomValues(new Uint32Array(4)), (part) => part.toString(36)).join("-");
      const objectPath = `${storeId}/branding-${kind}-${randomId}.${extension}`;
      const { error: uploadError } = await supabase.storage.from(bucketName).upload(objectPath, file, {
        cacheControl: "3600",
        contentType: file.type,
        upsert: false,
      });
      if (uploadError) throw uploadError;

      const { data } = supabase.storage.from(bucketName).getPublicUrl(objectPath);
      if (value && value !== initialValue) removeTemporaryImage(value, storeId, kind);
      onChange(data.publicUrl);
      setPreviewUrl(data.publicUrl);
      setMessage("Đã tải ảnh lên. Bấm Lưu giao diện để áp dụng.");
    } catch (uploadError) {
      console.error("Store appearance image upload failed", uploadError);
      setMessage(describeUploadFailure(uploadError));
      setError(true);
    } finally {
      setUploading(false);
      onUploadingChange(false);
    }
  }

  function clearImage() {
    if (value && value !== initialValue) removeTemporaryImage(value, storeId, kind);
    onChange("");
    setPreviewUrl("");
    setMessage("Ảnh sẽ được gỡ khỏi website sau khi bạn lưu giao diện.");
    setError(false);
  }

  return (
    <div className={`appearance-image-field appearance-image-${kind}`}>
      <div className="appearance-image-copy"><b>{label}</b><span>{hint}</span></div>
      <div className="appearance-image-preview">
        {previewUrl
          ? <Image src={previewUrl} alt={`Xem trước ${label.toLocaleLowerCase("vi-VN")}`} width={kind === "logo" ? 180 : 640} height={kind === "logo" ? 180 : 240} unoptimized />
          : <span>{kind === "logo" ? "Logo cửa hàng" : "Ảnh bìa cửa hàng"}</span>}
      </div>
      <div className="appearance-image-actions">
        <label className="secondary-submit appearance-file-button">
          {uploading ? "Đang tải ảnh..." : previewUrl ? "Chọn ảnh khác" : "Tải ảnh lên"}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={uploading}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
              event.currentTarget.value = "";
            }}
          />
        </label>
        {previewUrl && <button className="product-image-remove" type="button" disabled={uploading} onClick={clearImage}>Gỡ ảnh</button>}
      </div>
      {message && <span className={`product-image-status${error ? " is-error" : ""}`} role="status">{message}</span>}
    </div>
  );
}

export default function AppearanceForm({
  storeId,
  storeName,
  storeSlug,
  initialLogoUrl,
  initialBannerUrl,
  initialTheme,
  initialLayout,
  initialSectionOrder,
  initialHiddenSections,
}: {
  storeId: string;
  storeName: string;
  storeSlug: string;
  initialLogoUrl: string | null;
  initialBannerUrl: string | null;
  initialTheme: StoreThemePreset;
  initialLayout: StorefrontLayoutPreset;
  initialSectionOrder: StorefrontSection[];
  initialHiddenSections: StorefrontSection[];
}) {
  const [logoUrl, setLogoUrl] = useState(initialLogoUrl ?? "");
  const [bannerUrl, setBannerUrl] = useState(initialBannerUrl ?? "");
  const [theme, setTheme] = useState<StoreThemePreset>(initialTheme);
  const [layout, setLayout] = useState<StorefrontLayoutPreset>(initialLayout);
  const [sectionOrder, setSectionOrder] = useState<StorefrontSection[]>(initialSectionOrder);
  const [hiddenSections, setHiddenSections] = useState<StorefrontSection[]>(initialHiddenSections);
  const [uploadingImages, setUploadingImages] = useState({ logo: false, banner: false });
  const uploading = uploadingImages.logo || uploadingImages.banner;
  const onUploadingChange = (kind: "logo" | "banner", value: boolean) => {
    setUploadingImages((current) => ({ ...current, [kind]: value }));
  };

  function moveSection(section: StorefrontSection, direction: -1 | 1) {
    setSectionOrder((current) => {
      const index = current.indexOf(section);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current;
      const reordered = [...current];
      [reordered[index], reordered[nextIndex]] = [reordered[nextIndex], reordered[index]];
      return reordered;
    });
  }

  function toggleSection(section: StorefrontSection) {
    if (section === "menu") return;
    setHiddenSections((current) => current.includes(section)
      ? current.filter((item) => item !== section)
      : [...current, section]);
  }

  return (
    <form className="appearance-layout" action={saveStoreAppearance}>
      <input type="hidden" name="logo_url" value={logoUrl} />
      <input type="hidden" name="banner_url" value={bannerUrl} />
      <input type="hidden" name="theme_preset" value={theme} />
      <input type="hidden" name="storefront_layout" value={layout} />
      {sectionOrder.map((section) => <input key={section} type="hidden" name="storefront_section_order" value={section} />)}
      {hiddenSections.map((section) => <input key={section} type="hidden" name="storefront_hidden_sections" value={section} />)}

      <div className="appearance-controls">
        <section className="dashboard-card appearance-card">
          <div className="dashboard-card-heading">
            <div><span className="card-number">01</span><h2>Ảnh thương hiệu</h2></div>
            <p>Logo và ảnh bìa sẽ xuất hiện trên trang bán hàng của bạn.</p>
          </div>
          <div className="appearance-images">
            <AppearanceImageField storeId={storeId} kind="logo" label="Logo cửa hàng" hint="Ảnh vuông sẽ hiển thị cạnh tên quán." value={logoUrl} initialValue={initialLogoUrl ?? ""} onChange={setLogoUrl} onUploadingChange={(value) => onUploadingChange("logo", value)} />
            <AppearanceImageField storeId={storeId} kind="banner" label="Ảnh bìa" hint="Ảnh ngang phù hợp để làm hình chính trên trang." value={bannerUrl} initialValue={initialBannerUrl ?? ""} onChange={setBannerUrl} onUploadingChange={(value) => onUploadingChange("banner", value)} />
          </div>
          <p className="dashboard-help">Dùng ảnh JPG, PNG hoặc WebP, tối đa 5 MB mỗi ảnh. Ảnh được lưu trong kho của cửa hàng.</p>
        </section>

        <section className="dashboard-card appearance-card">
          <div className="dashboard-card-heading">
            <div><span className="card-number">02</span><h2>Màu thương hiệu</h2></div>
            <p>Chọn màu dùng cho tiêu đề, nút đặt món và các điểm nhấn.</p>
          </div>
          <div className="appearance-theme-options" role="group" aria-label="Chọn màu giao diện">
            {storeThemes.map((option) => (
              <button
                aria-pressed={theme === option.id}
                className={`appearance-theme-option${theme === option.id ? " selected" : ""}`}
                key={option.id}
                onClick={() => setTheme(option.id)}
                type="button"
              >
                <span className="appearance-theme-swatch" style={{ backgroundColor: option.color }} />
                <span><b>{option.label}</b><small>{option.description}</small></span>
                {theme === option.id && <span className="appearance-theme-check" aria-hidden="true">✓</span>}
              </button>
            ))}
          </div>
        </section>
        <section className="dashboard-card appearance-card appearance-layout-card">
          <div className="dashboard-card-heading">
            <div><span className="card-number">03</span><h2>Bố cục trang</h2></div>
            <p>Chọn mẫu làm nền, sau đó đổi thứ tự hoặc ẩn các phần bạn chưa cần.</p>
          </div>
          <div className="appearance-layout-presets" role="group" aria-label="Chọn mẫu bố cục">
            {layoutPresets.map((preset) => (
              <button
                aria-pressed={layout === preset.id}
                className={`appearance-layout-preset${layout === preset.id ? " selected" : ""}`}
                key={preset.id}
                onClick={() => {
                  setLayout(preset.id);
                  setSectionOrder([...preset.sectionOrder]);
                }}
                type="button"
              >
                <span className={`appearance-layout-mini appearance-layout-mini-${preset.id}`} aria-hidden="true">
                  {preset.sectionOrder.map((section) => <i key={section} className={`mini-section mini-section-${section}`} />)}
                </span>
                <span className="appearance-layout-preset-copy"><b>{preset.label}</b><small>{preset.description}</small></span>
                {layout === preset.id && <span className="appearance-theme-check" aria-hidden="true">✓</span>}
              </button>
            ))}
          </div>
          <div className="appearance-section-list" aria-label="Sắp xếp và ẩn hiện các phần">
            {sectionOrder.map((section, index) => {
              const details = storefrontSections.find((item) => item.id === section)!;
              const isHidden = hiddenSections.includes(section);
              return (
                <div className={`appearance-section-row${isHidden ? " is-hidden" : ""}`} key={section}>
                  <span className="appearance-section-position">{index + 1}</span>
                  <span className="appearance-section-copy"><b>{details.label}</b><small>{details.description}</small></span>
                  {details.required
                    ? <span className="appearance-section-required">Luôn hiển thị</span>
                    : <button className="appearance-section-visibility" type="button" aria-pressed={!isHidden} onClick={() => toggleSection(section)}>{isHidden ? "Hiện" : "Ẩn"}</button>}
                  <div className="appearance-section-move">
                    <button type="button" aria-label={`Đưa ${details.label} lên`} disabled={index === 0} onClick={() => moveSection(section, -1)}>↑</button>
                    <button type="button" aria-label={`Đưa ${details.label} xuống`} disabled={index === sectionOrder.length - 1} onClick={() => moveSection(section, 1)}>↓</button>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="dashboard-help">Thực đơn luôn hiển thị để khách có thể chọn món và đặt hàng.</p>
        </section>
        <button className="primary-button dashboard-submit appearance-save-button" type="submit" disabled={uploading}>
          {uploading ? "Đang tải ảnh..." : "Lưu giao diện"}<span>→</span>
        </button>
        {uploading && <p className="dashboard-help appearance-upload-warning">Đợi ảnh tải xong trước khi lưu thay đổi.</p>}
      </div>

      <aside className="appearance-preview-panel" aria-label="Xem trước giao diện cửa hàng">
        <div className="appearance-preview-heading"><span>BẢN XEM TRƯỚC</span><small>Thay đổi hiển thị sau khi lưu</small></div>
        <div className="appearance-preview" data-theme={theme} data-layout={layout}>
          <div className="appearance-preview-content">
            <div className="appearance-preview-brand">
              <span className="appearance-preview-logo">
                {logoUrl ? <Image src={logoUrl} alt="" width={56} height={56} unoptimized /> : storeName.trim().charAt(0).toUpperCase()}
              </span>
              <span><b>{storeName}</b><small>Thực đơn trực tuyến</small></span>
            </div>
            <div className="appearance-preview-flow">
              {sectionOrder.filter((section) => !hiddenSections.includes(section)).map((section) => (
                <div className={`appearance-preview-section appearance-preview-section-${section}`} key={section}>
                  {section === "hero" && <>
                    <div className="appearance-preview-banner" style={bannerUrl ? { backgroundImage: `linear-gradient(0deg,#18241655,#18241600 65%), url("${bannerUrl}")` } : undefined}>{!bannerUrl && <span>Ảnh bìa cửa hàng</span>}</div>
                    <b>Ngon như cơm nhà, ấm lòng mỗi bữa.</b><small>Phần giới thiệu cửa hàng</small>
                  </>}
                  {section === "menu" && <>
                    <div className="appearance-preview-actions"><b>Thực đơn nổi bật</b><span>Xem món →</span></div>
                    <div className="appearance-preview-product"><span>🍲</span><div><b>Món ngon của quán</b><small>Từ gian hàng {storeName}</small></div><strong>45.000₫</strong></div>
                  </>}
                  {section === "reviews" && <><b>Đánh giá món ăn</b><small>★★★★★ · Khách hàng của quán</small></>}
                  {section === "story" && <><b>Giới thiệu cửa hàng</b><small>{storeName} · Món ngon địa phương, đặt trực tiếp từ quán.</small></>}
                </div>
              ))}
            </div>
            {!hiddenSections.includes("hero") && <button className="appearance-preview-button" type="button">Đặt món ngay <span>→</span></button>}
          </div>
        </div>
        <a className="appearance-open-store" href={`/${storeSlug}`} target="_blank" rel="noreferrer">Mở website cửa hàng ↗</a>
      </aside>
    </form>
  );
}
