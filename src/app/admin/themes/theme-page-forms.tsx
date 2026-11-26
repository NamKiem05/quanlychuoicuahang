"use client";

import { useActionState, useRef, useState, type ChangeEvent } from "react";
import {
  themeBlocks, themePageInNavigation, themePageKinds, type PageKind, type ThemePage,
} from "@/lib/theme-pages";
import { defaultThemeManifest } from "@/lib/theme-studio";
import ThemeBuilder from "@/components/ui/theme-builder";
import { pageTemplates } from "@/lib/theme-page-management";
import { manageThemePage } from "./theme-page-actions";
import type { PageCommand } from "@/lib/theme-page-management";

type Target = { theme: string; revision: number };

function TargetFields({ theme, revision, id }: Target & { id?: string }) {
  return <><input type="hidden" name="theme" value={theme} /><input type="hidden" name="revision" value={revision} />
    {id && <input type="hidden" name="page" value={id} />}</>;
}

export function ThemePageFields({ target, page, unavailable, disabledComponents = [] }: {
  target: Target; page?: ThemePage; unavailable: PageKind[]; disabledComponents?: string[];
}) {
  const [error, action, pending] = useActionState(manageThemePage, "");
  const [kind, setKind] = useState<PageKind>(page?.kind ?? (unavailable.includes("custom")
    ? (Object.keys(themePageKinds) as PageKind[]).find(item => !unavailable.includes(item)) ?? "custom" : "custom"));
  const [values, setValues] = useState({
    title: page?.title ?? "", slug: page?.slug ?? "", description: page?.description ?? "",
    template: page?.meta?.template ?? "content", seoTitle: page?.meta?.seoTitle ?? "", seoDescription: page?.meta?.seoDescription ?? "",
    ogTitle: page?.meta?.ogTitle ?? "", ogDescription: page?.meta?.ogDescription ?? "", ogImage: page?.meta?.ogImage ?? "",
  });
  const [visible, setVisible] = useState(page?.visible ?? true);
  const [inNav, setInNav] = useState(themePageInNavigation({ kind, meta: page?.meta, visible: true }));
  const [noindex, setNoindex] = useState(page?.meta?.noindex ?? false);
  const template = pageTemplates.find(item => item.key === values.template);
  function change({ target: { name, value } }: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) {
    setValues(current => ({ ...current, [name]: value }));
  }
  return <form className="theme-form page-manager-form" action={action}>
    <TargetFields {...target} id={page?.id} />
    <input type="hidden" name="operation" value={page ? "edit" : "create"} />
    {error && <p role="alert" className="theme-feedback is-error">{error}</p>}
    <div className="theme-form-grid">
      {page ? <label>Loại trang <input value={themePageKinds[kind]} readOnly /><input type="hidden" name="kind" value={kind} /></label> :
        <label>Loại trang<select name="kind" value={kind} onChange={event => {
          const next = event.target.value as PageKind;
          setKind(next);
          setInNav(themePageInNavigation({ kind: next, visible: true }));
        }}>
          {Object.entries(themePageKinds).map(([key, label]) => <option key={key} value={key} disabled={unavailable.includes(key as PageKind)}>{label}</option>)}
        </select></label>}
      <label>Tên trang <input name="title" value={values.title} onChange={change} maxLength={100} required /></label>
      <label>Slug <input name="slug" value={kind === "custom" ? values.slug : kind} readOnly={kind !== "custom"}
        onChange={change} maxLength={64} pattern="[a-z0-9]+(-[a-z0-9]+)*" required /></label>
      {kind === "custom" ? <label>Template<select name="template" value={values.template} onChange={change}>
        {pageTemplates.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
      </select></label> : <label>Template <input value={themePageKinds[kind]} readOnly /></label>}
    </div>
    {page?.kind === "custom" && page.slug !== values.slug &&
      <p>Đổi slug sẽ thay URL sau khi cửa hàng áp dụng phiên bản mới. URL cũ sẽ trả về 404.</p>}
    <label>Mô tả trang <textarea name="description" value={values.description} onChange={change} maxLength={240} /></label>
    {kind === "custom" && template && <aside className="page-template-preview"><strong>{template.label}</strong>
      <p>{page ? "Đổi template giữ nguyên nội dung và component của trang." :
        "Component khởi tạo theo chính sách hiện hành của theme."}</p>
      {!page && <details><summary>Xem cấu trúc template</summary>
        <ThemeBuilder key={template.key} readOnly initial={{ ...defaultThemeManifest, schemaVersion: 2, pages: [{
          id: "10000000-0000-4000-8000-000000000001", kind: "custom", slug: "xem-truoc-template",
          title: template.label, description: "", visible: true, meta: { template: template.key },
          blocks: template.blocks.filter(block => !disabledComponents.includes(block)).map((block, index) => ({
            id: `20000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
            kind: block, title: themeBlocks[block].label, copy: "", limit: 6, hidden: false,
          })),
        }] }} pagePreview />
      </details>}
    </aside>}
    <fieldset className="theme-checks"><legend>Hiển thị</legend>
      {kind === "custom" ? <label><input type="checkbox" name="visible" value="yes" checked={visible} onChange={event => setVisible(event.target.checked)} /> Hiển thị trên storefront</label> :
        <p>Route hệ thống luôn hiển thị.</p>}
      <label><input type="checkbox" name="navigation" value="yes" checked={inNav} onChange={event => setInNav(event.target.checked)} /> Đưa vào menu</label>
    </fieldset>
    <details className="page-manager-seo"><summary>SEO và chia sẻ</summary>
      <div className="theme-form-grid">
        <label>Tiêu đề SEO <input name="seoTitle" maxLength={100} value={values.seoTitle} onChange={change} /></label>
        <label>Mô tả SEO <textarea name="seoDescription" maxLength={240} value={values.seoDescription} onChange={change} /></label>
        <label>Tiêu đề Open Graph <input name="ogTitle" maxLength={100} value={values.ogTitle} onChange={change} /></label>
        <label>Mô tả Open Graph <textarea name="ogDescription" maxLength={240} value={values.ogDescription} onChange={change} /></label>
        <label>Ảnh Open Graph (HTTPS) <input type="url" name="ogImage" pattern="https://.+" maxLength={2048} value={values.ogImage} onChange={change} /></label>
        <label><input type="checkbox" name="noindex" value="yes" checked={noindex} onChange={event => setNoindex(event.target.checked)} /> Yêu cầu công cụ tìm kiếm bỏ qua trang</label>
      </div>
      <div className="page-template-preview" aria-label="Xem trước đoạn kết quả tìm kiếm">
        <strong>{values.seoTitle || values.title || "Tiêu đề trang"}</strong>
        <p>{values.seoDescription || values.description || "Mô tả hiển thị phụ thuộc nội dung trên cửa hàng."}</p>
      </div>
    </details>
    <button type="submit" className="theme-primary" disabled={pending}>{pending ? "Đang lưu…" : page ? "Lưu cài đặt trang" : "Tạo trang"}</button>
  </form>;
}

export function ThemePageCommand({ target, page, operation, label, url }: {
  target: Target; page: ThemePage; operation: Exclude<PageCommand["type"], "create" | "edit">; label: string; url?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [error, action, pending] = useActionState(manageThemePage, "");
  const confirm = operation === "delete" || operation === "home";
  const form = <form action={action} className="page-manager-command">
    <TargetFields {...target} id={page.id} />
    <input type="hidden" name="operation" value={operation} />
    {confirm && <input type="hidden" name="confirm" value="yes" />}
    {error && <p role="alert" className="theme-feedback is-error">{error}</p>}
    {confirm && <button type="button" className="theme-secondary" onClick={() => dialog.current?.close()}>Hủy</button>}
    <button type="submit" className="theme-secondary" disabled={pending} aria-label={confirm ? undefined : `${label} ${page.title}`}>
      {pending ? "Đang xử lý…" : confirm ? "Xác nhận" : label}
    </button>
  </form>;
  if (!confirm) return form;
  const id = `page-${operation}-${page.id}`;
  return <>
    <button type="button" className="theme-secondary" onClick={() => dialog.current?.showModal()}>{label}</button>
    <dialog ref={dialog} className="page-manager-dialog" aria-labelledby={id}>
      <h3 id={id}>{label} · {page.title}</h3>
      {url && <p><code>{url}</code></p>}
      <p>{operation === "delete" ? "Trang và component sẽ bị gỡ khỏi bản nháp. URL sẽ ngừng hoạt động khi cửa hàng áp dụng phiên bản mới." :
        "Trang này sẽ được hiển thị ở URL chính của cửa hàng sau khi áp dụng phiên bản mới. Route mua hàng hiện có vẫn truy cập được."}</p>
      {form}
    </dialog>
  </>;
}
