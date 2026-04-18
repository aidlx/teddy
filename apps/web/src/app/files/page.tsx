'use client';

import { useEffect, useState } from 'react';
import { getBrowserSupabase } from '@/lib/supabase/client';

interface FileRow {
  id: string;
  name: string;
  size: number;
  mime_type: string;
  storage_path: string;
  created_at: string;
}

export default function FilesPage() {
  const [files, setFiles] = useState<FileRow[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadFiles();
  }, []);

  async function loadFiles() {
    const supabase = getBrowserSupabase();
    const { data, error } = await supabase
      .from('files')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) setError(error.message);
    else setFiles(data ?? []);
  }

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);

    const supabase = getBrowserSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setError('You must be signed in.');
      setUploading(false);
      return;
    }

    const path = `${user.id}/${crypto.randomUUID()}-${file.name}`;
    const { error: uploadError } = await supabase.storage.from('user-files').upload(path, file);
    if (uploadError) {
      setError(uploadError.message);
      setUploading(false);
      return;
    }

    const { error: insertError } = await supabase.from('files').insert({
      owner_id: user.id,
      name: file.name,
      mime_type: file.type || 'application/octet-stream',
      size: file.size,
      storage_path: path,
    });
    if (insertError) setError(insertError.message);
    else await loadFiles();
    setUploading(false);
    e.target.value = '';
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-6 py-8">
      <h1 className="text-2xl font-semibold">Files</h1>

      <label className="flex w-fit cursor-pointer items-center gap-2 rounded-md bg-white px-4 py-2 text-sm font-medium text-black hover:bg-zinc-200">
        <input type="file" onChange={onUpload} className="hidden" disabled={uploading} />
        {uploading ? 'Uploading…' : 'Upload file'}
      </label>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <ul className="flex flex-col divide-y divide-zinc-800 rounded-md border border-zinc-800">
        {files.length === 0 && <li className="px-4 py-6 text-sm text-zinc-500">No files yet.</li>}
        {files.map((f) => (
          <li key={f.id} className="flex items-center justify-between px-4 py-3 text-sm">
            <span>{f.name}</span>
            <span className="text-xs text-zinc-500">{(f.size / 1024).toFixed(1)} KB</span>
          </li>
        ))}
      </ul>
    </main>
  );
}
