"use client";

import { useState, type CSSProperties } from "react";
import { storefrontSections, storefrontStyles, storeThemes, type StorefrontSection } from "@/lib/store-appearance";
import type { ThemeManifest } from "@/lib/theme-studio";
import ThemePageEditor, { type StudioPageTools } from "./theme-page-editor";
import { useThemeDraftSave, type ThemeAutosave } from "./use-theme-draft-save";
import type { ThemePage } from "@/lib/theme-pages";

import type { BlockData } from "@/components/storefront/theme-sections";

const widths = { Desktop: 1024, Tablet: 768, Mobile: 390 } as const;

function SampleSection({ id, headline }: { id: StorefrontSection; headline: string }) {
  if (id === "hero") return <span className="theme-sample-hero"><strong>{headline || "Chào mừng đến với cửa hàng"}</strong><small>Khám phá sản phẩm</small></span>;
  if (id === "menu") return <span className="theme-sample-menu"><strong>Sản phẩm nổi bật</strong><span>{["Sản phẩm A", "Sản phẩm B", "Sản phẩm C"].map(name => <span key={name}><i aria-hidden="true" /><small>{name}</small></span>)}</span></span>;
  if (id === "reviews") return <span className="theme-sample-copy"><strong>Đánh giá</strong><small>★ ★ ★ ★ ★ · Phản hồi của khách hàng</small></span>;
  return <span className="theme-sample-copy"><strong>Giới thiệu cửa hàng</strong><small>Nội dung giới thiệu và thông tin liên hệ</small></span>;
}

function StoreSection({ id, headline, data }: { id: StorefrontSection; headline: string; data: BlockData }) {
  if (id === "hero") return <span className="theme-sample-hero"><strong>{headline || data.store.name}</strong></span>;
  if (id === "menu") return <span className="theme-sample-menu"><strong>Sản phẩm</strong><span>{data.products.slice(0, 3).map(product =>
    <span key={product.id}><strong>{product.name}</strong><small>{product.price.toLocaleString("vi-VN")} ₫</small></span>)}</span>{!data.products.length && <small>Chưa có sản phẩm.</small>}</span>;
  if (id === "reviews") return <span className="theme-sample-copy"><strong>Đánh giá</strong><small>{data.reviews[0]?.body || "Chưa có đánh giá."}</small></span>;
  return <span className="theme-sample-copy"><strong>{data.store.name}</strong><small>{data.store.description || data.store.address}</small></span>;
}

function PreviewSection({ id, headline }: { id: StorefrontSection; headline: string }) {
  const label = storefrontSections.find(section => section.id === id)?.label;
  if (id === "hero") return <span className="theme-sample-hero"><strong>{headline || label}</strong></span>;
  if (id === "menu") return <span className="theme-sample-menu"><strong>{label}</strong><span aria-hidden="true">
    {[1, 2, 3].map(slot => <span key={slot}><i /></span>)}
  </span></span>;
  return <span className="theme-sample-copy"><strong>{label}</strong></span>;
}

