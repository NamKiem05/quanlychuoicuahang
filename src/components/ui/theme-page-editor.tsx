"use client";
import { useState } from "react";
import { blockCompatible, themeBlocks, themePageKinds, type BlockKind, type PageKind, type ThemeBlock, type ThemePage } from "@/lib/theme-pages";

export default function ThemePageEditor({ pages, update, family, readOnly, width, disabledComponents = [], maxCustomPages = 16 }: {
  pages: ThemePage[]; update: (pages: ThemePage[]) => void; family?: string; readOnly: boolean; width: number; disabledComponents?: string[]; maxCustomPages?: number;
}) {
  const [pageId, setPageId] = useState("");
  const [blockId, setBlockId] = useState("");
  const [view, setView] = useState<"pages" | "components" | "layers">("pages");
  const page = pages.find(p => p.id === pageId) ?? pages[0];
  const selected = page?.blocks.find(block => block.id === blockId);
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
    if (!page || page.blocks.length >= 16) return;
    const id = crypto.randomUUID();
    edit({ blocks: [...page.blocks, { id, kind, title: themeBlocks[kind].label, copy: "", limit: 6, hidden: false }] });
    setBlockId(id); setView("layers");
  }
  function editBlock(patch: Partial<ThemeBlock>) {
    edit({ blocks: page.blocks.map(block => block.id === selected?.id ? { ...block, ...patch } : block) });
  }
  function move(from: string, to: string) {
    const order = [...page.blocks];
    const origin = order.findIndex(block => block.id === from);
    const end = order.findIndex(block => block.id === to);
    if (origin < 0 || end < 0 || origin === end) return;
    order.splice(end, 0, ...order.splice(origin, 1));
    edit({ blocks: order });
  }
  return <section className="theme-studio-panel theme-page-editor">
    <h3>Trang và thư viện component</h3>
    {pages.length > 0 && <label>Trang<select value={page?.id} onChange={event => { setPageId(event.target.value); setBlockId(""); }}>
      {pages.map(item => <option key={item.id} value={item.id}>{item.title || themePageKinds[item.kind]}</option>)}
    </select></label>}
    {!readOnly && <div className="theme-editor-switch" role="group" aria-label="Công cụ trang">{(["pages","components","layers"] as const).map((tab, index) =>
      <button type="button" key={tab} aria-pressed={tab === view} onClick={() => setView(tab)}>{["Trang", "Component", "Lớp"][index]}</button>)}</div>}
    {!readOnly && view === "pages" && <>
      <label>Thêm trang<select value="" onChange={event => { if (event.target.value) add(event.target.value as PageKind); }}>
        <option value="">Chọn loại trang</option>{Object.entries(themePageKinds).map(([kind,label]) =>
          <option key={kind} value={kind} disabled={pages.length >= 16 || (kind === "custom" ? !canAddCustom : pages.some(item => item.kind === kind))}>{label}</option>)}
      </select></label>
      {page && <>
        <label>Tên trang và tiêu đề SEO<input value={page.title} maxLength={100} onChange={event => edit({ title: event.target.value })} /></label>
        <label>Mô tả SEO<textarea value={page.description} maxLength={240} onChange={event => edit({ description: event.target.value })} /></label>
        {page.kind === "custom" && <>
          <label>Đường dẫn<input value={page.slug} maxLength={64} onChange={event => edit({ slug: event.target.value })} /></label>
          <label><input type="checkbox" checked={page.visible} onChange={event => edit({ visible: event.target.checked })} /> Công khai trang</label>
          <button type="button" onClick={() => { if (window.confirm("Xóa trang tùy chỉnh này khỏi bản nháp?")) update(pages.filter(item => item.id !== page.id)); }}>Xóa trang</button>
        </>}
        <button type="button" disabled={!canAddCustom} onClick={() => {
          const id = crypto.randomUUID();
          update([...pages, { ...page, kind: "custom", id, slug: `trang-${id.slice(0,8)}`, blocks: page.blocks.map(block => ({ ...block, id: crypto.randomUUID() })) }]);
          setPageId(id);
        }}>Nhân bản thành trang tùy chỉnh</button>
        <div className="theme-studio-tools">{[-1,1].map(direction => <button key={direction} type="button" disabled={!pages[pages.indexOf(page)+direction]} onClick={() => {
          const index = pages.indexOf(page); const order = [...pages];
          order.splice(index + direction, 0, ...order.splice(index, 1)); update(order);
        }}>{direction < 0 ? "Đưa lên" : "Đưa xuống"}</button>)}</div>
      </>}
    </>}
    {!readOnly && page && view === "components" && <div className="theme-library-grid">
      {(Object.keys(themeBlocks) as BlockKind[]).filter(kind => !disabledComponents.includes(kind) && blockCompatible(kind, family)).map(kind =>
        <button key={kind} type="button" disabled={page.blocks.length >= 16} onClick={() => addBlock(kind)}>+ {themeBlocks[kind].label}</button>)}
    </div>}
    {page && (view === "layers" || readOnly) && <div className="theme-studio-grid">
      <div className="theme-studio-panel theme-layer-list"><h3>Các lớp</h3>{page.blocks.length === 0 && <p>Chưa có component.</p>}
        {page.blocks.filter(block => !readOnly || !block.hidden).map((block, index) => <div className="theme-layer-row" key={block.id} draggable={!readOnly}
          onDragStart={event => event.dataTransfer.setData("text/plain", block.id)} onDragOver={event => { if (!readOnly) event.preventDefault(); }}
          onDrop={event => { if (!readOnly) move(event.dataTransfer.getData("text/plain"), block.id); }}>
          {readOnly ? <strong>{block.title}</strong> : <button type="button" aria-pressed={selected?.id === block.id} onClick={() => setBlockId(block.id)}>{block.title || themeBlocks[block.kind].label}{block.hidden ? " · Ẩn" : ""}</button>}
          {!readOnly && <><button type="button" aria-label="Đưa component lên" disabled={index === 0} onClick={() => move(block.id, page.blocks[index-1].id)}>↑</button><button type="button" aria-label="Đưa component xuống" disabled={index === page.blocks.length-1} onClick={() => move(block.id, page.blocks[index+1].id)}>↓</button></>}
        </div>)}
      </div>
      <div className="theme-studio-canvas"><div className="theme-page-canvas" style={{ maxWidth: width }}>{page.blocks.filter(block => !block.hidden).map(block => <article key={block.id} className="theme-studio-panel">
        <strong>{block.title || themeBlocks[block.kind].label}</strong>{block.copy && <p>{block.copy}</p>}
        {themeBlocks[block.kind].source !== "text" && <small>Nguồn dữ liệu · {themeBlocks[block.kind].label}</small>}
      </article>)}</div></div>
      {!readOnly && selected && <div className="theme-studio-panel"><h3>Thuộc tính component</h3>
        <label>Tiêu đề<input maxLength={100} value={selected.title} onChange={event => editBlock({ title: event.target.value })} /></label>
        <label>Nội dung<textarea maxLength={500} value={selected.copy} onChange={event => editBlock({ copy: event.target.value })} /></label>
        {["catalog","categories","reviews"].includes(themeBlocks[selected.kind].source) && <label>Số mục<select value={selected.limit} onChange={event => editBlock({ limit: Number(event.target.value) })}>{Array.from({length:12}, (_, index) => <option key={index}>{index+1}</option>)}</select></label>}
        <label><input type="checkbox" checked={selected.hidden} onChange={event => editBlock({ hidden: event.target.checked })} /> Ẩn</label>
        <button type="button" onClick={() => editBlock({ title: themeBlocks[selected.kind].label, copy: "", limit: 6, hidden: false })}>Đặt lại component</button>
        <button type="button" disabled={page.blocks.length >= 16} onClick={() => edit({ blocks: [...page.blocks, { ...selected, id: crypto.randomUUID() }] })}>Nhân bản component</button>
        <button type="button" onClick={() => { if (window.confirm("Xóa component khỏi bản nháp?")) edit({ blocks: page.blocks.filter(block => block.id !== selected.id) }); }}>Xóa component</button>
      </div>}
    </div>}
  </section>;
}
