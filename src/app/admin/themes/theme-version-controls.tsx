"use client";

import { useActionState, useRef, useState, type ChangeEvent } from "react";
import type { VersionDifference } from "@/lib/theme-version-management";
import { initialThemeVersion } from "@/lib/theme-creation";
import { manageThemeVersion } from "./theme-version-actions";

type Target = { theme: string; revision: number };
const labels = { major: "Major", minor: "Minor", patch: "Patch" };

export function ThemeReleaseForm({ theme, revision, latest, eligible, changes }: Target & {
  latest: string | null; eligible: number; changes: VersionDifference[];
}) {
  const [error, action, pending] = useActionState(manageThemeVersion, "");
  const [review, setReview] = useState(false);
  const [fields, setFields] = useState({ version: latest ? "" : initialThemeVersion, title: "", notes: "", compatibility: "", kind: latest ? "patch" : "major" });
  const change = ({ target: { name, value } }: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setFields(previous => ({ ...previous, [name]: value }));
  return <form action={action} className="theme-form" onSubmit={event => {
    if (!review) { event.preventDefault(); setReview(true); }
  }}>
    <input type="hidden" name="theme" value={theme} /><input type="hidden" name="revision" value={revision} />
    <input type="hidden" name="operation" value="publish" />
    {review && <input type="hidden" name="confirm" value="yes" />}
    {error && <p role="alert" className="theme-feedback is-error">{error}</p>}
    <div className="theme-form-grid">
      <label>Số phiên bản <input name="version" required placeholder="1.0.0" maxLength={14}
        pattern="(0|[1-9][0-9]{0,3})[.](0|[1-9][0-9]{0,3})[.](0|[1-9][0-9]{0,3})" value={fields.version} onChange={change} readOnly={review} /></label>
      <label>Tên phát hành <input name="title" required maxLength={100} value={fields.title} onChange={change} readOnly={review} /></label>
      {review ? <><input type="hidden" name="kind" value={fields.kind} /><p>{labels[fields.kind as keyof typeof labels]} · Cập nhật thủ công</p></> :
        <label>Loại thay đổi <select name="kind" value={fields.kind} onChange={change}>
          <option value="major">Major · Thay đổi có thể không tương thích</option>
          <option value="minor">Minor · Tính năng tương thích ngược</option><option value="patch">Patch · Sửa hoặc tinh chỉnh</option>
        </select></label>}
    </div>
    <label>Ghi chú phát hành <textarea name="notes" maxLength={4000} value={fields.notes} onChange={change} readOnly={review} /></label>
    <label>Ghi chú tương thích <textarea name="compatibility" maxLength={2000} value={fields.compatibility} onChange={change} readOnly={review} /></label>
    {review && <section className="version-review" aria-label="Xác nhận phát hành">
      <h3>Xem lại phiên bản {fields.version}</h3>
      <p>Phiên bản trước {latest ?? "Chưa có"} · {eligible} cửa hàng phù hợp ngành hàng. Cửa hàng tự chọn thời điểm cập nhật.</p>
      {changes.length ? <ul>{changes.slice(0, 12).map((item, index) => <li key={index}>{item.area} · {item.label}{item.warning && ` · ${item.warning}`}</li>)}</ul> :
        <p>{latest ? "Không phát hiện thay đổi nội dung so với snapshot mới nhất." : "Đây là bản phát hành đầu tiên."}</p>}
      {changes.length > 12 && <p>Còn {changes.length - 12} thay đổi. Xem đầy đủ trong phần kiểm tra bản nháp.</p>}
    </section>}
    <div className="theme-studio-tools">
      {review && <button type="button" className="theme-secondary" onClick={() => setReview(false)} disabled={pending}>Sửa thông tin</button>}
      <button type="submit" className="theme-primary" disabled={pending}>{pending ? "Đang phát hành…" : review ? "Xác nhận phát hành" : "Xem lại trước khi phát hành"}</button>
    </div>
  </form>;
}

export function ThemeRestoreDialog({ theme, revision, release, version }: Target & { release: string; version: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [error, action, pending] = useActionState(manageThemeVersion, "");
  return <>
    <button type="button" className="theme-secondary" onClick={() => dialog.current?.showModal()}>Khôi phục vào bản nháp</button>
    <dialog ref={dialog} className="version-dialog" aria-labelledby="restore-title">
      <h3 id="restore-title">Khôi phục v{version}</h3>
      <p>Nội dung snapshot sẽ thay thế bản nháp hiện tại. Phiên bản đã phát hành, giấy phép và website cửa hàng được giữ nguyên.</p>
      <p>Kiểm tra các thay đổi còn mở trong Theme Studio trước khi xác nhận.</p>
      <form action={action} className="theme-form">
        <input type="hidden" name="theme" value={theme} /><input type="hidden" name="revision" value={revision} />
        <input type="hidden" name="release" value={release} /><input type="hidden" name="operation" value="restore" />
        <input type="hidden" name="confirm" value="yes" />
        {error && <p role="alert" className="theme-feedback is-error">{error}</p>}
        <div className="theme-studio-tools"><button type="button" className="theme-secondary" onClick={() => dialog.current?.close()} disabled={pending}>Hủy</button>
          <button type="submit" className="theme-primary" disabled={pending}>{pending ? "Đang khôi phục…" : "Xác nhận khôi phục"}</button></div>
      </form>
    </dialog>
  </>;
}
