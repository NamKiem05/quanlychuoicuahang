"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import ThemeCover from "@/components/ui/theme-cover";
import {
  initialThemeVersion, proposeThemeSlug, themeCreationMethods, validCreationSlug,
  type ThemeCreationCategory, type ThemeCreationMethod, type ThemeCreationSource,
} from "@/lib/theme-creation";
import { themeImageUrl } from "@/lib/theme-library";
import { checkThemeCreationSlug, createThemeFromWizard, findThemeCreationSources } from "./theme-creation-actions";

const steps = ["Thông tin giao diện", "Phương thức khởi tạo", "Xác nhận"];

export default function ThemeCreationWizard({ categories, source }: { categories: ThemeCreationCategory[]; source?: ThemeCreationSource }) {
  const [step, setStep] = useState(0);
  const [method, setMethod] = useState<ThemeCreationMethod>(source ? "clone" : "blank");
  const [selected, setSelected] = useState(source);
  const [title, setTitle] = useState(source ? `${source.name.slice(0,88)} – bản sao` : "");
  const [slug, setSlug] = useState(source ? proposeThemeSlug(`${source.theme_slug.slice(0,60)}-ban-sao`) : "");
  const [manualSlug, setManualSlug] = useState(false);
  const [summary, setSummary] = useState(source?.description ?? "");
  const [category, setCategory] = useState(categories.find(item => item.name === source?.category && source?.families.includes(item.theme_family))?.id ?? "");
  const [thumbnail, setThumbnail] = useState("");
  const [image, setImage] = useState("");
  const [error, setError] = useState("");
  const [serverError, submit, creating] = useActionState(createThemeFromWizard, "");
  const [checking, startCheck] = useTransition();
  const [loading, startLoad] = useTransition();
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<{ count: number; rows: ThemeCreationSource[] } | null>(null);
  const [page, setPage] = useState(1);
  const request = useRef(0);
  const categoryOption = categories.find(item => item.id === category);

  useEffect(() => {
    if (!creating) return;
    const leave = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const follow = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest("a[href]")) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener("beforeunload", leave);
    document.addEventListener("click", follow, true);
    return () => { window.removeEventListener("beforeunload", leave); document.removeEventListener("click", follow, true); };
  }, [creating]);

  function load(nextMethod: "starter" | "clone", term: string, nextPage: number) {
    const current = ++request.current;
    startLoad(async () => {
      try {
        const data = await findThemeCreationSources(nextMethod, term, nextPage);
        if (request.current !== current) return;
        setResults(data); setPage(nextPage);
        if (!data) setError("Chưa tải được danh sách nguồn. Hãy thử tìm lại.");
      } catch {
        if (request.current === current) setError("Mất kết nối khi tìm nguồn.");
      }
    });
  }

  function next() {
    setError("");
    if (step === 0) {
      if (title.trim().length<2 || title.trim().length>100) return setError("Nhập tên giao diện từ 2 đến 100 ký tự.");
      if (!validCreationSlug(slug)) return setError("Mã bắt buộc, dùng chữ thường, số và dấu gạch ngang, tối đa 80 ký tự.");
      if (!categoryOption) return setError("Chọn một danh mục trong hệ thống.");
      if (!themeImageUrl(thumbnail.trim()) || !themeImageUrl(image.trim())) return setError("Ảnh cần dùng URL HTTPS hợp lệ.");
      startCheck(async () => {
        try {
          const issue = await checkThemeCreationSlug(slug);
          if (issue) return setError(issue);
          setStep(1);
          if (method !== "blank") load(method,search,1);
        } catch { setError("Mất kết nối khi kiểm tra slug."); }
      });
      return;
    }
    if (method !== "blank" && (!selected || !categoryOption || !selected.families.includes(categoryOption.theme_family))) {
      setError("Chọn nguồn tương thích với ngành hàng đã chọn."); return;
    }
    setStep(2);
  }

  return <section className="themes-create theme-creation" aria-busy={creating || checking}>
    <header className="theme-section-heading"><h2>Tạo giao diện mới</h2><Link href="/admin/themes">Về kho giao diện</Link></header>
    <ol className="theme-creation-steps" aria-label="Tiến trình tạo giao diện">
      {steps.map((label,index) => <li key={label} aria-current={step===index ? "step" : undefined}>{label}</li>)}
    </ol>
    {(error || (step===2 && serverError)) && <p role="alert" className="theme-feedback is-error">{error || serverError}</p>}
    {step === 0 && <form className="theme-form" onSubmit={event => { event.preventDefault(); next(); }}>
      <fieldset disabled={checking} className="theme-creation-fields">
        <label>Tên giao diện<input required minLength={2} maxLength={100} value={title} onChange={event => {
          setTitle(event.target.value); if (!manualSlug) setSlug(proposeThemeSlug(event.target.value));
        }} /></label>
        <label>Mã giao diện<input required maxLength={80} value={slug} onChange={event => { setManualSlug(true); setSlug(event.target.value); }} /></label>
        <label>Danh mục<select required value={category} onChange={event => setCategory(event.target.value)}>
          <option value="">Chọn danh mục</option>{categories.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>
        {!categories.length && <p>Chưa có danh mục. <Link href="/admin/business-categories">Mở Quản lý ngành hàng</Link></p>}
        <label>Mô tả<textarea maxLength={1000} value={summary} onChange={event => setSummary(event.target.value)} /></label>
        <label>URL thumbnail (tùy chọn)<input type="url" maxLength={2048} value={thumbnail} onChange={event => setThumbnail(event.target.value)} /></label>
        <label>URL ảnh xem trước (tùy chọn)<input type="url" maxLength={2048} value={image} onChange={event => setImage(event.target.value)} /></label>
      </fieldset>
      <button className="theme-primary" type="submit" disabled={checking || !categories.length}>{checking ? "Đang kiểm tra…" : "Tiếp tục"}</button>
    </form>}
    {step === 1 && <div className="theme-form">
      <fieldset className="theme-creation-methods"><legend>Chọn cách khởi tạo</legend>
        {Object.entries(themeCreationMethods).map(([key,label]) => <label key={key}><input type="radio" name="initialMethod" checked={key===method}
          onChange={() => {
            setMethod(key as ThemeCreationMethod); setSelected(undefined); setError(""); setResults(null); setSearch(""); ++request.current;
            if (key==="starter" || key==="clone") load(key,"",1);
          }} /> {label}</label>)}
      </fieldset>
      {method === "blank" ? <p>Khởi tạo thiết kế mặc định và một trang chủ để mở ngay trong Theme Studio.</p> : <>
        <p>{method==="starter" ? "Dùng snapshot đã phát hành. Nội dung được sao chép độc lập." :
          "Dùng bản nháp của giao diện nguồn. Kiểm tra revision trước khi sao chép."}</p>
        <form className="theme-studio-tools" onSubmit={event => { event.preventDefault(); setError(""); load(method,search,1); }}>
          <label>Tìm theo tên hoặc slug<input maxLength={100} value={search} onChange={event => setSearch(event.target.value)} /></label>
          <button className="theme-secondary" disabled={loading}>Tìm</button>
        </form>
        {selected && <p role="status">Nguồn đã chọn · {selected.name} ({selected.theme_slug})</p>}
        {loading ? <p role="status">Đang tải nguồn…</p> : results?.rows.length ? <div className="themes-grid">
          {results.rows.map(item => {
            const compatible = categoryOption && item.families.includes(categoryOption.theme_family);
            return <article key={item.id} className="theme-card">
              <ThemeCover image={item.image} family={item.families[0] ?? "general"} />
              <div className="theme-card-body">
                <h3>{item.name}</h3><p>{item.theme_slug} · {item.category || "Chưa phân loại"}</p>
                <small>{item.version ? `v${item.version}` : "Chưa phát hành"} · {item.lifecycle==="published" ? "Đã phát hành" : item.lifecycle==="archived" ? "Đã lưu trữ" : "Bản nháp"}</small>
                <details><summary>Chi tiết nguồn</summary><p>{item.description || "Chưa có mô tả."}</p></details>
                <button type="button" className="theme-secondary" disabled={!compatible}
                  aria-pressed={selected?.id===item.id} onClick={() => { setSelected(item); setError(""); }}>
                  {compatible ? selected?.id===item.id ? "Đã chọn" : "Chọn nguồn" : "Chưa tương thích ngành hàng"}
                </button>
              </div>
            </article>;
          })}
        </div> : results && <p className="themes-empty">{method==="starter" ? "Chưa có bản phát hành phù hợp. Anh vẫn có thể tạo từ đầu." : "Chưa tìm thấy giao diện nguồn."}</p>}
        {results && (page>1 || page*12<results.count) && <nav className="theme-studio-tools" aria-label="Phân trang nguồn">
          <button type="button" className="theme-secondary" disabled={loading || page===1} onClick={() => load(method,search,page-1)}>Trang trước</button>
          <span>Trang {page}</span><button type="button" className="theme-secondary" disabled={loading || page*12>=results.count} onClick={() => load(method,search,page+1)}>Trang sau</button>
        </nav>}
      </>}
      <div className="theme-studio-tools"><button type="button" className="theme-secondary" onClick={() => { setStep(0); setError(""); }}>Quay lại</button>
        <button type="button" className="theme-primary" onClick={next}>Tiếp tục</button></div>
    </div>}
    {step === 2 && <form action={submit} className="theme-form">
      {Object.entries({ title,slug,summary,category,thumbnail,image,method,source:selected?.id ?? "",
        revision:selected?.draft_revision ?? "",version:selected?.version ?? "" }).map(([name,value]) =>
        <input key={name} name={name} value={value} type="hidden" />)}
      <dl className="theme-library-facts">
        {Object.entries({ "Tên": title, "Slug": slug, "Danh mục": categoryOption?.name, "Mô tả": summary || "Chưa có",
          "Phương thức": themeCreationMethods[method], "Nguồn": selected?.name ?? "—", "Phiên bản phát hành đề xuất": initialThemeVersion,
          "Trạng thái": "Bản nháp" }).map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
      </dl>
      {creating && <p role="status">Đang tạo bản nháp. Vui lòng đợi xác nhận.</p>}
      <div className="theme-studio-tools"><button type="button" className="theme-secondary" disabled={creating} onClick={() => setStep(1)}>Quay lại</button>
        <button type="submit" className="theme-primary" disabled={creating}>{creating ? "Đang tạo…" : "Tạo giao diện"}</button></div>
    </form>}
  </section>;
}
