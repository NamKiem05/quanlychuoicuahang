"use client";

import { useActionState, useRef, useState, type ChangeEvent } from "react";
import Toast from "@/components/ui/toast";
import { themeFamilies } from "@/lib/theme-studio";
import { changeLibraryTheme, saveLibraryTheme } from "./theme-library-actions";

type Metadata = {
  id: string; name: string; theme_slug: string; description: string; category: string;
  primary_family: string; draft_revision: number; preview_url: string | null; thumbnail_url: string | null;
};

export function LibraryMetadataForm({ item, copy = false, copySlug }: { item?: Metadata; copy?: boolean; copySlug?: string }) {
  const [error, action, pending] = useActionState(saveLibraryTheme, "");
  const title = copy ? "Tạo bản sao" : item ? "Lưu thông tin" : "Tạo bản nháp";
  const [values, setValues] = useState({
    title: copy && item ? `${item.name.slice(0, 89)} – bản sao` : item?.name ?? "",
    slug: (copy ? copySlug : item?.theme_slug) ?? "",
    family: item?.primary_family ?? "general", category: item?.category ?? "",
    thumbnail: item?.thumbnail_url ?? "", image: item?.preview_url ?? "", summary: item?.description ?? "",
  });
  function change({ target: { name, value } }: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) {
    setValues(fields => ({ ...fields, [name]: value }));
  }
  return <form action={action} className="theme-form">
    {error && <Toast key={error} message={error} variant="error" />}
    <input type="hidden" name={copy ? "source" : "theme"} value={item?.id ?? ""} />
    <input type="hidden" name="revision" value={item?.draft_revision ?? 0} />
    <div className="theme-form-grid">
      <label>Tên <input name="title" required minLength={2} maxLength={100} value={values.title} onChange={change} /></label>
      <label>Mã định danh <input name="slug" required maxLength={80} pattern="[a-z0-9]+(-[a-z0-9]+)*"
        value={values.slug} onChange={change} /></label>
      <label>Ngành hàng <select name="family" value={values.family} onChange={change}>
        {Object.entries(themeFamilies).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select></label>
      <label>Danh mục giao diện <input name="category" maxLength={80} value={values.category} onChange={change} /></label>
      <label>URL thumbnail HTTPS <input type="url" name="thumbnail" pattern="https://.+" maxLength={2048} value={values.thumbnail} onChange={change} /></label>
      <label>URL ảnh xem trước HTTPS <input type="url" name="image" pattern="https://.+" maxLength={2048} value={values.image} onChange={change} /></label>
    </div>
    <label>Mô tả <textarea name="summary" maxLength={1000} value={values.summary} onChange={change} /></label>
    <p>{copy ? "Bản sao dùng nội dung bản nháp và tham chiếu lại các URL ảnh HTTPS. Dùng URL công khai lâu dài." :
      item ? "Website và Marketplace tiếp tục dùng thông tin của bản phát hành hiện tại cho đến khi có bản phát hành mới." :
        "Tài khoản đang đăng nhập được ghi nhận là người tạo. Thiết kế và phiên bản phát hành được quản lý trong Theme Studio."}</p>
    <button className="theme-primary" type="submit" disabled={pending}>{pending ? "Đang lưu…" : title}</button>
  </form>;
}

const changes = {
  archive: ["Lưu trữ giao diện", "Giao diện sẽ ngừng phân phối theo quy tắc lưu trữ hiện tại. Giấy phép và cấu hình của cửa hàng được giữ lại."],
  hide: ["Ẩn khỏi Marketplace", "Lượt nhận hoặc mua mới sẽ dừng. Cửa hàng đã có giấy phép vẫn giữ quyền sử dụng."],
  show: ["Niêm yết trên Marketplace", "Giao diện sẽ hiển thị cho cửa hàng phù hợp khi Marketplace đang mở."],
  delete: ["Xóa bản nháp", "Bản nháp sẽ bị xóa vĩnh viễn. Thao tác chỉ áp dụng cho giao diện chưa phát hành và không có dữ liệu phụ thuộc."],
} as const;

export function LibraryConfirm({ item, command }: {
  item: Metadata & { is_enabled: boolean }; command: keyof typeof changes;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [error, action, pending] = useActionState(changeLibraryTheme, "");
  const [label, description] = changes[command];
  const heading = `confirm-${command}-${item.id}`;
  return <>
    <button className="theme-secondary" type="button" onClick={() => dialog.current?.showModal()}>{label}</button>
    <dialog ref={dialog} className="theme-library-dialog" aria-labelledby={heading}>
      <h3 id={heading}>{label}</h3>
      <p><strong>{item.name}</strong></p>
      <p>{description}</p>
      {error && <p role="alert" className="theme-feedback is-error">{error}</p>}
      <form action={action} className="theme-studio-tools">
        <input type="hidden" name="theme" value={item.id} />
        <input type="hidden" name="revision" value={item.draft_revision} />
        <input type="hidden" name="visibility" value={String(item.is_enabled)} />
        <input type="hidden" name="command" value={command} />
        <input type="hidden" name="confirm" value="yes" />
        <button className="theme-secondary" type="button" disabled={pending} onClick={() => dialog.current?.close()}>Hủy</button>
        <button className="theme-primary" type="submit" disabled={pending}>{pending ? "Đang xử lý…" : "Xác nhận"}</button>
      </form>
    </dialog>
  </>;
}
