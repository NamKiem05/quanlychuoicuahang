"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getSupabaseEnv } from "@/lib/supabase/env";

const bucketName = "product-images";
const maxFileSize = 5 * 1024 * 1024;
const allowedTypes: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function getManagedObjectPath(url: string, storageUrl: string, storeId: string) {
  const prefix = storageUrl.replace(/\/$/, "") + "/storage/v1/object/public/" + bucketName + "/";
  if (!url.startsWith(prefix)) return null;

  try {
    const path = decodeURIComponent(url.slice(prefix.length));
    const parts = path.split("/");
    return parts.length === 2 && parts[0] === storeId && parts[1] && parts[1] !== "." && parts[1] !== ".." ? path : null;
  } catch {
    return null;
  }
}

export default function ProductImageField({
  storeId,
  initialUrl,
  onUploadingChange,
}: {
  storeId: string;
  initialUrl: string;
  onUploadingChange: (uploading: boolean) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [imageUrl, setImageUrl] = useState(initialUrl);
  const [previewUrl, setPreviewUrl] = useState(initialUrl);
  const [isUploading, setIsUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [messageIsError, setMessageIsError] = useState(false);

  useEffect(() => () => {
    if (previewUrl.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  function setUploadState(uploading: boolean) {
    setIsUploading(uploading);
    onUploadingChange(uploading);
  }

  async function uploadSelectedFile(file: File) {
    const extension = allowedTypes[file.type];
    if (!extension) {
      setMessage("Chỉ nhận ảnh JPG, PNG hoặc WebP.");
      setMessageIsError(true);
      if (fileInput.current) fileInput.current.value = "";
      return;
    }
    if (file.size > maxFileSize) {
      setMessage("Ảnh cần nhỏ hơn 5 MB.");
      setMessageIsError(true);
      if (fileInput.current) fileInput.current.value = "";
      return;
    }

    const previousUrl = imageUrl;
    const localPreview = URL.createObjectURL(file);
    setPreviewUrl(localPreview);
    setMessage("Đang tải ảnh lên...");
    setMessageIsError(false);
    setUploadState(true);

    try {
      const supabase = createClient();
      const objectPath = storeId + "/" + crypto.randomUUID() + "." + extension;
      const { error: uploadError } = await supabase.storage.from(bucketName).upload(objectPath, file, {
        cacheControl: "3600",
        contentType: file.type,
        upsert: false,
      });
      if (uploadError) throw uploadError;

      const { data } = supabase.storage.from(bucketName).getPublicUrl(objectPath);
      setImageUrl(data.publicUrl);
      setPreviewUrl(data.publicUrl);

      const oldPath = previousUrl !== initialUrl
        ? getManagedObjectPath(previousUrl, getSupabaseEnv().url, storeId)
        : null;
      let cleanupFailed = false;
      if (oldPath) {
        const { error } = await supabase.storage.from(bucketName).remove([oldPath]);
        cleanupFailed = Boolean(error);
      }

      setMessage(cleanupFailed ? "Ảnh mới đã tải lên; ảnh vừa chọn trước đó chưa được dọn khỏi kho." : "Đã tải ảnh lên. Nhớ lưu món để áp dụng ảnh mới.");
      setMessageIsError(cleanupFailed);
      if (fileInput.current) fileInput.current.value = "";
    } catch {
      setPreviewUrl(previousUrl);
      setMessage("Chưa tải được ảnh. Hãy kiểm tra kết nối và quyền của tài khoản rồi thử lại.");
      setMessageIsError(true);
      if (fileInput.current) fileInput.current.value = "";
    } finally {
      setUploadState(false);
    }
  }

  async function clearImage() {
    setMessage("");
    if (fileInput.current) fileInput.current.value = "";

    const previousUrl = imageUrl;
    setImageUrl("");
    setPreviewUrl("");
    if (previousUrl && previousUrl !== initialUrl) {
      try {
        const supabase = createClient();
        const oldPath = getManagedObjectPath(previousUrl, getSupabaseEnv().url, storeId);
        if (oldPath) {
          const { error } = await supabase.storage.from(bucketName).remove([oldPath]);
          if (error) throw error;
        }
      } catch {
        setMessage("Ảnh đã được bỏ khỏi biểu mẫu nhưng tệp tạm chưa được dọn khỏi kho.");
        setMessageIsError(true);
      }
    } else {
      setMessage("Ảnh sẽ được gỡ khỏi món sau khi bạn lưu thay đổi.");
      setMessageIsError(false);
    }
  }

  return (
    <div className="product-image-field">
      <input type="hidden" name="image_url" value={imageUrl} readOnly />
      <div className="product-image-preview" aria-label="Ảnh xem trước món ăn">
        {previewUrl ? <Image src={previewUrl} alt="Ảnh món ăn" width={180} height={120} unoptimized /> : <span>Ảnh món ăn</span>}
      </div>
      <div className="product-image-controls">
        <label className="secondary-submit product-image-select">
          {isUploading ? "Đang tải ảnh..." : previewUrl ? "Chọn ảnh khác" : "Chọn ảnh từ thiết bị"}
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={isUploading}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void uploadSelectedFile(file);
            }}
          />
        </label>
        {previewUrl && <button className="product-image-remove" type="button" disabled={isUploading} onClick={() => void clearImage()}>Bỏ ảnh</button>}
      </div>
      {message && <span className={"product-image-status" + (messageIsError ? " is-error" : "")} role="status">{message}</span>}
    </div>
  );
}
