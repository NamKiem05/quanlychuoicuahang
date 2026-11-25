"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { storefrontSections, storefrontStyles, storeThemes, type StorefrontSection } from "@/lib/store-appearance";
import type { ThemeManifest } from "@/lib/theme-studio";
import ThemePageEditor from "./theme-page-editor";

const widths = { Desktop: 1024, Tablet: 768, Mobile: 390 } as const;

function SampleSection({ id, headline }: { id: StorefrontSection; headline: string }) {
  if (id === "hero") return <span className="theme-sample-hero"><strong>{headline || "Chào mừng đến với cửa hàng"}</strong><small>Khám phá sản phẩm</small></span>;
  if (id === "menu") return <span className="theme-sample-menu"><strong>Sản phẩm nổi bật</strong><span>{["Sản phẩm A", "Sản phẩm B", "Sản phẩm C"].map(name => <span key={name}><i aria-hidden="true" /><small>{name}</small></span>)}</span></span>;
  if (id === "reviews") return <span className="theme-sample-copy"><strong>Đánh giá</strong><small>★ ★ ★ ★ ★ · Phản hồi của khách hàng</small></span>;
  return <span className="theme-sample-copy"><strong>Giới thiệu cửa hàng</strong><small>Nội dung giới thiệu và thông tin liên hệ</small></span>;
}

type Autosave = { id: string; revision: number; save: (id: string, revision: number, value: ThemeManifest) => Promise<{ revision?: number; error?: string }> };
export default function ThemeBuilder({ initial, fieldName = "manifest", readOnly = false, family, autosave, disabledComponents, maxCustomPages }: { initial: ThemeManifest; fieldName?: string; readOnly?: boolean; family?: string; autosave?: Autosave; disabledComponents?: string[]; maxCustomPages?: number }) {
  const [history, setHistory] = useState({ entries: [initial], index: 0 });
  const [selected, setSelected] = useState<StorefrontSection>("hero");
  const [device, setDevice] = useState<keyof typeof widths>("Desktop");
  const [workspace, setWorkspace] = useState<"pages" | "home">(readOnly && !initial.pages?.length ? "home" : "pages");
  const draft = history.entries[history.index];
  const editor = useRef<HTMLElement>(null);
  const revision = useRef(autosave?.revision ?? 0);
  const lastAttempt = useRef(JSON.stringify(initial));
  const alive = useRef(false);
  const [saveStatus, setSaveStatus] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!autosave || saving || lastAttempt.current === JSON.stringify(draft)) return;
    const timer = setTimeout(async () => {
      const section = editor.current?.closest(".themes-create");
      const blockSubmit = (event: Event) => event.preventDefault();
      section?.addEventListener("submit", blockSubmit, true);
      lastAttempt.current = JSON.stringify(draft);
      setSaving(true); setSaveStatus("Đang tự lưu bản nháp…");
      try {
        const result = await autosave.save(autosave.id, revision.current, draft);
        if (!alive.current) return;
        if (result.revision !== undefined) {
          revision.current = result.revision;
          section?.querySelectorAll<HTMLInputElement>("[data-theme-revision]").forEach(input => { input.value = String(result.revision); });
          section?.querySelectorAll<HTMLButtonElement>("[data-theme-publish]").forEach(button => { button.disabled = false; });
          setSaveStatus("Đã tự lưu bản nháp.");
        } else setSaveStatus(result.error === "conflict" ? "Bản nháp đã thay đổi ở phiên khác. Hãy tải lại để tiếp tục." : "Chưa tự lưu được. Kiểm tra nội dung hoặc dùng Lưu bản nháp.");
      } catch {
        if (alive.current) setSaveStatus("Chưa tự lưu được. Hãy dùng Lưu bản nháp.");
      } finally {
        section?.removeEventListener("submit", blockSubmit, true);
        if (alive.current) setSaving(false);
      }
    }, 900);
    return () => clearTimeout(timer);
  }, [autosave, draft, saving]);
  const accent = storeThemes.find((theme) => theme.id === draft.preset)?.color;
  const deviceIndex = device === "Desktop" ? 0 : device === "Tablet" ? 1 : 2;

  function change(patch: Partial<ThemeManifest>) {
    setHistory(current => ({
      entries: [...current.entries.slice(0, current.index + 1), { ...current.entries[current.index], ...patch }].slice(-100),
      index: Math.min(current.index + 1, 99),
    }));
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
      <button type="button" aria-pressed={workspace === "home"} onClick={() => setWorkspace("home")}>Bố cục trang chủ</button>
    </div>
    <div className="theme-editor-controls">
      {!readOnly && <><button type="button" disabled={history.index === 0} onClick={() => setHistory({ ...history, index: history.index - 1 })}>Hoàn tác</button>
      <button type="button" disabled={history.index === history.entries.length - 1} onClick={() => setHistory({ ...history, index: history.index + 1 })}>Làm lại</button></>}
      <div className="theme-device-switch" role="group" aria-label="Kích thước xem trước">{Object.keys(widths).map((size) => <button type="button" key={size} aria-pressed={device === size} onClick={() => setDevice(size as keyof typeof widths)}>{size}</button>)}</div>
    </div>
    </header>
    {saveStatus && <p className="theme-editor-save" aria-live="polite">{saveStatus}</p>}
    <div hidden={workspace !== "pages"}>{(!readOnly || draft.pages?.length) ? <ThemePageEditor pages={draft.pages ?? []} update={pages => change({ pages, schemaVersion: 2 })} family={family} readOnly={readOnly} width={widths[device]} disabledComponents={disabledComponents} maxCustomPages={maxCustomPages} /> : <p className="themes-empty">Mẫu này chưa có trang bổ sung.</p>}</div>
    <div hidden={workspace !== "home"}>
    <div className={readOnly ? undefined : "theme-studio-grid"}>
      {!readOnly && <nav className="theme-studio-panel" aria-label="Các khối trang chủ">
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
        <div className="theme-demo" data-style={draft.style} data-density={draft.density}
          data-font={draft.settings.font} data-radius={draft.settings.radius}
          style={{ maxWidth: widths[device] - (draft.settings.width === "standard" ? 24 : 0), borderColor: accent, "--preview-columns": draft.settings.columns[deviceIndex] } as CSSProperties}>
          {draft.order.filter(id => !draft.hidden.includes(id)).map(id => {
            const style = id === "hero" ? { backgroundColor: accent, color: "white" } : undefined;
            const sample = <SampleSection id={id} headline={draft.headline} />;
            return readOnly ? <div key={id} className="theme-demo-section" style={style}>{sample}</div>
              : <button key={id} type="button" aria-pressed={selected === id} onClick={() => setSelected(id)} className="theme-demo-section" style={style}>{sample}</button>;
          })}
        </div>
      </div>
      {!readOnly && <div className="theme-studio-panel">
        <h3>{block?.label}</h3>
        {selected !== "menu" && <label><input type="checkbox" checked={!draft.hidden.includes(selected)} onChange={event => change({ hidden: event.target.checked ? draft.hidden.filter(id => id !== selected) : [...draft.hidden, selected] })} /> Hiển thị khối</label>}
        {selected === "hero" && <label>Tiêu đề banner<input maxLength={100} value={draft.headline} onChange={event => change({ headline: event.target.value })} /></label>}
        <h3>Kiểu trình bày</h3>
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
