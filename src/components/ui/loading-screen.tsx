import "./loading-screen.css";

export default function LoadingScreen({ contained = false }: { contained?: boolean }) {
  return (
    <div className={`growdesk-loading${contained ? " growdesk-loading-contained" : ""}`}>
      <div className="growdesk-loading-inner" role="status">
        <span className="growdesk-loading-spinner" aria-hidden="true" />
        <span>Đang tải...</span>
      </div>
    </div>
  );
}
