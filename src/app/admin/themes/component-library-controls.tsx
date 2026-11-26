"use client";

import { useActionState, useRef, useState } from "react";
import { ThemeBlockContent } from "@/components/storefront/theme-sections";
import { themeComponentPreviewData } from "@/components/ui/theme-component-preview-data";
import {
  componentFields, componentStatuses, createThemeBlock, fieldsForComponent, themeBlocks, themeStudioImageKey,
  type BlockKind, type ComponentStatus,
} from "@/lib/theme-pages";
import { updateComponentStatus } from "./component-library-actions";

const widths = { Desktop: 1024, Tablet: 768, Mobile: 390 } as const;

export function ComponentPreview({ kind }: { kind: BlockKind }) {
  const initial = () => createThemeBlock(kind, "10000000-0000-4000-8000-000000000001");
  const [draft, setDraft] = useState(initial);
  const [image, setImage] = useState("");
  const [device, setDevice] = useState<keyof typeof widths>("Desktop");
  const fields = fieldsForComponent(kind);
  const validImage = image && themeStudioImageKey.test(image) ? image : undefined;
  return <div className="component-preview">
    <div className="theme-studio-tools" aria-label="Kích thước xem trước">
      {(Object.keys(widths) as (keyof typeof widths)[]).map(key =>
        <button type="button" className="theme-secondary" aria-pressed={key === device} key={key} onClick={() => setDevice(key)}>{key} · {widths[key]} px</button>)}
      <button type="button" className="theme-secondary" onClick={() => { setDraft(initial()); setImage(""); }}>Khôi phục mặc định</button>
    </div>
    <div className="theme-form-grid">
      <label>{componentFields.title.label}<input maxLength={componentFields.title.max} value={draft.title}
        onChange={event => setDraft(current => ({ ...current, title: event.target.value }))} /></label>
      <label>{componentFields.copy.label}<textarea maxLength={componentFields.copy.max} value={draft.copy}
        onChange={event => setDraft(current => ({ ...current, copy: event.target.value }))} /></label>
      {fields.includes("limit") && <label>{componentFields.limit.label}<select value={draft.limit} onChange={event => {
        const limit = Number(event.target.value); setDraft(current => ({ ...current, limit }));
      }}>
        {Array.from({ length: componentFields.limit.max }, (_, index) => <option key={index}>{index + 1}</option>)}
      </select></label>}
      {fields.includes("image") && <label>Khóa ảnh trong platform-assets<input value={image} onChange={event => setImage(event.target.value)} />
        {image && !validImage && <small>Nhập khóa ảnh đã tải lên Theme Studio.</small>}</label>}
      <label><input type="checkbox" checked={draft.hidden} onChange={event => {
        const hidden = event.target.checked; setDraft(current => ({ ...current, hidden }));
      }} />{componentFields.hidden.label}</label>
    </div>
    <p>Dữ liệu minh họa. Thay đổi trong preview chỉ có hiệu lực tại đây.</p>
    <div className="component-preview-viewport" tabIndex={0} aria-label="Canvas xem trước">
      <div style={{ width: widths[device] }}>
        {draft.hidden ? <p className="themes-empty">Component đang ẩn.</p> :
          <section className="published-theme-block"><ThemeBlockContent block={{ ...draft, image: validImage }} data={themeComponentPreviewData} /></section>}
      </div>
    </div>
  </div>;
}

export function ComponentStatusDialog({ kind, status }: { kind: BlockKind; status: ComponentStatus }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [error, action, pending] = useActionState(updateComponentStatus, "");
  return <>
    <button type="button" className="theme-secondary" onClick={() => dialog.current?.showModal()}>Đổi trạng thái</button>
    <dialog ref={dialog} className="component-status-dialog" aria-labelledby="component-status-heading">
      <h3 id="component-status-heading">{themeBlocks[kind].label}</h3>
      <p>Vô hiệu hóa hoặc ngừng khuyến nghị sẽ chặn tạo instance mới. Trang đã có component vẫn giữ cấu hình và renderer.</p>
      <form action={action} className="theme-form">
        <input type="hidden" name="component" value={kind} /><input type="hidden" name="expected" value={status} />
        <input type="hidden" name="confirm" value="yes" />
        <label>Trạng thái <select name="state" defaultValue={status}>
          {Object.entries(componentStatuses).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select></label>
        {error && <p role="alert" className="theme-feedback is-error">{error}</p>}
        <div className="theme-studio-tools"><button type="button" className="theme-secondary" onClick={() => dialog.current?.close()}>Hủy</button>
          <button type="submit" className="theme-primary" disabled={pending}>{pending ? "Đang lưu…" : "Xác nhận"}</button></div>
      </form>
    </dialog>
  </>;
}