export default function ThemeBuilder({ initial, fieldName = "manifest", readOnly = false, structureOnly = false, family, autosave, disabledComponents, deprecatedComponents, maxCustomPages, studio, pagePreview = false, storePreview }: { initial: ThemeManifest; fieldName?: string; readOnly?: boolean; structureOnly?: boolean; family?: string; autosave?: ThemeAutosave; disabledComponents?: string[]; deprecatedComponents?: string[]; maxCustomPages?: number; studio?: StudioPageTools; pagePreview?: boolean; storePreview?: BlockData }) {
  const [history, setHistory] = useState({ entries: [initial], index: 0 });
  const [selected, setSelected] = useState<StorefrontSection>("hero");
  const [device, setDevice] = useState<keyof typeof widths>("Desktop");
  const [workspace, setWorkspace] = useState<"pages" | "home">((readOnly || storePreview) && !initial.pages?.length ? "home" : "pages");
  const draft = history.entries[history.index];
  const { editor, persist, dirty, status } = useThemeDraftSave(initial, draft, autosave, Boolean(studio));
  const [previewRevision, setPreviewRevision] = useState(0);
  const [navigation, setNavigation] = useState(true);
  const [zoom, setZoom] = useState(1);
  const saveMessage = status === "saving" ? "Đang lưu bản nháp…" :
    status === "conflict" ? "Bản nháp đã thay đổi ở phiên khác. Hãy tải lại để tiếp tục." :
    dirty && status === "invalid" ? "Bản nháp chưa hợp lệ. Kiểm tra nội dung hoặc đường dẫn trang." :
    dirty && status === "unavailable" ? "Chưa lưu được. Kiểm tra kết nối rồi thử lại." :
    dirty ? "Có thay đổi chưa lưu." : status === "saved" ? "Đã lưu bản nháp." : "";
  const accent = storeThemes.find((theme) => theme.id === draft.preset)?.color;
  const deviceIndex = device === "Desktop" ? 0 : device === "Tablet" ? 1 : 2;

  function change(patch: Partial<ThemeManifest> | ((current: ThemeManifest) => Partial<ThemeManifest>)) {
    setHistory(current => ({
      entries: [...current.entries.slice(0, current.index + 1), { ...current.entries[current.index], ...(typeof patch === "function" ? patch(current.entries[current.index]) : patch) }].slice(-100),
      index: Math.min(current.index + 1, 99),
    }));
  }

  function updatePages(next: ThemePage[] | ((pages: ThemePage[]) => ThemePage[])) {
    const now = new Date().toISOString();
    change(current => {
      const previous = current.pages ?? [];
      const pages = typeof next === "function" ? next(previous) : next;
      return {
        schemaVersion: 2,
        pages: studio ? pages.map(page => previous.includes(page) ? page :
          { ...page, meta: { ...page.meta, updatedAt: now } }) : pages,
      };
    });
  }

  function move(section: StorefrontSection, target: StorefrontSection) {
    if (section === target || !draft.order.includes(section) || !draft.order.includes(target)) return;
    const order = [...draft.order];
    order.splice(order.indexOf(section), 1);
    order.splice(draft.order.indexOf(target), 0, section);
    change({ order });
  }

  function changeColumns(index: number, value: number) {
    const columns: ThemeManifest["settings"]["columns"] = [...draft.settings.columns];
    columns[index] = value;
    change({ settings: { ...draft.settings, columns } });
  }

  const currentIndex = draft.order.indexOf(selected);
  const block = storefrontSections.find((section) => section.id === selected);
  return <section ref={editor} className="theme-studio" aria-label="Trình chỉnh sửa giao diện">
    {!readOnly && <input name={fieldName} type="hidden" value={JSON.stringify(draft)} />}
    <header className="theme-editor-toolbar">
    <div className="theme-editor-switch" role="group" aria-label="Khu vực chỉnh sửa">
      <button type="button" aria-pressed={workspace === "pages"} onClick={() => setWorkspace("pages")}>Trang &amp; component</button>
      <button type="button" aria-pressed={workspace === "home"} onClick={() => setWorkspace("home")}>{studio ? "Trang chủ và thiết kế toàn cục" : "Bố cục trang chủ"}</button>
    </div>
    <div className="theme-editor-controls">
      {studio && <>
        <button type="button" aria-expanded={navigation} onClick={() => setNavigation(open => !open)}>{navigation ? "Thu gọn điều hướng" : "Mở điều hướng"}</button>
        <button type="button" onClick={() => setPreviewRevision(value => value + 1)}>Làm mới preview</button>
        <label>Thu phóng <select value={zoom} onChange={event => setZoom(Number(event.target.value))}>
          <option value={0.5}>50%</option><option value={0.75}>75%</option><option value={1}>100%</option>
        </select></label>
        {autosave && <button type="button" disabled={!dirty || status === "saving" || status === "conflict"} onClick={persist}>
          {status === "unavailable" ? "Thử lưu lại" : "Lưu bản nháp"}
        </button>}
      </>}
      {!readOnly && <><button type="button" disabled={history.index === 0} onClick={() => setHistory({ ...history, index: history.index - 1 })}>Hoàn tác</button>
      <button type="button" disabled={history.index === history.entries.length - 1} onClick={() => setHistory({ ...history, index: history.index + 1 })}>Làm lại</button></>}
      <div className="theme-device-switch" role="group" aria-label="Kích thước xem trước">{Object.keys(widths).map((size) => <button type="button" key={size} aria-pressed={device === size} onClick={() => setDevice(size as keyof typeof widths)}>{size}</button>)}</div>
    </div>
    </header>
    {!readOnly && saveMessage && <p className="theme-editor-save" aria-live="polite">{saveMessage}</p>}
    <div hidden={workspace !== "pages"}>{(!readOnly || draft.pages?.length) ? <ThemePageEditor pages={draft.pages ?? []}
      update={updatePages}
      studio={studio} navigation={navigation} previewRevision={previewRevision} zoom={zoom} pagePreview={pagePreview} storePreview={storePreview}
      preset={studio || pagePreview || storePreview ? draft.preset : undefined} family={family} readOnly={readOnly} width={widths[device]}
      disabledComponents={disabledComponents} deprecatedComponents={deprecatedComponents} maxCustomPages={maxCustomPages} /> : <p className="themes-empty">Mẫu này chưa có trang bổ sung.</p>}</div>
    <div hidden={workspace !== "home"}>
    <div className={readOnly ? undefined : `theme-studio-grid${studio && !navigation ? " is-collapsed" : ""}`}>
      {!readOnly && <nav className="theme-studio-panel" hidden={Boolean(studio && !navigation)} aria-label="Các khối trang chủ">
        <h3>Trang chủ</h3>
        {draft.order.map(id => <button type="button" key={id} aria-pressed={selected === id}
          draggable onDragStart={event => event.dataTransfer.setData("text/plain", id)}
          onDragOver={event => event.preventDefault()} onDrop={event => {
            event.preventDefault();
            move(event.dataTransfer.getData("text/plain") as StorefrontSection, id);
          }} onClick={() => setSelected(id)}>
          {storefrontSections.find(section => section.id === id)?.label}{draft.hidden.includes(id) ? " · Ẩn" : ""}
        </button>)}
        <div className="theme-studio-tools">
          <button type="button" disabled={currentIndex === 0} onClick={() => move(selected, draft.order[currentIndex - 1])}>Đưa lên</button>
          <button type="button" disabled={currentIndex === draft.order.length - 1} onClick={() => move(selected, draft.order[currentIndex + 1])}>Đưa xuống</button>
        </div>
      </nav>}
      <div className="theme-studio-canvas">
        <div key={previewRevision} className="theme-demo" data-style={draft.style} data-density={draft.density}
          data-font={draft.settings.font} data-radius={draft.settings.radius}
          style={{ [studio ? "width" : "maxWidth"]: widths[device] - (draft.settings.width === "standard" ? 24 : 0),
            zoom: studio ? zoom : undefined, borderColor: accent, "--preview-columns": draft.settings.columns[deviceIndex] } as CSSProperties}>
          {draft.order.filter(id => !draft.hidden.includes(id)).map(id => {
            const style = id === "hero" ? { backgroundColor: accent, color: "white" } : undefined;
            const sample = structureOnly ? <PreviewSection id={id} headline={draft.headline} /> : storePreview ? <StoreSection id={id} headline={draft.headline} data={storePreview} /> : <SampleSection id={id} headline={draft.headline} />;
            return readOnly ? <div key={id} className="theme-demo-section" style={style}>{sample}</div>
              : <button key={id} type="button" draggable={Boolean(storePreview)}
                onDragStart={event => event.dataTransfer.setData("text/plain", id)}
                onDragOver={event => { if (storePreview) event.preventDefault(); }}
                onDrop={event => { if (storePreview) { event.preventDefault(); move(event.dataTransfer.getData("text/plain") as StorefrontSection, id); } }}
                aria-pressed={selected === id} onClick={() => setSelected(id)} className="theme-demo-section" style={style}>{sample}</button>;
          })}
        </div>
      </div>
      {!readOnly && <div className="theme-studio-panel">
        <h3>{block?.label}</h3>
        {selected !== "menu" && <label><input type="checkbox" checked={!draft.hidden.includes(selected)} onChange={event => change({ hidden: event.target.checked ? draft.hidden.filter(id => id !== selected) : [...draft.hidden, selected] })} /> Hiển thị khối</label>}
        {selected === "hero" && <label>Tiêu đề banner<input maxLength={100} value={draft.headline} onChange={event => change({ headline: event.target.value })} /></label>}
        <h3>Thiết kế toàn cục</h3>
        <label>Màu chủ đạo<select value={draft.preset} onChange={event => change({ preset: event.target.value as ThemeManifest["preset"] })}>{storeThemes.map(theme => <option key={theme.id} value={theme.id}>{theme.label}</option>)}</select></label>
        <label>Kiểu giao diện<select value={draft.style} onChange={event => change({ style: event.target.value as ThemeManifest["style"] })}>{storefrontStyles.map(style => <option key={style.id} value={style.id}>{style.label}</option>)}</select></label>
        <label>Khoảng cách<select value={draft.density} onChange={event => change({ density: event.target.value as ThemeManifest["density"] })}><option value="comfortable">Thoáng</option><option value="compact">Gọn</option></select></label>
        <label>Kiểu chữ<select value={draft.settings.font} onChange={event => change({ settings: { ...draft.settings, font: event.target.value as ThemeManifest["settings"]["font"] } })}><option value="system">Mặc định</option><option value="serif">Có chân</option></select></label>
        <label>Bo góc<select value={draft.settings.radius} onChange={event => change({ settings: { ...draft.settings, radius: event.target.value as ThemeManifest["settings"]["radius"] } })}><option value="soft">Bo mềm</option><option value="square">Vuông</option></select></label>
        <label>Độ rộng<select value={draft.settings.width} onChange={event => change({ settings: { ...draft.settings, width: event.target.value as ThemeManifest["settings"]["width"] } })}><option value="standard">Tiêu chuẩn</option><option value="wide">Rộng</option></select></label>
        {Object.keys(widths).map((screen, index) => <label key={screen}>Cột sản phẩm · {screen}<select value={draft.settings.columns[index]} onChange={event => changeColumns(index, Number(event.target.value))}>{Array.from({ length: [6, 4, 2][index] }, (_, position) => position + 1).map(value => <option key={value}>{value}</option>)}</select></label>)}
      </div>}
    </div>
    </div>
  </section>;
}
