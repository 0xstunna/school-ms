/**
 * SCHOOL LOGO UPLOAD
 * =================
 *
 * Reusable control for uploading a school logo (admin only).
 *
 * - Client-side validation: PNG / JPG / WebP, max ~500 KB.
 * - Client-side compression: ~300 px max dimension → base64 data URL.
 * - Preview in a fixed-size box so the page never shifts while loading.
 * - Actions: Replace (new file) and Remove (clears the logo).
 * - Emits `onChange(dataUrl)` with the new base64 string, or `null` on remove.
 *
 * Parent is responsible for persisting the value (e.g. updateConfig({ logoUrl })).
 */

import { useState, useRef } from 'react';
import {
  Upload, Image, Trash2, AlertCircle, RefreshCw,
} from 'lucide-react';
import { validateImageFile, compressImage } from '../../lib/imageUtils.js';
import Button from './Button.jsx';

const PREVIEW_SIZE = 140; // fixed preview box — no layout shift

const SchoolLogoUpload = ({
  currentUrl,
  onChange,
  disabled = false,
  label = 'School logo',
}) => {
  const [preview, setPreview] = useState(currentUrl || null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  const handleRemove = () => {
    setPreview(null);
    setError('');
    if (inputRef.current) inputRef.current.value = '';
    onChange(null);
  };

  const handleFileSelect = async (file) => {
    const validation = validateImageFile(file);
    if (!validation.ok) {
      setError(validation.error);
      return;
    }

    setLoading(true);
    setError('');
    try {
      const dataUrl = await compressImage(file);
      setPreview(dataUrl);
      onChange(dataUrl);
    } catch (err) {
      setError(err.message || 'Could not process the image.');
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e) => {
    const file = e.target.files?.[0];
    if (file) handleFileSelect(file);
  };

  const handleReplace = () => {
    setError('');
    if (inputRef.current) inputRef.current.click();
  };

  const accept = '.png, .jpg, .jpeg, .webp';

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <label className="text-sm font-semibold text-slate-700">{label}</label>
        {loading && (
          <span className="text-xs text-amber-600 animate-pulse flex items-center gap-1">
            <RefreshCw className="w-3 h-3" /> Processing…
          </span>
        )}
      </div>

      {/* Fixed-size preview area — no layout shift while loading. */}
      <div className="relative w-[140px] h-[140px] rounded-xl border-2 border-dashed rounded-lg flex items-center justify-center overflow-hidden group">
        {preview ? (
          <>
            <img
              src={preview}
              alt="School logo preview"
              className="w-full h-full object-contain bg-white"
            />
            <button
              type="button"
              onClick={handleRemove}
              disabled={loading}
              className="absolute top-1 right-1 p-1.5 bg-red-600/90 text-white rounded-lg hover:bg-red-700 transition-colors"
              aria-label="Remove logo"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-slate-400">
            <Image className="w-8 h-8 mb-1.5 opacity-50" />
            <p className="text-xs font-medium">No logo</p>
          </div>
        )}
        <div className="absolute inset-0 flex items-center justify-center bg-black/10 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button
            size="sm"
            variant="secondary"
            onClick={handleReplace}
            disabled={loading}
            icon={Upload}
            className="text-sm"
          >
            Replace
          </Button>
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={handleInputChange}
        disabled={loading}
        className="sr-only"
      />

      {error && (
        <div className="px-3 py-2 rounded-lg border border-amber-200 bg-amber-50 text-sm text-amber-700">
          <AlertCircle className="w-4 h-4 mr-2" /> {error}
        </div>
      )}
    </div>
  );
};

export default SchoolLogoUpload;
