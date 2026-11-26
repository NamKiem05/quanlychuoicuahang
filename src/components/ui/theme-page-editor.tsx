"use client";
import { useState } from "react";
import Link from "next/link";
import {
  blockCompatible, componentFields, componentGroups, componentStatus, componentStatuses, createThemeBlock, fieldsForComponent,
  findThemeHome, themeBlocks, themePageKinds, themePageTemplate, type BlockKind, type PageKind, type ThemeBlock, type ThemePage,
} from "@/lib/theme-pages";
import { ThemeBlockContent, ThemeBlockImage, type BlockData } from "@/components/storefront/theme-sections";
import { maxThemeImageBytes } from "@/lib/theme-studio-image";
import { themeComponentPreviewData } from "./theme-component-preview-data";

export type StudioPageTools = {
  pages: string; components: string;
  initialPage?: string;
  upload?: (form: FormData) => Promise<{ key?: string; error?: string }>;
};

export default function ThemePageEditor({ pages, update, family, readOnly, width, disabledComponents = [], deprecatedComponents = [], maxCustomPages = 16, studio, navigation = true, previewRevision = 0, preset, zoom = 1, pagePreview = false, storePreview }: {
  pages: ThemePage[]; update: (pages: ThemePage[] | ((current: ThemePage[]) => ThemePage[])) => void;
  family?: string; readOnly: boolean; width: number; disabledComponents?: string[]; deprecatedComponents?: string[]; maxCustomPages?: number;
  studio?: StudioPageTools; navigation?: boolean; previewRevision?: number; preset?: string; zoom?: number; pagePreview?: boolean; storePreview?: BlockData;
}) {
  const [pageId, setPageId] = useState(studio?.initialPage ?? "");
  const [blockId, setBlockId] = useState("");
  const [view, setView] = useState<"pages" | "components" | "layers">("pages");
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState("");
  const page = pages.find(p => p.id === pageId) ?? pages[0];
  const isHome = Boolean(page && findThemeHome(pages)?.id === page.id);
  const selected = page?.blocks.find(block => block.id === blockId);
  const statusOf = (kind: BlockKind) => componentStatus(kind, disabledComponents, deprecatedComponents);
  const allowedKinds = (Object.keys(themeBlocks) as BlockKind[]).filter(kind => statusOf(kind) === "active" && blockCompatible(kind, family));
  const selectedFields = selected ? fieldsForComponent(selected.kind) : [];
  const renderPreview = Boolean(studio || pagePreview || storePreview);
  const canAddCustom = pages.length < 16 && pages.filter(item => item.kind === "custom").length < maxCustomPages;
  function edit(patch: Partial<ThemePage>) {
    update(pages.map(item => item.id === page.id ? { ...item, ...patch } : item));
  }
  function add(kind: PageKind) {
    if (pages.length >= 16 || (kind === "custom" ? !canAddCustom : pages.some(p => p.kind === kind))) return;
    const id = crypto.randomUUID();
    update([...pages, { id, kind, slug: kind === "custom" ? `trang-${id.slice(0,8)}` : kind, title: themePageKinds[kind], description: "", visible: true, blocks: [] }]);
    setPageId(id);
  }
  function addBlock(kind: BlockKind) {
    if (!page || page.blocks.length >= 16 || !allowedKinds.includes(kind)) return;
    const id = crypto.randomUUID();
    edit({ blocks: [...page.blocks, createThemeBlock(kind, id)] });
    setBlockId(id); setView("layers");
  }
  function editBlock(patch: Partial<ThemeBlock>) {
    edit({ blocks: page.blocks.map(block => {
      if (block.id !== selected?.id) return block;
      const next = { ...block, ...patch };
      if (next.image === undefined) delete next.image;
      return next;
    }) });
  }
  function move(from: string, to: string) {
    const order = [...page.blocks];
    const origin = order.findIndex(block => block.id === from);
    const end = order.findIndex(block => block.id === to);
    if (origin < 0 || end < 0 || origin === end) return;
    order.splice(end, 0, ...order.splice(origin, 1));
    edit({ blocks: order });
  }
  async function upload(file: File) {
    if (!studio?.upload || !selected || selected.kind !== "announcement" || uploading) return;
    if (!file.size || file.size > maxThemeImageBytes) { setUploadMessage("Chọn ảnh có dung lượng tối đa 2 MB."); return; }
    const form = new FormData();
    form.set("image", file);
    setUploading(true);
    setUploadMessage("Đang tải ảnh…");
    try {
      const result = await studio.upload(form);
      if (!result.key) { setUploadMessage(result.error ?? "Chưa tải được ảnh."); return; }
      const image = result.key;
      update(current => current.map(item => item.id === page.id
        ? { ...item, blocks: item.blocks.map(block => block.id === selected.id ? { ...block, image } : block) } : item));
      setUploadMessage("Đã tải ảnh. Ảnh sẽ xuất hiện trên website sau khi phát hành và áp dụng phiên bản.");
    } catch {
      setUploadMessage("Chưa tải được ảnh. Kiểm tra kết nối và thử lại.");
    } finally {
      setUploading(false);
    }
  }
  return <section className="theme-studio-panel theme-page-editor">
    <h3>Trang và thư viện component</h3>
    {studio && <nav className="theme-studio-tools" aria-label="Điều hướng thiết kế">
      <Link href={studio.pages}>Quản lý và tạo trang</Link><Link href={studio.components}>Thư viện Component</Link>
    </nav>}
    {pages.length > 0 && <label>Trang<select value={page?.id} onChange={event => { setPageId(event.target.value); setBlockId(""); }}>
      {pages.map(item => <option key={item.id} value={item.id}>{item.title || themePageKinds[item.kind]}</option>)}
    </select></label>}
    {studio && !page && <p>Chưa có trang. Tạo trang trong Quản lý trang để bắt đầu.</p>}
    {!readOnly && !studio && <div className="theme-editor-switch" role="group" aria-label="Công cụ trang">{(["pages","components","layers"] as const).map((tab, index) =>
      <button type="button" key={tab} aria-pressed={tab === view} onClick={() => setView(tab)}>{["Trang", "Component", "Lớp"][index]}</button>)}</div>}
    {!readOnly && !studio && view === "pages" && <>
      <label>Thêm trang<select value="" onChange={event => { if (event.target.value) add(event.target.value as PageKind); }}>
        <option value="">Chọn loại trang</option>{Object.entries(themePageKinds).map(([kind,label]) =>
          <option key={kind} value={kind} disabled={pages.length >= 16 || (kind === "custom" ? !canAddCustom : pages.some(item => item.kind === kind))}>{label}</option>)}
      </select></label>
      {page && <>
        <label>Tên trang và tiêu đề SEO<input value={page.title} maxLength={100} onChange={event => edit({ title: event.target.value })} /></label>
        <label>Mô tả SEO<textarea value={page.description} maxLength={240} onChange={event => edit({ description: event.target.value })} /></label>
        {page.kind === "custom" && <>
          <label>Đường dẫn<input value={page.slug} maxLength={64} onChange={event => edit({ slug: event.target.value })} /></label>
          <label><input type="checkbox" checked={page.visible} disabled={isHome} onChange={event => edit({ visible: event.target.checked })} /> Công khai trang</label>
          <button type="button" disabled={isHome} onClick={() => { if (window.confirm("Xóa trang tùy chỉnh này khỏi bản nháp?")) update(pages.filter(item => item.id !== page.id)); }}>Xóa trang</button>
        </>}
        <button type="button" disabled={!canAddCustom || page.blocks.some(block => statusOf(block.kind) !== "active")} onClick={() => {
          const id = crypto.randomUUID();
          const duplicate = { ...page, kind: "custom" as const, id, slug: `trang-${id.slice(0,8)}`, blocks: page.blocks.map(block => ({ ...block, id: crypto.randomUUID() })) };
          if (page.meta) duplicate.meta = { ...page.meta, homepage: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
          update([...pages, duplicate]);
          setPageId(id);
        }}>Nhân bản thành trang tùy chỉnh</button>
        <div className="theme-studio-tools">{[-1,1].map(direction => <button key={direction} type="button" disabled={!pages[pages.indexOf(page)+direction]} onClick={() => {
          const index = pages.indexOf(page); const order = [...pages];
          order.splice(index + direction, 0, ...order.splice(index, 1)); update(order);
        }}>{direction < 0 ? "Đưa lên" : "Đưa xuống"}</button>)}</div>
      </>}
    </>}
    {!readOnly && page && view === "components" && <div className="theme-library-grid">
      {allowedKinds.map(kind =>
        <button key={kind} type="button" disabled={page.blocks.length >= 16} onClick={() => addBlock(kind)}>+ {themeBlocks[kind].label}</button>)}
    </div>}
    {page && (studio || view === "layers" || readOnly) && <div className={`theme-studio-grid${studio && !navigation ? " is-collapsed" : ""}`}>
      <div className="theme-studio-panel theme-layer-list" hidden={Boolean(studio && !navigation)}><h3>Các lớp</h3>{page.blocks.length === 0 && <p>Chưa có component.</p>}
        {page.blocks.filter(block => !readOnly || !block.hidden).map((block, index) => <div className="theme-layer-row" key={block.id} draggable={!readOnly}
          onDragStart={event => event.dataTransfer.setData("text/plain", block.id)} onDragOver={event => { if (!readOnly) event.preventDefault(); }}
          onDrop={event => { if (!readOnly) move(event.dataTransfer.getData("text/plain"), block.id); }}>
          {readOnly ? <strong>{block.title || themeBlocks[block.kind].label}</strong> :
            <button type="button" aria-pressed={selected?.id === block.id} onClick={() => setBlockId(block.id)}>
              {block.title || themeBlocks[block.kind].label}{block.hidden ? " · Ẩn" : ""}
              {statusOf(block.kind) !== "active" && ` · ${componentStatuses[statusOf(block.kind)]}`}
            </button>}
          {!readOnly && <><button type="button" aria-label="Đưa component lên" disabled={index === 0} onClick={() => move(block.id, page.blocks[index-1].id)}>↑</button><button type="button" aria-label="Đưa component xuống" disabled={index === page.blocks.length-1} onClick={() => move(block.id, page.blocks[index+1].id)}>↓</button></>}
        </div>)}
        {studio && <details><summary>Thêm component</summary>
          {!allowedKinds.length && <p>Không có component được phép thêm.</p>}
          {Object.entries(componentGroups).map(([group, label]) => {
            const kinds = allowedKinds.filter(kind => themeBlocks[kind].group === group);
            if (!kinds.length) return null;
            return <fieldset key={group}><legend>{label}</legend>{kinds.map(kind => {
              return <button type="button" key={kind} disabled={page.blocks.length >= 16} title={themeBlocks[kind].description} onClick={() => addBlock(kind)}>
                + {themeBlocks[kind].label}
              </button>;
            })}</fieldset>;
          })}
        </details>}
      </div>
      <div className="theme-studio-canvas" key={previewRevision}>{renderPreview && <p className="theme-studio-fixture">{storePreview ? storePreview.store.name : "Dữ liệu minh họa"} · {width} px</p>}
      <div className={renderPreview ? "theme-page-canvas appearance-preview" : "theme-page-canvas"} data-theme={preset}
        data-page-template={themePageTemplate(page)} style={renderPreview ? { width, zoom } : { maxWidth: width }}>
        {renderPreview && page.kind !== "home" && <h1>{page.title}</h1>}
        {page.blocks.filter(block => !block.hidden && (!renderPreview || blockCompatible(block.kind, family))).map(block => renderPreview
        ? <section key={block.id} className="published-theme-block studio-preview-block" data-selected={selected?.id === block.id}
          draggable={Boolean(storePreview && !readOnly)}
          onDragStart={event => event.dataTransfer.setData("text/plain", block.id)}
          onDragOver={event => { if (storePreview && !readOnly) event.preventDefault(); }}
          onDrop={event => { if (storePreview && !readOnly) { event.preventDefault(); move(event.dataTransfer.getData("text/plain"), block.id); } }}
          onClick={!readOnly && (studio || storePreview) ? () => setBlockId(block.id) : undefined}>
          {!readOnly && (studio || storePreview) && <button type="button" aria-pressed={selected?.id === block.id} onClick={() => setBlockId(block.id)}>
            Chọn {block.title || themeBlocks[block.kind].label}
          </button>}
          <ThemeBlockContent block={block} data={storePreview ?? themeComponentPreviewData} />
        </section>
        : <article key={block.id} className="theme-studio-panel">
        <strong>{block.title || themeBlocks[block.kind].label}</strong>{block.copy && <p>{block.copy}</p>}
        <ThemeBlockImage image={block.image} />
        {themeBlocks[block.kind].source !== "text" && <small>Nguồn dữ liệu · {themeBlocks[block.kind].label}</small>}
      </article>)}</div></div>
      {studio && !selected && <aside className="theme-studio-panel"><h3>Thuộc tính</h3><p>Chọn component trên canvas hoặc trong danh sách lớp.</p></aside>}
      {!readOnly && selected && <div className="theme-studio-panel"><h3>Thuộc tính component</h3>
        {statusOf(selected.kind) !== "active" && <p>{componentStatuses[statusOf(selected.kind)]}. Instance đang có vẫn hoạt động. Chọn component Active nếu cần thay thế.</p>}
        <label>{componentFields.title.label}<input maxLength={componentFields.title.max} value={selected.title} onChange={event => editBlock({ title: event.target.value })} /></label>
        <label>{componentFields.copy.label}<textarea maxLength={componentFields.copy.max} value={selected.copy} onChange={event => editBlock({ copy: event.target.value })} /></label>
        {selectedFields.includes("limit") && <label>{componentFields.limit.label}<select value={selected.limit} onChange={event => editBlock({ limit: Number(event.target.value) })}>
          {Array.from({length:componentFields.limit.max}, (_, index) => <option key={index}>{index+1}</option>)}</select></label>}
        <label><input type="checkbox" checked={selected.hidden} onChange={event => editBlock({ hidden: event.target.checked })} /> Ẩn</label>
        {studio?.upload && selectedFields.includes("image") && <>
          <label>Ảnh nội dung <input type="file" accept="image/png,image/jpeg,image/webp" disabled={uploading} onChange={event => {
            const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void upload(file);
          }} /></label>
          {selected.image && <button type="button" disabled={uploading} onClick={() => editBlock({ image: undefined })}>Gỡ ảnh</button>}
          {uploadMessage && <p role="status">{uploadMessage}</p>}
        </>}
        <button type="button" onClick={() => editBlock({ ...createThemeBlock(selected.kind, selected.id), image: undefined })}>Đặt lại component</button>
        <button type="button" disabled={page.blocks.length >= 16 || !allowedKinds.includes(selected.kind)} onClick={() => {
          const id = crypto.randomUUID();
          edit({ blocks: [...page.blocks, { ...selected, id }] });
          setBlockId(id);
        }}>Nhân bản component</button>
        <button type="button" onClick={() => { if (window.confirm("Xóa component khỏi bản nháp?")) edit({ blocks: page.blocks.filter(block => block.id !== selected.id) }); }}>Xóa component</button>
      </div>}
    </div>}
  </section>;
}
